import { useState, useEffect } from "react"
import { fetchDensityHeatmap } from "../../lib/studioApi"
import type { DensityHeatmapSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function DensityHeatmapModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides: DensityHeatmapSlide[]; avg_density: number; max_density: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchDensityHeatmap(docId)
      .then(setData)
      .catch(() => setError("Failed to load density heatmap"))
      .finally(() => setLoading(false))
  }, [docId])

  const pctColor = (pct: number) =>
    pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-yellow-400" : "bg-green-400"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Density Heatmap</h2>
            <p className="text-white/40 text-xs mt-0.5">Visual breakdown of content load per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Calculating density…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Avg density: <span className="text-white/70">{data.avg_density.toFixed(1)}</span></span>
                <span>Peak density: <span className="text-white/70">{data.max_density.toFixed(1)}</span></span>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400 inline-block" /> Low</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-400 inline-block" /> Med</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> High</span>
                </div>
              </div>

              <div className="space-y-1.5">
                {data.slides.map((s) => (
                  <button
                    key={s.slide_n}
                    onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-3 group">
                      <span className="text-[10px] text-white/40 w-12 shrink-0">Slide {s.slide_n}</span>
                      <div className="flex-1 h-4 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className={`h-full rounded-sm transition-all ${pctColor(s.pct)}`}
                          style={{ width: `${Math.max(s.pct, 2)}%`, opacity: 0.8 }}
                        />
                      </div>
                      <div className="flex gap-3 text-[10px] text-white/30 shrink-0 w-36">
                        <span title="words">W:{s.words}</span>
                        <span title="shapes">Sh:{s.shapes}</span>
                        <span title="images">Im:{s.images}</span>
                        <span title="bullets">Bu:{s.bullets}</span>
                      </div>
                      <span className="text-[10px] text-white/50 w-8 text-right">{s.pct.toFixed(0)}%</span>
                    </div>
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
