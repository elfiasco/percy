"""Apply connect-script outputs back to bound elements.

Bridges the gap between a connect script returning a value and that value
showing up in the chart/table/text it's bound to.

Output shape conventions (script's return value):

  Chart  → {"categories": [...], "series": [{"name", "values"}, ...]}
  Table  → {"data": [[...], ...]} OR {"columns": [...], "rows": [[...], ...]}
  Text   → "..." OR {"text": "..."}
  Shape  → {"text": "...", "fill_color"?: "...", ...}

If the script returns a dict matching the bound element type, we PATCH the
right typed endpoint. If the shape doesn't match, we record a "skipped"
outcome so the user can see what came back.

Used by the refresh agent: walks every connect, runs it, applies the result.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)


@dataclass(slots=True)
class ApplyResult:
    ok:           bool
    applied:      bool        # True if we actually patched something
    reason:       str | None = None
    endpoint:     str | None = None
    body:         dict | None = None


def apply_connect_output(
    *,
    studio,                  # Studio instance from script_api
    slide_n: int,
    element_id: str,
    element_type: str,
    output: Any,
) -> ApplyResult:
    """Translate a connect script's output to a typed PATCH against the element."""
    if output is None:
        return ApplyResult(ok=True, applied=False, reason="script returned None")

    if element_type == "BridgeChart":
        return _apply_chart(studio, slide_n, element_id, output)
    if element_type == "BridgeTable":
        return _apply_table(studio, slide_n, element_id, output)
    if element_type in ("BridgeText", "BridgeShape"):
        return _apply_text(studio, slide_n, element_id, output)

    return ApplyResult(ok=True, applied=False,
                       reason=f"no apply path for {element_type}")


def _apply_chart(studio, slide_n: int, element_id: str, output: Any) -> ApplyResult:
    # Acceptable shapes:
    #   {"categories": [...], "series": [{...}]}     — full
    #   {"series": [{...}]}                          — partial (categories preserved)
    #   pandas DataFrame-shaped {"columns": [...], "rows": [[...]]}
    if not isinstance(output, dict):
        return ApplyResult(ok=False, applied=False,
                           reason=f"chart output must be a dict, got {type(output).__name__}")

    body: dict = {}
    if "categories" in output:
        body["categories"] = list(output["categories"])
    if "series" in output:
        series_in = output["series"]
        if not isinstance(series_in, list):
            return ApplyResult(ok=False, applied=False,
                               reason="chart output 'series' must be a list")
        body["series"] = [
            {"name": s.get("name") if isinstance(s, dict) else None,
             "values": list(s.get("values") or s.get("data") or []) if isinstance(s, dict)
                       else list(s)}
            for s in series_in
        ]
    # DataFrame-shape coercion
    if "rows" in output and "columns" in output and "series" not in body:
        cols = list(output["columns"])
        rows = list(output["rows"])
        # Assume column 0 is categories; columns 1+ are series.
        if cols and rows:
            body["categories"] = [str(r[0]) for r in rows]
            body["series"] = [
                {"name": col, "values": [float(r[i + 1]) if r[i + 1] is not None else 0.0 for r in rows]}
                for i, col in enumerate(cols[1:])
            ]

    if not body:
        return ApplyResult(ok=False, applied=False,
                           reason="chart output had no recognizable shape (need categories + series, or columns + rows)")

    path = f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements/{element_id}/chart-data"
    try:
        studio._patch(path, body)
        return ApplyResult(ok=True, applied=True, endpoint=path, body=body)
    except Exception as exc:
        return ApplyResult(ok=False, applied=False, reason=str(exc), endpoint=path, body=body)


def _apply_table(studio, slide_n: int, element_id: str, output: Any) -> ApplyResult:
    if not isinstance(output, dict):
        return ApplyResult(ok=False, applied=False,
                           reason=f"table output must be a dict, got {type(output).__name__}")

    cells: list[dict] = []
    if "data" in output:
        data = output["data"]
        if not isinstance(data, list):
            return ApplyResult(ok=False, applied=False, reason="table 'data' must be list of lists")
        # Use the cells[] PATCH for selective updates of existing rows.
        for r, row in enumerate(data):
            if not isinstance(row, (list, tuple)):
                continue
            for c, cell in enumerate(row):
                cells.append({"row": r, "col": c, "text": str(cell) if cell is not None else ""})

    elif "columns" in output and "rows" in output:
        cols = list(output["columns"])
        rows = list(output["rows"])
        cells = [{"row": 0, "col": c, "text": str(col)} for c, col in enumerate(cols)]
        for r, row in enumerate(rows):
            for c, cell in enumerate(row):
                cells.append({"row": r + 1, "col": c, "text": str(cell) if cell is not None else ""})
    else:
        return ApplyResult(ok=False, applied=False,
                           reason="table output needs 'data' or 'columns'+'rows'")

    if not cells:
        return ApplyResult(ok=False, applied=False, reason="no cells produced from output")

    path = f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements/{element_id}/table-data"
    body = {"cells": cells}
    try:
        studio._patch(path, body)
        return ApplyResult(ok=True, applied=True, endpoint=path, body={"cells": f"{len(cells)} cells"})
    except Exception as exc:
        return ApplyResult(ok=False, applied=False, reason=str(exc), endpoint=path)


def _apply_text(studio, slide_n: int, element_id: str, output: Any) -> ApplyResult:
    if isinstance(output, str):
        text = output
    elif isinstance(output, dict) and "text" in output:
        text = str(output["text"])
    else:
        return ApplyResult(ok=False, applied=False,
                           reason=f"text element wants string or {{'text': ...}}, got {type(output).__name__}")
    path = f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements/{element_id}/text"
    # The /text PATCH expects a TextUpdateRequest: {kind: "paragraphs", paragraphs: [...]}
    body = {
        "kind": "paragraphs",
        "paragraphs": [{"runs": [{"text": text}]}],
    }
    try:
        studio._patch(path, body)
        return ApplyResult(ok=True, applied=True, endpoint=path, body={"text": text})
    except Exception as exc:
        return ApplyResult(ok=False, applied=False, reason=str(exc), endpoint=path)


def find_element_type(doc: Any, slide_n: int, element_id: str) -> str | None:
    """Look up element_type by (slide_n, element_id) for routing."""
    for slide in (doc.slides or []):
        if slide.slide_number != slide_n:
            continue
        for el in (slide.elements or []):
            ident = getattr(el, "identification", None)
            sid = str(getattr(ident, "shape_id", "") or "")
            if sid == element_id:
                return el.element_type
    return None
