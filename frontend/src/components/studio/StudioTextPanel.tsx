import { useState, useEffect, useCallback, useRef } from "react"
import type {
  ElementTextContent, ParagraphsTextContent, ChartTextContent, TableTextContent,
  ParagraphData, RunData, TableCellData,
} from "../../lib/studioTypes"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchElementText, updateElementText } from "../../lib/studioApi"

// ── shared tiny components ────────────────────────────────────────────────────

function FmtBtn({
  active, title, children, onClick,
}: { active?: boolean; title: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "w-6 h-6 flex items-center justify-center text-xs rounded transition-colors select-none",
        active
          ? "bg-accent text-white"
          : "text-muted hover:text-slate-200 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function SizeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      step="0.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-12 text-xs font-mono bg-base border border-edge rounded px-1 py-0.5
                 text-slate-200 focus:outline-none focus:border-accent text-center
                 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-1.5">{children}</div>
}

function Divider() {
  return <div className="border-t border-edge my-3" />
}

// ── colour swatch ─────────────────────────────────────────────────────────────

function ColorSwatch({ color, onChange }: { color: string | null; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <button
      title="Font color"
      onClick={() => inputRef.current?.click()}
      className="w-5 h-5 rounded border border-edge overflow-hidden shrink-0"
      style={{ background: color || "#888888" }}
    >
      <input
        ref={inputRef}
        type="color"
        value={color || "#888888"}
        onChange={(e) => onChange(e.target.value)}
        className="opacity-0 w-full h-full cursor-pointer"
      />
    </button>
  )
}

// ── alignment buttons ─────────────────────────────────────────────────────────

const ALIGNS = [
  { val: "left",    sym: "≡L" },
  { val: "center",  sym: "≡C" },
  { val: "right",   sym: "≡R" },
  { val: "justify", sym: "≡J" },
] as const

function AlignButtons({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5">
      {ALIGNS.map(({ val, sym }) => (
        <FmtBtn key={val} active={value === val} title={val} onClick={() => onChange(val)}>
          {sym}
        </FmtBtn>
      ))}
    </div>
  )
}

// ── font family quick-pick ────────────────────────────────────────────────────

const COMMON_FONTS = [
  "Arial", "Arial Black", "Arial Narrow", "Calibri", "Calibri Light",
  "Cambria", "Century Gothic", "Comic Sans MS", "Courier New",
  "Franklin Gothic Medium", "Futura", "Garamond", "Georgia",
  "Gill Sans MT", "Helvetica", "Impact", "Lato", "Lucida Console",
  "Montserrat", "Open Sans", "Palatino Linotype", "Roboto",
  "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
]

function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1 min-w-0">
      <input
        list="font-list"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Font family (inherit)"
        className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent"
      />
      <datalist id="font-list">
        {COMMON_FONTS.map((f) => <option key={f} value={f} />)}
      </datalist>
    </div>
  )
}

// ── run format toolbar ────────────────────────────────────────────────────────

interface RunFmt {
  font_bold: boolean | null
  font_italic: boolean | null
  font_underline: boolean | null
  strikethrough: string | null
  font_size: string
  font_name: string
  font_color: string | null
}

