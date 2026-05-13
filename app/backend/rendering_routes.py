"""Rendering routes — extracted from main.py.

Handles slide and element matplotlib rendering, rebuild orchestration, and
render-status polling. Image-bytes endpoints (e.g. /raw-image) and chart/table
payload endpoints stay in main.py.

Register with: `register_rendering_router(app)` from main.py.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response

log = logging.getLogger("percy.api")


# ─── Shared helpers wired at registration time ──────────────────────────────
_require: Any = None
_rebuild_pptx: Any = None
_record_event: Any = None
_update_history_snapshot: Any = None
_render_originals_bg: Any = None
_render_bridge: Any = None
_diagnostic_summary: Any = None
_SlideRenderer: Any = None
_CACHE_DIR: Path = Path("/tmp/percy/.rendercache")
_REBUILD_DIR: Path = Path("/tmp/percy/rebuilt")


def _resolve_main_helpers() -> None:
    global _require, _rebuild_pptx, _record_event, _update_history_snapshot
    global _render_originals_bg, _render_bridge, _diagnostic_summary
    global _SlideRenderer, _CACHE_DIR, _REBUILD_DIR
    if _require is not None:
        return
    from app.backend import main as _main
    _require = _main._require
    _rebuild_pptx = _main._rebuild_pptx
    _record_event = _main._record_event
    _update_history_snapshot = _main._update_history_snapshot
    _render_originals_bg = _main._render_originals_bg
    _render_bridge = _main._render_bridge
    _diagnostic_summary = _main._diagnostic_summary
    _SlideRenderer = _main.SlideRenderer
    _CACHE_DIR = _main._CACHE_DIR
    _REBUILD_DIR = _main._REBUILD_DIR


def _serve_slide(paths: list[str], n: int, label: str) -> FileResponse:
    if not paths:
        raise HTTPException(404, f"{label} renders not available")
    if n < 1 or n > len(paths):
        raise HTTPException(404, f"Slide {n} out of range (1–{len(paths)})")
    p = Path(paths[n - 1])
    if not p.exists():
        raise HTTPException(404, f"{label} PNG missing from disk: {p}")
    return FileResponse(str(p), media_type="image/png",
                        headers={"Cache-Control": "max-age=60"})


def _register_routes(app: FastAPI) -> None:
    @app.post("/api/docs/{doc_id}/rebuild")
    def rebuild(doc_id: str):
        """Rebuild PercyDocument → PPTX, render rebuilt slides."""
        import traceback as _tb
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "pptx":
            raise HTTPException(400, "Rebuild is only supported for PPTX documents")
        log.info("rebuild: doc_id=%s  name=%s", doc_id, d["name"])
        _REBUILD_DIR.mkdir(parents=True, exist_ok=True)
        out_path = _REBUILD_DIR / f"{d['name']}_{doc_id}.pptx"

        t0 = time.perf_counter()
        try:
            result = _rebuild_pptx(d["doc"], out_path)
        except Exception as exc:
            tb = _tb.format_exc()
            log.error("rebuild: EXCEPTION for doc_id=%s\n%s", doc_id, tb)
            raise HTTPException(500, detail=f"{type(exc).__name__}: {exc}\n\n{tb}")
        d["rebuilt_path"] = str(out_path)
        d["diagnostics"]  = result.get("diagnostics", [])
        diagnostic_summary = _diagnostic_summary(d["diagnostics"])
        log.info("rebuild: done in %.1fs  diagnostics=%d  path=%s",
                 time.perf_counter() - t0, len(d["diagnostics"]), out_path.name)

        rebuilt_dir = _CACHE_DIR / doc_id / "rebuilt"
        d["rebuilt_paths"] = []
        _render_originals_bg(doc_id, out_path, rebuilt_dir, "rebuilt_paths")
        log.info("rebuild: COM render started in background for doc_id=%s", doc_id)
        _record_event(
            d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
            "rebuild",
            f"Rebuild completed with {len(d['diagnostics'])} diagnostics",
            {
                "doc_id": doc_id,
                "rebuilt_path": str(out_path),
                "elapsed_sec": round(time.perf_counter() - t0, 1),
                "diagnostic_summary": diagnostic_summary,
            },
            "warn" if d["diagnostics"] else "ok",
        )
        _update_history_snapshot(doc_id)

        return {
            "rebuilt_path":         str(out_path),
            "has_rebuilt_renders":  False,
            "diagnostic_count":     len(d["diagnostics"]),
            "diagnostic_summary":   diagnostic_summary,
        }


    @app.get("/api/docs/{doc_id}/slides/{n}/bridge.png")
    def bridge_slide(doc_id: str, n: int):
        _resolve_main_helpers()
        return _serve_slide(_require(doc_id)["bridge_paths"], n, "Bridge")


    @app.get("/api/docs/{doc_id}/slides/{n}/original.png")
    def original_slide(doc_id: str, n: int):
        _resolve_main_helpers()
        return _serve_slide(_require(doc_id)["orig_paths"], n, "Original")


    @app.get("/api/docs/{doc_id}/slides/{n}/rebuilt.png")
    def rebuilt_slide(doc_id: str, n: int):
        _resolve_main_helpers()
        d = _require(doc_id)
        if not d["rebuilt_path"]:
            raise HTTPException(400, "Not yet rebuilt — call POST /rebuild first")
        return _serve_slide(d["rebuilt_paths"], n, "Rebuilt")


    @app.get("/api/docs/{doc_id}/render-status")
    def render_status(doc_id: str):
        """Fast poll endpoint: returns current render availability without logging."""
        _resolve_main_helpers()
        d = _require(doc_id)
        return {
            "has_originals":        bool(d["orig_paths"]),
            "has_bridge":           bool(d["bridge_paths"]),
            "has_rebuild":          bool(d["rebuilt_path"]),
            "has_rebuilt_renders":  bool(d["rebuilt_paths"]),
            "pixel_scores":         d.get("pixel_scores", {}),
        }


    @app.post("/api/docs/{doc_id}/rerender")
    def rerender_bridge(doc_id: str):
        """Re-render bridge slides using the in-memory doc (picks up renderer changes)."""
        _resolve_main_helpers()
        d = _require(doc_id)
        bridge_dir = _CACHE_DIR / doc_id / "bridge"
        log.info("rerender: doc_id=%s", doc_id)
        t0 = time.perf_counter()
        paths = _render_bridge(d["doc"], bridge_dir)
        d["bridge_paths"] = paths
        elapsed = time.perf_counter() - t0
        log.info("rerender: wrote %d PNGs in %.1fs", len(paths), elapsed)
        _record_event(
            d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
            "rerender",
            f"Bridge re-rendered: {len(paths)} slides",
            {"doc_id": doc_id, "bridge_slides": len(paths), "elapsed_sec": round(elapsed, 1)},
            "ok" if paths else "warn",
        )
        _update_history_snapshot(doc_id)
        return {"bridge_slides": len(paths)}


    @app.post("/api/docs/{doc_id}/slides/{n}/render")
    def render_single_slide(doc_id: str, n: int):
        """Re-render one bridge slide PNG from the current in-memory Bridge model."""
        from percy.diagnostics.render_png import _register_embedded_fonts  # type: ignore[attr-defined]
        _resolve_main_helpers()

        d     = _require(doc_id)
        doc   = d["doc"]
        slide = next((s for s in doc.slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

        bridge_dir = _CACHE_DIR / doc_id / "bridge"
        bridge_dir.mkdir(parents=True, exist_ok=True)
        dest = bridge_dir / f"slide-{n:03d}.png"

        theme          = getattr(doc, "theme_colors", None) or None
        embedded_fonts = getattr(doc, "embedded_fonts", None)
        if embedded_fonts:
            _register_embedded_fonts(embedded_fonts)

        renderer = _SlideRenderer(theme=theme)
        renderer.set_document(doc)
        try:
            fig = renderer.render_slide(slide)
            fig.savefig(str(dest), dpi=96, bbox_inches="tight", pad_inches=0)
            fig.clf()
        except Exception as exc:
            import traceback
            raise HTTPException(500, detail=f"Render failed: {exc}\n{traceback.format_exc()}")

        if 1 <= n <= len(d.get("bridge_paths", [])):
            d["bridge_paths"][n - 1] = str(dest)

        log.info("render_single_slide: slide %d of %s → %s", n, doc_id, dest.name)
        return {"ok": True, "slide": n, "path": str(dest)}


    @app.post("/api/docs/{doc_id}/rerender-all")
    def rerender_all_slides(doc_id: str):
        """Re-render every slide PNG for the current in-memory Bridge model."""
        from percy.diagnostics.render_png import _register_embedded_fonts  # type: ignore[attr-defined]
        _resolve_main_helpers()

        d = _require(doc_id)
        doc = d["doc"]

        bridge_dir = _CACHE_DIR / doc_id / "bridge"
        bridge_dir.mkdir(parents=True, exist_ok=True)

        theme = getattr(doc, "theme_colors", None) or None
        embedded_fonts = getattr(doc, "embedded_fonts", None)
        if embedded_fonts:
            _register_embedded_fonts(embedded_fonts)

        renderer = _SlideRenderer(theme=theme)
        renderer.set_document(doc)

        rendered = 0
        errors: list[dict] = []
        bridge_paths: list[str] = list(d.get("bridge_paths", []))

        for slide in doc.slides:
            n = slide.slide_number
            dest = bridge_dir / f"slide-{n:03d}.png"
            try:
                fig = renderer.render_slide(slide)
                fig.savefig(str(dest), dpi=96, bbox_inches="tight", pad_inches=0)
                fig.clf()
                if 1 <= n <= len(bridge_paths):
                    bridge_paths[n - 1] = str(dest)
                rendered += 1
            except Exception as exc:
                errors.append({"slide": n, "error": str(exc)})

        d["bridge_paths"] = bridge_paths
        log.info("rerender_all_slides: %d slides rendered for %s (%d errors)", rendered, doc_id, len(errors))
        return {"ok": True, "rendered": rendered, "errors": errors}


    @app.get("/api/docs/{doc_id}/slides/{n}/render.png")
    def render_slide_png(doc_id: str, n: int, dpi: int = 150):
        """Render slide N via SlideRenderer (matplotlib) and return as PNG."""
        _resolve_main_helpers()
        d = _require(doc_id)
        doc = d["doc"]
        slide = next((s for s in doc.slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")
        theme = getattr(doc, "theme_colors", None) or None
        try:
            renderer = _SlideRenderer(dpi=dpi, theme=theme)
            renderer.set_document(doc)
            fig = renderer.render_slide(slide)
            import io as _io
            buf = _io.BytesIO()
            fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", pad_inches=0)
            fig.clf()
            buf.seek(0)
            return Response(content=buf.read(), media_type="image/png")
        except Exception as e:
            log.warning("render_slide_png failed for %s slide %d: %s", doc_id, n, e)
            raise HTTPException(500, f"Render failed: {e}")


    @app.get("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/element-png")
    def render_element_png(doc_id: str, n: int, element_id: str, v: int = 0):
        """Render a single Bridge element to a transparent PNG for the Studio canvas."""
        from percy.diagnostics.render_png import _register_embedded_fonts  # type: ignore[attr-defined]
        import io as _io
        _resolve_main_helpers()
        from app.backend import main as _main
        _element_id_fn = _main._element_id

        d   = _require(doc_id)
        doc = d["doc"]
        slide = next((s for s in doc.slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

        el_index = None
        el       = None
        for i, e in enumerate(slide.elements):
            if _element_id_fn(e, i) == element_id:
                el, el_index = e, i
                break
        if el is None:
            raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")

        theme          = getattr(doc, "theme_colors", None) or None
        embedded_fonts = getattr(doc, "embedded_fonts", None)
        if embedded_fonts:
            _register_embedded_fonts(embedded_fonts)

        renderer = _SlideRenderer(theme=theme)
        renderer.set_document(doc)
        renderer._default_text_color = getattr(slide, "default_text_color", None)

        try:
            fig = renderer.render_element(el, padding=0)
            buf = _io.BytesIO()
            fig.savefig(buf, format="png", dpi=96, transparent=True)
            fig.clf()
            buf.seek(0)
        except Exception as exc:
            import traceback
            raise HTTPException(500, detail=f"Element render failed: {exc}\n{traceback.format_exc()}")

        return Response(
            content=buf.read(),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )


def register_rendering_router(app: FastAPI) -> None:
    """Register all rendering routes onto the FastAPI app."""
    _register_routes(app)
