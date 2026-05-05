import { useState } from "react"
import { fetchPersuasionScores } from "../../lib/studioApi"
import type { PersuasionScore } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const scoreColor = (s: number) => s >= 8 ? "text-green-400" : s >= 5 ? "text-yellow-400" : "text-red-400"
const barColor   = (s: number) => s >= 8 ? "bg-green-400/50" : s >= 5 ? "bg-yellow-400/50" : "bg-red-400/60"

export default function PersuasionScoreModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ scores: PersuasionScore[]; avg_score: number } | null>(null)
  const [error, setError]     = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchPersuasionScores(docId))
    } catch {
      setError("Failed to score persuasion")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Persuasion Score</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rates how compelling each slide is</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scoring slides…</p>
            </div>
          )}

          {data !== null && !loading && (
            <>
              <div className="text-xs text-white/40">
                Average persuasion: <span className={`font-medium ${scoreColor(data.avg_score)}`}>{data.avg_score}/10</span>
              </div>
              <div className="space-y-1.5">
                {data.scores.map((s) => (
                  <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/4 text-left"
                      onClick={() => setExpanded(expanded === s.slide_n ? null : s.slide_n)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0 w-14"
                      >
                        Slide {s.slide_n}
                      </button>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor(s.score)}`} style={{ width: `${s.score * 10}%` }} />
                      </div>
                      <span className={`text-sm font-bold shrink-0 w-6 text-right ${scoreColor(s.score)}`}>{s.score}</span>
                      <span className="text-white/20 text-xs">{expanded === s.slide_n ? "▲" : "▼"}</span>
                    </button>
                    {expanded === s.slide_n && (
                      <div className="px-4 py-2 border-t border-white/5 space-y-1">
                        {s.reason && <p className="text-white/45 text-xs">{s.reason}</p>}
                        {s.tip && <p className="text-accent/55 text-xs">→ {s.tip}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Score" to rate each slide's persuasive power.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Scoring…" : "Score"}
          </button>
        </div>
      </div>
    </div>
  )
}
