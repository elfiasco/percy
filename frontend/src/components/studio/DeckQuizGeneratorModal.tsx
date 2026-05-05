import { useState } from "react"
import { fetchDeckQuizGenerator } from "../../lib/studioApi"
import type { QuizQuestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DeckQuizGeneratorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Record<number, number>>({})
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})

  const run = async () => {
    setLoading(true)
    setError("")
    setSelected({})
    setRevealed({})
    try {
      const res = await fetchDeckQuizGenerator(docId)
      setQuestions(res.questions)
    } catch {
      setError("Failed to generate quiz")
    } finally {
      setLoading(false)
    }
  }

  const pick = (qIdx: number, cIdx: number) => {
    setSelected(s => ({ ...s, [qIdx]: cIdx }))
    setRevealed(r => ({ ...r, [qIdx]: true }))
  }

  const score = questions
    ? questions.filter((q) => selected[q.q - 1] === q.answer).length
    : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Quiz</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates 5 questions to test comprehension</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating quiz…</p>
            </div>
          )}

          {questions && !loading && (
            <>
              {Object.keys(revealed).length === questions.length && (
                <div className={`text-center text-sm font-semibold rounded-lg px-3 py-2 ${
                  score >= 4 ? "text-green-400 bg-green-400/8 border border-green-400/20"
                  : score >= 2 ? "text-yellow-400 bg-yellow-400/8 border border-yellow-400/20"
                  : "text-red-400 bg-red-400/8 border border-red-400/20"
                }`}>
                  Score: {score}/{questions.length}
                </div>
              )}
              <div className="space-y-4">
                {questions.map((q, qi) => (
                  <div key={q.q} className="bg-white/3 border border-white/8 rounded-lg px-3 py-3 space-y-2">
                    <p className="text-white/80 text-xs font-medium">{q.q}. {q.question}</p>
                    <div className="space-y-1">
                      {q.choices.map((c, ci) => {
                        const isSelected = selected[qi] === ci
                        const isRevealed = revealed[qi]
                        const isCorrect  = q.answer === ci
                        let cls = "text-white/55 border-white/10 bg-white/3"
                        if (isRevealed) {
                          if (isCorrect)     cls = "text-green-400 border-green-400/30 bg-green-400/8"
                          else if (isSelected) cls = "text-red-400 border-red-400/30 bg-red-400/8"
                        } else if (isSelected) {
                          cls = "text-white border-white/30 bg-white/8"
                        }
                        return (
                          <button key={ci} onClick={() => pick(qi, ci)}
                            disabled={!!revealed[qi]}
                            className={`w-full text-left text-xs px-3 py-1.5 rounded border transition-colors ${cls}`}>
                            {String.fromCharCode(65 + ci)}. {c}
                          </button>
                        )
                      })}
                    </div>
                    {revealed[qi] && q.explanation && (
                      <p className="text-xs text-accent/60 italic">{q.explanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {questions === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate Quiz" to create a comprehension test.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate Quiz"}
          </button>
        </div>
      </div>
    </div>
  )
}
