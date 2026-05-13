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
    """Phase B6 output."""
    description: str = ""


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

    # ── Phase B-G — STUBS (filled in by subsequent commits) ──
    enriched: list[EnrichedCluster] = []   # TODO Phase B
    chart_styles: list[ValidatedChartStyle] = [
        ValidatedChartStyle(raw=rs,
                            characterization=StyleFragmentCharacterization(summary=""))
        for rs in raw_chart_styles
    ]   # TODO Phase C
    table_styles: list[ValidatedTableStyle] = [
        ValidatedTableStyle(raw=rs,
                            characterization=StyleFragmentCharacterization(summary=""))
        for rs in raw_table_styles
    ]   # TODO Phase C
    final_templates: list[dict] = []   # TODO Phase D + E
    coverage_gaps: list[CoverageGap] = []   # TODO Phase F

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
