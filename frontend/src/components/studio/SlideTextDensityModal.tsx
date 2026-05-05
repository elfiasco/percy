import { useState, useEffect } from "react"
import { fetchSlideTextDensity } from "../../lib/studioApi"
import type { TextDensityResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTextDensityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TextDensityResult | null>(null)
  const [error, setError] = useState("")
  const [sort, setSort] = useState<"slide" | "words">("words")

  useEffect(() => {
    setLoading(true)
    fetchSlideTextDensity(docId)
      .then(setData)
      .catch(() => setError("Failed to load text density data"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data
    ? [...data.per_slide].sort((a, b) =>
        sort === "words" ? b.word_count - a.word_count : a.slide_n - b.slide_n
      )
    : []

  const maxWords = slides.reduce((m, s) => Math.max(m, s.word_count), 1)

  const barColor = (words: number) =>
    words > 150 ? "bg-red-400/50" : words > 80 ? "bg-yellow-400/50" : "bg-green-400/50"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Text Density</h2>
            <p className="text-white/40 text-xs mt-0.5">Word count, character count, and bullet count per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Counting words…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-xs text-white/40">
                  <span>Total: <span className="text-white/70">{data.total_words} words</span></span>
                  <span>Avg: <span className="text-white/70">{data.avg_words_per_slide}w/slide</span></span>
                </div>
                <div className="flex gap-1">
                  {(["words", "slide"] as const).map(s => (
                    <button key={s} onClick={() => setSort(s)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${sort === s ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {s === "words" ? "by density" : "by slide"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {slides.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(s.word_count)}`}
                        style={{ width: `${Math.round((s.word_count / maxWords) * 100)}%` }} />
                    </div>
                    <div className="flex gap-3 text-[10px] text-white/40 shrink-0">
                      <span>{s.word_count}w</span>
                      <span className="text-white/20">{s.bullet_count}b</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
