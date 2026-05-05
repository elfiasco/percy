import { useState, useEffect } from "react"
import { fetchTextAlignmentAudit } from "../../lib/studioApi"
import type { AlignmentSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const alignColor = (a: string) => ({
  left:     "text-blue-400 border-blue-400/20 bg-blue-400/8",
  center:   "text-accent border-accent/20 bg-accent/8",
  right:    "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  justify:  "text-green-400 border-green-400/20 bg-green-400/8",
  default:  "text-white/40 border-white/10 bg-white/5",
  distribute: "text-paper border-paper/20 bg-paper/8",
})[a] ?? "text-white/40 border-white/10 bg-white/5"

export default function TextAlignmentAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ global_tally: Record<string, number>; per_slide: AlignmentSlide[] } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchTextAlignmentAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit text alignment"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Alignment Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Maps paragraph alignment across all text shapes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing alignment…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.global_tally).map(([align, count]) => (
                  <span key={align} className={`text-xs px-2 py-1 rounded border capitalize ${alignColor(align)}`}>
                    {align}: {count}
                  </span>
                ))}
              </div>

              <div className="space-y-1.5">
                {data.per_slide.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2 hover:bg-white/5 transition-colors text-left">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${alignColor(s.dominant)}`}>{s.dominant}</span>
                    <div className="flex gap-2 text-[10px] text-white/30 ml-auto">
                      {s.left   ? <span>L:{s.left}</span>   : null}
                      {s.center ? <span>C:{s.center}</span> : null}
                      {s.right  ? <span>R:{s.right}</span>  : null}
                    </div>
                  </button>
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
