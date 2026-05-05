import { useState } from "react"
import { fetchPresentationRisks } from "../../lib/studioApi"
import type { RiskEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const severityColor = (s: RiskEntry["severity"]) =>
  s === "high"   ? "text-red-400 bg-red-400/8 border-red-400/20"
  : s === "medium" ? "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"
  : "text-blue-400 bg-blue-400/8 border-blue-400/20"

export default function PresentationRisksModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [risks, setRisks]     = useState<RiskEntry[] | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "high" | "medium">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchPresentationRisks(docId)
      setRisks(res.risks)
    } catch {
      setError("Failed to assess presentation risks")
    } finally {
      setLoading(false)
    }
  }

  const displayed = risks ? (filter === "all" ? risks : risks.filter(r => r.severity === filter)) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Presentation Risks</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies red flags in your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Assessing risks…</p>
            </div>
          )}

          {risks !== null && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">{risks.length} risk{risks.length !== 1 ? "s" : ""} identified</span>
                <div className="flex items-center gap-2">
                  {(["all", "high", "medium"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                      {f === "high" ? "High" : f === "medium" ? "Medium" : "All"}
                    </button>
                  ))}
                </div>
              </div>

              {displayed.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  {risks.length === 0 ? "No risks detected." : "No risks match this filter."}
                </div>
              ) : (
                <div className="space-y-2">
                  {displayed.map((r, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(r.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">
                          Slide {r.slide_n}
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-white/35 text-[10px] capitalize">{r.category}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${severityColor(r.severity)}`}>{r.severity}</span>
                        </div>
                      </div>
                      <p className="text-white/55 text-xs leading-relaxed">{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {risks === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to identify potential risks.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
