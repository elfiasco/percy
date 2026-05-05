import { useState } from "react"
import { fetchSpeakerConfidence } from "../../lib/studioApi"
import type { SpeakerConfidenceScore } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const scoreColor = (s: number) => s >= 8 ? "text-green-400" : s >= 5 ? "text-yellow-400" : "text-red-400"
const barColor   = (s: number) => s >= 8 ? "bg-green-400/50" : s >= 5 ? "bg-yellow-400/50" : "bg-red-400/60"

export default function SpeakerConfidenceModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ scores: SpeakerConfidenceScore[]; avg_score: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchSpeakerConfidence(docId))
    } catch {
      setError("Failed to score speaker confidence")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Speaker Confidence Score</h2>
            <p className="text-white/40 text-xs mt-0.5">AI scores how assertive your speaker notes sound</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing speaker notes…</p>
            </div>
          )}

          {data !== null && !loading && (
            <>
              {data.scores.length === 0 ? (
                <div className="text-white/40 text-xs text-center py-4">No speaker notes found in this deck.</div>
              ) : (
                <>
                  <div className="text-xs text-white/40">
                    Average confidence: <span className={`font-medium ${scoreColor(data.avg_score)}`}>{data.avg_score}/10</span>
                  </div>
                  <div className="space-y-2">
                    {data.scores.map((s) => (
                      <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3 mb-1.5">
                          <button
                            onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                            className="text-xs text-accent/70 hover:text-accent transition-colors shrink-0"
                          >
                            Slide {s.slide_n}
                          </button>
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor(s.score)}`} style={{ width: `${s.score * 10}%` }} />
                          </div>
                          <span className={`text-sm font-bold shrink-0 ${scoreColor(s.score)}`}>{s.score}</span>
                        </div>
                        {s.feedback && <p className="text-white/40 text-xs leading-relaxed">{s.feedback}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Analyze" to score the confidence level of your speaker notes.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
