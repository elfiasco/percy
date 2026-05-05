"""Element resolution index — the find_element backbone.

Builds a per-doc digest of every element (type, name, text, position quadrant,
data summary) and ranks candidates against a natural-language query with
context-aware boosts (current slide, selected element, position cues).

See ``docs/agent/find-element.md`` for the full contract.

The index is a pure-Python data structure — no I/O, no FastAPI. The
``app/backend/agent_find.py`` module wires it up to a route.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# ── Constants ───────────────────────────────────────────────────────────────


_STOPWORDS: frozenset[str] = frozenset({
    "the", "a", "an", "this", "that", "these", "those", "it", "its",
    "on", "in", "at", "of", "for", "to", "with", "by", "my", "our", "your",
    "and", "or", "but", "is", "are", "was", "were", "be", "been",
})


# Bridge type label aliases — what users typically say → which type matches
_TYPE_ALIASES: dict[str, str] = {
    "chart":     "BridgeChart",
    "graph":     "BridgeChart",
    "plot":      "BridgeChart",
    "table":     "BridgeTable",
    "grid":      "BridgeTable",
    "matrix":    "BridgeTable",
    "image":     "BridgeImage",
    "picture":   "BridgeImage",
    "photo":     "BridgeImage",
    "logo":      "BridgeImage",
    "screenshot":"BridgeImage",
    "shape":     "BridgeShape",
    "rectangle": "BridgeShape",
    "rect":      "BridgeShape",
    "circle":    "BridgeShape",
    "oval":      "BridgeShape",
    "ellipse":   "BridgeShape",
    "triangle":  "BridgeShape",
    "arrow":     "BridgeShape",  # could also be connector — handled in scoring
    "callout":   "BridgeShape",
    "badge":     "BridgeShape",
    "button":    "BridgeShape",
    "card":      "BridgeShape",
    "box":       "BridgeShape",
    "text":      "BridgeText",
    "title":     "BridgeText",   # fallback; titles are also shapes
    "subtitle":  "BridgeText",
    "heading":   "BridgeText",
    "header":    "BridgeText",
    "label":     "BridgeText",
    "caption":   "BridgeText",
    "paragraph": "BridgeText",
    "bullet":    "BridgeText",
    "quote":     "BridgeText",
    "footer":    "BridgeText",
    "connector": "BridgeConnector",
    "line":      "BridgeConnector",
    "freeform":  "BridgeFreeform",
    "group":     "BridgeGroup",
}


_QUADRANT_PHRASES: dict[str, str] = {
    "top left":     "top-left",     "upper left":  "top-left",
    "top right":    "top-right",    "upper right": "top-right",
    "top center":   "top-center",   "top middle":  "top-center",
    "top":          "top-center",
    "bottom left":  "bottom-left",  "lower left":  "bottom-left",
    "bottom right": "bottom-right", "lower right": "bottom-right",
    "bottom center":"bottom-center","bottom middle":"bottom-center",
    "bottom":       "bottom-center",
    "left":         "middle-left",
    "right":        "middle-right",
    "center":       "center",
    "middle":       "center",
}


_PRONOUNS: frozenset[str] = frozenset({"this", "it", "that", "selected", "current"})


_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*")


# ── Public dataclasses ──────────────────────────────────────────────────────


@dataclass(slots=True)
class ElementDigest:
    """Compact, searchable summary of a single element.

    Two flavors share this dataclass:
      * **real**: a Bridge dataclass instance (the normal case)
      * **synthetic group**: a virtual entry for N children sharing a
        ``group_id`` from onboarding. ``synthetic_group_members`` carries
        the constituent element_ids; the consumer translates group ops to
        per-child ops.
    """
    slide_n:      int
    element_id:   str
    type:         str
    type_label:   str
    name:         str
    text:         str
    title:        str | None
    data_summary: str | None
    left:         float
    top:          float
    width:        float
    height:       float
    quadrant:     str
    z_index:      int
    locked:       bool
    hidden:       bool
    tokens:       set[str] = field(default_factory=set)
    group_id:     str | None = None      # onboarding tag — same value for siblings
    synthetic:    bool = False           # True if this entry is a synthetic group view
    synthetic_members: list[str] = field(default_factory=list)  # element_ids when synthetic


@dataclass(slots=True)
class SearchCandidate:
    digest:  ElementDigest
    score:   float       # 0.0 – 1.0 normalized
    raw:     float       # raw weighted sum
    why:     list[str] = field(default_factory=list)


@dataclass(slots=True)
class SearchResult:
    candidates:  list[SearchCandidate]
    top_score:   float
    ambiguous:   bool
    scoped_to:   str
    considered:  int


# ── Tokenization ────────────────────────────────────────────────────────────


def tokenize(text: str) -> set[str]:
    """Lowercase tokens, drop stopwords, drop tokens shorter than 2 chars."""
    if not text:
        return set()
    return {
        t.lower()
        for t in _TOKEN_RE.findall(text)
        if len(t) >= 2 and t.lower() not in _STOPWORDS
    }


# ── Geometry ────────────────────────────────────────────────────────────────


def quadrant_for(left: float, top: float, width: float, height: float,
                 slide_w: float, slide_h: float) -> str:
    """Return the quadrant label for an element's center, given slide dims.

    Uses 1/3 cuts so 'top' / 'middle' / 'bottom' partitions feel natural,
    paired with 'left' / 'center' / 'right'.
    """
    cx = left + width / 2
    cy = top + height / 2
    if slide_w <= 0 or slide_h <= 0:
        return "center"

    third_w = slide_w / 3
    third_h = slide_h / 3

    if cy < third_h:
        v = "top"
    elif cy > 2 * third_h:
        v = "bottom"
    else:
        v = "middle"

    if cx < third_w:
        h = "left"
    elif cx > 2 * third_w:
        h = "right"
    else:
        h = "center"

    if v == "middle" and h == "center":
        return "center"
    return f"{v}-{h}"


# ── Element digest extraction ───────────────────────────────────────────────


_TYPE_LABELS: dict[str, str] = {
    "BridgeChart":     "Chart",
    "BridgeTable":     "Table",
    "BridgeImage":     "Image",
    "BridgeShape":     "Shape",
    "BridgeText":      "Text",
    "BridgeFreeform":  "Freeform",
    "BridgeConnector": "Connector",
    "BridgeGroup":     "Group",
}


def _element_id_for(el: Any, idx: int) -> str:
    ident = getattr(el, "identification", None)
    shape_id = getattr(ident, "shape_id", None) if ident else None
    return str(shape_id) if shape_id is not None else f"idx_{idx}"


def _first_text_run(el: Any) -> str:
    """Return the first non-empty text run found anywhere in the element."""
    # BridgeShape / BridgeText
    text_content = getattr(el, "text_content", None)
    if text_content is not None:
        paragraphs = getattr(text_content, "paragraphs", None) or []
        for p in paragraphs:
            for r in (getattr(p, "runs", None) or []):
                t = getattr(r, "text", None)
                if t and t.strip():
                    return t.strip()
        tc = getattr(text_content, "text_content", None)
        if tc:
            return tc.strip()

    # BridgeText also has paragraphs at top level
    paragraphs = getattr(el, "paragraphs", None)
    if paragraphs:
        for p in paragraphs:
            for r in (getattr(p, "runs", None) or []):
                t = getattr(r, "text", None)
                if t and t.strip():
                    return t.strip()
    return ""


def _chart_data_summary(el: Any) -> str | None:
    """Quick natural-language summary of a chart's data shape."""
    cats = getattr(getattr(el, "categories", None), "categories", None) or []
    series = getattr(el, "series", None) or []
    series_names = [s.name or f"Series {i+1}" for i, s in enumerate(series)]
    chart_type = getattr(el, "chart_type", None) or "chart"
    parts = [str(chart_type)]
    if cats:
        cats_preview = cats[:5]
        more = "..." if len(cats) > 5 else ""
        parts.append(f"categories=[{', '.join(repr(c) for c in cats_preview)}{more}]")
    if series_names:
        parts.append(f"series={series_names}")
    return " · ".join(parts)


