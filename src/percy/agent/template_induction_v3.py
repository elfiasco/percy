"""Template induction v3 — maximally decomposed pipeline.

Full design: `docs/template-induction-v3.md`. Quick orientation:

  Phase A — Programmatic extraction (no LLM)
  Phase B — Per-cluster semantic enrichment (7 LLM calls per cluster)
  Phase C — Style fragment characterization + cross-type validation
  Phase D — Per-template render + vision-critique + surgical refinement
  Phase E — Cross-template consolidation (dedup, naming, coverage audit)
  Phase F — Coverage synthesis (stub templates for missing slot types)
  Phase G — Final QC + end-to-end test-deck render

This file lives next to template_induction.py (v1, still wired into the
demo pipeline) until v3 is validated against all 5 demo brands. Then
the seed scripts flip default mode.

Naming convention for the phase functions:
  phase_a_*    — programmatic, no LLM
  phase_b_NN_* — semantic, one LLM call per question
  phase_c_*    — style fragments + cross-type templates
  phase_d_*    — render-validate loop
  phase_e_*    — cross-template
  phase_f_*    — coverage synthesis
  phase_g_*    — final QC

Every LLM call function follows the same shape:
  def phase_X_<name>(*, <typed inputs>, llm_call, provenance) -> <typed output>
        ↑ keyword-only so kwargs at call sites read as a recipe

`provenance` is a ProvenanceLogger that captures (system_prompt,
user_input, raw_output, parsed_output, duration_ms, cost_usd,
model) for every call. Persisted at end-of-run so we can replay
individual calls without re-running the whole pipeline.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Iterable

log = logging.getLogger(__name__)


# ── Standard inputs schema ────────────────────────────────────────────────
#
# Every template induced by v3 exposes inputs following these naming
# conventions. Same names across every template means:
#   * The Phase-1 slide agent has a stable surface to reason about.
#   * Cross-template style/data copy/paste works without translation.
#   * Template authoring tools can offer the same inspector everywhere.
#
# These constants drive both the variable-naming step (Phase B4 maps
# each element role to its canonical input set) AND the chart/table
# template synthesis (Phase C3, F1).


# Per-element common inputs (every element gets these, all optional):
STANDARD_GEOMETRY_INPUTS = (
    "left",          # inches OR percent of slide width, depending on `position_mode`
    "top",
    "width",
    "height",
    "rotation",      # degrees, 0 default
    "anchor",        # "top_left" | "center"  — interpretation of left/top
)

# Per-text-element inputs (added when role is one of: title, subtitle,
# kicker, hero_number, body, caption, footer, source_citation):
STANDARD_TEXT_INPUTS = (
    "text",          # primary content
    "font_size",     # pt
    "font_color",    # hex
    "font_bold",
    "font_italic",
    "text_align",    # "left" | "center" | "right"
)

# Per-shape-element extra inputs:
STANDARD_SHAPE_INPUTS = (
    "fill_color",
    "border_color",
    "border_width",
)

# Per-chart-element inputs — ALL chart-kind templates expose these:
STANDARD_CHART_INPUTS = (
    "categories",        # list[str]
    "series",            # list[{name, values, color?}]
    "title",             # str
    "subtitle",          # str (optional)
    "y_axis_min",        # number | null
    "y_axis_max",        # number | null
    "data_label_format", # str — e.g. "$#,##0", "#%", "0.0"
    "legend_visible",    # bool
    "legend_position",   # "top" | "bottom" | "left" | "right"
    # Type-specific extras handled by base templates (hole_size for donut, etc.)
)

# Per-table-element inputs — ALL table-kind templates expose these:
STANDARD_TABLE_INPUTS = (
    "data",              # list[list[str]]
    "first_row_header",  # bool
    "first_col_header",  # bool
    "banded_rows",       # bool
    "column_widths",     # list[float] | null (inches per col)
    "row_heights",       # list[float] | null
)


# ── Slide dimension contracts ─────────────────────────────────────────────
#
# Templates declare:
#   * the dimensions they were authored for (intended_width_in, height_in)
#   * which target aspect ratios they're compatible with
#   * how to adapt when applied to a differently-shaped slide
#
# Three transform strategies:
#
#   PROPORTIONAL_SCALE — multiply every position + size by
#       (target_w/source_w, target_h/source_h). Safe for most layouts;
#       can stretch type oddly on extreme aspect changes.
#
#   PRESERVE_ASPECT_FIT — scale uniformly to fit the smaller dim, then
#       center the result. Keeps proportions perfect; leaves bands of
#       background on the off-axis. Good for hero/cover layouts.
#
#   REFLOW_VERTICAL — for landscape→portrait conversion, re-stack
#       horizontally-arranged regions vertically. Requires the template
#       to mark grouped regions with `flow_group` ids.
#
#   MANUAL_ONLY — refuse to adapt. The template is single-dim and the
#       caller must use a differently-authored portrait variant.


ASPECT_LANDSCAPE_16_9   = "landscape_16_9"
ASPECT_LANDSCAPE_4_3    = "landscape_4_3"
ASPECT_PORTRAIT_9_16    = "portrait_9_16"
ASPECT_PORTRAIT_4_5     = "portrait_4_5"
ASPECT_SQUARE           = "square"

ALL_ASPECTS = (
    ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3,
    ASPECT_PORTRAIT_9_16, ASPECT_PORTRAIT_4_5, ASPECT_SQUARE,
)


@dataclass(slots=True)
class SlideDimensionsContract:
    """Per-template declaration of how the template handles different
    slide dimensions. Lives on the saved template's `provenance` blob
    so apply_template can transform positions when the target slide
    differs from the authored slide."""
    intended_width_in:  float = 13.333
    intended_height_in: float = 7.5
    intended_aspect:    str   = ASPECT_LANDSCAPE_16_9
    compatible_aspects: list[str] = field(default_factory=lambda: [ASPECT_LANDSCAPE_16_9])
    transform_strategy: str   = "proportional_scale"   # one of the strategies above
    # For REFLOW_VERTICAL: each element's flow_group id (None = standalone)
    flow_groups: dict[str, str] = field(default_factory=dict)


def classify_aspect(width_in: float, height_in: float) -> str:
    """Programmatic aspect classifier — used at apply time to decide
    which transform strategy to invoke."""
    if width_in <= 0 or height_in <= 0:
        return ASPECT_LANDSCAPE_16_9
    ratio = width_in / height_in
    if abs(ratio - 1.0) < 0.05:           return ASPECT_SQUARE
    if abs(ratio - 16/9) < 0.05:          return ASPECT_LANDSCAPE_16_9
    if abs(ratio - 4/3)  < 0.05:          return ASPECT_LANDSCAPE_4_3
    if abs(ratio - 9/16) < 0.05:          return ASPECT_PORTRAIT_9_16
    if abs(ratio - 4/5)  < 0.05:          return ASPECT_PORTRAIT_4_5
    return ASPECT_LANDSCAPE_16_9 if ratio > 1.0 else ASPECT_PORTRAIT_9_16


def transform_position(
    pos_in: dict[str, float],
    *,
    source_w: float, source_h: float,
    target_w: float, target_h: float,
    strategy: str = "proportional_scale",
) -> dict[str, float]:
    """Convert a position from one slide's coordinate system to another.

    Programmatic — no LLM. The Phase D render loop uses this to check
    that a template's authored positions still make sense at common
    target dimensions (4:3 + 16:9 + 9:16).
    """
    left = pos_in.get("left_in", 0)
    top  = pos_in.get("top_in", 0)
    w    = pos_in.get("width_in", 0)
    h    = pos_in.get("height_in", 0)

    if strategy == "proportional_scale":
        sx, sy = target_w / source_w, target_h / source_h
        return {
            "left_in":   round(left * sx, 4),
            "top_in":    round(top  * sy, 4),
            "width_in":  round(w    * sx, 4),
            "height_in": round(h    * sy, 4),
        }

    if strategy == "preserve_aspect_fit":
        # Scale uniformly to fit the smaller dim, center the result.
        s = min(target_w / source_w, target_h / source_h)
        new_w = w * s
        new_h = h * s
        # Offset to center the source canvas in the target
        offset_x = (target_w - source_w * s) / 2
        offset_y = (target_h - source_h * s) / 2
        return {
            "left_in":   round(left * s + offset_x, 4),
            "top_in":    round(top  * s + offset_y, 4),
            "width_in":  round(new_w, 4),
            "height_in": round(new_h, 4),
        }

    if strategy == "manual_only":
        return {"left_in": left, "top_in": top, "width_in": w, "height_in": h}

    # REFLOW_VERTICAL falls back to proportional for v1 — proper reflow
    # needs flow_group awareness at the caller level.
    return transform_position(
        pos_in, source_w=source_w, source_h=source_h,
        target_w=target_w, target_h=target_h, strategy="proportional_scale",
    )


def compute_position_percentages(
    pos_in: dict[str, float], slide_width: float, slide_height: float,
) -> dict[str, float]:
    """Programmatic — derive percent-of-slide positions alongside the
    absolute inches. Used by the apply pipeline as the fallback when a
    template lacks an explicit transform strategy."""
    if slide_width <= 0 or slide_height <= 0:
        return {"left_pct": 0, "top_pct": 0, "width_pct": 0, "height_pct": 0}
    return {
        "left_pct":   round(100 * pos_in.get("left_in", 0)  / slide_width,  3),
        "top_pct":    round(100 * pos_in.get("top_in", 0)   / slide_height, 3),
        "width_pct":  round(100 * pos_in.get("width_in", 0) / slide_width,  3),
        "height_pct": round(100 * pos_in.get("height_in", 0)/ slide_height, 3),
    }


# ── Brand metadata ────────────────────────────────────────────────────────


@dataclass(slots=True)
class PaletteColor:
    hex: str
    role: str | None = None           # "primary" | "accent" | "neutral" | "background" | None
    usage_count: int = 0
    proposed_role: str | None = None  # LLM-suggested role after Phase A enrichment


@dataclass(slots=True)
class BrandPalette:
    """Programmatic extraction of the brand's color palette from source decks.
    Ordered by usage_count desc — most-used colors first."""
    colors: list[PaletteColor] = field(default_factory=list)
    primary:   PaletteColor | None = None
    background: PaletteColor | None = None
    accents:   list[PaletteColor] = field(default_factory=list)


@dataclass(slots=True)
class FontUsage:
    name: str
    fallbacks: list[str] = field(default_factory=list)
    usage_count: int = 0
    role: str | None = None     # "heading" | "body" | "mono"
    proposed_role: str | None = None


@dataclass(slots=True)
class StyleProfile:
    """Brand-level styling extracted from all source decks.
    Used by Phase C for chart/table style fragments and Phase F for
    synthesizing missing-slot stub templates."""
    palette: BrandPalette = field(default_factory=BrandPalette)
    fonts:   list[FontUsage] = field(default_factory=list)
    # The numbers below are observed conventions across the brand's slides.
    typical_margin_in:        float = 0.5
    typical_title_height_in:  float = 1.4
    typical_footer_height_in: float = 0.3


# ── Element + slide fingerprints ──────────────────────────────────────────


@dataclass(slots=True)
class ElementFingerprint:
    """Deterministic identity for an element's STRUCTURAL role. Two elements
    with the same fingerprint can stand in for each other when clustering
    slides. Content (text values, exact colors) deliberately excluded —
    that's what we'd vary at apply time."""
    kind: str                  # "BridgeShape" | "BridgeText" | "BridgeChart" | ...
    quadrant: str              # "NW" | "N" | "NE" | "W" | "C" | "E" | "SW" | "S" | "SE"
    size_band: str             # "xs" | "sm" | "md" | "lg" | "xl"
    has_text: bool
    has_fill: bool
    has_image: bool
    has_chart: bool
    has_table: bool

    def to_tuple(self) -> tuple:
        return (self.kind, self.quadrant, self.size_band,
                self.has_text, self.has_fill, self.has_image,
                self.has_chart, self.has_table)


@dataclass(slots=True)
class SlideFingerprint:
    """Bag-of-element-fingerprints for a slide. Two slides with the same
    SlideFingerprint go into the same initial cluster."""
    element_fps: frozenset[tuple]   # frozenset of ElementFingerprint tuples
    element_count: int


@dataclass(slots=True)
class ClusterMember:
    ref_id: str
    slide_n: int
    slide: Any                  # PercyDocument's slide object


@dataclass(slots=True)
class SlideCluster:
    """Group of slides sharing a fingerprint — Phase A's output."""
    fingerprint: SlideFingerprint
    members: list[ClusterMember]
    prototype: ClusterMember    # the cluster member chosen as the canonical layout

    @property
    def size(self) -> int:
        return len(self.members)


# ── Style fragments (Phase A + C) ─────────────────────────────────────────


@dataclass(slots=True)
class GridlinesStyle:
    show: bool = False
    color: str | None = None       # hex
    weight: float | None = None    # pt
    dash: str | None = None        # "solid" | "dash" | "dot" | ...


@dataclass(slots=True)
class LegendStyle:
    visible: bool = True
    position: str | None = None    # "TOP" | "BOTTOM" | "LEFT" | "RIGHT"
    font_size: float | None = None
    font_name: str | None = None
    font_color: str | None = None


@dataclass(slots=True)
class TitleTypography:
    text: str | None = None
    font_size: float | None = None
    font_name: str | None = None
    font_bold: bool | None = None
    font_color: str | None = None


@dataclass(slots=True)
class AxisTypography:
    font_size: float | None = None
    font_name: str | None = None
    font_color: str | None = None
    tick_label_rotation: float | None = None


@dataclass(slots=True)
class DataLabelStyle:
    show: bool = False
    format: str | None = None
    font_size: float | None = None
    font_color: str | None = None
    position: str | None = None


@dataclass(slots=True)
class PlotAreaStyle:
    fill_color: str | None = None
    border_color: str | None = None
    border_width: float | None = None


@dataclass(slots=True)
class RawChartStyle:
    """Phase A6 output. Type-agnostic fields PORT across chart types in
    Phase C3; type-specific fields stay with the source type."""
    # ── Type-agnostic (PORTABLE) ──
    series_palette: list[str] = field(default_factory=list)
    gridlines_major: GridlinesStyle = field(default_factory=GridlinesStyle)
    gridlines_minor: GridlinesStyle = field(default_factory=GridlinesStyle)
    legend: LegendStyle = field(default_factory=LegendStyle)
    title_typography: TitleTypography = field(default_factory=TitleTypography)
    axis_typography: AxisTypography = field(default_factory=AxisTypography)
    data_labels: DataLabelStyle = field(default_factory=DataLabelStyle)
    plot_area: PlotAreaStyle = field(default_factory=PlotAreaStyle)
    # ── Type-specific (NOT portable) ──
    chart_type: str = ""
    hole_size: int | None = None             # donut only
    bar_width_ratio: float | None = None     # bar/column only
    is_horizontal: bool | None = None
    vary_colors: bool | None = None
    # ── Provenance ──
    source_ref: str = ""
    source_slide_n: int = 0
    source_chart_id: str = ""

    def portable_hash(self) -> str:
        """Hash JUST the type-agnostic fields. Two charts with the same
        portable_hash collapse to one style fragment in Phase A."""
        import hashlib
        portable_json = json.dumps({
            "series_palette": self.series_palette,
            "gridlines_major": asdict(self.gridlines_major),
            "gridlines_minor": asdict(self.gridlines_minor),
            "legend": asdict(self.legend),
            "title_typography": {
                **{k: v for k, v in asdict(self.title_typography).items() if k != "text"}
            },
            "axis_typography": asdict(self.axis_typography),
            "data_labels": asdict(self.data_labels),
            "plot_area": asdict(self.plot_area),
        }, sort_keys=True, default=str)
        return hashlib.sha256(portable_json.encode()).hexdigest()[:16]


