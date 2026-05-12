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


def induce_templates_agentic(
    docs_by_ref: dict[str, Any],
    *,
    llm_call: Callable[[str, str], str],
    max_wants_per_doc: int = 30,
    skip_slides_under_elements: int = 2,
) -> list[dict[str, Any]]:
    """Top-level: walk every slide of every doc, run discovery + authoring.

    Returns the same shape as v1's induce_templates: a list of candidate
    dicts ready to be reviewed and accepted.

    Dedupes by normalized name across the final list — if both phase-1
    runs across two slides surface a "Slide Title" candidate, only the
    higher-confidence one survives.
    """
    if llm_call is None:
        log.warning("induce_templates_agentic: llm_call is required — returning []")
        return []

    candidates: list[dict[str, Any]] = []
    wants_total = 0
    for ref_id, doc in docs_by_ref.items():
        log.info("agent_induction: ref=%s, %d slides", ref_id, len(doc.slides or []))
        for slide in (doc.slides or []):
            if len(slide.elements or []) < skip_slides_under_elements:
                continue
            wants = discover_slide_wants(slide, llm_call=llm_call)
            if not wants:
                continue
            for w in wants:
                if wants_total >= max_wants_per_doc * len(docs_by_ref):
                    log.info("agent_induction: hit max_wants cap")
                    break
                wants_total += 1
                tpl = author_template(w, slide, llm_call=llm_call)
                if tpl:
                    candidates.append(tpl)
    log.info("agent_induction: %d wants processed → %d candidates",
             wants_total, len(candidates))

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
