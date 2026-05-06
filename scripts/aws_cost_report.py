"""Print a clean Percy AWS spend report — exactly the numbers the AWS Console
'Cost and Usage' widget shows, plus the credit burn rate and the always-on
costs (VPC endpoints) the dashboard hides.

Usage:
    python scripts/aws_cost_report.py
    python scripts/aws_cost_report.py --profile percy-dev
    python scripts/aws_cost_report.py --profile percy-dev --json    # for piping
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "src"))

from percy.agent import aws_cost


def _fmt_usd(amt: float) -> str:
    if amt < 0:
        return f"-${-amt:>7.2f}"
    return f" ${amt:>7.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="percy-dev")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--json", action="store_true",
                    help="Emit JSON instead of pretty text")
    args = ap.parse_args()

    report = aws_cost.full_aws_cost_report(profile=args.profile, region=args.region)
    if not report.get("available"):
        print(f"ERROR: {report.get('error')}")
        sys.exit(1)

    if args.json:
        print(json.dumps(report, indent=2))
        return

    mtd = report["month_to_date"]
    print(f"\n{'=' * 70}")
    print(f"Percy AWS spend — {mtd['period_start']} to {mtd['period_end']}")
    print('=' * 70)

    print(f"\n  Gross (real cost):    {_fmt_usd(mtd['gross_usd'])}")
    print(f"  AWS credits applied:  {_fmt_usd(mtd['credits_applied_usd'])}")
    print(f"  -------------------------")
    print(f"  Net (your invoice):   {_fmt_usd(mtd['net_usd'])}")
    print()
    print(f"  Daily burn:           {_fmt_usd(mtd['daily_burn_usd'])}")
    print(f"  Month-end forecast:   {_fmt_usd(mtd['projected_month_end_usd'])} (linear projection)")

    if mtd["by_service"]:
        print(f"\n  By service:")
        for svc, amt in sorted(mtd["by_service"].items(), key=lambda x: -x[1]):
            if amt > 0.001:
                pct = 100 * amt / max(0.001, mtd["gross_usd"])
                print(f"    {_fmt_usd(amt)}  {pct:>4.0f}%  {svc}")

    # VPC endpoint warning — usually the surprise cost
    vpce = report["vpc_endpoints"]
    if vpce["interface_endpoints"]:
        print(f"\n  !  VPC interface endpoints (always-on cost):")
        print(f"    {vpce['interface_endpoints']} endpoints  →  ~${vpce['estimated_monthly_usd']:.2f}/month projected")
        for ep in sorted(vpce["endpoints"], key=lambda x: -x["estimated_monthly_usd"]):
            print(f"      ${ep['estimated_monthly_usd']:>5.2f}/mo  {ep['service']:<22s}  ({ep['subnets']} subnets, {ep['state']})")
        print(f"    {vpce['note']}")

    if report["credit_history"]:
        print(f"\n  Credit history (last 6 months):")
        for h in report["credit_history"]:
            print(f"    {h['month']}  {_fmt_usd(h['credit_applied_usd'])}")

    print()


if __name__ == "__main__":
    main()
