import React from "react"

/**
 * TemplatePreview — client-side SVG renderer for Template layouts.
 *
 * Takes a Template's `layout` array + `sample_inputs` and produces a
 * faithful-enough thumbnail of what the slide will look like. Good for
 * browsing template cards in the editor and on the dashboard — no
 * round-trip to the server, no thumbnail caching.
 *
 * Renders:
 *   - shape elements → <rect> with fill_color
 *   - text elements  → <text> with font_name/size/color (using {{var}}
 *                       substitution from sample_inputs)
 *   - chart elements → labeled placeholder rect
 *   - table elements → faint grid
 *   - everything else → outlined rect with kind label
 *
 * Positions are taken from body.position (left_in/top_in/width_in/height_in)
 * on a 13.333 x 7.5 inch canvas. We scale to whatever size the caller
 * asks for via the `width` prop.
 */

interface LayoutEntry {
  kind?: string
  alias?: string
  body?: Record<string, unknown>
}

interface PaletteEntry {
  name?: string
  hex?: string
  role?: string
}

export interface TemplatePreviewProps {
  layout: LayoutEntry[]
  sampleInputs?: Record<string, unknown>
  /** Final pixel width of the thumbnail. Height auto-scales to 16:9. */
  width?: number
  className?: string
  /** If provided, used to resolve named palette tokens to hex. */
  palette?: PaletteEntry[]
  /** Background color override. Defaults to the active theme's "ink". */
  background?: string
}

const CANVAS_W = 13.333
const CANVAS_H = 7.5
const DEFAULT_BG = "#F9F8F4"


// {{var}} → sampleInputs[var] (string only — non-string values fall through)
function substitute(s: string, inputs: Record<string, unknown>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = inputs[name]
    return v == null ? "" : String(v)
  })
}

function resolveColor(
  raw: unknown,
  inputs: Record<string, unknown>,
  palette: PaletteEntry[] = [],
  fallback = "#000000",
): string {
  if (raw == null) return fallback
  let v = String(raw)
  if (v.includes("{{")) v = substitute(v, inputs)
  // Hex?
  if (v.startsWith("#")) return v
  // Named palette lookup
  const hit = palette.find((c) => c.name === v || c.role === v)
  if (hit?.hex) return hit.hex
  // Percy palette name fallbacks for common tokens used by built-ins
  const named: Record<string, string> = {
    ink: "#F9F8F4", paper: "#2A2F3A", muted: "#6A6F7A",
    cobalt: "#7DA1CC", sage: "#6FA17A", cream: "#F0E6D8",
    ochre: "#C5994A", brick: "#B8634F",
    accent1: "#7DA1CC", accent2: "#6FA17A",
    white: "#FFFFFF", black: "#000000", text: "#2A2F3A",
  }
  return named[v.toLowerCase()] ?? fallback
}

function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : fallback
}


export default function TemplatePreview({
  layout,
  sampleInputs = {},
  width = 320,
  className,
  palette = [],
  background = DEFAULT_BG,
}: TemplatePreviewProps) {
  const height = Math.round((width * CANVAS_H) / CANVAS_W)
  // SVG viewBox is in inches; let the browser scale to pixel width.
  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ display: "block" }}
    >
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={background} />
      {layout.map((entry, idx) => (
        <LayoutEl
          key={idx}
          entry={entry}
          sampleInputs={sampleInputs}
          palette={palette}
        />
      ))}
    </svg>
  )
}

