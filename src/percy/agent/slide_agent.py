"""Two-phase slide-creation agent.

The unit of work is ONE slide. Replaces the previous "give the LLM the
whole catalog + ask for `applications` JSON" path with a sharper flow:

  Phase 1 — STRATEGY (small prompt, compact catalog)
    Show the agent only NAMES + DESCRIPTIONS of full-slide templates
    in the active set. Decide one of:
      * "template"  — pick a full-slide template by id
      * "custom"    — no slide template fits; build the slide from
                      scratch using element templates + primitives

  Phase 2 — EXECUTION (focused prompt, returns Python)
    The agent returns a Python script. Two variants:

    Phase 2A (template path)
      Show the chosen template's full inputs schema. The script
      typically calls `apply_template(<id>, inputs={...})` plus maybe
      a couple of element-template `apply_template()`s for footers
      / sources, or a data-fetch + transformation prelude.

    Phase 2B (custom path)
      Show ALL element templates' inputs + the create_* primitives.
      The script composes the slide element-by-element, free to:
        * fetch live data via stdlib (urllib + json)
        * compute derived values, format numbers
        * call element-template apply_template()s with explicit
          left/top/width/height to compose the layout
        * fall through to raw create_shape / create_text / create_chart /
          create_table for anything templates don't cover

Both Phase-2 variants produce Python that runs in a curated globals
dict — same primitives, same `slide_n`, same `studio`. The vision-pass
critic runs after execution, unchanged.

Why two phases instead of one big call?

  * Phase 1's catalog stays tiny (one line per template) so it scales
    to 50+ templates without prompt bloat.
  * Phase 2 gets focused context — either ONE template's schema, or
    ALL element templates without the slide-templates noise.
  * Picking strategy first lets us route to specialist sub-agents
    later (e.g. a chart-specialist Phase-2B for chart-heavy slides).
"""

from __future__ import annotations

import json
import logging
import re
import textwrap
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── Result shapes ──────────────────────────────────────────────────────────


@dataclass(slots=True)
class SlideStrategy:
    """Output of Phase 1."""
    kind: str                              # 'template' | 'custom'
    template_id: str = ""                  # set when kind=='template'
    rationale: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "template_id": self.template_id,
                "rationale": self.rationale}


@dataclass(slots=True)
class SlidePlan:
    """Final plan: strategy + executable Python."""
    slot: int
    strategy: SlideStrategy
    code: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot": self.slot,
            "strategy": self.strategy.to_dict(),
            "code": self.code,
            "error": self.error,
        }


@dataclass(slots=True)
class SlideExecutionResult:
    ok: bool
    error: str | None = None
    elements_created: int = 0
    stdout: str = ""
    review_followup_code: str = ""
    review_followup_ok: bool | None = None
    placeholders_dropped: int = 0


# ── Phase 1 — strategy selection ──────────────────────────────────────────


_PHASE1_SYSTEM = """\
You are choosing how to build ONE slide of a deck.

You see:
  * The deck's overall summary (context).
  * THIS slide's slot number and a short instruction with specific
    copy + data quoted inline.
  * A catalog of full-slide templates available in the active set.
    Each entry is one line: id, name, short description.
  * Whether element-level templates are also available for a "custom"
    composition.

Pick exactly one strategy:

  1. "template" — A specific slide-template fits the instruction's
     shape AND content type. Match by *what the slide IS doing*
     (cover, headline metric, KPI grid, bar chart, table, narrative,
     close), not just by available content fields. If the instruction
     calls for a CHART or TABLE and a chart/table template exists,
     STRONGLY prefer that template.

  2. "custom" — No slide template fits well, OR the instruction
     requires composing several focused element templates with
     custom positioning, OR the slide needs computed/live data
     that the slide templates don't model.

Respond with one JSON object, no prose, no fences:

{
  "kind": "template" | "custom",
  "template_id": "<one of the catalog ids — required if kind==template>",
  "rationale": "<one short sentence — why>"
}
"""


