import { useState, useEffect } from "react"
import { fetchDataTableCandidates } from "../../lib/studioApi"
import type { DataTableCandidate } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function DataTableModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ candidates: DataTableCandidate[]; total: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchDataTableCandidates(docId)
      .then(setData)
      .catch(() => setError("Failed to detect table candidates"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Data Table Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Text that looks like tabular data — should be a table</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning for tabular data…</span>
            </div>
          ) : data && (
            data.total === 0 ? (
              <div className="text-white/40 text-xs bg-white/5 border border-white/8 rounded-lg px-3 py-3 text-center">
                No text elements look like tabular data.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/70 text-xs">
                  {data.total} element{data.total !== 1 ? "s" : ""} might work better as tables
                </div>
                <div className="space-y-3">
                  {data.candidates.map((c, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { onJumpToSlide(c.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors"
                        >
                          Slide {c.slide_n}
                        </button>
                        <span className="text-white/25 text-xs ml-auto">{c.lines} lines · {c.delimiter} delimiter</span>
                      </div>
                      <pre className="text-white/40 text-xs font-mono bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap">{c.preview}</pre>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
