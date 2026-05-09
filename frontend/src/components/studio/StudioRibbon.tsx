import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import {
  exportPptxUrl, exportPdfUrl, exportPngZipUrl,
  notesExportUrl, notesHtmlExportUrl, exportHtmlUrl, exportMarkdownUrl,
} from "../../lib/studioApi"
import TextFormatGroup, { isTextCapable } from "./TextFormatGroup"

// ── PPT-style color tokens (used as inline styles / arbitrary Tailwind values) ──
// Ribbon bg:     #F3F3F3   Active tab bg: #FFFFFF   Tab accent: #2B579A
// Context tab:   orange    Dividers:      #D0D0D0   Group label: #757575

// ── shared low-level controls ─────────────────────────────────────────────────

function PosInput({ label, value, disabled, onChange, onCommit }: {
  label: string; value: string; disabled: boolean
  onChange: (v: string) => void; onCommit: () => void
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[9px] text-gray-500 w-3 shrink-0 select-none">{label}</span>
      <input
        type="number" step="0.001" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        className="w-14 text-[11px] font-mono bg-white border border-gray-300 rounded px-1 py-0.5
                   text-gray-800 focus:outline-none focus:border-[#2b579a]
                   disabled:opacity-35 disabled:cursor-default
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}

interface RibbonBtnProps {
  icon: React.ReactNode
  label: string
  title?: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
  primary?: boolean
}

function RibbonBtn({ icon, label, title, onClick, disabled, active, danger, primary }: RibbonBtnProps) {
  const base = "flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
  const tone = active
    ? "text-[#2b579a] bg-[#2b579a]/10 border border-[#2b579a]/30"
    : danger
      ? "text-red-600 hover:text-red-700 hover:bg-red-50"
      : "text-gray-700 hover:bg-gray-200"
  if (primary) {
    return (
      <button
        title={title || label}
        disabled={disabled}
        onClick={onClick}
        className={`${base} ${tone} w-14 flex-col gap-0.5 h-[58px] rounded`}
      >
        <span className="text-[20px] leading-none">{icon}</span>
        <span className="text-[10px] leading-tight max-w-full whitespace-nowrap">{label}</span>
      </button>
    )
  }
  return (
    <button
      title={title || label}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${tone} flex-row gap-1 px-1.5 py-0.5 h-6 rounded text-[11px]`}
    >
      <span className="text-[13px] leading-none">{icon}</span>
      <span className="leading-none">{label}</span>
    </button>
  )
}

function GroupBox({ title, children, highlight }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex flex-col h-[88px] shrink-0 ${highlight ? "bg-orange-50/60" : ""}`}>
      <div className="flex-1 flex items-center gap-1 px-2">{children}</div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-gray-400 text-center pt-0.5 pb-1 border-t border-gray-200">
        {title}
      </div>
    </div>
  )
}

function GroupDivider() {
  return <div className="w-px h-[72px] self-center bg-gray-200 mx-0.5 shrink-0" />
}

function ShapeQuickBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className="w-7 h-7 flex items-center justify-center text-base text-gray-700 hover:bg-gray-200 rounded">
      {icon}
    </button>
  )
}

// ── insert shapes catalog ─────────────────────────────────────────────────────

interface ShapeEntry { label: string; value: string; icon: string }
interface ShapeCategory { category: string; shapes: ShapeEntry[] }

