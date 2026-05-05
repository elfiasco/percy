import { useState } from "react"
import { fetchPullQuotes } from "../../lib/studioApi"
import type { PullQuote } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PullQuoteModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]     = useState(false)
  const [quotes, setQuotes]       = useState<PullQuote[] | null>(null)
  const [error, setError]         = useState("")
  const [copied, setCopied]       = useState<number | null>(null)

  const scan = async () => {
    setLoading(true)
    setError("")
    setQuotes(null)
    try {
      const r = await fetchPullQuotes(docId)
      setQuotes(r.quotes)
    } catch {
      setError("Failed to extract pull quotes")
    } finally {
      setLoading(false)
    }
  }

  const copyQuote = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(idx)
    setTimeout(() => setCopied(null), 2000)
  }

  const hasQuotes = quotes?.some((q) => q.quote)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Pull Quote Highlighter</h2>
            <p className="text-white/40 text-xs mt-0.5">AI finds the most impactful line from each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting pull quotes… (one AI call per slide)</p>
            </div>
          )}

          {quotes !== null && !loading && (
            hasQuotes ? (
              <div className="space-y-3">
                {quotes.filter((q) => q.quote).map((q, i) => (
                  <div key={q.slide_n} className="rounded-lg border border-white/10 px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <button
                        onClick={() => { onJumpToSlide(q.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors"
                      >
                        Slide {q.slide_n} ↗
                      </button>
                      <button
                        onClick={() => copyQuote(q.quote!, i)}
                        className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                      >
                        {copied === i ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                    <blockquote className="border-l-2 border-accent/40 pl-3">
                      <p className="text-white/80 text-sm leading-relaxed italic">"{q.quote}"</p>
                    </blockquote>
                    {q.reason && (
                      <p className="text-white/30 text-[10px] mt-2">{q.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-white/30">
                <p className="text-sm">No quotable content found in this deck.</p>
              </div>
            )
          )}

          {quotes === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Extract Quotes" to find the best lines in your deck.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={scan}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Extracting…" : "Extract Quotes"}
          </button>
        </div>
      </div>
    </div>
  )
}
