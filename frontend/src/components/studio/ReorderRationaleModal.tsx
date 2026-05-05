import { useState } from "react"
import { fetchReorderRationale } from "../../lib/studioApi"
import type { ReorderRationaleSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ReorderRationaleModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<ReorderRationaleSlide[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchReorderRationale(docId)
      setData(r.slides)
    } catch {
      setError("Failed to analyze slide order")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Order Rationale</h2>
            <p className="text-white/40 text-xs mt-0.5">AI explains each slide's position and suggests improvements</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing slide order…</p>
            </div>
          )}

          {data !== null && !loading && (
            data.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">No analysis available.</div>
            ) : (
              <div className="space-y-2">
                {data.map((s) => (
                  <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 space-y-1.5">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-accent/70 text-xs font-medium hover:text-accent transition-colors"
                    >
                      Slide {s.slide_n}
                    </button>
                    <p className="text-white/55 text-xs leading-relaxed">{s.rationale}</p>
                    {s.suggestion && (
                      <p className="text-yellow-400/60 text-xs leading-relaxed border-t border-white/5 pt-1.5">
                        ↳ {s.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Analyze Order" to get AI feedback on your slide sequence.
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
            {loading ? "Analyzing…" : "Analyze Order"}
          </button>
        </div>
      </div>
    </div>
  )
}