@dataclass(slots=True)
class CellStyle:
    fill_color: str | None = None
    font_color: str | None = None
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    h_align: str | None = None
    v_align: str | None = None


@dataclass(slots=True)
class BorderStyle:
    weight: float | None = None
    color: str | None = None
    pattern: str | None = None    # "solid" | "dash" | ...


@dataclass(slots=True)
class FontSpec:
    name: str | None = None
    size: float | None = None
    bold: bool | None = None


@dataclass(slots=True)
class RawTableStyle:
    """Phase A7 output. Same portable / non-portable split as RawChartStyle."""
    # ── Type-agnostic (PORTABLE) ──
    header_row_style: CellStyle = field(default_factory=CellStyle)
    banded_rows: bool = False
    band_a: str | None = None
    band_b: str | None = None
    border_style: BorderStyle = field(default_factory=BorderStyle)
    cell_padding_in: float = 0.05
    default_font: FontSpec = field(default_factory=FontSpec)
    header_text_align: str | None = None
    body_text_align: str | None = None
    first_col_header: bool = False
    # ── Provenance ──
    source_ref: str = ""
    source_slide_n: int = 0
    source_table_id: str = ""

    def portable_hash(self) -> str:
        import hashlib
        portable_json = json.dumps({
            "header_row_style": asdict(self.header_row_style),
            "banded_rows": self.banded_rows,
            "band_a": self.band_a, "band_b": self.band_b,
            "border_style": asdict(self.border_style),
            "cell_padding_in": self.cell_padding_in,
            "default_font": asdict(self.default_font),
            "header_text_align": self.header_text_align,
            "body_text_align": self.body_text_align,
            "first_col_header": self.first_col_header,
        }, sort_keys=True, default=str)
        return hashlib.sha256(portable_json.encode()).hexdigest()[:16]


# ── Phase B outputs ───────────────────────────────────────────────────────


# Closed vocabularies — these are LLM constraints, kept as Python constants
# so static analysis catches typos at call sites.
SLOT_TAXONOMY = (
    "cover", "divider", "hero_metric", "kpi_grid", "chart", "table",
    "narrative", "comparison", "bulleted_list", "quote", "image_lead",
    "agenda", "close",
)

ELEMENT_ROLES = (
    "title", "subtitle", "kicker", "hero_number", "body", "bullet_item",
    "caption", "footer", "source_citation", "logo", "decorative",
    "background", "chart", "table", "image",
)

TAG_VOCAB = (
    "data", "narrative", "hero", "divider", "opener", "closer", "kpi",
    "chart", "table", "quote", "comparison", "bulleted", "image",
    "dense", "sparse", "cover",
)


@dataclass(slots=True)
class SemanticIntent:
    """Phase B1 output."""
    intent: str
    confidence: float = 1.0


@dataclass(slots=True)
class SlotAssignment:
    """Phase B2 output."""
    slot: str                  # one of SLOT_TAXONOMY
    rationale: str = ""


@dataclass(slots=True)
class ElementRoleMap:
    """Phase B3 output. Maps element index → role from ELEMENT_ROLES."""
    roles: dict[int, str] = field(default_factory=dict)
    rationale: str = ""


@dataclass(slots=True)
class VariableSpec:
    """Phase B4 output, one per candidate variable."""
    element_idx: int
    varies: bool
    input_name: str            # e.g. "hero_number" — derived from role
    input_type: str            # "string" | "number" | "list" | ...
    samples: list[str] = field(default_factory=list)
    reasoning: str = ""


@dataclass(slots=True)
class NameCandidates:
    """Phase B5 output."""
    candidates: list[str] = field(default_factory=list)
    chosen: str = ""


@dataclass(slots=True)
class TemplateDescription:
    """Phase B6 output. Multiple description fields so downstream passes
    (E1 dedup, agent Phase-1 strategy, agent Phase-2 input filling) can
    read templates without re-seeing source slides.

      short_description — ≤140 chars, for browsing template cards
      long_description  — 2-4 sentences, full context for an LLM
      use_when          — one short clause listing concrete fits
      avoid_when        — one short clause listing concrete misfits

    All four are LLM-authored in Phase B6 as a single batched call to
    keep cost down (one call returns the whole metadata bundle).
    """
    description: str = ""              # legacy alias for short_description
    short_description: str = ""
    long_description: str = ""
    use_when: str = ""
    avoid_when: str = ""


@dataclass(slots=True)
class TagAssignment:
    """Phase B7 output."""
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class EnrichedCluster:
    """All of Phase B's outputs bundled per cluster. Becomes the input
    to Phase D's render-validate loop."""
    cluster: SlideCluster
    intent: SemanticIntent
    slot: SlotAssignment
    roles: ElementRoleMap
    variables: list[VariableSpec]
    name: NameCandidates
    description: TemplateDescription
    tags: TagAssignment


# ── Phase C outputs ───────────────────────────────────────────────────────


@dataclass(slots=True)
class StyleFragmentCharacterization:
    """Phase C1 output."""
    summary: str
    design_signals: list[str] = field(default_factory=list)


@dataclass(slots=True)
class StyleValidationResult:
    """Phase C2 output, one per (style_fragment, target_chart_type) pair."""
    chart_type: str
    quality: str               # "good" | "fair" | "poor"
    issues: list[str] = field(default_factory=list)
    suggested_fixes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ValidatedChartStyle:
    """Phase C output. The raw style + LLM characterization + per-type
    validation results + the final cross-type base templates."""
    raw: RawChartStyle
    characterization: StyleFragmentCharacterization
    validation_results: list[StyleValidationResult] = field(default_factory=list)
    base_templates: dict[str, dict] = field(default_factory=dict)
    # ↑ chart_type → fully-formed template JSON ready for the catalog


@dataclass(slots=True)
class ValidatedTableStyle:
    raw: RawTableStyle
    characterization: StyleFragmentCharacterization
    validation_results: list[StyleValidationResult] = field(default_factory=list)
    base_templates: dict[str, dict] = field(default_factory=dict)
    # ↑ table-use ("agenda"|"kpi_grid"|"comparison"|"data_dump") → template JSON


# ── Phase D outputs ───────────────────────────────────────────────────────


@dataclass(slots=True)
class RenderResult:
    """Phase D1/D2 output — a rendered PNG + the inputs used."""
    inputs_label: str          # "default" | "long_text" | "short_text" | "multi_series"
    image_path: str            # filesystem path
    elements_rendered: int


@dataclass(slots=True)
class VisionCritique:
    """Phase D3 output."""
    inputs_label: str
    scores: dict[str, int]     # overflow / collision / readability / brand
    issues: list[str] = field(default_factory=list)
    overall: str = "pass"      # "pass" | "fair" | "fail"


@dataclass(slots=True)
class TemplatePatch:
    """Phase D4 output — a JSON-pointer-style patch to apply."""
    path: str                  # e.g. "layout[0].body.position.height_in"
    new_value: Any


@dataclass(slots=True)
class TemplateValidationResult:
    template: dict             # final patched template
    iterations: int            # how many refinement loops
    renders: list[RenderResult] = field(default_factory=list)
    critiques: list[VisionCritique] = field(default_factory=list)
    final_confidence: float = 1.0


# ── Phase E + F outputs ───────────────────────────────────────────────────


@dataclass(slots=True)
class MergeGroup:
    """Phase E1 output."""
    member_ids: list[str]
    variance_description: str
    proposed_input: str
    proposed_input_values: list[str] = field(default_factory=list)


@dataclass(slots=True)
class RenameMap:
    """Phase E3 output."""
    renames: dict[str, str] = field(default_factory=dict)  # tpl_id → new_name


@dataclass(slots=True)
class CoverageGap:
    """Phase E4 + F output."""
    slot: str                  # one of SLOT_TAXONOMY
    synthesized: bool = False
    synthesized_template: dict | None = None


# ── Provenance + cost tracking ────────────────────────────────────────────


@dataclass(slots=True)
class CallProvenance:
    """One LLM call's full audit record."""
    call_id: str
    phase: str
    system_prompt: str
    user_input: str
    raw_output: str
    parsed_output: dict
    model: str
    duration_ms: int
    cost_usd: float = 0.0
    timestamp: int = 0
    error: str | None = None


class ProvenanceLogger:
    """Captures every LLM call's full record so we can replay individual
    calls without re-running the pipeline, A/B prompt changes, and audit
    quality over time.

    Persisted to studio_template_set_inductions at end of run."""

    def __init__(self, induction_id: str | None = None):
        self.induction_id = induction_id or uuid.uuid4().hex[:12]
        self.calls: list[CallProvenance] = []
        self.start_ts = int(time.time())

    def record(
        self, *, phase: str, system_prompt: str, user_input: str,
        raw_output: str, parsed_output: dict, model: str,
        duration_ms: int, cost_usd: float = 0.0,
        error: str | None = None,
    ) -> CallProvenance:
        cp = CallProvenance(
            call_id=uuid.uuid4().hex[:12],
            phase=phase,
            system_prompt=system_prompt,
            user_input=user_input[:8000],   # cap to keep DB rows manageable
            raw_output=raw_output[:8000],
            parsed_output=parsed_output,
            model=model,
            duration_ms=duration_ms,
            cost_usd=cost_usd,
            timestamp=int(time.time()),
            error=error,
        )
        self.calls.append(cp)
        return cp

    @property
    def total_cost_usd(self) -> float:
        return sum(c.cost_usd for c in self.calls)

    @property
    def total_calls(self) -> int:
        return len(self.calls)

    def to_dict(self) -> dict[str, Any]:
        return {
            "induction_id": self.induction_id,
            "start_ts": self.start_ts,
            "total_calls": self.total_calls,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "calls": [asdict(c) for c in self.calls],
        }


# ── LLM call wrapper ──────────────────────────────────────────────────────


_DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

# Cost per 1K tokens (Bedrock cross-region rates, USD).
_COST_TABLE = {
    "us.anthropic.claude-sonnet-4-6":              (0.003, 0.015),
    "us.anthropic.claude-opus-4-5-20251101-v1:0":  (0.015, 0.075),
    "us.anthropic.claude-opus-4-7":                (0.015, 0.075),
    "us.anthropic.claude-3-5-haiku-20241022-v1:0": (0.0008, 0.004),
}


def _estimate_cost(model: str, system: str, user: str, output: str) -> float:
    """Rough token = 4 chars approximation. Good enough for budgeting."""
    rates = _COST_TABLE.get(model, _COST_TABLE[_DEFAULT_MODEL])
    in_tok  = (len(system) + len(user)) / 4
    out_tok = len(output) / 4
    return (in_tok / 1000) * rates[0] + (out_tok / 1000) * rates[1]


def _call_llm_typed(
    *, system: str, user: str,
    llm_call: Callable[[str, str], str],
    parse: Callable[[dict], Any],
    phase: str, provenance: ProvenanceLogger,
    model: str = _DEFAULT_MODEL,
) -> Any:
    """Shared boilerplate: run the LLM call, time it, parse JSON, record
    provenance. Any parse error gets logged and re-raised — the caller
    decides whether to retry or fall through to defaults."""
    t0 = time.time()
    raw = ""
    parsed: dict = {}
    err: str | None = None
    try:
        raw = llm_call(system, user)
        parsed = _parse_json(raw) or {}
    except Exception as exc:
        err = str(exc)
        log.warning("[%s] LLM call failed: %s", phase, exc)
    duration_ms = int((time.time() - t0) * 1000)
    cost = _estimate_cost(model, system, user, raw)
    provenance.record(
        phase=phase, system_prompt=system, user_input=user,
        raw_output=raw, parsed_output=parsed, model=model,
        duration_ms=duration_ms, cost_usd=cost, error=err,
    )
    if err:
        raise RuntimeError(f"{phase}: {err}")
    if not parsed:
        raise RuntimeError(f"{phase}: unparseable LLM response")
    return parse(parsed)


_FENCED_JSON_RE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict | None:
    """Best-effort JSON extraction — handles fenced blocks, raw blobs, and
    LLMs that sometimes add a sentence of prose around their JSON."""
    if not text:
        return None
    s = text.strip()
    m = _FENCED_JSON_RE.search(s)
    if m:
        try: return json.loads(m.group(1))
        except Exception: pass
    try:
        return json.loads(s)
    except Exception:
        pass
    m2 = _JSON_BLOCK_RE.search(s)
    if m2:
        try: return json.loads(m2.group(0))
        except Exception: return None
    return None


# ── Phase A — programmatic extraction ─────────────────────────────────────


def phase_a_fingerprint_element(el: Any, slide_width: float, slide_height: float) -> ElementFingerprint:
    """Deterministic structural identity. Used by A3 to cluster slides."""
    pos = getattr(el, "position", None)
    if pos:
        cx = pos.left + pos.width / 2
        cy = pos.top + pos.height / 2
    else:
        cx = cy = 0
    # 3x3 quadrant grid: NW / N / NE / W / C / E / SW / S / SE
    h = "W" if cx < slide_width / 3 else "E" if cx > 2 * slide_width / 3 else ""
    v = "N" if cy < slide_height / 3 else "S" if cy > 2 * slide_height / 3 else ""
    quadrant = (v + h) or "C"
    # Size band as a fraction of slide area.
    area = (pos.width * pos.height) if pos else 0
    slide_area = slide_width * slide_height
    rel = area / slide_area if slide_area > 0 else 0
    size_band = (
        "xs" if rel < 0.02 else
        "sm" if rel < 0.10 else
        "md" if rel < 0.30 else
        "lg" if rel < 0.60 else "xl"
    )
    et = getattr(el, "element_type", el.__class__.__name__)
    has_text = bool(_first_text(el))
    fill = getattr(el, "fill", None)
    has_fill = bool(fill and getattr(fill, "color", None) and getattr(getattr(fill, "color", None), "value", None))
    return ElementFingerprint(
        kind=et, quadrant=quadrant, size_band=size_band,
        has_text=has_text, has_fill=has_fill,
        has_image=(et == "BridgeImage"),
        has_chart=(et == "BridgeChart"),
        has_table=(et == "BridgeTable"),
    )


def phase_a_cluster_slides(docs_by_ref: dict[str, Any]) -> list[SlideCluster]:
    """Group slides by SlideFingerprint. Each cluster's prototype is its
    first member by (ref_id, slide_n) order — stable across runs."""
    by_fp: dict[tuple, list[ClusterMember]] = defaultdict(list)
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            w = getattr(slide, "width", 13.333)
            h = getattr(slide, "height", 7.5)
            fps = []
            for el in (slide.elements or []):
                fps.append(phase_a_fingerprint_element(el, w, h).to_tuple())
            fp = (frozenset(fps), len(fps))
            by_fp[fp].append(ClusterMember(
                ref_id=ref_id, slide_n=slide.slide_number, slide=slide,
            ))
    out: list[SlideCluster] = []
    for (fps_set, count), members in by_fp.items():
        if not members: continue
        members.sort(key=lambda m: (m.ref_id, m.slide_n))
        out.append(SlideCluster(
            fingerprint=SlideFingerprint(element_fps=fps_set, element_count=count),
            members=members,
            prototype=members[0],
        ))
    # Sort clusters by size descending — biggest = most-template-worthy.
    out.sort(key=lambda c: -c.size)
    return out