const SHAPE_GALLERY: ShapeCategory[] = [
  {
    category: "Basic",
    shapes: [
      { label: "Text Box",       value: "text_box",       icon: "T" },
      { label: "Rectangle",      value: "rect",           icon: "▭" },
      { label: "Rounded Rect",   value: "roundRect",      icon: "▢" },
      { label: "Ellipse",        value: "ellipse",        icon: "○" },
      { label: "Triangle",       value: "triangle",       icon: "△" },
      { label: "Rt Triangle",    value: "rtTriangle",     icon: "◺" },
      { label: "Diamond",        value: "diamond",        icon: "◇" },
      { label: "Parallelogram",  value: "parallelogram",  icon: "▱" },
      { label: "Trapezoid",      value: "trapezoid",      icon: "⏢" },
      { label: "Pentagon",       value: "pentagon",       icon: "⬠" },
      { label: "Hexagon",        value: "hexagon",        icon: "⬡" },
      { label: "Octagon",        value: "octagon",        icon: "⯃" },
      { label: "Plus",           value: "mathPlus",       icon: "✚" },
      { label: "Can",            value: "can",            icon: "⌀" },
      { label: "Cube",           value: "cube",           icon: "⬜" },
      { label: "Donut",          value: "donut",          icon: "⊙" },
      { label: "Frame",          value: "frame",          icon: "⬕" },
      { label: "Cloud",          value: "cloud",          icon: "☁" },
      { label: "Heart",          value: "heart",          icon: "♥" },
      { label: "Lightning",      value: "lightningBolt",  icon: "⚡" },
    ],
  },
  {
    category: "Arrows",
    shapes: [
      { label: "Right Arrow",    value: "rightArrow",      icon: "→" },
      { label: "Left Arrow",     value: "leftArrow",       icon: "←" },
      { label: "Up Arrow",       value: "upArrow",         icon: "↑" },
      { label: "Down Arrow",     value: "downArrow",       icon: "↓" },
      { label: "Left-Right",     value: "leftRightArrow",  icon: "↔" },
      { label: "Up-Down",        value: "upDownArrow",     icon: "↕" },
      { label: "Quad Arrow",     value: "quadArrow",       icon: "✛" },
      { label: "Bent Arrow",     value: "bentArrow",       icon: "↱" },
      { label: "U-Turn",         value: "uturnArrow",      icon: "↩" },
      { label: "Chevron",        value: "chevron",         icon: "›" },
      { label: "Striped Arrow",  value: "stripedRightArrow", icon: "⇒" },
      { label: "Notched Arrow",  value: "notchedRightArrow", icon: "⇛" },
    ],
  },
  {
    category: "Stars & Banners",
    shapes: [
      { label: "4-Point Star",   value: "star4",           icon: "✦" },
      { label: "5-Point Star",   value: "star5",           icon: "★" },
      { label: "6-Point Star",   value: "star6",           icon: "✡" },
      { label: "8-Point Star",   value: "star8",           icon: "✴" },
      { label: "12-Point Star",  value: "star12",          icon: "✹" },
      { label: "24-Point Star",  value: "star24",          icon: "✺" },
      { label: "Sun",            value: "sun",             icon: "☀" },
      { label: "Moon",           value: "moon",            icon: "☽" },
      { label: "Banner",         value: "ribbon",          icon: "≣" },
      { label: "Wave",           value: "wave",            icon: "〜" },
      { label: "Scroll",         value: "verticalScroll",  icon: "📜" },
      { label: "H Scroll",       value: "horizontalScroll",icon: "⫿" },
    ],
  },
  {
    category: "Callouts",
    shapes: [
      { label: "Rect Callout",   value: "wedgeRectCallout",      icon: "💬" },
      { label: "Rnd Callout",    value: "wedgeRRectCallout",     icon: "🗨" },
      { label: "Oval Callout",   value: "wedgeEllipseCallout",   icon: "🗯" },
      { label: "Cloud Callout",  value: "cloudCallout",          icon: "☁" },
      { label: "Callout 1",      value: "borderCallout1",        icon: "⬓" },
      { label: "Callout 2",      value: "borderCallout2",        icon: "⬔" },
    ],
  },
  {
    category: "Flowchart",
    shapes: [
      { label: "Process",        value: "flowChartProcess",           icon: "▭" },
      { label: "Decision",       value: "flowChartDecision",          icon: "◇" },
      { label: "Terminator",     value: "flowChartTerminator",        icon: "⬬" },
      { label: "Data",           value: "flowChartInputOutput",       icon: "▱" },
      { label: "Document",       value: "flowChartDocument",          icon: "📄" },
      { label: "Connector",      value: "flowChartConnector",         icon: "⬡" },
      { label: "Manual Input",   value: "flowChartManualInput",       icon: "⌨" },
      { label: "Pre-defined",    value: "flowChartPredefinedProcess", icon: "⧈" },
      { label: "Sort",           value: "flowChartSort",              icon: "◈" },
      { label: "Extract",        value: "flowChartExtract",           icon: "△" },
      { label: "Delay",          value: "flowChartDelay",             icon: "▷" },
      { label: "Magnetic Disk",  value: "flowChartMagneticDisk",      icon: "💿" },
    ],
  },
  {
    category: "Equations",
    shapes: [
      { label: "Plus",           value: "mathPlus",     icon: "+" },
      { label: "Minus",          value: "mathMinus",    icon: "−" },
      { label: "Multiply",       value: "mathMultiply", icon: "×" },
      { label: "Divide",         value: "mathDivide",   icon: "÷" },
      { label: "Equal",          value: "mathEqual",    icon: "=" },
      { label: "Not Equal",      value: "mathNotEqual", icon: "≠" },
    ],
  },
]

// Flat list kept for quick-button grids
const INSERT_SHAPES: ShapeEntry[] = SHAPE_GALLERY.flatMap((c) => c.shapes)

const ALIGN_BUTTONS = [
  { title: "Align Left",          icon: "⫷",  dx: () => 0, key: "L" },
  { title: "Center Horizontally", icon: "⊟",  dx: (el: StudioElement, sw: number) => (sw - el.width_in) / 2, key: "C" },
  { title: "Align Right",         icon: "⫸",  dx: (el: StudioElement, sw: number) => sw - el.width_in, key: "R" },
  { title: "Align Top",           icon: "⫶",  dy: () => 0, key: "T" },
  { title: "Center Vertically",   icon: "⊟",  dy: (el: StudioElement, _: number, sh: number) => (sh - el.height_in) / 2, key: "M" },
  { title: "Align Bottom",        icon: "⫶",  dy: (el: StudioElement, _: number, sh: number) => sh - el.height_in, key: "B" },
] as Array<{
  title: string; icon: string; key: string
  dx?: (el: StudioElement, sw: number, sh: number) => number
  dy?: (el: StudioElement, sw: number, sh: number) => number
}>

const ARRANGE_BUTTONS = [
  { title: "Bring to Front", icon: "⇈", action: "front" as const },
  { title: "Bring Forward",  icon: "↑", action: "forward" as const },
  { title: "Send Backward",  icon: "↓", action: "backward" as const },
  { title: "Send to Back",   icon: "⇊", action: "back" as const },
]

// ── Tab type — matches PowerPoint 2024 tab order exactly ─────────────────────

type Tab = "home" | "insert" | "draw" | "design" | "transitions" | "animations" | "slideshow" | "review" | "view" | "shapeformat" | "pictureformat"

const MAIN_TABS: Array<{ id: Tab; label: string }> = [
  { id: "home",        label: "Home"        },
  { id: "insert",      label: "Insert"      },
  { id: "draw",        label: "Draw"        },
  { id: "design",      label: "Design"      },
  { id: "transitions", label: "Transitions" },
  { id: "animations",  label: "Animations"  },
  { id: "slideshow",   label: "Slide Show"  },
  { id: "review",      label: "Review"      },
  { id: "view",        label: "View"        },
]

