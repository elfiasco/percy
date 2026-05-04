"""Corpus-level diagnostics for enterprise decks and visual PDF targets."""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from percy.diagnostics.common import ensure_dir, write_json
from percy.diagnostics.inspect import inspect_pptx
from percy.diagnostics.workflow import roundtrip_pptx


SUPPORTED_SUFFIXES = {".pptx", ".pptm", ".pdf"}


def analyze_corpus(
    input_dir: str | Path,
    out_dir: str | Path,
    *,
    pptx_only: bool = False,
    run_roundtrip: bool = False,
    use_vision: bool = False,
    render: bool = False,
    lmstudio_url: str = "http://127.0.0.1:1234/v1/chat/completions",
    vision_model: str = "google/gemma-4-e4b",
) -> dict[str, Any]:
    """Analyze a corpus folder and write a feature inventory.

    PPTX files get XML/shape inspection immediately. PDF files are cataloged as
    visual targets for future PDF-to-slide reconstruction workflows.
    """

    input_path = Path(input_dir)
    output_path = ensure_dir(out_dir)
    files = sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED_SUFFIXES
        and (not pptx_only or path.suffix.lower() in {".pptx", ".pptm"})
    )

    feature_counts: Counter[str] = Counter()
    xml_patterns: Counter[str] = Counter()
    gap_counts: Counter[str] = Counter()
    pptx_reports = []
    pdf_reports = []
    roundtrip_reports = []

    for source in files:
        relative = source.relative_to(input_path)
        file_out = output_path / _safe_stem(relative)
        if source.suffix.lower() in {".pptx", ".pptm"}:
            inspection = inspect_pptx(source, file_out / "inspect")
            pptx_report = _summarize_pptx(source, inspection)
            pptx_reports.append(pptx_report)
            _accumulate_pptx(inspection, feature_counts, xml_patterns, gap_counts)
            if run_roundtrip:
                roundtrip_reports.append(
                    roundtrip_pptx(
                        source,
                        file_out / "roundtrip",
                        use_vision=use_vision,
                        render=render,
                        lmstudio_url=lmstudio_url,
                        vision_model=vision_model,
                    )
                )
        else:
            pdf_report = _summarize_pdf(source)
            pdf_reports.append(pdf_report)
            feature_counts["pdf_visual_target"] += 1

    report = {
        "input_dir": str(input_path),
        "pptx_only": pptx_only,
        "file_count": len(files),
        "pptx_count": len(pptx_reports),
        "pdf_count": len(pdf_reports),
        "feature_counts": dict(feature_counts.most_common()),
        "xml_patterns": dict(xml_patterns.most_common()),
        "gap_counts": dict(gap_counts.most_common()),
        "pptx_files": pptx_reports,
        "pdf_files": pdf_reports,
        "roundtrips": _summarize_roundtrips(roundtrip_reports),
        "recommended_next_fixes": _recommend_next_fixes(gap_counts, feature_counts),
    }
    write_json(report, output_path / ("pptx-corpus.json" if pptx_only else "corpus.json"))
    return report


def _summarize_pptx(source: Path, inspection: dict[str, Any]) -> dict[str, Any]:
    shape_counts: Counter[str] = Counter()
    for slide in inspection["slides"]:
        for shape in slide["shapes"]:
            shape_counts[shape.get("shape_type") or "unknown"] += 1
    return {
        "path": str(source),
        "slide_count": inspection["slide_count"],
        "shape_count": sum(shape_counts.values()),
        "shape_counts": dict(shape_counts.most_common()),
        "diagnostic_count": len(inspection["diagnostics"]),
        "diagnostics": inspection["diagnostics"][:25],
    }


def _summarize_pdf(source: Path) -> dict[str, Any]:
    return {
        "path": str(source),
        "status": "cataloged",
        "message": "PDF visual reconstruction targets are cataloged; PDF page rendering is the next pipeline step.",
    }


def _accumulate_pptx(
    inspection: dict[str, Any],
    feature_counts: Counter[str],
    xml_patterns: Counter[str],
    gap_counts: Counter[str],
) -> None:
    for gap in inspection["diagnostics"]:
        gap_counts[gap["code"]] += 1

    for slide in inspection["slides"]:
        feature_counts["slides"] += 1
        feature_counts["shapes"] += slide["shape_count"]
        for shape in slide["shapes"]:
            shape_type = shape.get("shape_type") or "unknown"
            feature_counts[f"shape_type:{shape_type}"] += 1
            if shape.get("has_text_frame"):
                feature_counts["text_frame"] += 1
            if shape.get("has_table"):
                feature_counts["table"] += 1
            if shape.get("has_chart"):
                feature_counts["chart"] += 1
            if shape.get("has_picture"):
                feature_counts["picture"] += 1
            for pattern in _xml_patterns(shape.get("raw_xml") or ""):
                xml_patterns[pattern] += 1


def _xml_patterns(xml: str) -> list[str]:
    patterns = []
    tokens = {
        "a:solidFill": "solid_fill",
        "a:gradFill": "gradient_fill",
        "a:ln": "line",
        "a:effectLst": "effects",
        "a:outerShdw": "shadow",
        "a:blipFill": "image_or_pattern_fill",
        "a:tbl": "table_xml",
        "c:chart": "chart_xml",
        "p:ph": "placeholder",
        "a:custGeom": "custom_geometry",
        "a:prstGeom": "preset_geometry",
        "a:buChar": "bullet_char",
        "a:buAutoNum": "auto_numbering",
    }
    for token, name in tokens.items():
        if token in xml:
            patterns.append(name)
    return patterns


def _summarize_roundtrips(roundtrip_reports: list[dict[str, Any]]) -> dict[str, Any]:
    if not roundtrip_reports:
        return {"enabled": False, "count": 0}
    errors_by_code: dict[str, int] = defaultdict(int)
    for report in roundtrip_reports:
        for error in report.get("errors", []):
            errors_by_code[error.get("code", "unknown")] += 1
    return {
        "enabled": True,
        "count": len(roundtrip_reports),
        "errors_by_code": dict(sorted(errors_by_code.items(), key=lambda item: item[1], reverse=True)),
    }


def _recommend_next_fixes(gap_counts: Counter[str], feature_counts: Counter[str]) -> list[dict[str, Any]]:
    recommendations = []
    if gap_counts.get("shape_type"):
        recommendations.append(
            {
                "area": "shape and placeholder semantics",
                "reason": f"{gap_counts['shape_type']} inspected shapes may rebuild generically.",
            }
        )
    if gap_counts.get("unresolved_inheritance"):
        recommendations.append(
            {
                "area": "inheritance resolver",
                "reason": f"{gap_counts['unresolved_inheritance']} text runs still have unresolved inherited values.",
            }
        )
    if feature_counts.get("text_frame"):
        recommendations.append(
            {
                "area": "text formatting",
                "reason": f"{feature_counts['text_frame']} text frames found across corpus.",
            }
        )
    if feature_counts.get("chart"):
        recommendations.append(
            {
                "area": "chart preservation",
                "reason": f"{feature_counts['chart']} charts found; preserve raw chart parts before semantic rebuild.",
            }
        )
    if feature_counts.get("table"):
        recommendations.append(
            {
                "area": "table formatting",
                "reason": f"{feature_counts['table']} tables found across corpus.",
            }
        )
    return recommendations


def _safe_stem(path: Path) -> str:
    return "__".join(path.with_suffix("").parts).replace(" ", "_")
