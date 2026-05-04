#!/usr/bin/env python3
"""
Percy brand asset generator.

Outputs:
  percy_logo.svg     – wordmark SVG (preview in browser)
  percy-brand.ttf    – Bahnschrift Bold with custom y glyph embedded

Font choice: Bahnschrift Bold
  DIN-style geometric sans, squared terminals by design, variable weight 300-700.
  Precision/engineering aesthetic fits Percy's value prop (structure, not decoration).

Custom y modification:
  The flat descender terminal (lineTo from (228,-433) to (167,-433)) is replaced
  with a semicircular dome arc. A white circle counter is added inside the dome.

Run: C:\\Users\\benst\\anaconda3\\python.exe make_logo.py
Requires: pip install fonttools  (already installed in Anaconda env)
"""

import sys
from pathlib import Path

try:
    from fontTools import ttLib
    from fontTools.varLib.instancer import instantiateVariableFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.misc.transform import Transform
except ImportError:
    sys.exit("Run: pip install fonttools")

# ── Config ───────────────────────────────────────────────────────────────────
FONT_PATH   = r"C:\Windows\Fonts\bahnschrift.ttf"
FONT_WEIGHT = 700       # Bahnschrift wght axis: 300 (Light) → 700 (Bold)

WORD        = "percy"
CAP_H_PX    = 120       # cap height in output pixels — scale the whole logo here
PAD         = 32        # canvas padding in pixels
KERN_PX     = -2        # inter-letter kerning tweak (negative = tighter)

# Exact Bahnschrift Bold y descender terminal (from font path inspection):
#   flat lineTo from right=(228,-433) to left=(167,-433), width=61 font units
TERM_R  = (228, -433)
TERM_L  = (167, -433)
DOME_H  = 61            # dome depth in font units (= terminal width → semicircle)

DOT_CX  = (TERM_R[0] + TERM_L[0]) / 2     # 197.5 — horizontal center of terminal
DOT_CY  = TERM_R[1] - DOME_H * 0.5        # -463.5 — vertical center of dome
DOT_R   = 15                               # white circle counter radius (font units)

OUT_SVG  = "percy_logo.svg"
OUT_FONT = "percy-brand.ttf"


def load_bold():
    tt = ttLib.TTFont(FONT_PATH)
    # Instantiate variable font at weight=700, full width=100
    return instantiateVariableFont(tt, {"wght": FONT_WEIGHT, "wdth": 100})


def pt_near(a, b, tol=1.0):
    """Fuzzy point equality (handles float coords from VF interpolation)."""
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


def modify_y_glyph(tt):
    """
    Replace the y's flat descender terminal with a dome arc,
    then add a CCW circle counter inside the dome (creates white hole when rendered).
    """
    cmap = tt.getBestCmap()
    name = cmap[ord("y")]
    gs   = tt.getGlyphSet()

    rec = RecordingPen()
    gs[name].draw(rec)

    new_ops = []
    for op, args in rec.value:
        if op == "lineTo" and len(args) == 1 and pt_near(args[0], TERM_L):
            # Replace flat terminal with dome: two implicit-on-curve quadratics.
            # off-curve points pushed down by DOME_H create a smooth U-arc.
            off1 = (TERM_R[0], TERM_R[1] - DOME_H)   # (228, -494)
            off2 = (TERM_L[0], TERM_L[1] - DOME_H)   # (167, -494)
            # Implicit on-curve at midpoint (197.5, -494) is the dome's deepest point.
            new_ops.append(("qCurveTo", (off1, off2, TERM_L)))
        else:
            new_ops.append((op, args))

    # Circular counter (CCW in font y-up space → hole in TrueType nonzero fill).
    cx, cy, r = DOT_CX, DOT_CY, DOT_R
    new_ops += [
        ("moveTo",   ((cx,     cy - r),)),
        ("qCurveTo", ((cx + r, cy - r), (cx + r, cy  ))),
        ("qCurveTo", ((cx + r, cy + r), (cx,     cy + r))),
        ("qCurveTo", ((cx - r, cy + r), (cx - r, cy  ))),
        ("qCurveTo", ((cx - r, cy - r), (cx,     cy - r))),
        ("closePath", ()),
    ]

    pen = TTGlyphPen(None)
    for op, args in new_ops:
        if   op == "moveTo":    pen.moveTo(args[0])
        elif op == "lineTo":    pen.lineTo(args[0])
        elif op == "qCurveTo":  pen.qCurveTo(*args)
        elif op == "curveTo":   pen.curveTo(*args)
        elif op == "closePath": pen.closePath()
        elif op == "endPath":   pen.endPath()

    tt["glyf"][name] = pen.glyph()
    print(f"  y: flat terminal -> dome (depth={DOME_H}u), white counter r={DOT_R}u")


