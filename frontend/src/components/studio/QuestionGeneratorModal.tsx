import { useState } from "react"
import { generateSlideQuestions } from "../../lib/studioApi"
import type { QuizQuestion } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  slideCount: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TYPES = [
  { id: "discussion",    label: "Discussion",    icon: "💬", desc: "Open-ended, reflective" },
  { id: "quiz",          label: "Quiz",          icon: "✓",  desc: "Multiple choice with answers" },
  { id: "comprehension", label: "Comprehension", icon: "📖", desc: "Test understanding" },
  { id: "critical",      label: "Critical",      icon: "🔍", desc: "Challenge assumptions" },
]

function isQuizQ(q: string | QuizQuestion): q is QuizQuestion {
  return typeof q === "object" && q !== null && "options" in q
}

export default function QuestionGeneratorModal({ docId, slideN, slideCount, onClose, onJumpToSlide }: Props) {
  const [slide, setSlide]         = useState(slideN)
  const [type, setType]           = useState<"discussion" | "quiz" | "comprehension" | "critical">("discussion")
  const [count, setCount]         = useState(5)
  const [loading, setLoading]     = useState(false)
  const [questions, setQuestions] = useState<(string | QuizQuestion)[] | null>(null)
  const [error, setError]         = useState("")
  const [revealed, setRevealed]   = useState<Set<number>>(new Set())
  const [copied, setCopied]       = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setError("")
    setQuestions(null)
    setRevealed(new Set())
    try {
      const r = await generateSlideQuestions(docId, slide, type, count)
      setQuestions(r.questions)
    } catch {
      setError("Failed to generate questions")
    } finally {
      setLoading(false)
    }
  }

  const toggleReveal = (i: number) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const copyAll = () => {
    if (!questions) return
    const text = questions.map((q, i) => {
      if (isQuizQ(q)) {
        return `${i + 1}. ${q.question}\n   A) ${q.options?.A}\n   B) ${q.options?.B}\n   C) ${q.options?.C}\n   D) ${q.options?.D}\n   Answer: ${q.answer}`
      }
      return `${i + 1}. ${q}`
    }).join("\n\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Question Generator</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate discussion or quiz questions from slide content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!questions && (
            <>
              {/* slide picker */}
              <div className="flex items-center gap-3">
                <label className="text-white/40 text-xs shrink-0">Slide:</label>
                <select
                  value={slide}
                  onChange={(e) => setSlide(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/15 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-accent/50"
                >
                  {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>Slide {n}</option>
                  ))}
                </select>
                <button
                  onClick={() => { onJumpToSlide(slide) }}
                  className="text-xs text-white/40 hover:text-white/70 px-2 py-1.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                >
                  ↗ View
                </button>
              </div>

              {/* question type */}
              <div>
                <p className="text-white/40 text-xs mb-2">Question type</p>
                <div className="grid grid-cols-2 gap-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id as typeof type)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${type === t.id ? "border-accent/50 bg-accent/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/8"}`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.icon}</span>
                        <span className="font-medium text-[13px]">{t.label}</span>
                      </div>
                      <div className="text-[11px] text-white/40 mt-0.5 ml-6">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* count */}
              <div className="flex items-center gap-3">
                <span className="text-white/40 text-xs">Number of questions:</span>
                <input
                  type="number" min={1} max={10} value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                  className="w-14 text-center bg-white/5 border border-white/15 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-accent/50"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Generating questions…
                  </span>
                ) : "Generate Questions"}
              </button>
            </>
          )}

          {questions !== null && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-white/40 text-xs flex-1">{questions.length} question{questions.length !== 1 ? "s" : ""} · Slide {slide}</span>
                <button
                  onClick={copyAll}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/50 hover:text-white hover:bg-white/8 transition-colors"
                >
                  {copied ? "✓ Copied" : "Copy all"}
                </button>
                <button
                  onClick={() => { setQuestions(null); setRevealed(new Set()) }}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors"
                >
                  Regenerate
                </button>
              </div>

              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                    {isQuizQ(q) ? (
                      <div>
                        <p className="text-white text-sm font-medium">{i + 1}. {q.question}</p>
                        {q.options && (
                          <div className="mt-2 space-y-1">
                            {(["A", "B", "C", "D"] as const).map((opt) => (
                              <div
                                key={opt}
                                className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 ${revealed.has(i) && q.answer === opt ? "bg-green-400/15 border border-green-400/25 text-green-300" : "text-white/60"}`}
                              >
                                <span className="font-mono w-4 shrink-0">{opt})</span>
                                <span>{q.options?.[opt]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {q.answer && (
                          <button
                            onClick={() => toggleReveal(i)}
                            className="mt-2 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                          >
                            {revealed.has(i) ? "Hide answer" : "Show answer"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-white/80 text-sm">{i + 1}. {q as string}</p>
                    )}
                  </div>
                ))}
              </div>
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
