import { useState, useCallback } from "react"
import { moveSlide } from "../../lib/studioApi"

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

  return (
    <div
      className="fixed inset-0 z-[99997] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
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
              const active = n === selectedSlide
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
                  onClick={() => { onJump(n); onClose() }}
                  className={[
                    "flex flex-col items-center gap-1 rounded-lg p-2 cursor-pointer transition-all select-none",
                    active       ? "ring-2 ring-accent bg-accent/10" : "hover:bg-white/5",
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
          Press Esc or click outside to close
        </div>
      </div>
    </div>
  )
}
