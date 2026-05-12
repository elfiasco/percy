"""Render PPTX slides to PNG using actual PowerPoint via COM automation.

Run once per deck — PowerPoint is the authoritative PPTX renderer (since
Microsoft defines the format), so its renders are the ground truth for
fidelity comparison. Drops the PNGs into a sibling `_powerpoint/` directory
next to each .pptx so the fidelity test can pick them up as the reference.

Usage:
    python scripts/render_pptx_powerpoint.py outreach/dump_pptx/*.pptx

Each slide is exported at a fixed pixel width to keep RMS comparison
geometry-stable.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import win32com.client


PNG_FORMAT = 17       # ppSaveAsPNG
SLIDE_WIDTH_PX = 1600 # arbitrary but consistent; height auto-scales per aspect


def render_deck(pptx_path: Path) -> Path:
    out_dir = pptx_path.parent / (pptx_path.stem + "__powerpoint")
    out_dir.mkdir(exist_ok=True)
    ppt = win32com.client.Dispatch("PowerPoint.Application")
    # WithWindow=False keeps PowerPoint hidden but the Application itself
    # may briefly show; that's fine for a one-shot tool.
    pres = ppt.Presentations.Open(str(pptx_path.absolute()), WithWindow=False)
    try:
        n_slides = pres.Slides.Count
        # Slide dimensions in points (PPT internal). Used to set export height
        # in proportion to the slide's actual aspect ratio.
        sw_pt = pres.PageSetup.SlideWidth
        sh_pt = pres.PageSetup.SlideHeight
        height_px = int(round(SLIDE_WIDTH_PX * sh_pt / sw_pt))

        for i in range(1, n_slides + 1):
            slide = pres.Slides.Item(i)
            out_path = out_dir / f"slide-{i:03d}.png"
            slide.Export(str(out_path.absolute()), "PNG", SLIDE_WIDTH_PX, height_px)
        print(f"  {pptx_path.name}: rendered {n_slides} slides into {out_dir.name}")
    finally:
        pres.Close()
        ppt.Quit()
    return out_dir


def main() -> int:
    args = [Path(p) for p in sys.argv[1:]]
    if not args:
        print("usage: render_pptx_powerpoint.py <pptx> [...]", file=sys.stderr)
        return 1
    for pptx in args:
        if not pptx.exists():
            print(f"  SKIP not found: {pptx}", file=sys.stderr)
            continue
        try:
            render_deck(pptx)
        except Exception as e:
            print(f"  ERROR {pptx.name}: {e}", file=sys.stderr)
            # Give the next deck a chance even if one fails
            time.sleep(2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
