"""Command-line interface for Percy diagnostics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from percy.bridge.io import load_percy, save_percy
from percy.diagnostics.audit import audit_onboarding
from percy.diagnostics.charts import analyze_charts
from percy.diagnostics.compare import compare_artifacts
from percy.diagnostics.corpus import analyze_corpus
from percy.diagnostics.inspect import inspect_pptx
from percy.diagnostics.onboard import onboard_pptx
from percy.diagnostics.rebuild import rebuild_pptx
from percy.diagnostics.render import render_pptx
from percy.diagnostics.tables import analyze_tables
from percy.diagnostics.workflow import roundtrip_pptx
from percy.tableau import inspect_tableau, onboard_tableau


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="percy")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="Dump PPTX structure diagnostics")
    inspect_parser.add_argument("pptx")
    inspect_parser.add_argument("--out", required=True)

    onboard_parser = subparsers.add_parser("onboard", help="Convert PPTX into a .percy file")
    onboard_parser.add_argument("pptx")
    onboard_parser.add_argument("--out", required=True)

    tableau_onboard_parser = subparsers.add_parser(
        "tableau-onboard",
        help="Convert Tableau .twb/.twbx into existing Percy bridge elements",
    )
    tableau_onboard_parser.add_argument("tableau")
    tableau_onboard_parser.add_argument("--out", required=True)

    tableau_inspect_parser = subparsers.add_parser(
        "tableau-inspect",
        help="Summarize Tableau .twb/.twbx bridge extraction",
    )
    tableau_inspect_parser.add_argument("tableau")

    rebuild_parser = subparsers.add_parser("rebuild", help="Build PPTX from a .percy file")
    rebuild_parser.add_argument("percy")
    rebuild_parser.add_argument("--out", required=True)

    render_parser = subparsers.add_parser("render", help="Render PPTX slides to images")
    render_parser.add_argument("pptx")
    render_parser.add_argument("--out", required=True)
    render_parser.add_argument("--engine", default="powerpoint", choices=["powerpoint"])

    compare_parser = subparsers.add_parser("compare", help="Compare two PPTX files")
    compare_parser.add_argument("expected")
    compare_parser.add_argument("actual")
    compare_parser.add_argument("--out", required=True)
    compare_parser.add_argument("--vision", action="store_true")
    compare_parser.add_argument("--no-render", action="store_true")
    compare_parser.add_argument("--lmstudio-url", default="http://127.0.0.1:1234/v1/chat/completions")
    compare_parser.add_argument("--vision-model", default="google/gemma-4-e4b")

    roundtrip_parser = subparsers.add_parser("roundtrip", help="Run inspect/onboard/rebuild/compare")
    roundtrip_parser.add_argument("pptx")
    roundtrip_parser.add_argument("--out", required=True)
    roundtrip_parser.add_argument("--vision", action="store_true")
    roundtrip_parser.add_argument("--no-render", action="store_true")
    roundtrip_parser.add_argument("--lmstudio-url", default="http://127.0.0.1:1234/v1/chat/completions")
    roundtrip_parser.add_argument("--vision-model", default="google/gemma-4-e4b")

    corpus_parser = subparsers.add_parser("corpus", help="Analyze a folder of PPTX/PDF files")
    corpus_parser.add_argument("input_dir")
    corpus_parser.add_argument("--out", required=True)
    corpus_parser.add_argument("--roundtrip", action="store_true")
    corpus_parser.add_argument("--render", action="store_true")
    corpus_parser.add_argument("--pptx-only", action="store_true")
    corpus_parser.add_argument("--vision", action="store_true")
    corpus_parser.add_argument("--lmstudio-url", default="http://127.0.0.1:1234/v1/chat/completions")
    corpus_parser.add_argument("--vision-model", default="google/gemma-4-e4b")

    audit_parser = subparsers.add_parser("audit-onboard", help="Audit Bridge field coverage for PPTX onboarding")
    audit_parser.add_argument("pptx")
    audit_parser.add_argument("--out", required=True)
    audit_parser.add_argument("--details", action="store_true", help="Print per-element audit details to stdout")

    chart_parser = subparsers.add_parser("chart-audit", help="Analyze PPTX chart examples in a folder")
    chart_parser.add_argument("input_dir")
    chart_parser.add_argument("--out", required=True)
    chart_parser.add_argument("--details", action="store_true", help="Print per-chart details to stdout")

    table_parser = subparsers.add_parser("table-audit", help="Analyze PPTX table examples in a folder")
    table_parser.add_argument("input_dir")
    table_parser.add_argument("--out", required=True)
    table_parser.add_argument("--details", action="store_true", help="Print per-table details to stdout")

    args = parser.parse_args(argv)

    if args.command == "inspect":
        report = inspect_pptx(args.pptx, args.out)
    elif args.command == "onboard":
        document = onboard_pptx(args.pptx)
        output_path = save_percy(document, args.out)
        report = {"percy_path": str(output_path), "slides": len(document.slides)}
    elif args.command == "tableau-onboard":
        document = onboard_tableau(args.tableau)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        output_path = save_percy(document, args.out)
        tableau = document.custom_properties.get("tableau", {})
        report = {
            "percy_path": str(output_path),
            "slides": len(document.slides),
            "worksheets": tableau.get("worksheet_count", 0),
            "dashboards": tableau.get("dashboard_count", 0),
            "datasources": tableau.get("datasource_count", 0),
        }
    elif args.command == "tableau-inspect":
        report = inspect_tableau(args.tableau)
    elif args.command == "rebuild":
        document = load_percy(args.percy)
        report = rebuild_pptx(document, args.out)
    elif args.command == "render":
        report = render_pptx(args.pptx, args.out, engine=args.engine)
    elif args.command == "compare":
        report = compare_artifacts(
            args.expected,
            args.actual,
            args.out,
            use_vision=args.vision,
            render=not args.no_render,
            lmstudio_url=args.lmstudio_url,
            vision_model=args.vision_model,
        )
    elif args.command == "roundtrip":
        report = roundtrip_pptx(
            args.pptx,
            args.out,
            use_vision=args.vision,
            render=not args.no_render,
            lmstudio_url=args.lmstudio_url,
            vision_model=args.vision_model,
        )
    elif args.command == "corpus":
        report = analyze_corpus(
            args.input_dir,
            args.out,
            pptx_only=args.pptx_only,
            run_roundtrip=args.roundtrip,
            use_vision=args.vision,
            render=args.render,
            lmstudio_url=args.lmstudio_url,
            vision_model=args.vision_model,
        )
    elif args.command == "audit-onboard":
        report = audit_onboarding(args.pptx, args.out)
        if not args.details:
            report = {key: value for key, value in report.items() if key != "elements"}
    elif args.command == "chart-audit":
        report = analyze_charts(args.input_dir, args.out)
        if not args.details:
            report = {key: value for key, value in report.items() if key != "charts"}
    elif args.command == "table-audit":
        report = analyze_tables(args.input_dir, args.out)
        if not args.details:
            report = {key: value for key, value in report.items() if key != "tables"}
    else:
        parser.error(f"Unknown command {args.command}")

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