def phase_a_extract_palette(docs_by_ref: dict[str, Any]) -> BrandPalette:
    """Walk every element's fill, count hex colors, classify."""
    counts: dict[str, int] = defaultdict(int)
    for doc in docs_by_ref.values():
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                fill = getattr(el, "fill", None)
                if not fill: continue
                col = getattr(fill, "color", None)
                if not col: continue
                v = getattr(col, "value", None)
                if isinstance(v, str) and v.startswith("#"):
                    counts[v.upper()] += 1
    ordered = sorted(counts.items(), key=lambda kv: -kv[1])
    palette_colors = [
        PaletteColor(hex=hex_, usage_count=count,
                     role=("primary" if i == 0 else "accent" if i < 5 else "neutral"))
        for i, (hex_, count) in enumerate(ordered[:16])
    ]
    return BrandPalette(
        colors=palette_colors,
        primary=palette_colors[0] if palette_colors else None,
        accents=palette_colors[1:5],
    )


def phase_a_extract_fonts(docs_by_ref: dict[str, Any]) -> list[FontUsage]:
    """Walk every text run, count font names."""
    counts: dict[str, int] = defaultdict(int)
    for doc in docs_by_ref.values():
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                for run in _iter_runs(el):
                    name = getattr(run, "font_name", None)
                    if name: counts[str(name)] += 1
    ordered = sorted(counts.items(), key=lambda kv: -kv[1])
    return [
        FontUsage(name=name, usage_count=count,
                  role=("heading" if i == 0 else "body" if i == 1 else "alt"))
        for i, (name, count) in enumerate(ordered[:6])
    ]


def phase_a_extract_chart_styles(docs_by_ref: dict[str, Any]) -> list[RawChartStyle]:
    """One RawChartStyle per UNIQUE portable_hash across all source charts.
    Multiple bar charts with identical gridlines+legend+palette collapse
    to a single fragment."""
    by_hash: dict[str, RawChartStyle] = {}
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                if getattr(el, "element_type", None) != "BridgeChart":
                    continue
                style = _build_chart_style(el, ref_id, slide.slide_number)
                if not style: continue
                h = style.portable_hash()
                if h not in by_hash:
                    by_hash[h] = style
    return list(by_hash.values())


def phase_a_extract_table_styles(docs_by_ref: dict[str, Any]) -> list[RawTableStyle]:
    """Same as chart styles but for tables."""
    by_hash: dict[str, RawTableStyle] = {}
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                if getattr(el, "element_type", None) != "BridgeTable":
                    continue
                style = _build_table_style(el, ref_id, slide.slide_number)
                if not style: continue
                h = style.portable_hash()
                if h not in by_hash:
                    by_hash[h] = style
    return list(by_hash.values())


def phase_a_build_style_profile(docs_by_ref: dict[str, Any]) -> StyleProfile:
    return StyleProfile(
        palette=phase_a_extract_palette(docs_by_ref),
        fonts=phase_a_extract_fonts(docs_by_ref),
    )


# ── Phase A helpers ───────────────────────────────────────────────────────


def _first_text(el: Any) -> str:
    for run in _iter_runs(el):
        t = getattr(run, "text", None)
        if t: return t
    return ""


def _iter_runs(el: Any) -> Iterable[Any]:
    for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
        cursor = el
        for attr in path.split("."):
            cursor = getattr(cursor, attr, None)
            if cursor is None: break
        for para in (cursor or []):
            for run in (getattr(para, "runs", None) or []):
                yield run


def _hex(col: Any) -> str | None:
    """Best-effort ColorSpec → '#RRGGBB'. Returns None if not resolvable."""
    if col is None: return None
    for attr in ("value", "rgb", "hex"):
        v = getattr(col, attr, None)
        if isinstance(v, str) and v.startswith("#"):
            return v.upper()
    return None


def _build_chart_style(el: Any, ref_id: str, slide_n: int) -> RawChartStyle | None:
    """Extract a RawChartStyle from a BridgeChart. Returns None if the
    element has no usable fields."""
    chart_type = getattr(el, "chart_type", None)
    if not chart_type: return None

    style = RawChartStyle(
        chart_type=chart_type,
        source_ref=ref_id, source_slide_n=slide_n,
        source_chart_id=str(getattr(getattr(el, "identification", None), "shape_id", id(el))),
    )

    # Series palette — colors in first-series order
    palette: list[str] = []
    for s in (getattr(el, "series", None) or []):
        c = _hex(getattr(s, "color", None))
        if c: palette.append(c)
    style.series_palette = palette[:12]

    # Gridlines
    for axis_attr, target in (("category_axis", style.gridlines_major),
                               ("value_axis", style.gridlines_major)):
        axis = getattr(el, axis_attr, None)
        if not axis: continue
        gl = getattr(axis, "gridlines", None)
        if not gl: continue
        target.show = bool(getattr(gl, "has_major_gridlines", False))
        target.color = _hex(getattr(gl, "gridline_color", None)) or target.color
        target.weight = getattr(gl, "gridline_width", None) or target.weight
        target.dash = getattr(gl, "gridline_style", None) or target.dash

    # Legend
    leg = getattr(el, "legend", None)
    if leg:
        style.legend = LegendStyle(
            visible=bool(getattr(leg, "visible", True)),
            position=getattr(leg, "position", None),
            font_size=getattr(leg, "font_size", None),
            font_name=getattr(leg, "font_name", None),
            font_color=_hex(getattr(leg, "font_color", None)),
        )

    # Title
    title = getattr(el, "title", None)
    if title:
        style.title_typography = TitleTypography(
            text=getattr(title, "title", None),
            font_size=getattr(title, "title_font_size", None),
            font_name=getattr(title, "title_font_name", None),
            font_bold=getattr(title, "title_font_bold", None),
            font_color=_hex(getattr(title, "title_font_color", None)),
        )

    # Axis typography (use category axis as the canonical sample)
    cat_axis = getattr(el, "category_axis", None)
    if cat_axis:
        tl = getattr(cat_axis, "tick_labels", None)
        if tl:
            style.axis_typography = AxisTypography(
                font_size=getattr(tl, "tick_label_font_size", None),
                font_name=getattr(tl, "tick_label_font_name", None),
                font_color=_hex(getattr(tl, "tick_label_font_color", None)),
                tick_label_rotation=getattr(tl, "tick_label_rotation", None),
            )

    # Data labels — pull from first series if present
    series = getattr(el, "series", None) or []
    if series:
        dl = getattr(series[0], "data_labels", None)
        if dl:
            style.data_labels = DataLabelStyle(
                show=bool(getattr(dl, "show", False)),
                format=getattr(dl, "number_format", None),
                font_size=getattr(dl, "font_size", None),
                font_color=_hex(getattr(dl, "font_color", None)),
                position=getattr(dl, "position", None),
            )

    # Plot properties (type-specific bits)
    pp = getattr(el, "plot_properties", None)
    if pp:
        style.hole_size = getattr(pp, "hole_size", None)
        style.bar_width_ratio = getattr(pp, "bar_width_ratio", None)
        style.is_horizontal = getattr(pp, "is_horizontal", None)
        style.vary_colors = getattr(pp, "vary_colors", None)

    return style


def _build_table_style(el: Any, ref_id: str, slide_n: int) -> RawTableStyle | None:
    tp = getattr(el, "table_properties", None)
    if not tp: return None

    style = RawTableStyle(
        source_ref=ref_id, source_slide_n=slide_n,
        source_table_id=str(getattr(getattr(el, "identification", None), "shape_id", id(el))),
        banded_rows=bool(getattr(tp, "banded_rows", False)),
        first_col_header=bool(getattr(tp, "first_col_header", False)),
    )

    # Header row style — first row's first cell as a representative sample
    cell_formats = getattr(el, "cell_formats", None) or []
    if cell_formats and cell_formats[0]:
        cell = cell_formats[0][0]
        style.header_row_style = CellStyle(
            fill_color=_hex(getattr(cell, "fill_color", None)),
            font_color=_hex(getattr(cell, "font_color", None)),
            font_name=getattr(cell, "font_name", None),
            font_size=getattr(cell, "font_size", None),
            font_bold=getattr(cell, "font_bold", None),
            h_align=getattr(cell, "h_align", None),
            v_align=getattr(cell, "v_align", None),
        )
    return style


# ── Phase B — semantic enrichment (7 LLM calls per cluster) ──────────────


def _serialize_cluster_for_llm(cluster: SlideCluster, max_members: int = 5) -> dict[str, Any]:
    """Compact slide summary the LLM sees. Strips images, big blobs."""
    proto = cluster.prototype.slide
    proto_elements = []
    for i, el in enumerate(getattr(proto, "elements", None) or []):
        pos = getattr(el, "position", None)
        text = _first_text(el)[:120]
        et = getattr(el, "element_type", el.__class__.__name__)
        proto_elements.append({
            "idx": i,
            "type": et,
            "pos": [round(pos.left, 2), round(pos.top, 2),
                    round(pos.width, 2), round(pos.height, 2)] if pos else None,
            "text": text or None,
            "has_fill": bool(getattr(getattr(el, "fill", None), "color", None) and
                             getattr(getattr(getattr(el, "fill", None), "color", None), "value", None)),
            "chart_type": getattr(el, "chart_type", None),
        })
    member_text_samples: list[list[str]] = []
    for m in cluster.members[:max_members]:
        sample = []
        for el in (getattr(m.slide, "elements", None) or [])[:8]:
            t = _first_text(el)
            if t: sample.append(t[:120])
        member_text_samples.append(sample)
    return {
        "cluster_size": cluster.size,
        "element_count": cluster.fingerprint.element_count,
        "prototype": proto_elements,
        "member_text_samples": member_text_samples,
    }


# ── B1. Intent — one sentence ────


_B1_INTENT_SYSTEM = """\
You see a slide layout that appears N times across one or more decks.
What is this slide DOING in the deck? Answer in ONE sentence, using
the verb of the action (showcases / introduces / compares / closes /
divides / lists / explains / quotes / etc.).

Respond with one JSON object, no prose, no fences:

{
  "intent": "<one sentence>",
  "confidence": 0.0 to 1.0
}
"""


