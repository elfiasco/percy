import { useState, useEffect } from "react"
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts"
import type { ChartData, ChartSeriesData, ChartLegendData } from "../../../lib/studioTypes"
import { useStudioChartPayload } from "../../../lib/studio/payloadHooks"
import { studioStore } from "../../../lib/studio/store"
import { commitChartData } from "../../../lib/studio/commands"
import type { NativeRendererProps } from "./RendererRegistry"
import { registerRenderer } from "./RendererRegistry"
import { RendererShell } from "./RendererShell"

// Google Charts Material Design palette (matches google.visualization defaults)
const DEFAULT_PALETTE = [
  "#3366CC", "#DC3912", "#FF9900", "#109618",
  "#990099", "#0099C6", "#DD4477", "#66AA00",
  "#B82E2E", "#316395", "#994499", "#22AA99",
]

function seriesColor(s: ChartSeriesData, idx: number): string {
  return s.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length]
}

// Returns a readable label color for labels rendered OUTSIDE on white background.
// If the chart's configured label color is too light (e.g. white intended for
// inside-bar rendering), fall back to a dark color matching matplotlib's default.
function outsideLabelColor(fontColor: string | null | undefined): string {
  if (!fontColor) return "#555"
  const c = fontColor.replace("#", "")
  if (c.length === 6) {
    const r = parseInt(c.slice(0, 2), 16)
    const g = parseInt(c.slice(2, 4), 16)
    const b = parseInt(c.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (luminance > 0.75) return "#555"
  }
  return fontColor
}

// Recharts Legend props from Bridge legend.position. Default position is
// BOTTOM (Google Charts / Sheets convention) so the legend doesn't overlap
// the plot area when only chart_type is specified.
function legendProps(lg: ChartLegendData) {
  if (!lg.visible) return null
  const pos = (lg.position || "BOTTOM").toUpperCase()
  const fontSize = lg.font_size ?? 11
  const style: Record<string, string | number> = { fontSize, color: lg.font_color || "#3c4043", paddingTop: 4 }
  switch (pos) {
    case "TOP":     return { verticalAlign: "top" as const,    align: "center" as const, layout: "horizontal" as const, wrapperStyle: style }
    case "LEFT":    return { verticalAlign: "middle" as const, align: "left" as const,   layout: "vertical" as const,   wrapperStyle: style }
    case "RIGHT":   return { verticalAlign: "middle" as const, align: "right" as const,  layout: "vertical" as const,   wrapperStyle: style }
    case "BOTTOM":
    default:        return { verticalAlign: "bottom" as const, align: "center" as const, layout: "horizontal" as const, wrapperStyle: style }
  }
}

function chartTitle(data: ChartData): { text: string; style: React.CSSProperties } | null {
  const t = data.title?.text
  if (!t) return null
  return {
    text: t,
    style: {
      fontSize: data.title.font_size ? `${data.title.font_size}px` : "12px",
      fontWeight: data.title.font_bold ? "bold" : 500,
      fontStyle: data.title.font_italic ? "italic" : undefined,
      fontFamily: data.title.font_name || undefined,
      color: data.title.font_color || "#222",
      textAlign: "center",
      padding: "2px 4px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
  }
}

// Build the X-axis "category" rows for Recharts: each row has a name plus one key per series.
function buildCategoryRows(data: ChartData): Array<Record<string, number | string | null>> {
  const cats = data.categories
  const len = Math.max(cats.length, ...data.series.map((s) => s.values.length))
  const rows: Array<Record<string, number | string | null>> = []
  for (let i = 0; i < len; i++) {
    const row: Record<string, number | string | null> = { __cat__: cats[i] ?? `Cat ${i + 1}` }
    data.series.forEach((s, idx) => {
      const key = s.name || `Series ${idx + 1}`
      const v = s.values[i]
      row[key] = v === null || v === undefined ? null : Number(v)
    })
    rows.push(row)
  }
  return rows
}

// Pie/Doughnut data uses the first series; categories become slice labels
function buildPieData(data: ChartData): Array<{ name: string; value: number; color: string | null }> {
  const s0 = data.series[0]
  if (!s0) return []
  return s0.values.map((v, i) => ({
    name: data.categories[i] ?? `Slice ${i + 1}`,
    value: Number(v ?? 0),
    color: (s0.point_colors && s0.point_colors[i]) || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
  }))
}

// Scatter: each series renders as a separate <Scatter> with x/y points
function buildScatterSeries(data: ChartData) {
  return data.series.map((s, idx) => {
    const points: Array<{ x: number; y: number; z?: number }> = []
    const xs = s.x_values
    const ys = s.values
    const len = Math.min(xs.length || ys.length, ys.length)
    for (let i = 0; i < len; i++) {
      const x = xs[i] ?? i
      const y = ys[i]
      if (y === null || y === undefined) continue
      points.push({ x: Number(x), y: Number(y) })
    }
    return { name: s.name || `Series ${idx + 1}`, color: seriesColor(s, idx), points, smooth: s.smooth }
  })
}

// ── Sub-renderers per chart-type family ───────────────────────────────────────

// Generous top headroom so the tallest bar/line doesn't crash into the
// chart title area. Bottom margin handles legend space when legend is below.
function CartesianMargins(hasDataLabels = false, hasBottomLegend = false) {
  return {
    top:    hasDataLabels ? 24 : 14,
    right:  12,
    bottom: hasBottomLegend ? 4 : 2,
    left:   8,
  }
}

// Google Sheets-style grid: light gray solid lines
function ChartGrid() {
  return <CartesianGrid stroke="#e8e8e8" strokeDasharray="" vertical={false} />
}

function renderXAxis(data: ChartData, dataKey: string = "__cat__", horizontal = false) {
  const ax = horizontal ? data.value_axis : data.category_axis
  if (!ax.visible) return null
  const fontSize = ax.tick_label_font_size ?? 11

  // Only rotate X-axis labels when text is likely to overflow.
  // Heuristic: rotate when there are many categories or any label is long.
  const cats = data.categories ?? []
  const longestLabel = cats.reduce((m, c) => Math.max(m, String(c ?? "").length), 0)
  const shouldRotate = !horizontal && (cats.length > 6 || longestLabel > 8)
  const angle = shouldRotate ? -30 : 0

  return (
    <XAxis
      dataKey={horizontal ? undefined : dataKey}
      type={horizontal ? "number" : "category"}
      domain={horizontal && (ax.min !== null || ax.max !== null) ? [ax.min ?? "auto", ax.max ?? "auto"] : undefined}
      tick={{
        fontSize,
        fill: ax.tick_label_font_color || "#5f6368",
        angle,
        textAnchor: shouldRotate ? "end" : "middle",
      }}
      axisLine={{ stroke: "#dadce0" }}
      tickLine={false}
      tickMargin={6}
      height={horizontal ? 30 : (shouldRotate ? 44 : 28)}
      reversed={ax.reverse_order}
      tickFormatter={ax.number_format && horizontal ? (v) => formatNumber(v, ax.number_format!) : undefined}
    />
  )
}

function renderYAxis(data: ChartData, horizontal = false, zeroFloor = false) {
  const ax = horizontal ? data.category_axis : data.value_axis
  if (!ax.visible) return null
  let domain: [number | string, number | string] | undefined
  if (!horizontal) {
    if (ax.min !== null || ax.max !== null) {
      domain = [ax.min ?? "auto", ax.max ?? "auto"]
    } else if (zeroFloor) {
      domain = [0, "auto"]
    }
  }
  const fontSize = ax.tick_label_font_size ?? 11
  // PowerPoint default for horizontal bar charts: categories appear in REVERSE
  // of data order (first data point on the BOTTOM bar, last on TOP). LibreOffice,
  // matplotlib, and Excel all follow this convention. Recharts defaults to data-
  // order, so apply the reverse implicitly for horizontal layouts. If the bridge
  // model explicitly sets `reverse_order=true`, the user has overridden, so we
  // invert again (the explicit override should produce data-order display).
  const yReversed = horizontal ? !ax.reverse_order : !!ax.reverse_order
  return (
    <YAxis
      dataKey={horizontal ? "__cat__" : undefined}
      type={horizontal ? "category" : "number"}
      domain={domain}
      tick={{ fontSize, fill: ax.tick_label_font_color || "#5f6368" }}
      axisLine={false}
      tickLine={false}
      tickMargin={6}
      width={horizontal ? 60 : 44}
      reversed={yReversed}
      tickCount={!horizontal ? 6 : undefined}
      tickFormatter={!horizontal && ax.number_format ? (v) => formatNumber(v, ax.number_format!) : undefined}
    />
  )
}

function formatNumber(v: number | string, fmt: string): string {
  const num = typeof v === "number" ? v : parseFloat(String(v))
  if (isNaN(num)) return String(v)
  if (fmt.includes("%")) return `${(num * 100).toFixed(0)}%`
  if (fmt.includes("$")) return `$${num.toFixed(0)}`
  if (fmt.includes("0.00")) return num.toFixed(2)
  if (fmt.includes("0.0"))  return num.toFixed(1)
  return String(num)
}

/** Map PPTX data-label position enum → Recharts LabelList position.
 *
 *  PPTX positions: ABOVE, BELOW, LEFT, RIGHT, CENTER, INSIDE_END, INSIDE_BASE,
 *  OUTSIDE_END, BEST_FIT. visa slide 12 sets INSIDE_BASE on the Profit/EBITDA
 *  bars (white text near the bottom of each bar); without honoring this the
 *  labels float above instead, throwing both visual fidelity AND RMS off. */
function barLabelPosition(pos: string | null | undefined, horizontal: boolean): "top" | "bottom" | "left" | "right" | "center" | "insideTop" | "insideBottom" | "insideLeft" | "insideRight" | "inside" | "outside" {
  const p = (pos || "").toUpperCase()
  if (horizontal) {
    if (p === "INSIDE_BASE") return "insideLeft"
    if (p === "INSIDE_END")  return "insideRight"
    if (p === "CENTER")      return "center"
    if (p === "BELOW")       return "bottom"
    if (p === "ABOVE")       return "top"
    return "right"  // OUTSIDE_END / default for horizontal bars
  }
  if (p === "INSIDE_BASE") return "insideBottom"
  if (p === "INSIDE_END")  return "insideTop"
  if (p === "CENTER")      return "center"
  if (p === "BELOW")       return "bottom"
  if (p === "LEFT")        return "left"
  if (p === "RIGHT")       return "right"
  return "top"  // OUTSIDE_END / ABOVE / default for vertical bars
}

function insideLabelPosition(pos: string | null | undefined): boolean {
  const p = (pos || "").toUpperCase()
  return p === "INSIDE_BASE" || p === "INSIDE_END" || p === "CENTER"
}

/** Per-bar / per-point data-label formatter.
 *   1. series-level data_labels.format (PPTX <c:numFmt> on the label)
 *   2. value-axis number_format
 *   3. percent flag (100%-stacked variants → ×100)
 *   4. trim IEEE float noise via toPrecision(6) so 0.6100…0067 → 0.61
 */
function formatDataLabel(
  v: unknown,
  percent: boolean,
  seriesFmt: string | null | undefined,
  axisFmt: string | null | undefined,
): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? "")
  if (seriesFmt) return formatNumber(n, seriesFmt)
  if (axisFmt)   return formatNumber(n, axisFmt)
  if (percent)   return `${(n * 100).toFixed(0)}%`
  return Number.isInteger(n) ? String(n) : parseFloat(n.toPrecision(6)).toString()
}