def _phase1_select(
    *,
    spec_slot: int,
    spec_instruction: str,
    deck_summary: str,
    slide_template_catalog: list[dict[str, Any]],
    element_templates_exist: bool,
    llm_call: Callable[[str, str], str],
) -> SlideStrategy:
    """One LLM call to pick template vs custom."""
    # Catalog shape: every metadata field a Phase-B6 enriched template
    # carries lands here so the strategy LLM can match by use_when /
    # avoid_when, not just by name. Templates without the new metadata
    # fall through to the legacy `description`-only view via the
    # `or` fallbacks.
    catalog_lines = []
    for t in slide_template_catalog:
        tags = ", ".join((t.get("tags") or [])[:4])
        catalog_lines.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "short_description": (t.get("short_description") or t.get("description") or "")[:200],
            "long_description":  (t.get("long_description") or "")[:400],
            "use_when":          (t.get("use_when") or "")[:200],
            "avoid_when":        (t.get("avoid_when") or "")[:200],
            "tags": tags,
            "kinds": sorted({e.get("kind") for e in (t.get("layout") or [])}),
        })

    user = json.dumps({
        "slot": spec_slot,
        "instruction": spec_instruction,
        "deck_summary": deck_summary,
        "slide_templates": catalog_lines,
        "element_templates_available": element_templates_exist,
    }, ensure_ascii=False, default=str)

    try:
        raw = llm_call(_PHASE1_SYSTEM, user)
    except Exception as exc:
        log.warning("phase1[slot=%d]: LLM call failed: %s", spec_slot, exc)
        return SlideStrategy(kind="custom", rationale=f"phase1 failed: {exc}")

    parsed = _parse_json(raw)
    if not parsed:
        log.warning("phase1[slot=%d]: unparseable response: %r", spec_slot, (raw or "")[:200])
        return SlideStrategy(kind="custom", rationale="phase1 unparseable")

    kind = str(parsed.get("kind") or "").lower()
    tid  = str(parsed.get("template_id") or "")
    rat  = str(parsed.get("rationale") or "")[:200]
    valid_ids = {t.get("id") for t in slide_template_catalog}

    if kind == "template" and tid in valid_ids:
        return SlideStrategy(kind="template", template_id=tid, rationale=rat)
    return SlideStrategy(kind="custom", rationale=rat or "no slide template matched")


# ── Phase 2 — code generation ──────────────────────────────────────────────


_PHASE2A_SYSTEM = """\
You are filling in ONE full-slide template to render a specific slide.

You see:
  * The slide instruction (specific copy + data in quotes).
  * The chosen template's id, name, description, AND its full input
    schema with each input's type, default, and description.
  * Optional element templates you may stack ON TOP afterwards
    (sources, footers, callouts).

Write a Python script that materializes the slide. Available helpers:

  apply_template(template_id, inputs={...})
      Materializes a template onto the current slide. inputs is a dict
      of {input_name: value}. Returns {ok, elements: [...], errors: [...]}.

  create_shape(left, top, width, height, **kwargs)
  create_text(left, top, width, height, text, **kwargs)
  create_chart(left, top, width, height, chart_type, categories, series, **kwargs)
  create_table(left, top, width, height, data, **kwargs)
      Raw primitives for anything templates don't cover. Coordinates
      in inches. Canvas is 13.333 x 7.5 inches.

  slide_n
      The slide number you're building (already set).

  Standard library is available — urllib.request + json for live API
  data, datetime for timestamps, math for derived values. Do NOT
  import third-party packages.

Style:
  * Pull copy + data FROM THE INSTRUCTION VERBATIM (don't invent).
  * For inputs the schema declares but the instruction doesn't
    address, just omit them — defaults will fill in.
  * Use the alias-prefixed inputs (e.g. `text_placeholder_7_text`)
    when overriding template content. Schema descriptions tell you
    which alias holds which slot.
  * Do NOT import third-party packages. Standard library only.
  * Don't leave `[CHART GOES HERE]` placeholder text — actually call
    create_chart() with real data from the instruction.
  * If you create_chart(), chart_type MUST be one of:
    column_clustered, bar_clustered, line, area_stacked, pie, doughnut.

Respond with ONE Python code block, no prose around it, no markdown
fences. Just the Python source.
"""


