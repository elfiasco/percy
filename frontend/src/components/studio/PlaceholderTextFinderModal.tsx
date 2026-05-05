import { useState, useEffect } from "react"
import { fetchPlaceholderTextFinder } from "../../lib/studioApi"
import type { PlaceholderHit } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PlaceholderTextFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ hits: PlaceholderHit[]; total: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchPlaceholderTextFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to scan for placeholder text"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Placeholder Text Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects lorem ipsum, TBD, and unfilled template text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for placeholder text…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="text-xs text-white/40 mb-1">
                {data.total === 0
                  ? <span className="text-green-400">No placeholder text found.</span>
                  : <span>Found <span className="text-red-400">{data.total}</span> occurrence{data.total !== 1 ? "s" : ""}</span>
                }
              </div>
              <div className="space-y-1.5">
                {data.hits.map((h, i) => (
                  <button key={i} onClick={() => { onJumpToSlide(h.slide_n); onClose() }}
                    className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {h.slide_n}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60 truncate">{h.text}</p>
                      <p className="text-[10px] text-red-400/60 mt-0.5">pattern: {h.pattern}</p>
                    </div>
                  </button>
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
