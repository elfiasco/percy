import { useState, useEffect } from "react"
import { fetchSlideWordCountHistogram } from "../../lib/studioApi"
import type { WordCountSlide, WordCountBucket } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideWordCountHistogramModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ per_slide: WordCountSlide[]; histogram: WordCountBucket[]; total_words: number; avg_words: number } | null>(null)
  const [error, setError] = useState("")
  const [view, setView] = useState<"histogram" | "list">("histogram")

  useEffect(() => {
    setLoading(true)
    fetchSlideWordCountHistogram(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze word counts"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxBucket = data ? Math.max(...data.histogram.map(b => b.count), 1) : 1
  const maxWords  = data ? Math.max(...data.per_slide.map(s => s.word_count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Word Count Histogram</h2>
            <p className="text-white/40 text-xs mt-0.5">Word count distribution across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Counting words…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Total: <span className="text-white/70">{data.total_words} words</span></span>
                <span>Avg/slide: <span className="text-white/70">{data.avg_words}</span></span>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setView("histogram")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${view === "histogram" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>Histogram</button>
                  <button onClick={() => setView("list")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${view === "list" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>Per Slide</button>
                </div>
              </div>

              {view === "histogram" && (
                <div className="space-y-2">
                  {data.histogram.map(b => (
                    <div key={b.label} className="flex items-center gap-3">
                      <span className="text-[10px] text-white/40 w-16 shrink-0">{b.label} words</span>
                      <div className="flex-1 h-5 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-accent/40 rounded-sm flex items-center px-2"
                          style={{ width: `${(b.count / maxBucket) * 100}%` }}
                        >
                          {b.count > 0 && <span className="text-[10px] text-accent/80">{b.count}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-white/30 w-10 text-right shrink-0">{b.count} slides</span>
                    </div>
                  ))}
                </div>
              )}

              {view === "list" && (
                <div className="space-y-1.5">
                  {data.per_slide.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                      <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                      <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                        <div className="h-full bg-accent/40 rounded-sm" style={{ width: `${(s.word_count / maxWords) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-white/40 w-14 text-right shrink-0">{s.word_count} words</span>
                    </button>
                  ))}
                </div>
              )}
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