// ── Props ─────────────────────────────────────────────────────────────────────

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
  onInsertChart?: (chartType?: string) => void
  onInsertTable?: (rows?: number, cols?: number) => void
  onInsertImage?: (file: File) => void
  onStartDraw?: (mode: "pen" | "polygon") => void
  // placement / draw mode status (for active-state indicators)
  placingShapeType?: string
  drawMode?: "pen" | "polygon"
  onCancelPlace?: () => void
  onCancelDraw?: () => void
  onRebuild: () => void
  rebuilding: boolean
  chatOpen: boolean
  onToggleChat: () => void
  onShowShortcuts?: () => void
  onShowSlideSorter?: () => void
  onPresent?: () => void
  layersOpen?: boolean
  onToggleLayers?: () => void
  commentsOpen?: boolean
  onToggleComments?: () => void
  onColorSwap?: () => void
  onShowStats?: () => void
  onFontSwap?: () => void
  onTemplateVars?: () => void
  outlineOpen?: boolean
  onToggleOutline?: () => void
  multiSelectIds?: Set<string>
  onAlignElements?: (alignment: string) => void
  onGroupElements?: () => void
  onUngroupElement?: () => void
  onTextFormatCommit?: () => void
  onShare?: () => void
  // QAT
  onUndo?: () => void
  onRedo?: () => void
  undoDepth?: number
  redoDepth?: number
  // New PPT tabs
  onTransitions?: () => void
  onGrammarCheck?: () => void
  onAIScore?: () => void
  // Misc (passed from Studio, silently ignored if unused)
  [key: string]: unknown
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function StudioRibbon(props: Props) {
  const {
    doc, slideN, slideWidthIn, slideHeightIn, selectedElement,
    onCommitPosition, onCommitZIndex,
    onDelete, onDuplicate, onInsertShape, onInsertChart, onInsertTable, onInsertImage,
    onStartDraw, placingShapeType, drawMode, onCancelPlace, onCancelDraw,
    onRebuild, rebuilding,
    chatOpen, onToggleChat,
    onShowShortcuts, onShowSlideSorter, onPresent,
    layersOpen, onToggleLayers,
    commentsOpen, onToggleComments,
    onColorSwap, onShowStats, onFontSwap, onTemplateVars,
    outlineOpen, onToggleOutline,
    onShare,
    onUndo, onRedo, undoDepth = 0, redoDepth = 0,
    onTransitions, onGrammarCheck, onAIScore,
  } = props

  const [tab, setTab] = useState<Tab>("home")
  const [exportOpen, setExportOpen]   = useState(false)
  const [shapesOpen, setShapesOpen]   = useState(false)
  const [fileOpen, setFileOpen]       = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-switch to context tab when element is selected
  useEffect(() => {
    if (selectedElement) {
      const isImg = selectedElement.type === "BridgeImage" || selectedElement.shape_type === "image"
      if (tab !== "shapeformat" && tab !== "pictureformat") {
        setTab(isImg ? "pictureformat" : "shapeformat")
      }
    } else {
      if (tab === "shapeformat" || tab === "pictureformat") {
        setTab("home")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement?.id])

  // sync position inputs from selectedElement
  const [x, setX] = useState("")
  const [y, setY] = useState("")
  const [w, setW] = useState("")
  const [h, setH] = useState("")
  useEffect(() => {
    if (selectedElement) {
      setX(selectedElement.left_in.toFixed(3))
      setY(selectedElement.top_in.toFixed(3))
      setW(selectedElement.width_in.toFixed(3))
      setH(selectedElement.height_in.toFixed(3))
    } else { setX(""); setY(""); setW(""); setH("") }
  }, [selectedElement])

  const commitPos = useCallback(() => {
    if (!selectedElement) return
    const lx = parseFloat(x), ly = parseFloat(y), lw = parseFloat(w), lh = parseFloat(h)
    if ([lx, ly, lw, lh].some(isNaN)) return
    onCommitPosition(lx, ly, lw, lh)
  }, [x, y, w, h, selectedElement, onCommitPosition])

  const arrange = useCallback((action: "front" | "forward" | "backward" | "back") => {
    if (!selectedElement) return
    const z = selectedElement.z_index
    const next = action === "front" ? 9999 : action === "forward" ? z + 1 : action === "backward" ? Math.max(1, z - 1) : 1
    onCommitZIndex(next)
  }, [selectedElement, onCommitZIndex])

  const align = useCallback((btn: typeof ALIGN_BUTTONS[number]) => {
    if (!selectedElement) return
    const newX = btn.dx ? btn.dx(selectedElement, slideWidthIn, slideHeightIn) : selectedElement.left_in
    const newY = btn.dy ? btn.dy(selectedElement, slideWidthIn, slideHeightIn) : selectedElement.top_in
    onCommitPosition(newX, newY, selectedElement.width_in, selectedElement.height_in)
  }, [selectedElement, slideWidthIn, slideHeightIn, onCommitPosition])

  const noSel = !selectedElement
  const docName = doc.name.replace(/\.pptx$/i, "")

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && onInsertImage) onInsertImage(f)
    e.target.value = ""
  }

  // Determine context tab label/visibility
  const isImageEl = selectedElement && (selectedElement.type === "BridgeImage" || selectedElement.shape_type === "image")
  const contextTabId: Tab | null = selectedElement ? (isImageEl ? "pictureformat" : "shapeformat") : null
  const contextTabLabel = isImageEl ? "Picture Format" : "Shape Format"

  return (
    <div className="shrink-0 border-b border-gray-300 bg-white select-none shadow-sm" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* ── Title bar / Quick Access Toolbar ──────────────────────────── */}
      <div className="h-8 flex items-center bg-white border-b border-gray-200 px-3 gap-1 shrink-0">
        {/* Percy wordmark */}
        <span className="text-[11px] font-bold text-[#2b579a] tracking-[0.18em] uppercase mr-2 select-none">
          Percy
        </span>

        {/* Quick Access Toolbar: Undo / Redo / Save */}
        <button
          title={`Undo${undoDepth ? ` (${undoDepth} steps)` : ""} — Ctrl+Z`}
          onClick={onUndo}
          disabled={!onUndo || undoDepth === 0}
          className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 text-[14px] transition-colors"
        >↩</button>
        <button
          title={`Redo${redoDepth ? ` (${redoDepth} steps)` : ""} — Ctrl+Y`}
          onClick={onRedo}
          disabled={!onRedo || redoDepth === 0}
          className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 text-[14px] transition-colors"
        >↪</button>
        <button
          title="Rebuild slide (re-render PNGs)"
          onClick={onRebuild}
          disabled={rebuilding}
          className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 text-[14px] transition-colors"
        >
          {rebuilding
            ? <span className="inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
            : "⟳"}
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        {/* Document name — center */}
        <div className="flex-1 flex items-center justify-center gap-1.5 overflow-hidden">
          <span className="text-[12px] text-gray-800 font-medium truncate max-w-[22rem]">{docName}</span>
          <span className="text-[10px] text-gray-400 shrink-0">· Slide {slideN} / {doc.slide_count}</span>
        </div>

        {/* Right: Share, Export, AI */}
        {onShare && (
          <button
            onClick={onShare}
            className="px-3 h-6 rounded text-[11px] bg-[#2b579a] text-white hover:bg-[#1e4080] flex items-center gap-1 transition-colors font-medium"
            title="Share this presentation"
          >
            Share
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            className="px-2 h-6 rounded text-[11px] bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 flex items-center gap-1 transition-colors"
          >
            ↓ Export ▾
          </button>
          {exportOpen && (
            <ExportMenu docId={doc.doc_id} onClose={() => setExportOpen(false)} />
          )}
        </div>
        <button
          onClick={onToggleChat}
          title={chatOpen ? "Collapse AI panel" : "Expand AI panel"}
          className={`ml-1 px-2 h-6 rounded text-[11px] border flex items-center gap-1 transition-colors ${
            chatOpen
              ? "bg-[#2b579a]/10 text-[#2b579a] border-[#2b579a]/30"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"
          }`}
        >✦ AI</button>
      </div>

      {/* ── Tab strip ─────────────────────────────────────────────────── */}
      <div className="h-7 flex items-stretch bg-[#f3f3f3] border-b border-gray-300 px-1 shrink-0">
        {/* File tab — PPT-blue accent button */}
        <div className="relative">
          <button
            onClick={() => setFileOpen((o) => !o)}
            className="h-full px-4 text-[11px] font-semibold text-white bg-[#2b579a] hover:bg-[#1e4080] transition-colors"
          >
            File
          </button>
          {fileOpen && (
            <FileMenu
              docId={doc.doc_id}
              onClose={() => setFileOpen(false)}
            />
          )}
        </div>

        {/* Main tabs */}
        {MAIN_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "px-3 h-full text-[11px] transition-colors relative whitespace-nowrap",
              tab === t.id
                ? "bg-white text-[#2b579a] font-medium"
                : "text-gray-600 hover:text-gray-800 hover:bg-white/60",
            ].join(" ")}
          >
            {tab === t.id && (
              <span className="absolute top-0 left-0 right-0 h-0.5 bg-[#2b579a]" />
            )}
            {t.label}
          </button>
        ))}

        {/* Context tab — Shape Format / Picture Format */}
        {contextTabId && (
          <>
            <div className="w-px bg-gray-300 mx-0.5 my-1.5" />
            <button
              onClick={() => setTab(contextTabId)}
              className={[
                "px-3 h-full text-[11px] transition-colors relative whitespace-nowrap font-medium",
                tab === contextTabId
                  ? "bg-white text-orange-700"
                  : "text-orange-600 bg-orange-50/60 hover:bg-orange-50",
              ].join(" ")}
            >
              {tab === contextTabId && (
                <span className="absolute top-0 left-0 right-0 h-0.5 bg-orange-500" />
              )}
              {contextTabLabel}
            </button>
          </>
        )}
      </div>

      {/* ── Ribbon body ───────────────────────────────────────────────── */}
      <div className="bg-white relative">
        {tab === "home" && (
          <HomeRibbon
            noSel={noSel}
            selectedElement={selectedElement}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onGroup={props.onGroupElements}
            onUngroup={props.onUngroupElement}
            multiCount={props.multiSelectIds?.size ?? 0}
            onAlignElements={props.onAlignElements}
            onInsertShape={onInsertShape}
            onPickImage={() => fileInputRef.current?.click()}
            docId={doc.doc_id}
            slideN={slideN}
            onTextFormatCommit={props.onTextFormatCommit}
          />
        )}
        {tab === "insert" && (
          <InsertRibbon
            shapesOpen={shapesOpen}
            setShapesOpen={setShapesOpen}
            onInsertShape={onInsertShape}
            onInsertChart={onInsertChart}
            onInsertTable={onInsertTable}
            onPickImage={() => fileInputRef.current?.click()}
          />
        )}
        {tab === "draw" && (
          <DrawRibbon
            onStartDraw={onStartDraw}
            drawMode={drawMode}
            onCancelDraw={onCancelDraw}
          />
        )}
        {tab === "design" && (
          <DesignRibbon
            onColorSwap={onColorSwap}
            onFontSwap={onFontSwap}
            onTemplateVars={onTemplateVars}
          />
        )}
        {tab === "transitions" && (
          <TransitionsRibbon onTransitions={onTransitions} />
        )}
        {tab === "animations" && (
          <AnimationsRibbon />
        )}
        {tab === "slideshow" && (
          <SlideShowRibbon
            onPresent={onPresent}
            onShowSlideSorter={onShowSlideSorter}
          />
        )}
        {tab === "review" && (
          <ReviewRibbon
            onGrammarCheck={onGrammarCheck}
            commentsOpen={!!commentsOpen}
            onToggleComments={onToggleComments}
            onAIScore={onAIScore}
            onShowStats={onShowStats}
          />
        )}
        {tab === "view" && (
          <ViewRibbon
            layersOpen={!!layersOpen} onToggleLayers={onToggleLayers}
            outlineOpen={!!outlineOpen} onToggleOutline={onToggleOutline}
            commentsOpen={!!commentsOpen} onToggleComments={onToggleComments}
            onShowSlideSorter={onShowSlideSorter}
            onPresent={onPresent}
            onShowStats={onShowStats}
            onShowShortcuts={onShowShortcuts}
          />
        )}
        {(tab === "shapeformat" || tab === "pictureformat") && (
          <ShapeFormatRibbon
            noSel={noSel}
            x={x} y={y} w={w} h={h}
            setX={setX} setY={setY} setW={setW} setH={setH}
            commitPos={commitPos}
            selectedElement={selectedElement}
            arrange={arrange}
            align={align}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onGroup={props.onGroupElements}
            onUngroup={props.onUngroupElement}
            multiCount={props.multiSelectIds?.size ?? 0}
            onAlignElements={props.onAlignElements}
            isImage={tab === "pictureformat"}
          />
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFilePicked} className="hidden" />
    </div>
  )
}

