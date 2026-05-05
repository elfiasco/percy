import { useState, useEffect } from "react"
import { fetchSlideQuestions } from "../../lib/studioApi"
import type { SlideQuestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideQuestionsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [slides, setSlides] = useState<SlideQuestion[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideQuestions(docId)
      .then(r => setSlides(r.slides))
      .catch(() => setError("Failed to generate questions"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Discussion Questions</h2>
            <p className="text-white/40 text-xs mt-0.5">Comprehension questions generated per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating questions…</p>
            </div>
          )}

          {slides && !loading && (
            <div className="space-y-3">
              {slides.map((s) => (
                <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                  <button
                    onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="text-xs text-accent/60 hover:text-accent transition-colors"
                  >
                    Slide {s.slide_n}
                  </button>
                  <ul className="space-y-1">
                    {s.questions.map((q, i) => (
                      <li key={i} className="text-xs text-white/65 flex gap-2">
                        <span className="text-white/30 shrink-0">{i + 1}.</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {slides.length === 0 && <div className="text-white/30 text-xs text-center py-4">No slides found.</div>}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
