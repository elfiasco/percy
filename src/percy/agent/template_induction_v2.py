"""Multi-step agentic template induction.

Replacement for the v1 cluster-and-polish flow. The agent now drives the
induction in two distinct LLM phases per slide:

  Phase 1 — DISCOVERY (cheap, one call per slide):
    Agent reads a SUMMARY of each slide's elements (type, position, sample
    text, sizes — not the full structure). Agent decides:
      (a) Is this slide as a WHOLE an obviously-reusable full-slide
          template? Yes/no + a proposed name + tags.
      (b) Are there individual elements OR groups of elements on this
          slide that should be productionalized? For each: which
          element_ids, what kind ('element' or 'group'), what name.

  Phase 2 — AUTHORING (per accepted want, one call each):
    For every want returned in phase 1, a fresh LLM call sees the FULL
    Bridge element properties (every fill, font, run, position, shadow,
    line, alignment, body content). Agent writes a complete Template
    dict — deciding which formatting choices to bake in (preserve) and
    which to parameterize.

This design honors two constraints:
  * No prescriptive template list — the agent names freely. Hints
    surface in the discovery prompt ("look for the obvious ones —
    slide titles, footers, KPI tiles, callouts — but call out anything
    unique to this deck").
  * Full fidelity — phase 2 sees the actual Bridge data, not a fingerprint.
    The agent can preserve exact font sizes, colors, geometry — anything.

Output: list of TemplateCandidate dicts compatible with v1's accept-flow.
Dedupe is done after both phases by normalizing names + comparing layouts.

Costs roughly: 1 + N LLM calls per slide where N = wants. For a 25-slide
deck producing ~30 wants total, that's ~55 calls. At Bedrock Sonnet 4.6
list price (~$0.003/1K input, ~$0.015/1K output, ~2K tokens/call) this
is ~$0.50-$1.50 per deck mined — worth it for the quality lift.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── Per-element / per-slide summaries (compact for phase 1) ─────────────────


def _summarize_element_compact(el: Any) -> dict[str, Any]:
    """Compact JSON summary for phase 1. Just type, position, sample text,
    fill type — enough for the agent to recognize patterns without choking
    on full ColorSpec / TextRun trees.
    """
    pos = getattr(el, "position", None)
    ident = getattr(el, "identification", None)
    summary = {
        "id": getattr(ident, "shape_id", None) if ident else None,
        "type": getattr(el, "element_type", el.__class__.__name__),
        "name": getattr(ident, "shape_name", None) if ident else None,
        "pos": {
            "left": round(getattr(pos, "left", 0), 2),
            "top": round(getattr(pos, "top", 0), 2),
            "width": round(getattr(pos, "width", 0), 2),
            "height": round(getattr(pos, "height", 0), 2),
        } if pos else None,
    }
    # Sample text content
    text_chunks: list[str] = []
    for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
        cur = el
        for a in path.split("."):
            cur = getattr(cur, a, None)
            if cur is None: break
        for para in (cur or [])[:3]:
            for run in (getattr(para, "runs", None) or []):
                t = getattr(run, "text", None)
                if t: text_chunks.append(t)
    if text_chunks:
        joined = " ".join(text_chunks)
        summary["text"] = joined[:120] + ("…" if len(joined) > 120 else "")
        sizes = []
        for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
            cur = el
            for a in path.split("."):
                cur = getattr(cur, a, None)
                if cur is None: break
            for para in (cur or []):
                for run in (getattr(para, "runs", None) or []):
                    fs = getattr(run, "font_size", None)
                    if fs: sizes.append(fs)
        if sizes:
            summary["max_font_size"] = max(sizes)
    # Fill flag (for phase 1 — the agent can guess whether this looks like a
    # filled card vs raw text)
    fill = getattr(el, "fill", None)
    if fill:
        ft = getattr(fill, "fill_type", None)
        if ft and ft != "none":
            summary["has_fill"] = True
    # Chart / table flag
    et = summary["type"]
    if et == "BridgeChart":
        summary["chart_type"] = getattr(el, "chart_type", None)
    elif et == "BridgeTable":
        data = getattr(el, "data", None) or []
        summary["table_dim"] = [len(data), len(data[0]) if data else 0]
    return summary


def _summarize_slide_compact(slide: Any) -> dict[str, Any]:
    """One slide's compact JSON summary for phase 1."""
    return {
        "slide_n": getattr(slide, "slide_number", None),
        "element_count": len(slide.elements or []),
        "elements": [_summarize_element_compact(el) for el in (slide.elements or [])],
    }


