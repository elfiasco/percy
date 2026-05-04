"""PPTX rendering helpers."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from percy.diagnostics.common import ensure_dir

log = logging.getLogger("percy.render")


def render_pptx(pptx_path: str | Path, out_dir: str | Path, engine: str = "powerpoint") -> dict[str, Any]:
    if engine != "powerpoint":
        raise ValueError(f"Unsupported render engine: {engine}")
    return _render_with_powerpoint(Path(pptx_path), ensure_dir(out_dir))


def _render_with_powerpoint(pptx_path: Path, out_dir: Path) -> dict[str, Any]:
    try:
        import win32com.client  # type: ignore[import-not-found]
    except Exception as exc:
        log.warning("PowerPoint COM unavailable: %s", exc)
        return {
            "engine": "powerpoint",
            "status": "unavailable",
            "error": f"Import failed: {exc}",
            "slides": [],
        }

    log.info("COM render: opening %s (%d bytes)", pptx_path.name, pptx_path.stat().st_size)
    t0 = time.perf_counter()
    app = None
    presentation = None
    _coinit = False
    try:
        import pythoncom
        pythoncom.CoInitialize()
        _coinit = True
    except Exception:
        pass
    try:
        app = win32com.client.Dispatch("PowerPoint.Application")
        # Must be visible on most Windows configurations
        app.Visible = True
        try:
            app.DisplayAlerts = 0   # ppAlertsNone — suppress blocking dialogs
        except Exception:
            pass

        log.info("COM render: PowerPoint launched (%.1fs), opening file…", time.perf_counter() - t0)
        presentation = app.Presentations.Open(
            str(pptx_path.resolve()),
            ReadOnly=True,
            Untitled=False,
            WithWindow=False,
        )
        n_slides = presentation.Slides.Count
        log.info("COM render: file opened — %d slides (%.1fs)", n_slides, time.perf_counter() - t0)

        slides = []
        for index in range(1, n_slides + 1):
            slide = presentation.Slides(index)
            output_path = out_dir / f"slide-{index:03d}.png"
            slide.Export(str(output_path.resolve()), "PNG")
            slides.append(str(output_path))
            log.info("COM render: exported slide %d/%d (%.1fs)", index, n_slides, time.perf_counter() - t0)

        log.info("COM render: done — %d PNGs in %.1fs", len(slides), time.perf_counter() - t0)
        return {"engine": "powerpoint", "status": "ok", "slides": slides}

    except Exception as exc:
        log.error("COM render failed after %.1fs: %s", time.perf_counter() - t0, exc)
        return {"engine": "powerpoint", "status": "failed", "error": str(exc), "slides": []}
    finally:
        if presentation is not None:
            try:
                presentation.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        if _coinit:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except Exception:
                pass