function ColumnOrBarChart({ data, horizontal, stacked, percent, onPointClick, elementId }: {
  data: ChartData; horizontal: boolean; stacked: boolean; percent: boolean
  onPointClick?: (seriesIdx: number, pointIdx: number, evt: { clientX: number; clientY: number }) => void
  elementId?: string
}) {
  let rows = buildCategoryRows(data)
  if (percent) {
    rows = rows.map((r) => {
      const total = data.series.reduce((acc, s) => {
        const v = r[s.name || `Series ${data.series.indexOf(s) + 1}`]
        return acc + (typeof v === "number" ? v : 0)
      }, 0) || 1
      const out: Record<string, number | string | null> = { __cat__: r.__cat__ }
      data.series.forEach((s, idx) => {
        const key = s.name || `Series ${idx + 1}`
        const v = r[key]
        out[key] = typeof v === "number" ? v / total : null
      })
      return out
    })
  }
  const lp = legendProps(data.legend)
  const valAxFormat = percent ? "0%" : (data.value_axis.number_format || undefined)
  const anyDataLabels = data.series.some((s) => s.data_labels.show)
  const hasBottomLegend = !!lp && lp.verticalAlign === "bottom"
  // Reference renderer hardcodes width=0.8 per bar cluster, matching barCategoryGap=20%.
  const barCategoryGap = "20%"

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={CartesianMargins(anyDataLabels, hasBottomLegend)}
        barCategoryGap={barCategoryGap}
        stackOffset={percent ? "expand" : undefined}
      >
        <ChartGrid />
        {renderXAxis(data, "__cat__", horizontal)}
        {renderYAxis(data, horizontal, !horizontal && !percent)}
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          contentStyle={{ fontSize: 11, border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}
          formatter={valAxFormat ? (v) => formatNumber(v as number, valAxFormat) : undefined}
        />
        {lp && <Legend {...lp} />}
        {data.series.map((s, idx) => {
          const fill = seriesColor(s, idx)
          const key  = s.name || `Series ${idx + 1}`
          // Rounded top corners (Google Charts style) — skip for stacked to avoid mid-stack rounding
          const radius = !stacked && !percent
            ? (horizontal ? ([0, 3, 3, 0] as [number, number, number, number]) : ([3, 3, 0, 0] as [number, number, number, number]))
            : undefined
          return (
            <Bar
              key={key}
              dataKey={key}
              fill={fill}
              radius={radius}
              stackId={stacked || percent ? "stack" : undefined}
              isAnimationActive={true}
              animationDuration={600}
              animationEasing="ease-out"
              onClick={onPointClick && elementId ? (_data: unknown, pointIdx: number, evt: React.MouseEvent) => {
                evt.stopPropagation()
                onPointClick(idx, pointIdx, { clientX: evt.clientX, clientY: evt.clientY })
              } : undefined}
              cursor={onPointClick ? "pointer" : undefined}
            >
              {/* Per-bar Cells let users override individual bar colors */}
              {rows.map((_, pointIdx) => {
                const pc = s.point_colors?.[pointIdx]
                return <Cell key={pointIdx} fill={pc || fill} />
              })}
              {s.data_labels.show && (
                <LabelList
                  dataKey={key}
                  position={barLabelPosition(s.data_labels.position, horizontal)}
                  style={{
                    fontSize: s.data_labels.font_size ?? 9,
                    fill: insideLabelPosition(s.data_labels.position)
                      ? (s.data_labels.font_color || "#fff")
                      : outsideLabelColor(s.data_labels.font_color),
                  }}
                  formatter={(v: unknown) => formatDataLabel(v, percent, s.data_labels.format, data.value_axis.number_format)}
                />
              )}
            </Bar>
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}

function LineOrAreaChart({ data, area, stacked }: { data: ChartData; area: boolean; stacked: boolean }) {
  const rows = buildCategoryRows(data)
  const lp = legendProps(data.legend)
  const Chart = area ? AreaChart : LineChart
  const anyDataLabels = data.series.some((s) => s.data_labels.show)
  const hasBottomLegend = !!lp && lp.verticalAlign === "bottom"
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={rows} margin={CartesianMargins(anyDataLabels, hasBottomLegend)}>
        <ChartGrid />
        {renderXAxis(data)}
        {renderYAxis(data)}
        <Tooltip
          cursor={{ stroke: "#dadce0", strokeDasharray: "3 3" }}
          contentStyle={{ fontSize: 11, border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}
        />
        {lp && <Legend {...lp} />}
        {data.series.map((s, idx) => {
          const color = seriesColor(s, idx)
          const key   = s.name || `Series ${idx + 1}`
          if (area) {
            // STACKED areas need opaque fill (PowerPoint convention): areas
            // tile on top of each other without blending, so per-series colors
            // read cleanly. Non-stacked areas overlap, so use a low-alpha fill
            // to keep underlying series visible — matches Recharts / Google
            // Sheets defaults.
            return (
              <Area
                key={key}
                type={s.smooth ? "monotone" : "linear"}
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                fill={color}
                fillOpacity={stacked ? 0.95 : 0.15}
                stackId={stacked ? "stack" : undefined}
                isAnimationActive={true}
                animationDuration={700}
                animationEasing="ease-out"
                dot={!!s.marker.style && s.marker.style !== "none"}
              />
            )
          }
          return (
            <Line
              key={key}
              type={s.smooth ? "monotone" : "linear"}
              dataKey={key}
              stroke={color}
              strokeWidth={s.line.width ?? 2.5}
              strokeDasharray={dashArray(s.line.dash)}
              dot={s.marker.style ? { r: (s.marker.size ?? 4) / 2, fill: s.marker.color || color, strokeWidth: 0 } : false}
              isAnimationActive={true}
              animationDuration={700}
              animationEasing="ease-out"
            >
              {s.data_labels.show && (
                <LabelList
                  dataKey={key}
                  position="top"
                  style={{ fontSize: s.data_labels.font_size ?? 9, fill: s.data_labels.font_color || "#5f6368" }}
                />
              )}
            </Line>
          )
        })}
      </Chart>
    </ResponsiveContainer>
  )
}

function dashArray(dash: string | null | undefined): string | undefined {
  if (!dash) return undefined
  const d = dash.toLowerCase()
  if (d === "dash" || d === "lgdash") return "8 4"
  if (d === "dot"  || d === "sysdot") return "2 3"
  if (d === "dashdot")                return "8 4 2 4"
  return undefined
}

function PieOrDonutChart({ data, donut, exploded, onPointClick }: {
  data: ChartData; donut: boolean; exploded: boolean
  onPointClick?: (seriesIdx: number, pointIdx: number, evt: { clientX: number; clientY: number }) => void
}) {
  const pieData = buildPieData(data)
  const lp = legendProps(data.legend)
  const total = pieData.reduce((s, d) => s + (d.value || 0), 0)
  // Honor PPTX `<c:dLbls>` flag — only show per-slice labels when the bridge
  // data says so. Some decks (snowflake "Pie and Donut Charts") explicitly
  // disable labels so the legend alone identifies slices; without this gate
  // Studio always showed % labels and diverged from PowerPoint.
  const showSliceLabels = data.series[0]?.data_labels?.show ?? false
  const pctLabel = !showSliceLabels ? false : ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
    cx: number; cy: number; midAngle: number
    innerRadius: number; outerRadius: number; percent: number
  }) => {
    if (percent < 0.04) return null
    const RADIAN = Math.PI / 180
    const dist = donut ? (innerRadius + outerRadius) * 0.5 : outerRadius * 0.6
    const x = cx + dist * Math.cos(-midAngle * RADIAN)
    const y = cy + dist * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: "9px", fontWeight: 600, pointerEvents: "none" }}>
        {`${Math.round(percent * 100)}%`}
      </text>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip
          formatter={(v: number) => `${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%`}
          contentStyle={{ fontSize: 11, border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}
        />
        {lp && <Legend {...lp} />}
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="78%"
          innerRadius={donut ? `${data.plot_properties.hole_size ?? 50}%` : 0}
          startAngle={90}
          endAngle={450}
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
          label={pctLabel}
          labelLine={false}
          paddingAngle={exploded ? 3 : 1}
          strokeWidth={1}
          stroke="#fff"
          onClick={onPointClick ? (_d: unknown, idx: number, evt: React.MouseEvent) => {
            evt.stopPropagation()
            onPointClick(0, idx, { clientX: evt.clientX, clientY: evt.clientY })
          } : undefined}
          cursor={onPointClick ? "pointer" : undefined}
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}

function ScatterOrBubbleChart({ data, withLines, bubble }: { data: ChartData; withLines: boolean; bubble: boolean }) {
  const series = buildScatterSeries(data)
  const lp = legendProps(data.legend)
  const hasBottomLegend = !!lp && lp.verticalAlign === "bottom"
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={CartesianMargins(false, hasBottomLegend)}>
        <ChartGrid />
        <XAxis type="number" dataKey="x" tick={{ fontSize: 9, fill: "#80868b" }} axisLine={{ stroke: "#dadce0" }} tickLine={false} height={28} />
        <YAxis type="number" dataKey="y" tick={{ fontSize: 9, fill: "#80868b" }} axisLine={false} tickLine={false} width={32} />
        {bubble && <ZAxis type="number" dataKey="z" range={[20, 200]} />}
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ fontSize: 11, border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}
        />
        {lp && <Legend {...lp} />}
        {series.map((s, idx) => (
          <Scatter
            key={idx}
            name={s.name}
            data={s.points}
            fill={s.color}
            line={withLines ? { stroke: s.color, strokeWidth: 2 } : false}
            shape="circle"
            isAnimationActive={true}
            animationDuration={600}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function ComboChart({ data }: { data: ChartData }) {
  // Combo: each series uses its own plot_type override
  const rows = buildCategoryRows(data)
  const lp = legendProps(data.legend)
  const hasBottomLegend = !!lp && lp.verticalAlign === "bottom"
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={CartesianMargins(false, hasBottomLegend)}>
        <ChartGrid />
        {renderXAxis(data)}
        {renderYAxis(data)}
        <Tooltip contentStyle={{ fontSize: 11, border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }} />
        {lp && <Legend {...lp} />}
        {data.series.map((s, idx) => {
          const color = seriesColor(s, idx)
          const key   = s.name || `Series ${idx + 1}`
          const pt    = (s.plot_type || "").toLowerCase()
          if (pt.includes("line")) {
            return <Line key={key} type={s.smooth ? "monotone" : "linear"} dataKey={key} stroke={color} strokeWidth={s.line.width ?? 2.5} dot={false} isAnimationActive={true} animationDuration={600} />
          }
          if (pt.includes("area")) {
            return <Area key={key} type={s.smooth ? "monotone" : "linear"} dataKey={key} stroke={color} fill={color} fillOpacity={0.15} isAnimationActive={true} animationDuration={600} />
          }
          return <Bar key={key} dataKey={key} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={true} animationDuration={600} />
        })}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

interface ChartByTypeProps {
  data: ChartData
  onPointClick?: (seriesIdx: number, pointIdx: number, evt: { clientX: number; clientY: number }) => void
  elementId?: string
}

function ChartByType({ data, onPointClick, elementId }: ChartByTypeProps) {
  const ct = (data.chart_type || "").toUpperCase()
  // Combo: any series has plot_type that conflicts with the chart_type root
  const usesCombo = data.series.some((s) => {
    const pt = (s.plot_type || "").toLowerCase()
    if (!pt) return false
    const root = ct.toLowerCase()
    if (root.startsWith("column") || root.startsWith("bar")) return !pt.includes("bar")
    if (root.startsWith("line"))                              return !pt.includes("line")
    if (root.startsWith("area"))                              return !pt.includes("area")
    return false
  })
  if (usesCombo) return <ComboChart data={data} />

  // Bar/column: per-point click for recolor
  const colBar = (h: boolean, s: boolean, p: boolean) =>
    <ColumnOrBarChart data={data} horizontal={h} stacked={s} percent={p} onPointClick={onPointClick} elementId={elementId} />

  switch (ct) {
    case "COLUMN_CLUSTERED":            return colBar(false, false, false)
    case "COLUMN_STACKED":              return colBar(false, true,  false)
    case "COLUMN_100_PERCENT_STACKED":  return colBar(false, true,  true )
    case "BAR_CLUSTERED":               return colBar(true,  false, false)
    case "BAR_STACKED":                 return colBar(true,  true,  false)
    case "BAR_100_PERCENT_STACKED":     return colBar(true,  true,  true )
    case "LINE":
    case "LINE_MARKERS":                return <LineOrAreaChart data={data} area={false} stacked={false} />
    case "AREA":                        return <LineOrAreaChart data={data} area={true}  stacked={false} />
    case "AREA_STACKED":                return <LineOrAreaChart data={data} area={true}  stacked={true}  />
    case "PIE":                         return <PieOrDonutChart data={data} donut={false} exploded={false} onPointClick={onPointClick} />
    case "PIE_EXPLODED":                return <PieOrDonutChart data={data} donut={false} exploded={true}  onPointClick={onPointClick} />
    case "DOUGHNUT":                    return <PieOrDonutChart data={data} donut={true}  exploded={false} onPointClick={onPointClick} />
    case "DOUGHNUT_EXPLODED":           return <PieOrDonutChart data={data} donut={true}  exploded={true}  onPointClick={onPointClick} />
    case "XY_SCATTER":                  return <ScatterOrBubbleChart data={data} withLines={false} bubble={false} />
    case "XY_SCATTER_LINES":
    case "XY_SCATTER_LINES_NO_MARKERS":
    case "XY_SCATTER_SMOOTH":           return <ScatterOrBubbleChart data={data} withLines={true}  bubble={false} />
    case "BUBBLE":                      return <ScatterOrBubbleChart data={data} withLines={false} bubble={true}  />
    default:                            return colBar(false, false, false)
  }
}

// ── Per-bar recolor popover (Google Sheets-style click-to-color) ─────────────
function BarRecolorPopover({
  x, y, currentColor, onPick, onReset, onClose,
}: {
  x: number; y: number; currentColor: string
  onPick: (color: string) => void; onReset: () => void; onClose: () => void
}) {
  const PALETTE = [
    ...DEFAULT_PALETTE,
    "#000000", "#3c4043", "#80868b", "#dadce0", "#ffffff",
  ]
  // Clamp to viewport
  const left = Math.max(8, Math.min(x - 90, window.innerWidth - 200))
  const top  = Math.min(y + 10, window.innerHeight - 130)
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99998 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      />
      <div
        style={{
          position: "fixed", left, top, zIndex: 99999,
          background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.10)",
          padding: 8, width: 184, fontFamily: "'Google Sans', system-ui, sans-serif",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: "#5f6368", marginBottom: 6, fontWeight: 500 }}>
          Bar color
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => onPick(c)}
              title={c}
              style={{
                width: 18, height: 18, padding: 0, cursor: "pointer",
                background: c, border: c.toLowerCase() === currentColor.toLowerCase()
                  ? "2px solid #1a73e8" : "1px solid #dadce0",
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(currentColor) ? currentColor : "#3366CC"}
            onChange={(e) => onPick(e.target.value)}
            style={{ width: 28, height: 22, padding: 0, border: "1px solid #dadce0", borderRadius: 3, cursor: "pointer" }}
            title="Custom color"
          />
          <button
            onClick={onReset}
            style={{
              flex: 1, fontSize: 11, padding: "2px 8px",
              background: "#f1f3f4", border: "1px solid #dadce0", borderRadius: 3,
              color: "#3c4043", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Reset to series color
          </button>
        </div>
      </div>
    </>
  )
}

// ── Top-level component ───────────────────────────────────────────────────────

function ChartRendererImpl({ element, docId, slideN, renderKey, selected }: NativeRendererProps) {
  const { data, error } = useStudioChartPayload(docId, slideN, element.id, renderKey)
  const [recolorPopover, setRecolorPopover] = useState<{
    seriesIdx: number; pointIdx: number; x: number; y: number
  } | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft]     = useState("")
  const [pasteToast, setPasteToast]     = useState<string | null>(null)

  // Paste CSV/TSV onto a SELECTED chart → replace categories + series.
  // Mirrors Google Sheets' "paste data into chart range" UX.
  useEffect(() => {
    if (!selected || !data) return
    const onPaste = (e: ClipboardEvent) => {
      // Skip if focus is in a real input/textarea (user is editing a field).
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return
      const text = e.clipboardData?.getData("text/plain")
      if (!text || !/[\t,]/.test(text) || text.split(/\r?\n/).length < 2) return
      e.preventDefault()
      const parsed = parseChartTSV(text)
      if (!parsed || parsed.categories.length === 0 || parsed.series.length === 0) {
        setPasteToast("Could not parse pasted data as a table")
        setTimeout(() => setPasteToast(null), 2200)
        return
      }
      commitChartData(element.id, {
        categories: parsed.categories,
        series: parsed.series.map((s, i) => {
          const existing = data.series[i]
          return existing
            ? { ...existing, name: s.name, values: s.values }
            : { idx: i, name: s.name, values: s.values, x_values: [],
                color: null, point_colors: [], plot_type: null, smooth: false,
                invert_if_negative: false,
                line: { visible: true, width: null, color: null, dash: null },
                marker: { style: null, size: null, color: null, line_visible: false },
                data_labels: { show: false, show_val: true, show_cat_name: false, show_ser_name: false, show_percent: false, position: null, font_size: null, font_color: null, separator: null } }
        }),
      } as unknown as Partial<ChartData>)
        .then(() => {
          setPasteToast(`Loaded ${parsed.series.length} series × ${parsed.categories.length} points`)
          setTimeout(() => setPasteToast(null), 2200)
        })
        .catch((err) => {
          console.error("[Percy] chart paste failed:", err)
          setPasteToast("Paste failed")
          setTimeout(() => setPasteToast(null), 2200)
        })
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [selected, data, element.id])

  if (error || !data) {
    return (
      <RendererShell
        loading={!error && !data}
        error={error}
        kind="chart"
        onRetry={() => {
          void studioStore.loadChartPayload(docId, slideN, element.id, /*force*/ true)
        }}
      >
        {null}
      </RendererShell>
    )
  }

  // When selected, allow clicking individual bars to recolor that bar.
  const onPointClick = selected ? (seriesIdx: number, pointIdx: number, evt: { clientX: number; clientY: number }) => {
    setRecolorPopover({ seriesIdx, pointIdx, x: evt.clientX, y: evt.clientY })
  } : undefined

  const applyPointColor = (color: string | null) => {
    if (!recolorPopover) return
    const series = data.series.map((s, sIdx) => {
      if (sIdx !== recolorPopover.seriesIdx) return s
      const pc = [...(s.point_colors || [])]
      while (pc.length < data.categories.length) pc.push(null)
      pc[recolorPopover.pointIdx] = color
      return { ...s, point_colors: pc }
    })
    commitChartData(element.id, { series }).catch((e) => console.error("recolor commit failed:", e))
    setRecolorPopover(null)
  }

  const title = chartTitle(data)
  return (
    <div style={{
      width: "100%", height: "100%",
      position: "relative",
      background: "transparent",
      // pointer-events: when selected, allow clicking bars; otherwise let the
      // overlay handle drag/select
      pointerEvents: selected ? "auto" : "none",
      userSelect: "none",
      boxSizing: "border-box",
    }}>
      {title && !editingTitle && (
        <div
          style={{
            position: "absolute", top: 2, left: 0, right: 0, zIndex: 2,
            pointerEvents: selected ? "auto" : "none",
            userSelect: "none",
            cursor: selected ? "text" : "default",
            ...title.style,
          }}
          onClick={(e) => {
            if (!selected) return
            e.stopPropagation()
            setTitleDraft(title.text)
            setEditingTitle(true)
          }}
          title={selected ? "Click to edit title" : undefined}
        >
          {title.text}
        </div>
      )}
      {!title && selected && !editingTitle && (
        <button
          onClick={(e) => { e.stopPropagation(); setTitleDraft(""); setEditingTitle(true) }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            // sit below the toolbar (toolbar is at top:4 ~28px tall)
            position: "absolute", top: 38, left: "50%", transform: "translateX(-50%)",
            zIndex: 2, padding: "2px 8px", background: "transparent",
            border: "1px dashed #80868b", borderRadius: 3,
            color: "#80868b", fontSize: 11, fontFamily: "'Google Sans', system-ui, sans-serif",
            cursor: "pointer", pointerEvents: "auto",
          }}
        >
          + Add chart title
        </button>
      )}
      {editingTitle && (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            const trimmed = titleDraft
            if (trimmed !== (title?.text ?? "")) {
              commitChartData(element.id, { title: { ...(data.title ?? {}), text: trimmed } })
                .catch((err) => console.error("[Percy] chart title save failed:", err))
            }
            setEditingTitle(false)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
            if (e.key === "Escape") { setEditingTitle(false) }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
            zIndex: 3, padding: "2px 6px",
            background: "#fff", border: "1.5px solid #1a73e8", borderRadius: 3,
            outline: "none", textAlign: "center",
            ...(title?.style ?? {}),
            color: title?.style.color ?? "#202124",
            minWidth: 180, maxWidth: "80%",
          }}
        />
      )}
      <ChartByType data={data} onPointClick={onPointClick} elementId={element.id} />

      {/* Click-to-edit overlays (visible only when chart is selected) */}
      {selected && (
        <>
          {/* Floating toolbar above the chart, like Google Sheets chart editor */}
          <ChartToolbar
            elementId={element.id}
            data={data}
          />
          {/* In-place title overlays stay near their visual positions */}
          <AxisTitleOverlay
            elementId={element.id}
            position="bottom"
            currentTitle={data.category_axis.title.text}
            patchPath="category_axis"
            existingAxis={data.category_axis}
          />
          <AxisTitleOverlay
            elementId={element.id}
            position="left"
            currentTitle={data.value_axis.title.text}
            patchPath="value_axis"
            existingAxis={data.value_axis}
          />
        </>
      )}

      {recolorPopover && (
        <BarRecolorPopover
          x={recolorPopover.x}
          y={recolorPopover.y}
          currentColor={
            data.series[recolorPopover.seriesIdx]?.point_colors?.[recolorPopover.pointIdx] ??
            seriesColor(data.series[recolorPopover.seriesIdx], recolorPopover.seriesIdx)
          }
          onPick={applyPointColor}
          onReset={() => applyPointColor(null)}
          onClose={() => setRecolorPopover(null)}
        />
      )}
      {pasteToast && (
        <div style={{
          position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 20,
          background: "#202124", color: "#fff",
          padding: "6px 12px", borderRadius: 4,
          fontSize: 12, fontFamily: "'Google Sans', system-ui, sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          pointerEvents: "none",
        }}>
          {pasteToast}
        </div>
      )}
    </div>
  )
}

// ── CSV/TSV paste parser ────────────────────────────────────────────────────
// Expects: first row = headers (first cell is category-label header, rest are
// series names). Subsequent rows = one category per row, then numeric values.
// Example:
//   Quarter\tRevenue\tProfit
//   Q1\t120\t30
//   Q2\t145\t42
//   ...
// Returns categories + series objects, or null if unparseable.

function parseChartTSV(text: string): { categories: string[]; series: Array<{ name: string; values: (number | null)[] }> } | null {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const sep = lines[0].includes("\t") ? "\t" : ","
  const split = (line: string) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""))
  const header = split(lines[0])
  if (header.length < 2) return null
  const seriesNames = header.slice(1)
  const categories: string[] = []
  const seriesValues: Array<(number | null)[]> = seriesNames.map(() => [])
  for (let r = 1; r < lines.length; r++) {
    const row = split(lines[r])
    if (row.length < 2) continue
    categories.push(row[0])
    for (let c = 0; c < seriesNames.length; c++) {
      const raw = row[c + 1]
      if (raw === undefined || raw === "") {
        seriesValues[c].push(null)
      } else {
        const num = parseFloat(raw.replace(/[$,]/g, ""))
        seriesValues[c].push(Number.isFinite(num) ? num : null)
      }
    }
  }
  return {
    categories,
    series: seriesNames.map((name, i) => ({ name, values: seriesValues[i] })),
  }
}

// ── Consolidated chart toolbar (Google Sheets style) ───────────────────────
// All chart-level edit actions live in ONE floating bar at the top of the
// chart. Keeps the chart canvas uncluttered while making every action a
// single click away. Each button opens its own popover when needed.

function ChartToolbar({ elementId, data }: { elementId: string; data: ChartData }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: 4, left: 50,
        zIndex: 6,
        display: "flex", gap: 4,
        background: "rgba(255,255,255,0.96)",
        border: "1px solid #dadce0", borderRadius: 6,
        padding: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        backdropFilter: "blur(6px)",
        whiteSpace: "nowrap",
      }}
    >
      <ChartTypePicker elementId={elementId} currentType={data.chart_type} />
      <ToolbarDivider />
      <DataLabelsToggle elementId={elementId} series={data.series} />
      <LegendRenameOverlay elementId={elementId} series={data.series} />
      <CategoryRenameOverlay elementId={elementId} categories={data.categories} />
      <AxisRangeOverlay elementId={elementId} valueAxis={data.value_axis} />
    </div>
  )
}