# ── Full-fidelity element JSON (for phase 2) ───────────────────────────────


def _full_element_json(el: Any) -> dict[str, Any]:
    """Walk every public attribute on the element and dump as JSON-friendly
    dict. The agent needs every detail to faithfully preserve formatting."""
    from dataclasses import is_dataclass, fields

    def walk(o: Any, depth: int = 0) -> Any:
        if depth > 6:
            return f"<too-deep:{type(o).__name__}>"
        if o is None or isinstance(o, (str, int, float, bool)):
            return o
        if isinstance(o, (list, tuple)):
            return [walk(x, depth + 1) for x in o]
        if isinstance(o, dict):
            return {k: walk(v, depth + 1) for k, v in o.items()}
        if hasattr(o, "resolve") and callable(o.resolve):
            # ColorSpec → resolved hex if possible, with original token preserved
            try:
                hex_v = o.resolve({})
                return {"value": getattr(o, "value", None), "hex": hex_v}
            except Exception:
                return {"value": getattr(o, "value", None)}
        if isinstance(o, bytes):
            return f"<bytes:{len(o)}>"
        if is_dataclass(o):
            out: dict[str, Any] = {"__type__": type(o).__name__}
            for f in fields(o):
                val = getattr(o, f.name)
                # Skip giant blobs that aren't useful for template authoring.
                if f.name in ("image_bytes", "embedded_workbook_bytes",
                              "chart_xml_blob", "chart_excel_blob",
                              "reconstruction_blobs", "overlay_files"):
                    continue
                out[f.name] = walk(val, depth + 1)
            return out
        # Last resort
        try:
            return str(o)[:200]
        except Exception:
            return f"<{type(o).__name__}>"

    return walk(el)


# ── Phase 1: per-slide discovery ───────────────────────────────────────────


@dataclass(slots=True)
class _Want:
    """One thing the agent thinks should become a template."""
    kind: str                            # 'full_slide' | 'element' | 'group'
    name: str
    description: str
    tags: list[str] = field(default_factory=list)
    element_ids: list[str] = field(default_factory=list)  # which BridgeElements to use
    slide_n: int = 0


_DISCOVERY_SYSTEM = """\
You are Percy's template induction agent, doing Phase 1: DISCOVERY.

You will see ONE slide's element summary (types, positions, sample text,
font sizes, fill flags). Your job is to decide what's worth saving as a
reusable template.

There are two categories you may return:

  1. **full_slide** — set this when the WHOLE slide layout is obviously
     reusable (a title slide, a section divider, a comparison layout, a
     KPI dashboard, etc.). At most ONE full_slide per slide. Be selective —
     most slides are content-specific and shouldn't become templates.
     Don't force a full_slide if nothing obviously reusable is present;
     element-level templates compose into decks better than half-fit
     slide templates.

  2. **elements** — individual elements OR small groups (≤ 5 elements)
     that would be useful as reusable pieces. Look for:
       - Slide titles, section eyebrows, subtitles
       - Footers (rectangle + page number + text)
       - KPI tiles, callout boxes, status pills
       - Chart titles + accent rules
       - Bottom notes, source citations
       - Anything unique to this deck (e.g. a distinctive corner badge,
         a custom data-driven group)

     For each element-want, list the element `id`s that compose it.
     Single-element wants have one id; group wants have multiple.

Respond with a single JSON object — no prose, no fences:

{
  "full_slide": null | {
    "name": "<short name, 2-5 words>",
    "description": "<one sentence>",
    "tags": ["<tag>", ...]
  },
  "elements": [
    {
      "kind": "element" | "group",
      "name": "<short name>",
      "description": "<one sentence>",
      "tags": ["<tag>", ...],
      "element_ids": [<id>, <id>, ...]
    },
    ...
  ]
}

If nothing on this slide is template-worthy, return:
  {"full_slide": null, "elements": []}
"""


