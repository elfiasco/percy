import { useState } from "react"
import { fetchSlideMetaphorFinder } from "../../lib/studioApi"
import type { MetaphorResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const typeColor: Record<string, string> = {
  metaphor: "text-blue-400 border-blue-400/20 bg-blue-400/8",
  simile:   "text-paper border-paper/20 bg-paper/8",
  analogy:  "text-green-400 border-green-400/20 bg-green-400/8",
}

export default function SlideMetaphorFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<MetaphorResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideMetaphorFinder(docId)
      setData(res)
    } catch {
      setError("Failed to find metaphors")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Metaphor Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies metaphors, similes, and analogies across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Finding metaphors…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Found: <span className="text-white/70">{data.total}</span></span>
                <div className="flex gap-2">
                  {(["metaphor", "simile", "analogy"] as const).map(t => (
                    <span key={t} className={`text-[10px] px-2 py-0.5 rounded border capitalize ${typeColor[t]}`}>{t}</span>
                  ))}
                </div>
              </div>

              {data.strategy_summary && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.strategy_summary}</p>
                </div>
              )}

              {data.metaphors.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No metaphors or analogies found.</div>
              ) : (
                <div className="space-y-2">
                  {data.metaphors.map((m, i) => (
                    <button key={i} onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {m.slide_n}</span>
                      <div className="flex-1 space-y-1">
                        <p className="text-[11px] text-white/70 leading-snug">"{m.text}"</p>
                        <p className="text-[10px] text-white/30">{m.what_it_compares}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${typeColor[m.type] ?? "text-white/40 border-white/10 bg-white/5"}`}>{m.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to identify metaphors and analogies.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Finding…" : "Find"}
          </button>
        </div>
      </div>
    </div>
  )
}
