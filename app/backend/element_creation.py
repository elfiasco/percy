"""Typed `create_thin` endpoints for every Bridge element type.

The builders in ``percy.bridge.builders`` do the dataclass construction.
The thin endpoint layer here:
  * resolves doc/slide/theme context
  * snapshots the doc for one-button rollback
  * calls the right builder
  * appends to ``slide.elements``
  * triggers a slide re-render
  * returns the serialized element + ``snapshot_id``

See ``docs/agent/elements/MASTER.md`` for the full contract.

Mounted onto the main FastAPI app via ``register_creation_router(app)``
called from ``main.py``.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from percy.bridge import builders
from percy.bridge.builders import BuilderError, SHAPE_EQUIVALENT_PRESETS

log = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers (resolved lazily from main.py to avoid a circular import) ───────


def _main():
    """Lazy import of helpers from main.py.

    Imported on first call; cached on the function object thereafter. This is
    a small price to dodge a circular import that would otherwise show up
    because main.py imports this module to register the router.
    """
    fn = _main
    cache = getattr(fn, "_cache", None)
    if cache is None:
        from app.backend import main as _m
        cache = {
            "docs":               _m._docs,
            "require":            _m._require,
            "snapshot":           _m._snapshot_doc,
            "serialize_element":  _m._serialize_element,
            "get_slide_dims":     _m._get_slide_dims,
            "find_element":       _m._find_element,
            "cache_dir":          _m._CACHE_DIR,
        }
        fn._cache = cache  # type: ignore[attr-defined]
    return cache


def _resolve_slide(doc_id: str, n: int) -> tuple[Any, Any, Any, dict[str, str] | None]:
    """Return (doc, slide, slide_dims, theme_colors). Raises HTTPException on missing."""
    helpers = _main()
    d = helpers["require"](doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")
    sw, sh = helpers["get_slide_dims"](doc, slide)
    theme = getattr(doc, "theme_colors", None) or None
    return doc, slide, (sw, sh), theme


def _re_render(doc, doc_id: str, n: int) -> None:
    """Re-render the slide PNG so the new element shows up in the Studio."""
    helpers = _main()
    # Use the doc's own bridge_dir (set at onboard/load time) when available so
    # tests with custom temp dirs work. Fall back to the global cache layout.
    d = helpers["docs"].get(doc_id) or {}
    bridge_dir = d.get("bridge_dir") or (helpers["cache_dir"] / doc_id / "bridge")
    try:
        from percy.diagnostics.render_png import render_bridge_slides as _rbs
        _rbs(doc, bridge_dir, slide_numbers=[n])
    except Exception as exc:
        log.warning("element_creation: re-render failed for slide %d: %s", n, exc)


def _finalize(doc, slide, doc_id: str, n: int, el: Any, warnings: list[str]) -> dict:
    """Append, re-render, serialize, and return the response shape."""
    helpers = _main()
    slide.elements.append(el)
    new_index = len(slide.elements) - 1
    sw, sh = helpers["get_slide_dims"](doc, slide)
    _re_render(doc, doc_id, n)
    payload = helpers["serialize_element"](el, new_index, sw, sh)
    if warnings:
        payload["warnings"] = warnings
    return payload


def _builder_error(exc: BuilderError) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": exc.code,
            "field": exc.field,
            "message": str(exc),
        },
    )


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/slides/{n}/elements/shape")
async def create_shape(doc_id: str, n: int, request: Request):
    """Create a BridgeShape from rich intent JSON.

    See ``docs/agent/elements/shape.md`` for the body schema.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    try:
        el = builders.build_shape(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_shape: added %s on slide %d of %s", el.shape_identification.geometry_preset, n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/text")
