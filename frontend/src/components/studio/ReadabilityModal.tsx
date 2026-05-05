import { useState, useEffect } from "react"
import type { SlideReadability } from "../../lib/studioApi"
import { fetchReadabilityScores } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_COLORS: Record<string, string> = {
  "very easy":      "text-green-400",
  "easy":           "text-lime-400",
  "moderate":       "text-yellow-400",
  "difficult":      "text-orange-400",
  "very difficult": "text-red-400",
  "n/a":            "text-white/25",
}

const SCORE_BAR: Record<string, string> = {
  "very easy":      "bg-green-500",
  "easy":           "bg-lime-500",
  "moderate":       "bg-yellow-500",
  "difficult":      "bg-orange-500",
  "very difficult": "bg-red-500",
}

export default function ReadabilityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]  = useState(true)
  const [slides, setSlides]    = useState<SlideReadability[]>([])
  const [overall, setOverall]  = useState<{ score: number | null; label: string } | null>(null)
  const [error, setError]      = useState("")
  const [sortDesc, setSortDesc] = useState(false)

  useEffect(() => {
    fetchReadabilityScores(docId)
      .then((r) => {
        setSlides(r.slides)
        setOverall({ score: r.overall_score, label: r.overall_label })
      })
      .catch(() => setError("Failed to compute readability scores."))
      .finally(() => setLoading(false))
  }, [docId])

  const sorted = [...slides].sort((a, b) => {
    const va = a.score ?? (sortDesc ? -1 : 101)
    const vb = b.score ?? (sortDesc ? -1 : 101)
    return sortDesc ? vb - va : va - vb
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Readability Scores</h2>
            <p className="text-white/40 text-xs mt-0.5">Flesch Reading Ease per slide (100=easiest, 0=hardest)</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="text-center py-10 text-white/40 animate-pulse">Analyzing…</div>
          )}

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!loading && overall && (
            <>
              {/* overall card */}
              <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 flex items-center gap-4">
                <div className="text-center">
                  <div className={`text-3xl font-mono font-bold ${LABEL_COLORS[overall.label] ?? "text-white"}`}>
                    {overall.score !== null ? overall.score.toFixed(0) : "—"}
                  </div>
                  <div className="text-white/30 text-[10px]">overall</div>
                </div>
                <div>
                  <div className={`text-sm font-medium capitalize ${LABEL_COLORS[overall.label] ?? "text-white"}`}>{overall.label}</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Flesch Reading Ease score for the entire deck
                  </div>
                </div>
                <div className="ml-auto">
                  <div className="text-[10px] text-white/30 mb-1 text-center">Scale</div>
                  <div className="flex flex-col gap-0.5 text-[9px]">
                    {[["80-100","very easy","text-green-400"],["60-79","easy","text-lime-400"],["40-59","moderate","text-yellow-400"],["20-39","difficult","text-orange-400"],["0-19","very difficult","text-red-400"]].map(([range, label, cls]) => (
                      <div key={range} className="flex items-center gap-1">
                        <span className="text-white/30">{range}</span>
                        <span className={cls}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* sort toggle */}
              <div className="flex items-center gap-2">
                <span className="text-white/30 text-xs">Sort by score:</span>
                <button
                  onClick={() => setSortDesc((d) => !d)}
                  className="text-xs text-accent hover:text-accent/80"
                >
                  {sortDesc ? "Highest first" : "Lowest first"}
                </button>
              </div>

              {/* per-slide list */}
              <div className="space-y-0.5">
                {sorted.map((s) => {
                  const barW = s.score !== null ? s.score : 0
                  const cls  = LABEL_COLORS[s.label] ?? "text-white/40"
                  const bar  = SCORE_BAR[s.label]   ?? "bg-white/20"
                  return (
                    <button
                      key={s.slide_n}
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                    >
                      <span className="w-10 text-xs text-accent group-hover:text-accent/80 font-mono text-left">{s.slide_n}</span>
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full ${bar} rounded-full`} style={{ width: `${barW}%` }} />
                      </div>
                      <span className="w-10 text-xs font-mono text-right text-white/60">
                        {s.score !== null ? s.score.toFixed(0) : "—"}
                      </span>
                      <span className={`w-24 text-[11px] text-right capitalize ${cls}`}>{s.label}</span>
                      <span className="w-12 text-[10px] text-white/25 text-right font-mono">{s.word_count}w</span>
                    </button>
                  )
                })}
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