def _table_data_summary(el: Any) -> str | None:
    cell_formats = getattr(el, "cell_formats", None) or []
    n_rows = len(cell_formats)
    n_cols = len(cell_formats[0]) if n_rows else 0
    if n_rows == 0:
        return None
    has_header = bool(getattr(getattr(el, "table_properties", None), "first_row_header", False))
    return f"{n_rows}x{n_cols}{' with header' if has_header else ''}"


def _chart_title(el: Any) -> str | None:
    t = getattr(getattr(el, "title", None), "title", None)
    return t if t else None


def build_digest(slide: Any, doc_w: float, doc_h: float) -> list[ElementDigest]:
    """Build digests for every element on a slide, plus synthetic-group views.

    For each cluster of children sharing an ``identification.group_id``, emit
    one extra digest representing the cluster as a unit. The cluster's bbox
    is the union of its members; its name is taken from the group_id stem
    (e.g. "slide-1:group-5" → "Group 5") or from the most common member name.
    """
    out: list[ElementDigest] = []
    slide_n = int(getattr(slide, "slide_number", 0))
    slide_w = float(getattr(slide, "width", None) or doc_w)
    slide_h = float(getattr(slide, "height", None) or doc_h)

    by_group_id: dict[str, list[tuple[ElementDigest, Any]]] = {}

    for idx, el in enumerate(getattr(slide, "elements", []) or []):
        el_type = getattr(el, "element_type", type(el).__name__)
        ident = getattr(el, "identification", None)
        name = (getattr(ident, "shape_name", None) if ident else None) or ""
        pos = getattr(el, "position", None)
        if pos is None:
            continue
        text = _first_text_run(el)
        title = _chart_title(el) if el_type == "BridgeChart" else None

        if el_type == "BridgeChart":
            data_summary = _chart_data_summary(el)
        elif el_type == "BridgeTable":
            data_summary = _table_data_summary(el)
        elif el_type == "BridgeGroup":
            data_summary = _group_data_summary(el)
        else:
            data_summary = None

        type_label = _TYPE_LABELS.get(el_type, el_type)

        tok_text = " ".join(filter(None, [name, text, title, data_summary, type_label]))
        tokens = tokenize(tok_text)

        flags = getattr(el, "custom_properties", {}) or {}
        locked = bool(flags.get("locked", False))
        hidden = bool(flags.get("hidden", False))
        group_id = getattr(ident, "group_id", None) if ident else None

        digest = ElementDigest(
            slide_n=slide_n,
            element_id=_element_id_for(el, idx),
            type=el_type,
            type_label=type_label,
            name=name or type_label,
            text=text[:200],
            title=title,
            data_summary=data_summary,
            left=float(pos.left),
            top=float(pos.top),
            width=float(pos.width),
            height=float(pos.height),
            quadrant=quadrant_for(pos.left, pos.top, pos.width, pos.height, slide_w, slide_h),
            z_index=int(getattr(getattr(el, "stacking", None), "z_index", 1) or 1),
            locked=locked,
            hidden=hidden,
            tokens=tokens,
            group_id=group_id,
        )
        out.append(digest)

        if group_id:
            by_group_id.setdefault(group_id, []).append((digest, el))

    # Synthetic group projections — one virtual digest per cluster of children
    # sharing the same onboarded group_id.
    for gid, members in by_group_id.items():
        if len(members) < 2:
            continue
        digests_only = [d for d, _ in members]
        out.append(_make_synthetic_group_digest(gid, digests_only, slide_n, slide_w, slide_h))

    return out


