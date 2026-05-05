import { useState, useEffect } from "react"
import { fetchTitleSlideDetector } from "../../lib/studioApi"
import type { TitleSlideResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TitleSlideDetectorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TitleSlideResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchTitleSlideDetector(docId)
      .then(setData)
      .catch(() => setError("Failed to detect title slides"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Title Slide Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Identifies slides that serve as title or section headers</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Detecting title slides…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.title_slides.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No title slides detected.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.count} title slide{data.count !== 1 ? "s" : ""} detected</p>
                  <div className="space-y-1.5">
                    {data.title_slides.map(s => (
                      <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                        <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                        <p className="flex-1 text-[10px] text-white/50 truncate">{s.reason}</p>
                        <span className="text-[9px] text-accent/60 bg-accent/8 border border-accent/20 px-1.5 py-0.5 rounded shrink-0">title</span>
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