_PHASE2B_SYSTEM = """\
You are building ONE slide from scratch using element-level
templates and raw create_* primitives. No full-slide template fits,
so you have full control of composition.

You see:
  * The slide instruction (specific copy + data in quotes).
  * Available element templates — each is a small reusable
    component (a title block, a KPI tile, a footer line, a chart-
    with-baked-styling). Listed with id, name, description, and
    inputs schema.

Write a Python script. Available helpers:

  apply_template(template_id, inputs={...})
      Apply an element template. Override its geometry with
      `<alias>_left`, `<alias>_top`, `<alias>_width`, `<alias>_height`
      inputs (inches). Override font_size with `<alias>_font_size`
      (pt). Override text with `<alias>_text`. Override chart data
      with `<alias>_categories` + `<alias>_series`. Defaults preserve
      the brand's geometry + styling from the source slide.

  create_shape(left, top, width, height, fill_color="#hex", text="...")
  create_text(left, top, width, height, text="...", font_size=pt)
  create_chart(left, top, width, height, chart_type, categories, series, title?, legend?)
      chart_type MUST be exactly one of:
        "column_clustered"   (vertical bars, default for time series)
        "bar_clustered"      (horizontal bars)
        "line"               (line chart)
        "area_stacked"       (stacked area)
        "pie"                (pie)
        "doughnut"           (donut — also needs hole_size=50)
      categories: list[str], series: list[{name: str, values: list[number], color?: hex}]
      legend (optional): {"position": "bottom"|"right"|"top"|"left"}
  create_table(left, top, width, height, data=[[...], ...], first_row_header=True)

  slide_n
      The current slide number.

Canvas is 13.333 x 7.5 inches. Origin (0, 0) is top-left.

Style:
  * Pull copy + numbers FROM THE INSTRUCTION VERBATIM.
  * Don't overlap elements — compute positions so each occupies
    its own region.
  * For data slides, ALWAYS use create_chart / create_table for
    the data (never fake it as text).
  * Standard library only. urllib.request + json for live data.
    Do NOT import third-party packages — no pptx, no pandas, no
    numpy, no matplotlib, no anthropic.
  * apply_template(template_id, ...) requires an EXACT template_id
    that appears in the catalog above. Don't invent or shorten ids.
  * Keep the script tight — no helpful comments, no print
    statements except for status if useful.

Respond with ONE Python code block, no prose around it, no markdown
fences. Just the Python source.
"""


def _phase2_template(
    *,
    spec_slot: int,
    spec_instruction: str,
    deck_summary: str,
    chosen_template: dict[str, Any],
    element_templates: list[dict[str, Any]],
    llm_call: Callable[[str, str], str],
) -> str:
    """Generate Python that calls apply_template for the chosen template."""
    elem_catalog = [
        {
            "id": t.get("id"),
            "name": t.get("name"),
            "description": (t.get("description") or "")[:140],
            "inputs": _content_inputs_for_catalog(t.get("inputs_schema") or {}),
        }
        for t in (element_templates or [])[:20]
    ]

    user = json.dumps({
        "slot": spec_slot,
        "instruction": spec_instruction,
        "deck_summary": deck_summary,
        "chosen_template": {
            "id": chosen_template.get("id"),
            "name": chosen_template.get("name"),
            "short_description": chosen_template.get("short_description") or chosen_template.get("description"),
            "long_description":  chosen_template.get("long_description") or "",
            "use_when":          chosen_template.get("use_when") or "",
            "avoid_when":        chosen_template.get("avoid_when") or "",
            "inputs_schema": chosen_template.get("inputs_schema") or {},
            "sample_inputs": chosen_template.get("sample_inputs") or {},
        },
        "element_templates": elem_catalog,
    }, ensure_ascii=False, default=str)[:24000]

    raw = llm_call(_PHASE2A_SYSTEM, user)
    return _extract_python(raw)


def _phase2_custom(
    *,
    spec_slot: int,
    spec_instruction: str,
    deck_summary: str,
    element_templates: list[dict[str, Any]],
    llm_call: Callable[[str, str], str],
) -> str:
    """Generate Python for a free-composition slide."""
    elem_catalog = []
    for t in (element_templates or [])[:40]:
        layout = t.get("layout") or []
        first_kind = layout[0].get("kind") if layout else None
        elem_catalog.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "description": (t.get("description") or "")[:160],
            "kind": first_kind,
            "inputs": _content_inputs_for_catalog(t.get("inputs_schema") or {}),
        })

    user = json.dumps({
        "slot": spec_slot,
        "instruction": spec_instruction,
        "deck_summary": deck_summary,
        "element_templates": elem_catalog,
    }, ensure_ascii=False, default=str)[:24000]

    raw = llm_call(_PHASE2B_SYSTEM, user)
    return _extract_python(raw)


