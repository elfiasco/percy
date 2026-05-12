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
  chart_series?: Array<{ name?: string; values: number[]; color?: string | null }>
  chart_title?: string | null
  table_dim?: [number, number]
  table_data?: string[][]
  first_row_header?: boolean
  banded_rows?: boolean
}

interface SlideSvgData {
  doc_id: string
  slide_n: number
  width_in: number
  height_in: number
  elements: ElementJson[]
}

export interface SlideSvgProps {
  /** Pre-fetched slide data — when provided, no HTTP request is made.
   *  Used by the showcase splash which gets all slide JSON inline. */
  slideData?: SlideSvgData
  /** Lazy-fetch mode — provide doc + slide id to fetch from the
   *  /api/docs/.../svg-data endpoint. Useful inside Studio. */
  docId?: string
  slideN?: number
  /** Final pixel width; height scales 16:9. */
  width?: number
  className?: string
  /** Background fill — defaults to white. */
  background?: string
}


export default function SlideSvg({
  slideData, docId, slideN, width = 480, className, background = "#FFFFFF",
}: SlideSvgProps) {
  const [fetched, setFetched] = useState<SlideSvgData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Lazy-fetch only when no pre-fetched data was passed.
  useEffect(() => {
    if (slideData) return
    if (!docId || !slideN) return
    let cancelled = false
    fetch(`/api/docs/${docId}/slides/${slideN}/svg-data`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d) => { if (!cancelled) setFetched(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [slideData, docId, slideN])

  const data = slideData ?? fetched

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
      style={{ display: "block", overflow: "hidden" }}
    >
      <defs>
        <clipPath id={`slideclip-${data.doc_id || "x"}-${data.slide_n}`}>
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#slideclip-${data.doc_id || "x"}-${data.slide_n})`}>
        <rect x={0} y={0} width={W} height={H} fill={background} />
        {data.elements.map((el, idx) => (
          <ElementSvg key={idx} el={el} canvasW={W} canvasH={H} />
        ))}
      </g>
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
      return <ChartRender x={x} y={y} w={w} h={h}
                          chartType={el.chart_type}
                          categories={el.chart_categories}
                          series={el.chart_series}
                          seriesCount={el.chart_series_count}
                          title={el.chart_title}
                          textRuns={el.text_runs} />

    case "BridgeTable":
      return <TableRender x={x} y={y} w={w} h={h}
                          dim={el.table_dim}
                          data={el.table_data}
                          firstRowHeader={el.first_row_header}
                          bandedRows={el.banded_rows} />

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
  const first = runs[0]
  const raw = runs.map((r) => r.text).join("")
  if (!raw.trim()) return null

  // ── Word-wrap via SVG <tspan> with auto-shrink ──
  // Tried <foreignObject> with HTML inside; CSS px in SVG user-space
  // rendered text at the wrong scale in production browsers (text was
  // microscopic or weirdly positioned, "Thank you" lost its "T", etc.).
  // The robust path is manual SVG-text word-wrap with a conservative
  // char-width estimate. Bold display fonts have wider glyphs than the
  // conventional 0.55-of-pt approximation; using 0.62 catches more
  // overflow cases. If wrapped lines exceed the box height, shrink the
  // font 10% and re-wrap (up to 6 attempts, floor 8pt).
  {
  let pt = (first?.font_size as number) || 14
  const color = first.color || "#2A2F3A"
  const bold = !!first.font_bold
  const italic = !!first.font_italic
  const fontFamily = first.font_name || "Inter, system-ui, sans-serif"

  const explicitLines = raw.split(/\r?\n/).flatMap((line) => line ? [line] : [""])
  const CHAR_W_RATIO = bold ? 0.66 : 0.62

  const wrapAt = (size: number) => {
    const charsPerLine = Math.max(1, Math.floor((w * 72) / (size * CHAR_W_RATIO)))
    const out: string[] = []
    for (const seg of explicitLines) {
      if (!seg.trim()) { out.push(""); continue }
      if (seg.length <= charsPerLine) { out.push(seg); continue }
      const words = seg.split(/\s+/)
      let cur = ""
      for (const word of words) {
        if (!cur) { cur = word; continue }
        if ((cur.length + 1 + word.length) <= charsPerLine) cur += " " + word
        else { out.push(cur); cur = word }
      }
      if (cur) out.push(cur)
    }
    return out
  }

  let lines = wrapAt(pt)
  for (let attempt = 0; attempt < 6; attempt++) {
    const lineHeightIn = (pt * 1.18) / 72
    if (lines.length * lineHeightIn <= h * 0.98 || pt <= 8) break
    pt = Math.max(8, pt * 0.9)
    lines = wrapAt(pt)
  }
  const sizeIn = pt / 72
  const lineH  = sizeIn * 1.18

  const hardCap = Math.max(2, Math.floor((w * 72) / (pt * 0.50)))
  const finalLines = lines.map((ln) => ln.length > hardCap ? ln.slice(0, hardCap - 1) + "…" : ln)

  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start"
  const tx = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x
  const ty = y + sizeIn * 1.0

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
      {finalLines.map((ln, i) => (
        <tspan key={i} x={tx} dy={i === 0 ? 0 : lineH}>
          {ln || " "}
        </tspan>
      ))}
    </text>
  )
  }
}


/**
 * ChartRender — draws an actual chart (bars, lines, arcs) from the
 * svg-data endpoint's chart_series + chart_categories payload. Falls
 * back to a styled placeholder sketch only when series data is empty
 * (e.g. older brands or charts the agent created without series).
 */
function ChartRender({
  x, y, w, h, chartType, categories, series, seriesCount, title, textRuns,
}: {
  x: number; y: number; w: number; h: number
  chartType?: string | null
  categories?: string[]
  series?: Array<{ name?: string; values: number[]; color?: string | null }>
  seriesCount?: number
  title?: string | null
  textRuns?: ElementJson["text_runs"]
}) {
  const ct = (chartType || "").toLowerCase()
  const kind = ct.includes("donut") || ct.includes("doughnut") ? "donut"
    : ct.includes("pie")   ? "pie"
    : ct.includes("line")  ? "line"
    : ct.includes("area")  ? "area"
    : ct.includes("bar_") || ct === "bar_clustered" || ct === "bar_stacked" || ct === "bar_stacked_100" ? "bar"
    : "column"

  const palette = ["#7DA1CC", "#6FA17A", "#C5994A", "#B8634F", "#8E7CC3", "#4A8E94"]
  const seriesIn = (series && series.length > 0) ? series : null

  // ── Title row (above the plot area) ──
  const titleH = h * 0.14
  const plotX = x + w * 0.02
  const plotY = y + titleH
  const plotW = w * 0.96
  const plotH = h - titleH - h * 0.10   // leave a thin margin at bottom for axis labels

  // Build the data matrix [series][cat]
  const cats = (categories && categories.length > 0)
    ? categories
    : (seriesIn ? seriesIn[0].values.map((_, i) => `C${i + 1}`) : ["A", "B", "C", "D", "E"])

  const allValues = seriesIn
    ? seriesIn.flatMap((s) => s.values)
    : [40, 65, 50, 85, 70]
  const vmax = Math.max(1, ...allValues)
  const vmin = Math.min(0, ...allValues)

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />

      {/* Title — prefer textRuns, fall back to title field, fall back to chart label */}
      {(title || (textRuns && textRuns.length > 0)) && (
        <TextRuns runs={textRuns} x={x + 0.05} y={y + 0.04} w={w - 0.1} h={titleH} align="left" />
      )}

      {kind === "donut" || kind === "pie" ? (
        <DonutOrPie cx={plotX + plotW / 2} cy={plotY + plotH / 2}
                    r={Math.min(plotW, plotH) * 0.42}
                    isDonut={kind === "donut"}
                    series={seriesIn} categories={cats}
                    palette={palette} />
      ) : kind === "line" || kind === "area" ? (
        <LineOrArea x={plotX} y={plotY} w={plotW} h={plotH}
                    isArea={kind === "area"}
                    series={seriesIn} categories={cats}
                    vmax={vmax} vmin={vmin} palette={palette} />
      ) : kind === "bar" ? (
        <HorizontalBars x={plotX} y={plotY} w={plotW} h={plotH}
                        series={seriesIn} categories={cats}
                        vmax={vmax} palette={palette} />
      ) : (
        <VerticalBars x={plotX} y={plotY} w={plotW} h={plotH}
                      series={seriesIn} categories={cats}
                      vmax={vmax} palette={palette} />
      )}

      {/* Footer label — only when we have no real data, to hint */}
      {!seriesIn && (
        <text x={x + w / 2} y={y + h - 0.05}
              fontSize={0.11} fill="#9C9EA7" fontFamily="Inter"
              textAnchor="middle">
          {chartType || "chart"}{seriesCount ? ` · ${seriesCount} series` : ""}
        </text>
      )}
    </g>
  )
}


function VerticalBars({
  x, y, w, h, series, categories, vmax, palette,
}: {
  x: number; y: number; w: number; h: number
  series: Array<{ values: number[]; color?: string | null }> | null
  categories: string[]
  vmax: number
  palette: string[]
}) {
  const cats = categories.slice(0, 12)
  const n = cats.length || 1
  const sCount = series ? series.length : 1
  const groupW = w / n
  const bandPad = groupW * 0.18
  const innerW = groupW - 2 * bandPad
  const barW = sCount > 0 ? innerW / sCount : innerW

  const bars: React.ReactNode[] = []
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < sCount; s++) {
      const v = series ? (series[s].values[i] ?? 0) : [40, 65, 50, 85, 70, 55][i % 6]
      const bh = Math.max(0.01, (Math.max(0, v) / vmax) * (h * 0.92))
      const bx = x + i * groupW + bandPad + s * barW
      const color = (series && series[s].color) || palette[s % palette.length]
      bars.push(
        <rect key={`${i}-${s}`} x={bx} y={y + h - bh} width={barW * 0.92} height={bh} fill={color} />
      )
    }
  }
  // Axis labels (just category names, bottom)
  const labels = cats.map((c, i) => (
    <text key={`l${i}`} x={x + i * groupW + groupW / 2} y={y + h + 0.18}
          fontSize={0.1} fill="#6E7280" fontFamily="Inter" textAnchor="middle">
      {String(c).slice(0, 8)}
    </text>
  ))
  return (
    <g>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke="#D5D5D5" strokeWidth={0.012} />
      {bars}
      {labels}
    </g>
  )
}


