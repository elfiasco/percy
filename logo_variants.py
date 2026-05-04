#!/usr/bin/env python3
"""
Percy logo variant comparison sheet.
Renders 'percy' in multiple fonts with the custom y modification (rounded tip + white dot).
Output: percy_variants.svg  — open in browser to compare

Run: C:\\Users\\benst\\anaconda3\\python.exe logo_variants.py
"""
import sys
from pathlib import Path

try:
    from fontTools import ttLib
    from fontTools.varLib.instancer import instantiateVariableFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.misc.transform import Transform
except ImportError:
    sys.exit("pip install fonttools")

WORD    = "percy"
CAP_H   = 200      # target cap height in pixels — bigger = more visible detail
PAD     = 40       # horizontal padding around word
ROW_PAD = 30       # vertical padding above each row
ROW_GAP = 20       # gap between rows
LABEL_W = 200      # left margin for font name labels
KERN_PX = -1.5     # inter-letter kerning tweak

# Fonts to compare: (display_name, ttf_path, fvar_axes or None)
VARIANTS = [
    ("Bahnschrift Bold",     r"C:\Windows\Fonts\bahnschrift.ttf",    {"wght": 700, "wdth": 100}),
    ("Bahnschrift SemiBold", r"C:\Windows\Fonts\bahnschrift.ttf",    {"wght": 500, "wdth": 100}),
    ("Lato Bold",            r"C:\Windows\Fonts\LatoWeb-Bold.ttf",   None),
    ("Lato Semibold",        r"C:\Windows\Fonts\LatoWeb-Semibold.ttf", None),
    ("Franklin Gothic Hvy",  r"C:\Windows\Fonts\FRAHV.TTF",          None),
    ("Corbel Bold",          r"C:\Windows\Fonts\corbelb.ttf",        None),
]

# y modification sizing
DOME_R_MIN   = 10.0   # minimum dome radius in px (visible at any scale)
DOT_R_FRAC   = 0.38   # white dot = this fraction of dome radius


def load_font(path, axes):
    tt = ttLib.TTFont(path)
    if axes and "fvar" in tt:
        tt = instantiateVariableFont(tt, axes)
    return tt


def get_cap_height(tt):
    os2 = tt["OS/2"]
    cap = getattr(os2, "sCapHeight", None) or getattr(os2, "sxHeight", None)
    return cap or int(tt["head"].unitsPerEm * 0.72)


def get_descender(tt):
    os2 = tt["OS/2"]
    return getattr(os2, "sTypoDescender", -200)


def find_y_terminal(gs, y_name, scale):
    """
    Returns (cx_px, tip_y_px, stroke_r_px) in FINAL SVG coordinates
    relative to a baseline at y=0 and x=0.
    cx_px    : x center of the terminal
    tip_y_px : y of the descender tip (positive = below baseline in SVG)
    stroke_r_px : half-width of the terminal stroke in px
    """
    rec = RecordingPen()
    gs[y_name].draw(rec)

    # Collect only ON-CURVE points (last point in each op)
    on_curve = []
    for op, args in rec.value:
        if op in ("moveTo", "lineTo") and args:
            on_curve.append(args[0])
        elif op in ("qCurveTo", "curveTo") and args:
            on_curve.append(args[-1])   # last = on-curve endpoint

    y_min = min(pt[1] for pt in on_curve) if on_curve else 0

    # Terminal = on-curve points within a small tolerance of y_min
    tol = max(20, abs(y_min) * 0.05)
    term_pts = [pt for pt in on_curve if abs(pt[1] - y_min) <= tol]

    if term_pts:
        xs = [p[0] for p in term_pts]
        cx_u = (min(xs) + max(xs)) / 2
        stroke_r_u = (max(xs) - min(xs)) / 2
    else:
        cx_u, stroke_r_u = 0, 20

    # Convert from font units to SVG px (baseline at SVG y = CAP_H + ROW_PAD)
    # svg_y = baseline_svg_y - font_y * scale
    # Since we return relative to baseline_svg_y=0, tip_y_px = -y_min * scale
    cx_px       = cx_u * scale
    tip_y_px    = -y_min * scale           # positive = below baseline
    stroke_r_px = max(4.0, stroke_r_u * scale)

    return cx_px, tip_y_px, stroke_r_px


