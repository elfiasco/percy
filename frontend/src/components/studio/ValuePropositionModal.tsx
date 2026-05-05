import { useState } from "react"
import { fetchValueProposition } from "../../lib/studioApi"
import type { ValuePropEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const strengthColor = (s: number) =>
  s >= 7 ? "text-green-400" : s >= 4 ? "text-yellow-400" : "text-red-400"

export default function ValuePropositionModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ propositions: ValuePropEntry[]; avg_strength: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchValueProposition(docId))
    } catch {
      setError("Failed to find value propositions")
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
            <h2 className="text-white font-semibold text-sm">Value Proposition Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies and rates benefit statements</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Finding value propositions…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Found: <span className="text-white/70">{data.propositions.length}</span></span>
                <span>Avg strength: <span className={strengthColor(data.avg_strength)}>{data.avg_strength}/10</span></span>
              </div>

              {data.propositions.length === 0 ? (
                <div className="text-yellow-400/80 text-xs bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-3 text-center">
                  No clear value propositions detected. Consider adding benefit statements.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.propositions.map((p, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(p.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {p.slide_n}</button>
                        <span className={`text-sm font-bold ${strengthColor(p.strength)}`}>{p.strength}/10</span>
                      </div>
                      <p className="text-white/70 text-xs leading-relaxed font-medium">{p.statement}</p>
                      {p.suggestion && (
                        <p className="text-accent/55 text-xs leading-relaxed">→ {p.suggestion}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to identify value propositions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Finding…" : "Find"}
          </button>
        </div>
      </div>
    </div>
  )
}
