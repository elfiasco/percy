import { useState, useEffect } from "react"
import { fetchShapeZOrderAudit } from "../../lib/studioApi"
import type { ZOrderSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ShapeZOrderAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides: ZOrderSlide[]; flagged_slides: number[]; flagged_count: number } | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "flagged">("flagged")

  useEffect(() => {
    setLoading(true)
    fetchShapeZOrderAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit shape z-order"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (filter === "flagged" ? data.slides.filter(s => s.overlap_pairs > 3) : data.slides)
    : []

  const maxOverlap = data ? Math.max(...data.slides.map(s => s.overlap_pairs), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Shape Z-Order Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects slides with many overlapping shapes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing shape layers…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Flagged slides: <span className="text-yellow-400">{data.flagged_count}</span></span>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setFilter("flagged")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${filter === "flagged" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400" : "bg-white/5 border-white/10 text-white/40"}`}>Flagged</button>
                  <button onClick={() => setFilter("all")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${filter === "all" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>All</button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">
                  {filter === "flagged" ? "No heavily overlapping slides found." : "No slides."}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                      <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                      <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className={`h-full rounded-sm ${s.overlap_pairs > 3 ? "bg-yellow-400/40" : "bg-accent/30"}`}
                          style={{ width: `${(s.overlap_pairs / maxOverlap) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/40 w-20 text-right shrink-0">{s.overlap_pairs} overlaps</span>
                      <span className="text-[10px] text-white/30 w-16 text-right shrink-0">{s.shape_count} shapes</span>
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
