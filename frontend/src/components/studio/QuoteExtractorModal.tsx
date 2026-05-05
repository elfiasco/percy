import { useState, useEffect } from "react"
import { fetchQuoteExtractor } from "../../lib/studioApi"
import type { QuoteEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function QuoteExtractorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ quotes: QuoteEntry[]; total: number } | null>(null)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState<number | null>(null)
  const [filter, setFilter]     = useState<"all" | "attributed" | "unattributed">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchQuoteExtractor(docId))
    } catch {
      setError("Failed to extract quotes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 1500)
  }

  const quotes = data ? (
    filter === "attributed"   ? data.quotes.filter(q => q.attributed) :
    filter === "unattributed" ? data.quotes.filter(q => !q.attributed) :
    data.quotes
  ) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Quote Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">Find all quoted text across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Extracting quotes…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">{data.total} quote{data.total !== 1 ? "s" : ""} found</span>
                <div className="flex items-center gap-2">
                  {(["all", "attributed", "unattributed"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {quotes.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No quotes match this filter.</div>
              ) : (
                <div className="space-y-2">
                  {quotes.map((q, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(q.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">
                          Slide {q.slide_n}
                        </button>
                        <div className="flex items-center gap-2">
                          {q.attributed
                            ? <span className="text-[10px] text-green-400/60 bg-green-400/8 border border-green-400/20 px-1.5 py-0.5 rounded">attributed</span>
                            : <span className="text-[10px] text-yellow-400/60 bg-yellow-400/8 border border-yellow-400/20 px-1.5 py-0.5 rounded">unattributed</span>
                          }
                          <button onClick={() => copy(q.text, i)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/30 hover:text-white/60 transition-colors">
                            {copied === i ? "✓" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <p className="text-white/65 text-xs leading-relaxed italic">{q.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Extracting…" : "Re-extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
