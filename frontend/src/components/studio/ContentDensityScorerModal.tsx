import { useState } from "react"
import { fetchContentDensityScorer } from "../../lib/studioApi"
import type { ContentDensityResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const labelColor: Record<string, string> = {
  sparse:      "text-blue-400 border-blue-400/20 bg-blue-400/8",
  ideal:       "text-green-400 border-green-400/20 bg-green-400/8",
  dense:       "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  overcrowded: "text-red-400 border-red-400/20 bg-red-400/8",
}

const barColor: Record<string, string> = {
  sparse:      "bg-blue-400/40",
  ideal:       "bg-green-400/40",
  dense:       "bg-yellow-400/40",
  overcrowded: "bg-red-400/40",
}

export default function ContentDensityScorerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ContentDensityResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "sparse" | "overcrowded">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchContentDensityScorer(docId)
      setData(res)
    } catch {
      setError("Failed to score content density")
    } finally {
      setLoading(false)
    }
  }

  const slides = data ? data.per_slide.filter(s => {
    if (filter === "sparse") return s.label === "sparse"
    if (filter === "overcrowded") return s.label === "overcrowded" || s.label === "dense"
    return true
  }) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Content Density Scorer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rates each slide as sparse, ideal, dense, or overcrowded</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scoring density…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>Avg density: <span className="text-white/70">{data.avg_density}/10</span></span>
                </div>
                <div className="flex gap-1">
                  {(["all", "sparse", "overcrowded"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {data.recommendation && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.recommendation}</p>
                </div>
              )}

              <div className="space-y-1">
                {slides.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor[s.label] ?? "bg-white/20"}`} style={{ width: `${(s.density_score / 10) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-white/30 w-6 text-right shrink-0">{s.density_score}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${labelColor[s.label] ?? "text-white/40 border-white/10 bg-white/5"}`}>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Score" to evaluate content density per slide.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scoring…" : "Score"}
          </button>
        </div>
      </div>
    </div>
  )
}
