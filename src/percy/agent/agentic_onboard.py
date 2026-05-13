"""Agentic onboarding pipeline — vision-led template-set creation.

Mimics what a human (or a thoughtful AI agent) actually does when given
a brand's source materials and asked to build a reusable template set:

  1. Flip through EVERY page once, noting "what's on this page" — slot
     type, presence of charts/tables, composition pattern.
  2. Group pages with the same observed pattern (cluster).
  3. For each cluster, study what stays constant vs varies.
  4. For each chart/table, study it carefully — extract type, palette,
     gridlines, legend, axis style, data label format.
  5. Synthesize templates using everything we learned.
  6. Cross-pollinate the chart/table style across types the brand
     didn't have (so we have a complete chart-type set per brand).
  7. Render each template + sanity-check it visually.
  8. Audit coverage — synthesize any missing slot types.
  9. Step back and check the set feels coherent.

This file implements stages A1-A3 (the vision-led observation +
clustering verification + chart/table style extraction pieces that
v3's purely programmatic Phase A misses).

Stages A4 onward reuse v3's existing phase functions:
  A4 (variable identification)   ← v3.phase_b_04_variables
  A5 (template authoring)        ← v3.enriched_cluster_to_template
  A6 (cross-pollination)         ← v3.phase_c_cross_pollinate_*
  A7 (render-validate)           ← v3.phase_d_validate_template
  A8 (coverage synthesis)        ← v3.phase_f_synthesize_slot
  A9 (set coherence)             ← v3.phase_g_01_coherence

Caching: every vision call's output is persisted to
`.percy_onboard_cache/<slug>/{pages,clusters,styles}/` so re-runs
(prompt iteration, fix attempts) reuse stage outputs and only re-do
what changed.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable, Iterable

log = logging.getLogger(__name__)


# ── Per-page vision inventory shape ───────────────────────────────────────


@dataclass(slots=True)
class PageObservation:
    """Vision-pass output for ONE page. Stage A1's output, one per slide.

    Fields are intentionally close to the LLM's natural answer surface
    (verbose descriptions, lists of observed items) — we extract
    structured signal from these in stage A2 + A3."""
    slide_n: int
    # Slot taxonomy — closed vocab from v3.SLOT_TAXONOMY
    slot_guess: str = "narrative"
    slot_confidence: float = 0.5

    # What's on the page
    title_text: str | None = None
    has_chart: bool = False
    chart_type_guess: str | None = None         # "column" | "bar" | "line" | "pie" | "donut" | "area" | "scatter" | "other"
    chart_complexity: str | None = None         # "simple" | "moderate" | "complex"
    has_table: bool = False
    table_use_guess: str | None = None          # "agenda" | "kpi_grid" | "comparison" | "data_dump"
    has_image: bool = False
    has_logo_grid: bool = False                 # specific pattern: many small image groups

    # Layout description (free-form)
    composition_pattern: str = ""               # one short sentence
    distinctive_features: list[str] = field(default_factory=list)
    visual_density: str = "medium"              # "sparse" | "medium" | "dense" | "very_dense"

    # Brand-fit signal
    on_brand: bool = True
    reasoning: str = ""

    # Extraction layer used (for provenance)
    extraction_method: str = "vision"
    image_path: str | None = None


@dataclass(slots=True)
class ClusterVerification:
    """Stage A2's per-cluster output."""
    cluster_id: str
    page_indices: list[int]
    is_truly_same_template: bool
    confidence: float
    variance_description: str = ""
    proposed_name: str = ""


@dataclass(slots=True)
class VisionChartStyle:
    """Stage A3's per-chart output. Sibling of v3.RawChartStyle but
    sourced from a vision call against a chart crop, with all fields
    LLM-inferred (no Bridge data required)."""
    slide_n: int
    chart_type: str                            # column / bar / line / pie / donut / area / scatter
    # Type-agnostic portable fields
    series_colors: list[str] = field(default_factory=list)   # hex codes IN ORDER
    gridline_color: str | None = None
    gridline_style: str | None = None           # "solid" | "dotted" | "dashed" | "none"
    gridline_weight: str | None = None          # "thin" | "medium" | "thick"
    legend_position: str | None = None          # "top" | "bottom" | "left" | "right" | "none"
    legend_font_size: str | None = None         # "small" | "medium" | "large"
    title_present: bool = False
    title_typography: str | None = None         # short prose: "bold sans, ~24pt"
    axis_font_size: str | None = None
    axis_label_color: str | None = None
    data_labels_present: bool = False
    data_label_format: str | None = None        # e.g. "$#,##0", "0.0%"
    plot_area_fill: str | None = None
    plot_area_border: str | None = None
    background_color: str | None = None         # of the whole chart region

    # Designer's-eye description, captured verbatim from vision
    design_summary: str = ""

    # Provenance
    extraction_method: str = "vision"
    confidence: float = 0.85


