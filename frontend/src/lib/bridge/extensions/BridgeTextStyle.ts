import { TextStyle } from "@tiptap/extension-text-style"

/**
 * Extends Tiptap's TextStyle mark with Bridge font attributes:
 *
 *   - fontName      →  font-family
 *   - fontSize      →  font-size (pt)
 *   - fontColor     →  color
 *   - caps          →  "all" → text-transform: uppercase
 *                      "small" → font-variant-caps: small-caps
 *   - baselineShift →  vertical-align (fraction of font-size; negative=superscript)
 *   - charSpacing   →  letter-spacing (pt)
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
  fontName?:      string | null
  fontSize?:      number | null
  fontColor?:     string | null
  caps?:          string | null
  baselineShift?: number | null
  charSpacing?:   number | null
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
          attrs.fontSize != null
            ? { style: `font-size: calc(${attrs.fontSize} * var(--pt-scale, 0.1574) * 1vh)` }
            : {},
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
      baselineShift: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.verticalAlign
          if (!v || v === "baseline") return null
          // Encoded as CSS percentage: -50% → shift = -0.5 (negative = superscript = up)
          if (v.endsWith("%")) return -parseFloat(v) / 100 || null
          return null
        },
        renderHTML: (attrs: BridgeStyleAttrs) => {
          if (attrs.baselineShift == null) return {}
          // Negative baselineShift = text goes up = negative vertical-align in CSS (superscript)
          return { style: `vertical-align: ${(-attrs.baselineShift * 100).toFixed(1)}%` }
        },
      },
      charSpacing: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.letterSpacing
          if (!v || v === "normal") return null
          // Convert from CSS pt back to OOXML hundredths-of-a-point
          const pt = pxToPt(v)
          return pt != null ? Math.round(pt * 100) : null
        },
        renderHTML: (attrs: BridgeStyleAttrs) =>
          // charSpacing is in OOXML units: hundredths of a point (spc attribute)
          attrs.charSpacing != null ? { style: `letter-spacing: ${(attrs.charSpacing / 100).toFixed(2)}pt` } : {},
      },
    }
  },
})
