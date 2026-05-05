import { useState } from "react"
import { fetchNarrativeConsistencyChecker } from "../../lib/studioApi"
import type { NarrativeConsistencyResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const issueTypeColor: Record<string, string> = {
  tone_shift:    "text-orange-400 border-orange-400/20 bg-orange-400/8",
  contradiction: "text-red-400 border-red-400/20 bg-red-400/8",
  topic_drift:   "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  gap:           "text-blue-400 border-blue-400/20 bg-blue-400/8",
}

export default function NarrativeConsistencyCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<NarrativeConsistencyResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchNarrativeConsistencyChecker(docId)
      setData(res)
    } catch {
      setError("Failed to check narrative consistency")
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = data
    ? data.overall_consistency >= 7 ? "text-green-400" : data.overall_consistency >= 4 ? "text-yellow-400" : "text-red-400"
    : "text-white/40"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Narrative Consistency Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI checks for tone shifts, contradictions, and topic drift</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking narrative…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${scoreColor}`}>{data.overall_consistency}</div>
                  <div className="text-white/30 text-xs mt-1">consistency / 10</div>
                </div>
              </div>

              {data.verdict && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.verdict}</p>
                </div>
              )}

              {data.recommendation && (
                <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-2.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Recommendation</p>
                  <p className="text-[11px] text-white/60 leading-relaxed">{data.recommendation}</p>
                </div>
              )}

              {data.issues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Issues</p>
                  {data.issues.map((issue, i) => (
                    <button key={i} onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {issue.slide_n}</span>
                      <p className="flex-1 text-[11px] text-white/60 leading-relaxed">{issue.issue}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${issueTypeColor[issue.type] ?? "text-white/40 border-white/10 bg-white/5"}`}>
                        {issue.type.replace("_", " ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {data.issues.length === 0 && (
                <div className="text-green-400 text-xs text-center py-2">No consistency issues found.</div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Check" to analyze narrative consistency.</div>
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
