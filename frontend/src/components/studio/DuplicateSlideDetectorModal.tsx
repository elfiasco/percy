import { useState, useEffect } from "react"
import { fetchDuplicateSlideDetector } from "../../lib/studioApi"
import type { DuplicateGroup } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function DuplicateSlideDetectorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ groups: DuplicateGroup[]; total_duplicate_groups: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchDuplicateSlideDetector(docId)
      .then(setData)
      .catch(() => setError("Failed to detect duplicates"))
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
            <h2 className="text-white font-semibold text-sm">Duplicate Slide Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Identifies slides with very similar text content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Detecting duplicate slides…</p>
            </div>
          )}

          {data && !loading && (
            data.total_duplicate_groups === 0 ? (
              <div className="text-green-400 text-xs text-center py-8">No duplicate or near-duplicate slides detected.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-white/40">{data.total_duplicate_groups} duplicate group{data.total_duplicate_groups !== 1 ? "s" : ""} found</div>
                {data.groups.map((g, i) => (
                  <div key={i} className="bg-white/3 border border-orange-400/15 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-orange-400/70 font-semibold">Group {i + 1}</span>
                      <span className="text-[10px] text-white/30">{g.similarity} similarity</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.slides.map(n => (
                        <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                          className="text-[10px] px-2 py-0.5 rounded border border-accent/20 bg-accent/8 text-accent/70 hover:text-accent transition-colors">
                          Slide {n}
                        </button>
                      ))}
                    </div>
                  </div>
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
