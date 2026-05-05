import { useState, useEffect } from "react"
import { fetchRiskStatementFinder } from "../../lib/studioApi"
import type { RiskStatementResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function RiskStatementFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RiskStatementResult | null>(null)
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchRiskStatementFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find risk statements"))
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
            <h2 className="text-white font-semibold text-sm">Risk Statement Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Finds caveats, limitations, warnings, and risk language</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for risk language…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.per_slide.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-6">No risk or caveat language detected.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.total_statements} statement{data.total_statements !== 1 ? "s" : ""} across {data.per_slide.length} slide{data.per_slide.length !== 1 ? "s" : ""}</p>
                  <div className="space-y-1.5">
                    {data.per_slide.map(s => (
                      <div key={s.slide_n} className="border border-white/8 rounded-lg overflow-hidden">
                        <button onClick={() => setExpanded(expanded === s.slide_n ? null : s.slide_n)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left">
                          <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                          <span className="flex-1 text-[10px] text-yellow-400/70">{s.statements.length} statement{s.statements.length !== 1 ? "s" : ""}</span>
                          <button onClick={(e) => { e.stopPropagation(); onJumpToSlide(s.slide_n); onClose() }}
                            className="text-[9px] text-accent/60 hover:text-accent px-1.5 py-0.5 rounded border border-accent/20 shrink-0">jump</button>
                          <span className="text-white/20 text-xs">{expanded === s.slide_n ? "▲" : "▼"}</span>
                        </button>
                        {expanded === s.slide_n && (
                          <div className="border-t border-white/5 px-4 py-2 space-y-1">
                            {s.statements.map((st, i) => (
                              <p key={i} className="text-[10px] text-white/40 leading-relaxed">· {st}</p>
                            ))}
                          </div>
                        )}
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
