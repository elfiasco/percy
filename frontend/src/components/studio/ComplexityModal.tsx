import { useState, useEffect } from "react"
import { fetchComplexity } from "../../lib/studioApi"
import type { SlideComplexity } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LEVEL_COLOR: Record<string, string> = {
  simple:   "text-green-400",
  moderate: "text-yellow-400",
  complex:  "text-red-400",
}

const BAR_COLOR: Record<string, string> = {
  simple:   "bg-green-500/60",
  moderate: "bg-yellow-500/60",
  complex:  "bg-red-500/60",
}

export default function ComplexityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideComplexity[]; avg_score: number; complex_count: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")
  const [sort, setSort]       = useState<"slide" | "score">("slide")
  const [filter, setFilter]   = useState<"all" | "complex" | "moderate" | "simple">("all")

  useEffect(() => {
    fetchComplexity(docId)
      .then(setData)
      .catch(() => setError("Failed to load complexity data"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data?.slides
    ? [...data.slides]
        .filter((s) => filter === "all" || s.level === filter)
        .sort((a, b) => sort === "score" ? b.score - a.score : a.slide_n - b.slide_n)
    : []

  const maxScore = data ? Math.max(...data.slides.map((s) => s.score), 1) : 100

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Complexity Score</h2>
            <p className="text-white/40 text-xs mt-0.5">Element and text density — spot over-stuffed slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing slides…</p>
            </div>
          ) : data && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold text-lg">{data.avg_score}</div>
                  <div className="text-white/35 text-xs mt-0.5">Avg Score</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className={`font-semibold text-lg ${data.complex_count > 0 ? "text-red-400" : "text-green-400"}`}>{data.complex_count}</div>
                  <div className="text-white/35 text-xs mt-0.5">Complex Slides</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold text-lg">{data.slide_count}</div>
                  <div className="text-white/35 text-xs mt-0.5">Total Slides</div>
                </div>
              </div>

              {/* Filters + sort */}
              <div className="flex items-center gap-2 flex-wrap">
                {(["all", "complex", "moderate", "simple"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    {f}
                  </button>
                ))}
                <button
                  onClick={() => setSort(sort === "slide" ? "score" : "slide")}
                  className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Sort by {sort === "slide" ? "score ↕" : "slide # ↕"}
                </button>
              </div>

              {/* Slides list */}
              <div className="space-y-1.5">
                {slides.map((s) => (
                  <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-white/50 hover:text-accent transition-colors shrink-0 w-14 text-right"
                      >
                        Slide {s.slide_n}
                      </button>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${BAR_COLOR[s.level]}`}
                          style={{ width: `${(s.score / maxScore) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono shrink-0 w-10 text-right ${LEVEL_COLOR[s.level]}`}>{s.score}</span>
                      <span className={`text-xs shrink-0 w-16 capitalize ${LEVEL_COLOR[s.level]}`}>{s.level}</span>
                    </div>
                    <div className="flex gap-4 mt-1 ml-[68px]">
                      <span className="text-white/25 text-[10px]">{s.word_count} words</span>
                      <span className="text-white/25 text-[10px]">{s.el_count} elements</span>
                      {s.image_els > 0 && <span className="text-white/25 text-[10px]">{s.image_els} images</span>}
                    </div>
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
