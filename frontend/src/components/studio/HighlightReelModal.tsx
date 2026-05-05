import { useState } from "react"
import { fetchHighlightReel } from "../../lib/studioApi"
import type { HighlightSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function HighlightReelModal({ docId, slideCount, onClose, onJumpToSlide }: Props) {
  const [count, setCount]           = useState(5)
  const [loading, setLoading]       = useState(false)
  const [highlights, setHighlights] = useState<HighlightSlide[] | null>(null)
  const [error, setError]           = useState("")

  const generate = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchHighlightReel(docId, count)
      setHighlights(r.highlights)
    } catch {
      setError("Failed to generate highlight reel")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Highlight Reel</h2>
            <p className="text-white/40 text-xs mt-0.5">AI picks your most impactful slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <label className="text-white/60 text-xs">Highlight count:</label>
            {[3, 5, 7, 10].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${count === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >
                {n}
              </button>
            ))}
            <span className="text-white/25 text-xs ml-auto">of {slideCount} slides</span>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Selecting highlights…</p>
            </div>
          )}

          {highlights !== null && !loading && (
            highlights.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-white/30">
                <p className="text-sm">No highlights found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {highlights.map((h, i) => (
                  <div key={h.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-accent/70 text-xs font-mono shrink-0">#{i + 1}</span>
                      <button
                        onClick={() => { onJumpToSlide(h.slide_n); onClose() }}
                        className="text-white/70 text-sm font-medium hover:text-accent transition-colors"
                      >
                        Slide {h.slide_n}
                      </button>
                    </div>
                    <p className="text-white/40 text-xs leading-relaxed">{h.reason}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {highlights === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Generate Highlights" to find your best slides.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={generate}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Selecting…" : "Generate Highlights"}
          </button>
        </div>
      </div>
    </div>
  )
}
