import { useState, useEffect, useCallback, useRef } from "react"
import type {
  ChartData, ChartDataUpdate, ChartSeriesData, ChartAxisData,
} from "../../lib/studioTypes"
import { commitChartData } from "../../lib/studio/commands"
import { studioStore } from "../../lib/studio/store"

// ── Lightweight UI primitives (match StudioPropertiesPanel style) ─────────────

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-2 mb-1.5 first:mt-0">
      <div className="text-[10px] uppercase tracking-widest text-muted">{title}</div>
      {action}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ColorBox({ value, onChange, allowClear }: {
  value: string | null
  onChange: (hex: string | null) => void
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const swatch = value || "#999999"
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        onClick={() => setOpen(true)}
        className="w-5 h-5 rounded border border-edge cursor-pointer shrink-0"
        style={{ background: value ? swatch : "repeating-linear-gradient(45deg, #555 0 4px, #333 4px 8px)" }}
        title={value || "(none)"}
      />
      <span className="text-[10px] font-mono text-muted/70">{value ?? "—"}</span>
      {open && (
        <div className="absolute z-50 top-6 left-0 bg-surface border border-edge rounded shadow-xl p-2 flex flex-col gap-1.5">
          <input
            type="color"
            value={swatch}
            autoFocus
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            onBlur={() => setOpen(false)}
            className="w-24 h-6"
          />
          {allowClear && (
            <button onClick={() => { onChange(null); setOpen(false) }} className="text-[10px] text-muted hover:text-bad">
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NumBox({ value, onChange, placeholder, step = 1, width = "w-16" }: {
  value: number | null | undefined
  onChange: (v: number | null) => void
  placeholder?: string
  step?: number
  width?: string
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value))
  useEffect(() => { setText(value === null || value === undefined ? "" : String(value)) }, [value])
  const commit = () => {
    const t = text.trim()
    if (!t) { onChange(null); return }
    const n = parseFloat(t)
    if (!isNaN(n)) onChange(n)
  }
  return (
    <input
      type="number"
      step={step}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }}
      className={`${width} text-[11px] font-mono bg-base border border-edge rounded px-1.5 py-0.5
                  text-slate-200 focus:outline-none focus:border-accent
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
    />
  )
}

function TextBox({ value, onChange, placeholder, width = "flex-1" }: {
  value: string | null | undefined
  onChange: (v: string) => void
  placeholder?: string
  width?: string
}) {
  const [text, setText] = useState(value || "")
  useEffect(() => { setText(value || "") }, [value])
  const commit = () => { if (text !== (value || "")) onChange(text) }
  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }}
      className={`${width} text-[11px] bg-base border border-edge rounded px-1.5 py-0.5
                  text-slate-200 focus:outline-none focus:border-accent`}
    />
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-7 h-3.5 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/10 border border-edge"}`}
    >
      <span
        className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`}
      />
    </button>
  )
}

function Selector<T extends string>({ value, onChange, options }: {
  value: T | null | undefined
  onChange: (v: T) => void
  options: ReadonlyArray<{ label: string; value: T }>
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-[11px] bg-base border border-edge rounded px-1.5 py-0.5
                 text-slate-200 focus:outline-none focus:border-accent"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Chart-type catalog ────────────────────────────────────────────────────────

const CHART_TYPE_GROUPS: ReadonlyArray<{ group: string; types: { label: string; value: string }[] }> = [
  { group: "Column / Bar", types: [
    { label: "Column",            value: "COLUMN_CLUSTERED" },
    { label: "Stacked Column",    value: "COLUMN_STACKED" },
    { label: "100% Stacked Col",  value: "COLUMN_100_PERCENT_STACKED" },
    { label: "Bar (horizontal)",  value: "BAR_CLUSTERED" },
    { label: "Stacked Bar",       value: "BAR_STACKED" },
    { label: "100% Stacked Bar",  value: "BAR_100_PERCENT_STACKED" },
  ]},
  { group: "Line / Area", types: [
    { label: "Line",          value: "LINE" },
    { label: "Line + Markers", value: "LINE_MARKERS" },
    { label: "Area",          value: "AREA" },
    { label: "Stacked Area",  value: "AREA_STACKED" },
  ]},
  { group: "Pie", types: [
    { label: "Pie",       value: "PIE" },
    { label: "Doughnut",  value: "DOUGHNUT" },
  ]},
  { group: "Scatter", types: [
    { label: "Scatter",        value: "XY_SCATTER" },
    { label: "Scatter + Lines", value: "XY_SCATTER_LINES" },
    { label: "Bubble",          value: "BUBBLE" },
  ]},
]

const LEGEND_POSITIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Top",    value: "TOP"    },
  { label: "Bottom", value: "BOTTOM" },
  { label: "Left",   value: "LEFT"   },
  { label: "Right",  value: "RIGHT"  },
  { label: "Hidden", value: "HIDDEN" },
]

const NUMBER_FORMATS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "General",      value: "General"  },
  { label: "Number 0",     value: "0"        },
  { label: "Number 0.0",   value: "0.0"      },
  { label: "Number 0.00",  value: "0.00"     },
  { label: "Percent 0%",   value: "0%"       },
  { label: "Percent 0.0%", value: "0.0%"     },
  { label: "Currency $",   value: "$#,##0"   },
  { label: "Thousands",    value: "#,##0"    },
]

const SERIES_PLOT_TYPES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "(use chart type)", value: "" },
  { label: "Bar",   value: "barChart" },
  { label: "Line",  value: "lineChart" },
  { label: "Area",  value: "areaChart" },
]

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

type SubTab = "data" | "series" | "axes" | "title"

interface PanelProps {
  data: ChartData
  patch: (update: ChartDataUpdate) => void
}

// ─── Data tab: spreadsheet grid ─────────────────────────────────────────────

function DataTab({ data, patch }: PanelProps) {
  const seriesNames = data.series.map((s, i) => s.name || `Series ${i + 1}`)
  const numCats = Math.max(data.categories.length, ...data.series.map((s) => s.values.length))

  const updateCellValue = (rowIdx: number, sIdx: number, val: string) => {
    const newSeries = data.series.map((s, i) => {
      if (i !== sIdx) return s
      const vals = [...s.values]
      while (vals.length <= rowIdx) vals.push(null)
      const n = parseFloat(val)
      vals[rowIdx] = isNaN(n) ? null : n
      return { ...s, values: vals }
    })
    patch({ series: newSeries })
  }

  const updateCategoryLabel = (rowIdx: number, label: string) => {
    const cats = [...data.categories]
    while (cats.length <= rowIdx) cats.push("")
    cats[rowIdx] = label
    patch({ categories: cats })
  }

  const updateSeriesName = (sIdx: number, name: string) => {
    const newSeries = data.series.map((s, i) => i === sIdx ? { ...s, name } : s)
    patch({ series: newSeries })
  }

  const addRow = () => {
    const cats = [...data.categories, `Cat ${data.categories.length + 1}`]
    const newSeries = data.series.map((s) => ({ ...s, values: [...s.values, 0] }))
    patch({ categories: cats, series: newSeries })
  }

  const removeRow = (rowIdx: number) => {
    const cats = data.categories.filter((_, i) => i !== rowIdx)
    const newSeries = data.series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== rowIdx) }))
    patch({ categories: cats, series: newSeries })
  }

  const addSeries = () => {
    const newS: Partial<ChartSeriesData> = {
      idx: data.series.length,
      name: `Series ${data.series.length + 1}`,
      values: data.categories.map(() => 0),
      color: null,
    }
    patch({ series: [...data.series, newS as ChartSeriesData] })
  }

  const removeSeries = (sIdx: number) => {
    const newSeries = data.series.filter((_, i) => i !== sIdx)
    patch({ series: newSeries })
  }

  return (
    <div className="space-y-2">
      <SectionHead
        title="Data"
        action={
          <div className="flex gap-1">
            <button
              onClick={addRow}
              title="Add category row"
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
            >+ Row</button>
            <button
              onClick={addSeries}
              title="Add series column"
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
            >+ Col</button>
          </div>
        }
      />

      <div className="overflow-x-auto -mx-1 scrollbar-thin">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-edge/60">
              <th className="text-left text-muted/60 font-normal pl-1 pr-2 pb-1 sticky left-0 bg-surface z-10 w-8 text-[10px]">#</th>
              <th className="text-left text-muted/60 font-normal pr-2 pb-1 sticky left-8 bg-surface z-10 min-w-[5rem] text-[10px]">Category</th>
              {seriesNames.map((name, sIdx) => (
                <th key={sIdx} className="text-left font-normal pb-1 px-1 group">
                  <div className="flex items-center gap-0.5">
                    <input
                      defaultValue={name}
                      onBlur={(e) => updateSeriesName(sIdx, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className="w-20 text-[10px] bg-transparent border-b border-edge/50 hover:border-accent/50 focus:border-accent text-slate-200 px-0.5 focus:outline-none"
                    />
                    <button
                      onClick={() => removeSeries(sIdx)}
                      title="Remove this series"
                      className="opacity-0 group-hover:opacity-100 text-bad/70 hover:text-bad text-[12px] leading-none w-4"
                    >×</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: numCats }).map((_, rowIdx) => (
              <tr key={rowIdx} className="group hover:bg-white/[0.02]">
                <td className="text-muted/40 pl-1 pr-2 py-0.5 sticky left-0 bg-surface z-10 text-[10px]">
                  <button
                    onClick={() => removeRow(rowIdx)}
                    title="Remove this row"
                    className="opacity-0 group-hover:opacity-100 text-bad/70 hover:text-bad"
                  >×</button>
                  <span className="ml-0.5">{rowIdx + 1}</span>
                </td>
                <td className="pr-2 py-0.5 sticky left-8 bg-surface z-10">
                  <input
                    defaultValue={data.categories[rowIdx] ?? ""}
                    onBlur={(e) => updateCategoryLabel(rowIdx, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                    className="w-20 text-[10px] bg-transparent border-b border-transparent hover:border-edge/50 focus:border-accent text-slate-200 px-0.5 focus:outline-none"
                    placeholder={`Cat ${rowIdx + 1}`}
                  />
                </td>
                {data.series.map((s, sIdx) => {
                  const v = s.values[rowIdx]
                  return (
                    <td key={sIdx} className="px-1 py-0.5">
                      <input
                        defaultValue={v === null || v === undefined ? "" : String(v)}
                        type="number"
                        step="any"
                        onBlur={(e) => updateCellValue(rowIdx, sIdx, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                        className="w-16 text-[10px] bg-transparent border-b border-transparent hover:border-edge/50 focus:border-accent text-slate-200 px-0.5 focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted/50 pt-1">
        Edits commit on blur or Enter. Numbers only in series columns.
      </div>
    </div>
  )
}

// ─── Series tab: per-series styling ─────────────────────────────────────────

function SeriesTab({ data, patch }: PanelProps) {
  const updateSeriesField = (sIdx: number, fields: Partial<ChartSeriesData>) => {
    const newSeries = data.series.map((s, i) => i === sIdx ? { ...s, ...fields } : s)
    patch({ series: newSeries })
  }
  const updateLine = (sIdx: number, lineFields: Partial<ChartSeriesData["line"]>) => {
    const newSeries = data.series.map((s, i) => i === sIdx ? { ...s, line: { ...s.line, ...lineFields } } : s)
    patch({ series: newSeries })
  }
  const updateMarker = (sIdx: number, mFields: Partial<ChartSeriesData["marker"]>) => {
    const newSeries = data.series.map((s, i) => i === sIdx ? { ...s, marker: { ...s.marker, ...mFields } } : s)
    patch({ series: newSeries })
  }
  const updateLabels = (sIdx: number, lFields: Partial<ChartSeriesData["data_labels"]>) => {
    const newSeries = data.series.map((s, i) => i === sIdx ? { ...s, data_labels: { ...s.data_labels, ...lFields } } : s)
    patch({ series: newSeries })
  }

  return (
    <div className="space-y-3">
      {data.series.map((s, sIdx) => (
        <div key={sIdx} className="bg-base/40 border border-edge/60 rounded p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ColorBox
                value={s.color}
                onChange={(c) => updateSeriesField(sIdx, { color: c })}
                allowClear
              />
              <span className="text-[11px] text-slate-300 font-medium">{s.name || `Series ${sIdx + 1}`}</span>
            </div>
            <span className="text-[10px] text-muted/60">{s.values.length} pts</span>
          </div>

          <FieldRow label="Plot type">
            <Selector value={s.plot_type ?? ""} onChange={(v) => updateSeriesField(sIdx, { plot_type: v || null })} options={SERIES_PLOT_TYPES} />
          </FieldRow>

          <FieldRow label="Smooth">
            <Toggle on={s.smooth} onChange={(v) => updateSeriesField(sIdx, { smooth: v })} />
          </FieldRow>

          <FieldRow label="Line width">
            <NumBox value={s.line.width} onChange={(v) => updateLine(sIdx, { width: v })} step={0.25} />
          </FieldRow>

          <FieldRow label="Line dash">
            <Selector
              value={s.line.dash ?? ""}
              onChange={(v) => updateLine(sIdx, { dash: v || null })}
              options={[
                { label: "Solid", value: "solid" },
                { label: "Dash",  value: "dash" },
                { label: "Dot",   value: "dot" },
                { label: "DashDot", value: "dashdot" },
              ]}
            />
          </FieldRow>

          <FieldRow label="Marker">
            <Selector
              value={s.marker.style ?? ""}
              onChange={(v) => updateMarker(sIdx, { style: v || null })}
              options={[
                { label: "None",     value: "none" },
                { label: "Circle",   value: "circle" },
                { label: "Square",   value: "square" },
                { label: "Diamond",  value: "diamond" },
                { label: "Triangle", value: "triangle" },
                { label: "X",        value: "x" },
              ]}
            />
          </FieldRow>

          <FieldRow label="Marker size">
            <NumBox value={s.marker.size} onChange={(v) => updateMarker(sIdx, { size: v })} step={1} />
          </FieldRow>

          <FieldRow label="Show labels">
            <Toggle on={s.data_labels.show} onChange={(v) => updateLabels(sIdx, { show: v })} />
          </FieldRow>

          {s.data_labels.show && (
            <>
              <FieldRow label="↳ value">
                <Toggle on={s.data_labels.show_val} onChange={(v) => updateLabels(sIdx, { show_val: v })} />
              </FieldRow>
              <FieldRow label="↳ category">
                <Toggle on={s.data_labels.show_cat_name} onChange={(v) => updateLabels(sIdx, { show_cat_name: v })} />
              </FieldRow>
              <FieldRow label="↳ percent">
                <Toggle on={s.data_labels.show_percent} onChange={(v) => updateLabels(sIdx, { show_percent: v })} />
              </FieldRow>
              <FieldRow label="↳ font size">
                <NumBox value={s.data_labels.font_size} onChange={(v) => updateLabels(sIdx, { font_size: v })} step={1} />
              </FieldRow>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Axes tab ───────────────────────────────────────────────────────────────

function AxisCard({ name, axis, onChange }: {
  name: string
  axis: ChartAxisData
  onChange: (update: Partial<ChartAxisData>) => void
}) {
  return (
    <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-300 font-medium">{name}</span>
        <Toggle on={axis.visible} onChange={(v) => onChange({ visible: v })} />
      </div>

      <FieldRow label="Min">
        <NumBox value={axis.min} onChange={(v) => onChange({ min: v })} placeholder="auto" step={0.1} />
      </FieldRow>

      <FieldRow label="Max">
        <NumBox value={axis.max} onChange={(v) => onChange({ max: v })} placeholder="auto" step={0.1} />
      </FieldRow>

      <FieldRow label="Major unit">
        <NumBox value={axis.major_unit} onChange={(v) => onChange({ major_unit: v })} placeholder="auto" step={0.1} />
      </FieldRow>

      <FieldRow label="Major grid">
        <Toggle on={axis.gridlines_major} onChange={(v) => onChange({ gridlines_major: v })} />
      </FieldRow>

      <FieldRow label="Minor grid">
        <Toggle on={axis.gridlines_minor} onChange={(v) => onChange({ gridlines_minor: v })} />
      </FieldRow>

      <FieldRow label="Number fmt">
        <Selector
          value={axis.number_format ?? ""}
          onChange={(v) => onChange({ number_format: v || null })}
          options={NUMBER_FORMATS}
        />
      </FieldRow>

      <FieldRow label="Reversed">
        <Toggle on={axis.reverse_order} onChange={(v) => onChange({ reverse_order: v })} />
      </FieldRow>

      <FieldRow label="Title">
        <TextBox
          value={axis.title.text}
          onChange={(v) => onChange({ title: { ...axis.title, text: v || null } })}
          placeholder="(none)"
        />
      </FieldRow>

      <FieldRow label="Tick size">
        <NumBox value={axis.tick_label_font_size} onChange={(v) => onChange({ tick_label_font_size: v })} step={0.5} />
      </FieldRow>
    </div>
  )
}

function AxesTab({ data, patch }: PanelProps) {
  return (
    <div className="space-y-3">
      <SectionHead title="Value Axis" />
      <AxisCard name="Value (Y)" axis={data.value_axis} onChange={(u) => patch({ value_axis: u })} />

      <SectionHead title="Category Axis" />
      <AxisCard name="Category (X)" axis={data.category_axis} onChange={(u) => patch({ category_axis: u })} />
    </div>
  )
}

// ─── Title & Legend & Plot tab ──────────────────────────────────────────────

function TitleTab({ data, patch }: PanelProps) {
  const titlePatch = (u: Partial<ChartData["title"]>) => patch({ title: { ...data.title, ...u } })
  const legendPatch = (u: Partial<ChartData["legend"]>) => patch({ legend: { ...data.legend, ...u } })
  const plotPatch = (u: Partial<ChartData["plot_properties"]>) => patch({ plot_properties: { ...data.plot_properties, ...u } })

  const ct = (data.chart_type || "").toUpperCase()
  const isPie = ct.startsWith("PIE") || ct.startsWith("DOUGHNUT")
  const isBar = ct.startsWith("COLUMN") || ct.startsWith("BAR")

  return (
    <div className="space-y-3">
      <SectionHead title="Chart Type" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-2">
        <Selector
          value={data.chart_type}
          onChange={(v) => patch({ chart_type: v })}
          options={CHART_TYPE_GROUPS.flatMap((g) => g.types)}
        />
      </div>

      <SectionHead title="Title" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        <FieldRow label="Text">
          <TextBox value={data.title.text} onChange={(v) => titlePatch({ text: v || null })} placeholder="(none)" />
        </FieldRow>
        <FieldRow label="Font size">
          <NumBox value={data.title.font_size} onChange={(v) => titlePatch({ font_size: v })} step={1} />
        </FieldRow>
        <FieldRow label="Bold">
          <Toggle on={!!data.title.font_bold} onChange={(v) => titlePatch({ font_bold: v })} />
        </FieldRow>
        <FieldRow label="Italic">
          <Toggle on={!!data.title.font_italic} onChange={(v) => titlePatch({ font_italic: v })} />
        </FieldRow>
        <FieldRow label="Color">
          <ColorBox value={data.title.font_color} onChange={(c) => titlePatch({ font_color: c })} allowClear />
        </FieldRow>
      </div>

      <SectionHead title="Legend" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        <FieldRow label="Show">
          <Toggle on={data.legend.visible} onChange={(v) => legendPatch({ visible: v })} />
        </FieldRow>
        <FieldRow label="Position">
          <Selector
            value={data.legend.visible ? (data.legend.position ?? "RIGHT") : "HIDDEN"}
            onChange={(v) => {
              if (v === "HIDDEN") legendPatch({ visible: false })
              else legendPatch({ visible: true, position: v })
            }}
            options={LEGEND_POSITIONS}
          />
        </FieldRow>
        <FieldRow label="Font size">
          <NumBox value={data.legend.font_size} onChange={(v) => legendPatch({ font_size: v })} step={1} />
        </FieldRow>
        <FieldRow label="Font color">
          <ColorBox value={data.legend.font_color} onChange={(c) => legendPatch({ font_color: c })} allowClear />
        </FieldRow>
      </div>

      <SectionHead title="Plot Style" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        {isBar && (
          <>
            <FieldRow label="Gap width">
              <NumBox value={data.plot_properties.bar_width_ratio} onChange={(v) => plotPatch({ bar_width_ratio: v })} step={0.1} />
            </FieldRow>
            <FieldRow label="Overlap">
              <NumBox value={data.plot_properties.overlap} onChange={(v) => plotPatch({ overlap: v === null ? null : Math.round(v) })} step={5} />
            </FieldRow>
          </>
        )}
        {isPie && (
          <>
            <FieldRow label="Hole size %">
              <NumBox value={data.plot_properties.hole_size} onChange={(v) => plotPatch({ hole_size: v === null ? null : Math.round(v) })} step={5} />
            </FieldRow>
            <FieldRow label="Start angle">
              <NumBox value={data.plot_properties.first_slice_ang} onChange={(v) => plotPatch({ first_slice_ang: v === null ? null : Math.round(v) })} step={15} />
            </FieldRow>
          </>
        )}
        <FieldRow label="Vary colors">
          <Toggle on={!!data.plot_properties.vary_colors} onChange={(v) => plotPatch({ vary_colors: v })} />
        </FieldRow>
      </div>
    </div>
  )
}

// ── Top-level panel ───────────────────────────────────────────────────────────

interface Props {
  docId: string
  slideN: number
  elementId: string
  onCommit: () => void
}

export default function ChartEditorPanel({ docId, slideN, elementId, onCommit }: Props) {
  const [data, setData]       = useState<ChartData | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [subTab, setSubTab]   = useState<SubTab>("data")

  // Latest pending PATCH; we coalesce calls so rapid edits batch into one request.
  const pendingRef = useRef<ChartDataUpdate | null>(null)
  const flushTimer = useRef<number | null>(null)

  // initial load
  useEffect(() => {
    let cancelled = false
    setError(null)
    setData(null)
    studioStore.loadChartPayload(docId, slideN, elementId)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, elementId])

  const flush = useCallback(async () => {
    const update = pendingRef.current
    pendingRef.current = null
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    if (!update) return
    setSaving(true)
    try {
      const fresh = await commitChartData(elementId, update)
      if (!fresh) return
      setData(fresh)
      onCommit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [elementId, onCommit])

  const patch = useCallback((update: ChartDataUpdate) => {
    // Optimistically merge into local state so the UI feels instant.
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...update,
        title:           update.title           ? { ...prev.title,           ...update.title           } : prev.title,
        legend:          update.legend          ? { ...prev.legend,          ...update.legend          } : prev.legend,
        category_axis:   update.category_axis   ? { ...prev.category_axis,   ...update.category_axis   } : prev.category_axis,
        value_axis:      update.value_axis      ? { ...prev.value_axis,      ...update.value_axis      } : prev.value_axis,
        plot_properties: update.plot_properties ? { ...prev.plot_properties, ...update.plot_properties } : prev.plot_properties,
        series:          update.series          ? (update.series as ChartSeriesData[]) : prev.series,
        categories:      update.categories      ? update.categories          : prev.categories,
      }
    })
    // Coalesce rapid calls for outgoing PATCH (debounce 200ms)
    pendingRef.current = { ...(pendingRef.current ?? {}), ...update }
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = window.setTimeout(() => { flush() }, 200)
  }, [flush])

  // flush on unmount
  useEffect(() => {
    return () => {
      if (pendingRef.current) flush()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="p-3 text-[11px] text-bad bg-bad/5 border border-bad/30 rounded m-2">
        Chart load failed: {error}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="p-3 text-[11px] text-muted">Loading chart…</div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sub-tab nav */}
      <div className="flex shrink-0 border-b border-edge/60 px-2 pt-1.5 gap-0.5 bg-base/30">
        {(["data", "series", "axes", "title"] as SubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={[
              "px-2 py-1 text-[10px] capitalize rounded-t transition-colors",
              subTab === t
                ? "bg-surface text-slate-200 border-t border-l border-r border-edge"
                : "text-muted hover:text-slate-300",
            ].join(" ")}
          >
            {t === "title" ? "Title & Legend" : t}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[9px] text-muted/60 self-center pr-1">{saving ? "saving…" : ""}</span>
      </div>

      {/* sub-tab body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-thin">
        {subTab === "data"   && <DataTab   data={data} patch={patch} />}
        {subTab === "series" && <SeriesTab data={data} patch={patch} />}
        {subTab === "axes"   && <AxesTab   data={data} patch={patch} />}
        {subTab === "title"  && <TitleTab  data={data} patch={patch} />}
      </div>
    </div>
  )
}
