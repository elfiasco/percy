import { useState, useEffect } from "react"
import { fetchDuplicateSlideContent } from "../../lib/studioApi"
import type { DuplicateSlideContentResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function DuplicateSlideContentModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DuplicateSlideContentResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchDuplicateSlideContent(docId)
      .then(setData)
      .catch(() => setError("Failed to detect duplicate content"))
      .finally(() => setLoading(false))
  }, [docId])

  const overlapColor = (pct: number) =>
    pct >= 80 ? "text-red-400 border-red-400/20 bg-red-400/8" :
    pct >= 60 ? "text-yellow-400 border-yellow-400/20 bg-yellow-400/8" :
    "text-green-400 border-green-400/20 bg-green-400/8"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Duplicate Slide Content</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects slides with highly similar text content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Comparing slides…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.duplicates.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-6">No duplicate slide content found.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.total_pairs} similar pair{data.total_pairs !== 1 ? "s" : ""} found (≥60% overlap)</p>
                  <div className="space-y-2">
                    {[...data.duplicates].sort((a, b) => b.overlap_pct - a.overlap_pct).map((pair, i) => (
                      <div key={i} className="flex items-center gap-3 border border-white/8 rounded-lg px-3 py-2.5">
                        <div className="flex gap-1 text-[10px]">
                          <button onClick={() => { onJumpToSlide(pair.slide_a); onClose() }}
                            className="text-accent/70 hover:text-accent underline">Slide {pair.slide_a}</button>
                          <span className="text-white/20">+</span>
                          <button onClick={() => { onJumpToSlide(pair.slide_b); onClose() }}
                            className="text-accent/70 hover:text-accent underline">Slide {pair.slide_b}</button>
                        </div>
                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-400/40 rounded-full" style={{ width: `${pair.overlap_pct}%` }} />
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${overlapColor(pair.overlap_pct)}`}>
                          {pair.overlap_pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
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
