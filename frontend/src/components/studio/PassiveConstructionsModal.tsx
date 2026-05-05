import { useState, useEffect } from "react"
import { fetchPassiveConstructions } from "../../lib/studioApi"
import type { PassiveConstructionEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PassiveConstructionsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ flagged: PassiveConstructionEntry[]; total_flagged: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchPassiveConstructions(docId)
      .then(setData)
      .catch(() => setError("Failed to detect passive constructions"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Passive Voice Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags passive constructions that weaken your messaging</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for passive voice…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="text-xs text-white/40">
                {data.total_flagged === 0
                  ? <span className="text-green-400">No passive constructions found.</span>
                  : <span><span className="text-yellow-400">{data.total_flagged}</span> passive construction{data.total_flagged !== 1 ? "s" : ""} found</span>
                }
              </div>

              <div className="space-y-2">
                {data.flagged.map((f, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(f.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">
                        Slide {f.slide_n}
                      </button>
                      <div className="flex gap-1 flex-wrap">
                        {f.matches.map((m, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-400/20 bg-yellow-400/8 text-yellow-400/80">{m}</span>
                        ))}
                      </div>
                    </div>
                    <p className="text-white/60 text-xs leading-relaxed line-clamp-2">{f.text}</p>
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
