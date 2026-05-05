import { useState } from "react"
import { fetchSlideMoodBoard } from "../../lib/studioApi"
import type { SlideMoodEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideMoodBoardModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [slides, setSlides] = useState<SlideMoodEntry[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideMoodBoard(docId)
      setSlides(res.slides)
    } catch {
      setError("Failed to generate mood board")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Mood Board</h2>
            <p className="text-white/40 text-xs mt-0.5">AI suggests visual mood and aesthetic direction per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating mood board…</p>
            </div>
          )}

          {slides && !loading && (
            <div className="space-y-2">
              {slides.map((s, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <span className="text-xs text-white/60 font-medium">{s.mood}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-white/30 block mb-0.5">Palette</span>
                      <span className="text-white/60">{s.palette}</span>
                    </div>
                    <div>
                      <span className="text-white/30 block mb-0.5">Imagery</span>
                      <span className="text-white/60">{s.imagery}</span>
                    </div>
                    <div>
                      <span className="text-white/30 block mb-0.5">Feel</span>
                      <span className="text-white/60">{s.feel}</span>
                    </div>
                  </div>
                </div>
              ))}
              {slides.length === 0 && <div className="text-white/30 text-xs text-center py-4">No slides processed.</div>}
            </div>
          )}

          {slides === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to get mood board suggestions.</div>
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
