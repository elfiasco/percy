import { useState } from "react"
import { fetchAuthoritySignals } from "../../lib/studioApi"
import type { AuthoritySignal } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const typeColor = (t: string) => ({
  stat:         "text-blue-400 border-blue-400/20 bg-blue-400/8",
  testimonial:  "text-green-400 border-green-400/20 bg-green-400/8",
  award:        "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  case_study:   "text-paper border-paper/20 bg-paper/8",
  credential:   "text-cyan-400 border-cyan-400/20 bg-cyan-400/8",
  partnership:  "text-orange-400 border-orange-400/20 bg-orange-400/8",
  media:        "text-pink-400 border-pink-400/20 bg-pink-400/8",
})[t] ?? "text-white/40 border-white/10 bg-white/5"

const strengthColor = (n: number) =>
  n >= 7 ? "text-green-400" : n >= 4 ? "text-yellow-400" : "text-red-400"

export default function AuthoritySignalsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [signals, setSignals] = useState<AuthoritySignal[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchAuthoritySignals(docId)
      setSignals(res.signals)
    } catch {
      setError("Failed to find authority signals")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Authority Signals</h2>
            <p className="text-white/40 text-xs mt-0.5">AI finds and rates your credibility indicators</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Identifying authority signals…</p>
            </div>
          )}

          {signals && !loading && (
            <div className="space-y-2">
              {signals.length === 0 ? (
                <div className="text-yellow-400/80 text-xs bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-3 text-center">
                  No strong authority signals found. Consider adding stats, testimonials, or credentials.
                </div>
              ) : (
                signals.map((s, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                        Slide {s.slide_n}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${typeColor(s.type)}`}>{s.type.replace("_", " ")}</span>
                      <span className={`ml-auto text-sm font-bold ${strengthColor(s.strength)}`}>{s.strength}/10</span>
                    </div>
                    <p className="text-white/70 text-xs leading-relaxed">{s.signal}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {signals === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to identify authority and credibility signals.</div>
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
