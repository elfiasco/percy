import { useState } from "react"
import { fetchTrustSignalFinder } from "../../lib/studioApi"
import type { TrustSignal } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const strengthColor = (s: TrustSignal["strength"]) => ({
  strong:   "text-green-400 border-green-400/20 bg-green-400/8",
  moderate: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  weak:     "text-white/40 border-white/10 bg-white/5",
})[s]

const typeIcon: Record<string, string> = {
  testimonial: "💬", case_study: "📋", certification: "✓", logo: "◉",
  statistic: "%", award: "★", partnership: "⇌", guarantee: "⊕",
}

export default function TrustSignalFinderModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ signals: TrustSignal[]; missing_types: string[]; trust_score: number } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchTrustSignalFinder(docId)
      setData(res)
    } catch {
      setError("Failed to find trust signals")
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
            <h2 className="text-white font-semibold text-sm">Trust Signal Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies testimonials, certifications, case studies, and logos</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Finding trust signals…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-xs text-white/40">
                <span>Trust score:</span>
                <span className={`font-semibold text-sm ${data.trust_score >= 7 ? "text-green-400" : data.trust_score >= 4 ? "text-yellow-400" : "text-red-400"}`}>
                  {data.trust_score}/10
                </span>
              </div>

              {data.signals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">Found Signals</p>
                  {data.signals.map((s, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/50">{typeIcon[s.type] ?? "◆"}</span>
                        <span className="text-xs text-white/70 font-medium capitalize flex-1">{s.type.replace("_", " ")}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${strengthColor(s.strength)}`}>{s.strength}</span>
                        <span className="text-[10px] text-white/30">{s.slide_hint}</span>
                      </div>
                      {s.quote && <p className="text-xs text-white/50 italic">"{s.quote}"</p>}
                    </div>
                  ))}
                </div>
              )}

              {data.missing_types.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold mb-1.5">Recommended Additions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.missing_types.map((m, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-red-400/20 bg-red-400/8 text-red-400/70 capitalize">{m.replace("_", " ")}</span>
                    ))}
                  </div>
                </div>
              )}

              {data.signals.length === 0 && (
                <div className="text-white/30 text-xs text-center py-4">No trust signals identified.</div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to identify trust signals in your deck.</div>
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
