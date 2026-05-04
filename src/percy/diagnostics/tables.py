"""Table-focused corpus diagnostics."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from percy.bridge import BridgeTable
from percy.diagnostics.common import ensure_dir, write_json
from percy.diagnostics.onboard import onboard_pptx


def analyze_tables(input_dir: str | Path, out_dir: str | Path | None = None) -> dict[str, Any]:
    pptx_paths = sorted(Path(input_dir).glob("*.pptx"))
    report: dict[str, Any] = {
        "input_dir": str(input_dir),
        "pptx_count": len(pptx_paths),
        "table_count": 0,
        "cell_count": 0,
        "merged_cell_count": 0,
        "semantic_debt_counts": {},
        "tables": [],
    }
    debt_counts: Counter[str] = Counter()

    for pptx_path in pptx_paths:
        document = onboard_pptx(pptx_path)
        for slide in document.slides:
            for element in slide.elements:
                if not isinstance(element, BridgeTable):
                    continue
                debt = element.custom_properties.get("semantic_debt", [])
                debt_counts.update(debt)
                rows = len(element.data)
                cols = len(element.data[0]) if element.data else 0
                cell_formats = [cell for row in element.cell_formats for cell in row]
                merged_count = sum(1 for cell in cell_formats if cell.merge.is_merged)
                filled_count = sum(1 for cell in cell_formats if cell.fill_color or cell.fill_type)
                bordered_count = sum(
                    1
                    for cell in cell_formats
                    if any(
                        border is not None
                        for border in (
                            cell.borders.border_top,
                            cell.borders.border_right,
                            cell.borders.border_bottom,
                            cell.borders.border_left,
                            cell.borders.diagonal_down,
                            cell.borders.diagonal_up,
                        )
                    )
                )
                report["tables"].append(
                    {
                        "pptx": str(pptx_path),
                        "slide_number": slide.slide_number,
                        "shape_id": element.identification.shape_id,
                        "shape_name": element.identification.shape_name,
                        "rows": rows,
                        "cols": cols,
                        "cell_count": len(cell_formats),
                        "merged_cell_count": merged_count,
                        "filled_cell_count": filled_count,
                        "bordered_cell_count": bordered_count,
                        "table_style_id": element.table_properties.table_style_id,
                        "style_flags": element.table_properties.conditional_formatting,
                        "column_widths": element.dimensions.column_widths,
                        "row_heights": element.dimensions.row_heights,
                        "sample_cells": [
                            {
                                "row": cell.grid_row,
                                "col": cell.grid_col,
                                "text": cell.text,
                                "fill_color": cell.fill_color,
                                "merge": cell.merge,
                                "paragraph_count": len(cell.paragraphs),
                                "run_count": sum(len(paragraph.runs) for paragraph in cell.paragraphs),
                                "margins": cell.margins,
                            }
                            for cell in cell_formats[:12]
                        ],
                        "semantic_debt": debt,
                    }
                )

    report["table_count"] = len(report["tables"])
    report["cell_count"] = sum(table["cell_count"] for table in report["tables"])
    report["merged_cell_count"] = sum(table["merged_cell_count"] for table in report["tables"])
    report["semantic_debt_counts"] = dict(debt_counts.most_common())
    if out_dir is not None:
        output_dir = ensure_dir(out_dir)
        write_json(report, output_dir / "table-audit.json")
    return report
