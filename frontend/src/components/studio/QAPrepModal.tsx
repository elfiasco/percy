import { useState } from "react"
import { generateQAPrep } from "../../lib/studioApi"
import type { QAQuestion } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
}

const DIFF_STYLE: Record<string, string> = {
  easy:   "text-green-400 bg-green-400/10 border-green-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  hard:   "text-red-400 bg-red-400/10 border-red-400/20",
}

export default function QAPrepModal({ docId, slideCount, currentSlide, onClose }: Props) {
  const [slideN, setSlideN]       = useState(currentSlide)
  const [count, setCount]         = useState(5)
  const [loading, setLoading]     = useState(false)
  const [questions, setQuestions] = useState<QAQuestion[] | null>(null)
  const [error, setError]         = useState("")
  const [expanded, setExpanded]   = useState<number | null>(null)

  const generate = async () => {
    setLoading(true)
    setError("")
    setQuestions(null)
    try {
      const r = await generateQAPrep(docId, slideN, count)
      setQuestions(r.questions)
    } catch {
      setError("Failed to generate Q&A prep")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Q&A Prep</h2>
            <p className="text-white/40 text-xs mt-0.5">AI predicts audience questions so you can prepare answers</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-white/60 text-xs">Slide:</label>
              <input
                type="number"
                min={1}
                max={slideCount}
                value={slideN}
                onChange={(e) => setSlideN(Math.max(1, Math.min(slideCount, parseInt(e.target.value) || 1)))}
                className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50"
              />
              <span className="text-white/25 text-xs">of {slideCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-white/60 text-xs">Questions:</label>
              <select
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
              >
                {[3, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating questions…</p>
            </div>
          )}

          {questions !== null && !loading && (
            questions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-white/30">
                <p className="text-sm">No questions generated. The slide may have no text content.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="rounded-lg border border-white/10 overflow-hidden">
                    <button
                      className="w-full flex items-start gap-3 px-4 py-3 bg-white/3 hover:bg-white/6 text-left"
                      onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border mt-0.5 ${DIFF_STYLE[q.difficulty]}`}>{q.difficulty}</span>
                      <span className="text-white/70 text-xs flex-1 leading-relaxed">{q.question}</span>
                      <span className="text-white/25 text-xs shrink-0 ml-2">{expanded === i ? "▲" : "▼"}</span>
                    </button>
                    {expanded === i && (
                      <div className="px-4 py-3 border-t border-white/8 bg-white/2">
                        <div className="text-white/40 text-[10px] mb-1">Suggested answer</div>
                        <p className="text-white/60 text-xs leading-relaxed">{q.suggested_answer}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {questions === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Configure options and click "Generate Questions".</p>
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
            {loading ? "Generating…" : "Generate Questions"}
          </button>
        </div>
      </div>
    </div>
  )
}
