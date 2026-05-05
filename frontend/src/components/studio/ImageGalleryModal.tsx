import { useState, useEffect } from "react"
import { fetchDeckImages } from "../../lib/studioApi"
import type { DeckImage } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ImageGalleryModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ images: DeckImage[]; total: number; slide_count: number; images_per_slide: number } | null>(null)
  const [error, setError]       = useState("")
  const [selected, setSelected] = useState<DeckImage | null>(null)
  const [columns, setColumns]   = useState(4)

  useEffect(() => {
    fetchDeckImages(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to load image gallery"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#12121c] border border-white/10 rounded-xl shadow-2xl w-[800px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Image Gallery</h2>
            <p className="text-white/30 text-xs mt-0.5">
              {data ? `${data.total} image${data.total !== 1 ? "s" : ""} across ${data.slide_count} slides` : "All images in the deck"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-xs">Columns:</span>
            {[3, 4, 5, 6].map((c) => (
              <button
                key={c}
                onClick={() => setColumns(c)}
                className={`w-7 h-7 rounded text-xs transition-colors ${columns === c ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white hover:bg-white/10"}`}
              >
                {c}
              </button>
            ))}
            <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded ml-2">×</button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* gallery grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
                <div className="animate-spin text-2xl">✦</div>
                <p className="text-sm">Loading images…</p>
              </div>
            ) : data && data.images.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <div className="text-4xl text-white/20">◻</div>
                <p className="text-white/40 text-sm">No images found in this deck</p>
              </div>
            ) : data && (
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
              >
                {data.images.map((img) => (
                  <div
                    key={`${img.slide_n}-${img.element_id}`}
                    className={`group cursor-pointer rounded-lg border overflow-hidden transition-all ${selected?.element_id === img.element_id && selected.slide_n === img.slide_n ? "border-accent shadow-accent/20 shadow-md" : "border-white/10 hover:border-white/25"}`}
                    onClick={() => setSelected(img)}
                  >
                    <div className="relative bg-black/30" style={{ aspectRatio: "4/3" }}>
                      <img
                        src={img.thumbnail_url}
                        alt={img.alt_text || `Image on slide ${img.slide_n}`}
                        className="w-full h-full object-contain"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).src = "" }}
                      />
                      <div className="absolute top-1 left-1 bg-black/70 text-white/60 text-[9px] font-mono px-1.5 py-0.5 rounded">
                        Slide {img.slide_n}
                      </div>
                    </div>
                    <div className="px-2 py-1 bg-black/20">
                      <p className="text-white/30 text-[9px] truncate">{img.alt_text || "No alt text"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* detail pane */}
          {selected && (
            <div className="w-48 shrink-0 border-l border-white/10 p-3 space-y-3 overflow-y-auto">
              <div className="aspect-video bg-black/30 rounded overflow-hidden">
                <img
                  src={selected.thumbnail_url}
                  alt={selected.alt_text}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/30">Slide</span>
                  <span className="text-white/70">{selected.slide_n}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/30">Size</span>
                  <span className="text-white/70">{selected.width_in.toFixed(2)}" × {selected.height_in.toFixed(2)}"</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/30">Type</span>
                  <span className="text-white/70">{selected.shape_type.replace("_", " ")}</span>
                </div>
                {selected.alt_text && (
                  <div>
                    <div className="text-white/30 mb-0.5">Alt text</div>
                    <p className="text-white/60 text-[10px] leading-relaxed">{selected.alt_text}</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => { onJumpToSlide(selected.slide_n); onClose() }}
                className="w-full text-xs py-1.5 rounded bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
              >
                Go to Slide {selected.slide_n} ↗
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-2 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