def build_svg(tt):
    os2     = tt["OS/2"]
    cap_h_u = os2.sCapHeight or int(tt["head"].unitsPerEm * 0.72)
    desc_u  = os2.sTypoDescender  # negative
    scale   = CAP_H_PX / cap_h_u
    base_y  = PAD + CAP_H_PX      # SVG baseline

    cmap = tt.getBestCmap()
    hmtx = tt["hmtx"]
    gs   = tt.getGlyphSet()

    # Letter positions
    x_px = PAD
    glyphs = []
    for i, ch in enumerate(WORD):
        n = cmap[ord(ch)]
        if i:
            x_px += KERN_PX
        glyphs.append({"name": n, "x_px": x_px})
        x_px += hmtx[n][0] * scale

    total_w = x_px + PAD
    # Extra depth: dome extends DOME_H units below normal descender
    desc_px = abs(desc_u - DOME_H) * scale
    total_h = base_y + desc_px + PAD

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_w:.1f} {total_h:.1f}" '
        f'width="{int(total_w)}" height="{int(total_h)}">',
        "  <rect width=\"100%\" height=\"100%\" fill=\"white\"/>",
    ]

    for g in glyphs:
        t = Transform(scale, 0, 0, -scale, g["x_px"], base_y)
        svg_pen = SVGPathPen(gs)
        gs[g["name"]].draw(TransformPen(svg_pen, t))
        lines.append(f'  <path d="{svg_pen.getCommands()}" fill="black"/>')

    # White dot overlay at the y descender tip (belt-and-suspenders for SVG winding)
    y_name = cmap[ord("y")]
    y_glyph_idx = [i for i, g in enumerate(glyphs) if g["name"] == y_name]
    if y_glyph_idx:
        g = glyphs[y_glyph_idx[0]]
        t = Transform(scale, 0, 0, -scale, g["x_px"], base_y)
        # Dome deepest point in font space: (DOT_CX, TERM_R[1] - DOME_H)
        # Transform: svg_x = scale*font_x + x_px,  svg_y = base_y - scale*font_y
        dome_tip_font_y = TERM_R[1] - DOME_H   # = -494
        dot_svg_x = scale * DOT_CX + g["x_px"]
        dot_svg_y = base_y - scale * dome_tip_font_y
        dot_svg_r = DOT_R * scale
        lines.append(
            f'  <circle cx="{dot_svg_x:.2f}" cy="{dot_svg_y:.2f}" '
            f'r="{dot_svg_r:.2f}" fill="white"/>'
        )

    lines.append("</svg>")
    Path(OUT_SVG).write_text("\n".join(lines), encoding="utf-8")
    print(f"  SVG  -> {OUT_SVG}  ({int(total_w)}x{int(total_h)}px canvas)")


def main():
    print(f"Loading Bahnschrift Bold (wght={FONT_WEIGHT})...")
    tt = load_bold()

    print("Modifying y glyph...")
    modify_y_glyph(tt)

    print(f"Saving {OUT_FONT}...")
    tt.save(OUT_FONT)

    print("Building SVG logo...")
    tt2 = ttLib.TTFont(OUT_FONT)
    build_svg(tt2)

    print("\nDone.")
    print(f"  Preview : open {OUT_SVG} in a browser")
    print(f"  Font    : {OUT_FONT}  (install or use in design tools)")


if __name__ == "__main__":
    main()
