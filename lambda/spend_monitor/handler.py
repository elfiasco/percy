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
KILL_USD = int(os.environ.get("KILL_USD", "200"))
KILL_PARAM = os.environ.get("KILL_PARAM", "/percy/spend/kill-state")
APPRUNNER_SERVICE_ARNS = [s.strip() for s in os.environ.get("APPRUNNER_SERVICE_ARNS", "").split(",") if s.strip()]
RDS_INSTANCE_IDS = [s.strip() for s in os.environ.get("RDS_INSTANCE_IDS", "").split(",") if s.strip()]


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


def _execute_kill(*, region: str, sns_client, topic_arn: str,
                   total: float, by_service: dict[str, float]) -> dict:
    """Pause every App Runner service + stop every RDS instance.

    Reversible from the AWS console. App Runner pause preserves config and
    container image; resume returns service to RUNNING. RDS stop pauses
    instance-hour billing for up to 7 days, then RDS auto-restarts it.
    Storage and NAT/VPC endpoint costs continue accruing at a much lower rate
    (~$3/day) so this is a hard brake but not a complete spend stop.
    """
    apprunner = boto3.client("apprunner", region_name=region)
    rds = boto3.client("rds", region_name=region)

    paused: list[str] = []
    pause_errors: list[str] = []
    for arn in APPRUNNER_SERVICE_ARNS:
        try:
            apprunner.pause_service(ServiceArn=arn)
            paused.append(arn.split("/")[-2] if "/" in arn else arn)
            log.info("paused App Runner service %s", arn)
        except apprunner.exceptions.InvalidStateException as exc:
            log.info("App Runner %s already paused/transitioning: %s", arn, exc)
            paused.append(f"{arn.split('/')[-2]} (already paused)")
        except Exception as exc:
            log.error("failed to pause App Runner %s: %s", arn, exc)
            pause_errors.append(f"{arn}: {exc}")

    stopped: list[str] = []
    stop_errors: list[str] = []
    for db_id in RDS_INSTANCE_IDS:
        try:
            rds.stop_db_instance(DBInstanceIdentifier=db_id)
            stopped.append(db_id)
            log.info("stopped RDS instance %s", db_id)
        except rds.exceptions.InvalidDBInstanceStateFault as exc:
            log.info("RDS %s already stopped/transitioning: %s", db_id, exc)
            stopped.append(f"{db_id} (already stopped)")
        except Exception as exc:
            log.error("failed to stop RDS %s: %s", db_id, exc)
            stop_errors.append(f"{db_id}: {exc}")

    subject = f"[Percy] KILL SWITCH FIRED - gross ${total:.2f} crossed ${KILL_USD}"
    paused_lines = [f"  - {n}" for n in paused] if paused else ["  (none configured)"]
    stopped_lines = [f"  - {n}" for n in stopped] if stopped else ["  (none configured)"]
    body_lines = [
        f"AWS gross MTD spend hit ${total:.2f}, crossing the ${KILL_USD} kill threshold.",
        "",
        "App Runner services PAUSED:",
        *paused_lines,
        "",
        "RDS instances STOPPED:",
        *stopped_lines,
    ]
    if pause_errors or stop_errors:
        body_lines += ["", "Errors:", *(f"  - {e}" for e in pause_errors + stop_errors)]
    body_lines += [
        "",
        "Top services this month:",
    ]
    for svc, amt in sorted(by_service.items(), key=lambda x: -x[1])[:6]:
        if amt > 0.01:
            body_lines.append(f"  ${amt:>7.2f}  {svc}")
    body_lines += [
        "",
        "To restore: AWS console → App Runner → Resume each service. RDS → Start.",
        "Or run: aws apprunner resume-service --service-arn <ARN>",
        "        aws rds start-db-instance --db-instance-identifier <ID>",
        "",
        f"Note: NAT gateway / VPC endpoints / storage continue accruing ~$3-4/day.",
        "Edit KILL_USD env var on percy-spend-monitor-dev to raise the threshold.",
    ]
    sns_client.publish(TopicArn=topic_arn, Subject=subject, Message="\n".join(body_lines))

    return {
        "paused_services": paused, "stopped_dbs": stopped,
        "pause_errors": pause_errors, "stop_errors": stop_errors,
    }


def _read_kill_state(ssm_client) -> dict:
    try:
        r = ssm_client.get_parameter(Name=KILL_PARAM)
        return json.loads(r["Parameter"]["Value"])
    except ssm_client.exceptions.ParameterNotFound:
        return {"month": "", "fired": False}
    except Exception as exc:
        log.warning("could not read kill state: %s", exc)
        return {"month": "", "fired": False}


def _write_kill_state(ssm_client, month: str, fired: bool) -> None:
    ssm_client.put_parameter(
        Name=KILL_PARAM,
        Value=json.dumps({"month": month, "fired": fired}),
        Type="String",
        Overwrite=True,
        Tier="Standard",
    )


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

    # Kill switch — fire once per calendar month if gross >= KILL_USD.
    kill_result = None
    if total >= KILL_USD:
        kill_state = _read_kill_state(ssm)
        already_fired_this_month = (
            kill_state.get("month") == current_month and kill_state.get("fired")
        )
        if not already_fired_this_month:
            log.warning("KILL THRESHOLD CROSSED — total=$%.2f killing services", total)
            kill_result = _execute_kill(
                region=region, sns_client=sns, topic_arn=topic_arn,
                total=total, by_service=by_service,
            )
            _write_kill_state(ssm, current_month, True)

    return {
        "ok": True, "alerted": True,
        "gross_mtd_usd": round(total, 4),
        "prev_threshold_usd": prev_threshold,
        "new_threshold_usd": new_threshold,
        "alerted_boundaries": alerted_thresholds,
        "kill_fired": kill_result is not None,
        "kill_result": kill_result,
    }
