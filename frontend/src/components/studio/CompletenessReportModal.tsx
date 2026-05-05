import { useState, useEffect } from "react"
import { fetchCompletenessReport } from "../../lib/studioApi"
import type { CompletenessDimension } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const scoreColor = (s: number) => s >= 80 ? "text-green-400" : s >= 50 ? "text-yellow-400" : "text-red-400"
const barColor   = (s: number) => s >= 80 ? "bg-green-400/50" : s >= 50 ? "bg-yellow-400/50" : "bg-red-400/50"

export default function CompletenessReportModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    overall: number
    label: string
    dimensions: CompletenessDimension[]
  } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchCompletenessReport(docId))
    } catch {
      setError("Failed to generate completeness report")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Completeness Report</h2>
            <p className="text-white/40 text-xs mt-0.5">How production-ready is your deck?</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Generating report…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-xl px-4 py-3">
                <span className={`text-4xl font-bold ${scoreColor(data.overall)}`}>{data.overall}%</span>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Overall Score</p>
                  <p className={`text-sm font-medium ${scoreColor(data.overall)}`}>{data.label}</p>
                </div>
              </div>

              <div className="space-y-3">
                {data.dimensions.map((dim) => (
                  <div key={dim.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-white/60 text-xs">{dim.name}</span>
                      <span className={`text-xs font-medium ${scoreColor(dim.score)}`}>{dim.score}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(dim.score)}`} style={{ width: `${dim.score}%` }} />
                    </div>
                    <p className="text-white/25 text-[10px]">{dim.detail}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Re-generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
