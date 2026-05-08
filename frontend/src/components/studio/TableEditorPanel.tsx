import { useState, useEffect, useCallback, useRef } from "react"
import type { TableData, TableDataUpdate, TableCellEditor } from "../../lib/studioTypes"
import { commitTableData } from "../../lib/studio/commands"
import { studioStore } from "../../lib/studio/store"

// ── UI primitives ─────────────────────────────────────────────────────────────

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
          <input type="color" value={swatch} autoFocus
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            onBlur={() => setOpen(false)}
            className="w-24 h-6" />
          {allowClear && <button onClick={() => { onChange(null); setOpen(false) }} className="text-[10px] text-muted hover:text-bad">clear</button>}
        </div>
      )}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative w-7 h-3.5 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/10 border border-edge"}`}>
      <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </button>
  )
}

function NumBox({ value, onChange, step = 1, width = "w-16", placeholder }: {
  value: number | null | undefined
  onChange: (v: number | null) => void
  step?: number
  width?: string
  placeholder?: string
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
    <input type="number" step={step} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      className={`${width} text-[11px] font-mono bg-base border border-edge rounded px-1.5 py-0.5
                  text-slate-200 focus:outline-none focus:border-accent
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} />
  )
}

function Selector<T extends string>({ value, onChange, options }: {
  value: T | null | undefined
  onChange: (v: T) => void
  options: ReadonlyArray<{ label: string; value: T }>
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value as T)}
      className="text-[11px] bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-accent">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

type SubTab = "cells" | "layout" | "borders" | "style"

type CellCoord = { row: number; col: number }
type CellRangeSelection = { anchor: CellCoord; focus: CellCoord; row: number; col: number }

function singleCellSelection(cell: CellCoord): CellRangeSelection {
  return { anchor: cell, focus: cell, row: cell.row, col: cell.col }
}

function rangeSelection(anchor: CellCoord, focus: CellCoord): CellRangeSelection {
  return { anchor, focus, row: focus.row, col: focus.col }
}

function rangeBounds(sel: CellRangeSelection) {
  return {
    row0: Math.min(sel.anchor.row, sel.focus.row),
    row1: Math.max(sel.anchor.row, sel.focus.row),
    col0: Math.min(sel.anchor.col, sel.focus.col),
    col1: Math.max(sel.anchor.col, sel.focus.col),
  }
}

function cellsInSelection(sel: CellRangeSelection | null): CellCoord[] {
  if (!sel) return []
  const { row0, row1, col0, col1 } = rangeBounds(sel)
  const cells: CellCoord[] = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) cells.push({ row, col })
  }
  return cells
}

function primaryCell(sel: CellRangeSelection | null): CellCoord | null {
  return sel?.focus ?? sel?.anchor ?? null
}

function selectionLabel(sel: CellRangeSelection | null): string {
  if (!sel) return ""
  const { row0, row1, col0, col1 } = rangeBounds(sel)
  if (row0 === row1 && col0 === col1) return `R${row0 + 1}C${col0 + 1}`
  return `R${row0 + 1}C${col0 + 1}:R${row1 + 1}C${col1 + 1}`
}

function isCellSelected(sel: CellRangeSelection | null, cell: CellCoord): boolean {
  if (!sel) return false
  const { row0, row1, col0, col1 } = rangeBounds(sel)
  return cell.row >= row0 && cell.row <= row1 && cell.col >= col0 && cell.col <= col1
}

const H_ALIGN_OPTS = [
  { label: "Left",    value: "left" },
  { label: "Center",  value: "center" },
  { label: "Right",   value: "right" },
  { label: "Justify", value: "justify" },
] as const

const V_ALIGN_OPTS = [
  { label: "Top",    value: "top" },
  { label: "Middle", value: "middle" },
  { label: "Bottom", value: "bottom" },
] as const

const BORDER_STYLE_OPTS = [
  { label: "Solid",  value: "solid" },
  { label: "Dash",   value: "dash" },
  { label: "Dot",    value: "dot" },
  { label: "DashDot", value: "dashDot" },
] as const

// ── Cells tab: click to select, edit single-cell properties ──────────────────

function CellsTab({ data, sel, setSel, patch }: {
  data: TableData
  sel: CellRangeSelection | null
  setSel: (s: CellRangeSelection | null) => void
  patch: (u: TableDataUpdate) => void
}) {
  const updateCell = (fields: Partial<TableCellEditor>) => {
    if (!sel) return
    patch({ cells: cellsInSelection(sel).map((cell) => ({ ...fields, row: cell.row, col: cell.col })) })
  }
  const updatePrimaryCell = (fields: Partial<TableCellEditor>) => {
    const cell = primaryCell(sel)
    if (!cell) return
    patch({ cells: [{ ...fields, row: cell.row, col: cell.col }] })
  }

  const selectedCell = primaryCell(sel)
  const cell = selectedCell ? data.cells[selectedCell.row]?.[selectedCell.col] ?? null : null
  const label = selectionLabel(sel)

  return (
    <div className="space-y-2">
      <SectionHead title="Spreadsheet (click a cell)" />
      <div className="overflow-auto -mx-1 max-h-48 scrollbar-thin border border-edge/50 rounded">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="bg-base/60">
              <th className="text-muted/40 px-1 py-0.5 sticky left-0 bg-base/60 z-10 w-6"></th>
              {Array.from({ length: data.cols }).map((_, c) => (
                <th key={c} className="text-muted/40 font-normal px-1 py-0.5 text-[9px]">{c + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.cells.map((row, rIdx) => (
              <tr key={rIdx}>
                <td className="text-muted/40 px-1 py-0.5 sticky left-0 bg-base/60 z-10 text-[9px]">{rIdx + 1}</td>
                {row.map((c) => {
                  const isSel = isCellSelected(sel, c)
                  const display = c.text.slice(0, 12)
                  return (
                    <td key={c.col}
                      onClick={(e) => setSel(e.shiftKey && sel
                        ? rangeSelection(sel.anchor, { row: c.row, col: c.col })
                        : singleCellSelection({ row: c.row, col: c.col }))}
                      className={[
                        "px-1 py-0.5 cursor-pointer truncate max-w-[5rem]",
                        isSel ? "bg-accent/30 text-slate-100 ring-1 ring-accent" : "hover:bg-white/5 text-slate-300",
                        c.merge.is_spanned ? "opacity-30" : "",
                      ].join(" ")}
                      style={{
                        color: c.font_color || undefined,
                        background: isSel ? undefined : (c.fill_color || undefined),
                      }}
                    >
                      {display || <span className="text-muted/30">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!cell && (
        <div className="text-[11px] text-muted/60 italic p-2">Click a cell above to edit it.</div>
      )}

      {cell && (
        <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1.5">
          <div className="text-[10px] text-muted">
            {cellsInSelection(sel).length > 1 ? `Formatting ${label}` : `Editing ${label}`}
          </div>

          <FieldRow label="Text">
            <textarea
              defaultValue={cell.text}
              rows={2}
              onBlur={(e) => updatePrimaryCell({ text: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur() }}
              className="w-full text-[11px] bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-accent resize-none"
            />
          </FieldRow>

          <FieldRow label="Font size">
            <NumBox value={cell.font_size} onChange={(v) => updateCell({ font_size: v })} step={0.5} />
          </FieldRow>

          <FieldRow label="Bold">
            <Toggle on={!!cell.font_bold} onChange={(v) => updateCell({ font_bold: v })} />
          </FieldRow>

          <FieldRow label="Italic">
            <Toggle on={!!cell.font_italic} onChange={(v) => updateCell({ font_italic: v })} />
          </FieldRow>

          <FieldRow label="Text color">
            <ColorBox value={cell.font_color} onChange={(c) => updateCell({ font_color: c })} allowClear />
          </FieldRow>

          <FieldRow label="Fill color">
            <ColorBox value={cell.fill_color} onChange={(c) => updateCell({ fill_color: c })} allowClear />
          </FieldRow>

          <FieldRow label="H align">
            <Selector value={cell.h_align as string} onChange={(v) => updateCell({ h_align: v })} options={H_ALIGN_OPTS} />
          </FieldRow>

          <FieldRow label="V align">
            <Selector value={cell.v_align as string} onChange={(v) => updateCell({ v_align: v })} options={V_ALIGN_OPTS} />
          </FieldRow>

          <FieldRow label="Wrap">
            <Toggle on={cell.word_wrap !== false} onChange={(v) => updateCell({ word_wrap: v })} />
          </FieldRow>
        </div>
      )}
    </div>
  )
}

// ── Layout tab: insert/delete rows/cols, dimensions ──────────────────────────

function LayoutTab({ data, sel, patch }: {
  data: TableData
  sel: CellRangeSelection | null
  patch: (u: TableDataUpdate) => void
}) {
  const active = primaryCell(sel)
  const r = active?.row ?? 0
  const c = active?.col ?? 0
  return (
    <div className="space-y-2">
      <SectionHead title="Rows / Columns" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1.5">
        <div className="text-[10px] text-muted">{data.rows} rows × {data.cols} cols{sel ? ` · selected R${r+1}C${c+1}` : ""}</div>
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          <button onClick={() => patch({ op: "insert_row", index: r })}
            className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge">
            ↑ Row above
          </button>
          <button onClick={() => patch({ op: "insert_row", index: r + 1 })}
            className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge">
            ↓ Row below
          </button>
          <button onClick={() => patch({ op: "insert_col", index: c })}
            className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge">
            ← Col left
          </button>
          <button onClick={() => patch({ op: "insert_col", index: c + 1 })}
            className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge">
            → Col right
          </button>
          <button onClick={() => patch({ op: "delete_row", index: r })}
            className="text-[10px] py-1 rounded bg-bad/10 hover:bg-bad/20 text-bad/80 hover:text-bad border border-bad/30">
            ✕ Delete row
          </button>
          <button onClick={() => patch({ op: "delete_col", index: c })}
            className="text-[10px] py-1 rounded bg-bad/10 hover:bg-bad/20 text-bad/80 hover:text-bad border border-bad/30">
            ✕ Delete col
          </button>
        </div>
      </div>

      <SectionHead title="Column widths (in)" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        {data.column_widths.map((w, i) => (
          <FieldRow key={i} label={`Col ${i + 1}`}>
            <NumBox value={w} step={0.1} onChange={(v) => {
              const next = [...data.column_widths]
              next[i] = v ?? 0
              patch({ column_widths: next })
            }} />
          </FieldRow>
        ))}
      </div>

      <SectionHead title="Row heights (in)" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        {data.row_heights.map((h, i) => (
          <FieldRow key={i} label={`Row ${i + 1}`}>
            <NumBox value={h} step={0.05} onChange={(v) => {
              const next = [...data.row_heights]
              next[i] = v ?? 0
              patch({ row_heights: next })
            }} />
          </FieldRow>
        ))}
      </div>
    </div>
  )
}

// ── Borders tab: edit border on selected cell, plus apply-to-table tools ──────

function BordersTab({ data, sel, patch }: {
  data: TableData
  sel: CellRangeSelection | null
  patch: (u: TableDataUpdate) => void
}) {
  const active = primaryCell(sel)
  const cell = active ? data.cells[active.row]?.[active.col] ?? null : null
  const updateBorder = (side: "top" | "bottom" | "left" | "right", fields: Partial<{ visible: boolean; width: number | null; color: string | null; style: string }>) => {
    if (!sel || !cell) return
    patch({ cells: cellsInSelection(sel).map((coord) => {
      const target = data.cells[coord.row]?.[coord.col] ?? cell
      const existing = target.borders[side]
      const merged = {
        visible: existing?.visible ?? true,
        width:   existing?.width ?? 1.0,
        color:   existing?.color ?? "#000000",
        style:   existing?.style ?? "solid",
        ...fields,
      }
      return { row: coord.row, col: coord.col, borders: { ...target.borders, [side]: merged } } as any
    }) })
  }
  const applyAllSides = (fields: Partial<{ visible: boolean; width: number | null; color: string | null; style: string }>) => {
    if (!sel || !cell) return
    patch({ cells: cellsInSelection(sel).map((coord) => {
      const target = data.cells[coord.row]?.[coord.col] ?? cell
      const next: any = {}
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const existing = target.borders[side]
        next[side] = {
          visible: existing?.visible ?? true,
          width:   existing?.width ?? 1.0,
          color:   existing?.color ?? "#000000",
          style:   existing?.style ?? "solid",
          ...fields,
        }
      }
      return { row: coord.row, col: coord.col, borders: next } as any
    }) })
  }
  const applyTableBorders = (fields: { color: string | null; width: number | null; style: string }) => {
    // apply to outer perimeter of all cells
    const cells: any[] = []
    for (let r = 0; r < data.rows; r++) {
      for (let c = 0; c < data.cols; c++) {
        const ex = data.cells[r][c].borders
        const next: any = { ...ex }
        const make = () => ({ visible: true, ...fields })
        if (r === 0)             next.top    = make()
        if (r === data.rows - 1) next.bottom = make()
        if (c === 0)             next.left   = make()
        if (c === data.cols - 1) next.right  = make()
        cells.push({ row: r, col: c, borders: next })
      }
    }
    patch({ cells })
  }

  if (!cell) {
    return (
      <div className="space-y-2">
        <SectionHead title="Borders" />
        <div className="text-[11px] text-muted italic p-2">Click a cell to edit its borders.</div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <SectionHead title={`Borders · R${sel!.row + 1}C${sel!.col + 1}`} />
      {(["top", "bottom", "left", "right"] as const).map((side) => {
        const b = cell.borders[side]
        return (
          <div key={side} className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 capitalize">{side}</span>
              <Toggle on={!!b?.visible} onChange={(v) => updateBorder(side, { visible: v })} />
            </div>
            {b?.visible && (
              <>
                <FieldRow label="Color">
                  <ColorBox value={b?.color ?? "#000000"} onChange={(c) => updateBorder(side, { color: c })} />
                </FieldRow>
                <FieldRow label="Width">
                  <NumBox value={b?.width} onChange={(v) => updateBorder(side, { width: v })} step={0.25} />
                </FieldRow>
                <FieldRow label="Style">
                  <Selector value={b?.style ?? "solid"} onChange={(v) => updateBorder(side, { style: v })} options={BORDER_STYLE_OPTS as any} />
                </FieldRow>
              </>
            )}
          </div>
        )
      })}

      <SectionHead title="Quick" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => applyAllSides({ visible: true, color: "#000000", width: 1.0, style: "solid" })}
          className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
        >Box this cell</button>
        <button
          onClick={() => applyAllSides({ visible: false })}
          className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
        >Clear cell borders</button>
        <button
          onClick={() => applyTableBorders({ color: "#000000", width: 1.0, style: "solid" })}
          className="text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge col-span-2"
        >Outer border for table</button>
      </div>
    </div>
  )
}

// ── Style tab: table-wide flags + bulk fills/fonts ────────────────────────────

function StyleTab({ data, patch }: { data: TableData; patch: (u: TableDataUpdate) => void }) {
  const props = data.properties
  const updateProps = (u: Partial<typeof props>) => patch({ properties: u })

  const applyAllCells = (fields: Partial<TableCellEditor>) => {
    const cells: any[] = []
    for (let r = 0; r < data.rows; r++) {
      for (let c = 0; c < data.cols; c++) {
        cells.push({ row: r, col: c, ...fields })
      }
    }
    patch({ cells })
  }

  return (
    <div className="space-y-2">
      <SectionHead title="Header / Total" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        <FieldRow label="First row hdr">
          <Toggle on={props.first_row_header} onChange={(v) => updateProps({ first_row_header: v })} />
        </FieldRow>
        <FieldRow label="First col hdr">
          <Toggle on={props.first_col_header} onChange={(v) => updateProps({ first_col_header: v })} />
        </FieldRow>
        <FieldRow label="Last row tot">
          <Toggle on={props.last_row_total} onChange={(v) => updateProps({ last_row_total: v })} />
        </FieldRow>
        <FieldRow label="Last col tot">
          <Toggle on={props.last_col_total} onChange={(v) => updateProps({ last_col_total: v })} />
        </FieldRow>
      </div>

      <SectionHead title="Banding" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
        <FieldRow label="Banded rows">
          <Toggle on={props.banded_rows} onChange={(v) => updateProps({ banded_rows: v })} />
        </FieldRow>
        <FieldRow label="Banded cols">
          <Toggle on={props.banded_cols} onChange={(v) => updateProps({ banded_cols: v })} />
        </FieldRow>
      </div>

      <SectionHead title="Apply to all cells" />
      <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1.5">
        <div className="text-[10px] text-muted/70">Bulk operations on every cell in the table.</div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted w-20 shrink-0">Fill all</span>
          <ColorBox value={null} onChange={(c) => applyAllCells({ fill_color: c })} allowClear />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted w-20 shrink-0">Text all</span>
          <ColorBox value={null} onChange={(c) => applyAllCells({ font_color: c })} allowClear />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted w-20 shrink-0">Size all</span>
          <NumBox value={null} placeholder={`${data.defaults.font_size ?? 11}pt`} step={0.5} onChange={(v) => applyAllCells({ font_size: v })} />
        </div>
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

export default function TableEditorPanel({ docId, slideN, elementId, onCommit }: Props) {
  const [data, setData]     = useState<TableData | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [subTab, setSubTab] = useState<SubTab>("cells")
  const [sel, setSel]       = useState<CellRangeSelection | null>(null)

  const pendingRef = useRef<TableDataUpdate | null>(null)
  const flushTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null); setData(null); setSel(null)
    studioStore.loadTablePayload(docId, slideN, elementId)
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
      const fresh = await commitTableData(elementId, update)
      if (!fresh) return
      setData(fresh)
      // clamp selection to new dimensions
      setSel((s) => {
        if (!s) return null
        const clamp = (cell: CellCoord): CellCoord => ({
          row: Math.max(0, Math.min(cell.row, fresh.rows - 1)),
          col: Math.max(0, Math.min(cell.col, fresh.cols - 1)),
        })
        return rangeSelection(clamp(s.anchor), clamp(s.focus))
      })
      onCommit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [elementId, onCommit])

  // For structural ops (insert/delete) we flush immediately; for cell edits we debounce
  const patch = useCallback((update: TableDataUpdate) => {
    const isStructural = !!update.op
    pendingRef.current = { ...(pendingRef.current ?? {}), ...update }
    if (isStructural) {
      // structural changes shift indices — flush now and skip optimistic merge
      flush()
      return
    }
    // optimistic merge of cell-level updates into local state
    setData((prev) => {
      if (!prev) return prev
      let next = prev
      if (update.cells) {
        const newCells = prev.cells.map((row) => row.slice())
        for (const cd of update.cells) {
          if (cd.row >= 0 && cd.row < newCells.length && cd.col >= 0 && cd.col < newCells[cd.row].length) {
            const existing = newCells[cd.row][cd.col]
            newCells[cd.row][cd.col] = {
              ...existing,
              ...cd,
              borders: cd.borders ?? existing.borders,
              merge: cd.merge ?? existing.merge,
            }
          }
        }
        next = { ...next, cells: newCells }
      }
      if (update.column_widths) next = { ...next, column_widths: update.column_widths }
      if (update.row_heights)   next = { ...next, row_heights:   update.row_heights }
      if (update.properties)    next = { ...next, properties: { ...next.properties, ...update.properties } }
      return next
    })
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = window.setTimeout(() => { flush() }, 200)
  }, [flush])

  useEffect(() => {
    return () => { if (pendingRef.current) flush() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="p-3 text-[11px] text-bad bg-bad/5 border border-bad/30 rounded m-2">Table load failed: {error}</div>
  if (!data) return <div className="p-3 text-[11px] text-muted">Loading table…</div>

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex shrink-0 border-b border-edge/60 px-2 pt-1.5 gap-0.5 bg-base/30">
        {(["cells", "layout", "borders", "style"] as SubTab[]).map((t) => (
          <button key={t} onClick={() => setSubTab(t)}
            className={[
              "px-2 py-1 text-[10px] capitalize rounded-t transition-colors",
              subTab === t ? "bg-surface text-slate-200 border-t border-l border-r border-edge" : "text-muted hover:text-slate-300",
            ].join(" ")}>
            {t}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[9px] text-muted/60 self-center pr-1">{saving ? "saving…" : ""}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-thin">
        {subTab === "cells"   && <CellsTab   data={data} sel={sel} setSel={setSel} patch={patch} />}
        {subTab === "layout"  && <LayoutTab  data={data} sel={sel} patch={patch} />}
        {subTab === "borders" && <BordersTab data={data} sel={sel} patch={patch} />}
        {subTab === "style"   && <StyleTab   data={data} patch={patch} />}
      </div>
    </div>
  )
}