@dataclass(slots=True)
class VisionTableStyle:
    """Stage A3's per-table output."""
    slide_n: int
    table_use: str                              # agenda / kpi_grid / comparison / data_dump
    rows_observed: int
    cols_observed: int
    header_fill: str | None = None
    header_font_color: str | None = None
    header_alignment: str | None = None
    banded_rows: bool = False
    band_a: str | None = None
    band_b: str | None = None
    border_color: str | None = None
    border_style: str | None = None
    cell_alignment: str | None = None
    first_col_emphasis: bool = False
    design_summary: str = ""
    extraction_method: str = "vision"
    confidence: float = 0.85


@dataclass(slots=True)
class OnboardResult:
    """Top-level output of agentic_onboard()."""
    slug: str
    page_observations: list[PageObservation] = field(default_factory=list)
    cluster_verifications: list[ClusterVerification] = field(default_factory=list)
    vision_chart_styles: list[VisionChartStyle] = field(default_factory=list)
    vision_table_styles: list[VisionTableStyle] = field(default_factory=list)
    total_vision_calls: int = 0
    total_cost_usd: float = 0.0
    cache_dir: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "page_count": len(self.page_observations),
            "verified_clusters": len(self.cluster_verifications),
            "chart_styles_extracted": len(self.vision_chart_styles),
            "table_styles_extracted": len(self.vision_table_styles),
            "total_vision_calls": self.total_vision_calls,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "cache_dir": self.cache_dir,
        }


# ── Vision call factory ────────────────────────────────────────────────────


