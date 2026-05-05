import { useState, useEffect } from "react"
import { fetchTextColorAudit } from "../../lib/studioApi"
import type { TextColorEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TextColorAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ colors: TextColorEntry[]; total_unique: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchTextColorAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit text colors"))
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
            <h2 className="text-white font-semibold text-sm">Text Color Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Distinct text colors used across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning text colors…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <p className="text-xs text-white/40">{data.total_unique} unique text color{data.total_unique !== 1 ? "s" : ""} found</p>
              {data.colors.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No explicit text colors found (using theme defaults).</div>
              ) : (
                <div className="space-y-1.5">
                  {data.colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <div className="w-5 h-5 rounded shrink-0 border border-white/20" style={{ backgroundColor: c.hex }} />
                      <span className="text-xs text-white/60 font-mono w-20 shrink-0">{c.hex}</span>
                      <span className="text-xs text-white/40 shrink-0">{c.count} slide{c.count !== 1 ? "s" : ""}</span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {c.slides.slice(0, 8).map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                            s{n}
                          </button>
                        ))}
                        {c.slides.length > 8 && <span className="text-[10px] text-white/30">+{c.slides.length - 8}</span>}
                      </div>
                    </div>
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