// ── HOME tab ──────────────────────────────────────────────────────────────────
// Matches PPT Home: Clipboard | Slides | Font | Paragraph | Drawing | Editing

function HomeRibbon({
  noSel, selectedElement,
  onDuplicate, onDelete, onGroup, onUngroup,
  multiCount, onAlignElements,
  onInsertShape, onPickImage,
  docId, slideN, onTextFormatCommit,
}: {
  noSel: boolean
  selectedElement: StudioElement | null
  onDuplicate: () => void
  onDelete: () => void
  onGroup?: () => void
  onUngroup?: () => void
  multiCount: number
  onAlignElements?: (alignment: string) => void
  onInsertShape: (shapeType: string) => void
  onPickImage: () => void
  docId: string
  slideN: number
  onTextFormatCommit?: () => void
}) {
  const showTextGroup = isTextCapable(selectedElement)
  return (
    <div className="flex h-[88px] items-stretch">
      {/* Clipboard group */}
      <GroupBox title="Clipboard">
        <RibbonBtn primary icon="⊕" label="Duplicate" disabled={noSel} onClick={onDuplicate} title="Duplicate element (Ctrl+D)" />
        <div className="flex flex-col gap-0.5">
          {onGroup   && <RibbonBtn icon="◳" label="Group"   disabled={noSel} onClick={onGroup}   title="Group selected" />}
          {onUngroup && <RibbonBtn icon="◰" label="Ungroup" disabled={noSel} onClick={onUngroup} title="Ungroup" />}
          {multiCount >= 2 && onAlignElements && (
            <RibbonBtn icon="⊟" label="Align" onClick={() => onAlignElements("center")} title="Align elements" />
          )}
          <RibbonBtn icon="✕" label="Delete" disabled={noSel} onClick={onDelete} danger title="Delete (Del)" />
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Font / Text group — only when text-capable element selected */}
      {showTextGroup && selectedElement ? (
        <>
          <GroupBox title="Font">
            <TextFormatGroup
              key={selectedElement.id}
              element={selectedElement}
              docId={docId}
              slideN={slideN}
              onCommit={onTextFormatCommit}
            />
          </GroupBox>
          <GroupDivider />
        </>
      ) : (
        <>
          <GroupBox title="Font">
            <div className="px-2 text-[10px] text-gray-400 italic self-center">
              Select a text element to edit font
            </div>
          </GroupBox>
          <GroupDivider />
        </>
      )}

      {/* Drawing group — quick shape insert */}
      <GroupBox title="Drawing">
        <RibbonBtn primary icon="T" label="Text Box" onClick={() => onInsertShape("text_box")} />
        <div className="grid grid-cols-3 gap-0.5">
          <ShapeQuickBtn icon="▭" title="Rectangle"  onClick={() => onInsertShape("rect")} />
          <ShapeQuickBtn icon="○" title="Ellipse"    onClick={() => onInsertShape("ellipse")} />
          <ShapeQuickBtn icon="△" title="Triangle"   onClick={() => onInsertShape("triangle")} />
          <ShapeQuickBtn icon="◇" title="Diamond"    onClick={() => onInsertShape("diamond")} />
          <ShapeQuickBtn icon="★" title="Star"       onClick={() => onInsertShape("star5")} />
          <ShapeQuickBtn icon="→" title="Arrow"      onClick={() => onInsertShape("rightArrow")} />
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Editing group */}
      <GroupBox title="Editing">
        <RibbonBtn primary icon="🖼" label="Image" onClick={onPickImage} />
      </GroupBox>
    </div>
  )
}