function HorizontalBars({
  x, y, w, h, series, categories, vmax, palette,
}: {
  x: number; y: number; w: number; h: number
  series: Array<{ values: number[]; color?: string | null }> | null
  categories: string[]
  vmax: number
  palette: string[]
}) {
  const cats = categories.slice(0, 12)
  const n = cats.length || 1
  const rowH = h / n
  const bars: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const v = series && series[0] ? (series[0].values[i] ?? 0) : [40, 65, 50, 85, 70, 55][i % 6]
    const bw = Math.max(0.01, (Math.max(0, v) / vmax) * (w * 0.85))
    bars.push(
      <rect key={i} x={x + w * 0.15} y={y + i * rowH + rowH * 0.18}
            width={bw} height={rowH * 0.64}
            fill={(series && series[0].color) || palette[0]} />
    )
    labels.push(
      <text key={`l${i}`} x={x + w * 0.14} y={y + i * rowH + rowH * 0.62}
            fontSize={0.1} fill="#6E7280" fontFamily="Inter" textAnchor="end">
        {String(cats[i]).slice(0, 10)}
      </text>
    )
  }
  return <g>{bars}{labels}</g>
}


function LineOrArea({
  x, y, w, h, isArea, series, categories, vmax, vmin, palette,
}: {
  x: number; y: number; w: number; h: number
  isArea: boolean
  series: Array<{ values: number[]; color?: string | null }> | null
  categories: string[]
  vmax: number; vmin: number
  palette: string[]
}) {
  const seriesToDraw = series || [{ values: [40, 50, 65, 60, 80, 95], color: palette[0] }]
  const range = Math.max(0.001, vmax - vmin)

  const lines: React.ReactNode[] = []
  seriesToDraw.forEach((s, si) => {
    const pts = s.values.map((v, i) => {
      const px = x + (s.values.length <= 1 ? w / 2 : (i / (s.values.length - 1)) * w)
      const py = y + h - ((v - vmin) / range) * (h * 0.92)
      return [px, py] as const
    })
    const color = s.color || palette[si % palette.length]
    if (isArea) {
      const path = `M ${pts[0][0]} ${y + h} ` +
                   pts.map(([px, py]) => `L ${px} ${py}`).join(" ") +
                   ` L ${pts[pts.length - 1][0]} ${y + h} Z`
      lines.push(<path key={`a${si}`} d={path} fill={color} opacity={0.45} />)
    }
    const poly = pts.map(([px, py]) => `${px},${py}`).join(" ")
    lines.push(
      <polyline key={`l${si}`} points={poly} fill="none" stroke={color}
                strokeWidth={Math.min(w, h) * 0.012} strokeLinejoin="round"
                strokeLinecap="round" />
    )
    pts.forEach(([px, py], i) => {
      lines.push(<circle key={`p${si}-${i}`} cx={px} cy={py} r={Math.min(w, h) * 0.014} fill={color} />)
    })
  })
  const xLabels = categories.slice(0, 12).map((c, i, arr) => (
    <text key={`xl${i}`} x={x + (arr.length <= 1 ? w / 2 : (i / (arr.length - 1)) * w)}
          y={y + h + 0.18}
          fontSize={0.1} fill="#6E7280" fontFamily="Inter" textAnchor="middle">
      {String(c).slice(0, 8)}
    </text>
  ))
  return (
    <g>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke="#D5D5D5" strokeWidth={0.012} />
      {lines}
      {xLabels}
    </g>
  )
}


