import { useState, useEffect } from "react"
import { fetchSlideBackgroundColorChecker } from "../../lib/studioApi"
import type { BgColorResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideBackgroundColorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<BgColorResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideBackgroundColorChecker(docId)
      .then(setData)
      .catch(() => setError("Failed to check background colors"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Background Color Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Shows background color per slide and flags inconsistency</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking backgrounds…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Dominant: <span className="text-white/70 font-mono">#{data.dominant_bg}</span></span>
                <span className={data.inconsistent ? "text-yellow-400" : "text-green-400"}>
                  {data.inconsistent ? "Inconsistent" : "Consistent"}
                </span>
              </div>

              {Object.entries(data.color_summary).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.color_summary).map(([hex, count]) => (
                    <div key={hex} className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-lg px-2 py-1">
                      <div className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: hex === "unknown" ? "#333" : `#${hex}` }} />
                      <span className="text-[10px] text-white/40 font-mono">{hex === "unknown" ? "default" : `#${hex}`}</span>
                      <span className="text-[10px] text-white/25">×{count}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                    <div className="w-5 h-5 rounded-sm border border-white/10 shrink-0"
                      style={{ backgroundColor: s.bg_color === "unknown" ? "#1e1e2e" : `#${s.bg_color}` }} />
                    <span className="text-[10px] text-white/40 font-mono flex-1">
                      {s.bg_color === "unknown" ? "default/theme" : `#${s.bg_color}`}
                    </span>
                    {s.has_custom_bg && <span className="text-[9px] text-accent/50">custom</span>}
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
