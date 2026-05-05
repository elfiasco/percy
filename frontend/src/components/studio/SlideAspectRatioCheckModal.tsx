import { useState, useEffect } from "react"
import { fetchSlideAspectRatioCheck } from "../../lib/studioApi"
import type { BoundsIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideAspectRatioCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ issues: BoundsIssue[]; flagged_slides: number[]; total_issues: number; slide_width_emu: number; slide_height_emu: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchSlideAspectRatioCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check bounds"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Shape Bounds Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects shapes extending beyond slide boundaries</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking shape bounds…</p>
            </div>
          )}

          {data && !loading && (
            data.total_issues === 0 ? (
              <div className="text-green-400 text-xs text-center py-8">All shapes are within slide boundaries.</div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-white/40">
                  {data.total_issues} shape{data.total_issues !== 1 ? "s" : ""} out of bounds on {data.flagged_slides.length} slide{data.flagged_slides.length !== 1 ? "s" : ""}
                </div>
                {data.issues.map((issue, i) => (
                  <button key={i} onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                    className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                    <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {issue.slide_n}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60 truncate">{issue.shape_name || "Unnamed shape"}</p>
                      <p className="text-[10px] text-yellow-400/60 mt-0.5">{issue.issue.replace("_", " ")}</p>
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