def discover_slide_wants(
    slide: Any, *, llm_call: Callable[[str, str], str],
) -> list[_Want]:
    """Phase 1 — single LLM call per slide."""
    summary = _summarize_slide_compact(slide)
    if summary["element_count"] < 1:
        return []
    user = json.dumps(summary, ensure_ascii=False)[:8000]
    try:
        raw = llm_call(_DISCOVERY_SYSTEM, user)
    except Exception as exc:
        log.warning("discover_slide_wants[%s]: LLM failed: %s",
                    summary["slide_n"], exc)
        return []
    parsed = _parse_json_response(raw)
    if not parsed:
        return []
    wants: list[_Want] = []
    fs = parsed.get("full_slide")
    if isinstance(fs, dict) and fs.get("name"):
        wants.append(_Want(
            kind="full_slide",
            name=str(fs.get("name") or "")[:80],
            description=str(fs.get("description") or "")[:300],
            tags=list(fs.get("tags") or [])[:6],
            element_ids=[str(getattr(el.identification, "shape_id", "") or "")
                         for el in (slide.elements or [])],
            slide_n=int(summary["slide_n"] or 0),
        ))
    for entry in (parsed.get("elements") or []):
        if not isinstance(entry, dict):
            continue
        wants.append(_Want(
            kind=str(entry.get("kind") or "element"),
            name=str(entry.get("name") or "")[:80],
            description=str(entry.get("description") or "")[:300],
            tags=list(entry.get("tags") or [])[:6],
            element_ids=[str(x) for x in (entry.get("element_ids") or [])],
            slide_n=int(summary["slide_n"] or 0),
        ))
    return wants


# ── Phase 2: per-want authoring ────────────────────────────────────────────


_AUTHORING_SYSTEM = """\
You are Percy's template induction agent, doing Phase 2: AUTHORING.

You will see ONE want (a slide or element you previously flagged) plus
the FULL Bridge data for the relevant element(s). Your job is to write a
complete Template dict that captures the formatting faithfully.

Key decisions per template:

  1. **What to bake in** — formatting choices that DEFINE the brand voice
     should be preserved verbatim (exact colors, exact font sizes, exact
     positions for layout templates, decorative shapes).

  2. **What to parameterize** — content fields that vary by use should
     become inputs: title text, body text, numeric values, dates,
     attribution lines. Use {{var}} substitution.

  3. **Naming** — concise, action-oriented (e.g. "Sales KPI Tile",
     "Section Divider with Number"). Avoid generic names like
     "Element 1".

  4. **Inputs schema** — list every input you parameterized. Each entry:
     {type: "string"|"list"|"float"|"bool", required: bool, default: <val>,
      description: "<one line>"}

  5. **Sample inputs** — realistic placeholder values that show what the
     template is for.

Respond with a single JSON object — no prose, no fences:

{
  "keep": true | false,
  "name": "<concise name>",
  "description": "<one-sentence purpose>",
  "tags": ["<tag>", ...],
  "inputs_schema": {<key>: {type, required, default, description}, ...},
  "sample_inputs": {<key>: <value>, ...},
  "layout": [
    {
      "kind": "shape" | "text" | "chart" | "table" | "connector" | "image-typed",
      "alias": "<short-alias>",
      "body": { ... full create_<kind> body with {{var}} substitutions ... }
    },
    ...
  ]
}

The `body` shape mirrors the create_<kind> endpoint bodies:
  - kind=shape:  {geometry_preset, position{left_in, top_in, width_in,
                  height_in}, fill_color, line, name, text?, font_*?, ...}
  - kind=text:   {text or runs, position, font_name, font_size, font_bold,
                  font_italic, text_color, text_align, name}
  - kind=chart:  {chart_type, categories, series, title, category_axis,
                  value_axis, legend, data_labels, position, name}
  - kind=table:  {headers, rows OR data, first_row_header, banded_rows,
                  header_fill, header_font, cell_font, band_fills,
                  borders, position, name}

When authoring CHART templates:
  * PRESERVE the exact axis styling (visible flags, tick fonts, gridline
    settings) — these are the brand's chart conventions.
  * PRESERVE the color sequence — extract the actual hex colors from the
    series and bake them in via series[*].color or point_colors.
  * PRESERVE legend position, font, and visibility.
  * PARAMETERIZE: title text, categories list, series values list.
    Use `{{categories}}` and `{{values}}` so the caller passes a
    DataFrame-derived list.

When authoring TABLE templates:
  * PRESERVE the header fill, header font, banded_rows flag, band fills,
    border styles — these define the brand's table look.
  * PARAMETERIZE: title text, headers list, rows list (list of lists).
  * Always declare `first_row_header` true if the source table has one.

If on closer inspection this pattern isn't actually template-worthy
(e.g. you flagged it in phase 1 but the full data shows it's a one-off),
respond with: {"keep": false, "reason": "<why>"}.
"""