// ── INSERT tab ────────────────────────────────────────────────────────────────

function InsertRibbon({
  shapesOpen, setShapesOpen, onInsertShape, onInsertChart, onInsertTable, onPickImage,
}: {
  shapesOpen: boolean
  setShapesOpen: (o: boolean) => void
  onInsertShape: (shape: string) => void
  onInsertChart?: (chartType?: string) => void
  onInsertTable?: (rows?: number, cols?: number) => void
  onPickImage: () => void
}) {
  const [galleryTab, setGalleryTab] = useState(0)
  const [tableGridOpen, setTableGridOpen] = useState(false)
  const [tableHover, setTableHover] = useState<[number, number]>([0, 0])
  const GRID_ROWS = 8, GRID_COLS = 10

  return (
    <div className="flex h-[88px] items-stretch">
      {/* Tables — PowerPoint-style hover grid picker */}
      <GroupBox title="Tables">
        <div className="relative">
          <button
            onClick={() => setTableGridOpen((o) => !o)}
            className="flex flex-col items-center justify-center gap-0.5 w-14 h-[58px] rounded text-gray-700 hover:bg-gray-200 transition-colors"
            title="Insert Table"
          >
            <span className="text-[20px] leading-none">▦</span>
            <span className="text-[10px] leading-tight">Table ▾</span>
          </button>
          {tableGridOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTableGridOpen(false)} />
              <div
                className="absolute z-50 left-0 top-full mt-1 bg-white border border-gray-300 rounded shadow-xl p-2"
                onMouseLeave={() => setTableHover([0, 0])}
              >
                <div className="text-[10px] text-gray-500 mb-1 text-center">
                  {tableHover[0] > 0 && tableHover[1] > 0
                    ? `${tableHover[1]} × ${tableHover[0]} Table`
                    : "Insert Table"}
                </div>
                <div
                  className="grid gap-0.5"
                  style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 16px)` }}
                >
                  {Array.from({ length: GRID_ROWS }, (_, r) =>
                    Array.from({ length: GRID_COLS }, (_, c) => {
                      const active = r < tableHover[0] && c < tableHover[1]
                      return (
                        <div
                          key={`${r}-${c}`}
                          className={`w-4 h-4 border cursor-pointer transition-colors ${
                            active ? "bg-blue-100 border-blue-400" : "bg-white border-gray-300 hover:border-gray-400"
                          }`}
                          onMouseEnter={() => setTableHover([r + 1, c + 1])}
                          onClick={() => {
                            setTableGridOpen(false)
                            setTableHover([0, 0])
                            onInsertTable?.(tableHover[0], tableHover[1])
                          }}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Images */}
      <GroupBox title="Images">
        <RibbonBtn primary icon="🖼" label="Pictures" onClick={onPickImage} title="Insert image from file" />
      </GroupBox>

      <GroupDivider />

      {/* Text */}
      <GroupBox title="Text">
        <RibbonBtn primary icon="T" label="Text Box" onClick={() => onInsertShape("text_box")} />
      </GroupBox>

      <GroupDivider />

      {/* Shapes — quick grid + categorised gallery */}
      <GroupBox title="Shapes">
        <div className="grid grid-cols-3 gap-0.5">
          <ShapeQuickBtn icon="▭" title="Rectangle"    onClick={() => onInsertShape("rect")} />
          <ShapeQuickBtn icon="○" title="Ellipse"      onClick={() => onInsertShape("ellipse")} />
          <ShapeQuickBtn icon="△" title="Triangle"     onClick={() => onInsertShape("triangle")} />
          <ShapeQuickBtn icon="◇" title="Diamond"      onClick={() => onInsertShape("diamond")} />
          <ShapeQuickBtn icon="★" title="Star"         onClick={() => onInsertShape("star5")} />
          <ShapeQuickBtn icon="→" title="Arrow"        onClick={() => onInsertShape("rightArrow")} />
        </div>
        <div className="relative">
          <button
            onClick={() => setShapesOpen(!shapesOpen)}
            className="px-1.5 h-6 text-[11px] text-gray-700 hover:bg-gray-200 rounded border border-gray-300 flex items-center gap-1"
          >All ▾</button>
          {shapesOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShapesOpen(false)} />
              <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-gray-300 rounded shadow-xl overflow-hidden"
                style={{ width: 340 }}>
                {/* Category tab strip */}
                <div className="flex border-b border-gray-200 bg-gray-50">
                  {SHAPE_GALLERY.map((cat, i) => (
                    <button key={cat.category}
                      onClick={() => setGalleryTab(i)}
                      className={`px-2 py-1 text-[10px] whitespace-nowrap transition-colors ${
                        galleryTab === i
                          ? "bg-white text-[#2b579a] border-b-2 border-[#2b579a] font-medium"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >{cat.category}</button>
                  ))}
                </div>
                {/* Shape grid for selected category */}
                <div className="grid grid-cols-6 gap-0.5 p-1.5 max-h-48 overflow-y-auto">
                  {SHAPE_GALLERY[galleryTab]?.shapes.map((s) => (
                    <button key={s.value} title={s.label}
                      onClick={() => { setShapesOpen(false); onInsertShape(s.value) }}
                      className="flex flex-col items-center justify-center gap-0.5 p-1 rounded hover:bg-blue-50 text-gray-700 transition-colors"
                      style={{ minHeight: 44 }}
                    >
                      <span className="text-xl leading-none">{s.icon}</span>
                      <span className="text-[8px] text-gray-500 leading-tight text-center line-clamp-2">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Charts */}
      <GroupBox title="Illustrations">
        <RibbonBtn icon="📊" label="Chart" onClick={() => onInsertChart?.()} title="Insert blank bar chart" />
        <RibbonBtn icon="—"  label="Connector" disabled />
      </GroupBox>
    </div>
  )
}

