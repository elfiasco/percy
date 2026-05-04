"""Audit how completely PPTX objects onboard into Bridge elements."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any

from percy.bridge import BridgeElement
from percy.diagnostics.common import ensure_dir, write_json
from percy.diagnostics.onboard import onboard_pptx


def audit_onboarding(pptx_path: str | Path, out_dir: str | Path | None = None) -> dict[str, Any]:
    document = onboard_pptx(pptx_path)
    element_reports = []
    by_type: dict[str, Counter[str]] = defaultdict(Counter)
    debt_counts: Counter[str] = Counter()

    for slide in document.slides:
        for element in slide.elements:
            report = _audit_element(slide.slide_number, element)
            element_reports.append(report)
            by_type[element.element_type]["count"] += 1
            by_type[element.element_type]["filled"] += len(report["filled_fields"])
            by_type[element.element_type]["missing"] += len(report["missing_fields"])
            for debt in report["semantic_debt"]:
                debt_counts[debt] += 1

    summary = {
        element_type: {
            "count": counts["count"],
            "filled_fields": counts["filled"],
            "missing_fields": counts["missing"],
        }
        for element_type, counts in sorted(by_type.items())
    }
    audit = {
        "source_path": str(pptx_path),
        "slide_count": len(document.slides),
        "element_count": len(element_reports),
        "summary_by_type": summary,
        "semantic_debt_counts": dict(debt_counts.most_common()),
        "elements": element_reports,
    }
    if out_dir is not None:
        output_dir = ensure_dir(out_dir)
        write_json(audit, output_dir / "onboarding-audit.json")
    return audit


def _audit_element(slide_number: int, element: BridgeElement) -> dict[str, Any]:
    flattened = _flatten_dataclass(element)
    filled = []
    missing = []
    for key, value in flattened.items():
        if key.startswith("custom_properties.") or key.endswith(".image_bytes") or key.endswith(".embedded_workbook_bytes"):
            continue
        if _is_missing(value):
            missing.append(key)
        else:
            filled.append(key)
    return {
        "slide_number": slide_number,
        "element_type": element.element_type,
        "shape_id": element.identification.shape_id,
        "shape_name": element.identification.shape_name,
        "group_id": element.identification.group_id,
        "source_shape_type": element.custom_properties.get("source_shape_type"),
        "semantic_role": element.custom_properties.get("semantic_role"),
        "semantic_debt": element.custom_properties.get("semantic_debt", []),
        "filled_fields": sorted(filled),
        "missing_fields": sorted(missing),
    }


def _flatten_dataclass(obj: Any, prefix: str = "") -> dict[str, Any]:
    if not is_dataclass(obj):
        return {prefix.rstrip("."): obj}
    values = {}
    for field_info in fields(obj):
        key = f"{prefix}{field_info.name}"
        value = getattr(obj, field_info.name)
        if is_dataclass(value):
            values.update(_flatten_dataclass(value, f"{key}."))
        else:
            values[key] = value
    return values


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if value == "":
        return True
    if isinstance(value, (list, tuple, dict, set)) and not value:
        return True
    return False
