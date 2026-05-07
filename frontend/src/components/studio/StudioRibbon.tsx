import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import type { DocInfo } from "../../lib/types"
import {
  exportPptxUrl, exportPdfUrl, exportPngZipUrl,
  notesExportUrl, notesHtmlExportUrl, exportHtmlUrl, exportMarkdownUrl,
} from "../../lib/studioApi"
import TextFormatGroup, { isTextCapable } from "./TextFormatGroup"

// ── shared low-level controls ────────────────────────────────────────────────

function PosInput({ label, value, disabled, onChange, onCommit }: {
  label: string; value: string; disabled: boolean
  onChange: (v: string) => void; onCommit: () => void
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[9px] text-muted/80 w-3 shrink-0 select-none">{label}</span>
      <input
        type="number" step="0.001" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        className="w-14 text-[11px] font-mono bg-base border border-edge rounded px-1 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent
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
  primary?: boolean   // primary = big icon + label below; non-primary = compact horizontal
}

function RibbonBtn({ icon, label, title, onClick, disabled, active, danger, primary }: RibbonBtnProps) {
  const base = "flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
  const tone = active
    ? "text-accent bg-accent/15 border border-accent/40"
    : danger
      ? "text-bad/80 hover:text-bad hover:bg-bad/10"
      : "text-slate-200 hover:bg-white/8"
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

function GroupBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-[88px] shrink-0">
      <div className="flex-1 flex items-center gap-1 px-2">{children}</div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-muted/60 text-center pt-0.5 pb-1 border-t border-edge/40">
        {title}
      </div>
    </div>
  )
}

function GroupDivider() {
  return <div className="w-px h-[72px] self-center bg-edge/50 mx-0.5 shrink-0" />
}

// ── insert shapes catalog ────────────────────────────────────────────────────

const INSERT_SHAPES: Array<{ label: string; value: string; icon: string }> = [
  { label: "Text Box",       value: "text_box",   icon: "T" },
  { label: "Rectangle",      value: "rect",       icon: "▭" },
  { label: "Rounded Rect",   value: "roundRect",  icon: "▢" },
  { label: "Ellipse",        value: "ellipse",    icon: "○" },
  { label: "Triangle",       value: "triangle",   icon: "△" },
  { label: "Diamond",        value: "diamond",    icon: "◇" },
  { label: "Pentagon",       value: "pentagon",   icon: "⬠" },
  { label: "Hexagon",        value: "hexagon",    icon: "⬡" },
  { label: "Star",           value: "star5",      icon: "★" },
  { label: "Arrow Right",    value: "rightArrow", icon: "→" },
  { label: "Arrow Left",     value: "leftArrow",  icon: "←" },
  { label: "Banner",         value: "ribbon",     icon: "≣" },
]

// ── alignment buttons ────────────────────────────────────────────────────────

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

// ── Props (subset of the legacy StudioToolbar — keeps backward compat for the
//   ones we use; everything passed-but-unused is silently ignored) ────────────

type Tab = "home" | "insert" | "design" | "view" | "ai"

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
  /** Called after a text-format commit so the parent can re-render the canvas. */
  onTextFormatCommit?: () => void
  onShare?: () => void
}

// ── Top-level ────────────────────────────────────────────────────────────────