// ── DRAW tab ──────────────────────────────────────────────────────────────────

function DrawRibbon({
  onStartDraw, drawMode, onCancelDraw,
}: {
  onStartDraw?: (mode: "pen" | "polygon") => void
  drawMode?: "pen" | "polygon"
  onCancelDraw?: () => void
}) {
  return (
    <div className="flex h-[88px] items-stretch">
      {/* Freeform tools */}
      <GroupBox title="Draw Shapes">
        <button
          title="Pen — draw smooth freehand path (released to finish)"
          onClick={() => onStartDraw?.("pen")}
          disabled={!onStartDraw}
          className={[
            "flex flex-col items-center justify-center gap-0.5 w-14 h-[58px] rounded text-[11px] transition-colors disabled:opacity-30",
            drawMode === "pen"
              ? "bg-[#2b579a]/10 text-[#2b579a] border border-[#2b579a]/30"
              : "text-gray-700 hover:bg-gray-100",
          ].join(" ")}
        >
          <span className="text-[20px] leading-none">✒</span>
          <span className="leading-tight">Pen</span>
        </button>
        <button
          title="Polygon — click to place anchor points, double-click to close"
          onClick={() => onStartDraw?.("polygon")}
          disabled={!onStartDraw}
          className={[
            "flex flex-col items-center justify-center gap-0.5 w-14 h-[58px] rounded text-[11px] transition-colors disabled:opacity-30",
            drawMode === "polygon"
              ? "bg-[#2b579a]/10 text-[#2b579a] border border-[#2b579a]/30"
              : "text-gray-700 hover:bg-gray-100",
          ].join(" ")}
        >
          <span className="text-[20px] leading-none">⬡</span>
          <span className="leading-tight">Polygon</span>
        </button>
        {drawMode && (
          <button
            title="Cancel current draw mode (Esc)"
            onClick={onCancelDraw}
            className="flex flex-col items-center justify-center gap-0.5 w-10 h-[58px] rounded text-[11px] text-red-600 hover:bg-red-50 transition-colors"
          >
            <span className="text-[16px] leading-none">✕</span>
            <span className="leading-tight text-[9px]">Cancel</span>
          </button>
        )}
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Tips">
        <div className="px-2 text-[10px] text-gray-400 leading-relaxed max-w-[200px]">
          <div><b>Pen:</b> drag to draw a freehand path</div>
          <div><b>Polygon:</b> click anchors, dbl-click to close</div>
          <div className="mt-1 text-gray-300">Esc cancels · Enter closes polygon</div>
        </div>
      </GroupBox>
    </div>
  )
}

// ── DESIGN tab ────────────────────────────────────────────────────────────────

function DesignRibbon({
  onColorSwap, onFontSwap, onTemplateVars,
}: {
  onColorSwap?: () => void
  onFontSwap?: () => void
  onTemplateVars?: () => void
}) {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Themes">
        <RibbonBtn primary icon="🎨" label="Colors" onClick={onColorSwap}    disabled={!onColorSwap} title="Swap theme colors across the deck" />
        <RibbonBtn primary icon="A"  label="Fonts"  onClick={onFontSwap}     disabled={!onFontSwap}  title="Swap fonts across the deck" />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Customize">
        <RibbonBtn primary icon="⚙" label="Variables" onClick={onTemplateVars} disabled={!onTemplateVars} title="Template variables" />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Background">
        <div className="text-[10px] text-gray-500 px-2 self-center max-w-[14rem] leading-snug">
          Select the canvas (no element) → use the Properties panel on the right to set background color or image.
        </div>
      </GroupBox>
    </div>
  )
}

