import { useState, useEffect } from "react"
import { fetchSlideFontSizeAudit } from "../../lib/studioApi"
import type { FontSizeAuditResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideFontSizeAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FontSizeAuditResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "flagged">("flagged")

  useEffect(() => {
    setLoading(true)
    fetchSlideFontSizeAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit font sizes"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data
    ? (filter === "flagged" ? data.per_slide.filter(s => s.too_small || s.too_varied) : data.per_slide)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Font Size Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Min/max font sizes per slide — flags tiny text and excessive variation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing font sizes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">
                  Flagged: <span className={data.flagged_count > 0 ? "text-yellow-400" : "text-green-400"}>{data.flagged_count} slides</span>
                </span>
                <div className="flex gap-1">
                  {(["flagged", "all"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {slides.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">Font sizes look good across all slides.</div>
              ) : (
                <div className="space-y-1">
                  {slides.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 flex gap-2 text-[10px] text-white/40">
                        {s.min_pt != null && <span>min {s.min_pt}pt</span>}
                        {s.max_pt != null && <span>max {s.max_pt}pt</span>}
                        <span>{s.unique_sizes.length} sizes</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {s.too_small && <span className="text-[9px] text-red-400/70 bg-red-400/8 border border-red-400/20 px-1 rounded">tiny</span>}
                        {s.too_varied && <span className="text-[9px] text-yellow-400/70 bg-yellow-400/8 border border-yellow-400/20 px-1 rounded">varied</span>}
                      </div>
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