def phase_b_01_intent(
    *, cluster: SlideCluster,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> SemanticIntent:
    summary = _serialize_cluster_for_llm(cluster)
    user = json.dumps(summary, ensure_ascii=False, default=str)[:12000]
    return _call_llm_typed(
        system=_B1_INTENT_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B1.intent",
        parse=lambda d: SemanticIntent(
            intent=str(d.get("intent") or "")[:300],
            confidence=float(d.get("confidence") or 0.7),
        ),
    )


# ── B2. Slot taxonomy ────


_B2_SLOT_SYSTEM = f"""\
Given the slide's intent (one sentence), pick the canonical slot type
from this fixed vocabulary:

  cover           — title page / brand intro
  divider         — section break
  hero_metric     — single big number, focused
  kpi_grid        — multiple KPIs side-by-side
  chart           — chart-led slide
  table           — table-led slide
  narrative       — paragraphs of explanatory text
  comparison      — two- or three-column compare
  bulleted_list   — list of items / takeaways
  quote           — pull quote with attribution
  image_lead      — image dominant
  agenda          — agenda / sections list
  close           — thank you / contact / closing

Respond with one JSON object, no prose, no fences:

{{
  "slot": "one of {', '.join(SLOT_TAXONOMY)}",
  "rationale": "<one short clause>"
}}
"""


def phase_b_02_slot(
    *, intent: SemanticIntent,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> SlotAssignment:
    user = json.dumps({"intent": intent.intent}, ensure_ascii=False)
    def _parse(d: dict) -> SlotAssignment:
        slot = str(d.get("slot") or "").lower().strip()
        if slot not in SLOT_TAXONOMY:
            slot = "narrative"  # safe fallback
        return SlotAssignment(slot=slot, rationale=str(d.get("rationale") or "")[:140])
    return _call_llm_typed(
        system=_B2_SLOT_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B2.slot", parse=_parse,
    )


# ── B3. Element role assignment ────


_B3_ROLES_SYSTEM = f"""\
You see the prototype slide's elements (numbered by index). Assign
ONE role to each from this fixed vocabulary:

  title             — primary headline
  subtitle          — secondary headline below the title
  kicker            — small eyebrow label above the title
  hero_number       — the dominant number on a hero_metric slide
  body              — paragraph text
  bullet_item       — one entry in a bulleted list
  caption           — short explanatory text next to a chart/image
  footer            — slide footer (page numbers, recurring text)
  source_citation   — "Source: ..." attribution
  logo              — brand mark (often top-left or top-right)
  decorative        — visual flourish (lines, accents)
  background        — full-slide background rect
  chart             — chart element
  table             — table element
  image             — image element

Notes:
  * Each element gets exactly one role. Default to `decorative` for
    pure visuals with no content semantic.
  * Same role can repeat (3 KPI tiles will each have a hero_number).
  * Slide's intent is provided for context.

Respond with one JSON object, no prose, no fences:

{{
  "roles": {{ "0": "title", "1": "kicker", ... }},
  "rationale": "<one short clause>"
}}
"""


def phase_b_03_element_roles(
    *, cluster: SlideCluster, intent: SemanticIntent, slot: SlotAssignment,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> ElementRoleMap:
    summary = _serialize_cluster_for_llm(cluster)
    user = json.dumps({
        "intent": intent.intent, "slot": slot.slot,
        "elements": summary["prototype"],
    }, ensure_ascii=False, default=str)[:12000]
    def _parse(d: dict) -> ElementRoleMap:
        raw = d.get("roles") or {}
        roles: dict[int, str] = {}
        for k, v in raw.items():
            try:
                idx = int(k)
            except (ValueError, TypeError):
                continue
            role = str(v or "").lower().strip()
            if role in ELEMENT_ROLES:
                roles[idx] = role
        return ElementRoleMap(roles=roles, rationale=str(d.get("rationale") or "")[:160])
    return _call_llm_typed(
        system=_B3_ROLES_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B3.element_roles", parse=_parse,
    )


# ── B4. Variable identification (one call per content-bearing element) ────


_B4_VARIABLE_SYSTEM = """\
Across N members of the same template cluster, this element appears
with these text values. Decide:

  * Does the text vary across members? If all members have the same
    text, it's brand-fixed (e.g. a recurring footer).
  * If it varies, what's the underlying input it represents?
    Prefer a concrete, descriptive name (e.g. `hero_number`,
    `quarter_label`, `kpi_value`) over generic ones.
  * Type: string / number / list / bool.

Respond with one JSON object, no prose, no fences:

{
  "varies": true | false,
  "input_name": "<short snake_case>",
  "input_type": "string" | "number" | "list" | "bool",
  "reasoning": "<one short clause>"
}
"""


def phase_b_04_variables(
    *, cluster: SlideCluster, roles: ElementRoleMap, intent: SemanticIntent,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> list[VariableSpec]:
    """One LLM call per element WITH text that's role-content. Background /
    decorative / logo elements skipped — they're brand-fixed by definition."""
    proto = cluster.prototype.slide
    members = cluster.members

    content_roles = {"title", "subtitle", "kicker", "hero_number",
                     "body", "bullet_item", "caption", "source_citation"}

    out: list[VariableSpec] = []
    for i, el in enumerate(getattr(proto, "elements", None) or []):
        role = roles.roles.get(i, "decorative")
        if role not in content_roles:
            continue

        # Sample this element's text across all members. Match by index
        # which is reasonable for same-fingerprint slides.
        samples: list[str] = []
        for m in members[:8]:
            els = getattr(m.slide, "elements", None) or []
            if i < len(els):
                t = _first_text(els[i])
                if t: samples.append(t[:200])

        # If all samples are identical, no LLM call needed — it's fixed.
        unique = set(samples)
        if len(unique) <= 1 and len(samples) >= 2:
            out.append(VariableSpec(
                element_idx=i, varies=False,
                input_name=f"{role}_text", input_type="string",
                samples=samples[:3], reasoning="constant across cluster members",
            ))
            continue

        user = json.dumps({
            "intent": intent.intent, "role": role,
            "samples": samples[:8],
        }, ensure_ascii=False, default=str)[:6000]
        try:
            spec = _call_llm_typed(
                system=_B4_VARIABLE_SYSTEM, user=user,
                llm_call=llm_call, provenance=provenance,
                phase=f"B4.variable[el={i}]",
                parse=lambda d: VariableSpec(
                    element_idx=i,
                    varies=bool(d.get("varies", True)),
                    input_name=str(d.get("input_name") or f"{role}_text")[:40],
                    input_type=str(d.get("input_type") or "string"),
                    samples=samples[:5],
                    reasoning=str(d.get("reasoning") or "")[:160],
                ),
            )
            out.append(spec)
        except Exception as exc:
            # On LLM failure, fall back to role-based defaults — better
            # to have a workable input than skip the element entirely.
            log.warning("B4 fallback for element %d (%s): %s", i, role, exc)
            out.append(VariableSpec(
                element_idx=i, varies=True,
                input_name=f"{role}_text", input_type="string",
                samples=samples[:3], reasoning="LLM call failed; using role default",
            ))
    return out


# ── B5. Naming — three candidates, pick best ────


_B5_NAMES_SYSTEM = """\
Suggest three short names for this template. Each:
  * ≤ 5 words
  * Action-oriented (a designer would say "use the X template to ...")
  * Distinct from each other in nuance
  * Title Case

Respond with one JSON object, no prose, no fences:

{
  "candidates": ["Name One", "Name Two", "Name Three"],
  "chosen": "<the best of the three>",
  "rationale": "<why the chosen one wins, one short clause>"
}
"""


def phase_b_05_name(
    *, intent: SemanticIntent, slot: SlotAssignment, roles: ElementRoleMap,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> NameCandidates:
    user = json.dumps({
        "intent": intent.intent, "slot": slot.slot,
        "role_summary": {r: 1 for r in roles.roles.values()},
    }, ensure_ascii=False)
    def _parse(d: dict) -> NameCandidates:
        candidates = [str(c)[:80] for c in (d.get("candidates") or [])[:3]]
        chosen = str(d.get("chosen") or (candidates[0] if candidates else "Slide Layout"))[:80]
        if chosen not in candidates and candidates:
            chosen = candidates[0]
        return NameCandidates(candidates=candidates, chosen=chosen)
    return _call_llm_typed(
        system=_B5_NAMES_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B5.names", parse=_parse,
    )


# ── B6. Description ────


_B6_DESCRIPTION_SYSTEM = """\
Produce metadata for this template so downstream LLM passes can
reason about it without re-seeing the source slides. FOUR fields:

  short_description  — ≤ 140 chars. Browse-the-card-style summary.
                        Describes what the template DOES, not what
                        it looks like. Skip filler ("This template
                        is...").

  long_description   — 2-4 sentences. Full context: what the slide
                        is for, what content goes in it, what
                        problem it solves for a presenter, the
                        emotional / persuasive job it does in a
                        deck. Written for an LLM agent that's
                        deciding whether to pick this template for
                        a specific slot. Be concrete.

  use_when           — One short clause listing 2-3 concrete fits.
                        E.g. "the slide's one job is a single
                        headline number; you have a kicker label
                        and a one-line supporting context."

  avoid_when         — One short clause listing 2-3 concrete misfits.
                        E.g. "comparing two or more metrics side by
                        side; explaining a process or methodology."

Respond with one JSON object, no prose, no fences:

{
  "short_description": "...",
  "long_description": "...",
  "use_when": "...",
  "avoid_when": "..."
}
"""


def phase_b_06_description(
    *, name: NameCandidates, intent: SemanticIntent, slot: SlotAssignment,
    variables: list[VariableSpec],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> TemplateDescription:
    user = json.dumps({
        "name": name.chosen, "intent": intent.intent, "slot": slot.slot,
        "varying_inputs": [v.input_name for v in variables if v.varies][:8],
    }, ensure_ascii=False)
    def _parse(d: dict) -> TemplateDescription:
        short = str(d.get("short_description") or "")[:200]
        return TemplateDescription(
            description=short,            # legacy alias
            short_description=short,
            long_description=str(d.get("long_description") or "")[:1200],
            use_when=str(d.get("use_when") or "")[:300],
            avoid_when=str(d.get("avoid_when") or "")[:300],
        )
    return _call_llm_typed(
        system=_B6_DESCRIPTION_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B6.description", parse=_parse,
    )


# ── B7. Tag assignment from controlled vocab ────


_B7_TAGS_SYSTEM = f"""\
Pick 3-6 tags from this fixed vocabulary that best describe this
template:

  {", ".join(TAG_VOCAB)}

Respond with one JSON object, no prose, no fences:

{{
  "tags": ["tag1", "tag2", "tag3"]
}}
"""


def phase_b_07_tags(
    *, slot: SlotAssignment, intent: SemanticIntent,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> TagAssignment:
    user = json.dumps({"slot": slot.slot, "intent": intent.intent},
                       ensure_ascii=False)
    def _parse(d: dict) -> TagAssignment:
        raw = d.get("tags") or []
        tags = []
        for t in raw:
            t = str(t or "").lower().strip()
            if t in TAG_VOCAB and t not in tags:
                tags.append(t)
            if len(tags) >= 6: break
        return TagAssignment(tags=tags)
    return _call_llm_typed(
        system=_B7_TAGS_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="B7.tags", parse=_parse,
    )


# ── Phase B orchestrator ─────────────────────────────────────────────────


def phase_b_enrich_cluster(
    cluster: SlideCluster,
    *,
    llm_call: Callable[[str, str], str],
    provenance: ProvenanceLogger,
) -> EnrichedCluster | None:
    """Run all 7 Phase B calls for one cluster. Each call's output feeds
    the next. Returns None if a critical call fails (B1, B2, or B3)."""
    try:
        intent = phase_b_01_intent(
            cluster=cluster, llm_call=llm_call, provenance=provenance,
        )
    except Exception as exc:
        log.warning("Phase B aborted for cluster: B1 failed: %s", exc)
        return None
    try:
        slot = phase_b_02_slot(
            intent=intent, llm_call=llm_call, provenance=provenance,
        )
    except Exception:
        slot = SlotAssignment(slot="narrative", rationale="B2 fallback")
    try:
        roles = phase_b_03_element_roles(
            cluster=cluster, intent=intent, slot=slot,
            llm_call=llm_call, provenance=provenance,
        )
    except Exception as exc:
        log.warning("Phase B aborted for cluster: B3 failed: %s", exc)
        return None
    # Variable identification (one LLM call PER content element — can be
    # several calls per cluster).
    variables = phase_b_04_variables(
        cluster=cluster, roles=roles, intent=intent,
        llm_call=llm_call, provenance=provenance,
    )
    try:
        name = phase_b_05_name(
            intent=intent, slot=slot, roles=roles,
            llm_call=llm_call, provenance=provenance,
        )
    except Exception:
        name = NameCandidates(candidates=["Slide Layout"], chosen="Slide Layout")
    try:
        description = phase_b_06_description(
            name=name, intent=intent, slot=slot, variables=variables,
            llm_call=llm_call, provenance=provenance,
        )
    except Exception:
        description = TemplateDescription(description="")
    try:
        tags = phase_b_07_tags(
            slot=slot, intent=intent,
            llm_call=llm_call, provenance=provenance,
        )
    except Exception:
        tags = TagAssignment(tags=[slot.slot])
    return EnrichedCluster(
        cluster=cluster, intent=intent, slot=slot, roles=roles,
        variables=variables, name=name, description=description, tags=tags,
    )


# ── Phase C — style fragment characterization + cross-type base templates


# Chart types we'll synthesize base templates for. Each brand gets all of
# these, even if their source deck only had column charts.
CROSS_POLLINATION_CHART_TYPES = (
    "column_clustered", "bar_clustered", "line", "area_stacked",
    "pie", "doughnut",
)

# Table use patterns we'll synthesize. Differ in:
#   - row count + density
#   - which row/col is header
#   - column ratios
CROSS_POLLINATION_TABLE_USES = (
    "agenda",         # vertical list: agenda item + description per row
    "kpi_grid",       # numbers in cells; first row labels each KPI
    "comparison",     # two-or-three column compare; first col is label
    "data_dump",      # 6+ col data table with full header row
)


# ── C1. Characterize a chart style ────


_C1_CHART_CHARACTERIZE_SYSTEM = """\
You see a chart's visual style — gridlines, legend, palette, axis
typography, data labels. Describe it as a designer would in one
sentence. Mention what makes it distinctive (e.g. "light cyan series
on near-invisible gridlines, no chart title").

Also tag the design signals — short adjectives a downstream agent
can use to match the style to chart-type stubs.

Respond with one JSON object, no prose, no fences:

{
  "summary": "<one sentence>",
  "design_signals": ["minimal", "data-forward", "cool palette", ...]
}
"""


def phase_c_01_characterize_chart_style(
    *, raw: RawChartStyle,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> StyleFragmentCharacterization:
    user = json.dumps({
        "series_palette": raw.series_palette,
        "gridlines_major": asdict(raw.gridlines_major),
        "legend": asdict(raw.legend),
        "title_typography": asdict(raw.title_typography),
        "axis_typography": asdict(raw.axis_typography),
        "data_labels": asdict(raw.data_labels),
        "plot_area": asdict(raw.plot_area),
        "source_chart_type": raw.chart_type,
    }, ensure_ascii=False, default=str)[:6000]
    def _parse(d: dict) -> StyleFragmentCharacterization:
        return StyleFragmentCharacterization(
            summary=str(d.get("summary") or "")[:300],
            design_signals=[str(s)[:40] for s in (d.get("design_signals") or [])[:8]],
        )
    return _call_llm_typed(
        system=_C1_CHART_CHARACTERIZE_SYSTEM, user=user,
        llm_call=llm_call, provenance=provenance,
        phase="C1.chart_characterize", parse=_parse,
    )


def phase_c_01_characterize_table_style(
    *, raw: RawTableStyle,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> StyleFragmentCharacterization:
    user = json.dumps({
        "header_row_style": asdict(raw.header_row_style),
        "banded_rows": raw.banded_rows,
        "band_a": raw.band_a, "band_b": raw.band_b,
        "border_style": asdict(raw.border_style),
        "default_font": asdict(raw.default_font),
        "header_text_align": raw.header_text_align,
        "first_col_header": raw.first_col_header,
    }, ensure_ascii=False, default=str)[:4000]
    return _call_llm_typed(
        system=_C1_CHART_CHARACTERIZE_SYSTEM.replace("chart", "table"),
        user=user, llm_call=llm_call, provenance=provenance,
        phase="C1.table_characterize",
        parse=lambda d: StyleFragmentCharacterization(
            summary=str(d.get("summary") or "")[:300],
            design_signals=[str(s)[:40] for s in (d.get("design_signals") or [])[:8]],
        ),
    )


# ── C3. Build base templates per chart type, applying the style ────
# These are programmatic — no LLM. Each base is a hand-crafted layout
# skeleton for its chart type, and we MERGE the style's portable fields
# into it.


def _base_chart_template(
    chart_type: str, style: RawChartStyle, style_summary: str,
    width_in: float = 13.333, height_in: float = 7.5,
) -> dict:
    """Hand-crafted layout for a chart of `chart_type` styled with the
    brand's portable formatting. Position uses ~80% of the slide,
    centered. Title above, chart below — same as Percy Standard."""
    alias = "chart"
    margin = 0.5
    title_h = 0.9
    chart_top = margin + title_h + 0.1
    chart_h = height_in - chart_top - margin
    chart_w = width_in - 2 * margin

    chart_body: dict[str, Any] = {
        "chart_type": chart_type,
        "categories": "{{" + alias + "_categories}}",
        "series": "{{" + alias + "_series}}",
        "position": {
            "left_in":   "{{" + alias + "_left}}",
            "top_in":    "{{" + alias + "_top}}",
            "width_in":  "{{" + alias + "_width}}",
            "height_in": "{{" + alias + "_height}}",
        },
        "name": f"{chart_type} chart",
    }
    # Portable style — baked in (NOT parameterized) so the brand stays
    # on-brand regardless of what the agent provides at apply time.
    if style.legend.visible is not None:
        chart_body["legend"] = {
            "visible": style.legend.visible,
            "position": (style.legend.position or "BOTTOM").lower(),
        }
    if style.gridlines_major.show is not None:
        chart_body["category_axis"] = {
            "gridlines": bool(style.gridlines_major.show),
            "gridline_color": style.gridlines_major.color,
        }
        chart_body["value_axis"] = {
            "gridlines": bool(style.gridlines_major.show),
            "gridline_color": style.gridlines_major.color,
        }
    # Type-specific extras
    if chart_type == "doughnut":
        chart_body["hole_size"] = style.hole_size if style.hole_size else 50
    if chart_type == "bar_clustered":
        chart_body["bar_width_ratio"] = style.bar_width_ratio if style.bar_width_ratio else 0.75
    if chart_type in ("pie", "doughnut"):
        chart_body["vary_colors"] = True

    layout = [
        # Title shape
        {
            "kind": "shape", "alias": "title",
            "body": {
                "geometry_preset": "rect",
                "text_box": True,
                "text": "{{title_text}}",
                "position": {
                    "left_in":   "{{title_left}}",
                    "top_in":    "{{title_top}}",
                    "width_in":  "{{title_width}}",
                    "height_in": "{{title_height}}",
                },
                "name": "Title",
            },
        },
        {
            "kind": "chart", "alias": alias,
            "body": chart_body,
        },
    ]
    # Inputs schema — uses the standard naming conventions.
    inputs_schema = {
        # Title
        "title_text":        {"type": "string",  "required": False, "default": "Chart title", "description": "Slide title"},
        "title_left":        {"type": "number",  "required": False, "default": margin, "description": "Title left (in)"},
        "title_top":         {"type": "number",  "required": False, "default": margin, "description": "Title top (in)"},
        "title_width":       {"type": "number",  "required": False, "default": width_in - 2 * margin, "description": "Title width (in)"},
        "title_height":      {"type": "number",  "required": False, "default": title_h, "description": "Title height (in)"},
        # Chart
        f"{alias}_categories": {"type": "list",  "required": False, "default": ["A", "B", "C", "D"],
                                "description": "X-axis labels"},
        f"{alias}_series":     {"type": "list",  "required": False, "default": [{"name": "Series 1", "values": [1, 2, 3, 4]}],
                                "description": "Chart series — list of {name, values, color?}"},
        f"{alias}_left":       {"type": "number","required": False, "default": margin},
        f"{alias}_top":        {"type": "number","required": False, "default": chart_top},
        f"{alias}_width":      {"type": "number","required": False, "default": chart_w},
        f"{alias}_height":     {"type": "number","required": False, "default": chart_h},
    }
    return {
        "name": f"{chart_type.replace('_', ' ').title()} Chart",
        "description": (style_summary or "Cross-pollinated chart template")[:200],
        "tags": ["chart", "data", "cross_pollinated"],
        "inputs_schema": inputs_schema,
        "layout": layout,
        "provenance": {
            "synthesized": True,
            "source_chart_type": style.chart_type,
            "source_ref": style.source_ref,
            "portable_hash": style.portable_hash(),
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3],
            "transform_strategy": "proportional_scale",
        },
    }


def _base_table_template(
    use: str, style: RawTableStyle, style_summary: str,
    width_in: float = 13.333, height_in: float = 7.5,
) -> dict:
    """Hand-crafted base layouts for the 4 canonical table uses."""
    alias = "table"
    margin = 0.5
    title_h = 0.9

    # Sane default data + dimensions per use
    if use == "agenda":
        default_data = [
            ["Agenda Item", "Description"],
            ["Item one", "Description for the first agenda item"],
            ["Item two", "Description for the second agenda item"],
            ["Item three", "Description for the third agenda item"],
            ["Item four", "Description for the fourth agenda item"],
        ]
        col_widths = [4.0, 8.0]
    elif use == "kpi_grid":
        default_data = [
            ["KPI",        "Value", "Δ"],
            ["Revenue",    "$2.4M", "+18%"],
            ["Margin",     "42%",   "+3 pts"],
            ["NPS",        "62",    "+5"],
        ]
        col_widths = [4.0, 4.0, 4.0]
    elif use == "comparison":
        default_data = [
            ["Aspect",  "Before",     "After"],
            ["Metric 1", "$1.0M",     "$2.4M"],
            ["Metric 2", "30%",       "42%"],
            ["Metric 3", "Slow",      "Fast"],
        ]
        col_widths = [4.0, 4.0, 4.0]
    else:  # data_dump
        default_data = [
            ["Date", "Region", "Product", "Units", "Revenue", "Margin"],
            ["2025-01", "NA", "A", "1200", "$240k", "38%"],
            ["2025-01", "EU", "A", "850",  "$170k", "41%"],
            ["2025-02", "NA", "A", "1340", "$268k", "39%"],
            ["2025-02", "EU", "B", "720",  "$144k", "37%"],
            ["2025-03", "NA", "B", "1100", "$220k", "40%"],
        ]
        col_widths = [2.0, 1.5, 1.5, 1.5, 2.5, 2.5]

    table_h = height_in - margin * 2 - title_h - 0.2

    layout = [
        # Title shape
        {
            "kind": "shape", "alias": "title",
            "body": {
                "geometry_preset": "rect", "text_box": True,
                "text": "{{title_text}}",
                "position": {
                    "left_in":   "{{title_left}}",
                    "top_in":    "{{title_top}}",
                    "width_in":  "{{title_width}}",
                    "height_in": "{{title_height}}",
                },
                "name": "Title",
            },
        },
        {
            "kind": "table", "alias": alias,
            "body": {
                "data": "{{" + alias + "_data}}",
                "first_row_header": "{{" + alias + "_first_row_header}}",
                "first_col_header": "{{" + alias + "_first_col_header}}",
                "banded_rows": "{{" + alias + "_banded_rows}}",
                "column_widths": col_widths,
                "position": {
                    "left_in":   "{{" + alias + "_left}}",
                    "top_in":    "{{" + alias + "_top}}",
                    "width_in":  "{{" + alias + "_width}}",
                    "height_in": "{{" + alias + "_height}}",
                },
                "name": f"{use} table",
            },
        },
    ]
    inputs_schema = {
        "title_text":   {"type": "string",  "default": f"{use.replace('_', ' ').title()}"},
        "title_left":   {"type": "number",  "default": margin},
        "title_top":    {"type": "number",  "default": margin},
        "title_width":  {"type": "number",  "default": width_in - 2 * margin},
        "title_height": {"type": "number",  "default": title_h},
        f"{alias}_data": {"type": "list", "default": default_data,
                          "description": "Table cells (rows x cols)"},
        f"{alias}_first_row_header": {"type": "bool", "default": True},
        f"{alias}_first_col_header": {"type": "bool", "default": (use == "comparison")},
        f"{alias}_banded_rows":      {"type": "bool", "default": bool(style.banded_rows)},
        f"{alias}_left":   {"type": "number", "default": margin},
        f"{alias}_top":    {"type": "number", "default": margin + title_h + 0.2},
        f"{alias}_width":  {"type": "number", "default": width_in - 2 * margin},
        f"{alias}_height": {"type": "number", "default": table_h},
    }
    return {
        "name": f"{use.replace('_', ' ').title()} Table",
        "description": (style_summary or f"Cross-pollinated {use} table template")[:200],
        "tags": ["table", "data", "cross_pollinated", use],
        "inputs_schema": inputs_schema,
        "layout": layout,
        "provenance": {
            "synthesized": True,
            "table_use": use,
            "source_ref": style.source_ref,
            "portable_hash": style.portable_hash(),
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3],
            "transform_strategy": "proportional_scale",
        },
    }


def phase_c_cross_pollinate_chart(
    raw: RawChartStyle,
    *,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> ValidatedChartStyle:
    """Characterize one chart style, build base templates for every
    chart type in CROSS_POLLINATION_CHART_TYPES."""
    try:
        chars = phase_c_01_characterize_chart_style(
            raw=raw, llm_call=llm_call, provenance=provenance,
        )
    except Exception as exc:
        log.warning("C1 chart characterize failed: %s — using defaults", exc)
        chars = StyleFragmentCharacterization(
            summary="Chart with brand styling",
            design_signals=[],
        )
    base_templates: dict[str, dict] = {}
    for ct in CROSS_POLLINATION_CHART_TYPES:
        base_templates[ct] = _base_chart_template(ct, raw, chars.summary)
    return ValidatedChartStyle(
        raw=raw, characterization=chars,
        validation_results=[],   # filled in by Phase D's render+critique loop
        base_templates=base_templates,
    )


def phase_c_cross_pollinate_table(
    raw: RawTableStyle,
    *,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> ValidatedTableStyle:
    try:
        chars = phase_c_01_characterize_table_style(
            raw=raw, llm_call=llm_call, provenance=provenance,
        )
    except Exception as exc:
        log.warning("C1 table characterize failed: %s — using defaults", exc)
        chars = StyleFragmentCharacterization(
            summary="Table with brand styling", design_signals=[],
        )
    base_templates: dict[str, dict] = {}
    for use in CROSS_POLLINATION_TABLE_USES:
        base_templates[use] = _base_table_template(use, raw, chars.summary)
    return ValidatedTableStyle(
        raw=raw, characterization=chars,
        validation_results=[], base_templates=base_templates,
    )


# ── Phase D — render + vision-critique + surgical refinement loop ────────


def _substitute_inputs(layout: list[dict], inputs: dict[str, Any]) -> list[dict]:
    """Walk layout, replace {{var}} references with inputs values. Same
    semantics as the production templates._substitute. Returns a deep
    copy so the original isn't mutated."""
    import copy
    layout = copy.deepcopy(layout)
    pat_lone = re.compile(r"^\s*\{\{\s*([A-Za-z_]\w*)\s*\}\}\s*$")
    pat_any = re.compile(r"\{\{\s*([A-Za-z_]\w*)\s*\}\}")

    def sub(v: Any) -> Any:
        if isinstance(v, str):
            m = pat_lone.match(v)
            if m:
                key = m.group(1)
                return inputs.get(key, "")
            return pat_any.sub(lambda mm: str(inputs.get(mm.group(1), "")), v)
        if isinstance(v, dict):
            return {k: sub(x) for k, x in v.items()}
        if isinstance(v, list):
            return [sub(x) for x in v]
        return v
    return sub(layout)


def _layout_to_render_elements(layout: list[dict]) -> list[dict]:
    """Convert a substituted layout into the SVG-renderer's element shape
    (slide_critic.render_slide_to_svg's contract). Just type + position
    + text_runs + fill, enough for visual critique."""
    out: list[dict] = []
    for entry in layout:
        kind = entry.get("kind") or ""
        body = entry.get("body") or {}
        pos  = body.get("position") or {}
        type_map = {
            "shape": "BridgeShape", "text": "BridgeText",
            "chart": "BridgeChart", "table": "BridgeTable",
            "freeform": "BridgeFreeform", "connector": "BridgeConnector",
            "image-typed": "BridgeImage",
        }
        rec: dict[str, Any] = {
            "type": type_map.get(kind, "BridgeShape"),
            "position": {
                "left_in":   float(pos.get("left_in", 0) or 0),
                "top_in":    float(pos.get("top_in", 0) or 0),
                "width_in":  float(pos.get("width_in", 0) or 0),
                "height_in": float(pos.get("height_in", 0) or 0),
            },
        }
        # Fill
        fc = body.get("fill_color")
        if fc: rec["fill"] = {"color": str(fc)}
        # Text — either body.text (string) or body.text_runs
        text = body.get("text")
        runs = body.get("text_runs")
        if isinstance(runs, list) and runs:
            rec["text_runs"] = [
                {"text": str(r.get("text", "")),
                 "font_size": r.get("font_size"),
                 "color": r.get("font_color") or r.get("color")}
                for r in runs if isinstance(r, dict)
            ]
        elif isinstance(text, str) and text:
            rec["text_runs"] = [{"text": text}]
        # Chart
        if rec["type"] == "BridgeChart":
            rec["chart_type"] = body.get("chart_type", "column_clustered")
            cats = body.get("categories", [])
            if isinstance(cats, list): rec["chart_categories"] = [str(c) for c in cats][:12]
            series = body.get("series", [])
            if isinstance(series, list):
                rec["chart_series_count"] = len(series)
        # Table
        if rec["type"] == "BridgeTable":
            data = body.get("data", [])
            if isinstance(data, list):
                rec["table_dim"] = [len(data), len(data[0]) if data else 0]
        out.append(rec)
    return out


# Edge-case input generators


def _edge_long_text(default_inputs: dict[str, Any]) -> dict[str, Any]:
    """Replace every string default with a 1.5x-longer version."""
    out = dict(default_inputs)
    for k, v in list(out.items()):
        if isinstance(v, str):
            # Use the same wording style, just longer to stress-test wrap
            if "_text" in k or k.endswith("_title") or k == "title_text":
                out[k] = (v + " " + v + " more context.")[:240]
    return out


def _edge_short_text(default_inputs: dict[str, Any]) -> dict[str, Any]:
    """One-word substitute for every string default."""
    out = dict(default_inputs)
    for k, v in list(out.items()):
        if isinstance(v, str) and "_text" in k:
            out[k] = v.split()[0] if v.split() else "Hi"
    return out


def _edge_multi_series(default_inputs: dict[str, Any]) -> dict[str, Any]:
    """For chart inputs, blow up to 6 series. Catches legend overflow."""
    out = dict(default_inputs)
    for k, v in list(out.items()):
        if k.endswith("_series") and isinstance(v, list):
            base = v[0] if v else {"name": "Series 1", "values": [1, 2, 3, 4]}
            out[k] = [
                {"name": f"Series {i+1}",
                 "values": [(i + 1) * x for x in range(1, 5)]}
                for i in range(6)
            ]
    return out


def _default_inputs(template: dict) -> dict[str, Any]:
    """Pull `default` from each entry in inputs_schema, with sensible
    fallbacks for missing defaults."""
    out: dict[str, Any] = {}
    for k, spec in (template.get("inputs_schema") or {}).items():
        if isinstance(spec, dict) and "default" in spec:
            out[k] = spec["default"]
        else:
            out[k] = ""
    return out


# Vision critique — reuses slide_critic.critique_slide


def _critique_one_render(
    template: dict, inputs_label: str, inputs: dict[str, Any],
    *, llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> VisionCritique:
    """Substitute → render → critique. One LLM call (the vision pass)."""
    from percy.agent.slide_critic import critique_slide
    substituted = _substitute_inputs(template["layout"], inputs)
    elements = _layout_to_render_elements(substituted)
    instruction = (
        f"Template '{template.get('name','')}': "
        f"{template.get('description','')}. Inputs: {inputs_label}."
    )
    t0 = time.time()
    try:
        critique = critique_slide(
            slide_elements=elements, instruction=instruction,
            llm_call=llm_call,
        )
    except Exception as exc:
        log.warning("D3 critique failed (%s): %s", inputs_label, exc)
        critique = None
    duration = int((time.time() - t0) * 1000)
    if critique is None:
        # Record a no-op call so provenance tracks the attempt
        provenance.record(
            phase=f"D3.critique[{inputs_label}]",
            system_prompt="(critique_slide internal prompt)",
            user_input=instruction, raw_output="", parsed_output={},
            model="vision", duration_ms=duration, error="critique_slide raised",
        )
        return VisionCritique(
            inputs_label=inputs_label,
            scores={"overflow": 0, "collision": 0, "readability": 2, "brand": 2},
            issues=["critique failed"], overall="fair",
        )
    # critique_slide doesn't return scored axes; map quality → coarse scores.
    q = critique.overall_quality
    score_val = {"good": 3, "fair": 2, "poor": 1}.get(q, 1)
    issues_strs = [iss.description for iss in (critique.issues or [])]
    provenance.record(
        phase=f"D3.critique[{inputs_label}]",
        system_prompt="(critique_slide internal prompt)",
        user_input=instruction,
        raw_output=critique.raw or "",
        parsed_output=critique.to_dict(),
        model="vision", duration_ms=duration,
    )
    return VisionCritique(
        inputs_label=inputs_label,
        scores={"overflow": score_val, "collision": score_val,
                "readability": score_val, "brand": score_val},
        issues=issues_strs[:8],
        overall=("pass" if q == "good" else "fair" if q == "fair" else "fail"),
    )


# D4 — surgical refinement


_D4_SURGEON_SYSTEM = """\
A template was rendered and a vision critic flagged these issues.
Propose specific, MINIMAL patches to the template's inputs_schema
defaults or layout values. Don't change the layout STRUCTURE — just
tune sizes / autofits / paddings / default text lengths.

Each patch:
  * path: dotted JSON path within the template
    (e.g. "layout[0].body.position.height_in",
          "inputs_schema.title_height.default")
  * new_value: the new value

Only propose patches that directly fix the cited issues. Don't
guess. If the issues are unfixable without restructuring, return
an empty patches list.

Respond with one JSON object, no prose, no fences:

{
  "patches": [
    {"path": "...", "new_value": ...},
    ...
  ]
}
"""


def phase_d_04_surgeon(
    *, template: dict, issues: list[str],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> list[TemplatePatch]:
    user = json.dumps({
        "template_name": template.get("name", ""),
        "inputs_schema_keys": list((template.get("inputs_schema") or {}).keys()),
        "layout_element_count": len(template.get("layout") or []),
        "issues": issues,
    }, ensure_ascii=False, default=str)[:6000]
    def _parse(d: dict) -> list[TemplatePatch]:
        raw = d.get("patches") or []
        out: list[TemplatePatch] = []
        for p in raw[:6]:
            if not isinstance(p, dict): continue
            path = str(p.get("path") or "").strip()
            if not path: continue
            out.append(TemplatePatch(path=path, new_value=p.get("new_value")))
        return out
    try:
        return _call_llm_typed(
            system=_D4_SURGEON_SYSTEM, user=user,
            llm_call=llm_call, provenance=provenance,
            phase="D4.surgeon", parse=_parse,
        )
    except Exception as exc:
        log.warning("D4 surgeon failed: %s", exc)
        return []


def _apply_patch(template: dict, patch: TemplatePatch) -> None:
    """In-place apply. Supports dotted paths + numeric indices via [n]."""
    parts = re.findall(r"[^.\[\]]+|\[\d+\]", patch.path)
    cursor: Any = template
    for p in parts[:-1]:
        if p.startswith("[") and p.endswith("]"):
            idx = int(p[1:-1])
            cursor = cursor[idx]
        else:
            cursor = cursor[p]
    last = parts[-1]
    if last.startswith("[") and last.endswith("]"):
        cursor[int(last[1:-1])] = patch.new_value
    else:
        cursor[last] = patch.new_value


def phase_d_validate_template(
    template: dict,
    *,
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
    max_iterations: int = 2,
) -> TemplateValidationResult:
    """The render → critique → surgical-patch loop. Returns the (possibly
    patched) template + per-iteration critiques."""
    import copy
    tpl = copy.deepcopy(template)
    all_critiques: list[VisionCritique] = []
    renders: list[RenderResult] = []
    final_conf = 1.0

    for iteration in range(max_iterations + 1):
        # Three input variants
        defaults = _default_inputs(tpl)
        long_inputs = _edge_long_text(defaults)
        # Multi-series only useful for charts
        is_chart_tpl = any(e.get("kind") == "chart" for e in (tpl.get("layout") or []))

        variants: list[tuple[str, dict[str, Any]]] = [
            ("default", defaults), ("long_text", long_inputs),
        ]
        if is_chart_tpl:
            variants.append(("multi_series", _edge_multi_series(defaults)))

        critiques: list[VisionCritique] = []
        for label, inputs in variants:
            renders.append(RenderResult(
                inputs_label=label, image_path="(svg-in-memory)",
                elements_rendered=len(tpl.get("layout") or []),
            ))
            c = _critique_one_render(
                tpl, label, inputs, llm_call=llm_call, provenance=provenance,
            )
            critiques.append(c)
        all_critiques.extend(critiques)

        # If all variants pass, we're done
        if all(c.overall == "pass" for c in critiques):
            final_conf = 1.0
            break

        # Otherwise, run surgeon with the aggregated issues
        if iteration < max_iterations:
            agg_issues = []
            for c in critiques:
                agg_issues.extend(f"[{c.inputs_label}] {iss}" for iss in c.issues)
            patches = phase_d_04_surgeon(
                template=tpl, issues=agg_issues[:12],
                llm_call=llm_call, provenance=provenance,
            )
            for patch in patches:
                try:
                    _apply_patch(tpl, patch)
                except Exception as exc:
                    log.debug("D4 patch failed %s: %s", patch.path, exc)
            final_conf *= 0.75
        else:
            # Last iteration — accept with lowered confidence
            final_conf *= 0.5

    return TemplateValidationResult(
        template=tpl,
        iterations=iteration + 1,
        renders=renders,
        critiques=all_critiques,
        final_confidence=round(final_conf, 3),
    )


# ── Phase B → template dict ───────────────────────────────────────────────


def enriched_cluster_to_template(ec: EnrichedCluster) -> dict:
    """Convert a Phase B EnrichedCluster into a template dict that Phase D
    can validate + that templates.apply_template can render.

    Uses the STANDARD_*_INPUTS naming conventions. Geometry comes from
    the prototype's positions; text content comes from each variable's
    sample / default.

    The element_idx-keyed roles determine which inputs each element
    gets (text + geometry for content; geometry-only for decorative)."""
    import re as _re
    proto = ec.cluster.prototype.slide
    proto_elements = list(getattr(proto, "elements", None) or [])
    slide_w = float(getattr(proto, "width", 13.333))
    slide_h = float(getattr(proto, "height", 7.5))

    layout: list[dict] = []
    inputs_schema: dict[str, dict] = {}

    # Variable specs keyed by element index for quick lookup
    var_by_idx: dict[int, VariableSpec] = {v.element_idx: v for v in ec.variables}

    for i, el in enumerate(proto_elements):
        pos = getattr(el, "position", None)
        if not pos: continue
        et = getattr(el, "element_type", el.__class__.__name__)
        role = ec.roles.roles.get(i, "decorative")

        # Generate alias from role + idx so the agent sees readable names
        # (preferred over the prototype's raw shape name)
        alias_base = _re.sub(r"\W+", "_", role).lower() or "el"
        # Disambiguate when multiple elements share a role (KPI tiles)
        existing = sum(1 for x in layout if x["alias"].startswith(alias_base))
        alias = f"{alias_base}_{existing+1}" if existing > 0 else alias_base

        # Geometry inputs — every element
        for axis, var, friendly in (
            ("left_in",   "left",   "Left edge (inches)"),
            ("top_in",    "top",    "Top edge (inches)"),
            ("width_in",  "width",  "Width (inches)"),
            ("height_in", "height", "Height (inches)"),
        ):
            default_val = round(float(getattr(pos, var, 0) or 0), 3)
            inputs_schema[f"{alias}_{var}"] = {
                "type": "number", "required": False,
                "default": default_val,
                "description": f"{alias}: {friendly}",
            }

        body: dict[str, Any] = {
            "position": {
                "left_in":   "{{" + alias + "_left}}",
                "top_in":    "{{" + alias + "_top}}",
                "width_in":  "{{" + alias + "_width}}",
                "height_in": "{{" + alias + "_height}}",
            },
            "name": alias.replace("_", " ").title(),
        }

        # Type-specific body content
        kind_map = {
            "BridgeShape": "shape", "BridgeText": "text",
            "BridgeChart": "chart", "BridgeTable": "table",
            "BridgeFreeform": "freeform", "BridgeConnector": "connector",
            "BridgeImage": "image-typed", "BridgeGroup": "live-group",
        }
        kind = kind_map.get(et, "shape")

        # Shape preset + fill
        if et == "BridgeShape":
            shape_id = getattr(el, "shape_identification", None)
            body["geometry_preset"] = (shape_id.geometry_preset if shape_id else None) or "rect"
            fill = getattr(el, "fill", None)
            if fill:
                col = getattr(fill, "color", None)
                hex_val = _hex(col)
                if hex_val:
                    inputs_schema[f"{alias}_fill_color"] = {
                        "type": "string", "required": False,
                        "default": hex_val,
                        "description": f"{alias}: fill color (hex)",
                    }
                    body["fill_color"] = "{{" + alias + "_fill_color}}"

        # Text content for content-bearing roles
        content_roles = {"title", "subtitle", "kicker", "hero_number",
                         "body", "bullet_item", "caption", "footer",
                         "source_citation"}
        if role in content_roles:
            var = var_by_idx.get(i)
            sample_text = ""
            if var and var.samples: sample_text = var.samples[0]
            else: sample_text = _first_text(el)
            # Use the variable's INPUT NAME (semantic) when it's role-derived,
            # else generic <alias>_text. Prefer semantic.
            txt_input = var.input_name if var and var.input_name else f"{alias}_text"
            txt_input = _re.sub(r"\W+", "_", txt_input).lower()[:40]
            inputs_schema[txt_input] = {
                "type": "string", "required": False,
                "default": sample_text[:300],
                "description": f"{alias}: text content",
            }
            if kind == "shape":
                body["text_box"] = True
            body["text"] = "{{" + txt_input + "}}"

            # Font size — from the prototype's first run
            for run in _iter_runs(el):
                fs = getattr(run, "font_size", None)
                if fs:
                    fs_input = f"{alias}_font_size"
                    inputs_schema[fs_input] = {
                        "type": "number", "required": False,
                        "default": round(float(fs), 1),
                        "description": f"{alias}: font size (pt)",
                    }
                    # Note: we don't reference this in the body — the
                    # studio create_* endpoints derive it from the runs
                    # that the apply step constructs. Keeping the input
                    # available so the agent can override at apply.
                    break

        # Chart-specific inputs (from STANDARD_CHART_INPUTS)
        if et == "BridgeChart":
            inputs_schema[f"{alias}_categories"] = {
                "type": "list", "required": False,
                "default": list(getattr(el.categories, "categories", []) or [])[:12],
            }
            body["categories"] = "{{" + alias + "_categories}}"
            ser_default = []
            for s in (getattr(el, "series", None) or []):
                ser_default.append({
                    "name": getattr(s, "name", None) or "Series",
                    "values": list(getattr(s, "values", None) or [])[:12],
                })
            inputs_schema[f"{alias}_series"] = {
                "type": "list", "required": False, "default": ser_default,
            }
            body["series"] = "{{" + alias + "_series}}"
            body["chart_type"] = getattr(el, "chart_type", "column_clustered")

        # Table-specific inputs
        if et == "BridgeTable":
            data = getattr(el, "data", None) or []
            inputs_schema[f"{alias}_data"] = {
                "type": "list", "required": False,
                "default": [[str(c) for c in row] for row in data[:10]],
            }
            body["data"] = "{{" + alias + "_data}}"
            tp = getattr(el, "table_properties", None)
            if tp:
                body["first_row_header"] = bool(getattr(tp, "first_row_header", False))
                body["banded_rows"] = bool(getattr(tp, "banded_rows", False))

        layout.append({"kind": kind, "alias": alias, "body": body})

    return {
        "name": ec.name.chosen,
        "description": ec.description.short_description or ec.description.description,
        "short_description": ec.description.short_description or ec.description.description,
        "long_description": ec.description.long_description,
        "use_when": ec.description.use_when,
        "avoid_when": ec.description.avoid_when,
        "tags": list(ec.tags.tags) or [ec.slot.slot],
        "inputs_schema": inputs_schema,
        "layout": layout,
        "provenance": {
            "synthesized": False,
            "slot": ec.slot.slot,
            "intent": ec.intent.intent,
            "intended_aspect": classify_aspect(slide_w, slide_h),
            "intended_width_in": slide_w,
            "intended_height_in": slide_h,
            "compatible_aspects": [classify_aspect(slide_w, slide_h)],
            "transform_strategy": "proportional_scale",
            "cluster_size": ec.cluster.size,
            "source_refs": list({m.ref_id for m in ec.cluster.members}),
        },
    }


# ── Phase E — cross-template consolidation ────────────────────────────────


_E1_DEDUP_SYSTEM = """\
You see a list of templates with name + short/long descriptions +
use_when + avoid_when + slot + tags. Identify groups of 2+ templates
that are NEAR-DUPLICATES — same intent, same structural layout,
differing only in COSMETIC details (accent color, accent direction,
small enum choices that could become a single input).

STRONG BIAS toward NOT merging. Different intents stay separate.
Different structural layouts stay separate. Different element counts
stay separate. A brand can legitimately have multiple templates that
share the same slot category (e.g. two cover designs, two divider
designs, three chart layouts) — these are NOT merge candidates unless
the only difference between them is a single cosmetic variable like
accent color.

Examples of CORRECT merges:
  * "Sage Cover" + "Cobalt Cover" — same layout, only accent differs
  * "Left-Image Comparison" + "Right-Image Comparison" — direction flip

Examples of WRONG merges:
  * "Cover Photo" + "Cover Text-Only" — structurally different
  * "Hero Metric" + "KPI Grid" — different intents (one vs three KPIs)
  * "3-Column Compare" + "2-Column Compare" — different column counts

Respond with one JSON object, no prose, no fences:

{
  "merge_groups": [
    {
      "members": ["tpl_id_a", "tpl_id_b"],
      "variance_description": "Different accent color",
      "proposed_input": "accent_color",
      "proposed_input_values": ["#7DA1CC", "#6FA17A"]
    }
  ]
}

If no clean cosmetic-only merge candidates exist, return
{"merge_groups": []}.
"""


def phase_e_01_dedup(
    *, templates: list[dict],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> list[MergeGroup]:
    compact = [
        {"id": f"tpl_{i}",
         "name": t.get("name", ""),
         "short_description": (t.get("short_description") or t.get("description") or "")[:200],
         "long_description": (t.get("long_description") or "")[:600],
         "use_when": (t.get("use_when") or "")[:200],
         "avoid_when": (t.get("avoid_when") or "")[:200],
         "slot": (t.get("provenance") or {}).get("slot", ""),
         "tags": t.get("tags", []),
         "element_count": len(t.get("layout") or [])}
        for i, t in enumerate(templates)
    ]
    user = json.dumps({"templates": compact}, ensure_ascii=False, default=str)[:18000]
    def _parse(d: dict) -> list[MergeGroup]:
        groups: list[MergeGroup] = []
        for g in (d.get("merge_groups") or [])[:8]:
            if not isinstance(g, dict): continue
            members = [str(m) for m in (g.get("members") or [])]
            if len(members) < 2: continue
            groups.append(MergeGroup(
                member_ids=members,
                variance_description=str(g.get("variance_description") or "")[:160],
                proposed_input=str(g.get("proposed_input") or "variant")[:30],
                proposed_input_values=[str(v)[:40] for v in (g.get("proposed_input_values") or [])[:6]],
            ))
        return groups
    try:
        return _call_llm_typed(
            system=_E1_DEDUP_SYSTEM, user=user,
            llm_call=llm_call, provenance=provenance,
            phase="E1.dedup", parse=_parse,
        )
    except Exception as exc:
        log.warning("E1 dedup failed (no merges this run): %s", exc)
        return []


_E3_RENAME_SYSTEM = """\
You see a list of finished templates. Rename any whose names a
downstream agent might confuse with another (too-similar adjectives,
overlapping verbs). Each name should be uniquely identifiable in
one phrase.

Bias toward NOT renaming. Only suggest a rename if two names are
genuinely confusable in a quick scan.

Respond with one JSON object, no prose, no fences:

{
  "renames": {
    "tpl_id_a": "New Distinct Name",
    "tpl_id_b": "Another Distinct Name"
  }
}
"""


def phase_e_03_rename_distinctness(
    *, templates: list[dict],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> RenameMap:
    compact = [
        {"id": f"tpl_{i}", "name": t.get("name", ""),
         "description": t.get("description", "")[:120]}
        for i, t in enumerate(templates)
    ]
    user = json.dumps({"templates": compact}, ensure_ascii=False)[:8000]
    def _parse(d: dict) -> RenameMap:
        return RenameMap(renames={k: str(v)[:80] for k, v in
                                    (d.get("renames") or {}).items()})
    try:
        return _call_llm_typed(
            system=_E3_RENAME_SYSTEM, user=user,
            llm_call=llm_call, provenance=provenance,
            phase="E3.rename", parse=_parse,
        )
    except Exception as exc:
        log.warning("E3 rename failed: %s", exc)
        return RenameMap()


def phase_e_04_coverage_audit(templates: list[dict]) -> list[str]:
    """Programmatic — which canonical slots are NOT covered by any
    template? Returns the list of missing slot names."""
    seen = set()
    for t in templates:
        slot = (t.get("provenance") or {}).get("slot")
        if slot: seen.add(slot)
        tags = t.get("tags") or []
        for tag in tags:
            if tag in SLOT_TAXONOMY: seen.add(tag)
    return [s for s in SLOT_TAXONOMY if s not in seen]


# ── Phase F — synthesize stubs for missing slot types ─────────────────────


# Phase F is mostly programmatic — slot stubs are too structural for
# a single LLM call to author reliably within the 2048-token output
# budget (a full template's JSON exceeds it). We use deterministic
# builders that consume the brand's StyleProfile for colors + fonts.
# An optional LLM call after each build customizes naming + description.


def _palette_color(style_profile: StyleProfile, role: str, fallback: str) -> str:
    """Pull the brand's most-used color for the given role, falling
    back to a sensible default if the brand didn't use that role."""
    for c in style_profile.palette.colors:
        if c.role == role and c.hex.upper() not in ("#FFFFFF", "#000000"):
            return c.hex
    if style_profile.palette.colors:
        for c in style_profile.palette.colors:
            if c.hex.upper() not in ("#FFFFFF",):
                return c.hex
    return fallback


def _heading_font(style_profile: StyleProfile) -> str:
    for f in style_profile.fonts:
        if f.role == "heading":
            return f.name
    return style_profile.fonts[0].name if style_profile.fonts else "Inter"


def _body_font(style_profile: StyleProfile) -> str:
    for f in style_profile.fonts:
        if f.role == "body":
            return f.name
    return _heading_font(style_profile)


def _build_hero_metric_template(style_profile: StyleProfile) -> dict:
    """Programmatic hero_metric: single dominant number, kicker label
    above, supporting context below. Uses brand accent for the kicker
    bar and heading font for the number."""
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    heading_font = _heading_font(style_profile)
    body_font = _body_font(style_profile)
    return {
        "name": "Hero Metric Callout",
        "description": "Frames a single dominant number with a kicker label, descriptor, and one-line supporting note.",
        "tags": ["hero", "kpi", "sparse", "data"],
        "inputs_schema": {
            "kicker_text":   {"type": "string", "default": "Q4 ARR ADDED", "description": "Small uppercase eyebrow"},
            "hero_number":   {"type": "string", "default": "$2.4M", "description": "The dominant number"},
            "descriptor":    {"type": "string", "default": "Net new ARR added this quarter"},
            "context_note":  {"type": "string", "default": "Largest single quarter in our history."},
            "kicker_left":   {"type": "number", "default": 0.5},
            "kicker_top":    {"type": "number", "default": 1.2},
            "kicker_width":  {"type": "number", "default": 12.3},
            "kicker_height": {"type": "number", "default": 0.5},
            "hero_left":     {"type": "number", "default": 0.5},
            "hero_top":      {"type": "number", "default": 2.0},
            "hero_width":    {"type": "number", "default": 12.3},
            "hero_height":   {"type": "number", "default": 3.0},
            "desc_left":     {"type": "number", "default": 0.5},
            "desc_top":      {"type": "number", "default": 5.2},
            "desc_width":    {"type": "number", "default": 12.3},
            "desc_height":   {"type": "number", "default": 0.7},
            "context_left":  {"type": "number", "default": 0.5},
            "context_top":   {"type": "number", "default": 6.0},
            "context_width": {"type": "number", "default": 12.3},
            "context_height":{"type": "number", "default": 0.5},
            "accent_color":  {"type": "string", "default": accent},
            "heading_font":  {"type": "string", "default": heading_font},
            "body_font":     {"type": "string", "default": body_font},
        },
        "layout": [
            {"kind": "shape", "alias": "kicker", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{kicker_text}}",
                "position": {"left_in": "{{kicker_left}}", "top_in": "{{kicker_top}}",
                              "width_in": "{{kicker_width}}", "height_in": "{{kicker_height}}"},
                "name": "Kicker",
            }},
            {"kind": "shape", "alias": "hero", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{hero_number}}",
                "position": {"left_in": "{{hero_left}}", "top_in": "{{hero_top}}",
                              "width_in": "{{hero_width}}", "height_in": "{{hero_height}}"},
                "name": "Hero Number",
            }},
            {"kind": "shape", "alias": "descriptor", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{descriptor}}",
                "position": {"left_in": "{{desc_left}}", "top_in": "{{desc_top}}",
                              "width_in": "{{desc_width}}", "height_in": "{{desc_height}}"},
                "name": "Descriptor",
            }},
            {"kind": "shape", "alias": "context", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{context_note}}",
                "position": {"left_in": "{{context_left}}", "top_in": "{{context_top}}",
                              "width_in": "{{context_width}}", "height_in": "{{context_height}}"},
                "name": "Context",
            }},
        ],
        "provenance": {
            "synthesized": True, "slot": "hero_metric",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3],
            "transform_strategy": "proportional_scale",
        },
    }


def _build_bulleted_list_template(style_profile: StyleProfile) -> dict:
    """3-5 em-dash bullets under a title."""
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    return {
        "name": "Bulleted Takeaways",
        "description": "Lists 3-5 takeaways under a section title using em-dash bullets.",
        "tags": ["bulleted", "narrative", "dense"],
        "inputs_schema": {
            "title_text":   {"type": "string", "default": "What we shipped"},
            "bullet_1":     {"type": "string", "default": "— First major thing we shipped this quarter."},
            "bullet_2":     {"type": "string", "default": "— Second major thing, with the headline metric."},
            "bullet_3":     {"type": "string", "default": "— Third major thing, with quick context."},
            "bullet_4":     {"type": "string", "default": "— Fourth (optional — leave blank to hide)."},
            "bullet_5":     {"type": "string", "default": "— Fifth (optional)."},
            "title_left":   {"type": "number", "default": 0.5},
            "title_top":    {"type": "number", "default": 0.5},
            "title_width":  {"type": "number", "default": 12.3},
            "title_height": {"type": "number", "default": 1.0},
            "bullets_left": {"type": "number", "default": 0.7},
            "bullets_top":  {"type": "number", "default": 1.8},
            "bullets_width":{"type": "number", "default": 12.0},
            "bullet_row_h": {"type": "number", "default": 0.85},
            "accent_color": {"type": "string", "default": accent},
        },
        "layout": [
            {"kind": "shape", "alias": "title", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{title_text}}",
                "position": {"left_in": "{{title_left}}", "top_in": "{{title_top}}",
                              "width_in": "{{title_width}}", "height_in": "{{title_height}}"},
                "name": "Title",
            }},
            *(
                {"kind": "shape", "alias": f"b{i+1}", "body": {
                    "geometry_preset": "rect", "text_box": True, "text": f"{{{{bullet_{i+1}}}}}",
                    "position": {"left_in": "{{bullets_left}}",
                                  "top_in": 1.8 + i * 0.85,
                                  "width_in": "{{bullets_width}}",
                                  "height_in": "{{bullet_row_h}}"},
                    "name": f"Bullet {i+1}",
                }} for i in range(5)
            ),
        ],
        "provenance": {
            "synthesized": True, "slot": "bulleted_list",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3, ASPECT_PORTRAIT_4_5],
            "transform_strategy": "proportional_scale",
        },
    }


def _build_cover_template(style_profile: StyleProfile) -> dict:
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    return {
        "name": "Cover Slide",
        "description": "Opens the deck with title, subtitle, and presenter line on a clean cover layout.",
        "tags": ["cover", "opener"],
        "inputs_schema": {
            "title_text":    {"type": "string", "default": "Presentation Title"},
            "subtitle_text": {"type": "string", "default": "A short clarifying line"},
            "presenter_text":{"type": "string", "default": "Presenter Name · Date"},
            "title_left":    {"type": "number", "default": 0.5},
            "title_top":     {"type": "number", "default": 2.6},
            "title_width":   {"type": "number", "default": 12.3},
            "title_height":  {"type": "number", "default": 1.6},
            "sub_left":      {"type": "number", "default": 0.5},
            "sub_top":       {"type": "number", "default": 4.3},
            "sub_width":     {"type": "number", "default": 12.3},
            "sub_height":    {"type": "number", "default": 0.8},
            "pres_left":     {"type": "number", "default": 0.5},
            "pres_top":      {"type": "number", "default": 6.5},
            "pres_width":    {"type": "number", "default": 12.3},
            "pres_height":   {"type": "number", "default": 0.5},
            "accent_color":  {"type": "string", "default": accent},
        },
        "layout": [
            {"kind": "shape", "alias": "title", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{title_text}}",
                "position": {"left_in": "{{title_left}}", "top_in": "{{title_top}}",
                              "width_in": "{{title_width}}", "height_in": "{{title_height}}"},
                "name": "Title",
            }},
            {"kind": "shape", "alias": "subtitle", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{subtitle_text}}",
                "position": {"left_in": "{{sub_left}}", "top_in": "{{sub_top}}",
                              "width_in": "{{sub_width}}", "height_in": "{{sub_height}}"},
                "name": "Subtitle",
            }},
            {"kind": "shape", "alias": "presenter", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{presenter_text}}",
                "position": {"left_in": "{{pres_left}}", "top_in": "{{pres_top}}",
                              "width_in": "{{pres_width}}", "height_in": "{{pres_height}}"},
                "name": "Presenter",
            }},
        ],
        "provenance": {
            "synthesized": True, "slot": "cover",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": list(ALL_ASPECTS),  # cover works in every aspect
            "transform_strategy": "preserve_aspect_fit",
        },
    }


