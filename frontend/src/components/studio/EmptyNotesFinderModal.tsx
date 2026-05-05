import { useState, useEffect } from "react"
import { fetchEmptyNotesFinder } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function EmptyNotesFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ no_notes: number[]; has_notes: number[]; total: number; coverage_pct: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchEmptyNotesFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find empty notes"))
      .finally(() => setLoading(false))
  }, [docId])

  const coverageColor = (pct: number) =>
    pct >= 80 ? "text-green-400" : pct >= 50 ? "text-yellow-400" : "text-red-400"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Empty Notes Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Slides missing speaker notes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking speaker notes…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 flex items-center gap-6">
                <div className="text-center">
                  <p className={`text-2xl font-bold ${coverageColor(data.coverage_pct)}`}>{data.coverage_pct}%</p>
                  <p className="text-xs text-white/40">Notes Coverage</p>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-xs text-white/40">
                    <span>With notes</span>
                    <span className="text-green-400">{data.has_notes.length}</span>
                  </div>
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Missing notes</span>
                    <span className="text-red-400">{data.no_notes.length}</span>
                  </div>
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Total slides</span>
                    <span>{data.total}</span>
                  </div>
                </div>
              </div>

              {data.no_notes.length > 0 && (
                <div>
                  <p className="text-xs text-red-400/70 mb-2">Slides without notes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.no_notes.map(n => (
                      <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                        className="text-xs px-2 py-1 rounded border border-red-400/20 bg-red-400/8 text-red-400/70 hover:text-red-400 transition-colors">
                        Slide {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {data.no_notes.length === 0 && (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  All slides have speaker notes!
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