function LayoutEl({
  entry, sampleInputs, palette,
}: {
  entry: LayoutEntry
  sampleInputs: Record<string, unknown>
  palette: PaletteEntry[]
}) {
  const body = (entry.body ?? {}) as Record<string, unknown>
  const pos = (body.position ?? {}) as Record<string, unknown>
  const x = safeNumber(pos.left_in)
  const y = safeNumber(pos.top_in)
  const w = safeNumber(pos.width_in, 1)
  const h = safeNumber(pos.height_in, 0.5)

  const kind = entry.kind || "shape"

  // ── shape ──
  if (kind === "shape") {
    const fill = resolveColor(body.fill_color, sampleInputs, palette, "#E5E5E5")
    const text = typeof body.text === "string" ? substitute(body.text, sampleInputs) : ""
    const textColor = resolveColor(body.text_color, sampleInputs, palette, "#2A2F3A")
    const fontSize = safeNumber(body.font_size, 12) / 72  // pt → inches (≈ /72)
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={fill} />
        {text && (
          <text
            x={x + w / 2}
            y={y + h / 2}
            fontSize={fontSize}
            fill={textColor}
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight={body.font_bold ? 700 : 400}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {text.length > 40 ? text.slice(0, 38) + "…" : text}
          </text>
        )}
      </g>
    )
  }

  // ── text ──
  if (kind === "text") {
    const text = typeof body.text === "string" ? substitute(body.text, sampleInputs) : ""
    const color = resolveColor(body.text_color, sampleInputs, palette, "#2A2F3A")
    const fontSize = safeNumber(body.font_size, 12) / 72
    const align = String(body.text_align || "left")
    const bold = !!body.font_bold
    const italic = !!body.font_italic
    const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start"
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w : x

    // Wrap naively — if text is long, break it into ~30-char lines.
    const lines: string[] = []
    const remaining = text
    if (remaining.length <= 60) {
      lines.push(remaining)
    } else {
      const words = remaining.split(" ")
      let line = ""
      for (const word of words) {
        if ((line + " " + word).trim().length > 60) {
          lines.push(line.trim())
          line = word
        } else {
          line = (line + " " + word).trim()
        }
        if (lines.length >= 4) break
      }
      if (line && lines.length < 4) lines.push(line.trim())
      if (lines.length === 4 && remaining.length > lines.join(" ").length) {
        lines[3] = lines[3].slice(0, 50) + "…"
      }
    }

    return (
      <g>
        {lines.map((ln, i) => (
          <text
            key={i}
            x={tx}
            y={y + fontSize * (1.05 + i * 1.15)}
            fontSize={fontSize}
            fill={color}
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight={bold ? 700 : 400}
            fontStyle={italic ? "italic" : "normal"}
            textAnchor={anchor}
          >
            {ln}
          </text>
        ))}
      </g>
    )
  }

  // ── chart ──
  if (kind === "chart") {
    const fill = resolveColor(body.fill_color, sampleInputs, palette, "#F0E6D8")
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={fill} opacity={0.6} />
        {/* Stylized chart bars to suggest "this is a chart" */}
        {[0.15, 0.4, 0.65].map((frac, i) => (
          <rect
            key={i}
            x={x + w * 0.15 + i * w * 0.25}
            y={y + h * (1 - frac * 0.7)}
            width={w * 0.12}
            height={h * frac * 0.7}
            fill="#7DA1CC"
            opacity={0.6}
          />
        ))}
        <text
          x={x + w / 2}
          y={y + h - 0.1}
          fontSize={0.12}
          fill="#6A6F7A"
          fontFamily="Inter, system-ui, sans-serif"
          textAnchor="middle"
        >
          chart
        </text>
      </g>
    )
  }

  // ── table ──
  if (kind === "table") {
    const cols = 4
    const rows = 4
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" stroke="#D5D5D5" strokeWidth={0.02} />
        <rect x={x} y={y} width={w} height={h / rows} fill="#7DA1CC" />
        {Array.from({ length: cols - 1 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={x + (w / cols) * (i + 1)} x2={x + (w / cols) * (i + 1)}
            y1={y} y2={y + h} stroke="#D5D5D5" strokeWidth={0.015}
          />
        ))}
        {Array.from({ length: rows - 1 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={x} x2={x + w}
            y1={y + (h / rows) * (i + 1)} y2={y + (h / rows) * (i + 1)}
            stroke="#D5D5D5" strokeWidth={0.015}
          />
        ))}
      </g>
    )
  }

  // ── connector / image / live-group / fallback ──
  const label = kind === "image-typed" ? "image" : kind
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h}
        fill="none" stroke="#9C9EA7" strokeWidth={0.02} strokeDasharray="0.05 0.05"
      />
      <text
        x={x + w / 2} y={y + h / 2}
        fontSize={0.18}
        fill="#9C9EA7"
        fontFamily="Inter, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {label}
      </text>
    </g>
  )
}
