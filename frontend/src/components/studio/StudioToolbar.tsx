import { useState, useEffect, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import { exportPptxUrl } from "../../lib/studioApi"

// ── single labelled number input ──────────────────────────────────────────────
function PosInput({
  label, value, disabled, onChange, onCommit,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (v: string) => void
  onCommit: () => void
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] text-muted w-3 shrink-0 select-none">{label}</span>
      <input
        type="number"
        step="0.001"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        className="w-[4.5rem] text-xs font-mono bg-base border border-edge rounded px-1.5 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent
                   disabled:opacity-35 disabled:cursor-default
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}

const ARRANGE_BUTTONS = [
  { title: "Bring to Front", symbol: "⤒", action: "front" as const },
  { title: "Bring Forward",  symbol: "↑", action: "forward" as const },
  { title: "Send Backward",  symbol: "↓", action: "backward" as const },
  { title: "Send to Back",   symbol: "⤓", action: "back" as const },
]

const ALIGN_BUTTONS = [
  { title: "Align Left",           symbol: "⫿L", dx: (_el: StudioElement) => 0 },
  { title: "Center Horizontally",  symbol: "⫿C", dx: (el: StudioElement, sw: number) => (sw - el.width_in) / 2 },
  { title: "Align Right",          symbol: "⫿R", dx: (el: StudioElement, sw: number) => sw - el.width_in },
  { title: "Align Top",            symbol: "⫿T", dy: (_el: StudioElement) => 0 },
  { title: "Center Vertically",    symbol: "⫿M", dy: (el: StudioElement, _: number, sh: number) => (sh - el.height_in) / 2 },
  { title: "Align Bottom",         symbol: "⫿B", dy: (el: StudioElement, _: number, sh: number) => sh - el.height_in },
] as Array<{
  title: string; symbol: string
  dx?: (el: StudioElement, sw: number, sh: number) => number
  dy?: (el: StudioElement, sw: number, sh: number) => number
}>

const INSERT_SHAPES = [
  { label: "Text Box",       value: "text_box" },
  { label: "—",              value: "" },
  { label: "Rectangle",      value: "rect" },
  { label: "Rounded Rect",   value: "roundRect" },
  { label: "Ellipse",        value: "ellipse" },
  { label: "Triangle",       value: "triangle" },
  { label: "Right Triangle", value: "rtTriangle" },
  { label: "Diamond",        value: "diamond" },
  { label: "Pentagon",       value: "pentagon" },
  { label: "Hexagon",        value: "hexagon" },
  { label: "Star 5pt",       value: "star5" },
  { label: "Arrow Right",    value: "rightArrow" },
  { label: "Arrow Left",     value: "leftArrow" },
  { label: "Banner",         value: "ribbon" },
]

interface Props {
  doc: DocInfo
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
  selectedElement: StudioElement | null
  onCommitPosition: (leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  onCommitZIndex: (zIndex: number) => void
  onDelete: () => void
  onDuplicate: () => void
  onInsertShape: (shapeType: string) => void
  onRebuild: () => void
  rebuilding: boolean
  chatOpen: boolean
  onToggleChat: () => void
}

export default function StudioToolbar({
  doc, slideN, slideWidthIn, slideHeightIn, selectedElement,
  onCommitPosition, onCommitZIndex,
  onDelete, onDuplicate, onInsertShape,
  onRebuild, rebuilding,
  chatOpen, onToggleChat,
}: Props) {
  const [insertOpen, setInsertOpen] = useState(false)
  const [x, setX] = useState("")
  const [y, setY] = useState("")
  const [w, setW] = useState("")
  const [h, setH] = useState("")

  // sync inputs whenever a different element is selected (or after a commit)
  useEffect(() => {
    if (selectedElement) {
      setX(selectedElement.left_in.toFixed(3))
      setY(selectedElement.top_in.toFixed(3))
      setW(selectedElement.width_in.toFixed(3))
      setH(selectedElement.height_in.toFixed(3))
    } else {
      setX(""); setY(""); setW(""); setH("")
    }
  }, [selectedElement])

  const commitAll = useCallback(() => {
    if (!selectedElement) return
    const lx = parseFloat(x), ly = parseFloat(y)
    const lw = parseFloat(w), lh = parseFloat(h)
    if ([lx, ly, lw, lh].some(isNaN)) return
    onCommitPosition(lx, ly, lw, lh)
  }, [x, y, w, h, selectedElement, onCommitPosition])

  const handleArrange = useCallback((action: "front" | "forward" | "backward" | "back") => {
    if (!selectedElement) return
    const z = selectedElement.z_index
    const next =
      action === "front"   ? 9999 :
      action === "forward" ? z + 1 :
      action === "backward"? Math.max(1, z - 1) :
                             1
    onCommitZIndex(next)
  }, [selectedElement, onCommitZIndex])

  const handleAlign = useCallback((btn: typeof ALIGN_BUTTONS[number]) => {
    if (!selectedElement) return
    const newX = btn.dx ? btn.dx(selectedElement, slideWidthIn, slideHeightIn) : selectedElement.left_in
    const newY = btn.dy ? btn.dy(selectedElement, slideWidthIn, slideHeightIn) : selectedElement.top_in
    onCommitPosition(newX, newY, selectedElement.width_in, selectedElement.height_in)
  }, [selectedElement, slideWidthIn, slideHeightIn, onCommitPosition])

  const disabled = !selectedElement
  const docName  = doc.name.replace(/\.pptx$/i, "")

  return (
    <div className="h-10 shrink-0 flex items-center gap-0 px-3 border-b border-edge bg-surface select-none overflow-x-auto scrollbar-none">

      {/* ── doc / slide info ─────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs min-w-0 shrink-0 pr-3">
        <span className="text-[10px] font-bold text-accent uppercase tracking-widest">Studio</span>
        <span className="text-edge">|</span>
        <span className="text-slate-300 truncate max-w-[10rem]" title={doc.name}>{docName}</span>
        <span className="text-muted">·</span>
        <span className="text-muted whitespace-nowrap">Slide {slideN} / {doc.slide_count}</span>
      </div>

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── position inputs ───────────────────────────────── */}
      <div className="flex items-center gap-2">
        <PosInput label="X" value={x} disabled={disabled} onChange={setX} onCommit={commitAll} />
        <PosInput label="Y" value={y} disabled={disabled} onChange={setY} onCommit={commitAll} />
        <PosInput label="W" value={w} disabled={disabled} onChange={setW} onCommit={commitAll} />
        <PosInput label="H" value={h} disabled={disabled} onChange={setH} onCommit={commitAll} />
        <span className={`text-[10px] text-muted ml-0.5 ${disabled ? "opacity-35" : ""}`}>in</span>
      </div>

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── z-order / arrange ─────────────────────────────── */}
      <div className={`flex items-center gap-0.5 ${disabled ? "opacity-35 pointer-events-none" : ""}`}>
        <span className="text-[10px] text-muted mr-1.5">Layer</span>
        {ARRANGE_BUTTONS.map(({ title, symbol, action }) => (
          <button
            key={action}
            title={title}
            onClick={() => handleArrange(action)}
            className="w-6 h-6 flex items-center justify-center text-sm text-muted
                       hover:text-slate-200 hover:bg-white/10 rounded transition-colors"
          >
            {symbol}
          </button>
        ))}
        {selectedElement && (
          <span className="ml-1 text-[10px] text-muted font-mono">z={selectedElement.z_index}</span>
        )}
      </div>

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── align to slide ────────────────────────────────── */}
      <div className={`flex items-center gap-0 ${disabled ? "opacity-35 pointer-events-none" : ""}`}>
        <span className="text-[10px] text-muted mr-1.5">Align</span>
        {ALIGN_BUTTONS.map((btn) => (
          <button
            key={btn.title}
            title={`${btn.title} (relative to slide)`}
            onClick={() => handleAlign(btn)}
            className="w-5 h-6 flex items-center justify-center text-[10px] text-muted
                       hover:text-slate-200 hover:bg-white/10 rounded transition-colors font-mono"
          >
            {btn.symbol.replace("⫿", "")}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── element actions ───────────────────────────────── */}
      <div className={`flex items-center gap-0.5 ${disabled ? "opacity-35 pointer-events-none" : ""}`}>
        <button
          title="Duplicate element (Ctrl+D)"
          onClick={onDuplicate}
          className="w-6 h-6 flex items-center justify-center text-sm text-muted
                     hover:text-slate-200 hover:bg-white/10 rounded transition-colors"
        >⧉</button>
        <button
          title="Delete element (Delete key)"
          onClick={onDelete}
          className="w-6 h-6 flex items-center justify-center text-sm text-muted
                     hover:text-bad hover:bg-bad/10 rounded transition-colors"
        >✕</button>
      </div>

      {/* ── spacer ────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── insert shape ──────────────────────────────────── */}
      <div className="relative mr-2">
        <button
          onClick={() => setInsertOpen((o) => !o)}
          title="Insert a new shape"
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded
                     bg-white/5 text-muted hover:text-slate-200 border border-edge hover:bg-white/10
                     transition-colors"
        >
          + Insert ▾
        </button>
        {insertOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[150px]"
            onMouseLeave={() => setInsertOpen(false)}
          >
            {INSERT_SHAPES.map((s, i) => s.value === "" ? (
              <div key={i} className="border-t border-edge/50 my-1" />
            ) : (
              <button
                key={s.value}
                onClick={() => { setInsertOpen(false); onInsertShape(s.value) }}
                className="w-full text-left px-3 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── keyboard hint ─────────────────────────────────── */}
      <div className="text-[10px] text-muted/50 hidden xl:block mr-3">
        ↑↓←→ nudge · Shift×10 · Del delete · Ctrl+D dup · Ctrl+Z/Y undo · Ctrl+S rebuild · Esc deselect
      </div>

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── rebuild + export ──────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onRebuild}
          disabled={rebuilding}
          title="Full rebuild via python-pptx (updates comparison view)"
          className="flex items-center gap-1.5 text-xs px-3 py-1 rounded
                     bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rebuilding && (
            <span className="inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin" />
          )}
          Rebuild
        </button>

        <a
          href={exportPptxUrl(doc.doc_id)}
          download
          title="Export current Bridge edits as .pptx download"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-good/20 text-good hover:bg-good/30 border border-good/30
                     transition-colors no-underline"
        >
          ↓ Export
        </a>

        <button
          onClick={onToggleChat}
          title={chatOpen ? "Close AI Chat" : "Open AI Chat"}
          className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
            chatOpen
              ? "bg-purple-500/30 text-purple-300 border-purple-500/40 hover:bg-purple-500/40"
              : "bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
          }`}
        >
          💬 Chat
        </button>
      </div>
    </div>
  )
}
