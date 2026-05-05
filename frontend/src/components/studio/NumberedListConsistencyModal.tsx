import { useState, useEffect } from "react"
import { fetchNumberedListConsistency } from "../../lib/studioApi"
import type { NumberedListIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function NumberedListConsistencyModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ issues: NumberedListIssue[]; total_issues: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchNumberedListConsistency(docId)
      .then(setData)
      .catch(() => setError("Failed to check numbered lists"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Numbered List Consistency</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags non-sequential or inconsistent numbered lists</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking numbered lists…</p>
            </div>
          )}

          {data && !loading && (
            data.total_issues === 0 ? (
              <div className="text-green-400 text-xs text-center py-8">All numbered lists are sequential.</div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-white/40">{data.total_issues} issue{data.total_issues !== 1 ? "s" : ""} found</div>
                {data.issues.map((issue, i) => (
                  <button key={i} onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                    className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {issue.slide_n}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60">{issue.issue}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">Sequence: [{issue.found.join(", ")}]</p>
                    </div>
                  </button>
                ))}
              </div>
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
