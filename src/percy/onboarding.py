"""Centralized onboarding entrypoint.

Before this module, three places (`app/backend/main.py`, `worker/onboard_worker.py`,
and indirectly `app/cloud/main.py`) imported `onboard_pptx` / `onboard_pdf`
directly. Each callsite did slightly-different post-processing (font
registration in some paths, structured logging in others). Routing through
this single entrypoint gives us one seam to add cross-cutting concerns:

  - structured logging with consistent slide-count + duration fields
  - optional font registration so matplotlib re-renders honor embedded fonts
  - future: metrics, caching, telemetry, fallback handling

The actual extraction logic still lives in `percy.diagnostics.onboard` —
this is a thin facade, not a rewrite.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("percy.onboarding")


def onboard_document(
    path: str | Path,
    *,
    register_fonts: bool = False,
    pdf_page_count: int | None = None,
    pdf_fast_preview: bool = False,
) -> Any:
    """Load a PPTX or PDF into a PercyDocument bridge model.

    Routes to the right `percy.diagnostics.onboard` function based on file
    extension. Returns the same PercyDocument the underlying functions return —
    callers can downcast or treat polymorphically.

    Args:
      path: the file to onboard.
      register_fonts: if True, register the document's embedded fonts with
        matplotlib so reference renders use them. (Off by default because the
        backend hot path doesn't need matplotlib renders.)
      pdf_page_count / pdf_fast_preview: PDF-specific hints; ignored for PPTX.
    """
    p = Path(path)
    ext = p.suffix.lower()
    t0 = time.perf_counter()

    if ext == ".pdf":
        from percy.diagnostics.onboard import onboard_pdf
        doc = onboard_pdf(p)
    else:
        # Default to .pptx onboarding — also handles .ppsx, .pptm.
        from percy.diagnostics.onboard import onboard_pptx
        doc = onboard_pptx(p)

    dt = time.perf_counter() - t0
    log.info(
        "onboard %s: loaded %d slides in %.1fs (path=%s)",
        ext.lstrip(".") or "doc",
        len(getattr(doc, "slides", []) or []),
        dt,
        p.name,
    )

    if register_fonts:
        embedded = getattr(doc, "embedded_fonts", None)
        if embedded:
            try:
                from percy.diagnostics.render_png import _register_embedded_fonts
                _register_embedded_fonts(embedded)
            except Exception as e:
                # Don't fail onboarding if matplotlib font registration fails —
                # the bridge model is still valid for Studio rendering.
                log.warning("onboard %s: font registration failed: %s", p.name, e)

    return doc