// ── TRANSITIONS tab ───────────────────────────────────────────────────────────

function TransitionsRibbon({ onTransitions }: { onTransitions?: () => void }) {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Transition to This Slide">
        <RibbonBtn primary icon="▷" label="Transitions" onClick={onTransitions} disabled={!onTransitions}
          title="Set slide transitions" />
        <div className="text-[10px] text-gray-500 px-2 self-center">
          Fade · Slide · Zoom · Flip · Push · Wipe
        </div>
      </GroupBox>
    </div>
  )
}

// ── ANIMATIONS tab ────────────────────────────────────────────────────────────

function AnimationsRibbon() {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Animation">
        <div className="px-4 text-[11px] text-gray-500 italic self-center">
          Element animations — coming soon
        </div>
      </GroupBox>
    </div>
  )
}

// ── SLIDE SHOW tab ────────────────────────────────────────────────────────────

function SlideShowRibbon({
  onPresent, onShowSlideSorter,
}: {
  onPresent?: () => void
  onShowSlideSorter?: () => void
}) {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Start Slide Show">
        <RibbonBtn primary icon="▶" label="From Beginning" onClick={onPresent} disabled={!onPresent}
          title="Start presentation from the beginning (F5)" />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Set Up">
        <RibbonBtn primary icon="▦" label="Slide Sorter" onClick={onShowSlideSorter} disabled={!onShowSlideSorter}
          title="Open slide sorter view" />
      </GroupBox>
    </div>
  )
}

// ── REVIEW tab ────────────────────────────────────────────────────────────────

function ReviewRibbon({
  onGrammarCheck, commentsOpen, onToggleComments, onAIScore, onShowStats,
}: {
  onGrammarCheck?: () => void
  commentsOpen: boolean
  onToggleComments?: () => void
  onAIScore?: () => void
  onShowStats?: () => void
}) {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Proofing">
        <RibbonBtn primary icon="✓" label="Spelling" onClick={onGrammarCheck} disabled={!onGrammarCheck}
          title="Grammar &amp; spelling check" />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Insights">
        <RibbonBtn primary icon="📊" label="AI Score"   onClick={onAIScore}    disabled={!onAIScore} />
        <RibbonBtn primary icon="📈" label="Statistics" onClick={onShowStats}  disabled={!onShowStats} />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Comments">
        <RibbonBtn primary icon="💬" label="Comments" onClick={onToggleComments} active={commentsOpen} disabled={!onToggleComments} />
      </GroupBox>
    </div>
  )
}

// ── VIEW tab ──────────────────────────────────────────────────────────────────

function ViewRibbon({
  layersOpen, onToggleLayers,
  outlineOpen, onToggleOutline,
  commentsOpen, onToggleComments,
  onShowSlideSorter, onPresent, onShowStats, onShowShortcuts,
}: {
  layersOpen: boolean; onToggleLayers?: () => void
  outlineOpen: boolean; onToggleOutline?: () => void
  commentsOpen: boolean; onToggleComments?: () => void
  onShowSlideSorter?: () => void
  onPresent?: () => void
  onShowStats?: () => void
  onShowShortcuts?: () => void
}) {
  return (
    <div className="flex h-[88px] items-stretch">
      <GroupBox title="Presentation Views">
        <RibbonBtn primary icon="⊞" label="Normal"   title="Normal editing view" disabled />
        <RibbonBtn primary icon="▦" label="Sorter"   onClick={onShowSlideSorter} disabled={!onShowSlideSorter} />
        <RibbonBtn primary icon="▶" label="Present"  onClick={onPresent}         disabled={!onPresent} />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Show">
        <RibbonBtn primary icon="⊟" label="Layers"   onClick={onToggleLayers}   active={layersOpen}   disabled={!onToggleLayers} />
        <RibbonBtn primary icon="≡" label="Outline"  onClick={onToggleOutline}  active={outlineOpen}  disabled={!onToggleOutline} />
        <RibbonBtn primary icon="💬" label="Comments" onClick={onToggleComments} active={commentsOpen} disabled={!onToggleComments} />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Window">
        <RibbonBtn icon="📈" label="Stats"     onClick={onShowStats}     disabled={!onShowStats} />
        <RibbonBtn icon="⌨"  label="Shortcuts" onClick={onShowShortcuts} disabled={!onShowShortcuts} />
      </GroupBox>
    </div>
  )
}

// ── SHAPE FORMAT / PICTURE FORMAT context tab ─────────────────────────────────
// PPT puts size/position/arrange/align here when an element is selected.

