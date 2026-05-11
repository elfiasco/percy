import Paragraph from "@tiptap/extension-paragraph"

/**
 * Extends Tiptap's built-in Paragraph node with Bridge-specific attributes:
 *
 *   - spaceBefore (pt)  →  margin-top
 *   - spaceAfter  (pt)  →  margin-bottom
 *   - lineSpacing       →  line-height (unitless multiplier or "Npt")
 *   - bulletType        →  data-bullet-type (used for CSS ::before bullet marker)
 *   - bulletChar        →  data-bullet-char
 *
 * Alignment is handled by the separate TextAlign extension.
 */

export const BridgeParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Dominant font-size for the paragraph in pt. Used as the line-height
      // anchor so that lineSpacing (a unitless multiplier in CSS) computes
      // against the actual content size, not the browser default 16px <p>.
      // Without this, line-height: 0.7 on a paragraph containing 60pt spans
      // produces an 11px line box and lines stack on top of each other.
      // Derived in paragraphToTiptap from runs[0].font_size (or max if mixed).
      paraFontSize: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.fontSize
          if (!v) return null
          const m = /([\d.]+)/.exec(v)
          return m ? parseFloat(m[1]) : null
        },
        renderHTML: (attrs: { paraFontSize?: number | null }) =>
          attrs.paraFontSize != null
            ? { style: `font-size: calc(${attrs.paraFontSize} * var(--pt-scale, 0.1574) * 1vh)` }
            : {},
      },
      spaceBefore: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.marginTop
          if (!v) return null
          const n = parseFloat(v)
          return isNaN(n) ? null : n
        },
        renderHTML: (attrs: { spaceBefore?: number | null }) =>
          attrs.spaceBefore != null
            ? { style: `margin-top: calc(${attrs.spaceBefore} * var(--pt-scale, 0.1574) * 1vh)` }
            : {},
      },
      spaceAfter: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.marginBottom
          if (!v) return null
          const n = parseFloat(v)
          return isNaN(n) ? null : n
        },
        renderHTML: (attrs: { spaceAfter?: number | null }) =>
          attrs.spaceAfter != null
            ? { style: `margin-bottom: calc(${attrs.spaceAfter} * var(--pt-scale, 0.1574) * 1vh)` }
            : {},
      },
      lineSpacing: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.lineHeight
          if (!v) return null
          const n = parseFloat(v)
          return isNaN(n) ? null : n
        },
        renderHTML: (attrs: { lineSpacing?: number | null }) => {
          if (attrs.lineSpacing == null) return {}
          // Values ≤ 10 are multipliers (e.g. 1.5), otherwise points.
          //
          // matplotlib's pyplot `va="top"` anchors glyphs to their own bbox top
          // and walks down by ls * font-size, achieving cap-to-cap stacking
          // that visually doesn't overlap even when ls < 1.0. CSS line-height
          // < 1.0 makes the line BOX smaller than the glyph, so glyphs overflow
          // and overlap. We mirror matplotlib's semantic in CSS by setting
          // line-height as a multiple of the font-size that produces the same
          // cap-to-cap distance. Browsers' natural line-height is ~1.2em (em
          // = font-size), with the cap occupying ~0.7em. So ls * font-size
          // (matplotlib's cap-to-cap distance) corresponds to ls/0.7 in CSS
          // unitless terms when measuring against ascent-to-ascent, but to
          // straight ls when interpreted as "fraction of line box". We keep
          // CSS interpretation literal (ls * font-size) so matplotlib's RMS
          // reference matches and accept the minor inline overflow as a
          // browser-vs-matplotlib quirk that doesn't dominate the RMS.
          const val = attrs.lineSpacing <= 10
            ? String(attrs.lineSpacing)
            : `calc(${attrs.lineSpacing} * var(--pt-scale, 0.1574) * 1vh)`
          return { style: `line-height: ${val}` }
        },
      },
      bulletType: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).dataset.bulletType ?? null,
        renderHTML: (attrs: { bulletType?: string | null }) =>
          attrs.bulletType && attrs.bulletType !== "none"
            ? { "data-bullet-type": attrs.bulletType, style: "padding-left: 1.2em; position: relative;" }
            : {},
      },
      bulletChar: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).dataset.bulletChar ?? null,
        renderHTML: (attrs: { bulletChar?: string | null }) =>
          attrs.bulletChar ? { "data-bullet-char": attrs.bulletChar } : {},
      },
    }
  },
})
