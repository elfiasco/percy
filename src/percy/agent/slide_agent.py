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
    catalog_lines = []
    for t in slide_template_catalog:
        tags = ", ".join((t.get("tags") or [])[:4])
        catalog_lines.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "description": (t.get("description") or "")[:200],
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
            "description": chosen_template.get("description"),
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
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(plan.code, f"<slide-{slide_n}>", "exec"), g)
    except Exception as exc:
        tb = traceback.format_exc(limit=4)
        log.warning("execute_plan[slot=%d]: %s\n%s", slide_n, exc, tb)
        return SlideExecutionResult(
            ok=False, error=f"{exc}\n{tb[-600:]}",
            elements_created=elements_total, stdout=buf.getvalue(),
        )

    return SlideExecutionResult(
        ok=True, elements_created=elements_total, stdout=buf.getvalue(),
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
