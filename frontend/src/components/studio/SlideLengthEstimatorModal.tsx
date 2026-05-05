import { useState, useEffect } from "react"
import { fetchSlideLengthEstimator } from "../../lib/studioApi"
import type { SlideLengthResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideLengthEstimatorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SlideLengthResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideLengthEstimator(docId)
      .then(setData)
      .catch(() => setError("Failed to estimate slide lengths"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxSeconds = data ? Math.max(...data.per_slide.map(s => s.est_seconds), 1) : 1

  const barColor = (sec: number) =>
    sec > 180 ? "bg-red-400/50" : sec > 90 ? "bg-yellow-400/50" : "bg-green-400/50"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Length Estimator</h2>
            <p className="text-white/40 text-xs mt-0.5">Estimated speaking time per slide based on word count</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Estimating times…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex gap-6 text-xs text-white/40">
                <span>Total: <span className="text-white/70">{data.total_label}</span></span>
                <span>Assumption: <span className="text-white/70">{data.wpm_assumption} wpm</span></span>
              </div>

              <div className="space-y-1">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(s.est_seconds)}`}
                        style={{ width: `${Math.round((s.est_seconds / maxSeconds) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-white/50 shrink-0 w-10 text-right">{s.est_label}</span>
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