# ── Public entry: plan_slide ──────────────────────────────────────────────


def _is_slide_template(t: dict[str, Any]) -> bool:
    """Heuristic: 'slide' kind wins; otherwise count elements (>=3 = slide)."""
    if (t.get("kind") or "").lower() == "slide":
        return True
    if (t.get("kind") or "").lower() == "element":
        return False
    return len(t.get("layout") or []) >= 3


def plan_slide(
    *,
    spec: Any,                                     # SlideSpec from deck_planner
    deck_summary: str,
    brand_constraints: dict[str, Any],
    available_templates: list[dict[str, Any]],
    llm_call: Callable[[str, str], str],
) -> SlidePlan:
    """Two-phase plan: strategy selection → code generation."""
    slide_tpls = [t for t in available_templates if _is_slide_template(t)]
    elem_tpls  = [t for t in available_templates if not _is_slide_template(t)]

    strategy = _phase1_select(
        spec_slot=spec.slot,
        spec_instruction=spec.instruction,
        deck_summary=deck_summary,
        slide_template_catalog=slide_tpls,
        element_templates_exist=bool(elem_tpls),
        llm_call=llm_call,
    )

    try:
        if strategy.kind == "template":
            tpl = next((t for t in slide_tpls if t.get("id") == strategy.template_id), None)
            if not tpl:
                # Fall through to custom path if id resolution failed.
                code = _phase2_custom(
                    spec_slot=spec.slot, spec_instruction=spec.instruction,
                    deck_summary=deck_summary, element_templates=elem_tpls,
                    llm_call=llm_call,
                )
                strategy = SlideStrategy(kind="custom",
                                         rationale=f"phase1 returned unknown id; fell back")
            else:
                code = _phase2_template(
                    spec_slot=spec.slot, spec_instruction=spec.instruction,
                    deck_summary=deck_summary, chosen_template=tpl,
                    element_templates=elem_tpls, llm_call=llm_call,
                )
        else:
            code = _phase2_custom(
                spec_slot=spec.slot, spec_instruction=spec.instruction,
                deck_summary=deck_summary, element_templates=elem_tpls,
                llm_call=llm_call,
            )
    except Exception as exc:
        log.exception("plan_slide[slot=%d]: phase 2 failed", spec.slot)
        return SlidePlan(slot=spec.slot, strategy=strategy, code="", error=str(exc))

    if not code.strip():
        return SlidePlan(slot=spec.slot, strategy=strategy, code="",
                         error="phase 2 returned empty code")
    return SlidePlan(slot=spec.slot, strategy=strategy, code=code)


# ── Execution sandbox ──────────────────────────────────────────────────────


