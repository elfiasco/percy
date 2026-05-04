import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import { exportPptxUrl, exportPdfUrl, exportPngZipUrl } from "../../lib/studioApi"

const MULTI_ALIGN_BUTTONS = [
  { title: "Align left edges",          symbol: "⫷L", alignment: "left" },
  { title: "Center horizontally",       symbol: "⫷C", alignment: "center" },
  { title: "Align right edges",         symbol: "⫷R", alignment: "right" },
  { title: "Align top edges",           symbol: "⫸T", alignment: "top" },
  { title: "Center vertically",         symbol: "⫸M", alignment: "middle" },
  { title: "Align bottom edges",        symbol: "⫸B", alignment: "bottom" },
  { title: "Distribute horizontally",   symbol: "⇿H", alignment: "distribute_h" },
  { title: "Distribute vertically",     symbol: "⇿V", alignment: "distribute_v" },
]

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
  onInsertImage?: (file: File) => void
  onRebuild: () => void
  rebuilding: boolean
  chatOpen: boolean
  onToggleChat: () => void
  findReplaceOpen?: boolean
  onToggleFindReplace?: () => void
  onSaveToCloud?: () => void
  savingToCloud?: boolean
  undoDepth?: number
  redoDepth?: number
  onShowShortcuts?: () => void
  multiSelectIds?: Set<string>
  onAlignElements?: (alignment: string) => void
  onFormatPaint?: () => void
  formatPaintMode?: boolean
  onShowSlideSorter?: () => void
  onCopyToSlide?: (targetN: number) => void
  onApplyLayout?: (layout: string) => void
  onGroupElements?: () => void
  onUngroupElement?: () => void
  onGenerateSlide?: (prompt: string) => void
  generating?: boolean
  outlineOpen?: boolean
  onToggleOutline?: () => void
  onPresent?: () => void
}

