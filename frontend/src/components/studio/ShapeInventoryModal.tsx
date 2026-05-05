import { useState, useEffect } from "react"
import { fetchShapeInventory } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ShapeInventoryModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ tally: Record<string, number>; total_shapes: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchShapeInventory(docId)
      .then(d => setData({ tally: d.tally, total_shapes: d.total_shapes }))
      .catch(() => setError("Failed to inventory shapes"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Shape Inventory</h2>
            <p className="text-white/40 text-xs mt-0.5">Count and category breakdown of all shapes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Counting shapes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <p className="text-xs text-white/40">Total shapes: <span className="text-white/70">{data.total_shapes}</span></p>
              <div className="space-y-1.5">
                {Object.entries(data.tally)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => {
                    const pct = data.total_shapes > 0 ? count / data.total_shapes * 100 : 0
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <span className="text-xs text-white/50 w-28 shrink-0 capitalize">{name.replace(/_/g, " ")}</span>
                        <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                          <div className="h-full bg-accent/40 rounded-sm" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-white/50 w-8 text-right shrink-0">{count}</span>
                      </div>
                    )
                  })}
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
