"""LLM-powered template induction from onboarded reference documents.

Given one or more Bridge documents previously onboarded as Template Set
reference docs, this module clusters similar slides + elements and emits
candidate templates for user review. The candidates carry:

  * `name`, `description`, `tags` — proposed by the LLM after seeing prototype
    content
  * `layout` — the serialized BridgeSlide → create_* recipe list (one entry for
    element-kind candidates, multiple entries for slide-kind)
  * `inputs_schema` — what the user can parameterize (title text, KPI values,
    colors); proposed by the LLM, validated against the layout
  * `sample_inputs` — derived from the prototype's actual content so the user
    sees a realistic preview
  * `provenance` — `{ref_id, source_slide, source_element_ids, member_count,
    confidence}` — kept on every candidate so the editor UI can show "seen
    7× across 3 reference docs"

Architecture:
  1. Deterministic clustering (BM25-ish style fingerprints) does the heavy
     lifting of finding repeats.
  2. The LLM polishes: names clusters, decides what to parameterize, judges
     whether a cluster is template-worthy or noise.
  3. The user accepts/rejects via the frontend — we never auto-save.

The induction is *not* exposed as a planner skill yet. It's invoked directly
from the Template Sets editor on a "Mine templates" button. Once the agent's
generate-deck flow becomes the dominant deck-creation path we'll likely make
this a planner-callable tool so users can say "give me template candidates
from these decks".
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

log = logging.getLogger(__name__)


# ── Configuration ────────────────────────────────────────────────────────────

# Slides with elements outside this band aren't useful as templates either way:
# 1 element = solo callout (handle as element-kind); 30+ = dense exception slides.
_MIN_SLIDE_ELEMENTS = 2
_MAX_SLIDE_ELEMENTS = 25

# An element cluster needs at least this many distinct slide-source occurrences
# before we surface it as a candidate. Fewer than this and it's not a pattern,
# it's just a one-off.
_MIN_ELEMENT_REPEATS = 2

# Cap how many candidates we ask the LLM about per induction run. Above this
# we'd burn tokens + time without much marginal benefit.
_MAX_LLM_CANDIDATES = 25


# ── Fingerprinting ───────────────────────────────────────────────────────────


def _quadrant(left: float | None, top: float | None,
               slide_w: float = 13.33, slide_h: float = 7.5) -> str:
    """3x3 grid label used to coarsely match layouts. Treats unknown coords as 'mid'."""
    if left is None or top is None:
        return "mid-mid"
    h = "left" if left < slide_w / 3 else "right" if left >= 2 * slide_w / 3 else "mid"
    v = "top" if top < slide_h / 3 else "bot" if top >= 2 * slide_h / 3 else "mid"
    return f"{v}-{h}"


def _size_band(width: float | None, height: float | None,
                slide_w: float = 13.33, slide_h: float = 7.5) -> str:
    """Bucket element area into 4 bands so 'big chart' and 'tiny chart' are
    not in the same cluster."""
    if width is None or height is None or width <= 0 or height <= 0:
        return "unknown"
    frac = (width * height) / (slide_w * slide_h)
    if frac < 0.05:  return "xs"
    if frac < 0.20:  return "s"
    if frac < 0.50:  return "m"
    return "lg"


def _element_text(el: Any) -> str:
    """Best-effort text extraction across the Bridge subclasses."""
    chunks: list[str] = []
    for path in ("text_frame.paragraphs", "paragraphs",
                 "text_content.paragraphs"):
        cursor: Any = el
        for attr in path.split("."):
            cursor = getattr(cursor, attr, None)
            if cursor is None:
                break
        for para in (cursor or []):
            for run in (getattr(para, "runs", None) or []):
                t = getattr(run, "text", None)
                if t:
                    chunks.append(t)
    for path in ("title.title",):
        cursor = el
        for attr in path.split("."):
            cursor = getattr(cursor, attr, None)
            if cursor is None:
                break
        if isinstance(cursor, str):
            chunks.append(cursor)
    return " ".join(chunks).strip()


def _element_fingerprint(el: Any) -> tuple:
    """Stable tuple that's "the same shape, the same role, same neighborhood".

    Two elements with the same fingerprint are template-equivalent — they can
    be parameterized into a single reusable element template. Text *content*
    is NOT part of the fingerprint — only its presence + role. That's how a
    "Q3 Revenue" KPI tile and a "Q4 Revenue" KPI tile collapse into the same
    template.
    """
    et = getattr(el, "element_type", el.__class__.__name__)
    pos = getattr(el, "position", None)
    quad = _quadrant(getattr(pos, "left", None), getattr(pos, "top", None)) if pos else "mid-mid"
    size = _size_band(getattr(pos, "width", None), getattr(pos, "height", None)) if pos else "unknown"

    has_text = bool(_element_text(el))

    # Fill color (if any) — major style signal. We don't include the actual
    # color value because templates should normalize to brand tokens.
    fill = getattr(el, "fill", None)
    fill_type = getattr(fill, "fill_type", None) or "none"

    # Chart sub-type matters: column vs pie are very different.
    chart_kind = getattr(el, "chart_type", None) if et == "BridgeChart" else None

    return (et, quad, size, has_text, fill_type, chart_kind)


def _slide_fingerprint(slide: Any) -> tuple:
    """The bag-of-element-fingerprints. Order-independent, count-sensitive.

    Two slides with the same set+counts of element fingerprints get treated as
    instances of the same template. This is robust to small position jitter
    because the quadrant/size bands are coarse."""
    elements = list(slide.elements or [])
    counts = Counter(_element_fingerprint(el) for el in elements)
    return tuple(sorted(counts.items()))


# ── Candidate dataclass ──────────────────────────────────────────────────────


@dataclass
class TemplateCandidate:
    kind: str                          # 'slide' | 'element'
    name: str
    description: str
    tags: list[str] = field(default_factory=list)
    layout: list[dict] = field(default_factory=list)
    inputs_schema: dict[str, dict] = field(default_factory=dict)
    sample_inputs: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    # 0..1 — how confident the inducer is this is worth keeping.
    # Derived from cluster size, fingerprint quality, and LLM judgment.
    confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind, "name": self.name, "description": self.description,
            "tags": list(self.tags), "layout": list(self.layout),
            "inputs_schema": dict(self.inputs_schema),
            "sample_inputs": dict(self.sample_inputs),
            "provenance": dict(self.provenance), "confidence": float(self.confidence),
        }


# ── Slide-level induction ────────────────────────────────────────────────────


def _cluster_slides(docs_by_ref: dict[str, Any]) -> dict[tuple, list[tuple]]:
    """Group slides across all reference docs by fingerprint.

    Returns: {fingerprint: [(ref_id, slide_n, slide_obj), ...]} — one entry per
    unique slide shape, with all instances grouped together.
    """
    clusters: dict[tuple, list[tuple]] = defaultdict(list)
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            n_elements = len(slide.elements or [])
            if n_elements < _MIN_SLIDE_ELEMENTS or n_elements > _MAX_SLIDE_ELEMENTS:
                continue
            fp = _slide_fingerprint(slide)
            if not fp:
                continue
            clusters[fp].append((ref_id, slide.slide_number, slide))
    return clusters


def _serialize_slide_layout(slide: Any) -> tuple[list[dict], dict[str, str]]:
    """Bridge slide → layout list compatible with templates.apply_template().

    Mirrors `app.backend.agent_templates._slide_to_layout` so saved-from-slide
    and induced-from-doc templates produce structurally identical artifacts.
    """
    # We import here rather than at module level to avoid a circular import:
    # agent_templates imports percy.agent.templates which (transitively) may
    # import this module once the planner exposes induction as a tool.
    try:
        from app.backend.agent_templates import _slide_to_layout
        return _slide_to_layout(slide, include_connects=True)
    except Exception as exc:
        log.warning("could not import shared layout serializer: %s — using fallback", exc)
        # Fallback: minimal recipe, position + name only. Good enough for the
        # LLM to reason about but won't recreate styles perfectly.
        layout = []
        for idx, el in enumerate(slide.elements or []):
            pos = getattr(el, "position", None)
            if not pos:
                continue
            body: dict[str, Any] = {
                "position": {
                    "left_in": round(getattr(pos, "left", 0), 4),
                    "top_in":  round(getattr(pos, "top", 0), 4),
                    "width_in":  round(getattr(pos, "width", 0), 4),
                    "height_in": round(getattr(pos, "height", 0), 4),
                },
                "name": (getattr(getattr(el, "identification", None), "shape_name", None) or f"el_{idx}"),
            }
            text = _element_text(el)
            if text:
                body["text"] = text[:200]
            layout.append({"kind": _kind_from_element(el), "alias": f"el_{idx}", "body": body})
        return layout, {}


def _kind_from_element(el: Any) -> str:
    """Map a Bridge* element class to the create_* endpoint kind label."""
    et = getattr(el, "element_type", el.__class__.__name__).lower()
    if "chart" in et: return "chart"
    if "table" in et: return "table"
    if "connector" in et: return "connector"
    if "freeform" in et: return "freeform"
    if "group" in et: return "live-group"
    if "image" in et: return "image-typed"
    if "text" in et: return "text"
    return "shape"


# ── Element-level induction ──────────────────────────────────────────────────


def _cluster_elements(docs_by_ref: dict[str, Any]) -> dict[tuple, list[tuple]]:
    """Group individual elements across all refs by their style fingerprint.

    Returns: {fingerprint: [(ref_id, slide_n, element_id, element_obj), ...]}.
    Only fingerprints with ≥ _MIN_ELEMENT_REPEATS occurrences are kept.
    """
    clusters: dict[tuple, list[tuple]] = defaultdict(list)
    for ref_id, doc in docs_by_ref.items():
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                # Skip elements that are too small to be meaningful templates.
                pos = getattr(el, "position", None)
                if pos and getattr(pos, "width", 0) < 0.5:  # < half inch
                    continue
                fp = _element_fingerprint(el)
                eid = getattr(getattr(el, "identification", None), "shape_id", None) or id(el)
                clusters[fp].append((ref_id, slide.slide_number, str(eid), el))
    return {fp: members for fp, members in clusters.items()
            if len(members) >= _MIN_ELEMENT_REPEATS}


def _serialize_element(el: Any) -> dict[str, Any] | None:
    """Element → single layout entry."""
    try:
        from app.backend.agent_templates import _element_to_create_body
        body, kind = _element_to_create_body(el)
        if not body:
            return None
        alias = (getattr(getattr(el, "identification", None), "shape_name", None) or "el").lower()
        alias = re.sub(r"[^a-z0-9_]+", "_", alias).strip("_") or "el"
        return {"kind": kind, "alias": alias[:32], "body": body}
    except Exception as exc:
        log.warning("could not serialize element: %s", exc)
        return None


# ── LLM polish layer ─────────────────────────────────────────────────────────


_SYSTEM_PROMPT = """\
You are Percy's template-induction assistant. The user gave you a CLUSTER of
similar slides (or single elements) found across their reference decks. Your
job is to decide:

  1. Is this cluster worth saving as a reusable template? (Sometimes a
     repeated-looking shape is actually just noise from a master slide.)
  2. If yes, give it a short human name (≤ 5 words), a one-sentence
     description, and 3-6 tags useful for retrieval.
  3. List which fields in the layout should be parameterizable inputs — what
     a user filling this template later would change. Always include "title"
     if there's a heading element. Include numeric values, KPI labels, color
     overrides if any. Exclude purely structural / positional fields.
  4. Provide example inputs based on the prototype's actual content.

