import { useState } from "react"
import { fetchSlideTransitionSuggester } from "../../lib/studioApi"
import type { TransitionSuggesterResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTransitionSuggesterModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TransitionSuggesterResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideTransitionSuggester(docId)
      setData(res)
    } catch {
      setError("Failed to generate transition suggestions")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Transition Suggester</h2>
            <p className="text-white/40 text-xs mt-0.5">AI recommends transition styles between consecutive slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing slide flow…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-2">
              {data.transitions.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No transitions generated.</div>
              ) : data.transitions.map((t, i) => (
                <button key={i}
                  onClick={() => { onJumpToSlide(t.from_slide); onClose() }}
                  className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                  <span className="text-[10px] text-white/30 shrink-0 w-20 pt-0.5">
                    {t.from_slide} → {t.to_slide}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-accent/80 font-medium">{t.style}</p>
                    <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed">{t.rationale}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Suggest" to get transition recommendations.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Suggest"}
          </button>
        </div>
      </div>
    </div>
  )
}