def make_bedrock_vision_call(model: str = "us.anthropic.claude-sonnet-4-6") -> Callable:
    """Return a callable (system, user_text, image_png_bytes) -> str.

    Uses the same Bedrock client the rest of Percy uses (config picked
    up from env + AWS profile). Vision payload is base64-encoded PNG.
    Falls back to text-only if image bytes are None."""
    import boto3

    region = "us-east-1"
    client = boto3.client("bedrock-runtime", region_name=region)

    def call(system: str, user_text: str, image_png: bytes | None = None) -> str:
        content_blocks: list[dict] = []
        if image_png:
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(image_png).decode("ascii"),
                },
            })
        content_blocks.append({"type": "text", "text": user_text})

        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "system": system,
            "messages": [{"role": "user", "content": content_blocks}],
        }
        resp = client.invoke_model(modelId=model, body=json.dumps(body))
        payload = json.loads(resp["body"].read())
        # Anthropic-formatted Bedrock response — content is a list of blocks
        text_blocks = [b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"]
        return "".join(text_blocks)

    return call


# ── Slide rendering for vision input ──────────────────────────────────────


def _render_slide_to_png_bytes(slide: Any, dpi: int = 100) -> bytes:
    """Render a Bridge slide to PNG bytes via the existing matplotlib
    renderer. Used by stages A1 + A3 to give the vision call an image."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from percy.diagnostics.render_png import render_slide
    fig = render_slide(slide, dpi=dpi)
    buf = io.BytesIO()
    fig.savefig(buf, dpi=dpi, bbox_inches=None, pad_inches=0, format="png")
    plt.close(fig)
    return buf.getvalue()


# ── Cache management ───────────────────────────────────────────────────────


def _cache_root(slug: str) -> Path:
    p = Path(__file__).resolve().parents[3] / ".percy_onboard_cache" / slug
    p.mkdir(parents=True, exist_ok=True)
    return p


def _cache_load(cache_dir: Path, key: str) -> dict | None:
    f = cache_dir / f"{key}.json"
    if not f.exists(): return None
    try: return json.loads(f.read_text(encoding="utf-8"))
    except Exception: return None


def _cache_save(cache_dir: Path, key: str, data: dict) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"{key}.json").write_text(
        json.dumps(data, indent=2, default=str, ensure_ascii=False),
        encoding="utf-8",
    )


# ── JSON helpers ──────────────────────────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
_FENCE_RE      = re.compile(r"```(?:json)?\s*", re.IGNORECASE)


def _parse_json(text: str) -> dict | None:
    if not text: return None
    s = text.strip()
    if s.startswith("```"):
        s = _FENCE_RE.sub("", s)
        s = re.sub(r"\s*```\s*$", "", s)
    try: return json.loads(s)
    except Exception: pass
    m = _JSON_BLOCK_RE.search(s)
    if m:
        try: return json.loads(m.group(0))
        except Exception: return None
    return None


# ── Stage A1 — Per-page inventory ─────────────────────────────────────────


_A1_INVENTORY_SYSTEM = """\
You are looking at ONE slide from a brand's source deck. Describe what
you see on this slide, structured. You'll do this for every slide in
the deck — output is the perception layer that downstream stages use
to cluster + author templates.

Slot taxonomy (pick exactly one):
  cover           — title page / brand intro
  divider         — section break / brand-statement page
  hero_metric     — single big number, focused
  kpi_grid        — multiple KPIs side-by-side
  chart           — chart-led slide (the chart IS the slide)
  table           — table-led slide
  narrative       — paragraphs of explanatory text
  comparison      — two- or three-column compare layout
  bulleted_list   — list of items / takeaways
  quote           — pull quote with attribution
  image_lead      — image dominant
  agenda          — agenda / sections list
  close           — thank you / contact / closing

Chart-type vocab (pick one or null):
  column, bar, line, area, pie, donut, scatter, combo, other

Table-use vocab:
  agenda, kpi_grid, comparison, data_dump

Visual density: sparse / medium / dense / very_dense.

Respond with ONE JSON object, no prose, no fences:

{
  "slot_guess": "<from slot taxonomy>",
  "slot_confidence": 0.0 to 1.0,
  "title_text": "<exact title text on the slide, or null>",
  "has_chart": true | false,
  "chart_type_guess": "<vocab or null>",
  "chart_complexity": "simple" | "moderate" | "complex" | null,
  "has_table": true | false,
  "table_use_guess": "<vocab or null>",
  "has_image": true | false,
  "has_logo_grid": true | false,
  "composition_pattern": "<one short sentence describing the layout>",
  "distinctive_features": ["short phrase", "another phrase"],
  "visual_density": "sparse" | "medium" | "dense" | "very_dense",
  "on_brand": true | false,
  "reasoning": "<one short clause on the slot choice>"
}
"""


def stage_a1_per_page_inventory(
    docs_by_ref: dict[str, Any],
    *,
    vision_call: Callable[[str, str, bytes | None], str],
    cache_dir: Path,
    cost_usd: float = 0.02,
    progress_cb: Callable[[int, int], None] | None = None,
) -> list[PageObservation]:
    """One vision call per page across all source decks. Cached so
    re-runs (e.g. iterating on the prompt) skip pages already analyzed.

    progress_cb(done, total) is called after each page if provided —
    so the CLI can show a progress bar without coupling to a logging
    style."""
    pages_dir = cache_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    # Flatten all slides across refs into a single sequence
    all_slides: list[tuple[str, int, Any]] = []
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            all_slides.append((ref_id, slide.slide_number, slide))
    total = len(all_slides)
    log.info("A1: inventorying %d pages across %d refs", total, len(docs_by_ref))

    observations: list[PageObservation] = []
    calls_made = 0
    for i, (ref_id, slide_n, slide) in enumerate(all_slides):
        key = f"page_{ref_id}_{slide_n:04}"
        cached = _cache_load(pages_dir, key)
        if cached:
            try:
                observations.append(PageObservation(**cached))
                if progress_cb: progress_cb(i + 1, total)
                continue
            except TypeError:
                # Cache shape changed — invalidate
                pass

        # Render the slide once + send to vision
        try:
            png_bytes = _render_slide_to_png_bytes(slide, dpi=100)
        except Exception as exc:
            log.warning("A1 page %d: render failed: %s", slide_n, exc)
            obs = PageObservation(slide_n=slide_n, reasoning=f"render error: {exc}",
                                   slot_confidence=0.0)
            observations.append(obs)
            _cache_save(pages_dir, key, asdict(obs))
            if progress_cb: progress_cb(i + 1, total)
            continue

        user_msg = (
            f"Slide {slide_n} of source `{ref_id}`. Describe what's on it. "
            "Output the JSON spec defined in the system prompt."
        )
        try:
            raw = vision_call(_A1_INVENTORY_SYSTEM, user_msg, png_bytes)
            calls_made += 1
        except Exception as exc:
            log.warning("A1 page %d: vision call failed: %s", slide_n, exc)
            obs = PageObservation(slide_n=slide_n,
                                   reasoning=f"vision call failed: {exc}",
                                   slot_confidence=0.0)
            observations.append(obs)
            _cache_save(pages_dir, key, asdict(obs))
            if progress_cb: progress_cb(i + 1, total)
            continue

        parsed = _parse_json(raw) or {}
        obs = PageObservation(
            slide_n=slide_n,
            slot_guess=str(parsed.get("slot_guess") or "narrative"),
            slot_confidence=float(parsed.get("slot_confidence") or 0.5),
            title_text=parsed.get("title_text"),
            has_chart=bool(parsed.get("has_chart", False)),
            chart_type_guess=parsed.get("chart_type_guess"),
            chart_complexity=parsed.get("chart_complexity"),
            has_table=bool(parsed.get("has_table", False)),
            table_use_guess=parsed.get("table_use_guess"),
            has_image=bool(parsed.get("has_image", False)),
            has_logo_grid=bool(parsed.get("has_logo_grid", False)),
            composition_pattern=str(parsed.get("composition_pattern") or "")[:300],
            distinctive_features=[str(s)[:80] for s in (parsed.get("distinctive_features") or [])][:6],
            visual_density=str(parsed.get("visual_density") or "medium"),
            on_brand=bool(parsed.get("on_brand", True)),
            reasoning=str(parsed.get("reasoning") or "")[:240],
        )
        observations.append(obs)
        _cache_save(pages_dir, key, asdict(obs))
        if progress_cb: progress_cb(i + 1, total)

    log.info("A1: %d observations (%d cache hits, %d vision calls)",
             len(observations), total - calls_made, calls_made)
    return observations


# ── Stage A2 — Cluster verification ───────────────────────────────────────


_A2_CLUSTER_SYSTEM = """\
You see 2-3 slides that an automated process clustered together as
the same template. Decide:

  is_truly_same_template = TRUE if the slides share the same LAYOUT
  STRUCTURE — same element types in same positions, same composition.
  Only the text content / numbers / colors should vary.

  is_truly_same_template = FALSE if the slides have structurally
  different layouts (different element count, different composition).

Important — do NOT mark FALSE just because two templates share the
same slot category (cover/divider/chart/etc.). A brand can legitimately
have multiple distinct templates per slot. Only ask: is the underlying
STRUCTURE the same?

A 5-word proposed name (Title Case) for what this template IS.

Respond with one JSON object, no prose, no fences:

{
  "is_truly_same_template": true | false,
  "confidence": 0.0 to 1.0,
  "variance_description": "<one short clause on what varies>",
  "proposed_name": "<short Title Case name>"
}
"""


def stage_a2_cluster_verify(
    clusters: list[Any],            # list of v3.SlideCluster
    docs_by_ref: dict[str, Any],
    *,
    vision_call: Callable[[str, str, bytes | None], str],
    cache_dir: Path,
    max_clusters: int = 30,
) -> list[ClusterVerification]:
    """For each cluster (capped), send 2-3 prototype renders to vision +
    ask whether the cluster is real."""
    cl_dir = cache_dir / "clusters"
    cl_dir.mkdir(parents=True, exist_ok=True)
    out: list[ClusterVerification] = []
    for i, cluster in enumerate(clusters[:max_clusters]):
        cid = f"cluster_{i:03}_size{cluster.size}"
        cached = _cache_load(cl_dir, cid)
        if cached:
            try:
                out.append(ClusterVerification(**cached))
                continue
            except TypeError:
                pass

        # Render up to 3 members
        members_to_render = cluster.members[:3]
        # Combine into a single tall PNG so we send one image, not three
        try:
            import matplotlib; matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            from PIL import Image
            pngs = []
            for m in members_to_render:
                pngs.append(_render_slide_to_png_bytes(m.slide, dpi=80))
            imgs = [Image.open(io.BytesIO(p)) for p in pngs]
            w = max(im.width for im in imgs)
            h_total = sum(im.height for im in imgs)
            combined = Image.new("RGB", (w, h_total), "white")
            y = 0
            for im in imgs:
                combined.paste(im, (0, y))
                y += im.height
            buf = io.BytesIO()
            combined.save(buf, format="PNG")
            combined_png = buf.getvalue()
        except Exception as exc:
            log.warning("A2 cluster %d: combine failed: %s", i, exc)
            continue

        user = (
            f"These are {len(members_to_render)} slides clustered together "
            f"({cluster.size} total members in the cluster). "
            "Are they the same template? Output the JSON spec."
        )
        try:
            raw = vision_call(_A2_CLUSTER_SYSTEM, user, combined_png)
        except Exception as exc:
            log.warning("A2 cluster %d: vision failed: %s", i, exc)
            continue
        parsed = _parse_json(raw) or {}
        verification = ClusterVerification(
            cluster_id=cid,
            page_indices=[m.slide_n for m in cluster.members],
            is_truly_same_template=bool(parsed.get("is_truly_same_template", True)),
            confidence=float(parsed.get("confidence") or 0.7),
            variance_description=str(parsed.get("variance_description") or "")[:200],
            proposed_name=str(parsed.get("proposed_name") or "")[:80],
        )
        out.append(verification)
        _cache_save(cl_dir, cid, asdict(verification))
    return out


# ── Stage A3 — Vision chart + table style extraction ──────────────────────


_A3_CHART_SYSTEM = """\
You see a slide that contains a chart. Read the chart carefully and
extract its visual style — the things that would let a designer
recreate this brand's chart aesthetic for ANY chart type (not just
the one shown).

