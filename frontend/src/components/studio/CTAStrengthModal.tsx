import { useState } from "react"
import { fetchCTAStrength } from "../../lib/studioApi"
import type { CTAEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const strengthColor = (s: number) => s >= 8 ? "text-green-400" : s >= 5 ? "text-yellow-400" : "text-red-400"
const barColor      = (s: number) => s >= 8 ? "bg-green-400/50" : s >= 5 ? "bg-yellow-400/50" : "bg-red-400/50"

export default function CTAStrengthModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ ctas: CTAEntry[]; overall_strength: number; recommendation: string } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchCTAStrength(docId))
    } catch {
      setError("Failed to analyze CTA strength")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">CTA Strength</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rates how compelling your call-to-action is</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing CTAs…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-white/40 text-xs">Overall strength:</span>
                <span className={`text-xl font-bold ${strengthColor(data.overall_strength)}`}>{data.overall_strength}/10</span>
              </div>

              {data.recommendation && (
                <p className="text-white/55 text-xs leading-relaxed bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                  {data.recommendation}
                </p>
              )}

              {data.ctas.length > 0 && (
                <div className="space-y-2">
                  {data.ctas.map((c, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <button onClick={() => { onJumpToSlide(c.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                          Slide {c.slide_n}
                        </button>
                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor(c.strength)}`} style={{ width: `${c.strength * 10}%` }} />
                        </div>
                        <span className={`text-sm font-bold shrink-0 ${strengthColor(c.strength)}`}>{c.strength}</span>
                      </div>
                      {c.cta_text && <p className="text-white/50 text-xs font-medium">"{c.cta_text}"</p>}
                      {c.feedback && <p className="text-white/35 text-xs leading-relaxed">{c.feedback}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to rate your deck's call-to-action.</div>
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
