import { useState } from "react"
import { fetchAssumptionChecker } from "../../lib/studioApi"
import type { AssumptionEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const riskColor = (r: AssumptionEntry["risk"]) => ({
  low:    "text-green-400 border-green-400/20 bg-green-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  high:   "text-red-400 border-red-400/20 bg-red-400/8",
})[r]

export default function AssumptionCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [assumptions, setAssumptions] = useState<AssumptionEntry[] | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "low" | "medium" | "high">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchAssumptionChecker(docId)
      setAssumptions(res.assumptions)
    } catch {
      setError("Failed to find assumptions")
    } finally {
      setLoading(false)
    }
  }

  const filtered = assumptions
    ? (filter === "all" ? assumptions : assumptions.filter(a => a.risk === filter))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Assumption Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI surfaces unstated assumptions that may confuse audiences</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking assumptions…</p>
            </div>
          )}

          {assumptions && !loading && (
            <>
              <div className="flex items-center gap-2">
                {(["all", "high", "medium", "low"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                      filter === f
                        ? f === "all"    ? "bg-white/10 border-white/20 text-white"
                        : f === "high"   ? "bg-red-400/15 border-red-400/30 text-red-400"
                        : f === "medium" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400"
                                         : "bg-green-400/15 border-green-400/30 text-green-400"
                        : "bg-white/5 border-white/10 text-white/40"
                    }`}>
                    {f}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filtered.map((a, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(a.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                        Slide {a.slide_n}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${riskColor(a.risk)}`}>{a.risk} risk</span>
                    </div>
                    <p className="text-white/70 text-xs leading-relaxed">{a.assumption}</p>
                    <p className="text-accent/60 text-xs">→ {a.suggestion}</p>
                  </div>
                ))}
                {filtered.length === 0 && <div className="text-white/30 text-xs text-center py-4">No assumptions in this category.</div>}
              </div>
            </>
          )}

          {assumptions === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Check" to find unstated assumptions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Checking…" : "Check"}
          </button>
        </div>
      </div>
    </div>
  )
}
