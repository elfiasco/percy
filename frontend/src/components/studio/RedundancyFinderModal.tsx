import { useState, useEffect } from "react"
import { fetchRedundancyFinder } from "../../lib/studioApi"
import type { RedundancyMatch } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function RedundancyFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ duplicates: RedundancyMatch[]; total: number } | null>(null)
  const [error, setError]       = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchRedundancyFinder(docId))
    } catch {
      setError("Failed to scan for redundancy")
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
            <h2 className="text-white font-semibold text-sm">Redundancy Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Repeated phrases across multiple slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning phrases…</span>
            </div>
          )}

          {data && !loading && (
            data.total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No repeated phrases detected.
              </div>
            ) : (
              <>
                <p className="text-white/40 text-xs">{data.total} repeated phrase{data.total !== 1 ? "s" : ""} found</p>
                <div className="space-y-1.5">
                  {data.duplicates.map((d, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white/70 text-xs font-mono truncate">"{d.phrase}"</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {d.slides.map((n) => (
                            <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                              className="text-[10px] text-accent/60 hover:text-accent bg-accent/8 px-1.5 py-0.5 rounded transition-colors">
                              Slide {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      <span className="text-white/25 text-xs shrink-0">×{d.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )
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
