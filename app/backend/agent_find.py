"""find_element FastAPI route.

Wraps ``percy.agent.element_index.ElementIndex`` with HTTP plumbing:
  * caches the index on ``_docs[doc_id]["_element_index"]``
  * invalidation is opportunistic — anyone who mutates elements bumps the
    counter ``_docs[doc_id]["_element_index_dirty"]``; a dirty cache is
    rebuilt on next read.

See ``docs/agent/find-element.md`` for the contract.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent.element_index import ElementIndex, SearchCandidate

log = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers (lazy main.py import to dodge circularity) ──────────────────────


def _main():
    fn = _main
    cache = getattr(fn, "_cache", None)
    if cache is None:
        from app.backend import main as _m
        cache = {"docs": _m._docs, "require": _m._require}
        fn._cache = cache  # type: ignore[attr-defined]
    return cache


def get_or_build_index(doc_id: str) -> ElementIndex:
    """Fetch the cached index, rebuilding on first call or when dirty."""
    helpers = _main()
    d = helpers["require"](doc_id)
    cached = d.get("_element_index")
    dirty = d.get("_element_index_dirty", True)
    if cached is not None and not dirty:
        return cached
    idx = ElementIndex.build(d["doc"])
    d["_element_index"] = idx
    d["_element_index_dirty"] = False
    log.info("agent_find: rebuilt element index for %s — %d digests", doc_id, len(idx.digests))
    return idx


def invalidate_index(doc_id: str) -> None:
    """Mark the index dirty. Called by mutating endpoints (or hookable later)."""
    helpers = _main()
    d = helpers["docs"].get(doc_id)
    if d is not None:
        d["_element_index_dirty"] = True


# ── Routes ──────────────────────────────────────────────────────────────────


@router.post("/api/agent/find_element")
async def find_element(request: Request):
    """Resolve a natural-language element reference to ranked candidates.

    Body schema:
        {
          "doc_id": str,
          "query":  str,
          "context": {
             "viewing_slide_n":     int?,
             "selected_element_id": str?,
             "scope":               "current_slide" | "deck" | {slides|range},
             "element_types":       string[]?
          },
          "limit": int?,           # default 5
          "min_confidence": float?,# default 0.0
          "include_digest": bool?  # default false (debug)
        }
    """
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")

    doc_id = body.get("doc_id")
    if not doc_id:
        raise HTTPException(400, "doc_id is required")
    query = body.get("query", "")

    ctx = body.get("context") or {}
    viewing_slide_n = ctx.get("viewing_slide_n")
    selected_element_id = ctx.get("selected_element_id")
    scope = ctx.get("scope")
    element_types = ctx.get("element_types")

    limit = int(body.get("limit", 5))
    min_confidence = float(body.get("min_confidence", 0.0))
    include_digest = bool(body.get("include_digest", False))

    idx = get_or_build_index(doc_id)
    result = idx.search(
        query=query,
        viewing_slide_n=viewing_slide_n,
        selected_element_id=selected_element_id,
        scope=scope,
        element_types=element_types,
        limit=limit,
        min_confidence=min_confidence,
    )

    return {
        "candidates": [_serialize_candidate(c, include_digest) for c in result.candidates],
        "top_score":  round(result.top_score, 4),
        "ambiguous":  result.ambiguous,
        "scoped_to":  result.scoped_to,
        "considered": result.considered,
    }


@router.post("/api/agent/element_index/invalidate")
async def invalidate_index_route(request: Request):
    """Manual invalidation hook — useful for clients that want to force a rebuild.

    Body: {"doc_id": str}
    """
    body = await request.json()
    doc_id = body.get("doc_id")
    if not doc_id:
        raise HTTPException(400, "doc_id is required")
    invalidate_index(doc_id)
    return {"ok": True}


def _serialize_candidate(c: SearchCandidate, include_digest: bool) -> dict[str, Any]:
    d = c.digest
    out: dict[str, Any] = {
        "slide_n":          d.slide_n,
        "element_id":       d.element_id,
        "type":             d.type,
        "type_label":       d.type_label,
        "name":             d.name,
        "text_preview":     d.text[:80] if d.text else None,
        "title":            d.title,
        "data_summary":     d.data_summary,
        "position_summary": _position_summary(d),
        "quadrant":         d.quadrant,
        "score":            round(c.score, 4),
        "raw_score":        round(c.raw, 4),
        "why":              c.why,
    }
    if d.locked:
        out["locked"] = True
    if d.hidden:
        out["hidden"] = True
    if include_digest:
        out["digest"] = {
            "left": d.left, "top": d.top, "width": d.width, "height": d.height,
            "z_index": d.z_index, "tokens": sorted(d.tokens),
        }
    return out


def _position_summary(d: Any) -> str:
    return f"{d.quadrant}, {d.width:.1f}x{d.height:.1f}in"


def register_find_router(app) -> None:
    app.include_router(router)
    log.info("agent_find: registered find_element routes")