Chart type vocab: column | bar | line | area | pie | donut | scatter | combo | other.

Series colors: hex codes IN PLOT ORDER (leftmost / first-drawn first).
If you can't read exact hex, give your best guess (#RRGGBB).

Respond with one JSON object, no prose, no fences:

{
  "chart_type": "<from vocab>",
  "series_colors": ["#RRGGBB", "#RRGGBB", ...],
  "gridline_color": "<hex or null>",
  "gridline_style": "solid" | "dotted" | "dashed" | "none" | null,
  "gridline_weight": "thin" | "medium" | "thick" | null,
  "legend_position": "top" | "bottom" | "left" | "right" | "none" | null,
  "legend_font_size": "small" | "medium" | "large" | null,
  "title_present": true | false,
  "title_typography": "<one short clause>" or null,
  "axis_font_size": "small" | "medium" | "large" | null,
  "axis_label_color": "<hex or null>",
  "data_labels_present": true | false,
  "data_label_format": "<format string or null>",
  "plot_area_fill": "<hex or null>",
  "plot_area_border": "<hex or null>",
  "background_color": "<hex or null>",
  "design_summary": "<one sentence designer description>",
  "confidence": 0.0 to 1.0
}
"""


def stage_a3_vision_chart_styles(
    docs_by_ref: dict[str, Any],
    observations: list[PageObservation],
    *,
    vision_call: Callable[[str, str, bytes | None], str],
    cache_dir: Path,
    max_pages: int = 60,
) -> list[VisionChartStyle]:
    """For each page A1 flagged has_chart=True, send a vision call to
    extract the chart's style. Skipped on pages where the Bridge model
    already has structured BridgeCharts (Layer 1 wins)."""
    styles_dir = cache_dir / "styles"
    styles_dir.mkdir(parents=True, exist_ok=True)

    # Build lookup of slides by slide_n
    slide_lookup: dict[int, Any] = {}
    for doc in docs_by_ref.values():
        for s in (doc.slides or []):
            slide_lookup[s.slide_number] = s

    out: list[VisionChartStyle] = []
    chart_pages = [o for o in observations if o.has_chart][:max_pages]
    log.info("A3: extracting chart style from %d pages", len(chart_pages))
    for obs in chart_pages:
        slide = slide_lookup.get(obs.slide_n)
        if not slide: continue

        # Skip pages where structured BridgeChart already exists (Layer 1 wins)
        has_structured = any(
            getattr(el, "element_type", None) == "BridgeChart"
            for el in (slide.elements or [])
        )
        if has_structured:
            log.debug("A3 page %d: structured BridgeChart exists, skipping vision", obs.slide_n)
            continue

        key = f"chart_p{obs.slide_n:04}"
        cached = _cache_load(styles_dir, key)
        if cached:
            try:
                out.append(VisionChartStyle(**cached))
                continue
            except TypeError:
                pass

        try:
            png = _render_slide_to_png_bytes(slide, dpi=120)
        except Exception as exc:
            log.warning("A3 page %d: render failed: %s", obs.slide_n, exc)
            continue
        user = (
            f"Slide {obs.slide_n}. {obs.composition_pattern}. "
            "Extract this chart's visual style. Output the JSON spec."
        )
        try:
            raw = vision_call(_A3_CHART_SYSTEM, user, png)
        except Exception as exc:
            log.warning("A3 page %d: vision failed: %s", obs.slide_n, exc)
            continue
        parsed = _parse_json(raw) or {}
        style = VisionChartStyle(
            slide_n=obs.slide_n,
            chart_type=str(parsed.get("chart_type") or "other"),
            series_colors=[str(c)[:7] for c in (parsed.get("series_colors") or [])][:10],
            gridline_color=parsed.get("gridline_color"),
            gridline_style=parsed.get("gridline_style"),
            gridline_weight=parsed.get("gridline_weight"),
            legend_position=parsed.get("legend_position"),
            legend_font_size=parsed.get("legend_font_size"),
            title_present=bool(parsed.get("title_present", False)),
            title_typography=parsed.get("title_typography"),
            axis_font_size=parsed.get("axis_font_size"),
            axis_label_color=parsed.get("axis_label_color"),
            data_labels_present=bool(parsed.get("data_labels_present", False)),
            data_label_format=parsed.get("data_label_format"),
            plot_area_fill=parsed.get("plot_area_fill"),
            plot_area_border=parsed.get("plot_area_border"),
            background_color=parsed.get("background_color"),
            design_summary=str(parsed.get("design_summary") or "")[:300],
            confidence=float(parsed.get("confidence") or 0.7),
        )
        out.append(style)
        _cache_save(styles_dir, key, asdict(style))
    return out


_A3_TABLE_SYSTEM = """\
You see a slide containing a table. Extract the table's visual style
so we can recreate this brand's table aesthetic.

