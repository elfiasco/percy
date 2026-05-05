import { useState } from "react"
import { fetchImageDescriptions } from "../../lib/studioApi"
import type { SlideImageDesc } from "../../lib/studioApi"

interface Props {
  docId: string
  currentSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ImageDescriptionsModal({ docId, currentSlide, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [scope, setScope]     = useState<"current" | "all">("all")
  const [slides, setSlides]   = useState<SlideImageDesc[] | null>(null)
  const [error, setError]     = useState("")
  const [copied, setCopied]   = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const slideNs = scope === "current" ? [currentSlide] : []
      const res = await fetchImageDescriptions(docId, slideNs)
      setSlides(res.slides)
    } catch {
      setError("Failed to generate image descriptions")
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Image Descriptions</h2>
            <p className="text-white/40 text-xs mt-0.5">AI-generated alt text for slide images</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2">
            {(["current", "all"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-3 py-1 rounded text-xs border capitalize transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                {s === "current" ? `Current slide (${currentSlide})` : "All slides"}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating descriptions…</p>
            </div>
          )}

          {slides !== null && !loading && (
            slides.length === 0 ? (
              <div className="text-white/40 text-xs bg-white/3 border border-white/8 rounded-lg px-3 py-3 text-center">
                No images found in the selected scope.
              </div>
            ) : (
              <div className="space-y-3">
                {slides.map((s) => (
                  <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-accent/70 hover:text-accent transition-colors">
                        Slide {s.slide_n}
                      </button>
                      <span className="text-white/25 text-xs ml-auto">{s.image_count} image{s.image_count !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-white/5">
                      {s.descriptions.map((desc, i) => (
                        <div key={i} className="px-3 py-2 flex items-start gap-2">
                          <span className="text-white/20 text-[10px] shrink-0 mt-0.5">#{i + 1}</span>
                          <p className="text-white/60 text-xs leading-relaxed flex-1">{desc}</p>
                          <button onClick={() => copy(desc, `${s.slide_n}-${i}`)}
                            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/30 hover:text-white/60 transition-colors">
                            {copied === `${s.slide_n}-${i}` ? "✓" : "Copy"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {slides === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to create image descriptions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
