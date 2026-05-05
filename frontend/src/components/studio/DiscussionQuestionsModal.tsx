import { useState } from "react"
import { fetchDiscussionQuestions } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DiscussionQuestionsModal({ docId, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [count, setCount]       = useState(5)
  const [questions, setQuestions] = useState<string[] | null>(null)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchDiscussionQuestions(docId, count)
      setQuestions(res.questions)
    } catch {
      setError("Failed to generate discussion questions")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!questions) return
    navigator.clipboard.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Discussion Questions</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates open-ended questions for group discussion</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Questions:</span>
            {[3, 5, 7, 10].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${count === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                {n}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating questions…</p>
            </div>
          )}

          {questions !== null && !loading && (
            <>
              <ol className="space-y-2">
                {questions.map((q, i) => (
                  <li key={i} className="flex gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <span className="text-accent/40 text-xs shrink-0 w-4 text-right">{i + 1}.</span>
                    <p className="text-white/65 text-xs leading-relaxed">{q}</p>
                  </li>
                ))}
              </ol>
              <button onClick={copy}
                className="text-xs text-white/30 hover:text-white/60 border border-white/10 hover:border-white/20 rounded px-3 py-1 transition-colors">
                {copied ? "Copied!" : "Copy all questions"}
              </button>
            </>
          )}

          {questions === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to create discussion questions.</div>
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
