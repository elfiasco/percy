/**
 * SlideSvg — client-side SVG renderer for a MATERIALIZED Bridge slide.
 *
 * Sibling of TemplatePreview (which renders TEMPLATE layouts pre-substitution).
 * This component renders the slide AFTER the agent has filled it in — so it
 * walks real BridgeText / BridgeShape / BridgeChart / BridgeTable element
 * data and emits a faithful SVG with the actual text, colors, and layout.
 *
 * Data source: GET /api/docs/{doc_id}/slides/{n}/svg-data (unauthenticated;
 * served by template_sets_api._serialize_element_for_svg). Random 8-char
 * doc_ids make these effectively non-enumerable for the showcase.
 *
 * Used by the marketing splash to show side-by-side generated decks from
 * different Template Sets. Same prompt → different visual output, all
 * rendered client-side from element JSON.
 */

import { useEffect, useState } from "react"

interface ElementJson {
  type: string
  position?: { left_in: number; top_in: number; width_in: number; height_in: number }
  fill?: { type?: string | null; color?: string | null }
  text_runs?: Array<{
    text: string
    font_name?: string | null
    font_size?: number | null
    font_bold?: boolean | null
    font_italic?: boolean | null
    color?: string | null
  }>
  text_align?: string | null
  line?: { visible?: boolean; color?: string | null; width?: number | null }
  chart_type?: string | null
  chart_categories?: string[]
  chart_series_count?: number
  table_dim?: [number, number]
}

interface SlideSvgData {
  doc_id: string
  slide_n: number
  width_in: number
  height_in: number
  elements: ElementJson[]
}

export interface SlideSvgProps {
  docId: string
  slideN: number
  /** Final pixel width; height scales 16:9. */
  width?: number
  className?: string
  /** Background fill — defaults to white. */
  background?: string
}


