import { useState, useEffect } from "react"
import { fetchComplexityIndex } from "../../lib/studioApi"
import type { ComplexityIndexSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const labelColor = (l: ComplexityIndexSlide["label"]) =>
  l === "high"   ? "text-red-400 bg-red-400/8 border-red-400/20"
  : l === "medium" ? "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"
  : "text-green-400/60 bg-green-400/5 border-green-400/10"

export default function ComplexityIndexModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: ComplexityIndexSlide[]; avg_complexity: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "high" | "medium">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchComplexityIndex(docId))
    } catch {
      setError("Failed to compute complexity index")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const slides = data ? (filter === "all" ? data.slides : data.slides.filter(s => s.label === filter)) : []
  const maxScore = data ? Math.max(...data.slides.map(s => s.score), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Complexity Index</h2>
            <p className="text-white/40 text-xs mt-0.5">Composite complexity score per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Computing complexity…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Avg: <span className="text-white/70">{data.avg_complexity}/100</span></span>
                <span>High: <span className="text-red-400/70">{data.slides.filter(s => s.label === "high").length}</span></span>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "high", "medium"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {f}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/25 rounded-full" style={{ width: `${(s.score / maxScore) * 100}%` }} />
                    </div>
                    <span className="text-white/35 text-xs w-8 text-right shrink-0">{s.score}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${labelColor(s.label)}`}>{s.label}</span>
                  </div>
                ))}
                {slides.length === 0 && (
                  <div className="text-white/30 text-xs text-center py-4">No slides match this filter.</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Computing…" : "Re-compute"}
          </button>
        </div>
      </div>
    </div>
  )
}
