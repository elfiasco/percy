import { useState, useEffect } from "react"
import { fetchHeadingHierarchyCheck } from "../../lib/studioApi"
import type { HeadingIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function HeadingHierarchyCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ issues: HeadingIssue[]; avg_heading_pt: number; consistent: boolean } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchHeadingHierarchyCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check heading hierarchy"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxDelta = data ? Math.max(...data.issues.map(i => Math.abs(i.delta)), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Heading Hierarchy Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects inconsistent font size hierarchy across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking heading hierarchy…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Avg heading: <span className="text-white/70">{data.avg_heading_pt}pt</span></span>
                <span className={data.consistent ? "text-green-400" : "text-yellow-400"}>
                  {data.consistent ? "Consistent" : `${data.issues.length} issue${data.issues.length !== 1 ? "s" : ""}`}
                </span>
              </div>

              {data.issues.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">Heading sizes are consistent throughout.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.issues.map((issue, i) => (
                    <button key={i} onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                      <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {issue.slide_n}</span>
                      <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className={`h-full rounded-sm ${issue.delta > 0 ? "bg-blue-400/40" : "bg-yellow-400/40"}`}
                          style={{ width: `${(Math.abs(issue.delta) / maxDelta) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/50 w-14 text-right shrink-0">{issue.max_font_pt}pt</span>
                      <span className={`text-[10px] shrink-0 ${issue.delta > 0 ? "text-blue-400/70" : "text-yellow-400/70"}`}>
                        {issue.delta > 0 ? "+" : ""}{issue.delta}pt
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
