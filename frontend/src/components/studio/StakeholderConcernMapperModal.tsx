import { useState } from "react"
import { fetchStakeholderConcernMapper } from "../../lib/studioApi"
import type { StakeholderConcernResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const severityColor: Record<string, string> = {
  high:   "text-red-400 border-red-400/20 bg-red-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  low:    "text-green-400 border-green-400/20 bg-green-400/8",
}

const riskBg: Record<string, string> = {
  high:   "bg-red-400/5 border-red-400/15",
  medium: "bg-yellow-400/5 border-yellow-400/15",
  low:    "bg-green-400/5 border-green-400/15",
}

export default function StakeholderConcernMapperModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<StakeholderConcernResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "high" | "medium">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchStakeholderConcernMapper(docId)
      setData(res)
    } catch {
      setError("Failed to map stakeholder concerns")
    } finally {
      setLoading(false)
    }
  }

  const concerns = data ? data.per_slide.filter(c => {
    if (c.concern === "none" || !c.concern) return false
    if (filter === "high") return c.severity === "high"
    if (filter === "medium") return c.severity === "medium" || c.severity === "high"
    return true
  }) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Stakeholder Concern Mapper</h2>
            <p className="text-white/40 text-xs mt-0.5">AI maps likely audience objections per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping concerns…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className={`flex-1 border rounded-lg px-4 py-2.5 mr-3 ${riskBg[data.overall_risk]}`}>
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Overall Risk</p>
                  <p className={`text-sm font-semibold capitalize mt-0.5 ${severityColor[data.overall_risk]?.split(" ")[0]}`}>{data.overall_risk}</p>
                </div>
                <div className="flex gap-1">
                  {(["all", "medium", "high"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {data.top_concerns.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Top Concerns</p>
                  {data.top_concerns.map((c, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {c}</p>
                  ))}
                </div>
              )}

              {concerns.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No concerns at this severity level.</div>
              ) : (
                <div className="space-y-1.5">
                  {concerns.map((c, i) => (
                    <button key={i} onClick={() => { onJumpToSlide(c.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {c.slide_n}</span>
                      <p className="flex-1 text-[11px] text-white/60 leading-relaxed">{c.concern}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${severityColor[c.severity] ?? "text-white/40 border-white/10 bg-white/5"}`}>{c.severity}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Map" to analyze stakeholder concerns.</div>
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
