import { useState } from "react"
import { fetchTopicCoverage } from "../../lib/studioApi"
import type { CoveredTopic } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TopicCoverageModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ covered: CoveredTopic[]; over_covered: string[]; missing: string[] } | null>(null)
  const [error, setError]     = useState("")
  const [tab, setTab]         = useState<"covered" | "over" | "missing">("covered")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchTopicCoverage(docId))
    } catch {
      setError("Failed to map topic coverage")
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
            <h2 className="text-white font-semibold text-sm">Topic Coverage Map</h2>
            <p className="text-white/40 text-xs mt-0.5">AI maps covered, over-covered, and missing topics</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping topics…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => setTab("covered")}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${tab === "covered" ? "bg-green-400/15 border-green-400/30 text-green-400" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Covered ({data.covered.length})
                </button>
                <button onClick={() => setTab("over")}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${tab === "over" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Over-covered ({data.over_covered.length})
                </button>
                <button onClick={() => setTab("missing")}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${tab === "missing" ? "bg-red-400/15 border-red-400/30 text-red-400" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Missing ({data.missing.length})
                </button>
              </div>

              {tab === "covered" && (
                <div className="space-y-1.5">
                  {data.covered.map((t, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-white/60 flex-1">{t.topic}</span>
                      <div className="flex gap-1">
                        {t.slides.slice(0, 6).map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-green-400/20 bg-green-400/8 text-green-300/70 hover:text-green-300 transition-colors">
                            s{n}
                          </button>
                        ))}
                        {t.slides.length > 6 && <span className="text-[10px] text-white/30">+{t.slides.length - 6}</span>}
                      </div>
                    </div>
                  ))}
                  {data.covered.length === 0 && <div className="text-white/30 text-xs text-center py-4">No topics mapped.</div>}
                </div>
              )}

              {tab === "over" && (
                <div className="space-y-1.5">
                  {data.over_covered.map((t, i) => (
                    <div key={i} className="flex gap-2 text-xs text-white/60">
                      <span className="text-yellow-400/50 shrink-0">⚠</span>
                      <span>{t}</span>
                    </div>
                  ))}
                  {data.over_covered.length === 0 && <div className="text-white/30 text-xs text-center py-4">No over-covered topics.</div>}
                </div>
              )}

              {tab === "missing" && (
                <div className="space-y-1.5">
                  {data.missing.map((t, i) => (
                    <div key={i} className="flex gap-2 text-xs text-white/60">
                      <span className="text-red-400/50 shrink-0">✗</span>
                      <span>{t}</span>
                    </div>
                  ))}
                  {data.missing.length === 0 && <div className="text-green-400/80 text-xs text-center py-4">No missing topics identified.</div>}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Map" to analyze topic coverage.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Mapping…" : "Map"}
          </button>
        </div>
      </div>
    </div>
  )
}