def author_template(
    want: _Want, slide: Any, *, llm_call: Callable[[str, str], str],
) -> dict[str, Any] | None:
    """Phase 2 — single LLM call per want."""
    # Pull the full Bridge data for the relevant element(s).
    relevant_elements: list[Any] = []
    wanted_ids = set(want.element_ids)
    for el in (slide.elements or []):
        ident = getattr(el, "identification", None)
        eid = str(getattr(ident, "shape_id", "") or "") if ident else ""
        if eid in wanted_ids or want.kind == "full_slide":
            relevant_elements.append(el)
    if not relevant_elements:
        log.warning("author_template[%s]: no elements found for want %s",
                    want.name, want.element_ids)
        return None

    payload = {
        "want": {
            "kind": want.kind, "name": want.name,
            "description": want.description, "tags": want.tags,
        },
        "slide_canvas": {"width": 13.333, "height": 7.5},
        "elements": [_full_element_json(el) for el in relevant_elements],
    }
    user = json.dumps(payload, ensure_ascii=False, default=str)[:14000]
    try:
        raw = llm_call(_AUTHORING_SYSTEM, user)
    except Exception as exc:
        log.warning("author_template[%s]: LLM failed: %s", want.name, exc)
        return None
    parsed = _parse_json_response(raw)
    if not parsed:
        return None
    if parsed.get("keep") is False:
        log.info("author_template[%s]: agent rejected (%s)",
                 want.name, parsed.get("reason", "no reason"))
        return None

    layout = parsed.get("layout") or []
    if not layout:
        return None

    kind_for_set = "slide" if want.kind == "full_slide" else "element"
    confidence = 0.85 if want.kind == "full_slide" else 0.75
    return {
        "kind": kind_for_set,
        "name": parsed.get("name") or want.name,
        "description": parsed.get("description") or want.description,
        "tags": list(parsed.get("tags") or want.tags)[:6],
        "layout": layout,
        "inputs_schema": parsed.get("inputs_schema") or {},
        "sample_inputs": parsed.get("sample_inputs") or {},
        "provenance": {
            "source": "agent_v2",
            "slide_n": want.slide_n,
            "want_kind": want.kind,
            "element_ids": want.element_ids,
        },
        "confidence": confidence,
    }


# ── Public entry point ──────────────────────────────────────────────────────


def _slide_has_chart_or_table(slide: Any) -> bool:
    """True when the slide contains at least one BridgeChart or BridgeTable
    element. We use this as an automatic 'flag for authoring' rule because
    charts and tables are almost always template-worthy (their formatting
    captures a brand decision worth preserving) — and the LLM's discovery
    phase tends to under-flag them."""
    for el in (slide.elements or []):
        et = getattr(el, "element_type", el.__class__.__name__)
        if et in ("BridgeChart", "BridgeTable"):
            return True
    return False


