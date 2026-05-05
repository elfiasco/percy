import { useState } from "react"
import { compareDecks } from "../../lib/studioApi"
import type { DeckCompareResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DeckCompareModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [docIdB, setDocIdB]   = useState("")
  const [result, setResult]   = useState<DeckCompareResult | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    if (!docIdB.trim()) { setError("Please enter a second Deck ID."); return }
    setLoading(true)
    setError("")
    try {
      setResult(await compareDecks(docId, docIdB.trim()))
    } catch {
      setError("Failed to compare decks — check the second Deck ID.")
    } finally {
      setLoading(false)
    }
  }

  const pillColor = (score: number) =>
    score >= 60 ? "text-green-400 bg-green-400/10 border-green-400/20"
    : score >= 30 ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/20"
    : "text-white/50 bg-white/5 border-white/10"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Comparison</h2>
            <p className="text-white/40 text-xs mt-0.5">Compare keyword overlap and structure between two decks</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex gap-2">
            <input
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-accent/40"
              placeholder="Second deck ID (e.g. abc123)"
              value={docIdB}
              onChange={(e) => setDocIdB(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run() }}
            />
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Comparing decks…</p>
            </div>
          )}

          {result && !loading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {([["A", result.deck_a], ["B", result.deck_b]] as const).map(([label, deck]) => (
                  <div key={label} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Deck {label}</p>
                    <p className="text-white/80 text-xs font-medium truncate">{(deck as { name: string; slide_count: number }).name}</p>
                    <p className="text-white/35 text-[10px]">{(deck as { name: string; slide_count: number }).slide_count} slides</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-white/40 text-xs">Overlap score:</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${pillColor(result.overlap_score)}`}>
                  {result.overlap_score}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Unique to A</p>
                  <div className="flex flex-wrap gap-1">
                    {result.unique_to_a.map((w) => (
                      <span key={w} className="text-[10px] text-accent/60 bg-accent/8 px-1.5 py-0.5 rounded">{w}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Unique to B</p>
                  <div className="flex flex-wrap gap-1">
                    {result.unique_to_b.map((w) => (
                      <span key={w} className="text-[10px] text-yellow-400/60 bg-yellow-400/8 px-1.5 py-0.5 rounded">{w}</span>
                    ))}
                  </div>
                </div>
              </div>

              {result.shared_keywords.length > 0 && (
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Shared Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {result.shared_keywords.map((w) => (
                      <span key={w} className="text-[10px] text-green-400/60 bg-green-400/8 px-1.5 py-0.5 rounded">{w}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.shared_titles.length > 0 && (
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Shared Slide Titles</p>
                  <div className="space-y-1">
                    {result.shared_titles.map((t) => (
                      <p key={t} className="text-white/45 text-xs bg-white/3 border border-white/8 rounded px-2 py-1">{t}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!result && !loading && !error && (
            <div className="text-white/30 text-sm text-center py-8">Enter a second deck ID and click "Compare".</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Comparing…" : "Compare"}
          </button>
        </div>
      </div>
    </div>
  )
}