export default function StudioRibbon(props: Props) {
  const {
    doc, slideN, slideWidthIn, slideHeightIn, selectedElement,
    onCommitPosition, onCommitZIndex,
    onDelete, onDuplicate, onInsertShape, onInsertImage,
    onRebuild, rebuilding,
    chatOpen, onToggleChat,
    onShowShortcuts, onShowSlideSorter, onPresent,
    layersOpen, onToggleLayers,
    commentsOpen, onToggleComments,
    onColorSwap, onShowStats, onFontSwap, onTemplateVars,
    outlineOpen, onToggleOutline,
    onShare,
  } = props

  const [tab, setTab] = useState<Tab>("home")
  const [exportOpen, setExportOpen]     = useState(false)
  const [shapesOpen, setShapesOpen]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    const next = action === "front" ? 9999
      : action === "forward" ? z + 1
      : action === "backward" ? Math.max(1, z - 1)
      : 1
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

  return (
    <div className="shrink-0 border-b border-edge bg-surface/95 select-none">
      {/* ── tab strip ─────────────────────────────────────────────────── */}
      <div className="h-8 flex items-center px-3 gap-0.5 border-b border-edge/60 bg-base/40">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Slide</span>
        <span className="text-[11px] text-paper font-medium ml-1.5">{slideN}</span>
        <span className="text-muted/60 text-[10px] mx-1">/</span>
        <span className="text-[11px] text-muted">{doc.slide_count}</span>

        <div className="w-px h-4 bg-edge mx-3" />

        {/* tabs sit inline in the same strip — no second header row */}
        {(["home", "insert", "design", "view"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[
              "px-3 h-full text-[11px] capitalize transition-colors relative",
              tab === t
                ? "text-paper bg-surface"
                : "text-muted hover:text-paper",
            ].join(" ")}
          >
            {t}
            {tab === t && <span className="absolute left-1/2 -translate-x-1/2 -top-px w-6 h-0.5 bg-accent" />}
          </button>
        ))}

        <div className="flex-1" />

        {onShare && (
          <button
            onClick={onShare}
            className="px-2.5 h-6 rounded text-[11px] bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-400/30 flex items-center gap-1 mr-1"
            title="Share this project"
          >
            ↗ Share
          </button>
        )}
        <button
          onClick={() => setExportOpen((o) => !o)}
          className="px-2 h-6 rounded text-[11px] bg-white/5 text-slate-200 hover:bg-white/10 border border-edge flex items-center gap-1"
        >
          ↓ Export ▾
        </button>
        <button
          onClick={onRebuild}
          disabled={rebuilding}
          className="ml-1 px-2.5 h-6 rounded text-[11px] bg-accent/25 text-accent hover:bg-accent/35 border border-accent/40 disabled:opacity-50 flex items-center gap-1"
        >
          {rebuilding && <span className="inline-block w-2 h-2 border border-accent border-t-transparent rounded-full animate-spin" />}
          Rebuild
        </button>
        <button
          onClick={onToggleChat}
          title={chatOpen ? "Collapse AI panel" : "Expand AI panel"}
          className={`ml-1 px-2 h-6 rounded text-[11px] border flex items-center gap-1 ${
            chatOpen
              ? "bg-white/10 text-slate-100 border-white/20"
              : "bg-white/5 text-muted border-edge hover:bg-white/10"
          }`}
        >✦ AI</button>
      </div>

      {/* ── ribbon body ───────────────────────────────────────────────── */}
      <div className="relative">
        {tab === "home"   && <HomeRibbon
          noSel={noSel}
          x={x} y={y} w={w} h={h} setX={setX} setY={setY} setW={setW} setH={setH}
          commitPos={commitPos} selectedElement={selectedElement}
          arrange={arrange} align={align}
          onDelete={onDelete} onDuplicate={onDuplicate}
          onGroup={props.onGroupElements}
          onUngroup={props.onUngroupElement}
          multiCount={props.multiSelectIds?.size ?? 0}
          onAlignElements={props.onAlignElements}
          docId={doc.doc_id}
          slideN={slideN}
          onTextFormatCommit={props.onTextFormatCommit}
        />}
        {tab === "insert" && <InsertRibbon
          shapesOpen={shapesOpen} setShapesOpen={setShapesOpen}
          onInsertShape={onInsertShape}
          onPickImage={() => fileInputRef.current?.click()}
        />}
        {tab === "design" && <DesignRibbon
          onColorSwap={onColorSwap}
          onFontSwap={onFontSwap}
          onTemplateVars={onTemplateVars}
        />}
        {tab === "view"   && <ViewRibbon
          layersOpen={!!layersOpen} onToggleLayers={onToggleLayers}
          outlineOpen={!!outlineOpen} onToggleOutline={onToggleOutline}
          commentsOpen={!!commentsOpen} onToggleComments={onToggleComments}
          onShowSlideSorter={onShowSlideSorter}
          onPresent={onPresent}
          onShowStats={onShowStats}
          onShowShortcuts={onShowShortcuts}
        />}

        {/* export menu — common to all tabs */}
        {exportOpen && (
          <ExportMenu
            docId={doc.doc_id}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFilePicked} className="hidden" />
    </div>
  )
}

// ── HOME tab ─────────────────────────────────────────────────────────────────

