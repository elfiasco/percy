import { useState } from "react"
import { fetchOpeningHookRater } from "../../lib/studioApi"
import type { OpeningHookResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const dimLabel: Record<string, string> = {
  curiosity_spark:     "Curiosity Spark",
  clarity_of_promise:  "Clarity of Promise",
  audience_relevance:  "Audience Relevance",
  energy_level:        "Energy Level",
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100)
  const color = value >= 7 ? "bg-green-400/50" : value >= 4 ? "bg-yellow-400/50" : "bg-red-400/50"
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-white/40 w-36 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-white/50 w-8 text-right shrink-0">{value}/10</span>
    </div>
  )
}

export default function OpeningHookRaterModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<OpeningHookResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchOpeningHookRater(docId)
      setData(res)
    } catch {
      setError("Failed to rate opening hook")
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = data
    ? data.hook_score >= 7 ? "text-green-400" : data.hook_score >= 4 ? "text-yellow-400" : "text-red-400"
    : "text-white/40"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Opening Hook Rater</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rates how strongly the first slide captures attention</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Rating opening hook…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${scoreColor}`}>{data.hook_score}</div>
                  <div className="text-white/30 text-xs mt-1">hook score / 10</div>
                </div>
              </div>

              {data.verdict && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.verdict}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] text-white/30 uppercase tracking-wider">Dimensions</p>
                {Object.entries(dimLabel).map(([key, label]) => (
                  <ScoreBar key={key} label={label} value={(data as Record<string, number>)[key] ?? 0} />
                ))}
              </div>

              {data.improvements.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Improvements</p>
                  {data.improvements.map((imp, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {imp}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Rate" to evaluate your opening hook.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Rating…" : "Rate"}
          </button>
        </div>
      </div>
    </div>
  )
}