def _build_auto_chart_table_want(slide: Any) -> _Want | None:
    """Synthesize a full_slide want for chart/table slides. The agent's
    authoring phase will then write the actual Template dict with full
    fidelity to the chart's axes, legend, color sequence, etc.

    Looks for the chart/table as the centerpiece + supporting title/source
    elements (anything near the chart). The author phase decides which to
    actually preserve.
    """
    chart_or_table_ids: list[str] = []
    supporting_ids: list[str] = []
    has_chart = False
    has_table = False
    for el in (slide.elements or []):
        et = getattr(el, "element_type", el.__class__.__name__)
        ident = getattr(el, "identification", None)
        eid = str(getattr(ident, "shape_id", "") or "") if ident else ""
        if et == "BridgeChart":
            chart_or_table_ids.append(eid); has_chart = True
        elif et == "BridgeTable":
            chart_or_table_ids.append(eid); has_table = True
        elif et in ("BridgeText", "BridgeShape"):
            # Include supporting text + simple shapes as part of the slide
            # context — title, source line, accent rule. The author can
            # decide what to keep.
            supporting_ids.append(eid)
    if not chart_or_table_ids:
        return None
    kind_label = "Chart slide" if has_chart else "Table slide"
    if has_chart and has_table:
        kind_label = "Chart + Table slide"
    return _Want(
        kind="full_slide",
        name=kind_label,  # The author phase will rename based on actual content.
        description=f"{kind_label} (auto-detected from BridgeChart/BridgeTable).",
        tags=["auto", "chart" if has_chart else "table"],
        element_ids=chart_or_table_ids + supporting_ids,
        slide_n=getattr(slide, "slide_number", 0) or 0,
    )


def induce_templates_agentic(
    docs_by_ref: dict[str, Any],
    *,
    llm_call: Callable[[str, str], str],
    max_wants_per_doc: int = 30,
    skip_slides_under_elements: int = 2,
) -> list[dict[str, Any]]:
    """Top-level: walk every slide of every doc, run discovery + authoring.

    Pipeline per slide:
      1. If the slide contains a BridgeChart or BridgeTable element,
         AUTOMATICALLY add a full_slide want (the LLM discovery phase
         under-flags chart/table slides; charts almost always represent
         a brand decision worth preserving).
      2. Run discovery for ADDITIONAL wants (titles, footers, etc.).
      3. For every want (auto + discovered), call author_template with
         the full Bridge JSON.

    Dedupes by normalized name across the final list.
    """
    if llm_call is None:
        log.warning("induce_templates_agentic: llm_call is required — returning []")
        return []

    # Three-pass pipeline so the cap doesn't starve chart/table slides:
    #   Pass A: walk every slide, collect AUTO chart/table wants (no LLM).
    #   Pass B: walk every slide, run discovery (one LLM call/slide); apply
    #           cap to discovery wants only.
    #   Pass C: author every collected want (one LLM call each).
    #
    # Chart/table wants are NEVER dropped by the cap — they're the highest-
    # value templates and shouldn't compete with dozens of "Footer Text"
    # variants for a slot.
    candidates: list[dict[str, Any]] = []
    discovery_cap = max_wants_per_doc * len(docs_by_ref)

    auto_wants: list[tuple[Any, _Want]] = []
    other_wants: list[tuple[Any, _Want]] = []

    for ref_id, doc in docs_by_ref.items():
        log.info("agent_induction: ref=%s, %d slides", ref_id, len(doc.slides or []))

        # Pass A — auto chart/table wants
        for slide in (doc.slides or []):
            if len(slide.elements or []) < skip_slides_under_elements:
                continue
            auto_want = _build_auto_chart_table_want(slide)
            if auto_want:
                auto_wants.append((slide, auto_want))
                log.info("agent_induction: AUTO-flagged slide %d (%s)",
                         auto_want.slide_n, auto_want.name)

        # Pass B — discovery (capped)
        discovery_count = 0
        auto_slide_nums = {w.slide_n for _, w in auto_wants}
        for slide in (doc.slides or []):
            if len(slide.elements or []) < skip_slides_under_elements:
                continue
            if discovery_count >= discovery_cap:
                log.info("agent_induction: discovery cap reached at slide %s",
                         getattr(slide, "slide_number", "?"))
                break
            discovered = discover_slide_wants(slide, llm_call=llm_call)
            # Filter: drop full_slide wants that overlap an auto-want (auto
            # takes precedence); keep element wants.
            slide_n = getattr(slide, "slide_number", 0) or 0
            for w in discovered:
                if w.kind == "full_slide" and slide_n in auto_slide_nums:
                    continue
                other_wants.append((slide, w))
                discovery_count += 1
                if discovery_count >= discovery_cap:
                    break

    # Pass C — consolidate wants BEFORE authoring (saves LLM tokens by not
    # re-authoring the same pattern N times). Two wants are duplicates when
    # they share a normalized name OR cover the same set of element_ids.
    # Auto wants always survive (they're rule-derived, not LLM-proposed).
    all_wants = auto_wants + other_wants
    consolidated = _dedupe_wants(all_wants)
    log.info("agent_induction: %d auto + %d discovery wants → %d unique after consolidation",
             len(auto_wants), len(other_wants), len(consolidated))

    # Pass D — author each unique want (one LLM call each).
    for slide, want in consolidated:
        tpl = author_template(want, slide, llm_call=llm_call)
        if tpl:
            candidates.append(tpl)

    log.info("agent_induction: %d candidates total before name-dedupe", len(candidates))

    # Dedupe by lowercased name; keep highest-confidence per name.
    by_name: dict[str, dict[str, Any]] = {}
    for c in candidates:
        key = re.sub(r"\s+", " ", str(c.get("name", "")).lower().strip())
        if not key:
            continue
        if key not in by_name or c.get("confidence", 0) > by_name[key].get("confidence", 0):
            by_name[key] = c
    deduped = sorted(by_name.values(), key=lambda c: -c.get("confidence", 0))
    log.info("agent_induction: %d unique after dedupe", len(deduped))
    return deduped


