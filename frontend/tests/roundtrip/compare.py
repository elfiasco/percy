"""
Pixel-level comparison of Bridge reference render vs Studio canvas screenshot.

Usage:
  python compare.py <ref_dir> <studio_dir> [--output-dir=<dir>] [--top=N]

Each directory must contain PNG files named slide-001.png, slide-002.png, etc.
Outputs:
  - JSON report with RMS scores per slide (sorted worst → best)
  - Side-by-side diff images for the worst N slides (default 5)
"""

import sys
import os
import json
import math
import argparse
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw
    import numpy as np
except ImportError:
    print("ERROR: PIL and numpy are required. Run: pip install pillow numpy", file=sys.stderr)
    sys.exit(1)

try:
    from scipy.ndimage import gaussian_filter
    _BLUR_SIGMA = 5.0  # reduces sub-pixel font anti-aliasing noise, preserves structure
    _HAS_SCIPY = True
except ImportError:
    _HAS_SCIPY = False


def load_and_resize(path: Path, target_size: tuple[int, int] | None = None) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if target_size and img.size != target_size:
        img = img.resize(target_size, Image.LANCZOS)
    return np.array(img, dtype=np.float32)


def rms(a: np.ndarray, b: np.ndarray) -> float:
    """Root-mean-square pixel difference (0.0 = identical, 255.0 = max diff)."""
    diff = a.astype(float) - b.astype(float)
    return float(math.sqrt(np.mean(diff ** 2)))


