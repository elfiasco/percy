import { useState, useEffect } from "react"
import { fetchRepetitionHeatmap } from "../../lib/studioApi"
import type { RepetitionSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const heatColor = (score: number) => {
  if (score >= 70) return "bg-red-400/40"
  if (score >= 40) return "bg-yellow-400/40"
  return "bg-green-400/25"
}
const scoreLabel = (score: number) => score >= 70 ? "High" : score >= 40 ? "Medium" : "Low"
const scoreLabelColor = (score: number) => score >= 70 ? "text-red-400" : score >= 40 ? "text-yellow-400" : "text-green-400"

export default function RepetitionHeatmapModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: RepetitionSlide[]; avg_repetition: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchRepetitionHeatmap(docId))
    } catch {
      setError("Failed to compute repetition heatmap")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Repetition Heatmap</h2>
            <p className="text-white/40 text-xs mt-0.5">How much each slide repeats words from elsewhere</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Computing repetition scores…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="text-xs text-white/40">
                Avg. repetition: <span className={scoreLabelColor(data.avg_repetition)}>{data.avg_repetition}%</span>
              </div>

              <div className="space-y-1.5">
                {data.slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${heatColor(s.repetition_score)}`} style={{ width: `${s.repetition_score}%` }} />
                    </div>
                    <span className={`text-xs font-mono w-8 text-right shrink-0 ${scoreLabelColor(s.repetition_score)}`}>
                      {s.repetition_score}%
                    </span>
                    {s.repeated_words.length > 0 && (
                      <div className="flex gap-1 w-40">
                        {s.repeated_words.slice(0, 3).map((w) => (
                          <span key={w} className="text-[9px] text-white/25 bg-white/5 px-1 rounded truncate">{w}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-4 text-[10px] text-white/30">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-green-400/25 inline-block" /> Low</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-yellow-400/40 inline-block" /> Medium</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-red-400/40 inline-block" /> High</span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Computing…" : "Re-compute"}
          </button>
        </div>
      </div>
    </div>
  )
}
