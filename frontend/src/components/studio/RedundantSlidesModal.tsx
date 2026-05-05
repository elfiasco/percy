import { useState, useEffect } from "react"
import { fetchRedundantSlides } from "../../lib/studioApi"
import type { RedundantPair } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const severityColor = (s: RedundantPair["severity"]) =>
  s === "high" ? "text-red-400 bg-red-400/8 border-red-400/20"
  : "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"

export default function RedundantSlidesModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ pairs: RedundantPair[]; total: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "high">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchRedundantSlides(docId))
    } catch {
      setError("Failed to find redundant slides")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const pairs = data ? (filter === "high" ? data.pairs.filter(p => p.severity === "high") : data.pairs) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Redundant Slides</h2>
            <p className="text-white/40 text-xs mt-0.5">Find slides with overlapping content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning for duplicates…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">
                  {data.total} redundant pair{data.total !== 1 ? "s" : ""} found
                </span>
                <div className="flex items-center gap-2">
                  {(["all", "high"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                      {f === "high" ? "High only" : "All"}
                    </button>
                  ))}
                </div>
              </div>

              {pairs.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  {data.total === 0 ? "No redundant slides detected." : "No pairs match this filter."}
                </div>
              ) : (
                <div className="space-y-2">
                  {pairs.map((p, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { onJumpToSlide(p.slide_a); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {p.slide_a}</button>
                          <span className="text-white/20 text-xs">≈</span>
                          <button onClick={() => { onJumpToSlide(p.slide_b); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {p.slide_b}</button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/30 text-[10px]">{(p.similarity * 100).toFixed(0)}% similar</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${severityColor(p.severity)}`}>{p.severity}</span>
                        </div>
                      </div>
                      {p.shared_words.length > 0 && (
                        <p className="text-white/25 text-[10px]">Shared: {p.shared_words.join(", ")}</p>
                      )}
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
