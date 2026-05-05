import { useState, useEffect } from "react"
import { fetchOpeningStats } from "../../lib/studioApi"
import type { OpeningStat } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function OpeningStatsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ stats: OpeningStat[]; total: number; has_hook_stat: boolean } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchOpeningStats(docId))
    } catch {
      setError("Failed to analyze opening statistics")
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
            <h2 className="text-white font-semibold text-sm">Opening Statistics</h2>
            <p className="text-white/40 text-xs mt-0.5">Numbers and stats in your first 3 slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning opening slides…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                {data.has_hook_stat ? (
                  <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-1.5">
                    ✓ Opening has a hook statistic
                  </div>
                ) : (
                  <div className="text-yellow-400/80 text-xs bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-1.5">
                    Consider adding a bold stat to hook your audience
                  </div>
                )}
              </div>

              {data.total === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No numbers found in opening slides.</div>
              ) : (
                <div className="space-y-2">
                  {data.stats.map((s, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {s.slide_n}</button>
                        {s.is_stat && (
                          <span className="text-[10px] text-cyan-400/60 bg-cyan-400/8 border border-cyan-400/20 px-1.5 py-0.5 rounded">key stat</span>
                        )}
                      </div>
                      <p className="text-white/55 text-xs leading-relaxed">{s.text}</p>
                      <div className="flex flex-wrap gap-1">
                        {s.numbers.map((n, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 bg-accent/8 text-accent/70 font-mono">{n}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>
    </div>
  )
}
