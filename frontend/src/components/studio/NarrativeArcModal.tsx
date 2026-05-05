import { useState } from "react"
import { fetchNarrativeArc } from "../../lib/studioApi"
import type { NarrativeArc } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function NarrativeArcModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<NarrativeArc | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchNarrativeArc(docId))
    } catch {
      setError("Failed to analyze narrative arc")
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = data ? (data.score >= 8 ? "text-green-400" : data.score >= 5 ? "text-yellow-400" : "text-red-400") : ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Narrative Arc Analysis</h2>
            <p className="text-white/40 text-xs mt-0.5">AI checks if your deck tells a compelling story</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing narrative…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4">
                <span className={`text-3xl font-bold ${scoreColor}`}>{data.score}</span>
                <span className="text-white/30">/10</span>
                <div className="ml-2">
                  <p className="text-white/60 text-sm font-medium">{data.arc_type}</p>
                  <p className="text-white/30 text-xs">narrative structure</p>
                </div>
              </div>

              {data.phases.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs font-medium mb-2">Phases</p>
                  <div className="space-y-1.5">
                    {data.phases.map((p, i) => (
                      <div key={i} className="bg-white/3 border border-white/8 rounded px-3 py-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-accent/70 text-xs font-medium">{p.name}</span>
                          <div className="flex flex-wrap gap-1 ml-auto">
                            {p.slides.map((n) => (
                              <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                                className="text-[10px] text-white/30 hover:text-accent transition-colors bg-white/3 rounded px-1"
                              >Slide {n}</button>
                            ))}
                          </div>
                        </div>
                        <p className="text-white/40 text-xs">{p.assessment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.strengths.length > 0 && (
                <div>
                  <p className="text-green-400/70 text-xs font-medium mb-1">Strengths</p>
                  <ul className="space-y-1">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="text-white/50 text-xs flex gap-2"><span className="text-green-400/50 shrink-0">✓</span>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.gaps.length > 0 && (
                <div>
                  <p className="text-red-400/70 text-xs font-medium mb-1">Gaps</p>
                  <ul className="space-y-1">
                    {data.gaps.map((g, i) => (
                      <li key={i} className="text-white/50 text-xs flex gap-2"><span className="text-red-400/50 shrink-0">✗</span>{g}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.recommendation && (
                <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
                  <p className="text-accent/60 text-xs font-medium mb-1">Recommendation</p>
                  <p className="text-white/55 text-xs">{data.recommendation}</p>
                </div>
              )}
            </>
          )}

          {!data && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Analyze" to see if your deck tells a compelling story.
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
