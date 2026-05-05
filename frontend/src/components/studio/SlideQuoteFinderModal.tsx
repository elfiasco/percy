import { useState, useEffect } from "react"
import { fetchSlideQuoteFinder } from "../../lib/studioApi"
import type { SlideQuoteResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideQuoteFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SlideQuoteResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideQuoteFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find quotes"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Quote Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Finds quoted text passages in your slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for quotes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.quotes.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No quoted text found in slides.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.total} quote{data.total !== 1 ? "s" : ""} found</p>
                  <div className="space-y-2">
                    {data.quotes.map((q, i) => (
                      <button key={i} onClick={() => { onJumpToSlide(q.slide_n); onClose() }}
                        className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                        <span className="text-[10px] text-white/40 shrink-0 w-14 pt-0.5">Slide {q.slide_n}</span>
                        <p className="flex-1 text-[11px] text-white/60 leading-relaxed italic">"{q.quote}"</p>
                      </button>
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
