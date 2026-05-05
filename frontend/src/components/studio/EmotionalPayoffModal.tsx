import { useState } from "react"
import { fetchEmotionalPayoff } from "../../lib/studioApi"
import type { EmotionalPayoffSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const scoreColor = (n: number) =>
  n >= 7 ? "text-green-400" : n >= 4 ? "text-yellow-400" : "text-white/40"

export default function EmotionalPayoffModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ slides: EmotionalPayoffSlide[]; top_slides: EmotionalPayoffSlide[] } | null>(null)
  const [error, setError]     = useState("")
  const [showTop, setShowTop] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchEmotionalPayoff(docId))
    } catch {
      setError("Failed to analyze emotional payoff")
    } finally {
      setLoading(false)
    }
  }

  const slides = data ? (showTop ? data.top_slides : data.slides) : []
  const maxScore = data ? Math.max(...data.slides.map(s => s.score), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Emotional Payoff</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies slides with the strongest emotional impact</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing emotional impact…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowTop(false)}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${!showTop ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                  All slides
                </button>
                <button onClick={() => setShowTop(true)}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${showTop ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Top 3
                </button>
              </div>

              <div className="space-y-1.5">
                {slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/25 rounded-full" style={{ width: `${(s.score / maxScore) * 100}%` }} />
                    </div>
                    <span className={`text-xs shrink-0 w-6 text-right ${scoreColor(s.score)}`}>{s.score}</span>
                    {s.emotion && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-paper/20 bg-paper/8 text-paper capitalize shrink-0">{s.emotion}</span>
                    )}
                  </div>
                ))}
              </div>

              {showTop && slides.length > 0 && (
                <div className="space-y-2 border-t border-white/8 pt-3">
                  {slides.map((s) => s.reason && (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <div className="text-xs text-accent/60 mb-1">Slide {s.slide_n}</div>
                      <p className="text-white/50 text-xs leading-relaxed">{s.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to identify emotional payoff moments.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
