import { useState, useEffect } from "react"
import { fetchEmptySlideDetector } from "../../lib/studioApi"
import type { EmptySlideResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function EmptySlideDetectorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<EmptySlideResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "empty" | "sparse">("all")

  useEffect(() => {
    setLoading(true)
    fetchEmptySlideDetector(docId)
      .then(setData)
      .catch(() => setError("Failed to detect empty slides"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data ? data.per_slide.filter(s => {
    if (filter === "empty") return s.empty
    if (filter === "sparse") return s.sparse
    return s.empty || s.sparse
  }) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Empty Slide Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Finds slides with no content or very sparse text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning slides…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>Empty: <span className="text-red-400">{data.total_empty}</span></span>
                  <span>Sparse: <span className="text-yellow-400">{data.total_sparse}</span></span>
                </div>
                <div className="flex gap-1">
                  {(["all", "empty", "sparse"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {slides.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">
                  {filter === "all" ? "All slides have content." : `No ${filter} slides found.`}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {slides.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 flex gap-2 flex-wrap">
                        {s.empty && <span className="text-[10px] text-red-400/70 border border-red-400/20 bg-red-400/8 px-1.5 py-0.5 rounded">empty</span>}
                        {s.sparse && <span className="text-[10px] text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/8 px-1.5 py-0.5 rounded">sparse</span>}
                        {s.has_image && <span className="text-[10px] text-blue-400/50 px-1.5 py-0.5 rounded bg-blue-400/5">image</span>}
                        {s.has_chart && <span className="text-[10px] text-paper/50 px-1.5 py-0.5 rounded bg-paper/5">chart</span>}
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0">{s.shape_count} shape{s.shape_count !== 1 ? "s" : ""}</span>
                    </button>
                  ))}
                </div>
              )}
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
