import { useState } from "react"
import { fetchSlideComplexityRanker } from "../../lib/studioApi"
import type { ComplexityEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideComplexityRankerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [ranked, setRanked] = useState<ComplexityEntry[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideComplexityRanker(docId)
      setRanked(res.ranked)
    } catch {
      setError("Failed to rank complexity")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Complexity Ranker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI ranks slides by visual and content complexity</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Ranking complexity…</p>
            </div>
          )}

          {ranked && !loading && (
            ranked.map((r, i) => (
              <div key={r.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-white/30 w-5 shrink-0">#{i + 1}</span>
                  <button onClick={() => { onJumpToSlide(r.slide_n); onClose() }}
                    className="text-[10px] text-accent/60 hover:text-accent transition-colors shrink-0">
                    Slide {r.slide_n}
                  </button>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${r.complexity_score >= 8 ? "bg-red-400/60" : r.complexity_score >= 5 ? "bg-yellow-400/50" : "bg-green-400/40"}`}
                      style={{ width: `${(r.complexity_score / 10) * 100}%` }}
                    />
                  </div>
                  <span className={`text-[10px] w-8 text-right shrink-0 ${r.complexity_score >= 8 ? "text-red-400" : r.complexity_score >= 5 ? "text-yellow-400" : "text-green-400"}`}>
                    {r.complexity_score}/10
                  </span>
                </div>
                {r.simplification && (
                  <p className="text-xs text-accent/60 leading-relaxed pl-8">→ {r.simplification}</p>
                )}
              </div>
            ))
          )}

          {ranked !== null && ranked.length === 0 && !loading && (
            <div className="text-white/30 text-xs text-center py-4">No complexity data returned.</div>
          )}

          {ranked === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Rank" to analyze slide complexity.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Ranking…" : "Rank"}
          </button>
        </div>
      </div>
    </div>
  )
}
