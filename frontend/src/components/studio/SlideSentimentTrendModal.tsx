import { useState } from "react"
import { fetchSlideSentimentTrend } from "../../lib/studioApi"
import type { SentimentTrendResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const sentColor: Record<string, string> = {
  positive: "bg-green-400/50",
  neutral:  "bg-white/20",
  negative: "bg-red-400/50",
}

const trendLabel: Record<string, string> = {
  rising:  "📈 Rising",
  falling: "📉 Falling",
  flat:    "→ Flat",
  mixed:   "↔ Mixed",
}

export default function SlideSentimentTrendModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SentimentTrendResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideSentimentTrend(docId)
      setData(res)
    } catch {
      setError("Failed to analyze sentiment trend")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Sentiment Trend</h2>
            <p className="text-white/40 text-xs mt-0.5">AI tracks how sentiment evolves from slide to slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Reading sentiment…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-sm text-white/70 font-medium">{trendLabel[data.trend] ?? data.trend}</span>
                {data.arc_summary && (
                  <p className="flex-1 text-[10px] text-white/40 leading-relaxed">{data.arc_summary}</p>
                )}
              </div>

              <div className="space-y-1">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${sentColor[s.sentiment] ?? "bg-white/20"}`}
                        style={{ width: `${Math.abs(s.score) * 10}%`, marginLeft: s.score < 0 ? 0 : undefined }} />
                    </div>
                    <span className={`text-[10px] shrink-0 w-16 text-right capitalize ${s.sentiment === "positive" ? "text-green-400/70" : s.sentiment === "negative" ? "text-red-400/70" : "text-white/30"}`}>
                      {s.sentiment}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to trace sentiment through slides.</div>
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
