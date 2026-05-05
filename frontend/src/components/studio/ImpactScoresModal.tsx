import { useState, useEffect } from "react"
import { fetchImpactScores } from "../../lib/studioApi"
import type { ImpactScore } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_META: Record<string, { color: string; ring: string }> = {
  "High":   { color: "text-green-300",  ring: "stroke-green-400" },
  "Medium": { color: "text-yellow-300", ring: "stroke-yellow-400" },
  "Low":    { color: "text-red-300",    ring: "stroke-red-400" },
}

function ScoreRing({ score }: { score: number }) {
  const pct = score / 10
  const r = 18, cx = 24, cy = 24
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  const label = score >= 7 ? "High" : score >= 4 ? "Medium" : "Low"
  const m = LABEL_META[label]
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className={m.ring}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${m.color}`}>{score}</span>
    </div>
  )
}

export default function ImpactScoresModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ scores: ImpactScore[]; average: number; slide_count: number; high_count: number; low_count: number } | null>(null)
  const [error, setError]     = useState("")
  const [sortBy, setSortBy]   = useState<"slide" | "score_asc" | "score_desc">("slide")
  const [filter, setFilter]   = useState<"all" | "High" | "Medium" | "Low">("all")

  useEffect(() => {
    fetchImpactScores(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to compute impact scores"))
      .finally(() => setLoading(false))
  }, [docId])

  const sorted = data
    ? [...data.scores]
        .filter((s) => filter === "all" || s.label === filter)
        .sort((a, b) =>
          sortBy === "score_desc" ? b.score - a.score
          : sortBy === "score_asc" ? a.score - b.score
          : a.slide_n - b.slide_n
        )
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Impact Scores</h2>
            <p className="text-white/40 text-xs mt-0.5">Memorability & impact scoring for each slide (1–10)</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scoring slides…</p>
            </div>
          ) : data && (
            <>
              {/* summary row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Avg Score", value: data.average.toFixed(1), color: "text-white" },
                  { label: "High Impact", value: data.high_count, color: "text-green-400" },
                  { label: "Low Impact", value: data.low_count, color: "text-red-400" },
                  { label: "Slides", value: data.slide_count, color: "text-white/60" },
                ].map((s) => (
                  <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center">
                    <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
                    <div className="text-white/30 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white/30 text-xs">Filter:</span>
                {(["all", "High", "Medium", "Low"] as const).map((f) => {
                  const m = f === "all" ? null : LABEL_META[f]
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      {f === "all" ? "All" : <span className={m?.color}>{f}</span>}
                    </button>
                  )
                })}
                <span className="ml-auto text-white/30 text-xs">Sort:</span>
                {(["slide", "score_desc", "score_asc"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${sortBy === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    {s === "slide" ? "Slide #" : s === "score_desc" ? "Score ↓" : "Score ↑"}
                  </button>
                ))}
              </div>

              {/* list */}
              <div className="space-y-2">
                {sorted.map((item) => (
                  <div
                    key={item.slide_n}
                    className="flex items-start gap-4 rounded-lg px-4 py-3 bg-white/3 hover:bg-white/5 cursor-pointer group border border-white/5 hover:border-white/10"
                    onClick={() => { onJumpToSlide(item.slide_n); onClose() }}
                  >
                    <ScoreRing score={item.score} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white/60 text-xs font-mono">Slide {item.slide_n}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border border-current/20 ${LABEL_META[item.label]?.color ?? "text-white/40"}`}>{item.label}</span>
                      </div>
                      {item.tip && (
                        <p className="text-white/40 text-xs mt-1 leading-relaxed">{item.tip}</p>
                      )}
                    </div>
                    <span className="text-white/20 text-xs group-hover:text-white/50 transition-colors shrink-0 mt-1">↗</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