def execute_plan(
    plan: SlidePlan,
    *,
    studio: Any,
    slide_n: int,
    all_templates: list[dict[str, Any]],
    spec: Any = None,                         # SlideSpec — for Phase 2.5 review
    llm_call: Callable[[str, str], str] | None = None,
    self_review: bool = True,
) -> SlideExecutionResult:
    """Run the generated Python against a curated globals dict.

    Helpers exposed:
      * apply_template(template_id, inputs={...})
      * create_shape, create_text, create_chart, create_table
      * slide_n

    Standard library is fully available. The script runs in-process —
    no separate worker, no subprocess. Errors are captured + returned.
    """
    from percy.agent import templates as _tpls

    by_id = {t.get("id"): t for t in all_templates if t.get("id")}
    elements_total = 0

    def apply_template(template_id: str, inputs: dict | None = None) -> dict:
        nonlocal elements_total
        tpl = by_id.get(template_id)
        if not tpl:
            raise ValueError(f"template {template_id!r} not in active set")
        result = _tpls.apply_template(
            tpl, studio=studio, slide_n=slide_n, inputs=dict(inputs or {}),
        )
        elements_total += len(result.get("elements") or [])
        return result

    def _pos(left, top, width, height) -> dict:
        return {"left_in": float(left), "top_in": float(top),
                "width_in": float(width), "height_in": float(height)}

    def create_shape(left, top, width, height, **kwargs):
        nonlocal elements_total
        body = {"position": _pos(left, top, width, height), **kwargs}
        body.setdefault("geometry_preset", "rect")
        r = studio.create_element(slide_n, "shape", body)
        elements_total += 1
        return r

    def create_text(left, top, width, height, text="", **kwargs):
        nonlocal elements_total
        body = {"position": _pos(left, top, width, height), "text": text, **kwargs}
        r = studio.create_element(slide_n, "text", body)
        elements_total += 1
        return r

    def create_chart(left, top, width, height, chart_type, categories, series, **kwargs):
        nonlocal elements_total
        body = {"position": _pos(left, top, width, height),
                "chart_type": chart_type, "categories": list(categories or []),
                "series": list(series or []), **kwargs}
        r = studio.create_element(slide_n, "chart", body)
        elements_total += 1
        return r

    def create_table(left, top, width, height, data, **kwargs):
        nonlocal elements_total
        body = {"position": _pos(left, top, width, height),
                "data": [list(row) for row in (data or [])], **kwargs}
        r = studio.create_element(slide_n, "table", body)
        elements_total += 1
        return r

    g: dict[str, Any] = {
        "apply_template": apply_template,
        "create_shape": create_shape,
        "create_text": create_text,
        "create_chart": create_chart,
        "create_table": create_table,
        "slide_n": slide_n,
        "__builtins__": __builtins__,
    }

    import io, contextlib
    buf = io.StringIO()
    primary_error: str | None = None
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(plan.code, f"<slide-{slide_n}>", "exec"), g)
    except Exception as exc:
        tb = traceback.format_exc(limit=4)
        log.warning("execute_plan[slot=%d]: %s\n%s", slide_n, exc, tb)
        primary_error = f"{exc}\n{tb[-600:]}"

    # ── Post-pass 1: drop placeholder text elements ──
    placeholders_dropped = _drop_placeholder_elements(studio, slide_n)

    # ── Post-pass 2: Phase 2.5 self-review (optional) ──
    review_code = ""
    review_ok: bool | None = None
    review_rationale = ""
    if self_review and llm_call is not None and spec is not None and primary_error is None:
        try:
            current_elements = _read_slide_elements_for_cleanup(studio, slide_n)
            verdict, follow_code, rat = _phase25_review(
                spec_slot=slide_n,
                spec_instruction=getattr(spec, "instruction", ""),
                elements=current_elements,
                llm_call=llm_call,
            )
            review_rationale = rat
            log.info("phase25[slot=%d]: verdict=%s — %s",
                     slide_n, verdict, rat[:80])
            if verdict == "add" and follow_code.strip():
                review_code = follow_code
                try:
                    with contextlib.redirect_stdout(buf):
                        exec(compile(follow_code, f"<slide-{slide_n}-review>", "exec"), g)
                    review_ok = True
                    # Also strip any new placeholders the follow-up introduced.
                    placeholders_dropped += _drop_placeholder_elements(studio, slide_n)
                except Exception as exc:
                    log.warning("phase25[slot=%d]: follow-up code raised: %s", slide_n, exc)
                    review_ok = False
        except Exception as exc:
            log.debug("phase25[slot=%d]: review skipped due to %s", slide_n, exc)

    if primary_error:
        return SlideExecutionResult(
            ok=False, error=primary_error,
            elements_created=elements_total, stdout=buf.getvalue(),
            placeholders_dropped=placeholders_dropped,
        )
    return SlideExecutionResult(
        ok=True,
        elements_created=elements_total,
        stdout=buf.getvalue(),
        review_followup_code=review_code,
        review_followup_ok=review_ok,
        placeholders_dropped=placeholders_dropped,
    )


# ── Helpers ────────────────────────────────────────────────────────────────


_GEO_SUFFIXES = ("_left", "_top", "_width", "_height", "_font_size")


def _content_inputs_for_catalog(schema: dict[str, dict]) -> dict[str, str]:
    """Compact view of a template's content inputs for the Phase-2 prompt.

    Strips alias-prefixed geometry inputs (the LLM doesn't need to see
    every coordinate var when scanning a catalog of 40 templates) and
    keeps a short {name: description-or-type} for the rest.
    """
    out: dict[str, str] = {}
    for k, v in (schema or {}).items():
        if any(k.endswith(s) for s in _GEO_SUFFIXES):
            continue
        desc = ""
        if isinstance(v, dict):
            desc = (v.get("description") or v.get("type") or "")[:80]
        out[k] = desc
    return out


