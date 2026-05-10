import { useState } from "react"
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
import { commitChartData } from "../../../lib/studio/commands"
import type { NativeRendererProps } from "./RendererRegistry"
import { registerRenderer } from "./RendererRegistry"

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
      reversed={ax.reverse_order}
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
                  position={horizontal ? "right" : "top"}
                  style={{
                    fontSize: s.data_labels.font_size ?? 9,
                    fill: outsideLabelColor(s.data_labels.font_color),
                  }}
                  formatter={(v: unknown) => {
                    const n = Number(v)
                    return percent && Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : String(v ?? "")
                  }}
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
            return (
              <Area
                key={key}
                type={s.smooth ? "monotone" : "linear"}
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                fill={color}
                fillOpacity={0.15}
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

function PieOrDonutChart({ data, donut, exploded }: { data: ChartData; donut: boolean; exploded: boolean }) {
  const pieData = buildPieData(data)
  const lp = legendProps(data.legend)
  const total = pieData.reduce((s, d) => s + (d.value || 0), 0)
  const pctLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
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
    case "PIE":                         return <PieOrDonutChart data={data} donut={false} exploded={false} />
    case "PIE_EXPLODED":                return <PieOrDonutChart data={data} donut={false} exploded={true}  />
    case "DOUGHNUT":                    return <PieOrDonutChart data={data} donut={true}  exploded={false} />
    case "DOUGHNUT_EXPLODED":           return <PieOrDonutChart data={data} donut={true}  exploded={true}  />
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

  if (error) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#fff5f5", color: "#b91c1c",
        fontSize: 10, fontFamily: "monospace", padding: 4, textAlign: "center",
        boxSizing: "border-box",
      }}>
        Chart load failed
      </div>
    )
  }
  if (!data) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f8f9fa",
      }}>
        <div style={{
          width: 18, height: 18,
          border: "2px solid #3366CC",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }} />
      </div>
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
      {title && (
        <div style={{
          position: "absolute", top: 2, left: 0, right: 0, zIndex: 1,
          pointerEvents: "none", userSelect: "none",
          ...title.style,
        }}>
          {title.text}
        </div>
      )}
      <ChartByType data={data} onPointClick={onPointClick} elementId={element.id} />
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
    </div>
  )
}

export function registerChartRenderer(): void {
  registerRenderer("BridgeChart", ChartRendererImpl)
}

export default ChartRendererImpl