Table-use vocab: agenda | kpi_grid | comparison | data_dump | other.

Respond with one JSON object, no prose, no fences:

{
  "table_use": "<vocab>",
  "rows_observed": <int>,
  "cols_observed": <int>,
  "header_fill": "<hex or null>",
  "header_font_color": "<hex or null>",
  "header_alignment": "left" | "center" | "right" | null,
  "banded_rows": true | false,
  "band_a": "<hex or null>",
  "band_b": "<hex or null>",
  "border_color": "<hex or null>",
  "border_style": "solid" | "dotted" | "none" | null,
  "cell_alignment": "left" | "center" | "right" | null,
  "first_col_emphasis": true | false,
  "design_summary": "<one sentence>",
  "confidence": 0.0 to 1.0
}
"""


def stage_a3_vision_table_styles(
    docs_by_ref: dict[str, Any],
    observations: list[PageObservation],
    *,
    vision_call: Callable[[str, str, bytes | None], str],
    cache_dir: Path,
    max_pages: int = 30,
) -> list[VisionTableStyle]:
    styles_dir = cache_dir / "styles"
    styles_dir.mkdir(parents=True, exist_ok=True)
    slide_lookup: dict[int, Any] = {}
    for doc in docs_by_ref.values():
        for s in (doc.slides or []):
            slide_lookup[s.slide_number] = s

    out: list[VisionTableStyle] = []
    table_pages = [o for o in observations if o.has_table][:max_pages]
    log.info("A3: extracting table style from %d pages", len(table_pages))
    for obs in table_pages:
        slide = slide_lookup.get(obs.slide_n)
        if not slide: continue
        has_structured = any(
            getattr(el, "element_type", None) == "BridgeTable"
            for el in (slide.elements or [])
        )
        if has_structured:
            continue
        key = f"table_p{obs.slide_n:04}"
        cached = _cache_load(styles_dir, key)
        if cached:
            try:
                out.append(VisionTableStyle(**cached))
                continue
            except TypeError:
                pass
        try:
            png = _render_slide_to_png_bytes(slide, dpi=120)
        except Exception:
            continue
        user = f"Slide {obs.slide_n}. Extract this table's visual style."
        try:
            raw = vision_call(_A3_TABLE_SYSTEM, user, png)
        except Exception as exc:
            log.warning("A3 table %d: %s", obs.slide_n, exc)
            continue
        parsed = _parse_json(raw) or {}
        style = VisionTableStyle(
            slide_n=obs.slide_n,
            table_use=str(parsed.get("table_use") or "data_dump"),
            rows_observed=int(parsed.get("rows_observed") or 0),
            cols_observed=int(parsed.get("cols_observed") or 0),
            header_fill=parsed.get("header_fill"),
            header_font_color=parsed.get("header_font_color"),
            header_alignment=parsed.get("header_alignment"),
            banded_rows=bool(parsed.get("banded_rows", False)),
            band_a=parsed.get("band_a"),
            band_b=parsed.get("band_b"),
            border_color=parsed.get("border_color"),
            border_style=parsed.get("border_style"),
            cell_alignment=parsed.get("cell_alignment"),
            first_col_emphasis=bool(parsed.get("first_col_emphasis", False)),
            design_summary=str(parsed.get("design_summary") or "")[:300],
            confidence=float(parsed.get("confidence") or 0.7),
        )
        out.append(style)
        _cache_save(styles_dir, key, asdict(style))
    return out


# ── Top-level orchestrator ────────────────────────────────────────────────


def agentic_onboard(
    docs_by_ref: dict[str, Any],
    slug: str,
    *,
    vision_call: Callable[[str, str, bytes | None], str],
    cache_dir: Path | None = None,
    progress_cb: Callable[[int, int], None] | None = None,
    max_chart_pages: int = 60,
    max_table_pages: int = 30,
) -> OnboardResult:
    """Run stages A1-A3 — the vision-led perception layer that goes
    BEFORE v3's existing semantic/style/render phases."""
    cache_dir = cache_dir or _cache_root(slug)
    log.info("agentic_onboard[%s]: cache dir = %s", slug, cache_dir)
    t0 = time.time()

    # Stage A1 — every page sees a vision call
    observations = stage_a1_per_page_inventory(
        docs_by_ref, vision_call=vision_call,
        cache_dir=cache_dir, progress_cb=progress_cb,
    )

    # Stages A2 needs the clusters from v3.phase_a_cluster_slides — we
    # compute them here so we have one place that owns the agentic
    # input shape. Cluster verification is informational for v3 today
    # (we surface it via OnboardResult) but doesn't block.
    from percy.agent import template_induction_v3 as _v3
    clusters = _v3.phase_a_cluster_slides(docs_by_ref)
    cluster_verifications = stage_a2_cluster_verify(
        clusters, docs_by_ref,
        vision_call=vision_call, cache_dir=cache_dir,
    )

    # Stage A3 — vision style extraction for charts + tables
    vision_charts = stage_a3_vision_chart_styles(
        docs_by_ref, observations,
        vision_call=vision_call, cache_dir=cache_dir,
        max_pages=max_chart_pages,
    )
    vision_tables = stage_a3_vision_table_styles(
        docs_by_ref, observations,
        vision_call=vision_call, cache_dir=cache_dir,
        max_pages=max_table_pages,
    )

    log.info("agentic_onboard[%s]: done in %.1fs — %d pages, %d charts, %d tables",
             slug, time.time() - t0, len(observations),
             len(vision_charts), len(vision_tables))

    return OnboardResult(
        slug=slug,
        page_observations=observations,
        cluster_verifications=cluster_verifications,
        vision_chart_styles=vision_charts,
        vision_table_styles=vision_tables,
        total_vision_calls=len(observations) + len(cluster_verifications) + len(vision_charts) + len(vision_tables),
        cache_dir=str(cache_dir),
    )