You MUST respond with a single JSON object, no prose, no markdown fences:

{
  "keep": true | false,
  "name": "string",
  "description": "string",
  "tags": ["string", ...],
  "inputs": [
    {"name": "title", "type": "string", "required": true,
     "default": "Example title", "description": "Main heading"},
    ...
  ],
  "confidence": 0.0 to 1.0
}

If "keep" is false, only "keep" and a brief "description" of why it's noise
are required.
"""


def _summarize_cluster_for_llm(cluster_members: list[tuple], *, kind: str,
                                 prototype_layout: Any) -> str:
    """Compose the user message handed to the LLM. Includes:
       - cluster size
       - prototype text content (truncated)
       - simplified layout (without huge blobs)
    """
    member_count = len(cluster_members)
    refs_involved = sorted({m[0] for m in cluster_members})

    if kind == "slide":
        slide_obj = cluster_members[0][2]  # (ref_id, slide_n, slide)
        texts = []
        for el in (slide_obj.elements or [])[:15]:
            t = _element_text(el)
            if t: texts.append(t[:100])
        body = {
            "kind": "slide",
            "member_count": member_count,
            "refs_involved": len(refs_involved),
            "prototype_slide_n": cluster_members[0][1],
            "prototype_element_count": len(slide_obj.elements or []),
            "prototype_text_samples": texts,
            "prototype_layout": prototype_layout[:25],  # cap to avoid token blowout
        }
    else:
        el_obj = cluster_members[0][3]    # (ref_id, slide_n, element_id, el)
        body = {
            "kind": "element",
            "member_count": member_count,
            "refs_involved": len(refs_involved),
            "prototype_element_type": getattr(el_obj, "element_type", None),
            "prototype_text": _element_text(el_obj)[:200],
            "prototype_layout": prototype_layout,
        }
    return json.dumps(body, ensure_ascii=False, default=str)[:6000]


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_llm_response(text: str) -> dict[str, Any] | None:
    """Best-effort JSON extraction. LLMs sometimes wrap responses in fences
    despite the prompt — strip them, find the outermost JSON object."""
    text = text.strip()
    # Strip fenced ```json``` blocks if present.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        pass
    m = _JSON_RE.search(text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception as exc:
            log.debug("LLM JSON parse failed even after regex: %s", exc)
    return None


def _build_inputs_schema(inputs_list: list[dict]) -> dict[str, dict]:
    """Convert the LLM's flat list-of-inputs into the canonical schema dict."""
    schema: dict[str, dict] = {}
    for entry in inputs_list or []:
        name = entry.get("name") or entry.get("key")
        if not isinstance(name, str) or not name:
            continue
        schema[name] = {
            "type": entry.get("type") or "string",
            "required": bool(entry.get("required", False)),
            "default": entry.get("default", ""),
            "description": entry.get("description") or "",
        }
    return schema


