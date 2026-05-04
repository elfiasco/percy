import { useState, useRef, useEffect, useCallback } from "react"
import { addSlide, deleteSlide, duplicateSlide, moveSlide, fetchNotesSummary, importSlides, fetchSlideLabels, setSlideLabel } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  dirtySlides?: Set<number>
  refreshKey?: number
  onSelect: (n: number) => void
  onSlideCountChange: (newCount: number, focusSlide: number) => void
}

interface ContextMenu {
  x: number
  y: number
  slideN: number
}

export default function StudioSlideStrip({
  docId, slideCount, selectedSlide, dirtySlides, refreshKey, onSelect, onSlideCountChange,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [busy, setBusy]               = useState(false)
  const [stripKey, setStripKey]       = useState(0)
  const [dragSlide, setDragSlide]     = useState<number | null>(null)
  const [dropTarget, setDropTarget]   = useState<number | null>(null)
  const [hoverN, setHoverN]           = useState<number | null>(null)
  const [hoverY, setHoverY]           = useState(0)
  const [slidesWithNotes, setSlidesWithNotes] = useState<Set<number>>(new Set())
  const [importing, setImporting]     = useState(false)
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set())
  const [thumbnailSize, setThumbnailSize] = useState<"sm" | "md">("sm")
  const [slideLabels, setSlideLabels] = useState<Record<number, string>>({})
  const [editingLabel, setEditingLabel] = useState<number | null>(null)
  const [editLabelText, setEditLabelText] = useState("")
  const importInputRef                = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Fetch notes summary and slide labels on mount/refresh
  useEffect(() => {
    fetchNotesSummary(docId)
      .then((r) => setSlidesWithNotes(new Set(r.slides_with_notes)))
      .catch(() => {})
    fetchSlideLabels(docId)
      .then((r) => setSlideLabels(Object.fromEntries(Object.entries(r.labels).map(([k, v]) => [Number(k), v]))))
      .catch(() => {})
  }, [docId, stripKey, refreshKey])

  const commitLabel = useCallback(async (n: number, text: string) => {
    setEditingLabel(null)
    const trimmed = text.trim()
    setSlideLabels((prev) => ({ ...prev, [n]: trimmed }))
    try {
      await setSlideLabel(docId, n, trimmed)
    } catch (e) { console.error("label save failed:", e) }
  }, [docId])

  // close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [contextMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, n: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, slideN: n })
  }, [])

  const run = useCallback(async (fn: () => Promise<{ slide_count: number; new_slide_n?: number }>, focus?: (r: { slide_count: number; new_slide_n?: number }) => number) => {
    setBusy(true)
    setContextMenu(null)
    try {
      const r = await fn()
      const focusSlide = focus ? focus(r) : Math.min(selectedSlide, r.slide_count)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, focusSlide)
    } catch (e) {
      console.error("slide action failed:", e)
    } finally {
      setBusy(false)
    }
  }, [selectedSlide, onSlideCountChange])

  const handleAdd = useCallback(() => {
    run(
      () => addSlide(docId, selectedSlide),
      (r) => r.new_slide_n ?? selectedSlide + 1,
    )
  }, [docId, selectedSlide, run])

  const handleDelete = useCallback(async (n?: number) => {
    const toDelete = n !== undefined ? [n] : [...multiSelected].sort((a, b) => b - a)
    if (!toDelete.length) return
    setBusy(true)
    setContextMenu(null)
    try {
      let lastCount = slideCount
      for (const slideN of toDelete) {
        const r = await deleteSlide(docId, slideN) as { slide_count: number }
        lastCount = r.slide_count
      }
      setMultiSelected(new Set())
      setStripKey((k) => k + 1)
      onSlideCountChange(lastCount, Math.min(selectedSlide, lastCount))
    } catch (e) {
      console.error("delete slide(s) failed:", e)
    } finally {
      setBusy(false)
    }
  }, [docId, selectedSlide, slideCount, multiSelected, onSlideCountChange])

  const handleDuplicate = useCallback(async (n?: number) => {
    const toDup = n !== undefined ? [n] : [...multiSelected].sort((a, b) => a - b)
    if (!toDup.length) return
    setBusy(true)
    setContextMenu(null)
    try {
      let lastNewN = toDup[0]
      let lastCount = slideCount
      for (const slideN of toDup) {
        const r = await duplicateSlide(docId, slideN)
        lastNewN  = r.new_slide_n ?? slideN + 1
        lastCount = r.slide_count
      }
      setMultiSelected(new Set())
      setStripKey((k) => k + 1)
      onSlideCountChange(lastCount, lastNewN)
    } catch (e) {
      console.error("duplicate slide(s) failed:", e)
    } finally {
      setBusy(false)
    }
  }, [docId, slideCount, multiSelected, onSlideCountChange])

  const handleMoveUp = useCallback((n: number) => {
    if (n <= 1) return
    setMultiSelected(new Set())
    run(
      () => moveSlide(docId, n, n - 1) as Promise<{ slide_count: number }>,
      () => n - 1,
    )
  }, [docId, run])

  const handleMoveDown = useCallback((n: number) => {
    if (n >= slideCount) return
    setMultiSelected(new Set())
    run(
      () => moveSlide(docId, n, n + 1) as Promise<{ slide_count: number }>,
      () => n + 1,
    )
  }, [docId, slideCount, run])

  const handleSlideClick = useCallback((e: React.MouseEvent, n: number) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle into multi-select
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.has(n)) { next.delete(n) } else { next.add(n) }
        return next
      })
    } else if (e.shiftKey && selectedSlide) {
      // Shift+click: range select
      const lo = Math.min(selectedSlide, n)
      const hi = Math.max(selectedSlide, n)
      setMultiSelected(new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)))
    } else {
      // Normal click: clear multi-select, set active
      setMultiSelected(new Set())
      onSelect(n)
    }
  }, [selectedSlide, onSelect])

  const handleDragStart = useCallback((e: React.DragEvent, n: number) => {
    setDragSlide(n)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(n))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, n: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget(n)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetN: number) => {
    e.preventDefault()
    const srcN = dragSlide
    setDragSlide(null)
    setDropTarget(null)
    if (!srcN || srcN === targetN) return
    run(
      () => moveSlide(docId, srcN, targetN) as Promise<{ slide_count: number }>,
      () => targetN,
    )
  }, [dragSlide, docId, run])

  const handleDragEnd = useCallback(() => {
    setDragSlide(null)
    setDropTarget(null)
  }, [])

  const handleImport = useCallback(async (file: File) => {
    setImporting(true)
    try {
      const r = await importSlides(docId, file)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, r.slide_count - r.imported + 1)
    } catch (e) {
      console.error("import slides failed:", e)
    } finally {
      setImporting(false)
    }
  }, [docId, onSlideCountChange])

  return (
    <div
      ref={stripRef}
      className={`${thumbnailSize === "md" ? "w-40" : "w-28"} shrink-0 flex flex-col border-r border-edge bg-surface min-h-0 transition-all`}
    >
      {/* header */}
      <div className="px-2 py-1.5 text-[10px] text-muted uppercase tracking-widest font-semibold border-b border-edge shrink-0 flex items-center justify-between">
        {multiSelected.size > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-violet-400">{multiSelected.size} sel.</span>
            <button
              onClick={() => handleDuplicate()}
              disabled={busy}
              title="Duplicate selected"
              className="text-[9px] px-1 py-0.5 rounded bg-white/5 hover:bg-white/15 text-muted transition-colors disabled:opacity-40"
            >⊕</button>
            <button
              onClick={() => handleDelete()}
              disabled={busy || slideCount - multiSelected.size < 1}
              title="Delete selected"
              className="text-[9px] px-1 py-0.5 rounded bg-bad/10 hover:bg-bad/20 text-bad/70 transition-colors disabled:opacity-40"
            >✕</button>
            <button
              onClick={() => setMultiSelected(new Set())}
              title="Clear selection"
              className="text-[9px] px-1 text-muted/50 hover:text-muted transition-colors"
            >⊘</button>
          </div>
        ) : (
          <span>Slides</span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setThumbnailSize((s) => s === "sm" ? "md" : "sm")}
            title="Toggle thumbnail size"
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-slate-200 hover:bg-white/10 transition-colors text-[10px]"
          >
            {thumbnailSize === "sm" ? "⊞" : "⊟"}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Import slides from PPTX"
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-slate-200
                       hover:bg-white/10 transition-colors text-xs disabled:opacity-40"
          >
            {importing ? "…" : "⤵"}
          </button>
          <button
            onClick={handleAdd}
            disabled={busy}
            title="Add slide after current"
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-slate-200
                       hover:bg-white/10 transition-colors text-sm disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = "" } }}
      />

      {/* slide list */}
      <div key={stripKey} className="flex flex-col gap-1 p-2 overflow-y-auto flex-1 scrollbar-thin">
        {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => {
          const active    = n === selectedSlide
          const dirty     = dirtySlides?.has(n) ?? false
          const hasNotes  = slidesWithNotes.has(n)
          const isMulti   = multiSelected.has(n)
          const isDragging = dragSlide === n
          const isDropTarget = dropTarget === n && dragSlide !== null && dragSlide !== n
          return (
            <div
              key={n}
              draggable
              onDragStart={(e) => handleDragStart(e, n)}
              onDragOver={(e) => handleDragOver(e, n)}
              onDrop={(e) => handleDrop(e, n)}
              onDragEnd={handleDragEnd}
              className={[
                "flex flex-col items-center gap-1 rounded p-1 transition-all group w-full cursor-grab active:cursor-grabbing",
                active      ? "ring-2 ring-accent bg-accent/10"
                  : isMulti ? "ring-2 ring-violet-400/60 bg-violet-500/10"
                  : "hover:bg-white/5",
                isDragging  ? "opacity-40" : "",
                isDropTarget ? "ring-2 ring-indigo-400 bg-indigo-500/10" : "",
              ].join(" ")}
              onClick={(e) => handleSlideClick(e, n)}
              onContextMenu={(e) => handleContextMenu(e, n)}
              onMouseEnter={(e) => { setHoverN(n); setHoverY((e.currentTarget as HTMLElement).getBoundingClientRect().top) }}
              onMouseLeave={() => setHoverN(null)}
            >
              <div className="w-full aspect-video bg-base rounded overflow-hidden relative">
                <img
                  src={`/api/docs/${docId}/slides/${n}/bridge.png?v=${stripKey}-${refreshKey ?? 0}`}
                  alt={`Slide ${n}`}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                {dirty && (
                  <span
                    title="Unsaved changes — click Rebuild to commit"
                    className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 shadow-sm"
                  />
                )}
                {hasNotes && (
                  <span
                    title="Has speaker notes"
                    className="absolute bottom-0.5 right-0.5 text-[8px] text-white/60 bg-black/50 rounded px-0.5 leading-tight"
                  >
                    📝
                  </span>
                )}
              </div>
              <div className="w-full flex items-center justify-between gap-0.5 min-w-0">
                <span className={`text-[10px] shrink-0 ${active ? "text-accent-light" : dirty ? "text-amber-400" : "text-muted"}`}>
                  {n}
                </span>
                {editingLabel === n ? (
                  <input
                    autoFocus
                    value={editLabelText}
                    onChange={(e) => setEditLabelText(e.target.value)}
                    onBlur={() => commitLabel(n, editLabelText)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === "Enter") { e.preventDefault(); commitLabel(n, editLabelText) }
                      if (e.key === "Escape") { setEditingLabel(null) }
                    }}
                    className="flex-1 min-w-0 text-[9px] bg-base border border-accent/50 rounded px-1 py-0 text-slate-300 focus:outline-none"
                    style={{ maxWidth: "100%" }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : slideLabels[n] ? (
                  <span
                    title={`Label: ${slideLabels[n]} — double-click to edit`}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(n); setEditLabelText(slideLabels[n] ?? "") }}
                    className="flex-1 min-w-0 text-[9px] text-indigo-300/70 truncate text-right cursor-text"
                  >
                    {slideLabels[n]}
                  </span>
                ) : (
                  <span
                    title="Double-click to add label"
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(n); setEditLabelText("") }}
                    className="flex-1 text-[9px] text-muted/0 hover:text-muted/30 transition-colors text-right cursor-text"
                  >
                    +label
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* hover preview */}
      {hoverN !== null && !contextMenu && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: thumbnailSize === "md" ? 168 : 110,
            top: Math.max(8, Math.min(hoverY - 20, window.innerHeight - 130)),
          }}
        >
          <div className="bg-surface border border-edge rounded shadow-2xl p-1 w-56">
            <img
              src={`/api/docs/${docId}/slides/${hoverN}/bridge.png?v=${stripKey}-${refreshKey ?? 0}`}
              alt={`Slide ${hoverN} preview`}
              className="w-full aspect-video rounded object-cover block"
            />
            <div className="text-[10px] text-muted text-center mt-1">Slide {hoverN}</div>
          </div>
        </div>
      )}

      {/* context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <CtxItem onClick={() => { setEditingLabel(contextMenu.slideN); setEditLabelText(slideLabels[contextMenu.slideN] ?? ""); setContextMenu(null) }}>
            Rename slide
          </CtxItem>
          <div className="border-t border-edge/50 my-1" />
          <CtxItem onClick={() => run(() => addSlide(docId, contextMenu.slideN - 1), (r) => r.new_slide_n ?? contextMenu.slideN)}>
            Insert before
          </CtxItem>
          <CtxItem onClick={() => run(() => addSlide(docId, contextMenu.slideN), (r) => r.new_slide_n ?? contextMenu.slideN + 1)}>
            Insert after
          </CtxItem>
          <CtxItem onClick={() => handleDuplicate(contextMenu.slideN)}>Duplicate slide</CtxItem>
          <div className="border-t border-edge/50 my-1" />
          <CtxItem onClick={() => handleMoveUp(contextMenu.slideN)} disabled={contextMenu.slideN <= 1}>
            Move up
          </CtxItem>
          <CtxItem onClick={() => handleMoveDown(contextMenu.slideN)} disabled={contextMenu.slideN >= slideCount}>
            Move down
          </CtxItem>
          <div className="border-t border-edge/50 my-1" />
          <CtxItem onClick={() => { window.open(`/api/docs/${docId}/slides/${contextMenu.slideN}/bridge.png`, "_blank"); setContextMenu(null) }}>
            Download PNG
          </CtxItem>
          <div className="border-t border-edge/50 my-1" />
          <CtxItem
            onClick={() => handleDelete(contextMenu.slideN)}
            disabled={slideCount <= 1}
            danger
          >
            Delete slide
          </CtxItem>
        </div>
      )}
    </div>
  )
}

function CtxItem({
  children, onClick, disabled, danger,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "w-full text-left px-3 py-1 text-xs transition-colors",
        disabled ? "text-muted/40 cursor-default" :
        danger   ? "text-bad hover:bg-bad/10" :
                   "text-slate-300 hover:bg-white/10 hover:text-slate-100",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
