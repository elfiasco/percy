import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import {
  exportPptxUrl, exportPdfUrl, exportPngZipUrl,
  notesExportUrl, notesHtmlExportUrl, exportHtmlUrl, exportMarkdownUrl,
} from "../../lib/studioApi"
import { isTextCapable } from "./TextFormatGroup"

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

// ── Google Slides–style menu/toolbar helpers ───────────────────────────────────

interface GMenuItem {
  label: string
  icon?: string
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
  active?: boolean
}

function GMenuBtn({ label, items, disabled }: { label: string; items: GMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`px-2 h-8 text-[13px] rounded transition-colors disabled:opacity-40 ${
          open ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#3c4043] hover:bg-[#f1f3f4]"
        }`}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-[#dadce0] rounded shadow-[0_2px_10px_rgba(0,0,0,0.18)] py-1 min-w-[220px]"
            style={{ fontFamily: "'Google Sans',Roboto,sans-serif" }}>
            {items.map((item, i) =>
              item.separator ? (
                <div key={i} className="h-px bg-[#e0e0e0] my-1 mx-1" />
              ) : (
                <button
                  key={i}
                  onClick={() => { item.onClick?.(); setOpen(false) }}
                  disabled={item.disabled}
                  className={`w-full text-left px-4 py-[6px] text-[13px] flex items-center gap-3 disabled:opacity-40 disabled:cursor-default ${
                    item.active ? "text-[#1a73e8] bg-[#e8f0fe]" : "text-[#202124] hover:bg-[#f1f3f4]"
                  }`}
                >
                  <span className="w-4 text-center text-[14px] shrink-0">{item.icon ?? ""}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && <span className="text-[11px] text-[#80868b] shrink-0">{item.shortcut}</span>}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TBtn({ icon, title, onClick, disabled, active }: {
  icon: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded text-[16px] transition-colors disabled:opacity-30 ${
        active ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#3c4043] hover:bg-[#f1f3f4]"
      }`}
    >
      {icon}
    </button>
  )
}

function TDivider() {
  return <div className="w-px h-5 bg-[#dadce0] mx-0.5 shrink-0" />
}

function ShapesToolBtn({ onInsertShape }: { onInsertShape: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [galleryTab, setGalleryTab] = useState(0)
  return (
    <div className="relative flex items-center">
      <button
        title="Insert shape"
        onClick={() => onInsertShape("rect")}
        className="h-8 flex items-center justify-center rounded-l text-[15px] text-[#3c4043] hover:bg-[#f1f3f4] px-1.5 transition-colors"
      >
        ◻
      </button>
      <button
        title="More shapes"
        onClick={() => setOpen((o) => !o)}
        className="h-8 flex items-center justify-center rounded-r text-[10px] text-[#3c4043] hover:bg-[#f1f3f4] px-0.5 transition-colors"
      >
        ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-[#dadce0] rounded shadow-[0_2px_10px_rgba(0,0,0,0.18)] overflow-hidden" style={{ width: 320 }}>
            <div className="flex border-b border-[#e0e0e0] bg-[#f8f9fa]">
              {SHAPE_GALLERY.map((cat, i) => (
                <button key={cat.category} onClick={() => setGalleryTab(i)}
                  className={`px-2 py-1.5 text-[11px] whitespace-nowrap transition-colors ${
                    galleryTab === i ? "bg-white text-[#1a73e8] border-b-2 border-[#1a73e8]" : "text-[#5f6368] hover:bg-white/60"
                  }`}
                >{cat.category}</button>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-0.5 p-2 max-h-48 overflow-y-auto">
              {SHAPE_GALLERY[galleryTab]?.shapes.map((s) => (
                <button key={s.value} title={s.label}
                  onClick={() => { setOpen(false); onInsertShape(s.value) }}
                  className="flex flex-col items-center gap-0.5 p-1 rounded hover:bg-[#e8f0fe] text-[#3c4043] transition-colors"
                  style={{ minHeight: 42 }}
                >
                  <span className="text-xl leading-none">{s.icon}</span>
                  <span className="text-[8px] text-[#5f6368] leading-tight text-center">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TableToolBtn({ onInsertTable }: { onInsertTable?: (rows?: number, cols?: number) => void }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<[number, number]>([0, 0])
  const R = 8, C = 10
  return (
    <div className="relative">
      <button
        title="Insert table"
        onClick={() => setOpen((o) => !o)}
        className="h-8 flex items-center gap-0.5 px-1.5 rounded text-[#3c4043] hover:bg-[#f1f3f4] text-[15px] transition-colors"
      >
        <span>▦</span><span className="text-[10px]">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setHover([0, 0]) }} />
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-[#dadce0] rounded shadow-[0_2px_10px_rgba(0,0,0,0.18)] p-2"
            onMouseLeave={() => setHover([0, 0])}>
            <div className="text-[11px] text-[#80868b] mb-1.5 text-center min-h-[16px]">
              {hover[0] > 0 ? `${hover[1]} × ${hover[0]} table` : "Insert table"}
            </div>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${C}, 16px)` }}>
              {Array.from({ length: R }, (_, r) =>
                Array.from({ length: C }, (_, c) => {
                  const active = r < hover[0] && c < hover[1]
                  return (
                    <div key={`${r}-${c}`}
                      className={`w-4 h-4 border cursor-pointer transition-colors ${active ? "bg-[#e8f0fe] border-[#1a73e8]" : "border-[#dadce0] hover:border-[#9aa0a6]"}`}
                      onMouseEnter={() => setHover([r + 1, c + 1])}
                      onClick={() => { setOpen(false); setHover([0, 0]); onInsertTable?.(hover[0], hover[1]) }}
                    />
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const CHART_TYPES = [
  { type: "column_clustered", icon: "📊", label: "Column" },
  { type: "bar_clustered",    icon: "📉", label: "Bar" },
  { type: "line",             icon: "📈", label: "Line" },
  { type: "area",             icon: "◭",  label: "Area" },
  { type: "pie",              icon: "⬤",  label: "Pie" },
  { type: "doughnut",         icon: "◎",  label: "Donut" },
  { type: "scatter",          icon: "⁙",  label: "Scatter" },
]

function ChartToolBtn({ onInsertChart }: { onInsertChart?: (chartType?: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center">
      <button
        title="Insert column chart"
        onClick={() => { onInsertChart?.("column_clustered") }}
        className="h-8 flex items-center justify-center rounded-l text-[16px] text-[#3c4043] hover:bg-[#f1f3f4] px-1.5 transition-colors"
      >
        📊
      </button>
      <button
        title="More chart types"
        onClick={() => setOpen((o) => !o)}
        className="h-8 flex items-center justify-center rounded-r text-[10px] text-[#3c4043] hover:bg-[#f1f3f4] px-0.5 transition-colors"
      >
        ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-[#dadce0] rounded shadow-[0_2px_10px_rgba(0,0,0,0.18)] py-1 min-w-[140px]"
            style={{ fontFamily: "'Google Sans',Roboto,sans-serif" }}>
            {CHART_TYPES.map((c) => (
              <button key={c.type}
                onClick={() => { setOpen(false); onInsertChart?.(c.type) }}
                className="w-full text-left px-3 py-[6px] text-[13px] text-[#202124] hover:bg-[#f1f3f4] flex items-center gap-2"
              >
                <span className="text-base">{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function StudioRibbon(props: Props) {
  const {
    doc, slideN, selectedElement,
    onDelete, onDuplicate, onInsertShape, onInsertChart, onInsertTable,
    onStartDraw, drawMode, onCancelDraw,
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

  // Extended props accessed via cast (optional handlers from Studio)
  const p = props as Record<string, unknown>
  const onFormatPaint      = p.onFormatPaint      as (() => void) | undefined
  const formatPaintMode    = p.formatPaintMode     as boolean | undefined
  const onImportSlides     = p.onImportSlides      as ((f: File) => void) | undefined
  const onSaveToCloud      = p.onSaveToCloud       as (() => void) | undefined
  const savingToCloud      = p.savingToCloud       as boolean | undefined
  const onRerenderAll      = p.onRerenderAll       as (() => void) | undefined
  const rerenderingAll     = p.rerenderingAll      as boolean | undefined
  const onFindReplace      = p.onToggleFindReplace as (() => void) | undefined
  const findReplaceOpen    = p.findReplaceOpen     as boolean | undefined
  const onApplyLayout      = p.onApplyLayout       as ((preset: string) => void) | undefined
  const onGenerateSlide    = p.onGenerateSlide     as (() => void) | undefined
  const generating         = p.generating          as boolean | undefined
  const onCopyToSlide      = p.onCopyToSlide       as (() => void) | undefined
  const onGroupElements    = p.onGroupElements     as (() => void) | undefined
  const onUngroupElement   = p.onUngroupElement    as (() => void) | undefined
  const onAlignElements    = p.onAlignElements     as ((a: string) => void) | undefined
  const multiCount         = (p.multiSelectIds as Set<string> | undefined)?.size ?? 0
  const onOptimizeLayout   = p.onOptimizeLayout    as (() => void) | undefined
  const optimizingLayout   = p.optimizingLayout    as boolean | undefined
  const onColorSwapAny     = p.onColorSwap         as (() => void) | undefined
  const onThemeGen         = p.onThemeGen          as (() => void) | undefined
  const onVariation        = p.onVariation         as (() => void) | undefined
  const onTranslate        = p.onTranslate         as (() => void) | undefined
  const onCompare          = p.onCompare           as (() => void) | undefined
  const onBrandCheck       = p.onBrandCheck        as (() => void) | undefined
  const onDeckHealth       = p.onDeckHealth        as (() => void) | undefined
  const onRehearse         = p.onRehearsal         as (() => void) | undefined
  const onAICoach          = p.onCoach             as (() => void) | undefined
  const onDeckSummary      = p.onDeckSummary       as (() => void) | undefined
  const onSlideNumbers     = p.onSlideNumbers      as (() => void) | undefined
  const onWatermark        = p.onWatermark         as (() => void) | undefined
  const onAgendaSlide      = p.onAgendaSlide       as (() => void) | undefined
  const onTextFormatCommit = p.onTextFormatCommit  as (() => void) | undefined
  const onCommitPosition   = p.onCommitPosition    as ((l: number, t: number, w: number, h: number) => void) | undefined
  const onCommitZIndex     = p.onCommitZIndex      as ((z: number) => void) | undefined

  const [exportOpen, setExportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importRef    = useRef<HTMLInputElement>(null)

  const docName = doc.name.replace(/\.pptx$/i, "")

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && props.onInsertImage) props.onInsertImage(f)
    e.target.value = ""
  }

  const handleImportPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && onImportSlides) onImportSlides(f)
    e.target.value = ""
  }

  const arrange = useCallback((action: "front" | "forward" | "backward" | "back") => {
    if (!selectedElement || !onCommitZIndex) return
    const z = selectedElement.z_index
    const next = action === "front" ? 9999 : action === "forward" ? z + 1 : action === "backward" ? Math.max(1, z - 1) : 1
    onCommitZIndex(next)
  }, [selectedElement, onCommitZIndex])

  // ── File menu items ────────────────────────────────────────────────────────
  const fileMenuItems: GMenuItem[] = [
    ...(onSaveToCloud ? [{ label: savingToCloud ? "Saving…" : "Save to cloud", icon: "💾", onClick: onSaveToCloud, disabled: savingToCloud }] : []),
    ...(onImportSlides ? [{ label: "Import slides", icon: "📥", onClick: () => importRef.current?.click() }] : []),
    { label: rebuilding ? "Rebuilding…" : "Rebuild renders", icon: "⟳", onClick: onRebuild, disabled: rebuilding },
    ...(onRerenderAll ? [{ label: rerenderingAll ? "Rerendering…" : "Rerender all slides", icon: "⟳", onClick: onRerenderAll, disabled: rerenderingAll }] : []),
    { separator: true },
    { label: "Export PowerPoint (.pptx)", icon: "↓", onClick: () => { window.open(props.onInsertShape ? `${window.location.origin}/api/docs/${doc.doc_id}/export/pptx` : "#", "_blank") } },
    { label: "Export PDF", icon: "↓", onClick: () => window.open(`/api/docs/${doc.doc_id}/export/pdf`, "_blank") },
    { label: "Export PNG slides (zip)", icon: "↓", onClick: () => window.open(`/api/docs/${doc.doc_id}/export/png-zip`, "_blank") },
    { label: "Export HTML slideshow", icon: "↓", onClick: () => window.open(`/api/docs/${doc.doc_id}/export/html`, "_blank") },
    { label: "Export Markdown outline", icon: "↓", onClick: () => window.open(`/api/docs/${doc.doc_id}/export/markdown`, "_blank") },
    { label: "Export speaker notes (.md)", icon: "↓", onClick: () => window.open(`/api/docs/${doc.doc_id}/notes/export/md`, "_blank") },
  ]

  // ── Edit menu items ────────────────────────────────────────────────────────
  const editMenuItems: GMenuItem[] = [
    { label: undoDepth ? `Undo (${undoDepth} steps)` : "Undo", icon: "↩", shortcut: "Ctrl+Z", onClick: onUndo, disabled: !onUndo || undoDepth === 0 },
    { label: redoDepth ? `Redo (${redoDepth} steps)` : "Redo", icon: "↪", shortcut: "Ctrl+Y", onClick: onRedo, disabled: !onRedo || redoDepth === 0 },
    { separator: true },
    { label: "Duplicate element", icon: "⊕", shortcut: "Ctrl+D", onClick: onDuplicate, disabled: !selectedElement },
    { label: "Delete element", icon: "✕", shortcut: "Del", onClick: onDelete, disabled: !selectedElement },
    { separator: true },
    ...(onFindReplace ? [{ label: "Find & replace", icon: "🔍", shortcut: "Ctrl+H", onClick: onFindReplace, active: findReplaceOpen }] : []),
    ...(onFormatPaint ? [{ label: "Format paint", icon: "🖌", onClick: onFormatPaint, active: formatPaintMode }] : []),
  ]

  // ── View menu items ────────────────────────────────────────────────────────
  const viewMenuItems: GMenuItem[] = [
    { label: outlineOpen ? "Hide outline panel" : "Show outline panel", icon: "≡", onClick: onToggleOutline, active: outlineOpen },
    { label: layersOpen ? "Hide layers panel" : "Show layers", icon: "◫", onClick: onToggleLayers, active: layersOpen },
    { label: commentsOpen ? "Hide comments" : "Show comments", icon: "💬", onClick: onToggleComments, active: commentsOpen },
    { separator: true },
    { label: "Slide sorter", icon: "▦", shortcut: "Ctrl+Shift+S", onClick: onShowSlideSorter },
    ...(onPresent ? [{ label: "Present", icon: "▶", shortcut: "Ctrl+F5", onClick: onPresent }] : []),
    { separator: true },
    ...(onShowShortcuts ? [{ label: "Keyboard shortcuts", icon: "⌨", shortcut: "Ctrl+/", onClick: onShowShortcuts }] : []),
    ...(onShowStats ? [{ label: "Presentation statistics", icon: "📊", onClick: onShowStats }] : []),
  ]

  // ── Insert menu items ──────────────────────────────────────────────────────
  const insertMenuItems: GMenuItem[] = [
    { label: "Text box", icon: "T", onClick: () => onInsertShape("text_box") },
    { label: "Image", icon: "🖼", onClick: () => fileInputRef.current?.click() },
    { separator: true },
    { label: "Shape: Rectangle", icon: "▭", onClick: () => onInsertShape("rect") },
    { label: "Shape: Ellipse", icon: "○", onClick: () => onInsertShape("ellipse") },
    { label: "Shape: Triangle", icon: "△", onClick: () => onInsertShape("triangle") },
    { label: "Shape: Arrow", icon: "→", onClick: () => onInsertShape("rightArrow") },
    { separator: true },
    { label: "Chart", icon: "📊", onClick: () => onInsertChart?.() },
    ...(onStartDraw ? [
      { separator: true },
      { label: drawMode === "pen" ? "Drawing (pen active)" : "Draw with Pen", icon: "✒", onClick: () => onStartDraw("pen"), active: drawMode === "pen" },
      { label: drawMode === "polygon" ? "Drawing (polygon active)" : "Draw Polygon", icon: "⬡", onClick: () => onStartDraw("polygon"), active: drawMode === "polygon" },
      ...(drawMode ? [{ label: "Cancel drawing", icon: "✕", onClick: onCancelDraw }] : []),
    ] : []),
  ]

  // ── Format menu items ──────────────────────────────────────────────────────
  const formatMenuItems: GMenuItem[] = [
    ...(onColorSwapAny ? [{ label: "Color swap", icon: "🎨", onClick: onColorSwapAny }] : []),
    ...(onFontSwap ? [{ label: "Font swap", icon: "Ff", onClick: onFontSwap }] : []),
    ...(onTemplateVars ? [{ label: "Template variables", icon: "{}", onClick: onTemplateVars }] : []),
    { separator: true },
    ...(onApplyLayout ? [
      { label: "Apply layout: Title slide", icon: "□", onClick: () => onApplyLayout("title") },
      { label: "Apply layout: Title + content", icon: "▭", onClick: () => onApplyLayout("title_content") },
      { label: "Apply layout: Blank", icon: "□", onClick: () => onApplyLayout("blank") },
    ] : []),
    ...(onSlideNumbers ? [{ separator: true }, { label: "Slide numbers", icon: "#", onClick: onSlideNumbers }] : []),
    ...(onWatermark ? [{ label: "Watermark", icon: "⟨⟩", onClick: onWatermark }] : []),
  ]

  // ── Slide menu items ───────────────────────────────────────────────────────
  const slideMenuItems: GMenuItem[] = [
    ...(onTransitions ? [{ label: "Transitions", icon: "⇄", onClick: onTransitions }] : []),
    ...(onThemeGen ? [{ label: "Theme generator", icon: "🎨", onClick: onThemeGen }] : []),
    ...(onVariation ? [{ label: "Slide variation", icon: "⊞", onClick: onVariation }] : []),
    ...(onAgendaSlide ? [{ label: "Generate agenda slide", icon: "≡", onClick: onAgendaSlide }] : []),
  ]

  // ── Arrange menu items ─────────────────────────────────────────────────────
  const arrangeMenuItems: GMenuItem[] = [
    { label: "Bring to front", icon: "⇈", shortcut: "Ctrl+Shift+]", onClick: () => arrange("front"), disabled: !selectedElement },
    { label: "Bring forward",  icon: "↑", shortcut: "Ctrl+]",       onClick: () => arrange("forward"),  disabled: !selectedElement },
    { label: "Send backward",  icon: "↓", shortcut: "Ctrl+[",       onClick: () => arrange("backward"), disabled: !selectedElement },
    { label: "Send to back",   icon: "⇊", shortcut: "Ctrl+Shift+[", onClick: () => arrange("back"),    disabled: !selectedElement },
    ...(onAlignElements ? [
      { separator: true },
      { label: "Align left",            icon: "⫷", onClick: () => onAlignElements("left") },
      { label: "Center horizontally",   icon: "⊟", onClick: () => onAlignElements("center") },
      { label: "Align right",           icon: "⫸", onClick: () => onAlignElements("right") },
      { label: "Align top",             icon: "⫶", onClick: () => onAlignElements("top") },
      { label: "Center vertically",     icon: "⊟", onClick: () => onAlignElements("middle") },
      { label: "Align bottom",          icon: "⫶", onClick: () => onAlignElements("bottom") },
    ] : []),
    ...(onGroupElements || onUngroupElement ? [
      { separator: true },
      ...(onGroupElements && multiCount >= 2 ? [{ label: "Group", icon: "◳", shortcut: "Ctrl+G", onClick: onGroupElements }] : []),
      ...(onUngroupElement ? [{ label: "Ungroup", icon: "◰", shortcut: "Ctrl+Shift+G", onClick: onUngroupElement }] : []),
    ] : []),
    ...(onCopyToSlide ? [
      { separator: true },
      { label: "Copy to slide…", icon: "⇥", onClick: onCopyToSlide },
    ] : []),
  ]

  // ── Tools menu items ───────────────────────────────────────────────────────
  const toolsMenuItems: GMenuItem[] = [
    ...(onGrammarCheck ? [{ label: "Grammar check", icon: "✓", onClick: onGrammarCheck }] : []),
    ...(onCompare ? [{ label: "Compare slides", icon: "⊞", onClick: onCompare }] : []),
    ...(onTranslate ? [{ label: "Translate", icon: "🌐", onClick: onTranslate }] : []),
    ...(onOptimizeLayout ? [{ label: optimizingLayout ? "Optimizing…" : "Optimize layout", icon: "◻", onClick: onOptimizeLayout, disabled: optimizingLayout }] : []),
    { separator: true },
    ...(onGenerateSlide ? [{ label: generating ? "Generating…" : "Generate slide content", icon: "✦", onClick: onGenerateSlide, disabled: generating }] : []),
    ...(onBrandCheck ? [{ label: "Brand check", icon: "🏷", onClick: onBrandCheck }] : []),
    ...(onDeckHealth ? [{ label: "Deck health", icon: "💊", onClick: onDeckHealth }] : []),
    ...(onAICoach ? [{ label: "Presentation coach", icon: "🎓", onClick: onAICoach }] : []),
    ...(onDeckSummary ? [{ label: "Deck summary", icon: "📋", onClick: onDeckSummary }] : []),
    ...(onRehearse ? [{ label: "Rehearsal timer", icon: "⏱", onClick: onRehearse }] : []),
  ]

  // ── Extensions (AI) menu ───────────────────────────────────────────────────
  const extItems: GMenuItem[] = [
    ...(onAIScore ? [{ label: "AI presentation score", icon: "★", onClick: onAIScore }] : []),
    ...(p.onReorder ? [{ label: "Reorder suggestions", icon: "↕", onClick: p.onReorder as () => void }] : []),
    ...(p.onReadability ? [{ label: "Readability", icon: "📖", onClick: p.onReadability as () => void }] : []),
    ...(p.onContentDensity ? [{ label: "Content density", icon: "≡", onClick: p.onContentDensity as () => void }] : []),
    ...(p.onEmotionalTone ? [{ label: "Emotional tone", icon: "🎭", onClick: p.onEmotionalTone as () => void }] : []),
    ...(p.onImpactScores ? [{ label: "Impact scores", icon: "📈", onClick: p.onImpactScores as () => void }] : []),
    ...(p.onAccessibility ? [{ label: "Accessibility report", icon: "♿", onClick: p.onAccessibility as () => void }] : []),
  ]

  return (
    <div style={{ fontFamily: "'Google Sans',Roboto,'Helvetica Neue',Arial,sans-serif", background: "#fff", borderBottom: "1px solid #e0e0e0", userSelect: "none" }}>
      {/* ── Row 1: Menu bar ──────────────────────────────────────────────── */}
      <div className="h-10 flex items-center px-2 gap-0 shrink-0">
        {/* Percy logo mark */}
        <div className="w-9 h-9 flex items-center justify-center mr-1 shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="14" rx="2" fill="#4285F4"/>
            <rect x="5" y="7" width="14" height="2" rx="1" fill="white" opacity="0.9"/>
            <rect x="5" y="11" width="10" height="2" rx="1" fill="white" opacity="0.7"/>
            <rect x="5" y="15" width="7" height="1.5" rx="0.75" fill="white" opacity="0.5"/>
          </svg>
        </div>

        {/* Document name */}
        <span className="text-[18px] font-normal text-[#202124] mr-3 max-w-[18rem] truncate shrink-0">
          {docName}
        </span>

        {/* Menu items */}
        <GMenuBtn label="File"       items={fileMenuItems} />
        <GMenuBtn label="Edit"       items={editMenuItems} />
        <GMenuBtn label="View"       items={viewMenuItems} />
        <GMenuBtn label="Insert"     items={insertMenuItems} />
        <GMenuBtn label="Format"     items={formatMenuItems} disabled={formatMenuItems.length === 0} />
        {slideMenuItems.length > 0 && <GMenuBtn label="Slide" items={slideMenuItems} />}
        <GMenuBtn label="Arrange"    items={arrangeMenuItems} />
        {toolsMenuItems.length > 0 && <GMenuBtn label="Tools" items={toolsMenuItems} />}
        {extItems.length > 0 && <GMenuBtn label="Extensions" items={extItems} />}
        {onShowShortcuts && <GMenuBtn label="Help" items={[{ label: "Keyboard shortcuts", icon: "⌨", shortcut: "Ctrl+/", onClick: onShowShortcuts }]} />}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Slide counter */}
        <span className="text-[11px] text-[#80868b] shrink-0 mr-3">
          Slide {slideN} / {doc.slide_count}
        </span>

        {/* Share */}
        {onShare && (
          <button
            onClick={onShare}
            className="h-8 px-4 rounded-full text-[13px] font-medium bg-[#1a73e8] text-white hover:bg-[#1765cc] transition-colors flex items-center gap-1.5 shrink-0 mr-2"
          >
            Share
          </button>
        )}

        {/* Export */}
        <div className="relative shrink-0 mr-1">
          <button
            onClick={() => setExportOpen((o) => !o)}
            className="h-8 px-3 rounded text-[13px] text-[#3c4043] hover:bg-[#f1f3f4] border border-[#dadce0] flex items-center gap-1 transition-colors"
          >
            Export ▾
          </button>
          {exportOpen && (
            <ExportMenu docId={doc.doc_id} onClose={() => setExportOpen(false)} />
          )}
        </div>

        {/* AI panel toggle */}
        <button
          onClick={onToggleChat}
          title={chatOpen ? "Collapse AI panel" : "Open AI panel"}
          className={`h-8 px-3 rounded text-[13px] flex items-center gap-1 transition-colors border shrink-0 ${
            chatOpen
              ? "bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]/30"
              : "text-[#3c4043] hover:bg-[#f1f3f4] border-[#dadce0]"
          }`}
        >
          ✦ AI
        </button>
      </div>

      {/* ── Row 2: Toolbar ───────────────────────────────────────────────── */}
      <div className="h-10 flex items-center px-2 gap-0.5 bg-[#f8f9fa] border-t border-[#e0e0e0] shrink-0">
        {/* Undo / Redo */}
        <TBtn icon="↩" title={`Undo${undoDepth ? ` (${undoDepth})` : ""} — Ctrl+Z`} onClick={onUndo} disabled={!onUndo || undoDepth === 0} />
        <TBtn icon="↪" title={`Redo${redoDepth ? ` (${redoDepth})` : ""} — Ctrl+Y`} onClick={onRedo} disabled={!onRedo || redoDepth === 0} />

        {/* Rebuild */}
        <TBtn icon={rebuilding ? "…" : "⟳"} title="Rebuild slide renders" onClick={onRebuild} disabled={rebuilding} />

        {/* Format paint */}
        {onFormatPaint && (
          <>
            <TDivider />
            <TBtn icon="🖌" title="Format paint" onClick={onFormatPaint} active={formatPaintMode} />
          </>
        )}

        <TDivider />

        {/* Insert tools */}
        <TBtn icon="T" title="Text box" onClick={() => onInsertShape("text_box")} />
        <TBtn icon="🖼" title="Image" onClick={() => fileInputRef.current?.click()} />
        <ShapesToolBtn onInsertShape={onInsertShape} />
        <TableToolBtn onInsertTable={onInsertTable} />
        <ChartToolBtn onInsertChart={onInsertChart} />

        {/* Draw tools */}
        {onStartDraw && (
          <>
            <TDivider />
            <TBtn icon="✒" title="Draw pen path" onClick={() => onStartDraw("pen")} active={drawMode === "pen"} />
            <TBtn icon="⬡" title="Draw polygon" onClick={() => onStartDraw("polygon")} active={drawMode === "polygon"} />
            {drawMode && <TBtn icon="✕" title="Cancel drawing (Esc)" onClick={onCancelDraw} />}
          </>
        )}

        {/* Arrange shortcuts — contextual */}
        {selectedElement && (
          <>
            <TDivider />
            <TBtn icon="⊕" title="Duplicate (Ctrl+D)" onClick={onDuplicate} />
            <TBtn icon="✕" title="Delete (Del)" onClick={onDelete} />
            {multiCount >= 2 && onAlignElements && (
              <TBtn icon="⊟" title="Center elements" onClick={() => onAlignElements("center")} />
            )}
            {onGroupElements && multiCount >= 2 && (
              <TBtn icon="◳" title="Group (Ctrl+G)" onClick={onGroupElements} />
            )}
            {onUngroupElement && (
              <TBtn icon="◰" title="Ungroup" onClick={onUngroupElement} />
            )}
          </>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFilePicked} className="hidden" />
      <input ref={importRef} type="file" accept=".pptx,.ppt" onChange={handleImportPicked} className="hidden" />
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
