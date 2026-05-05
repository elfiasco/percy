import { useState, useEffect } from "react"
import { fetchPunctuationAudit } from "../../lib/studioApi"
import type { PunctuationAuditResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PunctuationAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PunctuationAuditResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchPunctuationAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit punctuation"))
      .finally(() => setLoading(false))
  }, [docId])

  const consistencyColor = (pct: number) =>
    pct >= 90 ? "text-green-400" : pct >= 70 ? "text-yellow-400" : "text-red-400"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Punctuation Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Checks consistency of terminal punctuation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing punctuation…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 text-center">
                <p className="text-xs text-white/40 mb-1">Consistency Score</p>
                <p className={`text-2xl font-bold ${consistencyColor(data.consistency_pct)}`}>{data.consistency_pct}%</p>
                <p className="text-xs text-white/40 mt-1">Dominant style: {data.dominant_style === "with_period" ? "with period" : "no period"}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-white/80">{data.with_period}</p>
                  <p className="text-xs text-white/40">Ends with period</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-white/80">{data.without_period}</p>
                  <p className="text-xs text-white/40">No terminal period</p>
                </div>
              </div>

              {data.mixed_slides.length > 0 && (
                <div className="bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-yellow-400/80 mb-2">Slides with mixed punctuation style:</p>
                  <div className="flex flex-wrap gap-1">
                    {data.mixed_slides.map(n => (
                      <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-400/20 bg-yellow-400/8 text-yellow-400/70 hover:text-yellow-400 transition-colors">
                        s{n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
