import { useState, useEffect } from "react"
import { fetchSlideLayerOrderAudit } from "../../lib/studioApi"
import type { LayerOrderResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideLayerOrderAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LayerOrderResult | null>(null)
  const [error, setError] = useState("")
  const [selectedSlide, setSelectedSlide] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchSlideLayerOrderAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit layer order"))
      .finally(() => setLoading(false))
  }, [docId])

  const currentSlide = data?.per_slide.find(s => s.slide_n === selectedSlide)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Layer Order Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Z-order of shapes per slide — bottom to top</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-36 border-r border-white/8 overflow-y-auto py-2 shrink-0">
            {data?.per_slide.map(s => (
              <button key={s.slide_n}
                onClick={() => { setSelectedSlide(s.slide_n); onJumpToSlide(s.slide_n) }}
                className={`w-full text-left px-3 py-1.5 text-[10px] transition-colors ${selectedSlide === s.slide_n ? "bg-accent/15 text-accent" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
                Slide {s.slide_n}
                <span className="ml-1 text-white/20">({s.shape_count})</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

            {loading && (
              <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
                <div className="animate-spin text-2xl">✦</div>
                <p className="text-sm">Loading layers…</p>
              </div>
            )}

            {data && !selectedSlide && !loading && (
              <p className="text-white/30 text-sm text-center py-8">Select a slide to view its layer order.</p>
            )}

            {currentSlide && (
              <div className="space-y-1">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Layers (bottom → top)</p>
                {[...currentSlide.layers].reverse().map((layer, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded bg-white/3 border border-white/5">
                    <span className="text-[9px] text-white/20 font-mono w-5 shrink-0">{currentSlide.layers.length - 1 - i}</span>
                    <span className="flex-1 text-[10px] text-white/60 truncate">{layer.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {layer.has_text && <span className="text-[9px] text-accent/50 bg-accent/5 px-1 rounded">text</span>}
                      <span className="text-[9px] text-white/20">t{layer.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
