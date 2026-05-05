import { useState, useEffect } from "react"
import { fetchReadingOrder } from "../../lib/studioApi"
import type { ReadingOrderViolation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ReadingOrderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ violations: ReadingOrderViolation[]; total_slides_affected: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchReadingOrder(docId)
      .then(setData)
      .catch(() => setError("Failed to check reading order"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Reading Order Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Elements out of natural top-left → bottom-right order</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Checking reading order…</span>
            </div>
          ) : data && (
            data.violations.length === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                All slides have a natural reading order — no issues found.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/70 text-xs">
                  {data.total_slides_affected} slide{data.total_slides_affected !== 1 ? "s" : ""} with reading order issues
                </div>
                <div className="space-y-2">
                  {data.violations.map((v) => (
                    <div key={v.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <button
                          onClick={() => { onJumpToSlide(v.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors font-medium"
                        >
                          Slide {v.slide_n}
                        </button>
                        <span className="text-white/25 text-xs ml-auto">{v.count} element{v.count !== 1 ? "s" : ""} out of order</span>
                      </div>
                      <div className="px-3 py-2 space-y-1">
                        {v.out_of_order.map((el, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-white/45 truncate flex-1">{el.label}</span>
                            <span className="text-white/20 font-mono text-[10px] shrink-0">({el.left}", {el.top}")</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
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