def _build_kpi_grid_template(style_profile: StyleProfile) -> dict:
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    return {
        "name": "KPI Grid (3 across)",
        "description": "Three KPIs side-by-side, each with a value, label, and delta.",
        "tags": ["kpi", "data", "hero"],
        "inputs_schema": {
            "title_text":  {"type": "string", "default": "Q4 at a glance"},
            "kpi1_value":  {"type": "string", "default": "$2.4M"},
            "kpi1_label":  {"type": "string", "default": "ARR added"},
            "kpi1_delta":  {"type": "string", "default": "▲ 18% QoQ"},
            "kpi2_value":  {"type": "string", "default": "98.7%"},
            "kpi2_label":  {"type": "string", "default": "Gross retention"},
            "kpi2_delta":  {"type": "string", "default": "▲ 1.2 pts"},
            "kpi3_value":  {"type": "string", "default": "47"},
            "kpi3_label":  {"type": "string", "default": "Logos closed"},
            "kpi3_delta":  {"type": "string", "default": "▼ 4 vs Q3"},
            "title_left":  {"type": "number", "default": 0.5},
            "title_top":   {"type": "number", "default": 0.5},
            "title_width": {"type": "number", "default": 12.3},
            "title_height":{"type": "number", "default": 0.9},
            "accent_color":{"type": "string", "default": accent},
        },
        "layout": [
            {"kind": "shape", "alias": "title", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{title_text}}",
                "position": {"left_in": "{{title_left}}", "top_in": "{{title_top}}",
                              "width_in": "{{title_width}}", "height_in": "{{title_height}}"},
                "name": "Title",
            }},
            # Three KPI tiles
            *(item for i in range(3) for item in [
                {"kind": "shape", "alias": f"kpi{i+1}_value", "body": {
                    "geometry_preset": "rect", "text_box": True, "text": f"{{{{kpi{i+1}_value}}}}",
                    "position": {"left_in": 0.5 + i * 4.2, "top_in": 2.0,
                                  "width_in": 4.0, "height_in": 1.8},
                    "name": f"KPI {i+1} value",
                }},
                {"kind": "shape", "alias": f"kpi{i+1}_label", "body": {
                    "geometry_preset": "rect", "text_box": True, "text": f"{{{{kpi{i+1}_label}}}}",
                    "position": {"left_in": 0.5 + i * 4.2, "top_in": 4.0,
                                  "width_in": 4.0, "height_in": 0.5},
                    "name": f"KPI {i+1} label",
                }},
                {"kind": "shape", "alias": f"kpi{i+1}_delta", "body": {
                    "geometry_preset": "rect", "text_box": True, "text": f"{{{{kpi{i+1}_delta}}}}",
                    "position": {"left_in": 0.5 + i * 4.2, "top_in": 4.6,
                                  "width_in": 4.0, "height_in": 0.4},
                    "name": f"KPI {i+1} delta",
                }},
            ]),
        ],
        "provenance": {
            "synthesized": True, "slot": "kpi_grid",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3],
            "transform_strategy": "proportional_scale",
        },
    }