# ── Helpers ────────────────────────────────────────────────────────────────


def _normalize_want_name(name: str) -> str:
    """Squash near-duplicate want names so 'Slide Title' + 'Slide Title
    Placeholder' + 'Title Placeholder' all collapse to one canonical key."""
    s = re.sub(r"\s+", " ", (name or "").lower().strip())
    # Drop common noise words that pad LLM-generated names.
    for noise in ("placeholder", "element", "text", "block", "box",
                  "group", "the ", "a ", "small ", "tiny "):
        s = s.replace(noise, " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _dedupe_wants(
    wants: list[tuple[Any, _Want]],
) -> list[tuple[Any, _Want]]:
    """Consolidate wants before authoring.

    Two wants are duplicates when:
      * Their normalized names match, OR
      * Their element_ids sets are identical.

    Auto-promoted wants (chart/table slides — kind='full_slide' with
    'auto' tag) ALWAYS survive — they're rule-derived and represent
    high-value templates we deliberately want every instance of.

    For LLM-proposed wants, we keep the first occurrence and drop
    subsequent matches.
    """
    seen_names: set[str] = set()
    seen_id_sets: list[set[str]] = []
    out: list[tuple[Any, _Want]] = []
    for slide, want in wants:
        is_auto = "auto" in (want.tags or [])
        if is_auto:
            out.append((slide, want))
            continue
        name_key = _normalize_want_name(want.name)
        ids_key = frozenset(want.element_ids or [])
        # Name collision?
        if name_key and name_key in seen_names:
            continue
        # ID-set collision (only when both have ids)?
        if ids_key:
            if any(ids_key == s for s in seen_id_sets):
                continue
            seen_id_sets.append(set(ids_key))
        if name_key:
            seen_names.add(name_key)
        out.append((slide, want))
    return out


def _parse_json_response(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except Exception:
        pass
    # Try extracting outermost JSON object.
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def accept_candidate(candidate: dict[str, Any], *, category: str = "Induced") -> str:
    """Persist a v2 candidate as a real agent template. Mirrors v1's helper
    so the seeder + frontend can use either inducer interchangeably."""
    from percy.agent import templates as _tpls
    t = _tpls.Template(
        id="",
        name=candidate["name"],
        description=candidate.get("description", ""),
        category=category,
        tags=list(candidate.get("tags") or []),
        inputs_schema=dict(candidate.get("inputs_schema") or {}),
        sample_inputs=dict(candidate.get("sample_inputs") or {}),
        layout=list(candidate.get("layout") or []),
        is_builtin=False,
    )
    return _tpls.save_template(t)
