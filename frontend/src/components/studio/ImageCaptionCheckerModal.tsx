import { useState, useEffect } from "react"
import { fetchImageCaptionChecker } from "../../lib/studioApi"
import type { ImageCaptionSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ImageCaptionCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides_with_images: ImageCaptionSlide[]; missing_captions: number[]; total_image_slides: number } | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "missing">("missing")

  useEffect(() => {
    setLoading(true)
    fetchImageCaptionChecker(docId)
      .then(setData)
      .catch(() => setError("Failed to check image captions"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (filter === "missing" ? data.slides_with_images.filter(s => !s.has_caption) : data.slides_with_images)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Image Caption Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects images without adjacent caption text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking image captions…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Image slides: <span className="text-white/70">{data.total_image_slides}</span></span>
                <span>Missing captions: <span className="text-red-400">{data.missing_captions.length}</span></span>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setFilter("missing")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${filter === "missing" ? "bg-red-400/15 border-red-400/30 text-red-400" : "bg-white/5 border-white/10 text-white/40"}`}>Missing</button>
                  <button onClick={() => setFilter("all")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${filter === "all" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>All</button>
                </div>
              </div>

              {data.total_image_slides === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No image slides found.</div>
              ) : filtered.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">All image slides have caption text.</div>
              ) : (
                <div className="space-y-2">
                  {filtered.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${s.has_caption ? "text-green-400 border-green-400/20 bg-green-400/8" : "text-red-400 border-red-400/20 bg-red-400/8"}`}>
                        {s.has_caption ? "captioned" : "no caption"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-white/30">{s.image_count} image{s.image_count !== 1 ? "s" : ""}</p>
                        {s.caption_text && <p className="text-xs text-white/50 truncate">{s.caption_text}</p>}
                      </div>
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
