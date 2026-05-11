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
          // CSS line-height < 1.0 makes the line box smaller than the glyph,
          // so the first line's glyph cap-top renders ABOVE the element's top
          // edge by ((1 - ls) / 2) * font-size. matplotlib's `va="top"` instead
          // places the glyph cap-top exactly at y0, so the same `ls` produces
          // visibly different vertical positions. Compensate by adding the
          // same delta as padding-top so CSS lines align to matplotlib's.
          //
          // This matches all lines (not just the first) because the per-line
          // glyph offset is identical inside CSS line boxes — the padding
          // shifts the whole paragraph down by the constant offset.
          const styles: string[] = []
          if (attrs.lineSpacing <= 10) {
            styles.push(`line-height: ${attrs.lineSpacing}`)
            if (attrs.lineSpacing < 1.0) {
              const padEm = ((1.0 - attrs.lineSpacing) / 2).toFixed(4)
              styles.push(`padding-top: ${padEm}em`)
            }
          } else {
            styles.push(`line-height: calc(${attrs.lineSpacing} * var(--pt-scale, 0.1574) * 1vh)`)
          }
          return { style: styles.join("; ") }
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
