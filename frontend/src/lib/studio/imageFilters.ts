// ── Image filter chain builder (Google Slides parity) ───────────────────────
// Composes a single SVG <filter> with feColorMatrix + feComponentTransfer
// for recolor + brightness/contrast + transparency. Plus separate filters
// for drop shadow and reflection.
//
// Recolor presets are color-matrix transforms applied BEFORE brightness/contrast.
// Sepia/Grayscale are theme-independent. Light/Dark variants would need theme
// accent color access — for now we provide a fixed set.

export type RecolorPreset =
  | "none"
  | "grayscale"
  | "sepia"
  | "negative"
  | "bw"           // black & white (high contrast)
  | "light1" | "light2" | "light3" | "light4"
  | "dark1"  | "dark2"  | "dark3"  | "dark4"

export const RECOLOR_PRESETS: Array<{ value: RecolorPreset; label: string }> = [
  { value: "none",      label: "No recolor" },
  { value: "grayscale", label: "Grayscale" },
  { value: "sepia",     label: "Sepia" },
  { value: "negative",  label: "Negative" },
  { value: "bw",        label: "Black & white" },
  { value: "light1",    label: "Light 1" },
  { value: "light2",    label: "Light 2" },
  { value: "light3",    label: "Light 3" },
  { value: "light4",    label: "Light 4" },
  { value: "dark1",     label: "Dark 1" },
  { value: "dark2",     label: "Dark 2" },
  { value: "dark3",     label: "Dark 3" },
  { value: "dark4",     label: "Dark 4" },
]

/** 4×5 color matrix as 20-value space-separated string for feColorMatrix. */
function recolorMatrix(preset: RecolorPreset): string | null {
  switch (preset) {
    case "grayscale":
      return "0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0"
    case "sepia":
      return "0.393 0.769 0.189 0 0  0.349 0.686 0.168 0 0  0.272 0.534 0.131 0 0  0 0 0 1 0"
    case "negative":
      return "-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
    case "bw":
      // Convert to grayscale, then push contrast hard via feComponentTransfer downstream.
      return "0.5 0.5 0.5 0 -0.25  0.5 0.5 0.5 0 -0.25  0.5 0.5 0.5 0 -0.25  0 0 0 1 0"
    // Light/Dark variants — fixed cobalt tints (would normally derive from theme accent1)
    case "light1": return "1 0 0 0 0.50  0 1 0 0 0.55  0 0 1 0 0.65  0 0 0 1 0"
    case "light2": return "1 0 0 0 0.30  0 1 0 0 0.40  0 0 1 0 0.55  0 0 0 1 0"
    case "light3": return "1 0 0 0 0.20  0 1 0 0 0.30  0 0 1 0 0.45  0 0 0 1 0"
    case "light4": return "1 0 0 0 0.10  0 1 0 0 0.20  0 0 1 0 0.35  0 0 0 1 0"
    case "dark1":  return "0.7 0 0 0 0  0 0.75 0 0 0  0 0 0.85 0 0  0 0 0 1 0"
    case "dark2":  return "0.55 0 0 0 0  0 0.6 0 0 0  0 0 0.7 0 0  0 0 0 1 0"
    case "dark3":  return "0.40 0 0 0 0  0 0.45 0 0 0  0 0 0.55 0 0  0 0 0 1 0"
    case "dark4":  return "0.25 0 0 0 0  0 0.30 0 0 0  0 0 0.40 0 0  0 0 0 1 0"
    case "none":
    default:
      return null
  }
}

export interface ImageFilterParams {
  brightness?: number       // -1 to +1
  contrast?: number         // -1 to +1
  transparency?: number     // 0 to 1
  recolor?: RecolorPreset
}

/** Render the body of an SVG <filter> for image effects. */
export function buildImageFilter(id: string, p: ImageFilterParams): string {
  const parts: string[] = []
  // 1) Recolor matrix (if any preset)
  const matrix = p.recolor && p.recolor !== "none" ? recolorMatrix(p.recolor) : null
  if (matrix) {
    parts.push(`<feColorMatrix type="matrix" values="${matrix}" />`)
  }
  // 2) Brightness + contrast — via feComponentTransfer on R/G/B channels.
  // brightness in [-1,1] → intercept additive offset
  // contrast   in [-1,1] → slope multiplier; slope = 1 + contrast*0.99
  const b = p.brightness ?? 0
  const c = p.contrast ?? 0
  if (b !== 0 || c !== 0) {
    const slope     = +(1 + Math.max(-0.99, Math.min(0.99, c))).toFixed(3)
    const intercept = +(b * 0.5).toFixed(3)   // ±50% adjustment range
    const fn = `<feFuncR type="linear" slope="${slope}" intercept="${intercept}" />` +
               `<feFuncG type="linear" slope="${slope}" intercept="${intercept}" />` +
               `<feFuncB type="linear" slope="${slope}" intercept="${intercept}" />`
    parts.push(`<feComponentTransfer>${fn}</feComponentTransfer>`)
  }
  // 3) Transparency — alpha-channel scale
  const t = p.transparency ?? 0
  if (t > 0) {
    const a = +(1 - Math.max(0, Math.min(1, t))).toFixed(3)
    parts.push(`<feComponentTransfer><feFuncA type="linear" slope="${a}" /></feComponentTransfer>`)
  }
  if (parts.length === 0) return ""
  return `<filter id="${id}" color-interpolation-filters="sRGB">${parts.join("")}</filter>`
}

/** Build a drop-shadow filter that augments the original. */
export function buildDropShadowFilter(
  id: string,
  opts: { color: string; blur: number; offsetX: number; offsetY: number; opacity: number },
): string {
  const { color, blur, offsetX, offsetY, opacity } = opts
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" />
    <feOffset dx="${offsetX}" dy="${offsetY}" result="blurred" />
    <feFlood flood-color="${color}" flood-opacity="${opacity}" />
    <feComposite in2="blurred" operator="in" />
    <feMerge>
      <feMergeNode />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>`
}

/** Returns true if any effect is non-default. */
export function hasImageEffects(p: ImageFilterParams): boolean {
  return Boolean(
    (p.recolor && p.recolor !== "none") ||
    (p.brightness && p.brightness !== 0) ||
    (p.contrast && p.contrast !== 0) ||
    (p.transparency && p.transparency > 0),
  )
}
