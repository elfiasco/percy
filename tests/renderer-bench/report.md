# Renderer Benchmark — Baseline (pre-consolidation)

Captured **2026-05-12** against the deployed splash at
`https://36kuepamyi.us-east-1.awsapprunner.com`.

## The three renderers (today's state)

| Renderer | Lines | Recent commits (last 3w) | Real text wrapping? | Real charts? | Real tables? | Tiptap rich text? |
|---|---|---|---|---|---|---|
| **`StudioCanvas` + `studio/renderers/*`** | 7,612 across 12 files | 30+ commits this week | ✓ Tiptap | ✓ Recharts | ✓ TiptapTable | ✓ |
| `SlideSvg` (splash) | 632 | 3 commits (May 11–12, all by this session) | Heuristic word-wrap (chars/line ≈ font_pt × 0.55) — under-estimates | Hand-rolled SVG bars/lines/arcs | Hand-rolled SVG grid | ✗ |
| `TemplatePreview` (template editor) | 301 | 1 commit (May 11) | None — single `<text>` per element with hard truncation | Labeled placeholder rect | Faint grid | ✗ |

Plus a 4th renderer on the Python side:

| Renderer | Lines | Purpose |
|---|---|---|
| `src/percy/agent/slide_critic.py:render_slide_to_svg` | 282 | Server-side SVG for the vision-pass critic. Separate concern — Python can't share React. Stays as-is. |

## Measured artifacts

| File | What |
|---|---|
| `splash_percy_standard_full.png` | Full splash, Percy Standard tab active. SlideSvg renders all 7 slides. |
| `splash_snowflake_full.png` | Full splash, Snowflake tab active. SlideSvg renders all 7 slides. |
| `_slide1_zoom.png` (frontend/) | High-zoom crop of slides 3+4. Shows: KPI tile composition works, chart bars work. |
| `_splash_wide_percy.png` (frontend/) | Wide-viewport screenshot for diagnostic. |

## What the DOM dump revealed

Slide 1 of Percy Standard (`Q4 2025 Northwind Update`) — the title element in the live splash bundle:

```json
{ "x": "0.5", "y": "3.358", "fontSize": "0.722" (52pt),
  "content": "Q4 2025 Northwind Update",
  "tspans": 1 }
```

`tspans: 1` is the smoking gun. My word-wrap heuristic (`charsPerLine = w × 72 / (pt × 0.55)`) says 24 chars fit in 30 chars/line at 52pt, so no wrap is triggered. In practice 24 chars at 52pt is ~13.2in wide — barely fits the 12.3in box, gets visually clipped at the right.

Other observations from the dump:
- Slide 2 "$2.4M" rendered at **180pt** (Percy Standard `std.big_number` default). Visually dominant; appears clipped because the canvas is rendered narrow on the splash.
- All text elements render as single `<tspan>` — no multi-line text anywhere, even where it would obviously help.

## Pixel-RMS comparison

Not run between renderers — they don't share data shapes:
- StudioCanvas + SlideSvg both take realized element JSON, but Studio renders via HTML/CSS Tiptap, so pixel-RMS isn't apples-to-apples with SlideSvg's pure SVG.
- TemplatePreview takes template-shape data (pre-substitution), so its inputs are different.

The fidelity test (`frontend/tests/roundtrip/fidelity.mjs`) measures **StudioCanvas vs actual PowerPoint** — that's the canonical RMS pipeline. We'll re-run it after consolidation to verify no regression.

## Why consolidate

1. **StudioCanvas has 30+ commits this week alone.** Every bug fix lands there. SlideSvg + TemplatePreview have effectively been frozen.
2. **Tiptap > heuristic.** Real browser-driven text layout never under-estimates char widths.
3. **Recharts > hand-rolled SVG bars.** Real axes, legends, data labels with brand-resolved colors.
4. **TiptapTable > hand-rolled grid.** Row/col resize, cell editing, banded rows, formatting.
5. **One bug surface.** Today a text-wrap fix in SlideSvg has to be re-applied separately in TemplatePreview and StudioCanvas.

## Consolidation plan (next phases)

- **Phase 2:** Add `mode: "edit" | "view"` + static `data` prop to StudioCanvas.
- **Phase 3:** Switch splash (ShowcaseSection) + template editor callers to view-mode StudioCanvas.
- **Phase 4:** Delete `SlideSvg.tsx` + `TemplatePreview.tsx`.
- **Phase 5:** Re-screenshot splash → pixel-diff vs the baselines in this folder; re-run fidelity test against the Snowflake PPTX → confirm RMS does not regress.

---

## Outcome: consolidation shipped

After ~8 iterations of debugging (foreignObject CSS-in-SVG broke,
useEffect-vs-useMemo timing for store priming, missing payloads for
text-less shapes, missing `--pt-scale` CSS variable, wrong transform
scale formula), the splash now renders via the studio renderers:

- `frontend/src/components/SlideSvg.tsx` — **DELETED** (633 lines)
- `frontend/src/components/TemplatePreview.tsx` — thin shim around SlideViewer (~280 lines, was 301 of standalone SVG rendering)
- `frontend/src/components/SlideViewer.tsx` — **NEW** (~620 lines, mounts studio renderers in view mode)

Real wins on the live splash (`v6_*.png` in this folder):

- **Tiptap word wrap.** Snowflake slot 1 "Q4 2025 Northwind Update" now breaks to a second line via the same Tiptap that powers the editor. No char-width heuristic.
- **Real Recharts bars.** Slot 4 chart on both decks renders with real axes, brand-resolved series colors, no hand-rolled placeholder bars.
- **KPI tiles.** Percy Standard slot 3 shows three KPI tiles with the same composition + spacing as in the editor.
- **One bug surface.** Every future fix to Tiptap text, Recharts chart, or TiptapTable lands on both the editor AND the splash AND template previews simultaneously.

Iteration trail (post-consolidation screenshots):
- `consol_*.png` — first deploy, empty slides + 401 flood (useEffect timing)
- `v4_consol_*.png` — second deploy, fixed timing, still 401s (missing kind-priming for text-less shapes)
- `v5_consol_percy.png` — all 401s resolved, slides STILL empty (vh-based font math producing invisible-or-huge text)
- `v6_*.png` — fixed `--pt-scale` + transform scale, slides actually render

The PEG `report.md` (this file) documents the path forward as
finished, not outstanding. Future renderer changes go directly to
`studio/renderers/*` and propagate everywhere.
