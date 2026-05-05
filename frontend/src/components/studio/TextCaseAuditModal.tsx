import { useState, useEffect } from "react"
import { fetchTextCaseAudit } from "../../lib/studioApi"
import type { TextCaseAuditResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const caseColor: Record<string, string> = {
  ALL_CAPS:   "text-red-400 border-red-400/20 bg-red-400/8",
  Title_Case: "text-blue-400 border-blue-400/20 bg-blue-400/8",
  lowercase:  "text-green-400 border-green-400/20 bg-green-400/8",
  Mixed:      "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  none:       "text-white/30 border-white/10 bg-white/5",
}

export default function TextCaseAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TextCaseAuditResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "inconsistent">("inconsistent")

  useEffect(() => {
    setLoading(true)
    fetchTextCaseAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit text case"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data
    ? (filter === "inconsistent" ? data.per_slide.filter(s => s.inconsistent) : data.per_slide)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Case Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Detects inconsistent casing across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing text case…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>Inconsistent: <span className={data.total_inconsistent > 0 ? "text-yellow-400" : "text-green-400"}>{data.total_inconsistent} slides</span></span>
                </div>
                <div className="flex gap-1">
                  {(["inconsistent", "all"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {slides.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">
                  {filter === "inconsistent" ? "Text casing is consistent throughout." : "No slides found."}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {slides.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 flex gap-1.5 flex-wrap">
                        {Object.entries(s.cases).map(([c, n]) => (
                          <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border ${caseColor[c] ?? "text-white/40 border-white/10 bg-white/5"}`}>
                            {c.replace("_", " ")} ×{n}
                          </span>
                        ))}
                      </div>
                      {s.inconsistent && <span className="text-[10px] text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/8 px-1 rounded shrink-0">mixed</span>}
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
