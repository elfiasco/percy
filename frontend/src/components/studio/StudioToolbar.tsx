import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import { exportPptxUrl, exportPdfUrl, exportPngZipUrl, notesExportUrl, notesHtmlExportUrl, notesPagesPdfUrl, exportHtmlUrl, exportMarkdownUrl, exportSubsetUrl, exportScriptUrl } from "../../lib/studioApi"

const MULTI_ALIGN_BUTTONS = [
  { title: "Align left edges",          symbol: "⫷L", alignment: "left" },
  { title: "Center horizontally",       symbol: "⫷C", alignment: "center" },
  { title: "Align right edges",         symbol: "⫷R", alignment: "right" },
  { title: "Align top edges",           symbol: "⫸T", alignment: "top" },
  { title: "Center vertically",         symbol: "⫸M", alignment: "middle" },
  { title: "Align bottom edges",        symbol: "⫸B", alignment: "bottom" },
  { title: "Distribute horizontally",   symbol: "⇿H", alignment: "distribute_h" },
  { title: "Distribute vertically",     symbol: "⇿V", alignment: "distribute_v" },
  { title: "Match width (largest)",     symbol: "↔W", alignment: "match_width" },
  { title: "Match height (tallest)",    symbol: "↕H", alignment: "match_height" },
  { title: "Match width & height",      symbol: "⛶S", alignment: "match_size" },
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
  onJumpToSlide?: (n: number) => void
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
  onShowOutlineGen?: () => void
  onCopyToSlide?: (targetN: number) => void
  onApplyLayout?: (layout: string) => void
  onGroupElements?: () => void
  onUngroupElement?: () => void
  onGenerateSlide?: (prompt: string) => void
  generating?: boolean
  outlineOpen?: boolean
  onToggleOutline?: () => void
  onPresent?: () => void
  layersOpen?: boolean
  onToggleLayers?: () => void
  onRerenderAll?: () => void
  rerenderingAll?: boolean
  onColorSwap?: () => void
  onShowStats?: () => void
  onShowCheck?: () => void
  commentsOpen?: boolean
  onToggleComments?: () => void
  onImportSlides?: (file: File) => void
  onBulkFillColor?: (color: string) => void
  onGenerateNotesBulk?: () => void
  onFontSwap?: () => void
  onNotesReview?: () => void
  onTemplateVars?: () => void
  onAgendaSlide?: () => void
  onAIScore?: () => void
  colorBlindMode?: string | null
  onSetColorBlindMode?: (mode: string | null) => void
  onSlideNumbers?: () => void
  onWatermark?: () => void
  onTransitions?: () => void
  onOptimizeLayout?: (goal: "balanced" | "emphasis-title" | "compact" | "spacious") => void
  optimizingLayout?: boolean
  onCompare?: () => void
  onGrammarCheck?: () => void
  onThemeGen?: () => void
  onVariation?: () => void
  onTranslate?: () => void
}

