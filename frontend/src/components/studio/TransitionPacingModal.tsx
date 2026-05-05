import { useState, useEffect } from "react"
import { fetchTransitionPacing } from "../../lib/studioApi"
import type { TransitionEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const labelColor = (l: TransitionEntry["label"]) =>
  l === "smooth"   ? "text-green-400 bg-green-400/8 border-green-400/20"
  : l === "moderate" ? "text-blue-400 bg-blue-400/8 border-blue-400/20"
  : "text-red-400 bg-red-400/8 border-red-400/20"

export default function TransitionPacingModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ transitions: TransitionEntry[]; avg_continuity: number; abrupt_count: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "abrupt" | "moderate">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchTransitionPacing(docId))
    } catch {
      setError("Failed to analyze transition pacing")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const transitions = data ? (
    filter === "all" ? data.transitions :
    filter === "abrupt" ? data.transitions.filter(t => t.label === "abrupt") :
    data.transitions.filter(t => t.label === "moderate")
  ) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Transition Pacing</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect abrupt topic shifts between slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing pacing…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Avg continuity: <span className="text-white/70">{(data.avg_continuity * 100).toFixed(1)}%</span></span>
                <span>Abrupt: <span className="text-red-400/70">{data.abrupt_count}</span></span>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "abrupt", "moderate"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {f}
                  </button>
                ))}
              </div>

              {transitions.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  No transitions match this filter.
                </div>
              ) : (
                <div className="space-y-2">
                  {transitions.map((t) => (
                    <div key={`${t.from_slide}-${t.to_slide}`} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { onJumpToSlide(t.from_slide); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {t.from_slide}</button>
                          <span className="text-white/20 text-xs">→</span>
                          <button onClick={() => { onJumpToSlide(t.to_slide); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {t.to_slide}</button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/30 text-[10px]">{(t.jaccard * 100).toFixed(1)}%</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${labelColor(t.label)}`}>{t.label}</span>
                        </div>
                      </div>
                      {t.shared_words.length > 0 && (
                        <p className="text-white/25 text-[10px]">Shared: {t.shared_words.join(", ")}</p>
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
            {loading ? "Analyzing…" : "Re-check"}
          </button>
        </div>
      </div>
    </div>
  )
}