# ── Post-execution cleanup ─────────────────────────────────────────────────


_PLACEHOLDER_PATTERNS = [
    re.compile(r"^\s*\[[A-Z][A-Z\s\-_/]{2,}\]\s*$"),         # [CHART GOES HERE]
    re.compile(r"^\s*<[A-Z][A-Z\s\-_/]{2,}>\s*$"),           # <PLACEHOLDER>
    re.compile(r"^\s*\{\{[A-Za-z_][A-Za-z_0-9]*\}\}\s*$"),    # raw {{var}} leak
    re.compile(r"(?i)^\s*(todo|tbd|fixme|placeholder)[\s:.\-]*$"),
    re.compile(r"(?i)^\s*(chart|table|image|figure|graph|diagram|kpi)\s+(goes|here)"),
]


def _looks_like_placeholder(text: str) -> bool:
    if not isinstance(text, str):
        return False
    return any(p.search(text) for p in _PLACEHOLDER_PATTERNS)


def _drop_placeholder_elements(studio: Any, slide_n: int) -> int:
    """Walk the slide's elements after execution, delete ones whose text
    is clearly a placeholder leak from the LLM ("[CHART GOES HERE]",
    "<TITLE>", "TODO: ...", unresolved {{var}} leaks). Returns count
    of elements removed.

    Uses the studio /slides/{n}/elements endpoint to enumerate with
    real element ids, then text content via svg-data. The two endpoints
    return entries in the same order so we zip them.
    """
    try:
        listing = studio._get(f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements")
        svg = studio._get(f"/api/docs/{studio.doc_id}/slides/{slide_n}/svg-data")
    except Exception as exc:
        log.debug("drop_placeholders[slot=%d]: could not read slide: %s", slide_n, exc)
        return 0

    by_index: dict[int, str] = {}
    listing_elements = listing.get("elements") or []
    for i, el in enumerate(listing_elements):
        eid = el.get("id") or el.get("element_id") or el.get("shape_id")
        if eid:
            by_index[i] = str(eid)

    svg_elements = svg.get("elements") or []
    removed = 0
    for i, el in enumerate(svg_elements):
        runs = el.get("text_runs") or []
        text = "".join(r.get("text", "") for r in runs) if runs else (el.get("text") or "")
        if not text.strip():
            continue
        if not _looks_like_placeholder(text):
            continue
        eid = by_index.get(i)
        if not eid:
            continue
        try:
            studio._delete(f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements/{eid}")
            removed += 1
            log.info("drop_placeholders[slot=%d]: removed %r", slide_n, text[:60])
        except Exception as exc:
            log.debug("drop_placeholders[slot=%d]: delete %s failed: %s", slide_n, eid, exc)
    return removed


def _read_slide_elements_for_cleanup(studio: Any, slide_n: int) -> list[dict[str, Any]]:
    """Fetch element JSON from the studio for the cleanup pass."""
    try:
        data = studio._get(f"/api/docs/{studio.doc_id}/slides/{slide_n}/svg-data")
        return data.get("elements") or []
    except Exception:
        return []


# ── Phase 2.5 — self-review ────────────────────────────────────────────────


_PHASE25_SYSTEM = """\
You just generated a slide. Now review it.

You see:
  * The original slide instruction.
  * The list of elements currently on the slide — each with type,
    position, text content (if any), and key style fields.

Decide ONE of:

  * `done` — the slide reasonably fulfills the instruction. Don't
    over-engineer. If it has the headline + the data + the supporting
    copy that the instruction called for, it's fine. Most slides
    should be `done`.

  * `add` — something the instruction explicitly called for is
    MISSING (a chart, a specific KPI, a source line, a clear title).
    NOT for cosmetic preferences. Return Python code that adds the
    missing piece(s) using the same helpers available in Phase 2:
    apply_template, create_shape, create_text, create_chart,
    create_table. Don't repeat anything already on the slide.

Bias toward `done`. The cost of a `done` mistake is one slightly
sparse slide; the cost of `add` mistakes is overcrowding +
overlapping elements. If you must `add`, keep it to ONE new
element unless multiple are clearly needed.

The `code` field must use ONLY these helpers (already in scope) with
these EXACT signatures:

  apply_template(template_id: str, inputs: dict)
  create_shape(left, top, width, height, fill_color="#hex", text="")
  create_text(left, top, width, height, text="", font_size=None)
  create_chart(left, top, width, height, chart_type, categories, series, title=None, legend=None)
  create_table(left, top, width, height, data, first_row_header=True)
  slide_n   # int, current slot — already bound

All coordinates are in inches (canvas 13.333 × 7.5). chart_type
must be exactly one of: column_clustered, bar_clustered, line,
area_stacked, pie, doughnut. series is a list of dicts
{name, values, color?}.

Standard library is fine. Do NOT import third-party packages
(no pptx, pandas, numpy). Do NOT reference variables that aren't
defined above (no slide_5, no prs, no doc, no template). Use
slide_n for the current slot.

Respond with one JSON object, no prose, no fences:

{
  "verdict": "done" | "add",
  "code": "<Python script — required only when verdict=='add'>",
  "rationale": "<one short sentence — what's missing or why done>"
}
"""


def _phase25_review(
    *,
    spec_slot: int,
    spec_instruction: str,
    elements: list[dict[str, Any]],
    llm_call: Callable[[str, str], str],
) -> tuple[str, str, str]:
    """One LLM call: examine the current slide, decide done vs add.

    Returns: (verdict, follow_up_code, rationale)
    """
    # Compact element view — type, position, text, key style.
    compact: list[dict[str, Any]] = []
    for el in elements:
        runs = el.get("text_runs") or []
        text = "".join(r.get("text", "") for r in runs) if runs else (el.get("text") or "")
        pos = el.get("position") or {}
        entry: dict[str, Any] = {
            "type": el.get("type") or el.get("kind") or "?",
            "pos": [round(pos.get("left_in", 0), 2), round(pos.get("top_in", 0), 2),
                    round(pos.get("width_in", 0), 2), round(pos.get("height_in", 0), 2)],
        }
        if text:
            entry["text"] = text[:120]
        ct = el.get("chart_type")
        if ct:
            entry["chart_type"] = ct
            entry["categories"] = (el.get("categories") or [])[:6]
            entry["series_count"] = len(el.get("series") or [])
        td = el.get("table_dim")
        if td:
            entry["table_dim"] = td
        compact.append(entry)

    user = json.dumps({
        "slot": spec_slot,
        "instruction": spec_instruction,
        "current_elements": compact,
    }, ensure_ascii=False, default=str)[:18000]

    try:
        raw = llm_call(_PHASE25_SYSTEM, user)
    except Exception as exc:
        log.warning("phase25[slot=%d]: LLM call failed: %s", spec_slot, exc)
        return ("done", "", f"phase25 LLM failed: {exc}")

    parsed = _parse_json(raw)
    if not parsed:
        return ("done", "", "phase25 unparseable")

    verdict = str(parsed.get("verdict") or "done").lower()
    if verdict not in ("done", "add"):
        verdict = "done"
    code = _extract_python(parsed.get("code") or "") if verdict == "add" else ""
    rat  = str(parsed.get("rationale") or "")[:200]
    return (verdict, code, rat)


# ── JSON helpers ───────────────────────────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
_FENCE_RE      = re.compile(r"```(?:python|py|json)?\s*", re.IGNORECASE)


def _parse_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = _FENCE_RE.sub("", s)
        s = re.sub(r"\s*```\s*$", "", s)
    try:
        return json.loads(s)
    except Exception:
        pass
    m = _JSON_BLOCK_RE.search(s)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def _extract_python(text: str) -> str:
    """Strip fences + leading prose so the response is pure Python."""
    if not text:
        return ""
    s = text.strip()
    # Strip a leading fence
    if s.startswith("```"):
        s = _FENCE_RE.sub("", s, count=1)
        s = re.sub(r"\s*```\s*$", "", s)
    # If there's a fenced block deeper in, prefer it
    m = re.search(r"```(?:python|py)?\s*([\s\S]+?)```", text, re.IGNORECASE)
    if m and len(m.group(1).strip()) > len(s.strip()) * 0.5:
        s = m.group(1)
    return textwrap.dedent(s).strip()