def windowed_rms(a: np.ndarray, b: np.ndarray, radius: int = 4) -> float:
    """Fuzzy RMS: for each pixel in `a`, find the best-matching pixel in `b`
    within a ±`radius`-pixel window, and compute RMS of those minimum
    differences. Tolerant to small sub-pixel and anti-alias shifts that
    don't represent actual content differences.

    Radius 4 covers up to ~4px lateral drift between PowerPoint and
    Chromium font rendering — enough for kerning/anti-alias diff, not
    so much that genuinely-different content gets matched up.

    Implemented by shifting `b` over a (2r+1)×(2r+1) grid and taking the
    per-pixel min squared error across shifts. Vectorized via numpy
    slicing — O(window² × H × W).
    """
    if radius <= 0:
        return rms(a, b)
    a_f = a.astype(np.float32)
    b_f = b.astype(np.float32)
    H, W, C = a_f.shape
    # Pad b so all shifts have valid pixels at the edges
    b_pad = np.pad(b_f, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    # Start with a large per-pixel min squared error
    best_sq = np.full((H, W, C), np.inf, dtype=np.float32)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = b_pad[radius + dy : radius + dy + H,
                            radius + dx : radius + dx + W]
            sq = (a_f - shifted) ** 2
            np.minimum(best_sq, sq, out=best_sq)
    return float(math.sqrt(best_sq.mean()))


def psnr(rms_val: float) -> float:
    """Peak signal-to-noise ratio in dB. Higher = more similar."""
    if rms_val == 0:
        return float("inf")
    return 20 * math.log10(255.0 / rms_val)


def make_sidebyside(ref: Image.Image, studio: Image.Image, diff_amplified: Image.Image,
                    label: str, rms_val: float) -> Image.Image:
    """Create a side-by-side comparison image: ref | studio | diff (amplified 4×)."""
    W = 900
    scale = W / max(ref.width, 1)
    h = int(ref.height * scale)
    ref_s    = ref.resize((W, h), Image.LANCZOS)
    studio_s = studio.resize((W, h), Image.LANCZOS)
    diff_s   = diff_amplified.resize((W, h), Image.LANCZOS)

    margin = 28
    total_w = W * 3 + margin * 4
    total_h = h + margin * 2 + 24

    canvas = Image.new("RGB", (total_w, total_h), (30, 30, 30))
    canvas.paste(ref_s,    (margin,               margin))
    canvas.paste(studio_s, (margin + W + margin,  margin))
    canvas.paste(diff_s,   (margin + (W + margin) * 2, margin))

    draw = ImageDraw.Draw(canvas)
    draw.text((margin, margin + h + 4),                        "Bridge render (reference)", fill=(180, 180, 180))
    draw.text((margin + W + margin, margin + h + 4),           "Studio canvas (browser)",  fill=(180, 180, 180))
    draw.text((margin + (W + margin) * 2, margin + h + 4),     f"Diff ×4 — RMS={rms_val:.1f}",  fill=(220, 120, 80))
    draw.text((4, 4), label, fill=(200, 200, 200))
    return canvas


def compare_dirs(ref_dir: Path, studio_dir: Path, output_dir: Path, top_n: int = 5):
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find matching slide files
    results = []
    for ref_path in sorted(ref_dir.glob("slide-*.png")):
        name = ref_path.name
        studio_path = studio_dir / name
        if not studio_path.exists():
            print(f"  SKIP {name}: no matching studio screenshot", file=sys.stderr)
            continue

        try:
            ref_img    = Image.open(ref_path).convert("RGB")
            studio_img = Image.open(studio_path).convert("RGB")

            # Resize studio to match reference (may differ due to viewport/dpi)
            studio_resized = studio_img.resize(ref_img.size, Image.LANCZOS)

            ref_arr    = np.array(ref_img,     dtype=np.float32)
            studio_arr = np.array(studio_resized, dtype=np.float32)

            # Two scores reported:
            #   - blur_rms: classic Gaussian-blur-then-RMS (sigma=5). Bigger
            #     for any pixel-level color/position drift; useful for
            #     detecting WHOLE-region differences.
            #   - rms (fuzzy): windowed-min RMS with radius=4 — for each
            #     pixel in ref, finds the closest match in a ±4px window of
            #     studio. Tolerant of sub-pixel font / kerning drift so the
            #     score reflects ACTUAL content differences, not rendering
            #     noise. This is the primary score.
            if _HAS_SCIPY:
                # Light blur (sigma=2) just to suppress 1-px font anti-alias
                # noise before the windowed comparison; heavy blur destroys
                # the local minima we want to find with the window.
                ref_cmp    = gaussian_filter(ref_arr,    sigma=2.0)
                studio_cmp = gaussian_filter(studio_arr, sigma=2.0)
                # Also keep the heavier blur=5 score for back-compat reporting
                ref_blur5    = gaussian_filter(ref_arr,    sigma=_BLUR_SIGMA)
                studio_blur5 = gaussian_filter(studio_arr, sigma=_BLUR_SIGMA)
                blur_rms = rms(ref_blur5, studio_blur5)
            else:
                ref_cmp, studio_cmp = ref_arr, studio_arr
                blur_rms = rms(ref_arr, studio_arr)
            r = windowed_rms(ref_cmp, studio_cmp, radius=8)
            p = psnr(r)

            # Pixel diff image (amplified 4×, clamped to 255) — use unblurred for visual clarity
            diff_arr = np.clip(np.abs(ref_arr - studio_arr) * 4, 0, 255).astype(np.uint8)
            diff_img = Image.fromarray(diff_arr, "RGB")

            slide_num = int(name.replace("slide-", "").replace(".png", ""))
            results.append({
                "slide":    slide_num,
                "name":     name,
                "rms":      round(r, 2),
                "blur_rms": round(blur_rms, 2),
                "psnr_db":  round(p, 1),
                "ref_path": str(ref_path),
                "studio_path": str(studio_path),
                "_ref_img":    ref_img,
                "_studio_img": studio_img,
                "_diff_img":   diff_img,
            })
            print(f"  slide {slide_num:03d}: fuzzy={r:.1f}  blur={blur_rms:.1f}  PSNR={p:.1f}dB")

        except Exception as e:
            print(f"  ERROR {name}: {e}", file=sys.stderr)

    if not results:
        print("No slides compared.", file=sys.stderr)
        return

    # Sort worst → best
    results.sort(key=lambda r: r["rms"], reverse=True)

    # Save JSON report
    report = {
        "summary": {
            "slides_compared": len(results),
            "mean_rms":   round(sum(r["rms"] for r in results) / len(results), 2),
            "worst_rms":  results[0]["rms"],
            "best_rms":   results[-1]["rms"],
        },
        "slides": [
            {"slide": r["slide"], "rms": r["rms"], "blur_rms": r.get("blur_rms"), "psnr_db": r["psnr_db"]}
            for r in results
        ],
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(f"\n=== Summary ===")
    print(f"Slides compared: {report['summary']['slides_compared']}")
    print(f"Mean RMS:  {report['summary']['mean_rms']:.1f}")
    print(f"Worst RMS: {report['summary']['worst_rms']:.1f} (slide {results[0]['slide']})")
    print(f"Best RMS:  {report['summary']['best_rms']:.1f}  (slide {results[-1]['slide']})")
    print(f"\nReport: {report_path}")

    # Save side-by-side diff images for the worst N slides
    print(f"\nSaving top-{top_n} worst diffs:")
    for i, r in enumerate(results[:top_n]):
        label = f"slide {r['slide']:03d} — worst rank #{i+1}"
        img = make_sidebyside(
            r["_ref_img"], r["_studio_img"], r["_diff_img"],
            label, r["rms"]
        )
        out_path = output_dir / f"diff-{r['slide']:03d}.png"
        img.save(out_path)
        print(f"  {out_path}  (RMS={r['rms']:.1f})")

    # Also save ALL diffs as a summary page (thumbnails)
    if len(results) > top_n:
        save_summary_grid(results, output_dir)

    return report


def save_summary_grid(results: list, output_dir: Path):
    """Save a thumbnail grid of all slide RMS scores."""
    cols = 5
    rows = math.ceil(len(results) / cols)
    thumb_w, thumb_h = 320, 180
    margin = 4
    label_h = 20
    total_w = cols * (thumb_w + margin) + margin
    total_h = rows * (thumb_h + label_h + margin) + margin

    grid = Image.new("RGB", (total_w, total_h), (20, 20, 20))
    draw = ImageDraw.Draw(grid)

    for idx, r in enumerate(results):
        col = idx % cols
        row = idx // cols
        x = margin + col * (thumb_w + margin)
        y = margin + row * (thumb_h + label_h + margin)

        # Studio thumb
        studio_img = r["_studio_img"].resize((thumb_w, thumb_h), Image.LANCZOS)
        grid.paste(studio_img, (x, y))

        # Tint worst slides red, best green
        rank = idx / max(len(results) - 1, 1)  # 0 = worst, 1 = best
        r_c = int(220 * (1 - rank))
        g_c = int(180 * rank)
        draw.text((x + 2, y + thumb_h + 2),
                  f"S{r['slide']:03d}  RMS={r['rms']:.0f}",
                  fill=(r_c + 60, g_c + 80, 80))

    grid_path = output_dir / "grid.png"
    grid.save(grid_path)
    print(f"\nThumbnail grid: {grid_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("ref_dir",    help="Directory with reference PNGs (slide-NNN.png)")
    parser.add_argument("studio_dir", help="Directory with studio screenshots (slide-NNN.png)")
    parser.add_argument("--output-dir", default=None, help="Output dir for report + diffs (default: <studio_dir>/comparison)")
    parser.add_argument("--top", type=int, default=5, help="Number of worst slides to save as side-by-side diffs")
    args = parser.parse_args()

    ref_dir    = Path(args.ref_dir)
    studio_dir = Path(args.studio_dir)
    output_dir = Path(args.output_dir) if args.output_dir else studio_dir / "comparison"

    if not ref_dir.exists():
        print(f"ERROR: ref_dir not found: {ref_dir}", file=sys.stderr)
        sys.exit(1)
    if not studio_dir.exists():
        print(f"ERROR: studio_dir not found: {studio_dir}", file=sys.stderr)
        sys.exit(1)

    report = compare_dirs(ref_dir, studio_dir, output_dir, top_n=args.top)
    sys.exit(0 if report else 1)
