"""Percy spend-monitor Lambda.

Runs every 4 hours via EventBridge. Queries Cost Explorer for current-month
GROSS spend (RECORD_TYPE=Usage, before credits) and sends an SNS notification
each time we cross another $20 boundary.

Why this exists:
  AWS Budgets caps notifications at 10 per budget. The PercyGrossSpendBudget
  covers $20-$200 (10 thresholds). Beyond $200 budgets stop alerting unless
  we add more. This Lambda gives uncapped $20-step alerts forever, with a
  single SNS fan-out to every subscribed email.

State:
  Last alerted threshold (in USD, integer multiples of $20) is stored in
  SSM Parameter Store at PARAM_NAME. Read on every invocation, written
  whenever we cross a new boundary.

  Reset behavior: when the calendar month rolls over, we detect it and
  reset the threshold to 0 so the next month starts fresh.

Environment:
  ALERTS_TOPIC_ARN     — required, SNS topic to publish to
  PARAM_NAME           — SSM parameter holding {"month": "YYYY-MM",
                                                  "last_alert_usd": int}
                          default: /percy/spend/last-alert
  STEP_USD             — alert step size, default 20
  AWS_REGION           — auto-set by Lambda runtime
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os

import boto3

log = logging.getLogger()
log.setLevel(logging.INFO)


PARAM_NAME = os.environ.get("PARAM_NAME", "/percy/spend/last-alert")
STEP_USD = int(os.environ.get("STEP_USD", "20"))


def _gross_mtd_usd(ce_client) -> tuple[float, dict[str, float]]:
    """Return (total_gross_usd, by_service_dict) for current calendar month."""
    today = dt.date.today()
    start = today.replace(day=1)
    end = today + dt.timedelta(days=1)  # CE end exclusive

    resp = ce_client.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Usage"]}},
    )
    total = 0.0
    by_service: dict[str, float] = {}
    for entry in resp.get("ResultsByTime", []):
        for grp in entry.get("Groups", []):
            svc = grp["Keys"][0]
            amt = float(grp["Metrics"]["UnblendedCost"]["Amount"])
            by_service[svc] = by_service.get(svc, 0.0) + amt
            total += amt
    return total, by_service


def _llm_spend_today_usd() -> float:
    """Best-effort: query the App Runner studio's cost-summary endpoint for
    today's LLM spend so the alert message also includes app-side burn.
    Returns 0 if unreachable."""
    studio_url = os.environ.get("STUDIO_URL")
    if not studio_url:
        return 0.0
    try:
        import urllib.request
        req = urllib.request.Request(f"{studio_url.rstrip('/')}/api/agent/cost-summary")
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        return float(data.get("today", {}).get("cost_usd", 0.0))
    except Exception as exc:
        log.warning("could not fetch LLM spend: %s", exc)
        return 0.0


def _read_state(ssm_client) -> dict:
    try:
        r = ssm_client.get_parameter(Name=PARAM_NAME)
        return json.loads(r["Parameter"]["Value"])
    except ssm_client.exceptions.ParameterNotFound:
        return {"month": "", "last_alert_usd": 0}
    except Exception as exc:
        log.warning("could not read state from SSM: %s", exc)
        return {"month": "", "last_alert_usd": 0}


def _write_state(ssm_client, month: str, last_alert_usd: int) -> None:
    ssm_client.put_parameter(
        Name=PARAM_NAME,
        Value=json.dumps({"month": month, "last_alert_usd": last_alert_usd}),
        Type="String",
        Overwrite=True,
        Tier="Standard",
    )


def _format_message(*, total: float, prev_threshold: int, new_threshold: int,
                     by_service: dict[str, float], llm_today: float) -> tuple[str, str]:
    """Return (subject, body) for the SNS notification."""
    subject = f"[Percy] AWS gross spend crossed ${new_threshold}"
    lines = [
        f"AWS gross spend (this month, pre-credit): ${total:.2f}",
        f"Crossed: ${prev_threshold}  →  ${new_threshold}",
        "",
        "Top services (this month):",
    ]
    for svc, amt in sorted(by_service.items(), key=lambda x: -x[1])[:8]:
        if amt > 0.01:
            lines.append(f"  ${amt:>7.2f}  {svc}")
    if llm_today > 0.001:
        lines.append("")
        lines.append(f"LLM spend (today, app-side): ${llm_today:.4f}")
    lines.append("")
    lines.append("Set PERCY_LLM_PROVIDER=lmstudio (no Bedrock) or update org budgets to slow burn.")
    lines.append("Cost-summary live: GET /api/agent/cost-summary")
    return subject, "\n".join(lines)


def lambda_handler(event, context):
    region = os.environ.get("AWS_REGION", "us-east-1")
    topic_arn = os.environ.get("ALERTS_TOPIC_ARN")
    if not topic_arn:
        return {"ok": False, "error": "ALERTS_TOPIC_ARN env not set"}

    ce = boto3.client("ce", region_name=region)
    sns = boto3.client("sns", region_name=region)
    ssm = boto3.client("ssm", region_name=region)

    total, by_service = _gross_mtd_usd(ce)
    state = _read_state(ssm)
    today = dt.date.today()
    current_month = f"{today.year:04d}-{today.month:02d}"

    # Month rollover — reset the last-alert threshold
    if state.get("month") != current_month:
        log.info("Month rolled over to %s — resetting last-alert threshold", current_month)
        state = {"month": current_month, "last_alert_usd": 0}

    prev_threshold = int(state.get("last_alert_usd") or 0)
    # Floor of total to nearest STEP_USD
    new_threshold = (int(total) // STEP_USD) * STEP_USD

    log.info("gross MTD = $%.4f  prev_threshold = $%d  new_threshold = $%d",
             total, prev_threshold, new_threshold)

    if new_threshold <= prev_threshold:
        return {"ok": True, "alerted": False, "gross_mtd_usd": round(total, 4),
                "last_alert_usd": prev_threshold}

    # Crossed at least one $20 boundary since last alert. Send one alert per
    # boundary so the inbox shows the full ladder, not just the latest cross.
    llm_today = _llm_spend_today_usd()
    alerted_thresholds: list[int] = []
    for boundary in range(prev_threshold + STEP_USD, new_threshold + 1, STEP_USD):
        subject, body = _format_message(
            total=total, prev_threshold=boundary - STEP_USD, new_threshold=boundary,
            by_service=by_service, llm_today=llm_today,
        )
        sns.publish(TopicArn=topic_arn, Subject=subject, Message=body)
        alerted_thresholds.append(boundary)
        log.info("Published SNS alert for $%d boundary", boundary)

    _write_state(ssm, current_month, new_threshold)

    return {
        "ok": True, "alerted": True,
        "gross_mtd_usd": round(total, 4),
        "prev_threshold_usd": prev_threshold,
        "new_threshold_usd": new_threshold,
        "alerted_boundaries": alerted_thresholds,
    }
