import { useState, useCallback, useEffect, useRef } from "react"
import { moveSlide, deleteSlide, duplicateSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  onClose: () => void
  onJump: (n: number) => void
  onSlideCountChange: (newCount: number, focusSlide: number) => void
}

export default function SlideSorterModal({
  docId, slideCount, selectedSlide, onClose, onJump, onSlideCountChange,
}: Props) {
  const [dragSlide, setDragSlide] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [localCount, setLocalCount] = useState(slideCount)
  const [stripKey, setStripKey] = useState(0)
  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(new Set([selectedSlide]))
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; n: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (ctxMenu) { setCtxMenu(null); return } onClose() }
      if ((e.key === "Delete" || e.key === "Backspace") && !ctxMenu) {
        e.preventDefault()
        const toDelete = [...selectedSlides].sort((a, b) => b - a)
        if (!toDelete.length || localCount <= toDelete.length) return
        ;(async () => {
          setBusy(true)
          let count = localCount
          for (const n of toDelete) {
            try { const r = await deleteSlide(docId, n); count = r.slide_count } catch {}
          }
          const focus = Math.min(Math.min(...selectedSlides), count)
          setLocalCount(count); setStripKey((k) => k + 1)
          setSelectedSlides(new Set([focus]))
          onSlideCountChange(count, focus)
          setBusy(false)
        })()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [ctxMenu, onClose, selectedSlides, localCount, docId, onSlideCountChange])

  const run = useCallback(async (
    fn: () => Promise<{ slide_count: number; new_slide_n?: number }>,
    focusFn?: (r: { slide_count: number; new_slide_n?: number }) => number,
  ) => {
    setBusy(true)
    try {
      const r = await fn()
      const focus = focusFn ? focusFn(r) : Math.min(selectedSlide, r.slide_count)
      setLocalCount(r.slide_count)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, focus)
    } catch (e) {
      console.error("sorter action failed:", e)
    } finally {
      setBusy(false)
    }
  }, [selectedSlide, onSlideCountChange])

  const handleDrop = useCallback((targetN: number) => {
    const src = dragSlide
    setDragSlide(null)
    setDropTarget(null)
    if (!src || src === targetN) return
    run(
      () => moveSlide(docId, src, targetN) as Promise<{ slide_count: number }>,
      () => targetN,
    )
  }, [dragSlide, docId, run])

  const handleSlideClick = useCallback((n: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSelectedSlides((prev) => {
        const next = new Set(prev)
        if (next.has(n)) next.delete(n); else next.add(n)
        return next
      })
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedSlides((prev) => {
        const next = new Set(prev)
        if (next.has(n)) next.delete(n); else next.add(n)
        return next
      })
    } else {
      setSelectedSlides(new Set([n]))
      onJump(n)
      onClose()
    }
  }, [onJump, onClose])

  const handleDuplicate = useCallback(async (n: number) => {
    setCtxMenu(null)
    setBusy(true)
    try {
      const r = await duplicateSlide(docId, n)
      setLocalCount(r.slide_count); setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, r.new_slide_n)
    } catch (e) { console.error("dup failed:", e) }
    finally { setBusy(false) }
  }, [docId, onSlideCountChange])

  const handleDelete = useCallback(async (n: number) => {
    setCtxMenu(null)
    if (localCount <= 1) return
    setBusy(true)
    try {
      const r = await deleteSlide(docId, n)
      const focus = Math.min(n, r.slide_count)
      setLocalCount(r.slide_count); setStripKey((k) => k + 1)
      setSelectedSlides(new Set([focus]))
      onSlideCountChange(r.slide_count, focus)
    } catch (e) { console.error("delete failed:", e) }
    finally { setBusy(false) }
  }, [docId, localCount, onSlideCountChange])

  return (
    <div
      className="fixed inset-0 z-[99997] flex items-center justify-center bg-black/70"
      onClick={() => { if (ctxMenu) { setCtxMenu(null) } else { onClose() } }}
    >
      <div
        ref={modalRef}
        className="bg-surface border border-edge rounded-xl shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 900px)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">
            Slide Sorter — {localCount} slides
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted/50">Drag to reorder · Click to jump · Right-click for options</span>
            <button onClick={onClose} className="text-muted hover:text-slate-200 transition-colors text-lg w-6 h-6 flex items-center justify-center">✕</button>
          </div>
        </div>

        {/* grid */}
        <div className="overflow-y-auto flex-1 p-4 scrollbar-thin">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {Array.from({ length: localCount }, (_, i) => i + 1).map((n) => {
              const active = selectedSlides.has(n)
              const isCurrent = n === selectedSlide
              const isDragging = dragSlide === n
              const isDropTarget = dropTarget === n && dragSlide !== null && dragSlide !== n
              return (
                <div
                  key={`${stripKey}-${n}`}
                  draggable={!busy}
                  onDragStart={(e) => { setDragSlide(n); e.dataTransfer.effectAllowed = "move" }}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(n) }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(n) }}
                  onDragEnd={() => { setDragSlide(null); setDropTarget(null) }}
                  onClick={(e) => handleSlideClick(n, e)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, n }) }}
                  className={[
                    "flex flex-col items-center gap-1 rounded-lg p-2 cursor-pointer transition-all select-none",
                    active       ? "ring-2 ring-accent bg-accent/10" : "hover:bg-white/5",
                    isCurrent    ? "ring-2 ring-accent" : "",
                    isDragging   ? "opacity-30" : "",
                    isDropTarget ? "ring-2 ring-indigo-400 bg-indigo-500/10 scale-105" : "",
                  ].join(" ")}
                >
                  <div className="w-full aspect-video bg-base rounded overflow-hidden">
                    <img
                      src={`/api/docs/${docId}/slides/${n}/bridge.png?v=${stripKey}`}
                      alt={`Slide ${n}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  </div>
                  <span className={`text-[10px] ${active ? "text-accent-light font-semibold" : "text-muted"}`}>
                    {n}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-5 py-2 border-t border-edge text-[10px] text-muted/40 text-center shrink-0">
          Click to jump · Shift/Ctrl+Click multi-select · Right-click for options · Del to delete · Drag to reorder
        </div>
      </div>

      {/* right-click context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-[99999] bg-surface border border-edge rounded-lg shadow-2xl py-1 w-40 text-xs"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-200"
              onClick={() => { onJump(ctxMenu.n); onClose() }}
            >
              Jump to slide {ctxMenu.n}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
              onClick={() => handleDuplicate(ctxMenu.n)}
            >
              Duplicate
            </button>
            <div className="border-t border-edge my-1" />
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 text-bad"
              onClick={() => handleDelete(ctxMenu.n)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
