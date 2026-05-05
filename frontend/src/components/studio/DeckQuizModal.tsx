import { useState } from "react"
import { fetchDeckQuiz } from "../../lib/studioApi"
import type { QuizQuestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DeckQuizModal({ docId, onClose }: Props) {
  const [count, setCount]       = useState(5)
  const [loading, setLoading]   = useState(false)
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [error, setError]         = useState("")
  const [answers, setAnswers]     = useState<Record<number, string>>({})
  const [revealed, setRevealed]   = useState<Set<number>>(new Set())

  const run = async () => {
    setLoading(true)
    setError("")
    setAnswers({})
    setRevealed(new Set())
    try {
      const r = await fetchDeckQuiz(docId, count)
      setQuestions(r.questions)
    } catch {
      setError("Failed to generate quiz")
    } finally {
      setLoading(false)
    }
  }

  const reveal = (i: number) => setRevealed((s) => new Set([...s, i]))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Quiz</h2>
            <p className="text-white/40 text-xs mt-0.5">AI-generated comprehension quiz from your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Questions:</span>
            {[3, 5, 7, 10].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${count === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >{n}</button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Writing quiz questions…</p>
            </div>
          )}

          {questions !== null && !loading && (
            <div className="space-y-4">
              {questions.map((q, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-2">
                  <p className="text-white/80 text-sm font-medium">{i + 1}. {q.question}</p>
                  <div className="space-y-1">
                    {q.options.map((opt, j) => {
                      const letter = opt.charAt(0)
                      const isAnswer = letter === q.answer
                      const isSelected = answers[i] === letter
                      const showResult = revealed.has(i)
                      return (
                        <button
                          key={j}
                          onClick={() => !revealed.has(i) && setAnswers((a) => ({ ...a, [i]: letter }))}
                          className={`w-full text-left text-xs px-3 py-1.5 rounded border transition-colors ${
                            showResult && isAnswer ? "bg-green-400/15 border-green-400/30 text-green-400" :
                            showResult && isSelected && !isAnswer ? "bg-red-400/15 border-red-400/30 text-red-400" :
                            isSelected ? "bg-accent/15 border-accent/30 text-accent" :
                            "bg-white/3 border-white/8 text-white/55 hover:bg-white/6"
                          }`}
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {!revealed.has(i) ? (
                      <button
                        onClick={() => reveal(i)}
                        className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                      >
                        Reveal answer
                      </button>
                    ) : (
                      <p className="text-white/40 text-[10px] italic">{q.explanation}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {questions === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Generate Quiz" to create a quiz from your deck content.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Writing…" : "Generate Quiz"}
          </button>
        </div>
      </div>
    </div>
  )
}
