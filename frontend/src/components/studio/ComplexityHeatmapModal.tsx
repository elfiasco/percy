import { useState, useEffect } from "react"
import { fetchComplexityHeatmap } from "../../lib/studioApi"
import type { SlideComplexityPoint } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_COLOR: Record<string, string> = {
  light:  "text-green-400 bg-green-400/10 border-green-400/25",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25",
  heavy:  "text-red-400 bg-red-400/10 border-red-400/25",
}

const BAR_COLOR: Record<string, string> = {
  light: "bg-green-400/50",
  medium: "bg-yellow-400/50",
  heavy: "bg-red-400/50",
}

export default function ComplexityHeatmapModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideComplexityPoint[]; avg_score: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchComplexityHeatmap(docId)
      .then(setData)
      .catch(() => setError("Failed to load complexity data"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Complexity Heatmap</h2>
            <p className="text-white/40 text-xs mt-0.5">Visual weight of each slide (elements, words, images)</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing…</span>
            </div>
          ) : data && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Avg complexity: <span className="text-white/60 font-medium">{data.avg_score}/10</span></span>
                <div className="flex gap-2 ml-auto">
                  {(["light", "medium", "heavy"] as const).map((l) => (
                    <span key={l} className={`px-2 py-0.5 rounded border text-[10px] ${LABEL_COLOR[l]}`}>{l}</span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {data.slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-white/35 hover:text-accent transition-colors shrink-0 w-14 text-right"
                    >
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all ${BAR_COLOR[s.label]}`}
                        style={{ width: `${(s.score / 10) * 100}%` }}
                        title={`${s.elements} elements · ${s.words} words · ${s.images} images`}
                      />
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 w-14 text-center ${LABEL_COLOR[s.label]}`}>{s.label}</span>
                    <span className="text-white/25 text-[10px] font-mono w-6 text-right">{s.score}</span>
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
