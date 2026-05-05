import { useState, useEffect } from "react"
import { fetchFontSizeDistribution } from "../../lib/studioApi"
import type { FontSizeBucket } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function FontSizeDistributionModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ distribution: FontSizeBucket[]; most_common_pt: number; unique_sizes: number; total_runs: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchFontSizeDistribution(docId)
      .then(setData)
      .catch(() => setError("Failed to load font size distribution"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxCount = data ? Math.max(...data.distribution.map(b => b.count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Font Size Distribution</h2>
            <p className="text-white/40 text-xs mt-0.5">Histogram of font sizes across all text runs</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing font sizes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Most common: <span className="text-white/70">{data.most_common_pt}pt</span></span>
                <span>Unique sizes: <span className="text-white/70">{data.unique_sizes}</span></span>
                <span>Total runs: <span className="text-white/70">{data.total_runs}</span></span>
              </div>

              <div className="space-y-1.5">
                {data.distribution.map((b) => (
                  <div key={b.pt} className="flex items-center gap-3">
                    <span className={`text-xs w-10 text-right shrink-0 ${b.pt === data.most_common_pt ? "text-accent font-bold" : "text-white/40"}`}>{b.pt}pt</span>
                    <div className="flex-1 h-4 bg-white/5 rounded-sm overflow-hidden">
                      <div
                        className={`h-full rounded-sm ${b.pt === data.most_common_pt ? "bg-accent/60" : "bg-white/20"}`}
                        style={{ width: `${(b.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-white/30 w-14 text-right shrink-0">{b.count} ({b.pct}%)</span>
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
