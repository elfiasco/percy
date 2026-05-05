import { useState } from "react"
import { fetchCompetitiveGapAnalyzer } from "../../lib/studioApi"
import type { CompetitiveGap } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const severityColor = (s: CompetitiveGap["severity"]) => ({
  high:   "text-red-400 border-red-400/20 bg-red-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  low:    "text-green-400 border-green-400/20 bg-green-400/8",
})[s]

export default function CompetitiveGapAnalyzerModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ gaps: CompetitiveGap[]; competitive_score: number; summary: string } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchCompetitiveGapAnalyzer(docId)
      setData(res)
    } catch {
      setError("Failed to analyze competitive gaps")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Competitive Gap Analyzer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI compares your deck to best-in-class competitors</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing competitive gaps…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-xs text-white/40">
                <span>Competitive score:</span>
                <span className={`font-semibold text-sm ${data.competitive_score >= 7 ? "text-green-400" : data.competitive_score >= 4 ? "text-yellow-400" : "text-red-400"}`}>
                  {data.competitive_score}/10
                </span>
              </div>

              {data.summary && (
                <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                  <p className="text-xs text-white/60 leading-relaxed">{data.summary}</p>
                </div>
              )}

              {data.gaps.length > 0 && (
                <div className="space-y-2">
                  {data.gaps.map((g, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white/80 text-xs font-semibold flex-1">{g.area}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${severityColor(g.severity)}`}>{g.severity}</span>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed">
                        <span className="text-white/30">Competitors: </span>{g.what_competitor_does}
                      </p>
                      <p className="text-accent/65 text-xs leading-relaxed">→ {g.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}

              {data.gaps.length === 0 && (
                <div className="text-green-400 text-xs text-center py-4">No significant competitive gaps identified.</div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to find competitive gaps in your deck.</div>
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