function ToolbarDivider() {
  return <div style={{ width: 1, background: "#e0e0e0", margin: "2px 2px" }} />
}

// ── Chart type quick-switch picker ──────────────────────────────────────────
// A small chip at the top-left of the chart that opens a grid of chart-type
// icons. Click any icon → updates chart_type. Matches Google Sheets' chart
// editor "Setup" tab type picker.

const CHART_TYPE_OPTIONS: Array<{ value: string; label: string; icon: string }> = [
  { value: "COLUMN_CLUSTERED",           label: "Column",           icon: "📊" },
  { value: "COLUMN_STACKED",             label: "Stacked column",   icon: "▭" },
  { value: "COLUMN_100_PERCENT_STACKED", label: "100% column",      icon: "▬" },
  { value: "BAR_CLUSTERED",              label: "Bar",              icon: "📉" },
  { value: "BAR_STACKED",                label: "Stacked bar",      icon: "▤" },
  { value: "LINE",                       label: "Line",             icon: "📈" },
  { value: "LINE_MARKERS",               label: "Line + markers",   icon: "⋲" },
  { value: "AREA",                       label: "Area",             icon: "◢" },
  { value: "AREA_STACKED",               label: "Stacked area",     icon: "◣" },
  { value: "PIE",                        label: "Pie",              icon: "⬤" },
  { value: "DOUGHNUT",                   label: "Donut",            icon: "◎" },
  { value: "XY_SCATTER",                 label: "Scatter",          icon: "⁙" },
]

