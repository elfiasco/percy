import { useState, useEffect } from "react"
import { fetchConsistentIconographyCheck } from "../../lib/studioApi"
import type { IconographyResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ConsistentIconographyCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<IconographyResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchConsistentIconographyCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check iconography consistency"))
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
            <h2 className="text-white font-semibold text-sm">Consistent Iconography Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Checks whether image/icon sizes are uniform across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking iconography…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Total images: <span className="text-white/70">{data.total_images}</span></span>
                <span>Avg size: <span className="text-white/70">{data.avg_size_pt}pt</span></span>
                <span>Std dev: <span className={data.inconsistent ? "text-yellow-400" : "text-green-400"}>{data.stddev_pt}pt</span></span>
              </div>

              <div className={`rounded-lg px-4 py-3 border ${data.inconsistent ? "bg-yellow-400/5 border-yellow-400/15" : "bg-green-400/5 border-green-400/15"}`}>
                <p className={`text-xs ${data.inconsistent ? "text-yellow-400/80" : "text-green-400/80"}`}>
                  {data.inconsistent
                    ? "Icon sizes vary significantly — consider standardizing for visual consistency."
                    : "Icon sizes are consistent throughout the deck."}
                </p>
              </div>

              {data.total_images === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No images found in this deck.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.per_slide.filter(s => s.count > 0).map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 flex flex-wrap gap-1.5">
                        {s.image_sizes.map((sz, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 font-mono">{sz.w}×{sz.h}</span>
                        ))}
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0">{s.count} img</span>
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
