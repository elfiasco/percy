import { useState, useEffect } from "react"
import { fetchDocStats } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

interface SlideInfo {
  n: number
  src: string
  renderKey: number
}

export default function StoryboardModal({ docId, slideCount, currentSlide, onClose, onJumpToSlide }: Props) {
  const [slides, setSlides]       = useState<SlideInfo[]>([])
  const [columns, setColumns]     = useState(5)
  const [selected, setSelected]   = useState(currentSlide)
  const [wordCounts, setWordCounts] = useState<Record<number, number>>({})
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    const arr: SlideInfo[] = Array.from({ length: slideCount }, (_, i) => ({
      n: i + 1,
      src: `/api/docs/${docId}/slides/${i + 1}/bridge.png`,
      renderKey: 0,
    }))
    setSlides(arr)
  }, [docId, slideCount])

  useEffect(() => {
    // Fetch word count info from stats
    setStatsLoading(true)
    fetchDocStats(docId)
      .then((r) => {
        // stats doesn't have per-slide word counts, just overall
        // Build approximation: total / slide_count per slide
        const avg = Math.round((r.word_count ?? 0) / Math.max(1, r.slide_count))
        const wc: Record<number, number> = {}
        for (let i = 1; i <= slideCount; i++) wc[i] = avg
        setWordCounts(wc)
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [docId, slideCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxWords = Math.max(1, ...Object.values(wordCounts))

  const barColor = (n: number) => {
    const wc = wordCounts[n] ?? 0
    const ratio = wc / maxWords
    if (ratio > 0.75) return "bg-red-400"
    if (ratio > 0.5) return "bg-yellow-400"
    return "bg-accent"
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#12121c] border border-white/10 rounded-xl shadow-2xl w-[92vw] max-w-[1200px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Storyboard View</h2>
            <p className="text-white/30 text-xs mt-0.5">{slideCount} slides · click to navigate</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-xs">Columns:</span>
            {[3, 4, 5, 6, 8].map((c) => (
              <button
                key={c}
                onClick={() => setColumns(c)}
                className={`w-7 h-7 rounded text-xs transition-colors ${columns === c ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white hover:bg-white/10"}`}
              >
                {c}
              </button>
            ))}
            <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded ml-2">×</button>
          </div>
        </div>

        {/* grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
          >
            {slides.map((slide) => {
              const isSelected = selected === slide.n
              const isCurrent  = currentSlide === slide.n
              const wc = wordCounts[slide.n] ?? 0
              const wcRatio = wc / maxWords
              return (
                <div
                  key={slide.n}
                  className={`group cursor-pointer rounded-lg border overflow-hidden transition-all ${
                    isSelected
                      ? "border-accent shadow-lg shadow-accent/20 scale-[1.02]"
                      : "border-white/10 hover:border-white/30 hover:scale-[1.01]"
                  }`}
                  onClick={() => {
                    setSelected(slide.n)
                    onJumpToSlide(slide.n)
                  }}
                  onDoubleClick={() => {
                    onJumpToSlide(slide.n)
                    onClose()
                  }}
                >
                  {/* thumbnail */}
                  <div className="relative bg-black/20" style={{ aspectRatio: "16/9" }}>
                    <img
                      src={slide.src}
                      alt={`Slide ${slide.n}`}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                    <div className="absolute top-1 left-1 bg-black/70 text-white/60 text-[9px] font-mono px-1.5 py-0.5 rounded">
                      {slide.n}
                    </div>
                    {isCurrent && (
                      <div className="absolute top-1 right-1 bg-accent/80 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
                        current
                      </div>
                    )}
                  </div>

                  {/* word count bar */}
                  {!statsLoading && (
                    <div className="px-1.5 py-1 bg-black/30">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 bg-white/10 rounded-full h-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor(slide.n)}`}
                            style={{ width: `${Math.round(wcRatio * 100)}%` }}
                          />
                        </div>
                        <span className="text-white/20 text-[9px] font-mono w-6 text-right shrink-0">{wc}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* footer */}
        <div className="px-5 py-2 border-t border-white/10 shrink-0 flex items-center gap-4 text-xs text-white/30">
          <span>Double-click to navigate and close</span>
          <div className="flex items-center gap-2 ml-auto">
            <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-accent inline-block" /> low</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-yellow-400 inline-block" /> medium</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-red-400 inline-block" /> high density</span>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white/80 ml-4 px-3 py-1 rounded hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