function RunFormatBar({
  fmt, onChange,
}: { fmt: RunFmt; onChange: (patch: Partial<RunFmt>) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="flex gap-0.5">
        <FmtBtn active={!!fmt.font_bold}      title="Bold"          onClick={() => onChange({ font_bold:      !fmt.font_bold })}>B</FmtBtn>
        <FmtBtn active={!!fmt.font_italic}    title="Italic"        onClick={() => onChange({ font_italic:    !fmt.font_italic })}>I</FmtBtn>
        <FmtBtn active={!!fmt.font_underline} title="Underline"     onClick={() => onChange({ font_underline: !fmt.font_underline })}>U</FmtBtn>
        <FmtBtn active={!!fmt.strikethrough}  title="Strikethrough" onClick={() => onChange({ strikethrough:  fmt.strikethrough ? "" : "sng" })}>S</FmtBtn>
      </div>
      <SizeInput value={fmt.font_size} onChange={(v) => onChange({ font_size: v })} />
      <span className="text-[10px] text-muted">pt</span>
      {fmt.font_color !== undefined && (
        <ColorSwatch color={fmt.font_color} onChange={(c) => onChange({ font_color: c })} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PARAGRAPHS EDITOR  (BridgeText / BridgeShape / BridgeFreeform)
// ─────────────────────────────────────────────────────────────────────────────

function ParagraphsEditor({
  content, docId, slideN, elementId, onCommit,
}: {
  content: ParagraphsTextContent
  docId: string
  slideN: number
  elementId: string
  onCommit: (updated: ElementTextContent) => void
}) {
  const [paras, setParas] = useState<ParagraphData[]>(content.paragraphs)
  const [sel, setSel]     = useState<{ p: number; r: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // sync if element changes
  useEffect(() => { setParas(content.paragraphs); setSel(null) }, [content])

  const selectedRun: RunData | null = sel ? (paras[sel.p]?.runs[sel.r] ?? null) : null

  // ── local state helpers ──────────────────────────────────────────────────
  const patchRun = useCallback((pi: number, ri: number, patch: Partial<RunData>) => {
    setParas((prev) => prev.map((para, pi2) =>
      pi2 !== pi ? para : {
        ...para,
        runs: para.runs.map((run, ri2) => ri2 !== ri ? run : { ...run, ...patch }),
      }
    ))
  }, [])

  const patchPara = useCallback((pi: number, patch: Partial<ParagraphData>) => {
    setParas((prev) => prev.map((para, pi2) => pi2 !== pi ? para : { ...para, ...patch }))
  }, [])

  // ── commit to backend ────────────────────────────────────────────────────
  const commit = useCallback(async (updatedParas?: ParagraphData[]) => {
    const src = updatedParas ?? paras
    setSaving(true)
    try {
      const result = await updateElementText(docId, slideN, elementId, {
        kind: "paragraphs",
        paragraphs: src.map((para) => ({
          alignment:    para.alignment,
          space_before: para.space_before,
          space_after:  para.space_after,
          runs: para.runs.map((run) => ({
            text:          run.text,
            is_line_break: run.is_line_break,
            font_name:     run.font_name ?? undefined,
            font_size:     run.font_size ?? undefined,
            font_bold:     run.font_bold ?? undefined,
            font_italic:   run.font_italic ?? undefined,
            font_underline:run.font_underline ?? undefined,
            font_color:    run.font_color ?? undefined,
            strikethrough: run.strikethrough ?? undefined,
            font_caps:     run.font_caps ?? undefined,
          })),
        })),
      })
      onCommit(result)
    } catch (e) {
      console.error("text update failed:", e)
    } finally {
      setSaving(false)
    }
  }, [paras, docId, slideN, elementId, onCommit])

  // ── selected run format bar handler ─────────────────────────────────────
  const handleFmtChange = useCallback((patch: Partial<RunFmt>) => {
    if (!sel) return
    const runPatch: Partial<RunData> = {}
    if ("font_bold"      in patch) runPatch.font_bold      = patch.font_bold ?? null
    if ("font_italic"    in patch) runPatch.font_italic    = patch.font_italic ?? null
    if ("font_underline" in patch) runPatch.font_underline = patch.font_underline ?? null
    if ("strikethrough"  in patch) runPatch.strikethrough  = patch.strikethrough || null
    if ("font_size"      in patch) runPatch.font_size      = parseFloat(patch.font_size!) || null
    if ("font_color"     in patch) runPatch.font_color     = patch.font_color ?? null
    patchRun(sel.p, sel.r, runPatch)
  }, [sel, patchRun])

  const selFmt: RunFmt = selectedRun ? {
    font_bold:      selectedRun.font_bold,
    font_italic:    selectedRun.font_italic,
    font_underline: selectedRun.font_underline,
    strikethrough:  selectedRun.strikethrough,
    font_size:      String(selectedRun.font_size ?? ""),
    font_name:      selectedRun.font_name ?? "",
    font_color:     selectedRun.font_color,
  } : { font_bold: null, font_italic: null, font_underline: null, strikethrough: null, font_size: "", font_name: "", font_color: null }

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* ── format bar ── */}
      <div className="p-3 border-b border-edge shrink-0">
        <Label>Format</Label>
        <div className={`transition-opacity ${!selectedRun ? "opacity-30 pointer-events-none" : ""}`}>
          <RunFormatBar fmt={selFmt} onChange={handleFmtChange} />
          {selectedRun && (
            <div className="mt-2">
              <AlignButtons
                value={paras[sel!.p]?.alignment ?? null}
                onChange={(v) => patchPara(sel!.p, { alignment: v })}
              />
            </div>
          )}
        </div>
        {!selectedRun && (
          <p className="text-[10px] text-muted mt-1">Select a run below to format it</p>
        )}
      </div>

      {/* ── paragraph list ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {paras.length === 0 && (
          <p className="text-xs text-muted text-center mt-4">No text content</p>
        )}

        {paras.map((para, pi) => (
          <div key={pi} className="rounded border border-edge/60 bg-base/40 overflow-hidden">
            {/* paragraph header */}
            <div className="flex flex-col gap-1 px-2 py-1 bg-surface/60">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted font-mono shrink-0">¶{pi}</span>
                <AlignButtons value={para.alignment} onChange={(v) => patchPara(pi, { alignment: v })} />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted">
                <span>Before:</span>
                <input
                  type="number"
                  step="1"
                  value={para.space_before ?? ""}
                  onChange={(e) => patchPara(pi, { space_before: parseFloat(e.target.value) || null })}
                  placeholder="—"
                  className="w-10 text-xs font-mono bg-base border border-edge rounded px-1 py-px text-slate-200
                             focus:outline-none focus:border-accent [appearance:textfield]
                             [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>After:</span>
                <input
                  type="number"
                  step="1"
                  value={para.space_after ?? ""}
                  onChange={(e) => patchPara(pi, { space_after: parseFloat(e.target.value) || null })}
                  placeholder="—"
                  className="w-10 text-xs font-mono bg-base border border-edge rounded px-1 py-px text-slate-200
                             focus:outline-none focus:border-accent [appearance:textfield]
                             [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>pt</span>
              </div>
            </div>

            {/* runs */}
            <div className="p-1.5 space-y-1">
              {para.runs.length === 0 && (
                <span className="text-[10px] text-muted/60 italic px-1">empty paragraph</span>
              )}
              {para.runs.map((run, ri) => {
                if (run.is_line_break) {
                  return (
                    <div key={ri} className="text-[10px] text-muted/50 italic px-1">↵ line break</div>
                  )
                }
                const isSelected = sel?.p === pi && sel?.r === ri
                return (
                  <div
                    key={ri}
                    className={[
                      "group rounded cursor-pointer transition-colors",
                      isSelected
                        ? "bg-accent/20 ring-1 ring-accent/60"
                        : "hover:bg-white/5",
                    ].join(" ")}
                    onClick={() => setSel(isSelected ? null : { p: pi, r: ri })}
                  >
                    {isSelected ? (
                      /* ── inline edit ── */
                      <div className="p-1.5 space-y-1.5">
                        <textarea
                          autoFocus
                          value={run.text}
                          onChange={(e) => patchRun(pi, ri, { text: e.target.value })}
                          onBlur={() => commit()}
                          rows={2}
                          className="w-full text-xs bg-base border border-accent/50 rounded px-1.5 py-1
                                     text-slate-200 focus:outline-none focus:border-accent resize-none font-mono"
                        />
                        <div className="flex gap-1 items-center">
                          <span className="text-[10px] text-muted shrink-0">Font:</span>
                          <FontPicker
                            value={run.font_name ?? ""}
                            onChange={(v) => patchRun(pi, ri, { font_name: v || null })}
                          />
                          <button
                            onClick={() => commit()}
                            className="text-[10px] px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80"
                          >
                            {saving ? "…" : "Apply"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── run preview chip ── */
                      <div className="flex items-center gap-1.5 px-1.5 py-1 min-h-[24px]">
                        <span className="text-xs text-slate-300 flex-1 truncate leading-tight">
                          {run.text || <span className="text-muted/50 italic">empty</span>}
                        </span>
                        <span className="text-[10px] text-muted/70 shrink-0 font-mono hidden group-hover:block">
                          {[
                            run.font_size ? `${run.font_size}pt` : null,
                            run.font_bold ? "B" : null,
                            run.font_italic ? "I" : null,
                            run.font_underline ? "U" : null,
                          ].filter(Boolean).join(" ")}
                        </span>
                        {run.font_color && (
                          <div
                            className="w-2 h-2 rounded-full border border-edge/60 shrink-0"
                            style={{ background: run.font_color }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── footer ── */}
      <div className="p-2 border-t border-edge shrink-0 flex justify-between items-center">
        <span className="text-[10px] text-muted">
          {paras.length} para · {paras.reduce((n, p) => n + p.runs.length, 0)} runs
        </span>
        <button
          onClick={() => commit()}
          disabled={saving}
          className="text-[10px] px-2.5 py-1 rounded bg-accent/20 text-accent border border-accent/30
                     hover:bg-accent/30 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save All"}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART TEXT EDITOR
// ─────────────────────────────────────────────────────────────────────────────

function ChartField({
  label, value, fontSize, fontBold, fontItalic,
  onChangeText, onChangeFontSize, onChangeBold, onChangeFmt,
}: {
  label: string
  value: string | null
  fontSize: number | null
  fontBold: boolean | null
  fontItalic?: boolean | null
  onChangeText: (v: string) => void
  onChangeFontSize: (v: string) => void
  onChangeBold: (v: boolean) => void
  onChangeFmt?: (patch: { font_italic?: boolean }) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="(none)"
        className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent"
      />
      <div className="flex items-center gap-1.5">
        <FmtBtn active={!!fontBold}   title="Bold"   onClick={() => onChangeBold(!fontBold)}>B</FmtBtn>
        {onChangeFmt && (
          <FmtBtn active={!!fontItalic} title="Italic" onClick={() => onChangeFmt({ font_italic: !fontItalic })}>I</FmtBtn>
        )}
        <SizeInput value={String(fontSize ?? "")} onChange={onChangeFontSize} />
        <span className="text-[10px] text-muted">pt</span>
      </div>
    </div>
  )
}

function ChartTextEditor({
  content, docId, slideN, elementId, onCommit,
}: {
  content: ChartTextContent
  docId: string
  slideN: number
  elementId: string
  onCommit: (updated: ElementTextContent) => void
}) {
  const [state, setState] = useState(content)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setState(content) }, [content])

  const commit = useCallback(async (patch?: Partial<typeof state>) => {
    const s = patch ? { ...state, ...patch } : state
    setState(s)
    setSaving(true)
    try {
      const result = await updateElementText(docId, slideN, elementId, {
        kind: "chart",
        chart: {
          title_text:       s.title.text,
          title_font_size:  s.title.font_size ?? undefined,
          title_font_bold:  s.title.font_bold ?? undefined,
          title_font_italic:s.title.font_italic ?? undefined,
          title_font_name:  s.title.font_name ?? undefined,
          cat_axis_title:   s.cat_axis_title?.text ?? undefined,
          val_axis_title:   s.val_axis_title?.text ?? undefined,
          legend_font_size: s.legend?.font_size ?? undefined,
          legend_font_bold: s.legend?.font_bold ?? undefined,
        },
      })
      onCommit(result)
    } catch (e) {
      console.error("chart text update failed:", e)
    } finally {
      setSaving(false)
    }
  }, [state, docId, slideN, elementId, onCommit])

  const pTitle = (patch: Partial<typeof state.title>) =>
    setState((s) => ({ ...s, title: { ...s.title, ...patch } }))
  const pCat = (patch: Partial<NonNullable<typeof state.cat_axis_title>>) =>
    setState((s) => ({ ...s, cat_axis_title: s.cat_axis_title ? { ...s.cat_axis_title, ...patch } : null }))
  const pVal = (patch: Partial<NonNullable<typeof state.val_axis_title>>) =>
    setState((s) => ({ ...s, val_axis_title: s.val_axis_title ? { ...s.val_axis_title, ...patch } : null }))

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-4">

        <div>
          <Label>Chart Title</Label>
          <ChartField
            label="Text"
            value={state.title.text}
            fontSize={state.title.font_size}
            fontBold={state.title.font_bold}
            fontItalic={state.title.font_italic}
            onChangeText={(v) => pTitle({ text: v })}
            onChangeFontSize={(v) => pTitle({ font_size: parseFloat(v) || null })}
            onChangeBold={(v) => pTitle({ font_bold: v })}
            onChangeFmt={(p) => pTitle(p as Partial<typeof state.title>)}
          />
        </div>

        {state.cat_axis_title && (
          <>
            <Divider />
            <div>
              <Label>Category Axis</Label>
              <ChartField
                label="Title"
                value={state.cat_axis_title.text}
                fontSize={state.cat_axis_title.font_size}
                fontBold={state.cat_axis_title.font_bold}
                onChangeText={(v) => pCat({ text: v })}
                onChangeFontSize={(v) => pCat({ font_size: parseFloat(v) || null })}
                onChangeBold={(v) => pCat({ font_bold: v })}
              />
            </div>
          </>
        )}

        {state.val_axis_title && (
          <>
            <Divider />
            <div>
              <Label>Value Axis</Label>
              <ChartField
                label="Title"
                value={state.val_axis_title.text}
                fontSize={state.val_axis_title.font_size}
                fontBold={state.val_axis_title.font_bold}
                onChangeText={(v) => pVal({ text: v })}
                onChangeFontSize={(v) => pVal({ font_size: parseFloat(v) || null })}
                onChangeBold={(v) => pVal({ font_bold: v })}
              />
            </div>
          </>
        )}

        {state.legend && (
          <>
            <Divider />
            <div>
              <Label>Legend</Label>
              <div className="flex items-center gap-1.5">
                <FmtBtn active={!!state.legend.font_bold} title="Bold" onClick={() =>
                  setState((s) => ({ ...s, legend: s.legend ? { ...s.legend, font_bold: !s.legend.font_bold } : null }))
                }>B</FmtBtn>
                <SizeInput
                  value={String(state.legend.font_size ?? "")}
                  onChange={(v) =>
                    setState((s) => ({ ...s, legend: s.legend ? { ...s.legend, font_size: parseFloat(v) || null } : null }))
                  }
                />
                <span className="text-[10px] text-muted">pt</span>
              </div>
            </div>
          </>
        )}

        {state.series.length > 0 && (
          <>
            <Divider />
            <div>
              <Label>Series ({state.series.length})</Label>
              <div className="space-y-1">
                {state.series.map((s) => (
                  <div key={s.idx} className="flex items-center gap-2 text-xs">
                    <span className="text-muted font-mono w-4">{s.idx}</span>
                    <span className="text-slate-300 flex-1 truncate">{s.name ?? "(no name)"}</span>
                    {s.data_labels.show && (
                      <span className="text-[10px] px-1 rounded bg-good/20 text-good">labels on</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="p-2 border-t border-edge shrink-0 flex justify-end">
        <button
          onClick={() => commit()}
          disabled={saving}
          className="text-[10px] px-2.5 py-1 rounded bg-accent/20 text-accent border border-accent/30
                     hover:bg-accent/30 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE TEXT EDITOR
// ─────────────────────────────────────────────────────────────────────────────

function TableTextEditor({
  content, docId, slideN, elementId, onCommit,
}: {
  content: TableTextContent
  docId: string
  slideN: number
  elementId: string
  onCommit: (updated: ElementTextContent) => void
}) {
  const [selCell, setSelCell] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [cells, setCells]     = useState<TableCellData[][]>(content.cells)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { setCells(content.cells); setSelCell({ r: 0, c: 0 }) }, [content])

  const cell = cells[selCell.r]?.[selCell.c]

  const patchCell = useCallback((patch: Partial<TableCellData>) => {
    setCells((prev) => prev.map((row, ri) =>
      ri !== selCell.r ? row :
      row.map((c, ci) => ci !== selCell.c ? c : { ...c, ...patch })
    ))
  }, [selCell])

  const commit = useCallback(async () => {
    if (!cell) return
    setSaving(true)
    try {
      const result = await updateElementText(docId, slideN, elementId, {
        kind: "table_cell",
        table_cell: {
          row:        selCell.r,
          col:        selCell.c,
          text:       cell.text,
          font_bold:  cell.font_bold,
          font_italic:cell.font_italic,
          font_size:  cell.font_size,
          font_name:  cell.font_name,
        },
      })
      onCommit(result)
    } catch (e) {
      console.error("table cell update failed:", e)
    } finally {
      setSaving(false)
    }
  }, [cell, selCell, docId, slideN, elementId, onCommit])

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* cell grid */}
      <div className="p-3 border-b border-edge shrink-0">
        <Label>Select Cell</Label>
        <div
          className="inline-grid gap-px bg-edge rounded overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${content.cols}, minmax(0, 1fr))` }}
        >
          {content.cells.flat().map((c) => (
            <button
              key={`${c.row}-${c.col}`}
              onClick={() => setSelCell({ r: c.row, c: c.col })}
              title={`(${c.row}, ${c.col}) ${c.text}`}
              className={[
                "w-6 h-6 text-[8px] truncate transition-colors",
                selCell.r === c.row && selCell.c === c.col
                  ? "bg-accent text-white"
                  : "bg-surface hover:bg-white/10 text-muted",
              ].join(" ")}
            >
              {c.text ? c.text[0] : "·"}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted mt-1">
          Row {selCell.r}, Col {selCell.c}
        </div>
      </div>

      {/* cell editor */}
      {cell && (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
          <div>
            <Label>Text</Label>
            <textarea
              rows={3}
              value={cell.text}
              onChange={(e) => patchCell({ text: e.target.value })}
              onBlur={commit}
              className="w-full text-xs bg-base border border-edge rounded px-1.5 py-1
                         text-slate-200 focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <div>
            <Label>Font</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <FmtBtn active={!!cell.font_bold}   title="Bold"   onClick={() => patchCell({ font_bold:   !cell.font_bold })}>B</FmtBtn>
              <FmtBtn active={!!cell.font_italic} title="Italic" onClick={() => patchCell({ font_italic: !cell.font_italic })}>I</FmtBtn>
              <SizeInput
                value={String(cell.font_size ?? "")}
                onChange={(v) => patchCell({ font_size: parseFloat(v) || null })}
              />
              <span className="text-[10px] text-muted">pt</span>
            </div>
            <div className="mt-1.5">
              <input
                type="text"
                value={cell.font_name ?? ""}
                onChange={(e) => patchCell({ font_name: e.target.value || null })}
                placeholder="Font name (inherit)"
                className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5
                           text-slate-200 focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      )}

      <div className="p-2 border-t border-edge shrink-0 flex justify-between items-center">
        <span className="text-[10px] text-muted">{content.rows}×{content.cols} table</span>
        <button
          onClick={commit}
          disabled={saving}
          className="text-[10px] px-2.5 py-1 rounded bg-accent/20 text-accent border border-accent/30
                     hover:bg-accent/30 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const TEXT_CAPABLE = new Set(["BridgeText", "BridgeShape", "BridgeFreeform", "BridgeChart", "BridgeTable"])

interface Props {
  element: StudioElement | null
  docId: string
  slideN: number
  onCommit: () => void  // tells parent to refresh canvas
}

export default function StudioTextPanel({ element, docId, slideN, onCommit }: Props) {
  const [textContent, setTextContent] = useState<ElementTextContent | null>(null)
  const [loading, setLoading]         = useState(false)

  const hasText = element ? TEXT_CAPABLE.has(element.type) : false

  useEffect(() => {
    if (!element || !hasText) { setTextContent(null); return }
    let cancelled = false
    setLoading(true)
    fetchElementText(docId, slideN, element.id)
      .then((tc) => { if (!cancelled) { setTextContent(tc); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [element?.id, docId, slideN, hasText])

  const handleCommit = useCallback((updated: ElementTextContent) => {
    setTextContent(updated)
    onCommit()
  }, [onCommit])

  if (!element) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted text-center leading-relaxed">
          Select an element to edit its text
        </p>
      </div>
    )
  }

  if (!hasText) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted text-center leading-relaxed">
          {element.label} elements don't have editable text content
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-muted animate-pulse">Loading text…</span>
      </div>
    )
  }

  if (!textContent || textContent.kind === "none") {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted text-center">No text content on this element</p>
      </div>
    )
  }

  if (textContent.kind === "paragraphs") {
    return (
      <ParagraphsEditor
        content={textContent}
        docId={docId}
        slideN={slideN}
        elementId={element.id}
        onCommit={handleCommit}
      />
    )
  }

  if (textContent.kind === "chart") {
    return (
      <ChartTextEditor
        content={textContent}
        docId={docId}
        slideN={slideN}
        elementId={element.id}
        onCommit={handleCommit}
      />
    )
  }

  if (textContent.kind === "table") {
    return (
      <TableTextEditor
        content={textContent}
        docId={docId}
        slideN={slideN}
        elementId={element.id}
        onCommit={handleCommit}
      />
    )
  }

  return null
}