function ShapeFormatRibbon({
  noSel, x, y, w, h, setX, setY, setW, setH, commitPos,
  selectedElement, arrange, align,
  onDelete, onDuplicate, onGroup, onUngroup,
  multiCount, onAlignElements, isImage,
}: {
  noSel: boolean
  x: string; y: string; w: string; h: string
  setX: (v: string) => void; setY: (v: string) => void
  setW: (v: string) => void; setH: (v: string) => void
  commitPos: () => void
  selectedElement: StudioElement | null
  arrange: (a: "front" | "forward" | "backward" | "back") => void
  align: (btn: typeof ALIGN_BUTTONS[number]) => void
  onDelete: () => void
  onDuplicate: () => void
  onGroup?: () => void
  onUngroup?: () => void
  multiCount: number
  onAlignElements?: (alignment: string) => void
  isImage: boolean
}) {
  return (
    <div className="flex h-[88px] items-stretch bg-orange-50/30">
      {/* Insert Shapes (quick access) */}
      <GroupBox title="Edit" highlight>
        <RibbonBtn primary icon="⧉" label="Duplicate" disabled={noSel} onClick={onDuplicate} title="Duplicate (Ctrl+D)" />
        <div className="flex flex-col gap-0.5">
          <RibbonBtn icon="✕" label="Delete" disabled={noSel} onClick={onDelete} danger title="Delete" />
          {onGroup   && <RibbonBtn icon="◳" label="Group"   disabled={noSel} onClick={onGroup} />}
          {onUngroup && <RibbonBtn icon="◰" label="Ungroup" disabled={noSel} onClick={onUngroup} />}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Arrange group */}
      <GroupBox title="Arrange" highlight>
        <div className="grid grid-cols-2 gap-0.5">
          {ARRANGE_BUTTONS.map((b) => (
            <button key={b.title} title={b.title} disabled={noSel}
              onClick={() => arrange(b.action)}
              className="w-14 h-6 flex items-center gap-1 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded disabled:opacity-30">
              <span className="text-[12px]">{b.icon}</span>
              <span>{b.title.split(" ")[0]}</span>
            </button>
          ))}
        </div>
        {selectedElement && <span className="text-[10px] text-gray-400 font-mono pl-1">z={selectedElement.z_index}</span>}
      </GroupBox>

      <GroupDivider />

      {/* Align group */}
      <GroupBox title="Align" highlight>
        <div className="grid grid-cols-3 gap-0.5">
          {ALIGN_BUTTONS.map((b) => (
            <button key={b.title} title={b.title} disabled={noSel}
              onClick={() => align(b)}
              className="w-7 h-7 flex items-center justify-center text-xs text-gray-700 hover:bg-gray-200 rounded disabled:opacity-30">
              <span className="text-[11px]">{b.key}</span>
            </button>
          ))}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Size group */}
      <GroupBox title="Size" highlight>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-1">
          <PosInput label="X" value={x} disabled={noSel} onChange={setX} onCommit={commitPos} />
          <PosInput label="W" value={w} disabled={noSel} onChange={setW} onCommit={commitPos} />
          <PosInput label="Y" value={y} disabled={noSel} onChange={setY} onCommit={commitPos} />
          <PosInput label="H" value={h} disabled={noSel} onChange={setH} onCommit={commitPos} />
        </div>
      </GroupBox>

      {/* Multi-select distribute */}
      {multiCount >= 2 && onAlignElements && (
        <>
          <GroupDivider />
          <GroupBox title={`Distribute · ${multiCount}`} highlight>
            <div className="grid grid-cols-2 gap-0.5">
              <button title="Align left edges"    onClick={() => onAlignElements("left")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"><span>⫷</span><span>Left</span></button>
              <button title="Align right edges"   onClick={() => onAlignElements("right")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"><span>⫸</span><span>Right</span></button>
              <button title="Align top edges"     onClick={() => onAlignElements("top")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"><span>⫶</span><span>Top</span></button>
              <button title="Align bottom edges"  onClick={() => onAlignElements("bottom")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"><span>⫶</span><span>Bot</span></button>
              <button title="Distribute horizontally" disabled={multiCount < 3} onClick={() => onAlignElements("distribute_h")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1 disabled:opacity-30"><span>↔</span><span>Dist H</span></button>
              <button title="Distribute vertically" disabled={multiCount < 3} onClick={() => onAlignElements("distribute_v")}
                className="h-6 px-1.5 text-[11px] text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1 disabled:opacity-30"><span>↕</span><span>Dist V</span></button>
            </div>
          </GroupBox>
        </>
      )}
    </div>
  )
}

// ── File menu (backstage) ─────────────────────────────────────────────────────

function FileMenu({ docId, onClose }: { docId: string; onClose: () => void }) {
  const exportItems: Array<{ label: string; href: string; note?: string }> = [
    { label: "PowerPoint (.pptx)", href: exportPptxUrl(docId), note: "Round-tripped" },
    { label: "PDF",                href: exportPdfUrl(docId) },
    { label: "PNG slides (zip)",   href: exportPngZipUrl(docId) },
    { label: "HTML slideshow",     href: exportHtmlUrl(docId) },
    { label: "Markdown outline",   href: exportMarkdownUrl(docId) },
    { label: "Speaker notes (.md)", href: notesExportUrl(docId, "md") },
    { label: "Speaker notes (HTML)", href: notesHtmlExportUrl(docId) },
  ]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-0 w-60 bg-white border border-gray-300 shadow-xl py-1" style={{ borderTop: "2px solid #2b579a" }}>
        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-200">Save & Export</div>
        {exportItems.map((it) => (
          <a key={it.label} href={it.href} download onClick={onClose}
            className="flex items-center justify-between px-4 py-1.5 text-[12px] text-gray-700 hover:bg-gray-100">
            <span>{it.label}</span>
            {it.note && <span className="text-[9px] text-[#2b579a]">{it.note}</span>}
          </a>
        ))}
        <div className="border-t border-gray-200 mt-1 pt-1">
          <button onClick={() => { window.history.back(); onClose() }}
            className="w-full text-left px-4 py-1.5 text-[12px] text-gray-700 hover:bg-gray-100">
            ← Back to Projects
          </button>
        </div>
      </div>
    </>
  )
}

// ── Export menu (from title bar button) ───────────────────────────────────────

function ExportMenu({ docId, onClose }: { docId: string; onClose: () => void }) {
  const items: Array<{ label: string; href: string; note?: string }> = [
    { label: "PowerPoint (.pptx)", href: exportPptxUrl(docId), note: "Round-tripped" },
    { label: "PDF",                href: exportPdfUrl(docId) },
    { label: "PNG slides (zip)",   href: exportPngZipUrl(docId) },
    { label: "HTML slideshow",     href: exportHtmlUrl(docId) },
    { label: "Markdown outline",   href: exportMarkdownUrl(docId) },
    { label: "Speaker notes (.md)", href: notesExportUrl(docId, "md") },
    { label: "Speaker notes (HTML)", href: notesHtmlExportUrl(docId) },
  ]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-7 z-50 mt-1 w-56 bg-white border border-gray-300 rounded shadow-xl py-1">
        <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-gray-400 border-b border-gray-200">Download</div>
        {items.map((it) => (
          <a key={it.label} href={it.href} download onClick={onClose}
            className="flex items-center justify-between px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-100">
            <span>{it.label}</span>
            {it.note && <span className="text-[9px] text-[#2b579a]">{it.note}</span>}
          </a>
        ))}
      </div>
    </>
  )
}