export default function SlideSvg({
  docId, slideN, width = 480, className, background = "#FFFFFF",
}: SlideSvgProps) {
  const [data, setData] = useState<SlideSvgData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/docs/${docId}/slides/${slideN}/svg-data`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN])

  if (error) {
    return (
      <div className={className} style={{ width, height: (width * 7.5) / 13.333 }}>
        <div className="w-full h-full bg-ink/30 flex items-center justify-center text-[10px] text-muted">
          (slide unavailable)
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className={className} style={{ width, height: (width * 7.5) / 13.333 }}>
        <div className="w-full h-full bg-surface/30 animate-pulse" />
      </div>
    )
  }

  const W = data.width_in || 13.333
  const H = data.height_in || 7.5
  const height = Math.round((width * H) / W)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ display: "block" }}
    >
      <rect x={0} y={0} width={W} height={H} fill={background} />
      {data.elements.map((el, idx) => (
        <ElementSvg key={idx} el={el} canvasW={W} canvasH={H} />
      ))}
    </svg>
  )
}


function ElementSvg({ el, canvasW, canvasH }: { el: ElementJson; canvasW: number; canvasH: number }) {
  const pos = el.position
  if (!pos) return null
  const { left_in: x, top_in: y, width_in: w, height_in: h } = pos
  if (w <= 0 || h <= 0) return null

  const fillColor = el.fill?.color
  const lineColor = el.line?.color
  const lineWidth = el.line?.width ?? 0
  const showStroke = el.line?.visible !== false && !!lineColor && lineWidth > 0

  switch (el.type) {
    case "BridgeShape":
    case "BridgeFreeform":
      return (
        <g>
          {fillColor && (
            <rect x={x} y={y} width={w} height={h} fill={fillColor} />
          )}
          {showStroke && (
            <rect x={x} y={y} width={w} height={h} fill="none"
                  stroke={lineColor as string}
                  strokeWidth={Math.max(0.005, (lineWidth || 1) / 72)} />
          )}
          <TextRuns runs={el.text_runs} x={x} y={y} w={w} h={h} align={el.text_align as string | undefined} />
        </g>
      )

    case "BridgeText":
      return (
        <g>
          {fillColor && (
            <rect x={x} y={y} width={w} height={h} fill={fillColor} opacity={0.85} />
          )}
          <TextRuns runs={el.text_runs} x={x} y={y} w={w} h={h} align={el.text_align as string | undefined} />
        </g>
      )

    case "BridgeChart":
      return <ChartPlaceholder x={x} y={y} w={w} h={h}
                               chartType={el.chart_type}
                               categories={el.chart_categories}
                               seriesCount={el.chart_series_count}
                               textRuns={el.text_runs} />

    case "BridgeTable":
      return <TablePlaceholder x={x} y={y} w={w} h={h} dim={el.table_dim} />

    case "BridgeConnector":
      return showStroke ? (
        <line x1={x} y1={y} x2={x + w} y2={y + h}
              stroke={lineColor as string}
              strokeWidth={Math.max(0.01, (lineWidth || 1) / 72)} />
      ) : null

    case "BridgeImage":
      // Don't render image bytes client-side for performance; just show a
      // dotted placeholder so the layout doesn't collapse.
      return (
        <rect x={x} y={y} width={w} height={h}
              fill="#F0F0F0" stroke="#D0D0D0"
              strokeWidth={0.015} strokeDasharray="0.04 0.04" />
      )

    default:
      return null
  }
}


function TextRuns({
  runs, x, y, w, h, align,
}: {
  runs: ElementJson["text_runs"]
  x: number; y: number; w: number; h: number
  align?: string
}) {
  if (!runs || runs.length === 0) return null
  const baseSize = (runs[0]?.font_size as number) || 14
  const sizeIn = baseSize / 72
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start"
  const tx = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x
  const ty = y + sizeIn * 1.1

  // Concatenate run text. Mixed formatting within runs is hard to do in SVG
  // without measuring; we render the first run's formatting and concatenate
  // text content. Faithful enough for the splash.
  const text = runs.map((r) => r.text).join("")
  if (!text.trim()) return null
  const first = runs[0]
  const color = first.color || "#2A2F3A"
  const bold = !!first.font_bold
  const italic = !!first.font_italic
  const fontFamily = first.font_name || "Inter, system-ui, sans-serif"

  // Cap text length for tiny boxes
  const maxChars = Math.floor((w / sizeIn) * 1.8)
  const displayText = text.length > maxChars ? text.slice(0, Math.max(0, maxChars - 1)) + "…" : text

  return (
    <text
      x={tx} y={ty}
      fontSize={sizeIn}
      fill={color}
      fontFamily={fontFamily}
      fontWeight={bold ? 700 : 400}
      fontStyle={italic ? "italic" : "normal"}
      textAnchor={anchor}
    >
      {displayText}
    </text>
  )
}


function ChartPlaceholder({
  x, y, w, h, chartType, categories, seriesCount, textRuns,
}: {
  x: number; y: number; w: number; h: number
  chartType?: string | null
  categories?: string[]
  seriesCount?: number
  textRuns?: ElementJson["text_runs"]
}) {
  const palette = ["#7DA1CC", "#6FA17A", "#C5994A", "#B8634F"]
  const ct = (chartType || "").toLowerCase()
  const isDonut = ct.includes("donut") || ct.includes("doughnut") || ct.includes("pie")
  const isLine = ct.includes("line")
  const isArea = ct.includes("area")

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#FAFAFA" />
      {isDonut ? (
        // Three-slice donut sketch
        <>
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.4}
                  fill="none" stroke={palette[0]} strokeWidth={Math.min(w, h) * 0.16}
                  strokeDasharray={`${Math.PI * Math.min(w, h) * 0.4} ${Math.PI * Math.min(w, h) * 0.6}`}
                  transform={`rotate(-90 ${x + w / 2} ${y + h / 2})`} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.4}
                  fill="none" stroke={palette[1]} strokeWidth={Math.min(w, h) * 0.16}
                  strokeDasharray={`${Math.PI * Math.min(w, h) * 0.25} ${Math.PI * Math.min(w, h) * 0.75}`}
                  transform={`rotate(60 ${x + w / 2} ${y + h / 2})`} />
        </>
      ) : isLine || isArea ? (
        // Line sketch
        <>
          {isArea && (
            <path d={`M ${x + w * 0.05} ${y + h * 0.8} L ${x + w * 0.25} ${y + h * 0.6} L ${x + w * 0.5} ${y + h * 0.5} L ${x + w * 0.75} ${y + h * 0.35} L ${x + w * 0.95} ${y + h * 0.2} L ${x + w * 0.95} ${y + h * 0.85} L ${x + w * 0.05} ${y + h * 0.85} Z`}
                  fill={palette[0]} opacity={0.5} />
          )}
          <polyline points={`${x + w * 0.05},${y + h * 0.8} ${x + w * 0.25},${y + h * 0.6} ${x + w * 0.5},${y + h * 0.5} ${x + w * 0.75},${y + h * 0.35} ${x + w * 0.95},${y + h * 0.2}`}
                    fill="none" stroke={palette[0]} strokeWidth={Math.min(w, h) * 0.015} />
        </>
      ) : (
        // Bars
        [0, 1, 2, 3, 4].map((i) => {
          const frac = [0.4, 0.65, 0.5, 0.85, 0.7][i]
          const bw = w * 0.12
          const bx = x + w * 0.1 + i * w * 0.16
          const bh = h * frac * 0.7
          return (
            <rect key={i} x={bx} y={y + h * 0.85 - bh} width={bw} height={bh}
                  fill={palette[i % palette.length]} />
          )
        })
      )}
      {/* Reuse the actual chart title from text_runs if present */}
      <TextRuns runs={textRuns} x={x} y={y} w={w} h={h * 0.18} align="left" />
      <text x={x + w / 2} y={y + h - 0.1}
            fontSize={0.13} fill="#9C9EA7" fontFamily="Inter"
            textAnchor="middle">
        {chartType || "chart"}{seriesCount ? ` · ${seriesCount} series` : ""}
      </text>
    </g>
  )
}


function TablePlaceholder({
  x, y, w, h, dim,
}: {
  x: number; y: number; w: number; h: number
  dim?: [number, number]
}) {
  const [rows, cols] = dim || [4, 4]
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" stroke="#D5D5D5" strokeWidth={0.02} />
      <rect x={x} y={y} width={w} height={h / Math.max(1, rows)} fill="#7DA1CC" />
      {Array.from({ length: Math.min(cols, 6) - 1 }).map((_, i) => (
        <line key={`v${i}`}
              x1={x + (w / Math.min(cols, 6)) * (i + 1)} x2={x + (w / Math.min(cols, 6)) * (i + 1)}
              y1={y} y2={y + h}
              stroke="#E0E0E0" strokeWidth={0.012} />
      ))}
      {Array.from({ length: Math.min(rows, 8) - 1 }).map((_, i) => (
        <line key={`h${i}`}
              x1={x} x2={x + w}
              y1={y + (h / Math.min(rows, 8)) * (i + 1)} y2={y + (h / Math.min(rows, 8)) * (i + 1)}
              stroke="#E5E5E5" strokeWidth={0.01} />
      ))}
    </g>
  )
}
