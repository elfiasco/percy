import { useState, useEffect } from "react"
import { fetchSlidePacingScore } from "../../lib/studioApi"
import type { PacingSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const pacingColor = (p: PacingSlide["pacing"]) => ({
  fast: "text-blue-400 border-blue-400/20 bg-blue-400/8",
  good: "text-green-400 border-green-400/20 bg-green-400/8",
  slow: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
})[p]

export default function SlidePacingScoreModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ per_slide: PacingSlide[]; est_duration_mins: number; fast_slides: number; slow_slides: number; slide_count: number } | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "fast" | "slow">("all")

  useEffect(() => {
    setLoading(true)
    fetchSlidePacingScore(docId)
      .then(setData)
      .catch(() => setError("Failed to score pacing"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (filter === "all" ? data.per_slide : data.per_slide.filter(s => s.pacing === filter))
    : []

  const maxRatio = data ? Math.max(...data.per_slide.map(s => s.density_ratio), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Pacing Score</h2>
            <p className="text-white/40 text-xs mt-0.5">Estimated pacing based on content density</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scoring pacing…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40 flex-wrap">
                <span>Est. duration: <span className="text-white/70">{data.est_duration_mins} min</span></span>
                <span>Fast slides: <span className="text-blue-400">{data.fast_slides}</span></span>
                <span>Slow slides: <span className="text-yellow-400">{data.slow_slides}</span></span>
                <div className="flex gap-1.5 ml-auto">
                  {(["all", "fast", "slow"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded border text-xs capitalize transition-colors ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>{f}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                {filtered.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${pacingColor(s.pacing)}`}>{s.pacing}</span>
                    <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                      <div
                        className={`h-full rounded-sm ${s.pacing === "slow" ? "bg-yellow-400/40" : s.pacing === "fast" ? "bg-blue-400/30" : "bg-green-400/40"}`}
                        style={{ width: `${Math.min((s.density_ratio / maxRatio) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-white/30 w-12 text-right shrink-0">{s.word_count}w</span>
                  </button>
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
