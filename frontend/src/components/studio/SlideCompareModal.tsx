import { useState, useRef, useCallback, useEffect } from "react"

interface Props {
  docId: string
  slideN: number
  slideCount: number
  onClose: () => void
  onJumpToSlide?: (n: number) => void
}

export default function SlideCompareModal({ docId, slideN, slideCount, onClose, onJumpToSlide }: Props) {
  const [slide, setSlide]       = useState(slideN)
  const [divider, setDivider]   = useState(50)  // percent
  const [dragging, setDragging] = useState(false)
  const [score, setScore]       = useState<number | null>(null)
  const containerRef            = useRef<HTMLDivElement>(null)

  const origSrc   = `/api/docs/${docId}/slides/${slide}/original.png`
  const bridgeSrc = `/api/docs/${docId}/slides/${slide}/bridge.png`

  useEffect(() => {
    fetch(`/api/docs/${docId}/render-status`)
      .then((r) => r.json())
      .then((r) => {
        const scores = r.pixel_scores ?? {}
        const s = scores[String(slide)]
        setScore(typeof s === "number" ? Math.round(s * 100) : null)
      })
      .catch(() => {})
  }, [docId, slide])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct  = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100))
    setDivider(pct)
  }, [dragging])

  const onMouseUp = useCallback(() => setDragging(false), [])

  const handleJump = (n: number) => {
    setSlide(n)
    setScore(null)
    onJumpToSlide?.(n)
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-surface border border-edge rounded-xl shadow-2xl flex flex-col" style={{ width: "min(90vw, 900px)", maxHeight: "92vh" }}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Before / After Comparer</h2>
              <p className="text-[11px] text-muted mt-0.5">Drag the divider to compare original vs. edited</p>
            </div>
            {score !== null && (
              <div className={`text-xs px-2 py-1 rounded border font-mono ${
                score >= 80 ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : score >= 60 ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : "bg-red-500/15 text-red-300 border-red-500/30"
              }`}>
                Pixel score: {score}%
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">×</button>
        </div>

        {/* compare view */}
        <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
          {/* labels */}
          <div className="flex justify-between text-[11px] text-muted px-1 select-none">
            <span className="px-2 py-0.5 rounded bg-white/5 border border-edge">◀ Original</span>
            <span className="px-2 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent-light">Edited ▶</span>
          </div>

          {/* side-by-side with clip divider */}
          <div
            ref={containerRef}
            className="relative flex-1 min-h-0 rounded overflow-hidden cursor-col-resize select-none"
            style={{ userSelect: "none" }}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {/* original — full width but clipped from divider onward */}
            <img
              src={origSrc}
              className="absolute inset-0 w-full h-full object-contain"
              style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
            {/* edited — full width but clipped from 0 to divider */}
            <img
              src={bridgeSrc}
              className="absolute inset-0 w-full h-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${divider}%)` }}
              draggable={false}
            />

            {/* divider line */}
            <div
              className="absolute inset-y-0 w-0.5 bg-white/80 shadow-lg"
              style={{ left: `${divider}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
              onMouseDown={onMouseDown}
            >
              {/* handle */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 shadow-xl flex items-center justify-center text-slate-700 text-xs font-bold"
                onMouseDown={onMouseDown}
              >
                ⇔
              </div>
            </div>

            {/* invisible overlay to capture drag on the full area */}
            {dragging && (
              <div
                className="absolute inset-0"
                style={{ cursor: "col-resize" }}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
              />
            )}
          </div>
        </div>

        {/* slide navigation */}
        <div className="px-4 py-3 border-t border-edge shrink-0 flex items-center gap-3">
          <button
            onClick={() => handleJump(Math.max(1, slide - 1))}
            disabled={slide <= 1}
            className="px-3 py-1.5 rounded border border-edge text-xs text-muted hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-30"
          >
            ← Prev
          </button>
          <div className="flex-1 overflow-x-auto flex gap-1.5 py-1">
            {Array.from({ length: Math.min(slideCount, 20) }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => handleJump(n)}
                className={`w-7 h-7 shrink-0 rounded text-[10px] font-mono border transition-colors ${
                  n === slide
                    ? "bg-accent border-accent/60 text-white"
                    : "border-edge text-muted hover:bg-white/10 hover:text-slate-200"
                }`}
              >
                {n}
              </button>
            ))}
            {slideCount > 20 && (
              <span className="text-[10px] text-muted self-center ml-1">+{slideCount - 20} more</span>
            )}
          </div>
          <button
            onClick={() => handleJump(Math.min(slideCount, slide + 1))}
            disabled={slide >= slideCount}
            className="px-3 py-1.5 rounded border border-edge text-xs text-muted hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-30"
          >
            Next →
          </button>
          <button onClick={onClose} className="ml-2 px-4 py-1.5 rounded border border-edge text-xs text-slate-300 hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
