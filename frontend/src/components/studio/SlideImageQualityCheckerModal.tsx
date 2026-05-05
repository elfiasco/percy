import { useState, useEffect } from "react"
import { fetchSlideImageQualityChecker } from "../../lib/studioApi"
import type { ImageQualityResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const qualityStyle: Record<string, string> = {
  high:   "text-green-400 border-green-400/20 bg-green-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  low:    "text-red-400 border-red-400/20 bg-red-400/8",
}

export default function SlideImageQualityCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ImageQualityResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideImageQualityChecker(docId)
      .then(setData)
      .catch(() => setError("Failed to check image quality"))
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
            <h2 className="text-white font-semibold text-sm">Slide Image Quality Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Resolution and size analysis for all images in the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking image quality…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.images.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No images found in this deck.</div>
              ) : (
                <>
                  <div className="flex gap-4 text-xs text-white/40">
                    <span>Total: <span className="text-white/70">{data.total} images</span></span>
                    {data.low_quality_count > 0 && (
                      <span>Low quality: <span className="text-red-400">{data.low_quality_count}</span></span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {data.images.map((img, i) => (
                      <button key={i} onClick={() => { onJumpToSlide(img.slide_n); onClose() }}
                        className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                        <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {img.slide_n}</span>
                        <div className="flex gap-3 text-[10px] text-white/40 flex-1">
                          <span>{img.width_px}×{img.height_px}</span>
                          <span>~{img.est_dpi}dpi</span>
                          <span>{img.size_kb}kb</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${qualityStyle[img.quality] ?? "text-white/40 border-white/10"}`}>{img.quality}</span>
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
