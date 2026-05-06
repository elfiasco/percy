import Paragraph from "@tiptap/extension-paragraph"

/**
 * Extends Tiptap's built-in Paragraph node with Bridge-specific attributes:
 *
 *   - spaceBefore (pt)  →  margin-top
 *   - spaceAfter  (pt)  →  margin-bottom
 *
 * Alignment is handled by the separate TextAlign extension (configured to
 * apply to "paragraph" nodes), so we leave that alone.
 */

export const BridgeParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      spaceBefore: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.marginTop
          if (!v) return null
          const n = parseFloat(v)
          return isNaN(n) ? null : n
        },
        renderHTML: (attrs: { spaceBefore?: number | null }) =>
          attrs.spaceBefore != null ? { style: `margin-top: ${attrs.spaceBefore}pt` } : {},
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
          attrs.spaceAfter != null ? { style: `margin-bottom: ${attrs.spaceAfter}pt` } : {},
      },
    }
  },
})