def _make_synthetic_group_digest(
    group_id: str, members: list[ElementDigest], slide_n: int,
    slide_w: float, slide_h: float,
) -> ElementDigest:
    lefts   = [m.left for m in members]
    tops    = [m.top for m in members]
    rights  = [m.left + m.width for m in members]
    bottoms = [m.top + m.height for m in members]
    L, T = min(lefts), min(tops)
    W, H = max(rights) - L, max(bottoms) - T

    # Pick a friendly name. group_id often looks like "slide-1:group-5" —
    # render that as "Group 5".
    label = group_id
    if ":" in group_id:
        tail = group_id.split(":")[-1]
        if tail.startswith("group-"):
            label = f"Group {tail[6:]}"
        else:
            label = tail

    type_counts: dict[str, int] = {}
    for m in members:
        type_counts[m.type_label] = type_counts.get(m.type_label, 0) + 1
    summary = ", ".join(f"{c} {t}" for t, c in sorted(type_counts.items(), key=lambda kv: -kv[1]))

    text_blob = " ".join(filter(None, [m.text for m in members]))[:200]
    tokens = tokenize(" ".join([label, "group", text_blob, summary]))

    return ElementDigest(
        slide_n=slide_n,
        element_id=f"synthetic:{group_id}",
        type="SyntheticGroup",
        type_label="Group",
        name=label,
        text=text_blob,
        title=None,
        data_summary=summary,
        left=L, top=T, width=W, height=H,
        quadrant=quadrant_for(L, T, W, H, slide_w, slide_h),
        z_index=max(m.z_index for m in members),
        locked=False, hidden=False,
        tokens=tokens,
        group_id=group_id,
        synthetic=True,
        synthetic_members=[m.element_id for m in members],
    )


