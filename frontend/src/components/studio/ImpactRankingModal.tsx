import { useState } from "react"
import { fetchImpactRanking } from "../../lib/studioApi"
import type { ImpactRankEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`

export default function ImpactRankingModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ rankings: ImpactRankEntry[] } | null>(null)
  const [error, setError]     = useState("")
  const [showTop, setShowTop] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchImpactRanking(docId))
    } catch {
      setError("Failed to rank slides by impact")
    } finally {
      setLoading(false)
    }
  }

  const rankings = data ? (showTop ? data.rankings.slice(0, 5) : data.rankings) : []
  const maxScore = data ? Math.max(...data.rankings.map(r => r.impact_score), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Impact Ranking</h2>
            <p className="text-white/40 text-xs mt-0.5">AI ranks slides by potential audience impact</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Ranking slides…</p>
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
                  Top 5
                </button>
              </div>

              <div className="space-y-1.5">
                {rankings.map((r) => (
                  <div key={r.slide_n} className="flex items-center gap-3">
                    <span className="text-xs text-white/30 w-8 text-right shrink-0">{rankMedal(r.rank)}</span>
                    <button onClick={() => { onJumpToSlide(r.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 shrink-0">
                      Slide {r.slide_n}
                    </button>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/25 rounded-full" style={{ width: `${(r.impact_score / maxScore) * 100}%` }} />
                    </div>
                    <span className="text-white/35 text-xs w-6 text-right shrink-0">{r.impact_score}</span>
                  </div>
                ))}
              </div>

              {showTop && (
                <div className="space-y-2 border-t border-white/8 pt-3">
                  {rankings.map((r) => r.reason && (
                    <div key={r.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <div className="text-xs text-accent/60 mb-1">{rankMedal(r.rank)} Slide {r.slide_n}</div>
                      <p className="text-white/50 text-xs leading-relaxed">{r.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Rank" to rank slides by impact.</div>
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