def render_row(tt, label, x0, baseline_y):
    """
    Render one row of 'percy' with the modified y.
    x0          : SVG x start of the word (after label)
    baseline_y  : SVG y of the baseline
    Returns (svg_elements_list, row_height_px, word_width_px)
    """
    cap_h_u = get_cap_height(tt)
    desc_u  = get_descender(tt)
    scale   = CAP_H / cap_h_u

    cmap = tt.getBestCmap()
    hmtx = tt["hmtx"]
    gs   = tt.getGlyphSet()
    y_name = cmap[ord("y")]

    # Terminal analysis
    y_cx_glyph, tip_y_px, stroke_r_px = find_y_terminal(gs, y_name, scale)

    # Dome and dot sizing
    dome_r   = max(DOME_R_MIN, stroke_r_px * 1.3)
    dot_r    = max(3.0, dome_r * DOT_R_FRAC)

    elems = []

    # ── Render each letter ──────────────────────────────────────────────────
    x_px = x0
    y_glyph_x_px = x0  # will be set when we hit 'y'
    for i, ch in enumerate(WORD):
        n   = cmap[ord(ch)]
        adv = hmtx[n][0] * scale
        if i:
            x_px += KERN_PX

        if ch == "y":
            y_glyph_x_px = x_px

        t = Transform(scale, 0, 0, -scale, x_px, baseline_y)
        pen = SVGPathPen(gs)
        gs[n].draw(TransformPen(pen, t))
        elems.append(f'<path d="{pen.getCommands()}" fill="black"/>')

        x_px += adv

    word_w = x_px - x0

    # ── y descender modification ─────────────────────────────────────────────
    # Terminal center in SVG coords
    term_svg_x = y_glyph_x_px + y_cx_glyph
    term_svg_y = baseline_y + tip_y_px      # below baseline

    # White rectangle to erase the flat terminal
    cover_h = dome_r * 0.6
    elems.append(
        f'<rect x="{term_svg_x - stroke_r_px - 1:.2f}" '
        f'y="{term_svg_y - cover_h:.2f}" '
        f'width="{(stroke_r_px + 1) * 2:.2f}" '
        f'height="{cover_h + 2:.2f}" fill="white"/>'
    )

    # Black dome: circle centered at terminal, creates rounded cap
    # Upper half blends into the stroke; lower half is the visible dome
    dome_cx = term_svg_x
    dome_cy = term_svg_y  # circle center at the tip = dome appears below stroke
    elems.append(
        f'<circle cx="{dome_cx:.2f}" cy="{dome_cy:.2f}" '
        f'r="{dome_r:.2f}" fill="black"/>'
    )

    # White dot at the tip
    elems.append(
        f'<circle cx="{dome_cx:.2f}" cy="{dome_cy:.2f}" '
        f'r="{dot_r:.2f}" fill="white"/>'
    )

    # ── Font label ───────────────────────────────────────────────────────────
    label_x = x0 - PAD - 8
    label_y = baseline_y - CAP_H / 2
    elems.append(
        f'<text x="{label_x:.0f}" y="{label_y:.0f}" '
        f'text-anchor="end" dominant-baseline="middle" '
        f'font-family="Segoe UI,Arial" font-size="13" fill="#555">{label}</text>'
    )

    # Row height: cap height + descender + dome overhang
    row_h = CAP_H + tip_y_px + dome_r + ROW_PAD
    return elems, row_h, word_w


def main():
    all_elems = []
    max_word_w = 0
    y_cursor   = ROW_PAD

    for label, path, axes in VARIANTS:
        try:
            tt = load_font(path, axes)
        except Exception as e:
            print(f"  SKIP {label}: {e}")
            continue

        cap_h_u = get_cap_height(tt)
        desc_u  = get_descender(tt)
        scale   = CAP_H / cap_h_u

        baseline_y = y_cursor + CAP_H
        x0 = LABEL_W + PAD

        elems, row_h, word_w = render_row(tt, label, x0, baseline_y)
        all_elems.extend(elems)
        max_word_w = max(max_word_w, word_w)
        y_cursor += row_h
        print(f"  {label}: cap_h={cap_h_u} scale={scale:.4f} word_w={word_w:.0f}px row_h={row_h:.0f}px")

    total_w = LABEL_W + PAD + max_word_w + PAD
    total_h = y_cursor + ROW_PAD

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_w:.0f} {total_h:.0f}" '
        f'width="{int(total_w)}" height="{int(total_h)}">',
        '<rect width="100%" height="100%" fill="white"/>',
        # Light divider lines
    ]
    svg.extend(all_elems)
    svg.append("</svg>")

    out = Path("percy_variants.svg")
    out.write_text("\n".join(svg), encoding="utf-8")
    print(f"\nSaved {out}  ({int(total_w)}x{int(total_h)}px)")
    import subprocess
    subprocess.Popen(["start", str(out)], shell=True)


if __name__ == "__main__":
    main()
