import { useState, useEffect } from "react"
import { fetchColorContrastAudit } from "../../lib/studioApi"
import type { ContrastSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ColorContrastAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ per_slide: ContrastSlide[]; flagged_slides: number[]; flagged_count: number } | null>(null)
  const [error, setError] = useState("")
  const [showOnly, setShowOnly] = useState<"all" | "flagged">("flagged")

  useEffect(() => {
    setLoading(true)
    fetchColorContrastAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze color contrast"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (showOnly === "flagged" ? data.per_slide.filter(s => s.low_contrast_runs > 0) : data.per_slide)
    : []

  const maxRuns = data ? Math.max(...data.per_slide.map(s => s.low_contrast_runs), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Color Contrast Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags text with low contrast against its background</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing contrast…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Flagged slides: <span className="text-red-400">{data.flagged_count}</span></span>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setShowOnly("flagged")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${showOnly === "flagged" ? "bg-red-400/15 border-red-400/30 text-red-400" : "bg-white/5 border-white/10 text-white/40"}`}>Flagged</button>
                  <button onClick={() => setShowOnly("all")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${showOnly === "all" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>All</button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">
                  {showOnly === "flagged" ? "No contrast issues detected." : "No slides."}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                      <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                      <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-red-500/50 rounded-sm"
                          style={{ width: `${(s.low_contrast_runs / maxRuns) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/40 w-20 text-right shrink-0">
                        {s.low_contrast_runs} issue{s.low_contrast_runs !== 1 ? "s" : ""}
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
