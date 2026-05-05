import { useState, useEffect } from "react"
import { fetchSlideFootnoteFinder } from "../../lib/studioApi"
import type { FootnoteResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideFootnoteFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FootnoteResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideFootnoteFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find footnotes"))
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
            <h2 className="text-white font-semibold text-sm">Slide Footnote Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Finds very small text (≤8pt) that may be fine print</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for footnotes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Total footnotes: <span className="text-white/70">{data.total_footnotes}</span></span>
                <span>Slides: <span className="text-white/70">{data.flagged_slides.length}</span></span>
              </div>

              {data.per_slide.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">No footnote-sized text found.</div>
              ) : (
                <div className="space-y-3">
                  {data.per_slide.map(s => (
                    <div key={s.slide_n} className="border border-white/8 rounded-lg overflow-hidden">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left">
                        <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                        <span className="flex-1 text-[10px] text-white/50">{s.count} footnote{s.count !== 1 ? "s" : ""}</span>
                      </button>
                      <div className="border-t border-white/5 px-3 py-2 space-y-1.5">
                        {s.footnotes.map((f, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[9px] text-white/20 shrink-0 font-mono mt-0.5">{f.pt}pt</span>
                            <p className="text-[10px] text-white/40 leading-relaxed">{f.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
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