function DonutOrPie({
  cx, cy, r, isDonut, series, categories, palette,
}: {
  cx: number; cy: number; r: number
  isDonut: boolean
  series: Array<{ values: number[]; color?: string | null }> | null
  categories: string[]
  palette: string[]
}) {
  // First-series values (pies/donuts only ever plot one series).
  const values = (series && series[0] && series[0].values.length > 0)
    ? series[0].values
    : [3, 5, 2, 4]
  const total = values.reduce((a, v) => a + Math.max(0, v), 0) || 1
  let acc = 0
  const slices = values.map((v, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += Math.max(0, v)
    const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + Math.cos(a0) * r
    const y0 = cy + Math.sin(a0) * r
    const x1 = cx + Math.cos(a1) * r
    const y1 = cy + Math.sin(a1) * r
    const color = palette[i % palette.length]
    return (
      <path key={i}
            d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
            fill={color} />
    )
  })
  return (
    <g>
      {slices}
      {isDonut && <circle cx={cx} cy={cy} r={r * 0.55} fill="#FFFFFF" />}
    </g>
  )
}


function TableRender({
  x, y, w, h, dim, data, firstRowHeader, bandedRows,
}: {
  x: number; y: number; w: number; h: number
  dim?: [number, number]
  data?: string[][]
  firstRowHeader?: boolean
  bandedRows?: boolean
}) {
  const cells = (data && data.length > 0) ? data : null
  const [rows, cols] = cells
    ? [cells.length, Math.max(1, ...cells.map((r) => r.length))]
    : (dim || [4, 4])
  const showRows = Math.min(rows, 10)
  const showCols = Math.min(cols, 6)
  const cellH = h / Math.max(1, showRows)
  const cellW = w / Math.max(1, showCols)

  const rects: React.ReactNode[] = []
  const texts: React.ReactNode[] = []

  for (let r = 0; r < showRows; r++) {
    const isHeader = firstRowHeader && r === 0
    const fill = isHeader ? "#1F3A6B" : (bandedRows && r % 2 === 1 ? "#F2F3F7" : "#FFFFFF")
    rects.push(
      <rect key={`r${r}`} x={x} y={y + r * cellH} width={w} height={cellH} fill={fill} />
    )
    if (cells) {
      for (let c = 0; c < showCols; c++) {
        const text = cells[r]?.[c] || ""
        if (!text) continue
        texts.push(
          <text key={`t${r}-${c}`}
                x={x + c * cellW + cellW * 0.08}
                y={y + r * cellH + cellH * 0.62}
                fontSize={Math.min(cellH * 0.45, 0.16)}
                fill={isHeader ? "#FFFFFF" : "#2A2F3A"}
                fontWeight={isHeader ? 600 : 400}
                fontFamily="Inter">
            {String(text).slice(0, Math.max(6, Math.floor(cellW / 0.07)))}
          </text>
        )
      }
    }
  }

  // Grid lines
  const grid: React.ReactNode[] = []
  for (let c = 1; c < showCols; c++) {
    grid.push(<line key={`v${c}`}
                    x1={x + c * cellW} x2={x + c * cellW}
                    y1={y} y2={y + h}
                    stroke="#E2E4EA" strokeWidth={0.01} />)
  }
  for (let r = 1; r < showRows; r++) {
    grid.push(<line key={`h${r}`}
                    x1={x} x2={x + w}
                    y1={y + r * cellH} y2={y + r * cellH}
                    stroke="#E2E4EA" strokeWidth={0.01} />)
  }

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" stroke="#D5D5D5" strokeWidth={0.018} />
      {rects}
      {grid}
      {texts}
    </g>
  )
}
