import { useState, useEffect } from "react"
import { fetchTextDensityPerWord } from "../../lib/studioApi"
import type { TextDensitySlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TextDensityPerWordModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ per_slide: TextDensitySlide[]; global_avg: number; total_words: number; dense_slides: number[]; threshold: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchTextDensityPerWord(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze text density"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxAvg = data ? Math.max(...data.per_slide.map(s => s.avg_per_shape), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Density Per Shape</h2>
            <p className="text-white/40 text-xs mt-0.5">Average words per text box across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing text density…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Global avg: <span className="text-white/70">{data.global_avg} words/shape</span></span>
                <span>Total words: <span className="text-white/70">{data.total_words}</span></span>
                <span>Dense threshold: <span className="text-white/70">{data.threshold}+</span></span>
              </div>

              <div className="space-y-1.5">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                    <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                      <div
                        className={`h-full rounded-sm ${s.dense ? "bg-red-500/50" : "bg-accent/40"}`}
                        style={{ width: `${(s.avg_per_shape / maxAvg) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-white/40 w-16 text-right shrink-0">{s.avg_per_shape} avg</span>
                    {s.dense && <span className="text-[10px] text-red-400/70 shrink-0">dense</span>}
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