function HomeRibbon({
  noSel, x, y, w, h, setX, setY, setW, setH, commitPos, selectedElement,
  arrange, align, onDelete, onDuplicate, onGroup, onUngroup,
  multiCount, onAlignElements,
  docId, slideN, onTextFormatCommit,
}: {
  noSel: boolean
  x: string; y: string; w: string; h: string
  setX: (v: string) => void; setY: (v: string) => void; setW: (v: string) => void; setH: (v: string) => void
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
  docId: string
  slideN: number
  onTextFormatCommit?: () => void
}) {
  // Empty-state: slim 36px hint row instead of a 100px-tall set of greyed groups.
  // The user can still feel the chrome is "there" without it eating canvas room.
  if (noSel) {
    return (
      <div className="flex h-9 items-center px-4 gap-3 text-[11px] text-muted">
        <span className="uppercase tracking-[0.18em] text-muted/60 text-[10px]">Home</span>
        <span className="text-edge">·</span>
        <span>Click an element on the canvas to edit, or use</span>
        <span className="text-paper bg-surface px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.14em]">Insert</span>
        <span>to add something new.</span>
      </div>
    )
  }
  const showTextGroup = isTextCapable(selectedElement)
  return (
    <div className="flex h-[100px] items-stretch">
      {/* Text formatting — only for text-capable elements (PowerPoint Home tab parity). */}
      {showTextGroup && selectedElement && (
        <>
          <GroupBox title="Text">
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
      )}
      {/* Element actions group */}
      <GroupBox title="Element">
        <RibbonBtn primary icon="⧉" label="Duplicate" disabled={noSel} onClick={onDuplicate} title="Duplicate (Ctrl+D)" />
        <div className="flex flex-col gap-0.5">
          <RibbonBtn icon="✕" label="Delete" disabled={noSel} onClick={onDelete} danger title="Delete" />
          {onGroup  && <RibbonBtn icon="◳" label="Group"   disabled={noSel} onClick={onGroup}   title="Group selected" />}
          {onUngroup && <RibbonBtn icon="◰" label="Ungroup" disabled={noSel} onClick={onUngroup} title="Ungroup" />}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Position group */}
      <GroupBox title="Position">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-1">
          <PosInput label="X" value={x} disabled={noSel} onChange={setX} onCommit={commitPos} />
          <PosInput label="W" value={w} disabled={noSel} onChange={setW} onCommit={commitPos} />
          <PosInput label="Y" value={y} disabled={noSel} onChange={setY} onCommit={commitPos} />
          <PosInput label="H" value={h} disabled={noSel} onChange={setH} onCommit={commitPos} />
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Align group */}
      <GroupBox title="Align">
        <div className="grid grid-cols-3 gap-0.5">
          {ALIGN_BUTTONS.map((b) => (
            <button key={b.title} title={b.title} disabled={noSel}
              onClick={() => align(b)}
              className="w-7 h-7 flex items-center justify-center text-xs text-slate-200 hover:bg-white/8 rounded disabled:opacity-30">
              <span className="text-[11px]">{b.key}</span>
            </button>
          ))}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Arrange / z-order group */}
      <GroupBox title="Arrange">
        <div className="grid grid-cols-2 gap-0.5">
          {ARRANGE_BUTTONS.map((b) => (
            <button key={b.title} title={b.title} disabled={noSel}
              onClick={() => arrange(b.action)}
              className="w-14 h-6 flex items-center justify-start gap-1 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded disabled:opacity-30">
              <span className="text-[12px]">{b.icon}</span>
              <span>{b.title.split(" ")[0]}</span>
            </button>
          ))}
        </div>
        {selectedElement && <span className="text-[10px] text-muted/70 font-mono pl-1">z={selectedElement.z_index}</span>}
      </GroupBox>

      {multiCount >= 2 && onAlignElements && (
        <>
          <GroupDivider />
          {/* Distribute group — only meaningful with 2+ elements selected */}
          <GroupBox title={`Distribute · ${multiCount}`}>
            <div className="grid grid-cols-2 gap-0.5">
              <button title="Align left edges"   onClick={() => onAlignElements("left")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⫷</span><span>Left</span></button>
              <button title="Align right edges"  onClick={() => onAlignElements("right")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⫸</span><span>Right</span></button>
              <button title="Align top edges"    onClick={() => onAlignElements("top")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⫶</span><span>Top</span></button>
              <button title="Align bottom edges" onClick={() => onAlignElements("bottom")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⫶</span><span>Bot</span></button>
              <button title="Center horizontally" onClick={() => onAlignElements("center")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⊟</span><span>Cx</span></button>
              <button title="Center vertically"   onClick={() => onAlignElements("middle")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1"><span>⊟</span><span>Cy</span></button>
            </div>
          </GroupBox>

          <GroupDivider />

          <GroupBox title="Spread">
            <div className="flex flex-col gap-0.5">
              <button title="Distribute horizontally with equal gaps" disabled={multiCount < 3}
                onClick={() => onAlignElements("distribute_h")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1 disabled:opacity-30">
                <span>↔</span><span>Distribute H</span>
              </button>
              <button title="Distribute vertically with equal gaps" disabled={multiCount < 3}
                onClick={() => onAlignElements("distribute_v")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1 disabled:opacity-30">
                <span>↕</span><span>Distribute V</span>
              </button>
              <button title="Match all to widest" onClick={() => onAlignElements("match_width")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1">
                <span>≡</span><span>Match W</span>
              </button>
              <button title="Match all to tallest" onClick={() => onAlignElements("match_height")}
                className="h-6 px-1.5 text-[11px] text-slate-200 hover:bg-white/8 rounded flex items-center gap-1">
                <span>≡</span><span>Match H</span>
              </button>
            </div>
          </GroupBox>
        </>
      )}
    </div>
  )
}

// ── INSERT tab ───────────────────────────────────────────────────────────────

function InsertRibbon({
  shapesOpen, setShapesOpen, onInsertShape, onPickImage,
}: {
  shapesOpen: boolean
  setShapesOpen: (o: boolean) => void
  onInsertShape: (shape: string) => void
  onPickImage: () => void
}) {
  return (
    <div className="flex h-[100px] items-stretch">
      {/* Text & Shapes */}
      <GroupBox title="Text & Shapes">
        <RibbonBtn primary icon="T" label="Text Box"  onClick={() => onInsertShape("text_box")} />
        <div className="grid grid-cols-3 gap-0.5">
          <ShapeQuickBtn icon="▭" title="Rectangle"  onClick={() => onInsertShape("rect")} />
          <ShapeQuickBtn icon="○" title="Ellipse"    onClick={() => onInsertShape("ellipse")} />
          <ShapeQuickBtn icon="△" title="Triangle"   onClick={() => onInsertShape("triangle")} />
          <ShapeQuickBtn icon="◇" title="Diamond"    onClick={() => onInsertShape("diamond")} />
          <ShapeQuickBtn icon="★" title="Star"       onClick={() => onInsertShape("star5")} />
          <ShapeQuickBtn icon="→" title="Arrow"      onClick={() => onInsertShape("rightArrow")} />
        </div>
        <div className="relative">
          <button
            onClick={() => setShapesOpen(!shapesOpen)}
            className="px-1.5 h-6 text-[11px] text-slate-200 hover:bg-white/8 rounded border border-edge flex items-center gap-1"
          >More ▾</button>
          {shapesOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShapesOpen(false)} />
              <div className="absolute z-50 right-0 top-full mt-1 w-44 bg-surface border border-edge rounded shadow-xl py-1 grid grid-cols-3 gap-0.5 p-1">
                {INSERT_SHAPES.map((s) => (
                  <button key={s.value} title={s.label}
                    onClick={() => { setShapesOpen(false); onInsertShape(s.value) }}
                    className="aspect-square flex flex-col items-center justify-center text-slate-200 hover:bg-white/10 rounded">
                    <span className="text-base leading-none">{s.icon}</span>
                    <span className="text-[8px] text-muted/70 mt-0.5 leading-none">{s.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </GroupBox>

      <GroupDivider />

      {/* Media */}
      <GroupBox title="Media">
        <RibbonBtn primary icon="🖼" label="Image" onClick={onPickImage} title="Insert image (file picker)" />
      </GroupBox>

      <GroupDivider />

      {/* Data — these route through the existing studio handlers */}
      <GroupBox title="Data">
        <RibbonBtn icon="📊" label="Chart"  disabled title="Coming soon — use right-click → Edit Connect for now" />
        <RibbonBtn icon="▦"  label="Table"  disabled />
        <RibbonBtn icon="—"  label="Connector" disabled />
      </GroupBox>
    </div>
  )
}

function ShapeQuickBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className="w-7 h-7 flex items-center justify-center text-base text-slate-200 hover:bg-white/8 rounded">
      {icon}
    </button>
  )
}

// ── DESIGN tab ───────────────────────────────────────────────────────────────

function DesignRibbon({
  onColorSwap, onFontSwap, onTemplateVars,
}: {
  onColorSwap?: () => void
  onFontSwap?: () => void
  onTemplateVars?: () => void
}) {
  return (
    <div className="flex h-[100px] items-stretch">
      <GroupBox title="Theme">
        <RibbonBtn primary icon="🎨" label="Colors" onClick={onColorSwap}    disabled={!onColorSwap} title="Swap theme colors across the deck" />
        <RibbonBtn primary icon="A"  label="Fonts"  onClick={onFontSwap}     disabled={!onFontSwap}  title="Swap fonts across the deck" />
        <RibbonBtn primary icon="⚙"  label="Vars"   onClick={onTemplateVars} disabled={!onTemplateVars} title="Template variables" />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Background">
        <div className="text-[10px] text-muted px-2 self-center max-w-[12rem] leading-snug">
          Use the <span className="text-accent">Slide</span> properties panel
          (right side, when no element selected) to set background color, gradient,
          or apply to all slides.
        </div>
      </GroupBox>
    </div>
  )
}

// ── VIEW tab ─────────────────────────────────────────────────────────────────

function ViewRibbon({
  layersOpen, onToggleLayers,
  outlineOpen, onToggleOutline,
  commentsOpen, onToggleComments,
  onShowSlideSorter, onPresent, onShowStats, onShowShortcuts,
}: {
  layersOpen: boolean
  onToggleLayers?: () => void
  outlineOpen: boolean
  onToggleOutline?: () => void
  commentsOpen: boolean
  onToggleComments?: () => void
  onShowSlideSorter?: () => void
  onPresent?: () => void
  onShowStats?: () => void
  onShowShortcuts?: () => void
}) {
  return (
    <div className="flex h-[100px] items-stretch">
      <GroupBox title="Panels">
        <RibbonBtn primary icon="⊟" label="Layers"   onClick={onToggleLayers}   active={layersOpen}   disabled={!onToggleLayers} />
        <RibbonBtn primary icon="≡" label="Outline"  onClick={onToggleOutline}  active={outlineOpen}  disabled={!onToggleOutline} />
        <RibbonBtn primary icon="💬" label="Comments" onClick={onToggleComments} active={commentsOpen} disabled={!onToggleComments} />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Modes">
        <RibbonBtn primary icon="▦"  label="Sorter"   onClick={onShowSlideSorter} disabled={!onShowSlideSorter} />
        <RibbonBtn primary icon="▶"  label="Present"  onClick={onPresent}         disabled={!onPresent} />
      </GroupBox>

      <GroupDivider />

      <GroupBox title="Inspect">
        <RibbonBtn icon="📈" label="Stats"     onClick={onShowStats}     disabled={!onShowStats} />
        <RibbonBtn icon="⌨"  label="Shortcuts" onClick={onShowShortcuts} disabled={!onShowShortcuts} />
      </GroupBox>
    </div>
  )
}

// ── Export menu ──────────────────────────────────────────────────────────────

function ExportMenu({ docId, onClose }: { docId: string; onClose: () => void }) {
  const items: Array<{ label: string; href: string; note?: string }> = [
    { label: "PowerPoint (.pptx)", href: exportPptxUrl(docId), note: "Round-tripped" },
    { label: "PDF",                href: exportPdfUrl(docId) },
    { label: "PNG slides (zip)",   href: exportPngZipUrl(docId) },
    { label: "HTML slideshow",     href: exportHtmlUrl(docId) },
    { label: "Markdown outline",   href: exportMarkdownUrl(docId) },
    { label: "Speaker notes (md)", href: notesExportUrl(docId, "md") },
    { label: "Speaker notes (HTML)", href: notesHtmlExportUrl(docId) },
  ]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-3 top-7 z-50 mt-1 w-56 bg-surface border border-edge rounded shadow-xl py-1">
        <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-muted/70 border-b border-edge/50">Download</div>
        {items.map((it) => (
          <a key={it.label} href={it.href} download
            onClick={onClose}
            className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-200 hover:bg-white/8">
            <span>{it.label}</span>
            {it.note && <span className="text-[9px] text-accent/80">{it.note}</span>}
          </a>
        ))}
      </div>
    </>
  )
}