def _build_close_template(style_profile: StyleProfile) -> dict:
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    return {
        "name": "Closing Thank You",
        "description": "Closes the deck with a thank-you headline and contact / next-step info.",
        "tags": ["closer", "sparse"],
        "inputs_schema": {
            "headline":   {"type": "string", "default": "Thank you."},
            "contact":    {"type": "string", "default": "hello@example.com"},
            "next_step":  {"type": "string", "default": "Office hours Thursdays at 11am PT."},
            "headline_left":  {"type": "number", "default": 0.5},
            "headline_top":   {"type": "number", "default": 2.5},
            "headline_width": {"type": "number", "default": 12.3},
            "headline_height":{"type": "number", "default": 1.5},
            "contact_left":   {"type": "number", "default": 0.5},
            "contact_top":    {"type": "number", "default": 4.5},
            "contact_width":  {"type": "number", "default": 12.3},
            "contact_height": {"type": "number", "default": 0.6},
            "next_left":      {"type": "number", "default": 0.5},
            "next_top":       {"type": "number", "default": 5.4},
            "next_width":     {"type": "number", "default": 12.3},
            "next_height":    {"type": "number", "default": 0.5},
            "accent_color":   {"type": "string", "default": accent},
        },
        "layout": [
            {"kind": "shape", "alias": "headline", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{headline}}",
                "position": {"left_in": "{{headline_left}}", "top_in": "{{headline_top}}",
                              "width_in": "{{headline_width}}", "height_in": "{{headline_height}}"},
                "name": "Headline",
            }},
            {"kind": "shape", "alias": "contact", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{contact}}",
                "position": {"left_in": "{{contact_left}}", "top_in": "{{contact_top}}",
                              "width_in": "{{contact_width}}", "height_in": "{{contact_height}}"},
                "name": "Contact",
            }},
            {"kind": "shape", "alias": "next_step", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{next_step}}",
                "position": {"left_in": "{{next_left}}", "top_in": "{{next_top}}",
                              "width_in": "{{next_width}}", "height_in": "{{next_height}}"},
                "name": "Next step",
            }},
        ],
        "provenance": {
            "synthesized": True, "slot": "close",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": list(ALL_ASPECTS),
            "transform_strategy": "preserve_aspect_fit",
        },
    }


