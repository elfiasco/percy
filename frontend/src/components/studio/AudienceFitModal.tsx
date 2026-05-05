import { useState } from "react"
import { fetchAudienceFit } from "../../lib/studioApi"
import type { AudienceFitResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const gradeColor = (g: string) => {
  if (g === "A") return "text-green-400"
  if (g === "B") return "text-blue-400"
  if (g === "C") return "text-yellow-400"
  return "text-red-400"
}

const PRESETS = ["general business", "investors", "technical team", "executives", "students", "sales prospects"]

export default function AudienceFitModal({ docId, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [audience, setAudience] = useState("general business")
  const [data, setData]         = useState<AudienceFitResult | null>(null)
  const [error, setError]       = useState("")

  const run = async () => {
    if (!audience.trim()) return
    setLoading(true)
    setError("")
    try {
      setData(await fetchAudienceFit(docId, audience.trim()))
    } catch {
      setError("Failed to evaluate audience fit")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Audience Fit Score</h2>
            <p className="text-white/40 text-xs mt-0.5">AI scores how well your deck fits a target audience</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="space-y-2">
            <label className="text-white/50 text-xs">Target Audience</label>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. investors, technical team, executives…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-accent/40"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p} onClick={() => setAudience(p)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${audience === p ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Evaluating fit…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className={`text-4xl font-bold ${gradeColor(data.grade)}`}>{data.grade}</div>
                  <div className="text-white/30 text-[10px] mt-0.5">Grade</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-white/80">{data.score}<span className="text-xl text-white/30">/10</span></div>
                  <div className="text-white/30 text-[10px] mt-0.5">Score</div>
                </div>
                {data.summary && <p className="flex-1 text-xs text-white/55 leading-relaxed">{data.summary}</p>}
              </div>

              {data.strong_points.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-green-400/70 text-xs font-medium uppercase tracking-wide">Strengths</p>
                  {data.strong_points.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs text-white/55">
                      <span className="text-green-400/50 shrink-0">✓</span><span>{s}</span>
                    </div>
                  ))}
                </div>
              )}

              {data.gaps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-yellow-400/70 text-xs font-medium uppercase tracking-wide">Gaps</p>
                  {data.gaps.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs text-white/55">
                      <span className="text-yellow-400/50 shrink-0">→</span><span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading || !audience.trim()}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Evaluating…" : "Evaluate"}
          </button>
        </div>
      </div>
    </div>
  )
}