function chartTypeIcon(type: string): { icon: string; label: string } {
  const t = (type || "").toUpperCase()
  const opt = CHART_TYPE_OPTIONS.find((o) => o.value === t)
  return opt ? { icon: opt.icon, label: opt.label } : { icon: "📊", label: "Column" }
}

function ChartTypePicker({ elementId, currentType }: { elementId: string; currentType: string }) {
  const [open, setOpen] = useState(false)
  const { icon, label } = chartTypeIcon(currentType)
  const pick = (value: string) => {
    if (value.toUpperCase() === (currentType || "").toUpperCase()) { setOpen(false); return }
    commitChartData(elementId, { chart_type: value.toLowerCase() } as unknown as Partial<ChartData>)
      .catch((e) => console.error("[Percy] chart type change failed:", e))
    setOpen(false)
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseDown={(e) => e.stopPropagation()}
        style={TOOLBAR_BTN(open)}
        title="Change chart type"
      >
        <span>{label}</span>
        <span style={{ fontSize: 9, color: "#5f6368", marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 8 }}
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
          />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              padding: 6, minWidth: 220,
              fontFamily: "'Google Sans', system-ui, sans-serif",
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2,
            }}
          >
            {CHART_TYPE_OPTIONS.map((o) => {
              const active = o.value === (currentType || "").toUpperCase()
              return (
                <button
                  key={o.value}
                  onClick={() => pick(o.value)}
                  title={o.label}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    padding: "6px 4px",
                    background: active ? "#e8f0fe" : "transparent",
                    color: active ? "#1a73e8" : "#3c4043",
                    border: active ? "1px solid #1a73e8" : "1px solid transparent",
                    borderRadius: 4, cursor: "pointer",
                    fontSize: 10, fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                >
                  <span style={{ fontSize: 16 }}>{o.icon}</span>
                  <span style={{ whiteSpace: "nowrap" }}>{o.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Shared toolbar button style helper.
const TOOLBAR_BTN = (active: boolean): React.CSSProperties => ({
  padding: "2px 8px",
  background: active ? "#e8f0fe" : "transparent",
  border: active ? "1px solid #1a73e8" : "1px solid transparent",
  color: active ? "#1a73e8" : "#3c4043",
  borderRadius: 3, fontSize: 11,
  fontFamily: "'Google Sans', system-ui, sans-serif",
  cursor: "pointer", whiteSpace: "nowrap",
  display: "flex", alignItems: "center", gap: 4,
})

// ── Axis title click-to-edit overlay ────────────────────────────────────────
// position="bottom" → centered under chart for X-axis title
// position="left"   → vertically rotated -90° to the left for Y-axis title

function AxisTitleOverlay({
  elementId, position, currentTitle, patchPath, existingAxis,
}: {
  elementId:    string
  position:     "bottom" | "left"
  currentTitle: string | null
  patchPath:    "category_axis" | "value_axis"
  existingAxis: ChartData["category_axis"] | ChartData["value_axis"]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState("")

  const save = (text: string) => {
    if (text === (currentTitle ?? "")) { setEditing(false); return }
    const update = {
      [patchPath]: { ...existingAxis, title: { ...existingAxis.title, text: text || null } },
    } as Partial<ChartData>
    commitChartData(elementId, update).catch((e) => console.error("[Percy] axis title save failed:", e))
    setEditing(false)
  }

  // X-axis title sits to the LEFT of the legend (which is at bottom-center)
  // so the two don't collide. Y-axis title sits rotated on the left edge.
  const baseStyle: React.CSSProperties = position === "bottom"
    ? {
        position: "absolute", bottom: 4, left: 80,
        zIndex: 5,
      }
    : {
        position: "absolute", top: "50%", left: 0,
        transform: "translateY(-50%) rotate(-90deg)",
        transformOrigin: "center",
        zIndex: 5,
      }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(draft)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
          if (e.key === "Escape") setEditing(false)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          ...baseStyle,
          padding: "1px 6px",
          background: "#fff", border: "1.5px solid #1a73e8", borderRadius: 3,
          fontSize: 11, color: "#3c4043",
          fontFamily: "'Google Sans', system-ui, sans-serif",
          outline: "none", textAlign: "center",
          minWidth: 120, maxWidth: 200,
        }}
      />
    )
  }

  if (currentTitle) {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setDraft(currentTitle); setEditing(true) }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Click to edit axis title"
        style={{
          ...baseStyle,
          padding: "1px 6px", cursor: "text",
          fontSize: 11, color: "#3c4043",
          fontFamily: "'Google Sans', system-ui, sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {currentTitle}
      </div>
    )
  }

  // No title yet — show the "+ Add … title" placeholder
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setDraft(""); setEditing(true) }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        ...baseStyle,
        padding: "1px 6px", background: "transparent",
        border: "1px dashed #bdc1c6", borderRadius: 3,
        color: "#80868b", fontSize: 10,
        fontFamily: "'Google Sans', system-ui, sans-serif",
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      + Add {position === "bottom" ? "X-axis" : "Y-axis"} title
    </button>
  )
}

