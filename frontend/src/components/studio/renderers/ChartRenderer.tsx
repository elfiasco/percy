import { useEffect, useState } from "react"
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
import { fetchChartData } from "../../../lib/studioApi"
import type { NativeRendererProps } from "./RendererRegistry"
import { registerRenderer } from "./RendererRegistry"

const DEFAULT_PALETTE = [
  "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000",
  "#5B9BD5", "#70AD47", "#264478", "#9E480E",
  "#636363", "#997300", "#255E91", "#43682B",
]

function seriesColor(s: ChartSeriesData, idx: number): string {
  return s.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length]
}

// Recharts Legend props from Bridge legend.position
function legendProps(lg: ChartLegendData) {
  if (!lg.visible) return null
  const pos = (lg.position || "RIGHT").toUpperCase()
  const fontSize = lg.font_size ?? 10
  const style: Record<string, string | number> = { fontSize, color: lg.font_color || "#333" }
  switch (pos) {
    case "TOP":     return { verticalAlign: "top" as const,    align: "center" as const, layout: "horizontal" as const, wrapperStyle: style }
    case "BOTTOM":  return { verticalAlign: "bottom" as const, align: "center" as const, layout: "horizontal" as const, wrapperStyle: style }
    case "LEFT":    return { verticalAlign: "middle" as const, align: "left" as const,   layout: "vertical" as const,   wrapperStyle: style }
    case "RIGHT":
    default:        return { verticalAlign: "middle" as const, align: "right" as const,  layout: "vertical" as const,   wrapperStyle: style }
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
    color: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
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

function CartesianMargins() {
  return { top: 6, right: 12, bottom: 8, left: 8 }
}

function renderXAxis(data: ChartData, dataKey: string = "__cat__", horizontal = false) {
  const ax = horizontal ? data.value_axis : data.category_axis
  if (!ax.visible) return null
  return (
    <XAxis
      dataKey={horizontal ? undefined : dataKey}
      type={horizontal ? "number" : "category"}
      domain={horizontal && (ax.min !== null || ax.max !== null) ? [ax.min ?? "auto", ax.max ?? "auto"] : undefined}
      tick={{ fontSize: ax.tick_label_font_size ?? 9, fill: ax.tick_label_font_color || "#555" }}
      reversed={ax.reverse_order}
      tickFormatter={ax.number_format && horizontal ? (v) => formatNumber(v, ax.number_format!) : undefined}
    />
  )
}

function renderYAxis(data: ChartData, horizontal = false) {
  const ax = horizontal ? data.category_axis : data.value_axis
  if (!ax.visible) return null
  return (
    <YAxis
      dataKey={horizontal ? "__cat__" : undefined}
      type={horizontal ? "category" : "number"}
      domain={!horizontal && (ax.min !== null || ax.max !== null) ? [ax.min ?? "auto", ax.max ?? "auto"] : undefined}
      tick={{ fontSize: ax.tick_label_font_size ?? 9, fill: ax.tick_label_font_color || "#555" }}
      reversed={ax.reverse_order}
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

function ColumnOrBarChart({ data, horizontal, stacked, percent }: {
  data: ChartData; horizontal: boolean; stacked: boolean; percent: boolean
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={CartesianMargins()}
        barCategoryGap={data.plot_properties.bar_width_ratio ? `${10 / data.plot_properties.bar_width_ratio}%` : "20%"}
        stackOffset={percent ? "expand" : undefined}
      >
        {(data.value_axis.gridlines_major || data.category_axis.gridlines_major) &&
          <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
        }
        {renderXAxis(data, "__cat__", horizontal)}
        {renderYAxis(data, horizontal)}
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={valAxFormat ? (v) => formatNumber(v as number, valAxFormat) : undefined} />
        {lp && <Legend {...lp} />}
        {data.series.map((s, idx) => {
          const fill = seriesColor(s, idx)
          const key  = s.name || `Series ${idx + 1}`
          return (
            <Bar
              key={key}
              dataKey={key}
              fill={fill}
              stackId={stacked || percent ? "stack" : undefined}
              isAnimationActive={false}
            >
              {s.data_labels.show && (
                <LabelList
                  dataKey={key}
                  position={horizontal ? "right" : "top"}
                  style={{
                    fontSize: s.data_labels.font_size ?? 9,
                    fill: s.data_labels.font_color || "#444",
                  }}
                  formatter={(v: number) => percent ? `${(v * 100).toFixed(0)}%` : String(v)}
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={rows} margin={CartesianMargins()}>
        {(data.value_axis.gridlines_major || data.category_axis.gridlines_major) &&
          <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
        }
        {renderXAxis(data)}
        {renderYAxis(data)}
        <Tooltip cursor={{ stroke: "#999", strokeDasharray: "3 3" }} />
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
                fill={color}
                fillOpacity={0.45}
                stackId={stacked ? "stack" : undefined}
                isAnimationActive={false}
                dot={s.marker.style && s.marker.style !== "none"}
              />
            )
          }
          return (
            <Line
              key={key}
              type={s.smooth ? "monotone" : "linear"}
              dataKey={key}
              stroke={color}
              strokeWidth={s.line.width ?? 2}
              strokeDasharray={dashArray(s.line.dash)}
              dot={s.marker.style ? { r: (s.marker.size ?? 4) / 2, fill: s.marker.color || color } : false}
              isAnimationActive={false}
            >
              {s.data_labels.show && (
                <LabelList
                  dataKey={key}
                  position="top"
                  style={{ fontSize: s.data_labels.font_size ?? 9, fill: s.data_labels.font_color || "#444" }}
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
  const showLabels = data.series[0]?.data_labels.show
  const labelFormatter = (entry: { name: string; value: number; percent?: number }) => {
    const dl = data.series[0]?.data_labels
    if (!dl) return entry.name
    const parts: string[] = []
    if (dl.show_cat_name) parts.push(entry.name)
    if (dl.show_val)      parts.push(String(entry.value))
    if (dl.show_percent && entry.percent !== undefined) parts.push(`${(entry.percent * 100).toFixed(0)}%`)
    return parts.join(" ")
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip />
        {lp && <Legend {...lp} />}
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="80%"
          innerRadius={donut ? `${data.plot_properties.hole_size ?? 50}%` : 0}
          startAngle={90 - (data.plot_properties.first_slice_ang ?? 0)}
          endAngle={90 - (data.plot_properties.first_slice_ang ?? 0) - 360}
          isAnimationActive={false}
          label={showLabels ? labelFormatter : undefined}
          paddingAngle={exploded ? 2 : 0}
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={CartesianMargins()}>
        <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" tick={{ fontSize: 9 }} />
        <YAxis type="number" dataKey="y" tick={{ fontSize: 9 }} />
        {bubble && <ZAxis type="number" dataKey="z" range={[20, 200]} />}
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        {lp && <Legend {...lp} />}
        {series.map((s, idx) => (
          <Scatter
            key={idx}
            name={s.name}
            data={s.points}
            fill={s.color}
            line={withLines ? { stroke: s.color, strokeWidth: 1.5 } : false}
            shape="circle"
            isAnimationActive={false}
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={CartesianMargins()}>
        <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
        {renderXAxis(data)}
        {renderYAxis(data)}
        <Tooltip />
        {lp && <Legend {...lp} />}
        {data.series.map((s, idx) => {
          const color = seriesColor(s, idx)
          const key   = s.name || `Series ${idx + 1}`
          const pt    = (s.plot_type || "").toLowerCase()
          if (pt.includes("line")) {
            return <Line key={key} type={s.smooth ? "monotone" : "linear"} dataKey={key} stroke={color} strokeWidth={s.line.width ?? 2} dot={false} isAnimationActive={false} />
          }
          if (pt.includes("area")) {
            return <Area key={key} type={s.smooth ? "monotone" : "linear"} dataKey={key} stroke={color} fill={color} fillOpacity={0.4} isAnimationActive={false} />
          }
          return <Bar key={key} dataKey={key} fill={color} isAnimationActive={false} />
        })}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function ChartByType({ data }: { data: ChartData }) {
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

  switch (ct) {
    case "COLUMN_CLUSTERED":            return <ColumnOrBarChart data={data} horizontal={false} stacked={false} percent={false} />
    case "COLUMN_STACKED":              return <ColumnOrBarChart data={data} horizontal={false} stacked={true}  percent={false} />
    case "COLUMN_100_PERCENT_STACKED":  return <ColumnOrBarChart data={data} horizontal={false} stacked={true}  percent={true}  />
    case "BAR_CLUSTERED":               return <ColumnOrBarChart data={data} horizontal={true}  stacked={false} percent={false} />
    case "BAR_STACKED":                 return <ColumnOrBarChart data={data} horizontal={true}  stacked={true}  percent={false} />
    case "BAR_100_PERCENT_STACKED":     return <ColumnOrBarChart data={data} horizontal={true}  stacked={true}  percent={true}  />
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
    default:                            return <ColumnOrBarChart data={data} horizontal={false} stacked={false} percent={false} />
  }
}

// ── Top-level component ───────────────────────────────────────────────────────

function ChartRendererImpl({ element, docId, slideN, renderKey }: NativeRendererProps) {
  const [data, setData]   = useState<ChartData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchChartData(docId, slideN, element.id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id, renderKey])

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
        background: "#f3f4f6", color: "#9ca3af",
        fontSize: 10, fontFamily: "monospace",
      }}>
        Loading chart…
      </div>
    )
  }

  const title = chartTitle(data)
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: "transparent",   // composite over slide background
      pointerEvents: "none",       // pointer events stay with the overlay parent (drag/select)
      userSelect: "none",
      boxSizing: "border-box",
    }}>
      {title && <div style={title.style}>{title.text}</div>}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <ChartByType data={data} />
      </div>
    </div>
  )
}

export function registerChartRenderer(): void {
  registerRenderer("BridgeChart", ChartRendererImpl)
}

export default ChartRendererImpl