def _group_data_summary(el: Any) -> str | None:
    children = getattr(el, "children", None) or []
    if not children:
        return "empty group"
    counts: dict[str, int] = {}
    for c in children:
        ct = getattr(c, "element_type", "Element")
        counts[ct] = counts.get(ct, 0) + 1
    parts = ", ".join(f"{c} {t.replace('Bridge', '')}" for t, c in sorted(counts.items(), key=lambda kv: -kv[1]))
    is_live = getattr(el, "generator_script", None)
    return f"{parts}{' (live)' if is_live else ''}"


# ── BM25 (lite) ─────────────────────────────────────────────────────────────


def _bm25_score(query_tokens: set[str], digest: ElementDigest, avg_doc_len: float, idf: dict[str, float]) -> float:
    """Simple BM25 with k1=1.5, b=0.75. avg_doc_len in tokens, idf precomputed."""
    if not query_tokens or not digest.tokens:
        return 0.0
    k1 = 1.5
    b = 0.75
    doc_len = max(1, len(digest.tokens))
    score = 0.0
    for t in query_tokens:
        if t not in digest.tokens:
            continue
        tf = 1.0  # token sets — boolean tf
        idf_t = idf.get(t, 0.0)
        score += idf_t * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avg_doc_len))
    return score


def _compute_idf(digests: Iterable[ElementDigest]) -> tuple[dict[str, float], float]:
    docs = list(digests)
    n = len(docs)
    df: dict[str, int] = {}
    for d in docs:
        for t in d.tokens:
            df[t] = df.get(t, 0) + 1
    idf = {t: math.log(1 + (n - cnt + 0.5) / (cnt + 0.5)) for t, cnt in df.items()}
    avg_doc_len = sum(len(d.tokens) for d in docs) / max(1, n)
    return idf, avg_doc_len


