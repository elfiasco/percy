import { useState, useRef, useEffect, useCallback } from "react"
import { addSlide, deleteSlide, duplicateSlide, moveSlide } from "../../lib/studioApi"

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
  const stripRef = useRef<HTMLDivElement>(null)

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

  const handleDelete = useCallback((n: number) => {
    run(
      () => deleteSlide(docId, n) as Promise<{ slide_count: number }>,
      (r) => Math.min(selectedSlide, r.slide_count),
    )
  }, [docId, selectedSlide, run])

  const handleDuplicate = useCallback((n: number) => {
    run(
      () => duplicateSlide(docId, n),
      (r) => r.new_slide_n ?? n + 1,
    )
  }, [docId, run])

  const handleMoveUp = useCallback((n: number) => {
    if (n <= 1) return
    run(
      () => moveSlide(docId, n, n - 1) as Promise<{ slide_count: number }>,
      () => n - 1,
    )
  }, [docId, run])

  const handleMoveDown = useCallback((n: number) => {
    if (n >= slideCount) return
    run(
      () => moveSlide(docId, n, n + 1) as Promise<{ slide_count: number }>,
      () => n + 1,
    )
  }, [docId, slideCount, run])

  return (
    <div ref={stripRef} className="w-28 shrink-0 flex flex-col border-r border-edge bg-surface min-h-0">
      {/* header */}
      <div className="px-2 py-1.5 text-[10px] text-muted uppercase tracking-widest font-semibold border-b border-edge shrink-0 flex items-center justify-between">
        <span>Slides</span>
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

      {/* slide list */}
      <div key={stripKey} className="flex flex-col gap-1 p-2 overflow-y-auto flex-1 scrollbar-thin">
        {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => {
          const active = n === selectedSlide
          const dirty  = dirtySlides?.has(n) ?? false
          return (
            <button
              key={n}
              onClick={() => onSelect(n)}
              onContextMenu={(e) => handleContextMenu(e, n)}
              className={[
                "flex flex-col items-center gap-1 rounded p-1 transition-all group w-full",
                active
                  ? "ring-2 ring-accent bg-accent/10"
                  : "hover:bg-white/5",
              ].join(" ")}
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
              </div>
              <span className={`text-[10px] ${active ? "text-accent-light" : dirty ? "text-amber-400" : "text-muted"}`}>
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {/* context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <CtxItem onClick={() => handleDuplicate(contextMenu.slideN)}>Duplicate slide</CtxItem>
          <div className="border-t border-edge/50 my-1" />
          <CtxItem onClick={() => handleMoveUp(contextMenu.slideN)} disabled={contextMenu.slideN <= 1}>
            Move up
          </CtxItem>
          <CtxItem onClick={() => handleMoveDown(contextMenu.slideN)} disabled={contextMenu.slideN >= slideCount}>
            Move down
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