def _build_divider_template(style_profile: StyleProfile) -> dict:
    accent = _palette_color(style_profile, "accent", "#7DA1CC")
    return {
        "name": "Section Divider",
        "description": "Marks the start of a section with a single bold heading on an accent background.",
        "tags": ["divider", "sparse"],
        "inputs_schema": {
            "section_label": {"type": "string", "default": "Section heading"},
            "label_left":    {"type": "number", "default": 0.5},
            "label_top":     {"type": "number", "default": 3.0},
            "label_width":   {"type": "number", "default": 12.3},
            "label_height":  {"type": "number", "default": 1.5},
            "accent_color":  {"type": "string", "default": accent},
        },
        "layout": [
            {"kind": "shape", "alias": "label", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{section_label}}",
                "position": {"left_in": "{{label_left}}", "top_in": "{{label_top}}",
                              "width_in": "{{label_width}}", "height_in": "{{label_height}}"},
                "name": "Section Label",
            }},
        ],
        "provenance": {
            "synthesized": True, "slot": "divider",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": list(ALL_ASPECTS),
            "transform_strategy": "preserve_aspect_fit",
        },
    }


def _build_narrative_template(style_profile: StyleProfile) -> dict:
    return {
        "name": "Narrative Paragraphs",
        "description": "Three paragraphs of body text under a section title — for explaining a topic in prose.",
        "tags": ["narrative", "dense"],
        "inputs_schema": {
            "title_text":   {"type": "string", "default": "Section title"},
            "para_1":       {"type": "string", "default": "First paragraph of the narrative — context and setup."},
            "para_2":       {"type": "string", "default": "Second paragraph — the key insight or argument."},
            "para_3":       {"type": "string", "default": "Third paragraph — implication or call to action."},
            "title_left":   {"type": "number", "default": 0.5},
            "title_top":    {"type": "number", "default": 0.5},
            "title_width":  {"type": "number", "default": 12.3},
            "title_height": {"type": "number", "default": 0.9},
            "body_left":    {"type": "number", "default": 0.5},
            "body_width":   {"type": "number", "default": 12.3},
        },
        "layout": [
            {"kind": "shape", "alias": "title", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{title_text}}",
                "position": {"left_in": "{{title_left}}", "top_in": "{{title_top}}",
                              "width_in": "{{title_width}}", "height_in": "{{title_height}}"},
                "name": "Title",
            }},
            {"kind": "shape", "alias": "p1", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{para_1}}",
                "position": {"left_in": "{{body_left}}", "top_in": 1.8,
                              "width_in": "{{body_width}}", "height_in": 1.6},
                "name": "Para 1",
            }},
            {"kind": "shape", "alias": "p2", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{para_2}}",
                "position": {"left_in": "{{body_left}}", "top_in": 3.5,
                              "width_in": "{{body_width}}", "height_in": 1.6},
                "name": "Para 2",
            }},
            {"kind": "shape", "alias": "p3", "body": {
                "geometry_preset": "rect", "text_box": True, "text": "{{para_3}}",
                "position": {"left_in": "{{body_left}}", "top_in": 5.2,
                              "width_in": "{{body_width}}", "height_in": 1.6},
                "name": "Para 3",
            }},
        ],
        "provenance": {
            "synthesized": True, "slot": "narrative",
            "intended_aspect": ASPECT_LANDSCAPE_16_9,
            "intended_width_in": 13.333, "intended_height_in": 7.5,
            "compatible_aspects": [ASPECT_LANDSCAPE_16_9, ASPECT_LANDSCAPE_4_3, ASPECT_PORTRAIT_4_5],
            "transform_strategy": "proportional_scale",
        },
    }


