import { useState, useEffect } from "react"
import { fetchContentBalance } from "../../lib/studioApi"
import type { ContentBalanceSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const balanceColor = (b: ContentBalanceSlide["balance"]) =>
  b === "balanced"     ? "text-green-400 bg-green-400/8 border-green-400/20"
  : b === "text-heavy"   ? "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"
  : "text-blue-400 bg-blue-400/8 border-blue-400/20"

export default function ContentBalanceModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: ContentBalanceSlide[]; avg_text_pct: number; avg_image_pct: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "text-heavy" | "visual-heavy">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchContentBalance(docId))
    } catch {
      setError("Failed to analyze content balance")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const slides = data ? (filter === "all" ? data.slides : data.slides.filter(s => s.balance === filter)) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Content Balance</h2>
            <p className="text-white/40 text-xs mt-0.5">Text vs. visual balance per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing balance…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-400">{data.avg_text_pct}%</div>
                  <div className="text-white/40 text-xs mt-0.5">Avg text shapes</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-400">{data.avg_image_pct}%</div>
                  <div className="text-white/40 text-xs mt-0.5">Avg visual shapes</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "text-heavy", "visual-heavy"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {f === "all" ? "All" : f}
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
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                      <div className="h-full bg-yellow-400/30 rounded-l-full" style={{ width: `${s.text_pct}%` }} />
                      <div className="h-full bg-blue-400/30" style={{ width: `${s.image_pct}%` }} />
                      <div className="h-full bg-green-400/20 rounded-r-full" style={{ width: `${s.chart_pct}%` }} />
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${balanceColor(s.balance)}`}>{s.balance}</span>
                  </div>
                ))}
                {slides.length === 0 && (
                  <div className="text-white/30 text-xs text-center py-4">No slides match this filter.</div>
                )}
              </div>

              <div className="flex items-center gap-4 text-[10px] text-white/30">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-400/40 inline-block" /> text</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400/40 inline-block" /> image</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400/30 inline-block" /> chart</span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