# ── Index ───────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ElementIndex:
    """Per-doc index: digests + BM25 statistics."""

    digests:      list[ElementDigest]
    idf:          dict[str, float]
    avg_doc_len:  float
    by_id:        dict[tuple[int, str], ElementDigest] = field(default_factory=dict)

    @classmethod
    def build(cls, doc: Any) -> "ElementIndex":
        doc_w = float(getattr(getattr(doc, "metadata", None), "slide_width", None) or 13.333)
        doc_h = float(getattr(getattr(doc, "metadata", None), "slide_height", None) or 7.5)
        digests: list[ElementDigest] = []
        for slide in (getattr(doc, "slides", None) or []):
            digests.extend(build_digest(slide, doc_w, doc_h))
        idf, avg = _compute_idf(digests)
        by_id = {(d.slide_n, d.element_id): d for d in digests}
        return cls(digests=digests, idf=idf, avg_doc_len=avg, by_id=by_id)

    # ── Search ──────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        *,
        viewing_slide_n: int | None = None,
        selected_element_id: str | None = None,
        scope: Any = None,
        element_types: list[str] | None = None,
        limit: int = 5,
        min_confidence: float = 0.0,
    ) -> SearchResult:
        # Pronoun shortcut: if query is purely a pronoun and a selected element
        # is provided, return it directly.
        q_lower = (query or "").strip().lower()
        if q_lower in _PRONOUNS and selected_element_id is not None and viewing_slide_n is not None:
            digest = self.by_id.get((viewing_slide_n, selected_element_id))
            if digest:
                return SearchResult(
                    candidates=[SearchCandidate(digest=digest, score=1.0, raw=1.0, why=["selected element"])],
                    top_score=1.0,
                    ambiguous=False,
                    scoped_to=f"selected element on slide {viewing_slide_n}",
                    considered=1,
                )

        # Resolve scope.
        candidates = self._scoped(scope, viewing_slide_n)
        if element_types:
            candidates = [d for d in candidates if d.type in element_types]
        considered = len(candidates)
        if considered == 0:
            return SearchResult(candidates=[], top_score=0.0, ambiguous=False,
                                scoped_to=self._scope_label(scope, viewing_slide_n), considered=0)

        # Parse query for type aliases and quadrant phrases.
        ql = (query or "").lower()
        target_types: set[str] = set()
        for alias, t in _TYPE_ALIASES.items():
            # whole-word match
            if re.search(rf"\b{re.escape(alias)}\b", ql):
                target_types.add(t)
        target_quadrants: set[str] = set()
        for phrase, q in _QUADRANT_PHRASES.items():
            if phrase in ql:
                target_quadrants.add(q)

        q_tokens = tokenize(query or "")

        # Score every candidate.
        scored: list[SearchCandidate] = []
        for d in candidates:
            why: list[str] = []
            raw = 0.0

            # Text match (BM25)
            text_score = _bm25_score(q_tokens, d, self.avg_doc_len, self.idf)
            if text_score > 0:
                raw += text_score
                # find matching tokens for explanation
                hits = q_tokens & d.tokens
                if hits:
                    why.append(f"matches {sorted(hits)}")

            # Type match
            if target_types and d.type in target_types:
                raw += 1.0
                why.append(f"type matches {d.type_label.lower()}")

            # Slide match
            if viewing_slide_n is not None:
                if d.slide_n == viewing_slide_n:
                    raw += 1.0
                    why.append("on viewing slide")
                elif abs(d.slide_n - viewing_slide_n) == 1:
                    raw += 0.3
                    why.append("on adjacent slide")

            # Quadrant match
            if target_quadrants and d.quadrant in target_quadrants:
                raw += 0.5
                why.append(f"position {d.quadrant}")

            # Selected-element same-slide bonus (already-resolved direct hit
            # was handled above for pure pronouns).
            if selected_element_id and viewing_slide_n is not None:
                if d.slide_n == viewing_slide_n and selected_element_id != d.element_id:
                    raw += 0.2

            if raw > 0:
                scored.append(SearchCandidate(digest=d, score=0.0, raw=raw, why=why))

        if not scored:
            return SearchResult(candidates=[], top_score=0.0, ambiguous=False,
                                scoped_to=self._scope_label(scope, viewing_slide_n), considered=considered)

        # Normalize: top raw score becomes 1.0, but cap at "reasonable" so a
        # weak best doesn't masquerade as confident.
        max_raw = max(c.raw for c in scored)
        for c in scored:
            # Don't divide by max if max < 1.0 — preserve the absolute weakness
            # signal. If max is high, normalize; if max is low, scale modestly.
            denom = max(max_raw, 1.5)
            c.score = c.raw / denom

        scored.sort(key=lambda c: (-c.score, -c.digest.z_index, c.digest.slide_n))
        scored = [c for c in scored if c.score >= min_confidence][:limit]

        top_score = scored[0].score if scored else 0.0
        ambiguous = len(scored) >= 2 and (scored[0].score - scored[1].score) < 0.1
        return SearchResult(
            candidates=scored,
            top_score=top_score,
            ambiguous=ambiguous,
            scoped_to=self._scope_label(scope, viewing_slide_n),
            considered=considered,
        )

    # ── Scope helpers ───────────────────────────────────────────────────

    def _scoped(self, scope: Any, viewing_slide_n: int | None) -> list[ElementDigest]:
        if scope is None:
            return list(self.digests)
        if isinstance(scope, str):
            if scope == "current_slide":
                if viewing_slide_n is None:
                    return list(self.digests)
                return [d for d in self.digests if d.slide_n == viewing_slide_n]
            if scope == "deck":
                return list(self.digests)
        if isinstance(scope, dict):
            slides = scope.get("slides")
            if isinstance(slides, list):
                allowed = {int(s) for s in slides}
                return [d for d in self.digests if d.slide_n in allowed]
            rng = scope.get("range")
            if isinstance(rng, list) and len(rng) == 2:
                lo, hi = int(rng[0]), int(rng[1])
                return [d for d in self.digests if lo <= d.slide_n <= hi]
        return list(self.digests)

    def _scope_label(self, scope: Any, viewing_slide_n: int | None) -> str:
        if scope is None:
            return "whole deck"
        if scope == "current_slide" and viewing_slide_n is not None:
            return f"slide {viewing_slide_n}"
        if scope == "deck":
            return "whole deck"
        if isinstance(scope, dict):
            if scope.get("slides"):
                return f"slides {scope['slides']}"
            if scope.get("range"):
                return f"slides {scope['range'][0]}-{scope['range'][1]}"
        return "whole deck"
