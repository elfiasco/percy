import { useState } from "react"
import { fetchClaimChecker } from "../../lib/studioApi"
import type { ClaimEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const sevColor = (s: ClaimEntry["severity"]) =>
  s === "high" ? "text-red-400 bg-red-400/8 border-red-400/20"
  : s === "medium" ? "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"
  : "text-white/40 bg-white/5 border-white/10"

export default function ClaimCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ claims: ClaimEntry[]; total: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "high" | "medium" | "low">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchClaimChecker(docId))
    } catch {
      setError("Failed to check claims")
    } finally {
      setLoading(false)
    }
  }

  const claims = data ? (filter === "all" ? data.claims : data.claims.filter(c => c.severity === filter)) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Claim Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI flags unsubstantiated assertions needing citations</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing claims…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                {(["all", "high", "medium", "low"] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded text-xs border capitalize transition-colors ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                    {f === "all" ? `All (${data.total})` : f}
                  </button>
                ))}
              </div>

              {claims.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  {data.total === 0 ? "No unsubstantiated claims found." : "No claims match this filter."}
                </div>
              ) : (
                <div className="space-y-2">
                  {claims.map((c, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { onJumpToSlide(c.slide_n); onClose() }}
                          className="text-[10px] text-accent/60 hover:text-accent transition-colors">
                          Slide {c.slide_n}
                        </button>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${sevColor(c.severity)}`}>
                          {c.severity}
                        </span>
                      </div>
                      <p className="text-white/65 text-xs font-medium leading-relaxed">"{c.claim}"</p>
                      <p className="text-white/40 text-xs leading-relaxed">{c.concern}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Check Claims" to scan for unsubstantiated assertions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Checking…" : "Check Claims"}
          </button>
        </div>
      </div>
    </div>
  )
}
