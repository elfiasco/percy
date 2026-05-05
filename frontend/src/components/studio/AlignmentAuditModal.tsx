import { useState, useEffect } from "react"
import { fetchAlignmentAudit } from "../../lib/studioApi"
import type { AlignmentSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function AlignmentAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ dominant_alignment: string; inconsistent_slides: AlignmentSlide[]; total_inconsistent: number; alignment_counts: Record<string, number>; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchAlignmentAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit alignment"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Alignment Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect inconsistent text alignment across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Auditing alignment…</span>
            </div>
          ) : data && (
            <>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-white/40">Dominant alignment:</span>
                <span className="text-white/70 font-medium capitalize">{data.dominant_alignment}</span>
              </div>

              {data.total_inconsistent === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  All slides use consistent text alignment.
                </div>
              ) : (
                <>
                  <div className="text-yellow-400/70 text-xs">
                    {data.total_inconsistent} slide{data.total_inconsistent !== 1 ? "s" : ""} with inconsistent alignment
                  </div>
                  <div className="space-y-1.5">
                    {data.inconsistent_slides.map((s) => (
                      <div key={s.slide_n} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded px-3 py-2">
                        <button
                          onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors shrink-0"
                        >
                          Slide {s.slide_n}
                        </button>
                        <div className="flex gap-1 flex-wrap flex-1">
                          {s.alignments.map((a, i) => (
                            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${a === data.dominant_alignment ? "bg-white/5 border-white/15 text-white/50" : "bg-yellow-400/10 border-yellow-400/20 text-yellow-400/70"}`}>
                              {a}
                            </span>
                          ))}
                        </div>
                        {s.mixed && <span className="text-yellow-400/50 text-[10px] shrink-0">mixed</span>}
                      </div>
                    ))}
                  </div>
                </>
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
