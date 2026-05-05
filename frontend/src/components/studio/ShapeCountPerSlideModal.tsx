import { useState, useEffect } from "react"
import { fetchShapeCountPerSlide } from "../../lib/studioApi"
import type { ShapeCountResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ShapeCountPerSlideModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ShapeCountResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchShapeCountPerSlide(docId)
      .then(setData)
      .catch(() => setError("Failed to count shapes"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxCount = data ? Math.max(...data.per_slide.map(s => s.shape_count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Shape Count Per Slide</h2>
            <p className="text-white/40 text-xs mt-0.5">Total shapes per slide — flags complex slides (&gt;20)</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Counting shapes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Total: <span className="text-white/70">{data.total_shapes}</span></span>
                <span>Avg: <span className="text-white/70">{data.avg_shapes}/slide</span></span>
                <span>Complex: <span className="text-yellow-400">{data.complex_slides.length}</span></span>
              </div>

              <div className="space-y-1">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${s.flagged ? "bg-yellow-400/50" : "bg-accent/40"}`}
                        style={{ width: `${(s.shape_count / maxCount) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-white/50 shrink-0 w-12 text-right">{s.shape_count} shapes</span>
                    {s.flagged && <span className="text-[10px] text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/8 px-1 rounded shrink-0">complex</span>}
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