// ── Category rename overlay (X-axis tick labels) ────────────────────────────
// Renders a small dashed "Rename categories" button under the chart that
// opens a flyout with one input per category. Saves on each blur.

function CategoryRenameOverlay({
  elementId, categories,
}: {
  elementId:  string
  categories: string[]
}) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<string[]>(categories.map((c) => c ?? ""))

  useEffect(() => { setDrafts(categories.map((c) => c ?? "")) }, [categories])

  const save = (idx: number, text: string) => {
    if (text === (categories[idx] ?? "")) return
    const next = [...categories]
    next[idx] = text
    commitChartData(elementId, { categories: next }).catch((e) => console.error("[Percy] category save failed:", e))
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseDown={(e) => e.stopPropagation()}
        style={TOOLBAR_BTN(open)}
        title="Rename X-axis categories"
      >
        ✎ categories
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 10, minWidth: 200,
              fontFamily: "'Google Sans', system-ui, sans-serif",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#5f6368", fontWeight: 500 }}>Categories</span>
              <button onClick={() => setOpen(false)} style={{ fontSize: 12, color: "#80868b", background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
            {drafts.map((d, i) => (
              <input
                key={i}
                value={d}
                onChange={(e) => setDrafts((arr) => arr.map((v, j) => j === i ? e.target.value : v))}
                onBlur={() => save(i, drafts[i])}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
                }}
                style={{
                  display: "block", width: "100%", margin: "3px 0",
                  padding: "3px 6px", fontSize: 12, color: "#3c4043",
                  border: "1px solid #dadce0", borderRadius: 3, outline: "none",
                  fontFamily: "inherit",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Legend series rename overlay ────────────────────────────────────────────
// Small "✎ series" button bottom-left of chart; flyout with one input per series.

function LegendRenameOverlay({
  elementId, series,
}: {
  elementId: string
  series:    Array<{ idx: number; name: string }>
}) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<string[]>(series.map((s) => s.name ?? ""))

  useEffect(() => { setDrafts(series.map((s) => s.name ?? "")) }, [series])

  const save = (idx: number, text: string) => {
    if (text === (series[idx]?.name ?? "")) return
    const nextSeries = series.map((s, i) => i === idx ? { ...s, name: text } : s)
    commitChartData(elementId, { series: nextSeries as unknown as ChartData["series"] })
      .catch((e) => console.error("[Percy] series rename failed:", e))
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseDown={(e) => e.stopPropagation()}
        style={TOOLBAR_BTN(open)}
        title="Rename legend / series"
      >
        ✎ series
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 10, minWidth: 200,
              fontFamily: "'Google Sans', system-ui, sans-serif",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#5f6368", fontWeight: 500 }}>Series</span>
              <button onClick={() => setOpen(false)} style={{ fontSize: 12, color: "#80868b", background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
            {drafts.map((d, i) => (
              <input
                key={i}
                value={d}
                onChange={(e) => setDrafts((arr) => arr.map((v, j) => j === i ? e.target.value : v))}
                onBlur={() => save(i, drafts[i])}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
                }}
                style={{
                  display: "block", width: "100%", margin: "3px 0",
                  padding: "3px 6px", fontSize: 12, color: "#3c4043",
                  border: "1px solid #dadce0", borderRadius: 3, outline: "none",
                  fontFamily: "inherit",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Y-axis range inline edit ────────────────────────────────────────────────
// Small "↕ y-range" chip at bottom-right; opens flyout with min/max inputs.
// Empty = "auto" (Recharts default).

function AxisRangeOverlay({
  elementId, valueAxis,
}: { elementId: string; valueAxis: ChartData["value_axis"] }) {
  const [open, setOpen] = useState(false)
  const [minDraft, setMinDraft] = useState(valueAxis.min !== null ? String(valueAxis.min) : "")
  const [maxDraft, setMaxDraft] = useState(valueAxis.max !== null ? String(valueAxis.max) : "")

  useEffect(() => {
    setMinDraft(valueAxis.min !== null ? String(valueAxis.min) : "")
    setMaxDraft(valueAxis.max !== null ? String(valueAxis.max) : "")
  }, [valueAxis.min, valueAxis.max])

  const save = () => {
    const minNum = minDraft.trim() === "" ? null : parseFloat(minDraft)
    const maxNum = maxDraft.trim() === "" ? null : parseFloat(maxDraft)
    const minVal = Number.isFinite(minNum) ? minNum : null
    const maxVal = Number.isFinite(maxNum) ? maxNum : null
    if (minVal === valueAxis.min && maxVal === valueAxis.max) return
    commitChartData(elementId, {
      value_axis: { ...valueAxis, min: minVal, max: maxVal },
    }).catch((e) => console.error("[Percy] axis range save failed:", e))
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseDown={(e) => e.stopPropagation()}
        style={TOOLBAR_BTN(open)}
        title="Set Y-axis min/max"
      >
        ↕ y-range
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, right: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 10, minWidth: 180,
              fontFamily: "'Google Sans', system-ui, sans-serif",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#5f6368", fontWeight: 500 }}>Y-axis range</span>
              <button onClick={() => setOpen(false)} style={{ fontSize: 12, color: "#80868b", background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
            <label style={{ fontSize: 10, color: "#5f6368", display: "block", marginTop: 2 }}>Min</label>
            <input
              type="number"
              value={minDraft}
              placeholder="auto"
              onChange={(e) => setMinDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur() }}
              style={{
                display: "block", width: "100%", margin: "2px 0 6px",
                padding: "3px 6px", fontSize: 12,
                border: "1px solid #dadce0", borderRadius: 3, outline: "none",
              }}
            />
            <label style={{ fontSize: 10, color: "#5f6368", display: "block" }}>Max</label>
            <input
              type="number"
              value={maxDraft}
              placeholder="auto"
              onChange={(e) => setMaxDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur() }}
              style={{
                display: "block", width: "100%", margin: "2px 0",
                padding: "3px 6px", fontSize: 12,
                border: "1px solid #dadce0", borderRadius: 3, outline: "none",
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Data labels toggle ──────────────────────────────────────────────────────
// One-click button that toggles data_labels.show on ALL series.

function DataLabelsToggle({
  elementId, series,
}: { elementId: string; series: ChartData["series"] }) {
  const anyOn = series.some((s) => s.data_labels?.show)
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !anyOn
    const updatedSeries = series.map((s) => ({
      ...s,
      data_labels: { ...s.data_labels, show: next },
    }))
    commitChartData(elementId, { series: updatedSeries }).catch((err) => console.error("[Percy] data labels toggle failed:", err))
  }
  return (
    <button
      onClick={toggle}
      onMouseDown={(e) => e.stopPropagation()}
      style={TOOLBAR_BTN(anyOn)}
      title="Toggle data labels on bars/points"
    >
      <span>#</span><span>values</span>
    </button>
  )
}

export function registerChartRenderer(): void {
  registerRenderer("BridgeChart", ChartRendererImpl)
}

export default ChartRendererImpl
