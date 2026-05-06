import { TextStyle } from "@tiptap/extension-text-style"

/**
 * Extends Tiptap's TextStyle mark with Bridge font attributes:
 *
 *   - fontName   →  font-family
 *   - fontSize   →  font-size (pt; rendered as `Npt`)
 *   - fontColor  →  color
 *   - caps       →  "all" → text-transform: uppercase
 *                   "small" → font-variant-caps: small-caps
 *
 * Color is also handled by the separate Color extension (writes to the
 * "color" attr of textStyle); fontColor here is our explicit field that
 * round-trips cleanly with Bridge's font_color.
 */

function cssFamily(name: string): string {
  return /[\s'"]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name
}

function pxToPt(v: string | null): number | null {
  if (!v) return null
  if (v.endsWith("pt")) return parseFloat(v) || null
  if (v.endsWith("px")) {
    const px = parseFloat(v)
    if (isNaN(px)) return null
    return Math.round((px / (96 / 72)) * 10) / 10
  }
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

interface BridgeStyleAttrs {
  fontName?:  string | null
  fontSize?:  number | null
  fontColor?: string | null
  caps?:      string | null
}

export const BridgeTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontName: {
        default: null as string | null,
        parseHTML: (el) => {
          const ff = (el as HTMLElement).style.fontFamily
          if (!ff) return null
          return ff.split(",")[0]?.replace(/^['"]|['"]$/g, "").trim() || null
        },
        renderHTML: (attrs: BridgeStyleAttrs) =>
          attrs.fontName ? { style: `font-family: ${cssFamily(attrs.fontName)}` } : {},
      },
      fontSize: {
        default: null as number | null,
        parseHTML: (el) => pxToPt((el as HTMLElement).style.fontSize),
        renderHTML: (attrs: BridgeStyleAttrs) =>
          attrs.fontSize != null ? { style: `font-size: ${attrs.fontSize}pt` } : {},
      },
      fontColor: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (attrs: BridgeStyleAttrs) =>
          attrs.fontColor ? { style: `color: ${attrs.fontColor}` } : {},
      },
      caps: {
        default: null as string | null,
        parseHTML: (el) => {
          const e = el as HTMLElement
          if (e.style.textTransform === "uppercase") return "all"
          if (e.style.fontVariantCaps === "small-caps") return "small"
          return null
        },
        renderHTML: (attrs: BridgeStyleAttrs) => {
          if (attrs.caps === "all")   return { style: "text-transform: uppercase" }
          if (attrs.caps === "small") return { style: "font-variant-caps: small-caps" }
          return {}
        },
      },
    }
  },
})