export default function StudioToolbar({
  doc, slideN, onJumpToSlide, slideWidthIn, slideHeightIn, selectedElement,
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
  onShowOutlineGen,
  onCopyToSlide,
  onApplyLayout,
  onGroupElements,
  onUngroupElement,
  onGenerateSlide,
  generating,
  outlineOpen,
  onToggleOutline,
  onPresent,
  layersOpen,
  onToggleLayers,
  onRerenderAll,
  rerenderingAll,
  onColorSwap,
  onShowStats,
  onShowCheck,
  commentsOpen,
  onToggleComments,
  onImportSlides,
  onBulkFillColor,
  onGenerateNotesBulk,
  onFontSwap,
  onNotesReview,
  onTemplateVars,
  onAgendaSlide,
  onAIScore,
  colorBlindMode,
  onSetColorBlindMode,
  onSlideNumbers,
  onWatermark,
  onTransitions,
  onOptimizeLayout,
  optimizingLayout,
  onCompare,
  onGrammarCheck,
  onThemeGen,
  onVariation,
  onTranslate,
}: Props) {
  const importSlidesRef = useRef<HTMLInputElement>(null)
  const [jumpEditing, setJumpEditing] = useState(false)
  const [jumpVal, setJumpVal] = useState("")
  const jumpInputRef = useRef<HTMLInputElement>(null)
  const [insertOpen, setInsertOpen] = useState(false)
  const [copyToOpen, setCopyToOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [cbOpen, setCbOpen] = useState(false)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState("")

  const LAYOUT_OPTIONS = [
    { id: "title",           label: "Title Slide" },
    { id: "title-content",   label: "Title + Content" },
    { id: "title-subtitle",  label: "Title + Subtitle" },
    { id: "two-column",      label: "Two Columns" },
    { id: "three-boxes",     label: "Three Boxes" },
    { id: "section-header",  label: "Section Header" },
    { id: "big-quote",       label: "Big Quote" },
    { id: "image-text",      label: "Image + Text" },
    { id: "comparison",      label: "Comparison" },
    { id: "four-quadrants",  label: "Four Quadrants" },
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
  const modifiedAgo = doc.modified_at
    ? (() => {
        const secs = Math.floor(Date.now() / 1000 - doc.modified_at!)
        if (secs < 60) return "just now"
        if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
        if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
        return `${Math.floor(secs / 86400)}d ago`
      })()
    : null

  return (
    <div className="h-10 shrink-0 flex items-center gap-0 px-3 border-b border-edge bg-surface select-none overflow-x-auto scrollbar-none">

      {/* ── doc / slide info ─────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs min-w-0 shrink-0 pr-3">
        <span className="text-[10px] font-bold text-accent uppercase tracking-widest">Studio</span>
        <span className="text-edge">|</span>
        <span className="text-slate-300 truncate max-w-[10rem]" title={doc.name}>{docName}</span>
        <span className="text-muted">·</span>
        {jumpEditing ? (
          <input
            ref={jumpInputRef}
            type="number"
            min={1}
            max={doc.slide_count}
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(jumpVal, 10)
                if (!isNaN(n) && n >= 1 && n <= doc.slide_count) onJumpToSlide?.(n)
                setJumpEditing(false)
              }
              if (e.key === "Escape") setJumpEditing(false)
            }}
            onBlur={() => setJumpEditing(false)}
            autoFocus
            className="w-12 text-xs font-mono bg-base border border-accent rounded px-1 py-0 text-slate-200
                       focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        ) : (
          <button
            className="text-muted whitespace-nowrap hover:text-slate-200 transition-colors"
            title="Click to jump to a specific slide"
            onClick={() => { setJumpVal(String(slideN)); setJumpEditing(true) }}
          >
            Slide {slideN} / {doc.slide_count}
          </button>
        )}
        {modifiedAgo && (
          <>
            <span className="text-muted">·</span>
            <span className="text-muted/50 text-[10px] whitespace-nowrap" title={`Modified at ${new Date((doc.modified_at!) * 1000).toLocaleTimeString()}`}>
              {modifiedAgo}
            </span>
          </>
        )}
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
            <span className="text-[10px] text-paper mr-1.5">Multi</span>
            {MULTI_ALIGN_BUTTONS.map(({ title, symbol, alignment }) => (
              <button
                key={alignment}
                title={title}
                onClick={() => onAlignElements(alignment)}
                className="w-5 h-6 flex items-center justify-center text-[9px] text-muted
                           hover:text-paper hover:bg-paper/10 rounded transition-colors font-mono"
              >
                {symbol.replace(/^[⫷⫸⇿]/, "")}
              </button>
            ))}
            {onGroupElements && (
              <button
                title="Group selected elements (Ctrl+G won't conflict — this is a button)"
                onClick={onGroupElements}
                className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-paper/40
                           text-paper hover:bg-paper/20 transition-colors"
              >
                ⊞ Group
              </button>
            )}
            {onBulkFillColor && (
              <label
                title="Apply fill color to all selected elements"
                className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-edge text-muted
                           hover:bg-white/10 hover:text-slate-200 transition-colors cursor-pointer flex items-center gap-1"
              >
                ⬛ Fill
                <input
                  type="color"
                  className="w-0 h-0 opacity-0 absolute"
                  onChange={(e) => onBulkFillColor(e.target.value)}
                />
              </label>
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

        {onRerenderAll && (
          <button
            onClick={onRerenderAll}
            disabled={rerenderingAll}
            title="Re-render all slide PNGs from current Bridge model"
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded
                       bg-paper/15 text-paper hover:bg-paper/25 border border-paper/25
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rerenderingAll && (
              <span className="inline-block w-2.5 h-2.5 border border-paper border-t-transparent rounded-full animate-spin" />
            )}
            ⟳ All
          </button>
        )}

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

        <a
          href={exportHtmlUrl(doc.doc_id)}
          download
          title="Export as self-contained HTML slideshow (embeds all PNGs)"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/25
                     transition-colors no-underline"
        >
          ↓ HTML
        </a>

        <a
          href={exportSubsetUrl(doc.doc_id, [slideN])}
          download
          title={`Export slide ${slideN} as its own PPTX file`}
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 border border-teal-500/25
                     transition-colors no-underline"
        >
          ↓ Slide {slideN}
        </a>

        <a
          href={notesExportUrl(doc.doc_id)}
          download
          title="Download all speaker notes as a .txt file"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border border-slate-500/25
                     transition-colors no-underline"
        >
          ↓ Notes
        </a>

        <a
          href={notesHtmlExportUrl(doc.doc_id)}
          download
          title="Download all speaker notes as a styled HTML document"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border border-slate-500/25
                     transition-colors no-underline"
        >
          ↓ Notes (HTML)
        </a>

        <a
          href={notesPagesPdfUrl(doc.doc_id)}
          download
          title="Download notes pages PDF (slide thumbnail + speaker notes per page)"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border border-slate-500/25
                     transition-colors no-underline"
        >
          ↓ Notes (PDF)
        </a>

        <a
          href={exportMarkdownUrl(doc.doc_id)}
          download
          title="Export presentation as Markdown (titles + body + notes)"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border border-slate-500/25
                     transition-colors no-underline"
        >
          ↓ Markdown
        </a>

        <a
          href={exportScriptUrl(doc.doc_id)}
          download
          title="Download speaker script — notes with time estimates per slide"
          className="flex items-center gap-1 text-xs px-3 py-1 rounded
                     bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border border-slate-500/25
                     transition-colors no-underline"
        >
          ↓ Script
        </a>

        {onImportSlides && (
          <>
            <button
              onClick={() => importSlidesRef.current?.click()}
              title="Import slides from another PPTX — appends all slides to this document"
              className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                         bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
            >
              ↑ Import
            </button>
            <input
              ref={importSlidesRef}
              type="file"
              accept=".pptx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) { onImportSlides(f); e.target.value = "" }
              }}
            />
          </>
        )}

        {onColorSwap && (
          <button
            onClick={onColorSwap}
            title="Color Swap — replace fill/line colors across deck"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
          >
            🎨 Colors
          </button>
        )}

        {onThemeGen && (
          <button
            onClick={onThemeGen}
            title="AI Theme Generator — generate and apply a harmonious color palette"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-paper border-edge hover:bg-paper/10"
          >
            ✦ Theme
          </button>
        )}

        {onVariation && (
          <button
            onClick={onVariation}
            title="AI Slide Variations — rewrite current slide text in different tones"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-amber-300 border-edge hover:bg-amber-500/10"
          >
            ✦ Variations
          </button>
        )}

        {onTranslate && (
          <button
            onClick={onTranslate}
            title="AI Translate — translate slide text to another language"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-sky-300 border-edge hover:bg-sky-500/10"
          >
            🌐 Translate
          </button>
        )}

        {onFontSwap && (
          <button
            onClick={onFontSwap}
            title="Font Swap — replace fonts across all text in the deck"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
          >
            🔤 Fonts
          </button>
        )}

        {onNotesReview && (
          <button
            onClick={onNotesReview}
            title="Notes Review — view and edit all speaker notes in one place"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
          >
            📝 Notes
          </button>
        )}

        {onTemplateVars && (
          <button
            onClick={onTemplateVars}
            title="Template Variables — fill in {placeholder} variables across the deck"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-amber-300 border-edge hover:bg-amber-500/10"
          >
            ⚙ Variables
          </button>
        )}

        {onAgendaSlide && (
          <button
            onClick={onAgendaSlide}
            title="Insert Agenda Slide — generate a table of contents from slide titles"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-sky-300 border-edge hover:bg-sky-500/10"
          >
            ☰ Agenda
          </button>
        )}

        {onAIScore && (
          <button
            onClick={onAIScore}
            title="AI Score — get AI-powered quality feedback on your presentation"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-emerald-300 border-edge hover:bg-emerald-500/10"
          >
            ✨ AI Score
          </button>
        )}

        {onSlideNumbers && (
          <button
            onClick={onSlideNumbers}
            title="Add Slide Numbers — insert page numbers on all slides"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
          >
            # Slide #s
          </button>
        )}

        {onWatermark && (
          <button
            onClick={onWatermark}
            title="Add Watermark — stamp CONFIDENTIAL / DRAFT / etc. on all slides"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-red-300 border-edge hover:bg-red-500/10"
          >
            ⌀ Watermark
          </button>
        )}

        {onTransitions && (
          <button
            onClick={onTransitions}
            title="Slide Transitions — set animation effects between slides"
            className="flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors
                       bg-white/5 text-muted hover:text-paper border-edge hover:bg-paper/10"
          >
            ↻ Transitions
          </button>
        )}

        {onOptimizeLayout && (
          <div className="relative">
            <button
              onClick={() => setOptimizeOpen((o) => !o)}
              disabled={optimizingLayout}
              title="AI Layout Optimizer — intelligently reposition elements on this slide"
              className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
                optimizeOpen
                  ? "bg-paper/20 text-paper border-fuchsia-500/30"
                  : "bg-white/5 text-muted hover:text-paper border-edge hover:bg-paper/10"
              } disabled:opacity-50`}
            >
              {optimizingLayout && <span className="inline-block w-2.5 h-2.5 border border-fuchsia-300 border-t-transparent rounded-full animate-spin" />}
              ✦ Layout AI ▾
            </button>
            {optimizeOpen && (
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setOptimizeOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[180px]">
                  <div className="px-3 py-0.5 text-[10px] text-muted uppercase tracking-wide border-b border-edge mb-1">AI Layout Goal</div>
                  {[
                    { id: "balanced" as const,        label: "Balanced",        desc: "Professional, even spacing" },
                    { id: "emphasis-title" as const,  label: "Emphasize Title", desc: "Large title, compact body" },
                    { id: "compact" as const,         label: "Compact",         desc: "Minimize whitespace" },
                    { id: "spacious" as const,        label: "Spacious",        desc: "Generous margins" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setOptimizeOpen(false); onOptimizeLayout(opt.id) }}
                      className="w-full text-left px-3 py-1.5 hover:bg-paper/10 hover:text-paper transition-colors"
                    >
                      <div className="text-xs text-slate-300">{opt.label}</div>
                      <div className="text-[10px] text-muted">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {onSetColorBlindMode && (
          <div className="relative">
            <button
              onClick={() => setCbOpen((o) => !o)}
              title="Color blindness simulation — preview how your deck looks to colorblind viewers"
              className={`flex items-center gap-1 text-xs px-3 py-1 rounded border transition-colors ${
                colorBlindMode
                  ? "bg-paper/20 text-paper border-paper/30 hover:bg-paper/30"
                  : "bg-white/5 text-muted border-edge hover:text-slate-200 hover:bg-white/10"
              }`}
            >
              👁 {colorBlindMode ? colorBlindMode.charAt(0).toUpperCase() + colorBlindMode.slice(1) : "A11y"} ▾
            </button>
            {cbOpen && (
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setCbOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[180px]">
                  <div className="px-3 py-0.5 text-[10px] text-muted uppercase tracking-wide border-b border-edge mb-1">Color Blindness Simulation</div>
                  {[
                    { id: null,              label: "Normal (no filter)" },
                    { id: "protanopia",      label: "Protanopia (red-weak)" },
                    { id: "deuteranopia",    label: "Deuteranopia (green-weak)" },
                    { id: "tritanopia",      label: "Tritanopia (blue-weak)" },
                    { id: "achromatopsia",   label: "Achromatopsia (grayscale)" },
                  ].map((opt) => (
                    <button
                      key={opt.id ?? "none"}
                      onClick={() => { onSetColorBlindMode(opt.id); setCbOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        colorBlindMode === opt.id
                          ? "text-paper bg-paper/10"
                          : "text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {colorBlindMode === opt.id ? "✓ " : "  "}{opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

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

        {onToggleComments && (
          <button
            onClick={onToggleComments}
            title="Toggle comments panel"
            className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
              commentsOpen
                ? "bg-yellow-500/25 text-yellow-300 border-yellow-500/35 hover:bg-yellow-500/35"
                : "bg-white/5 text-muted hover:text-slate-200 border-edge hover:bg-white/10"
            }`}
          >
            💬 Notes
          </button>
        )}

        {onPresent && (
          <button
            onClick={onPresent}
            title="Present slideshow (fullscreen)"
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors
                       bg-paper/15 text-paper hover:bg-paper/25 border-paper/25"
          >
            ▶ Present
          </button>
        )}

        <button
          onClick={onToggleChat}
          title={chatOpen ? "Close AI Chat" : "Open AI Chat"}
          className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
            chatOpen
              ? "bg-paper/30 text-paper border-paper/40 hover:bg-paper/40"
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

        {onToggleLayers && (
          <button
            onClick={onToggleLayers}
            title="Toggle layers panel"
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors ${
              layersOpen
                ? "border-accent/50 text-accent bg-accent/10"
                : "border-edge text-muted hover:text-slate-200 hover:bg-white/10"
            }`}
          >
            ⧉
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

        {onShowOutlineGen && (
          <button
            onClick={onShowOutlineGen}
            title="AI: Generate slides from outline"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-paper hover:bg-paper/10 hover:border-paper/40 transition-colors"
          >
            ✨
          </button>
        )}

        {onCompare && (
          <button
            onClick={onCompare}
            title="Before/After Comparer — drag divider to compare original vs. edited"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            ⇔
          </button>
        )}

        {onShowStats && (
          <button
            onClick={onShowStats}
            title="Document statistics"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            📊
          </button>
        )}

        {onShowCheck && (
          <button
            onClick={onShowCheck}
            title="Presentation quality check"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            ✓
          </button>
        )}

        {onGrammarCheck && (
          <button
            onClick={onGrammarCheck}
            title="Grammar & Clarity Check (AI) — proofread all slide text"
            className="w-7 h-7 flex items-center justify-center rounded border border-edge text-xs text-muted
                       hover:text-amber-300 hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
          >
            Aa
          </button>
        )}

        {onGenerateNotesBulk && (
          <button
            onClick={onGenerateNotesBulk}
            title="Generate speaker notes for all slides without notes (AI)"
            className="w-7 h-7 flex items-center justify-center rounded border border-paper/40 text-xs text-paper/70
                       hover:text-paper hover:bg-paper/10 transition-colors"
          >
            ✨
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