async def create_text(doc_id: str, n: int, request: Request):
    """Convenience: create a text-box BridgeShape (text_box=true).

    See ``docs/agent/elements/text.md``.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    try:
        el = builders.build_text(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_text: added text-box on slide %d of %s", n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/chart")
async def create_chart(doc_id: str, n: int, request: Request):
    """Create a BridgeChart from intent.

    See ``docs/agent/elements/chart.md``.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    try:
        el = builders.build_chart(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_chart: added %s with %d series on slide %d of %s",
             el.chart_type, len(el.series), n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/table")
async def create_table(doc_id: str, n: int, request: Request):
    """Create a BridgeTable from intent.

    See ``docs/agent/elements/table.md``.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    try:
        el = builders.build_table(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_table: added %dx%d table on slide %d of %s",
             len(el.cell_formats), len(el.cell_formats[0]) if el.cell_formats else 0, n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/connector")
async def create_connector(doc_id: str, n: int, request: Request):
    """Create a BridgeConnector from intent.

    See ``docs/agent/elements/connector.md``.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []

    def _lookup(eid: str) -> Any:
        try:
            return helpers["find_element"](doc_id, n, eid)
        except HTTPException:
            return None

    try:
        el = builders.build_connector(
            body, theme, slide=slide, lookup_element=_lookup, warnings=warnings,
        )
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_connector: %s on slide %d of %s", el.connector_type, n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/freeform")
async def create_freeform(doc_id: str, n: int, request: Request):
    """Create a BridgeFreeform (preset-only) from intent.

    See ``docs/agent/elements/freeform.md``. If the preset has a clean
    BridgeShape geometry equivalent, this routes to ``build_shape`` instead
    so the studio gets a properly rendered shape.
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    preset = body.get("preset")

    # Route shape-equivalent presets to build_shape — better rendering today.
    if preset in SHAPE_EQUIVALENT_PRESETS:
        shape_intent = dict(body)
        shape_intent["geometry_preset"] = SHAPE_EQUIVALENT_PRESETS[preset]
        shape_intent.pop("preset", None)
        try:
            el = builders.build_shape(shape_intent, theme, slide=slide, warnings=warnings)
        except BuilderError as exc:
            raise _builder_error(exc)
        warnings.append(f"preset {preset!r} routed to BridgeShape geometry {SHAPE_EQUIVALENT_PRESETS[preset]!r}")
        log.info("create_freeform: %s routed to shape on slide %d of %s", preset, n, doc_id)
        return _finalize(doc, slide, doc_id, n, el, warnings)

    try:
        el = builders.build_freeform(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_freeform: %s on slide %d of %s", preset, n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


@router.post("/api/docs/{doc_id}/slides/{n}/elements/image-typed")
async def create_image_typed(
    doc_id: str,
    n: int,
    file: UploadFile = File(None),
    metadata: str | None = Form(None),
):
    """Create a BridgeImage with rich metadata (multipart).

    The existing ``/elements/image`` endpoint stays as-is for the studio's
    drag-drop upload; this typed variant accepts richer placement/styling via
    a JSON ``metadata`` form field. URL-fetch and prompt-generation variants
    are Phase 1.5+.
    """
    import json as _json

    if file is None:
        raise HTTPException(400, "image file is required")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Uploaded file is empty")

    intent: dict = {}
    if metadata:
        try:
            intent = _json.loads(metadata)
        except Exception as exc:
            raise HTTPException(400, f"metadata must be JSON: {exc}")

    fmt = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
    intent.setdefault("original_filename", file.filename)

    helpers = _main()
    helpers["snapshot"](doc_id)
    doc, slide, _, theme = _resolve_slide(doc_id, n)
    warnings: list[str] = []
    try:
        el = builders.build_image(
            intent, theme, slide=slide, image_bytes=raw, image_format=fmt, warnings=warnings,
        )
    except BuilderError as exc:
        raise _builder_error(exc)
    log.info("create_image_typed: added %s (%d bytes) on slide %d of %s", fmt, len(raw), n, doc_id)
    return _finalize(doc, slide, doc_id, n, el, warnings)


# ── Utility ─────────────────────────────────────────────────────────────────


async def _parse_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def register_creation_router(app) -> None:
    """Mount this router on the FastAPI app. Called once from main.py."""
    app.include_router(router)
    log.info("element_creation: registered %d routes", len(router.routes))