export default function StudioToolbar({
  doc, slideN, slideWidthIn, slideHeightIn, selectedElement,
  onCommitPosition, onCommitZIndex,
  onDelete, onDuplicate, onInsertShape, onInsertImage,
  onRebuild, rebuilding,
  chatOpen, onToggleChat,
  findReplaceOpen, onToggleFindReplace,
  onSaveToCloud, savingToCloud,
  undoDepth, redoDepth,
  onShowShortcuts,
  multiSelectIds, onAlignElements,
  onFormatPaint, formatPaintMode,
  onShowSlideSorter,
  onCopyToSlide,
  onApplyLayout,
  onGroupElements,
  onUngroupElement,
  onGenerateSlide,
  generating,
  outlineOpen,
  onToggleOutline,
  onPresent,
}: Props) {
  const [insertOpen, setInsertOpen] = useState(false)
  const [copyToOpen, setCopyToOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState("")

  const LAYOUT_OPTIONS = [
    { id: "title",          label: "Title Slide" },
    { id: "title-content",  label: "Title + Content" },
    { id: "title-subtitle", label: "Title + Subtitle" },
    { id: "two-column",     label: "Two Columns" },
    { id: "three-boxes",    label: "Three Boxes" },
    { id: "section-header", label: "Section Header" },
  ]
  const imageInputRef = useRef<HTMLInputElement>(null)
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

      {/* ── multi-element alignment ───────────────────────── */}
      {multiSelectIds && multiSelectIds.size > 1 && onAlignElements && (
        <>
          <div className="w-px h-5 bg-edge mx-3 shrink-0" />
          <div className="flex items-center gap-0">
            <span className="text-[10px] text-indigo-300 mr-1.5">Multi</span>
            {MULTI_ALIGN_BUTTONS.map(({ title, symbol, alignment }) => (
              <button
                key={alignment}
                title={title}
                onClick={() => onAlignElements(alignment)}
                className="w-5 h-6 flex items-center justify-center text-[9px] text-muted
                           hover:text-indigo-300 hover:bg-indigo-500/10 rounded transition-colors font-mono"
              >
                {symbol.replace(/[⫷⫸⇿]/, "")}
              </button>
            ))}
            {onGroupElements && (
              <button
                title="Group selected elements (Ctrl+G won't conflict — this is a button)"
                onClick={onGroupElements}
                className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/40
                           text-indigo-300 hover:bg-indigo-500/20 transition-colors"
              >
                ⊞ Group
              </button>
            )}
          </div>
        </>
      )}
      {selectedElement?.type === "BridgeGroup" && onUngroupElement && (
        <>
          <div className="w-px h-5 bg-edge mx-3 shrink-0" />
          <button
            title="Ungroup — restore children to slide"
            onClick={onUngroupElement}
            className="text-[10px] px-1.5 py-0.5 rounded border border-edge text-muted hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            ⊟ Ungroup
          </button>
        </>
      )}

      <div className="w-px h-5 bg-edge mx-3 shrink-0" />

      {/* ── element actions ───────────────────────────────── */}
      <div className={`flex items-center gap-0.5 ${disabled ? "opacity-35 pointer-events-none" : ""}`}>
        {onFormatPaint && (
          <button
            title={formatPaintMode ? "Click another element to paste style" : "Format Painter — copy style to clipboard"}
            onClick={onFormatPaint}
            className={`w-6 h-6 flex items-center justify-center text-sm rounded transition-colors ${
              formatPaintMode
                ? "bg-amber-500/30 text-amber-300 ring-1 ring-amber-400"
                : "text-muted hover:text-slate-200 hover:bg-white/10"
            }`}
          >🖌</button>
        )}
        <button
          title="Duplicate element (Ctrl+D)"
          onClick={onDuplicate}
          className="w-6 h-6 flex items-center justify-center text-sm text-muted
                     hover:text-slate-200 hover:bg-white/10 rounded transition-colors"
        >⧉</button>
        {onCopyToSlide && (
          <div className="relative">
            <button
              title="Copy element to another slide"
              onClick={() => setCopyToOpen((o) => !o)}
              className="w-6 h-6 flex items-center justify-center text-sm text-muted
                         hover:text-slate-200 hover:bg-white/10 rounded transition-colors"
            >⤵</button>
            {copyToOpen && (
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setCopyToOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[110px] max-h-48 overflow-y-auto scrollbar-thin">
                  <div className="px-3 py-0.5 text-[10px] text-muted uppercase tracking-wide border-b border-edge mb-1">Copy to slide</div>
                  {Array.from({ length: doc.slide_count }, (_, i) => i + 1)
                    .filter((n) => n !== slideN)
                    .map((n) => (
                      <button
                        key={n}
                        onClick={() => { onCopyToSlide(n); setCopyToOpen(false) }}
                        className="w-full text-left px-3 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        Slide {n}
                      </button>
                    ))
                  }
                </div>
              </>
            )}
          </div>
        )}
        <button
          title="Delete element (Delete key)"
          onClick={onDelete}
          className="w-6 h-6 flex items-center justify-center text-sm text-muted
                     hover:text-bad hover:bg-bad/10 rounded transition-colors"
        >✕</button>
      </div>

      {/* ── spacer ────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── layout presets ────────────────────────────────── */}
      {onApplyLayout && (
        <div className="relative mr-2">
          <button
            onClick={() => setLayoutOpen((o) => !o)}
            title="Apply a slide layout preset"
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded
                       bg-white/5 text-muted hover:text-slate-200 border border-edge hover:bg-white/10
                       transition-colors"
          >
            ⊟ Layout ▾
          </button>
          {layoutOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[160px]"
              onMouseLeave={() => setLayoutOpen(false)}
            >
              <div className="px-3 py-0.5 text-[10px] text-muted uppercase tracking-wide border-b border-edge mb-1">Insert layout</div>
              {LAYOUT_OPTIONS.map((lo) => (
                <button
                  key={lo.id}
                  onClick={() => { setLayoutOpen(false); onApplyLayout(lo.id) }}
                  className="w-full text-left px-3 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
                >
                  {lo.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── insert shape ──────────────────────────────────── */}
      <div className="relative mr-2">
        <button
          onClick={() => setInsertOpen((o) => !o)}
          title="Insert a new shape or image"
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
            {onInsertImage && (
              <>
                <button
                  onClick={() => { setInsertOpen(false); imageInputRef.current?.click() }}
                  className="w-full text-left px-3 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
                >
                  🖼 Image…
                </button>
                <div className="border-t border-edge/50 my-1" />
              </>
            )}
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
        {/* hidden file input for image insertion */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file && onInsertImage) { onInsertImage(file) }
            e.target.value = ""
          }}
        />
      </div>

      {/* ── undo/redo depth indicator ─────────────────────── */}
      {(undoDepth !== undefined || redoDepth !== undefined) && (
        <div className="flex items-center gap-1 text-[10px] text-muted/60 mr-2 shrink-0">
          <span title={`Undo stack: ${undoDepth ?? 0} steps`}>↩{undoDepth ?? 0}</span>
          <span title={`Redo stack: ${redoDepth ?? 0} steps`}>↪{redoDepth ?? 0}</span>
        </div>
      )}

      {/* ── keyboard hint ─────────────────────────────────── */}
      <div className="text-[10px] text-muted/50 hidden xl:block mr-3">
        ↑↓←→ nudge · Shift×10 · Del delete · Ctrl+A all · Tab cycle · Ctrl+C/V copy/paste · Ctrl+D dup · Ctrl+Z/Y undo · Ctrl+S rebuild · Ctrl+H find · G grid · S snap · Esc deselect
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

        <a
          href={exportPdfUrl(doc.doc_id)}
          download
          title="Export all slides as PDF (uses rendered PNGs)"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/25
                     transition-colors no-underline"
        >
          ↓ PDF
        </a>

        <a
          href={exportPngZipUrl(doc.doc_id)}
          download
          title="Download all slides as PNGs in a ZIP archive"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 border border-teal-500/25
                     transition-colors no-underline"
        >
          ↓ ZIP
        </a>

        <a
          href={`/api/docs/${doc.doc_id}/slides/${slideN}/bridge.png`}
          download={`${docName}-slide${slideN}.png`}
          title="Download current slide as PNG"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/25
                     transition-colors no-underline"
        >
          ↓ PNG
        </a>

        {onToggleFindReplace && (
          <button
            onClick={onToggleFindReplace}
            title="Find & Replace text across slides (Ctrl+H)"
            className={`flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors ${
              findReplaceOpen
                ? "bg-amber-500/30 text-amber-300 border-amber-500/40 hover:bg-amber-500/40"
                : "bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
            }`}
          >
            ⌕ Find
          </button>
        )}

        {onGenerateSlide && (
          <div className="relative">
            <button
              onClick={() => setGenerateOpen((o) => !o)}
              disabled={generating}
              title="AI: Generate slide content from a prompt"
              className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
                generateOpen
                  ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/40"
                  : "bg-white/5 text-muted hover:text-emerald-300 border-edge hover:bg-emerald-500/10"
              } disabled:opacity-50`}
            >
              {generating && <span className="inline-block w-2.5 h-2.5 border border-emerald-300 border-t-transparent rounded-full animate-spin" />}
              ✨ AI Gen
            </button>
            {generateOpen && (
              <div className="absolute right-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded-lg shadow-xl p-3 w-72">
                <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">Generate slide from prompt</div>
                <input
                  autoFocus
                  className="w-full text-xs bg-black/30 border border-edge rounded px-2 py-1.5 text-slate-200
                             focus:outline-none focus:border-emerald-500/60 mb-2"
                  placeholder="e.g. 'Q3 sales results with key metrics'"
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && generatePrompt.trim()) {
                      onGenerateSlide(generatePrompt.trim())
                      setGenerateOpen(false)
                      setGeneratePrompt("")
                    }
                    if (e.key === "Escape") setGenerateOpen(false)
                  }}
                />
                <button
                  onClick={() => {
                    if (generatePrompt.trim()) {
                      onGenerateSlide(generatePrompt.trim())
                      setGenerateOpen(false)
                      setGeneratePrompt("")
                    }
                  }}
                  disabled={!generatePrompt.trim()}
                  className="w-full text-xs py-1.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30
                             hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                >
                  Generate ↵
                </button>
              </div>
            )}
          </div>
        )}

        {onPresent && (
          <button
            onClick={onPresent}
            title="Present slideshow (fullscreen)"
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors
                       bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border-violet-500/25"
          >
            ▶ Present
          </button>
        )}

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

        {onSaveToCloud && (
          <button
            onClick={onSaveToCloud}
            disabled={savingToCloud}
            title="Save current Bridge edits back to S3 cloud bundle"
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors
                       bg-sky-500/20 text-sky-300 border-sky-500/30 hover:bg-sky-500/30
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingToCloud && (
              <span className="inline-block w-2.5 h-2.5 border border-sky-300 border-t-transparent rounded-full animate-spin" />
            )}
            ↑ Cloud
          </button>
        )}

        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            title="Toggle outline panel"
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors ${
              outlineOpen
                ? "border-accent/50 text-accent bg-accent/10"
                : "border-edge text-muted hover:text-slate-200 hover:bg-white/10"
            }`}
          >
            ≡
          </button>
        )}

        {onShowSlideSorter && (
          <button
            onClick={onShowSlideSorter}
            title="Slide sorter grid view (Ctrl+G)"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            ⊞
          </button>
        )}

        {onShowShortcuts && (
          <button
            onClick={onShowShortcuts}
            title="Keyboard shortcuts (?)"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            ?
          </button>
        )}
      </div>
    </div>
  )
}
