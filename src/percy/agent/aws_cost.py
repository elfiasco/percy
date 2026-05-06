"""AWS infra cost reporting — pulls real numbers from Cost Explorer.

The AWS Console "Cost and Usage" widget reports GROSS spend (before credits).
Cost Explorer's default `UnblendedCost` returns NET ($0 if credits cover it).
This module normalizes both so the user sees real burn rate.

Functions:
  * ``infra_spend_summary(profile, region)`` — month-to-date gross + credits + net,
    with breakdown by service and a forecast.
  * ``credit_balance_estimate(profile)`` — best-effort credit consumption signal
    (AWS doesn't expose actual balance via API; we infer from credit application history).
  * ``vpc_endpoint_cost_warning(profile, region)`` — surfaces the always-on cost
    of Interface VPC endpoints, which are easy to overlook.

All functions return dicts that are safe to JSON-serialize for the cost-summary
endpoint.

Requires: boto3 + AWS credentials with ``ce:GetCostAndUsage`` and
``ec2:DescribeVpcEndpoints`` permissions. The IAM user ``percy-master`` has
these via the ``Billing`` and ``EC2ReadOnly`` managed policies.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)


# Number of months of credit history to consider when estimating burn rate.
_CREDIT_HISTORY_MONTHS = 6


@dataclass(slots=True)
class InfraSpend:
    period_start:        str
    period_end:          str
    gross_usd:           float                 # Real gross cost (before credits)
    credits_applied_usd: float                 # Negative number when credits applied
    net_usd:             float                 # gross + credits = what hits the invoice
    by_service:          dict[str, float]      # service → gross USD
    days_in_period:      int
    daily_burn_usd:      float                 # gross / days_in_period

    def projected_month_end_usd(self) -> float:
        """Linear projection: extrapolate daily burn to end of month."""
        today = dt.date.today()
        days_in_month = (dt.date(today.year + (today.month // 12),
                                  (today.month % 12) + 1, 1) - dt.timedelta(days=1)).day
        return self.daily_burn_usd * days_in_month

    def to_dict(self) -> dict:
        return {
            "period_start": self.period_start,
            "period_end":   self.period_end,
            "gross_usd":    round(self.gross_usd, 4),
            "credits_applied_usd": round(self.credits_applied_usd, 4),
            "net_usd":      round(self.net_usd, 4),
            "by_service":   {k: round(v, 4) for k, v in self.by_service.items()},
            "days_in_period": self.days_in_period,
            "daily_burn_usd":  round(self.daily_burn_usd, 4),
            "projected_month_end_usd": round(self.projected_month_end_usd(), 4),
        }


def _ce_client(profile: str | None = None, region: str = "us-east-1"):
    """Return a Cost Explorer boto3 client. CE is global but the SDK requires a region."""
    import boto3
    if profile:
        session = boto3.Session(profile_name=profile, region_name=region)
    else:
        session = boto3.Session(region_name=region)
    return session.client("ce")


def _ec2_client(profile: str | None = None, region: str = "us-east-1"):
    import boto3
    if profile:
        session = boto3.Session(profile_name=profile, region_name=region)
    else:
        session = boto3.Session(region_name=region)
    return session.client("ec2")


# ── Month-to-date gross + credits ──────────────────────────────────────────


def infra_spend_summary(
    profile: str | None = None, region: str = "us-east-1",
    *, lookback_days: int | None = None,
) -> InfraSpend:
    """Month-to-date AWS infra spend with gross + credits + net + by-service.

    If ``lookback_days`` is set, the period is the last N days instead of MTD.
    """
    today = dt.date.today()
    if lookback_days:
        start = today - dt.timedelta(days=lookback_days)
    else:
        start = today.replace(day=1)
    end = today + dt.timedelta(days=1)  # CE end is exclusive

    ce = _ce_client(profile, region)

    # 1. Gross spend (RECORD_TYPE=Usage, before credits)
    gross_resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Usage"]}},
    )
    by_service: dict[str, float] = {}
    gross = 0.0
    for entry in gross_resp.get("ResultsByTime", []):
        for grp in entry.get("Groups", []):
            svc = grp["Keys"][0]
            amt = float(grp["Metrics"]["UnblendedCost"]["Amount"])
            by_service[svc] = by_service.get(svc, 0.0) + amt
            gross += amt

    # 2. Credits (RECORD_TYPE=Credit, negative numbers)
    credits_resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Credit"]}},
    )
    credits = sum(
        float(e["Total"]["UnblendedCost"]["Amount"])
        for e in credits_resp.get("ResultsByTime", [])
    )

    days = max(1, (end - start).days)
    return InfraSpend(
        period_start=start.isoformat(),
        period_end=(end - dt.timedelta(days=1)).isoformat(),
        gross_usd=gross,
        credits_applied_usd=credits,
        net_usd=gross + credits,
        by_service=by_service,
        days_in_period=days,
        daily_burn_usd=gross / days,
    )


# ── Credit balance estimation ──────────────────────────────────────────────


def credit_burn_history(profile: str | None = None, region: str = "us-east-1") -> list[dict]:
    """Return the last 6 months of credit applications (negative numbers per month)."""
    today = dt.date.today()
    start = today.replace(day=1) - dt.timedelta(days=_CREDIT_HISTORY_MONTHS * 31)
    start = start.replace(day=1)
    end = today + dt.timedelta(days=1)

    ce = _ce_client(profile, region)
    resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Credit"]}},
    )
    out: list[dict] = []
    for entry in resp.get("ResultsByTime", []):
        out.append({
            "month": entry["TimePeriod"]["Start"][:7],
            "credit_applied_usd": float(entry["Total"]["UnblendedCost"]["Amount"]),
        })
    return out


# ── VPC endpoint cost warning ──────────────────────────────────────────────


# Interface VPC Endpoint pricing (us-east-1, May 2026): $0.01/hour per AZ per endpoint.
_VPCE_HOURLY_PER_AZ = 0.01


@dataclass(slots=True)
class VpceWarning:
    interface_endpoints:        int
    estimated_monthly_usd:      float
    endpoints:                  list[dict]
    note:                       str

    def to_dict(self) -> dict:
        return {
            "interface_endpoints": self.interface_endpoints,
            "estimated_monthly_usd": round(self.estimated_monthly_usd, 2),
            "endpoints": self.endpoints,
            "note": self.note,
        }


def vpc_endpoint_cost_estimate(
    profile: str | None = None, region: str = "us-east-1",
) -> VpceWarning:
    """Enumerate interface VPC endpoints and estimate their always-on cost.

    Interface endpoints in us-east-1 cost ~$0.01/hour PER subnet AZ they're
    deployed in. We approximate using one AZ per endpoint as a floor — real
    cost is higher when endpoints span multiple AZs.
    """
    try:
        ec2 = _ec2_client(profile, region)
        resp = ec2.describe_vpc_endpoints()
    except Exception as exc:
        log.warning("aws_cost: cannot enumerate VPC endpoints: %s", exc)
        return VpceWarning(0, 0.0, [], f"unable to enumerate: {exc}")

    interface_eps = [e for e in resp.get("VpcEndpoints", [])
                     if e.get("VpcEndpointType") == "Interface"]
    monthly = len(interface_eps) * _VPCE_HOURLY_PER_AZ * 24 * 30
    endpoints = [
        {
            "service": e["ServiceName"].split(".")[-1],
            "state":   e["State"],
            "subnets": len(e.get("SubnetIds") or []),
            # Each subnet is a separate billing unit
            "estimated_monthly_usd": round(
                len(e.get("SubnetIds") or [1]) * _VPCE_HOURLY_PER_AZ * 24 * 30, 2,
            ),
        }
        for e in interface_eps
    ]
    # Recompute with subnet awareness
    monthly = sum(ep["estimated_monthly_usd"] for ep in endpoints)
    return VpceWarning(
        interface_endpoints=len(interface_eps),
        estimated_monthly_usd=monthly,
        endpoints=endpoints,
        note=(
            "Interface VPC endpoints are billed per-AZ per-hour. "
            "Free Tier does not cover them. Consider whether all are needed "
            "or if a single NAT Gateway would be cheaper for your traffic pattern."
        ),
    )


# ── Composed dashboard report ──────────────────────────────────────────────


def full_aws_cost_report(
    profile: str | None = None, region: str = "us-east-1",
) -> dict:
    """Combined AWS infra report: month-to-date + credits + VPC warning + history.

    Returns a JSON-serializable dict suitable for the cost dashboard.
    """
    try:
        mtd = infra_spend_summary(profile, region)
    except Exception as exc:
        return {"error": f"infra_spend_summary failed: {exc}", "available": False}

    credit_history = []
    try:
        credit_history = credit_burn_history(profile, region)
    except Exception as exc:
        log.warning("aws_cost: credit history failed: %s", exc)

    vpce = vpc_endpoint_cost_estimate(profile, region)

    return {
        "available": True,
        "month_to_date":      mtd.to_dict(),
        "credit_history":     credit_history,
        "vpc_endpoints":      vpce.to_dict(),
        "ghi_sentinel": {
            # "Ghost in the infrastructure" — known always-on costs the user
            # might forget about. Helps explain why net is non-zero.
            "vpc_endpoints_per_month": vpce.estimated_monthly_usd,
        },
    }