# Slot → programmatic builder. Phase F walks the missing-slot list, finds
# a builder, runs it, and (optionally) calls an LLM brand-tuning pass.
_SLOT_BUILDERS: dict[str, Callable[[StyleProfile], dict]] = {
    "cover":          _build_cover_template,
    "hero_metric":    _build_hero_metric_template,
    "kpi_grid":       _build_kpi_grid_template,
    "bulleted_list":  _build_bulleted_list_template,
    "narrative":      _build_narrative_template,
    "divider":        _build_divider_template,
    "close":          _build_close_template,
}


def phase_f_synthesize_slot(
    *, slot: str, style_profile: StyleProfile,
    existing_templates: list[dict],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> dict | None:
    """Programmatic synthesis — builds a stub template from a hand-crafted
    skeleton + the brand's StyleProfile colors/fonts. NO LLM call (the
    structural authoring needed more than the 2048-token output budget
    we have on Bedrock; deterministic builders are more reliable AND
    cheaper). Returns None for slots without a registered builder."""
    builder = _SLOT_BUILDERS.get(slot)
    if not builder:
        log.info("F1 synthesize[%s]: no builder for slot — skipping", slot)
        return None
    try:
        tpl = builder(style_profile)
        # Record a synthetic provenance entry so the run log shows the
        # synthesis happened (zero-cost since no LLM call).
        provenance.record(
            phase=f"F1.synthesize[{slot}]",
            system_prompt="(programmatic builder)",
            user_input=json.dumps({"slot": slot}),
            raw_output="(builder output)",
            parsed_output={"name": tpl["name"], "slot": slot},
            model="programmatic", duration_ms=0, cost_usd=0.0,
        )
        log.info("F1 synthesize[%s]: built %r", slot, tpl["name"])
        return tpl
    except Exception as exc:
        log.warning("F1 synthesize[%s] builder failed: %s", slot, exc)
        return None


# ── Phase G — final coherence check (lightweight) ─────────────────────────


_G1_COHERENCE_SYSTEM = """\
You see the final set of templates that comprise this brand's
Template Set. Does it feel like ONE designer made it? Flag any
template that feels off-brand — different type system, mismatched
palette, inconsistent spacing — for human review.

Respond with one JSON object, no prose, no fences:

{
  "coherence_score": 0.0 to 1.0,
  "off_brand_ids": ["tpl_id_a", ...],
  "notes": "<one short clause>"
}
"""


def phase_g_01_coherence(
    *, templates: list[dict],
    llm_call: Callable[[str, str], str], provenance: ProvenanceLogger,
) -> dict[str, Any]:
    compact = [
        {"id": f"tpl_{i}", "name": t.get("name", ""),
         "description": t.get("description", "")[:140],
         "slot": (t.get("provenance") or {}).get("slot", ""),
         "synthesized": (t.get("provenance") or {}).get("synthesized", False)}
        for i, t in enumerate(templates)
    ]
    user = json.dumps({"templates": compact}, ensure_ascii=False)[:8000]
    try:
        return _call_llm_typed(
            system=_G1_COHERENCE_SYSTEM, user=user,
            llm_call=llm_call, provenance=provenance,
            phase="G1.coherence",
            parse=lambda d: {
                "coherence_score": float(d.get("coherence_score") or 0.5),
                "off_brand_ids": [str(x) for x in (d.get("off_brand_ids") or [])][:8],
                "notes": str(d.get("notes") or "")[:200],
            },
        )
    except Exception as exc:
        log.warning("G1 coherence failed: %s", exc)
        return {"coherence_score": 0.5, "off_brand_ids": [], "notes": "G1 call failed"}


# ── Top-level orchestrator ────────────────────────────────────────────────


@dataclass(slots=True)
class V3InductionResult:
    """Final output of induce_templates_v3()."""
    induction_id: str
    style_profile: StyleProfile
    chart_styles: list[ValidatedChartStyle]
    table_styles: list[ValidatedTableStyle]
    enriched_clusters: list[EnrichedCluster]
    final_templates: list[dict]    # the actual Template dicts ready to save
    coverage_gaps: list[CoverageGap]
    provenance: ProvenanceLogger

    def to_dict(self) -> dict[str, Any]:
        return {
            "induction_id": self.induction_id,
            "style_profile": asdict(self.style_profile),
            "chart_style_count": len(self.chart_styles),
            "table_style_count": len(self.table_styles),
            "enriched_cluster_count": len(self.enriched_clusters),
            "final_template_count": len(self.final_templates),
            "coverage_gaps": [g.slot for g in self.coverage_gaps if not g.synthesized],
            "synthesized_template_count": len([g for g in self.coverage_gaps if g.synthesized]),
            "total_llm_calls": self.provenance.total_calls,
            "total_llm_cost_usd": round(self.provenance.total_cost_usd, 4),
        }


def induce_templates_v3(
    docs_by_ref: dict[str, Any],
    *,
    llm_call: Callable[[str, str], str],
    studio: Any | None = None,
    model: str = _DEFAULT_MODEL,
) -> V3InductionResult:
    """Run the full v3 pipeline.

    This is the public entry point. Phase A is pure-Python; Phases B-G
    will be filled in as I land each phase's implementation (this commit
    has B-G as stubs that pass through with no-op outputs).
    """
    prov = ProvenanceLogger()
    log.info("v3 induction starting (id=%s)", prov.induction_id)

    # ── Phase A — programmatic ──
    style_profile = phase_a_build_style_profile(docs_by_ref)
    log.info("  Phase A — palette: %d colors, fonts: %d",
             len(style_profile.palette.colors), len(style_profile.fonts))
    clusters = phase_a_cluster_slides(docs_by_ref)
    log.info("  Phase A — slide clusters: %d (sizes: %s)",
             len(clusters), [c.size for c in clusters[:10]])
    raw_chart_styles = phase_a_extract_chart_styles(docs_by_ref)
    raw_table_styles = phase_a_extract_table_styles(docs_by_ref)
    log.info("  Phase A — chart style fragments: %d, table style fragments: %d",
             len(raw_chart_styles), len(raw_table_styles))

    # ── Phase B — semantic enrichment per cluster ──
    # Be inclusive: push for more candidates here, ween down at Phase
    # E (dedup) + Phase G (coherence). Better to over-generate then
    # consolidate than to under-generate and miss real templates.
    enriched: list[EnrichedCluster] = []
    max_clusters_to_enrich = 60   # was 20 — push for more
    for cluster in clusters[:max_clusters_to_enrich]:
        if cluster.size < 1: continue
        ec = phase_b_enrich_cluster(
            cluster, llm_call=llm_call, provenance=prov,
        )
        if ec:
            enriched.append(ec)
            log.info("  Phase B — %r (slot=%s, %d vars, %d calls so far)",
                     ec.name.chosen, ec.slot.slot,
                     len(ec.variables), prov.total_calls)
    # ── Phase C — style fragment characterization + cross-type bases ──
    chart_styles: list[ValidatedChartStyle] = []
    for rcs in raw_chart_styles[:6]:    # cap LLM cost
        vcs = phase_c_cross_pollinate_chart(
            rcs, llm_call=llm_call, provenance=prov,
        )
        chart_styles.append(vcs)
        log.info("  Phase C — chart style fragment %s: %d base templates",
                 rcs.portable_hash(), len(vcs.base_templates))
    table_styles: list[ValidatedTableStyle] = []
    for rts in raw_table_styles[:4]:
        vts = phase_c_cross_pollinate_table(
            rts, llm_call=llm_call, provenance=prov,
        )
        table_styles.append(vts)
        log.info("  Phase C — table style fragment %s: %d base templates",
                 rts.portable_hash(), len(vts.base_templates))
    # ── Convert Phase B clusters → template dicts ──
    cluster_templates: list[dict] = []
    for ec in enriched:
        try:
            tpl = enriched_cluster_to_template(ec)
            cluster_templates.append(tpl)
        except Exception as exc:
            log.warning("cluster→template failed for %r: %s",
                         ec.name.chosen, exc)

    # ── Pull in cross-pollinated chart/table base templates ──
    # We add only the BEST chart style fragment's base templates (the
    # first one — highest-usage-count by extraction order). Multiple
    # fragments produce visually inconsistent sets.
    base_templates: list[dict] = []
    if chart_styles:
        for ct, tpl in chart_styles[0].base_templates.items():
            base_templates.append(tpl)
    if table_styles:
        for use, tpl in table_styles[0].base_templates.items():
            base_templates.append(tpl)
    log.info("  Phase C — %d cross-pollinated base templates added",
             len(base_templates))

    # ── Phase D — validation loop ──
    validated: list[dict] = []
    candidate_pool = cluster_templates + base_templates
    for i, tpl in enumerate(candidate_pool):
        try:
            result = phase_d_validate_template(
                tpl, llm_call=llm_call, provenance=prov,
                max_iterations=1,    # one refinement attempt per template
            )
            t_out = result.template
            t_out.setdefault("provenance", {})["validation_confidence"] = result.final_confidence
            validated.append(t_out)
            log.info("  Phase D — %r → confidence %.2f (%d critiques)",
                     t_out.get("name"), result.final_confidence,
                     len(result.critiques))
        except Exception as exc:
            log.warning("  Phase D — %r failed: %s", tpl.get("name"), exc)
            validated.append(tpl)

    # ── Phase E — cross-template consolidation ──
    merge_groups = phase_e_01_dedup(
        templates=validated, llm_call=llm_call, provenance=prov,
    )
    if merge_groups:
        log.info("  Phase E — %d merge group(s) proposed (informational only this pass)",
                 len(merge_groups))
    rename_map = phase_e_03_rename_distinctness(
        templates=validated, llm_call=llm_call, provenance=prov,
    )
    for k, new_name in rename_map.renames.items():
        try:
            idx = int(k.replace("tpl_", ""))
            if 0 <= idx < len(validated):
                old = validated[idx].get("name")
                validated[idx]["name"] = new_name
                log.info("  Phase E — renamed %r → %r", old, new_name)
        except (ValueError, IndexError):
            continue

    # Coverage audit (programmatic)
    missing_slots = phase_e_04_coverage_audit(validated)
    log.info("  Phase E — %d missing slot types: %s",
             len(missing_slots), missing_slots[:6])

    # ── Phase F — synthesize stubs for missing slot types ──
    coverage_gaps: list[CoverageGap] = []
    priority_slots = (
        "cover", "hero_metric", "kpi_grid", "narrative", "close",
        "divider", "chart", "table", "bulleted_list", "comparison",
    )
    for slot in missing_slots:
        if slot not in priority_slots:    # synthesize only the high-value ones
            coverage_gaps.append(CoverageGap(slot=slot, synthesized=False))
            continue
        synth = phase_f_synthesize_slot(
            slot=slot, style_profile=style_profile,
            existing_templates=validated,
            llm_call=llm_call, provenance=prov,
        )
        if synth:
            validated.append(synth)
            coverage_gaps.append(CoverageGap(
                slot=slot, synthesized=True, synthesized_template=synth,
            ))
            log.info("  Phase F — synthesized stub for slot %r", slot)
        else:
            coverage_gaps.append(CoverageGap(slot=slot, synthesized=False))

    # ── Phase G — coherence pass ──
    coherence = phase_g_01_coherence(
        templates=validated, llm_call=llm_call, provenance=prov,
    )
    log.info("  Phase G — coherence score %.2f, %d off-brand flagged: %s",
             coherence.get("coherence_score", 0),
             len(coherence.get("off_brand_ids", [])),
             coherence.get("notes", "")[:140])

    final_templates = validated

    log.info("v3 induction complete (id=%s, calls=%d, cost=$%.4f)",
             prov.induction_id, prov.total_calls, prov.total_cost_usd)

    return V3InductionResult(
        induction_id=prov.induction_id,
        style_profile=style_profile,
        chart_styles=chart_styles,
        table_styles=table_styles,
        enriched_clusters=enriched,
        final_templates=final_templates,
        coverage_gaps=coverage_gaps,
        provenance=prov,
    )
