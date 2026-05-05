import { useState, useEffect } from "react"
import { fetchFontVarietyAudit } from "../../lib/studioApi"
import type { FontVarietyResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function FontVarietyAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FontVarietyResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "flagged">("all")

  useEffect(() => {
    setLoading(true)
    fetchFontVarietyAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit font variety"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data
    ? (filter === "flagged" ? data.per_slide.filter(s => s.flagged) : data.per_slide.filter(s => s.font_count > 0))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Font Variety Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags slides with more than 3 distinct fonts</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing fonts…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>Unique fonts: <span className="text-white/70">{data.total_unique}</span></span>
                  <span>Flagged: <span className="text-yellow-400">{data.flagged_slides.length} slides</span></span>
                </div>
                <div className="flex gap-1">
                  {(["all", "flagged"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {data.total_unique > 0 && (
                <div className="flex flex-wrap gap-1">
                  {data.unique_fonts.map((f, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/50">{f}</span>
                  ))}
                </div>
              )}

              {slides.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">
                  {filter === "flagged" ? "No slides exceed 3 fonts." : "No text found in this deck."}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {slides.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 flex flex-wrap gap-1">
                        {s.fonts.map((f, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">{f}</span>
                        ))}
                      </div>
                      <span className={`text-[10px] shrink-0 ${s.flagged ? "text-yellow-400" : "text-white/30"}`}>{s.font_count} font{s.font_count !== 1 ? "s" : ""}</span>
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
