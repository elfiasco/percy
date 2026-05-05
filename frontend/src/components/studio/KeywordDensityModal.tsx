import { useState, useEffect } from "react"
import { fetchKeywordDensity } from "../../lib/studioApi"
import type { KeywordDensitySlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function KeywordDensityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    global_top: { word: string; count: number }[]
    per_slide: KeywordDensitySlide[]
    total_unique: number
  } | null>(null)
  const [error, setError]   = useState("")
  const [view, setView]     = useState<"global" | "per-slide">("global")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchKeywordDensity(docId))
    } catch {
      setError("Failed to compute keyword density")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxCount = data ? Math.max(...data.global_top.map(k => k.count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Keyword Density</h2>
            <p className="text-white/40 text-xs mt-0.5">Most-used words across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Computing density…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                {(["global", "per-slide"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={`px-3 py-1 rounded text-xs border capitalize transition-colors ${view === v ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {v === "global" ? "Whole Deck" : "Per Slide"}
                  </button>
                ))}
                <span className="text-white/25 text-xs ml-auto">{data.total_unique} unique words</span>
              </div>

              {view === "global" && (
                <div className="space-y-1.5">
                  {data.global_top.map((k) => (
                    <div key={k.word} className="flex items-center gap-3">
                      <span className="text-white/55 text-xs font-mono w-24 truncate">{k.word}</span>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-accent/35 rounded-full" style={{ width: `${(k.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-white/30 text-xs w-6 text-right">{k.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {view === "per-slide" && (
                <div className="space-y-2">
                  {data.per_slide.filter(s => s.top.length > 0).map((s) => (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-[10px] text-accent/60 hover:text-accent transition-colors">
                          Slide {s.slide_n}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {s.top.map((k) => (
                          <span key={k.word} className="text-[10px] text-white/40 bg-white/5 border border-white/8 px-1.5 py-0.5 rounded">
                            {k.word} ×{k.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
