import { useTheme } from "../theme/ThemeContext"

/**
 * Percy phi-mark.
 *
 * Rendering strategy: the SVG is rendered as a plain <img>, which the
 * browser caches once and renders as true vector at every size — no
 * mask-image rasterization, no fill-rule weirdness.
 *
 * The source SVG is solid black. Theming is applied via CSS filter:
 *   — `invert(1)`           → black → white (cream-ish, paper)
 *   — `none`                → leave black (ink)
 *   — `invert + sepia/hue`  → champagne, etc.
 */

type Tone =
  | "auto"        // theme-aware: paper-ish on dark, ink on light
  | "paper"
  | "ink"
  | "champagne"
  | "muted"

interface Props {
  size?: number | string
  tone?: Tone
  className?: string
  title?: string
  spinning?: boolean
  style?: React.CSSProperties
}

// CSS filters that map "solid black source" → desired tone.
//
// `invert(1)` on pure black gives pure white, which is what we want for
// "paper" on a dark background. For champagne, we add a hue-rotate +
// sepia stack. Approximate but consistent with our restrained palette.
const TONE_TO_FILTER: Record<Exclude<Tone, "auto">, string> = {
  paper:     "invert(1) brightness(0.97)",
  ink:       "none",
  champagne: "invert(0.78) sepia(0.62) saturate(1.6) hue-rotate(355deg) brightness(0.95)",
  muted:     "invert(0.55)",
}

export default function Logo({
  size = 24, tone = "auto", className = "", title, spinning, style,
}: Props) {
  const { mode } = useTheme()
  const effective: Exclude<Tone, "auto"> = tone === "auto"
    ? (mode === "dark" ? "paper" : "ink")
    : tone

  const filter = TONE_TO_FILTER[effective]
  const dim = typeof size === "number" ? `${size}px` : size

  return (
    <img
      src="/percy-mark.svg"
      alt={title ?? "Percy"}
      className={className}
      draggable={false}
      style={{
        display:    "inline-block",
        width:      dim,
        height:     dim,
        flexShrink: 0,
        filter,
        animation:  spinning ? "logo-spin 4.5s linear infinite" : undefined,
        userSelect: "none",
        ...style,
      }}
    />
  )
}

if (typeof document !== "undefined" && !document.getElementById("percy-logo-style")) {
  const style = document.createElement("style")
  style.id = "percy-logo-style"
  style.textContent = "@keyframes logo-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }"
  document.head.appendChild(style)
}
