import { useState, useEffect } from "react"
import { fetchColorReport } from "../../lib/studioApi"
import type { ColorUsage } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function ColorReportModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ colors: ColorUsage[]; unique_count: number; total_uses: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchColorReport(docId))
    } catch {
      setError("Failed to generate color report")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxCount = data ? Math.max(...data.colors.map(c => c.count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Color Report</h2>
            <p className="text-white/40 text-xs mt-0.5">All colors used across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing colors…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>{data.unique_count} unique color{data.unique_count !== 1 ? "s" : ""}</span>
                <span>{data.total_uses} total uses</span>
              </div>

              {data.colors.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No explicit colors detected.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded shrink-0 border border-white/10" style={{ backgroundColor: c.hex }} />
                      <span className="text-white/50 text-xs font-mono w-16 shrink-0">{c.hex}</span>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-white/20 rounded-full" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-white/30 text-xs w-6 text-right shrink-0">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
