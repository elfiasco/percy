"""Structured style metadata mined from reference documents.

The dataclasses in this module are the **machine-readable form** of "what
this team's charts and tables look like." Every field is a primitive or a
nested dataclass — no free-form strings, no nested-dict surprises — so:

  * Future agents can read e.g. `chart_style.legend.position` without
    having to do hash-lookups against a fuzzy dict.
  * Codegen can mechanically render any field into Python.
  * Frontend can render a side-by-side "before / after" review.

Three top-level kinds:

  * ChartStyle  — per chart_type (one DOUGHNUT entry, one LINE entry, etc.)
  * TableStyle  — a single profile aggregating all observed tables
  * TextStyleCatalog — fonts by use-case (title / subtitle / body / caption)

A StyleProfile rolls these up plus extraction metadata (sample counts, when
extracted, etc.) so a Template Set has exactly one profile blob.

All dataclasses have:
  * `to_dict()`  — JSON-safe serialization (nested dataclasses included)
  * `from_dict()` — reconstruct from a dict (defaults fill missing keys)

The serialized form is what lands in the studio_templates.style_profiles
column and the JSON returned by /api/template-sets/{id}/style-profile.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Any


# ── Primitive style dataclasses ─────────────────────────────────────────────


@dataclass(slots=True)
class FontSpec:
    """How text looks. Used everywhere fonts appear (titles, axes, labels)."""
    name: str = "Inter"
    size: float | None = None       # points
    bold: bool = False
    italic: bool = False
    color: str | None = None        # "#RRGGBB"

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)


@dataclass(slots=True)
class LineStyle:
    """A stroke — used for axis lines, table borders, connector lines."""
    visible: bool = True
    color: str | None = None
    width: float | None = None      # points
    dash: str | None = None         # 'solid' | 'dash' | 'dot' | 'dashDot' | ...

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)


@dataclass(slots=True)
class FillStyle:
    """A solid or themed fill. None color means transparent."""
    fill_type: str = "solid"        # 'solid' | 'gradient' | 'none' | 'pattern'
    color: str | None = None        # "#RRGGBB"
    transparency: float | None = None  # 0..1

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)


# ── Compound chart-level styles ─────────────────────────────────────────────


@dataclass(slots=True)
class LegendStyle:
    visible: bool = True
    position: str = "bottom"        # 'top' | 'bottom' | 'right' | 'left' | 'top_right' | ...
    font: FontSpec | None = None
    marker_shape: str | None = None  # 'square' | 'circle' | 'line'

    def to_dict(self) -> dict[str, Any]:
        d = _asdict_compact(self)
        return d


@dataclass(slots=True)
class AxisStyle:
    """Chart axis (category or value)."""
    visible: bool = True
    line: LineStyle | None = None
    tick_font: FontSpec | None = None
    gridlines_major: bool = False
    gridlines_minor: bool = False
    gridline_color: str | None = None
    label_rotation: float | None = None
    label_format: str | None = None     # value-axis number format like "{:,.0f}"

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)


@dataclass(slots=True)
class DataLabelStyle:
    show: bool = False
    format: str | None = None       # "{:.0%}" | "{:,.0f}" | "{:.1f}M"
    font: FontSpec | None = None
    position: str | None = None     # 'center' | 'outside_end' | 'inside_end'

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)


@dataclass(slots=True)
class ChartStyle:
    """The full style fingerprint for one chart type.

    `chart_type` matches the Bridge value (DOUGHNUT, COLUMN_CLUSTERED, etc.).
    `color_sequence` is series 1, 2, 3, ... in observed order — codegen uses
    it to set point/series colors when the user doesn't override.

    `sample_count` is how many real charts of this type contributed to the
    profile. Anything ≥ 2 is reasonably trustworthy; 1 means "we saw it
    once but couldn't average."
    """
    chart_type: str
    color_sequence: list[str] = field(default_factory=list)
    title_font: FontSpec | None = None
    plot_area: FillStyle | None = None
    category_axis: AxisStyle | None = None
    value_axis: AxisStyle | None = None
    legend: LegendStyle | None = None
    data_labels: DataLabelStyle | None = None

    sample_count: int = 0
    # LLM-written guidance — short, free-form, intentionally outside the
    # structural fields so agents can show it directly to humans.
    when_to_use: str = ""
    when_to_avoid: str = ""

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ChartStyle":
        return _hydrate(cls, d)


@dataclass(slots=True)
class TableStyle:
    """Style fingerprint for tables. One profile aggregates all tables in the
    reference corpus — tables don't have type subdivisions the way charts do.
    """
    header_fill: str | None = None
    header_font: FontSpec | None = None
    cell_font: FontSpec | None = None
    banded_rows: bool = False
    band_fills: list[str] = field(default_factory=list)     # [primary_band, alt_band]
    first_row_header: bool = False
    border_horizontal: LineStyle | None = None
    border_vertical: LineStyle | None = None
    text_align_first_col: str = "left"
    text_align_other_cols: str = "right"
    typical_columns: int | None = None
    typical_rows: int | None = None

    sample_count: int = 0
    when_to_use: str = ""

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TableStyle":
        return _hydrate(cls, d)


@dataclass(slots=True)
class TextStyleCatalog:
    """Fonts by use-case. Populated from observed text-element sizing.

    Slots use canonical names so codegen and agent prompts can rely on them.
    Missing slots fall back to `body`.
    """
    title: FontSpec | None = None       # > 28pt typically
    subtitle: FontSpec | None = None    # 18-28pt
    body: FontSpec | None = None        # 10-16pt — the dominant text style
    caption: FontSpec | None = None     # < 10pt
    monospace: FontSpec | None = None   # observed mono-family family if any

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TextStyleCatalog":
        return _hydrate(cls, d)


# ── Top-level rollup ────────────────────────────────────────────────────────


@dataclass(slots=True)
class StyleProfile:
    """Everything mined from a Template Set's reference docs in one blob.

    Lives in studio_templates.style_profiles as JSON. Codegen reads this to
    bake brand styling directly into the generated Python module so calling
    e.g. ``kpi_doughnut(...)`` produces a chart that matches the reference
    decks without any further tweaking.

    Extraction is deterministic except for `when_to_use` / `when_to_avoid`
    strings on individual chart/table styles — those are filled by the LLM
    polish pass and are intentionally outside the structural fields.
    """
    chart_styles: list[ChartStyle] = field(default_factory=list)
    table_style: TableStyle | None = None
    text_styles: TextStyleCatalog = field(default_factory=TextStyleCatalog)

    # Whole-corpus aggregates the codegen uses verbatim
    palette_ordered: list[str] = field(default_factory=list)   # most-used first
    primary_font: str = "Inter"
    sample_element_count: int = 0
    sample_doc_count: int = 0
    extracted_at: int = field(default_factory=lambda: int(time.time()))

    def to_dict(self) -> dict[str, Any]:
        return _asdict_compact(self)

    @classmethod
    def from_dict(cls, d: dict) -> "StyleProfile":
        if not isinstance(d, dict):
            return cls()
        return cls(
            chart_styles=[ChartStyle.from_dict(c) for c in (d.get("chart_styles") or [])],
            table_style=TableStyle.from_dict(d["table_style"]) if d.get("table_style") else None,
            text_styles=TextStyleCatalog.from_dict(d.get("text_styles") or {}),
            palette_ordered=list(d.get("palette_ordered") or []),
            primary_font=str(d.get("primary_font") or "Inter"),
            sample_element_count=int(d.get("sample_element_count") or 0),
            sample_doc_count=int(d.get("sample_doc_count") or 0),
            extracted_at=int(d.get("extracted_at") or 0),
        )

    def get_chart_style(self, chart_type: str) -> ChartStyle | None:
        """Look up a chart style by Bridge chart_type literal. Case-insensitive."""
        wanted = (chart_type or "").upper().replace("-", "_")
        for cs in self.chart_styles:
            if (cs.chart_type or "").upper().replace("-", "_") == wanted:
                return cs
        return None


# ── Helpers ─────────────────────────────────────────────────────────────────


def _asdict_compact(obj: Any) -> dict[str, Any]:
    """Like dataclasses.asdict() but drops None/empty values so the JSON
    representation stays human-readable. Structured-ness is preserved —
    missing keys imply default, never "don't know."
    """
    if not is_dataclass(obj):
        return obj
    out: dict[str, Any] = {}
    for f in fields(obj):
        val = getattr(obj, f.name)
        if val is None:
            continue
        if isinstance(val, list):
            if not val:
                continue
            out[f.name] = [_asdict_compact(v) if is_dataclass(v) else v for v in val]
        elif is_dataclass(val):
            sub = _asdict_compact(val)
            if sub:
                out[f.name] = sub
        elif isinstance(val, dict):
            if not val:
                continue
            out[f.name] = val
        elif isinstance(val, (int, float, bool)):
            # Keep 0 and False — they are meaningful (e.g. gridlines_major=False).
            out[f.name] = val
        elif isinstance(val, str):
            if val:
                out[f.name] = val
        else:
            out[f.name] = val
    return out


def _hydrate(cls: type, d: dict) -> Any:
    """Best-effort dataclass reconstruction from a dict. Unknown keys ignored;
    nested dataclass fields auto-hydrated via their from_dict if available.
    """
    if not isinstance(d, dict):
        return cls()
    kwargs: dict[str, Any] = {}
    for f in fields(cls):
        if f.name not in d:
            continue
        val = d[f.name]
        # Detect nested-dataclass fields via the type hint name. Slot-style
        # dataclasses don't expose nested types cleanly without typing.get_type_hints,
        # so we match by attribute structure instead.
        if isinstance(val, dict):
            nested_cls = _nested_class_for(f.name)
            if nested_cls is not None:
                val = _hydrate(nested_cls, val)
        elif isinstance(val, list) and f.name == "chart_styles":
            val = [_hydrate(ChartStyle, v) for v in val if isinstance(v, dict)]
        kwargs[f.name] = val
    return cls(**kwargs)


_NESTED_BY_FIELD = {
    "font": FontSpec,
    "title_font": FontSpec,
    "tick_font": FontSpec,
    "header_font": FontSpec,
    "cell_font": FontSpec,
    "title": FontSpec,
    "subtitle": FontSpec,
    "body": FontSpec,
    "caption": FontSpec,
    "monospace": FontSpec,
    "line": LineStyle,
    "border_horizontal": LineStyle,
    "border_vertical": LineStyle,
    "plot_area": FillStyle,
    "category_axis": AxisStyle,
    "value_axis": AxisStyle,
    "legend": LegendStyle,
    "data_labels": DataLabelStyle,
    "table_style": TableStyle,
    "text_styles": TextStyleCatalog,
}


def _nested_class_for(field_name: str) -> type | None:
    return _NESTED_BY_FIELD.get(field_name)


def profile_to_json(profile: StyleProfile) -> str:
    """Stable JSON form for storage. Pretty-printed for diff readability."""
    return json.dumps(profile.to_dict(), indent=2, sort_keys=False, default=str)


def profile_from_json(blob: str | dict | None) -> StyleProfile:
    if blob is None or blob == "":
        return StyleProfile()
    if isinstance(blob, str):
        try:
            data = json.loads(blob)
        except Exception:
            return StyleProfile()
    else:
        data = blob
    return StyleProfile.from_dict(data)