def _sample_inputs_from_prototype(inputs_schema: dict[str, dict],
                                    prototype: Any) -> dict[str, Any]:
    """Best-effort defaults from the prototype's actual content. The LLM gives
    us a "default" per input but those are sometimes generic. We override with
    the real prototype text where the heuristic matches.
    """
    out: dict[str, Any] = {}
    text_blobs: list[str] = []
    if hasattr(prototype, "elements"):
        for el in (prototype.elements or []):
            t = _element_text(el)
            if t: text_blobs.append(t)
    elif prototype is not None:
        t = _element_text(prototype)
        if t: text_blobs.append(t)

    for name, spec in inputs_schema.items():
        if "title" in name.lower() and text_blobs:
            out[name] = text_blobs[0][:120]
            continue
        if "subtitle" in name.lower() and len(text_blobs) >= 2:
            out[name] = text_blobs[1][:120]
            continue
        out[name] = spec.get("default") or ""
    return out


# ── Public entry point ──────────────────────────────────────────────────────


def induce_templates(
    docs_by_ref: dict[str, Any],
    *,
    llm_call: Callable[[str, str], str] | None = None,
    max_candidates: int = _MAX_LLM_CANDIDATES,
    include_slides: bool = True,
    include_elements: bool = True,
) -> list[dict[str, Any]]:
    """Mine template candidates from a set of onboarded Bridge documents.

    Args:
      docs_by_ref: {ref_id: PercyDocument} — only ready/onboarded refs.
      llm_call: callable ``(system, user) -> str``. If None, skips the LLM
                polish step and returns deterministic candidates with placeholder
                names. Useful for testing without burning Bedrock calls.
      max_candidates: cap on candidates handed to the LLM. Largest clusters
                      win the slots.
      include_slides / include_elements: toggle the two induction paths.

    Returns: list of candidate dicts ready to be reviewed by the user. Each
    candidate is independent — accepting one doesn't commit the others.
    """
    candidates: list[TemplateCandidate] = []

    # ---- Slide candidates ----
    if include_slides:
        slide_clusters = _cluster_slides(docs_by_ref)
        # Sort by size desc — biggest clusters are most-template-worthy.
        ranked_slides = sorted(slide_clusters.items(), key=lambda kv: -len(kv[1]))
        for fingerprint, members in ranked_slides:
            if len(candidates) >= max_candidates:
                break
            prototype_slide = members[0][2]
            layout, _connects = _serialize_slide_layout(prototype_slide)
            if not layout:
                continue
            base_conf = min(1.0, len(members) / 8.0)  # 8+ members ⇒ full confidence
            candidates.append(TemplateCandidate(
                kind="slide",
                name=f"Slide layout {len(candidates) + 1}",
                description=f"Recurs across {len({m[0] for m in members})} refs ({len(members)} slides)",
                tags=["induced"],
                layout=layout,
                provenance={
                    "fingerprint": str(fingerprint),
                    "member_count": len(members),
                    "members": [{"ref_id": m[0], "slide_n": m[1]} for m in members[:20]],
                },
                confidence=base_conf,
            ))

    # ---- Element candidates ----
    if include_elements:
        elem_clusters = _cluster_elements(docs_by_ref)
        ranked_elems = sorted(elem_clusters.items(), key=lambda kv: -len(kv[1]))
        for fingerprint, members in ranked_elems:
            if len(candidates) >= max_candidates:
                break
            prototype_el = members[0][3]
            entry = _serialize_element(prototype_el)
            if not entry:
                continue
            base_conf = min(1.0, len(members) / 10.0)
            candidates.append(TemplateCandidate(
                kind="element",
                name=f"Element pattern {len(candidates) + 1}",
                description=f"Seen {len(members)}× across {len({m[0] for m in members})} refs",
                tags=["induced", entry["kind"]],
                layout=[entry],
                provenance={
                    "fingerprint": str(fingerprint),
                    "member_count": len(members),
                    "members": [
                        {"ref_id": m[0], "slide_n": m[1], "element_id": m[2]}
                        for m in members[:20]
                    ],
                },
                confidence=base_conf,
            ))

    # ---- LLM polish ----
    if llm_call is not None:
        for cand in candidates:
            # Find the matching cluster's members for the summary helper.
            # We re-derive prototype info from layout if needed.
            prototype: Any = None
            if cand.kind == "slide":
                # Recover prototype slide via provenance
                first = (cand.provenance.get("members") or [None])[0]
                if first:
                    prototype = docs_by_ref.get(first["ref_id"])
                    if prototype:
                        prototype = next(
                            (s for s in (prototype.slides or [])
                             if s.slide_number == first["slide_n"]),
                            None,
                        )
            else:
                first = (cand.provenance.get("members") or [None])[0]
                if first and first["ref_id"] in docs_by_ref:
                    doc = docs_by_ref[first["ref_id"]]
                    slide = next((s for s in (doc.slides or [])
                                  if s.slide_number == first["slide_n"]), None)
                    if slide:
                        prototype = next((e for e in (slide.elements or [])
                                          if str(getattr(getattr(e, "identification", None),
                                                          "shape_id", id(e))) == first["element_id"]),
                                         None)

            user_msg = _summarize_cluster_for_llm(
                # Cluster members rebuilt minimally for the LLM summary;
                # we don't actually need them all — name + structure suffice.
                [(m["ref_id"], m["slide_n"], prototype) for m in cand.provenance.get("members") or []
                 if "slide_n" in m]
                if cand.kind == "slide"
                else [(m["ref_id"], m["slide_n"], m.get("element_id"), prototype)
                       for m in cand.provenance.get("members") or []],
                kind=cand.kind,
                prototype_layout=cand.layout,
            )

            try:
                raw = llm_call(_SYSTEM_PROMPT, user_msg)
            except Exception as exc:
                log.warning("LLM polish failed for candidate %s: %s — keeping defaults",
                            cand.name, exc)
                continue

            parsed = _parse_llm_response(raw)
            if not parsed:
                log.warning("LLM returned unparseable response for %s; keeping defaults",
                            cand.name)
                continue

            if parsed.get("keep") is False:
                # Mark for filtering after the loop; don't mutate iteration list.
                cand.confidence = 0.0
                cand.tags = list(set(cand.tags) | {"llm_rejected"})
                continue

            cand.name = (parsed.get("name") or cand.name).strip()[:80] or cand.name
            cand.description = (parsed.get("description") or cand.description).strip()[:300]
            cand.tags = list(set([*(parsed.get("tags") or []), *cand.tags, "induced"]))[:8]
            cand.inputs_schema = _build_inputs_schema(parsed.get("inputs") or [])
            cand.sample_inputs = _sample_inputs_from_prototype(cand.inputs_schema, prototype)
            llm_conf = parsed.get("confidence")
            if isinstance(llm_conf, (int, float)):
                # Average the deterministic and LLM-judged scores.
                cand.confidence = round((cand.confidence + float(llm_conf)) / 2, 3)

    # Drop LLM-rejected candidates.
    candidates = [c for c in candidates if c.confidence > 0.0]
    # Sort by confidence desc so the UI shows the strongest first.
    candidates.sort(key=lambda c: -c.confidence)
    return [c.to_dict() for c in candidates]


# ── Accept-candidate helper ─────────────────────────────────────────────────


def accept_candidate(candidate: dict[str, Any], *, category: str = "Induced") -> str:
    """Persist a reviewed candidate as a real agent template. Returns its id.

    The caller (the template-sets API) is responsible for adding the returned
    template_id to a set via add_template_set_item().
    """
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
    tid = _tpls.save_template(t)
    return tid
