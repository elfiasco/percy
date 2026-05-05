import { useState, useEffect } from "react"
import { fetchEvidenceAudit } from "../../lib/studioApi"
import type { EvidenceSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function EvidenceAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: EvidenceSlide[]; total_unsupported: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchEvidenceAudit(docId))
    } catch {
      setError("Failed to audit evidence")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Evidence Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Find claims without supporting data or citations</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Auditing evidence…</span>
            </div>
          )}

          {data && !loading && (
            data.total_unsupported === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No unsupported claims detected.
              </div>
            ) : (
              <>
                <p className="text-white/40 text-xs">
                  {data.total_unsupported} slide{data.total_unsupported !== 1 ? "s" : ""} with unsupported claims
                </p>
                <div className="space-y-2">
                  {data.slides.map((s) => (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">
                          Slide {s.slide_n}
                        </button>
                        {s.has_evidence
                          ? <span className="text-[10px] text-green-400/60 bg-green-400/8 border border-green-400/20 px-1.5 py-0.5 rounded">has evidence</span>
                          : <span className="text-[10px] text-red-400/60 bg-red-400/8 border border-red-400/20 px-1.5 py-0.5 rounded">no evidence</span>
                        }
                      </div>
                      {s.unsupported_claims.map((claim, i) => (
                        <p key={i} className="text-yellow-400/50 text-xs leading-relaxed border-l-2 border-yellow-400/20 pl-2">{claim}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Auditing…" : "Re-audit"}
          </button>
        </div>
      </div>
    </div>
  )
}
