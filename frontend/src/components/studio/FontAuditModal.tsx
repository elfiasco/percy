import { useState, useEffect } from "react"
import { fetchFontAudit } from "../../lib/studioApi"
import type { FontUsage } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function FontAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ fonts: FontUsage[]; total_fonts: number; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetchFontAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit fonts"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxCount = data && data.fonts.length > 0 ? data.fonts[0].count : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Font Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">All fonts used in the deck — detect inconsistencies</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Auditing fonts…</span>
            </div>
          ) : data && (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium ${data.total_fonts > 3 ? "text-yellow-400" : "text-white/50"}`}>
                  {data.total_fonts} unique font{data.total_fonts !== 1 ? "s" : ""}
                </span>
                {data.total_fonts > 3 && (
                  <span className="text-yellow-400/60 text-xs">— consider reducing to 2–3 for consistency</span>
                )}
              </div>

              {data.fonts.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">
                  No explicit font names found. Fonts may be inherited from the theme.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {data.fonts.map((f) => (
                    <div key={f.font} className="rounded-lg border border-white/10 overflow-hidden">
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/3 hover:bg-white/6 text-left"
                        onClick={() => setExpanded(expanded === f.font ? null : f.font)}
                      >
                        <div className="flex-1">
                          <span className="text-white/75 text-sm font-medium" style={{ fontFamily: f.font }}>{f.font}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-24 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent/50 rounded-full"
                              style={{ width: `${(f.count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-white/30 text-xs font-mono w-16 text-right">{f.count}×</span>
                          <span className="text-white/25 text-xs">{f.slides.length} slide{f.slides.length !== 1 ? "s" : ""}</span>
                          <span className="text-white/20 text-xs">{expanded === f.font ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      {expanded === f.font && (
                        <div className="px-4 py-2 border-t border-white/8 flex flex-wrap gap-1.5">
                          {f.slides.map((n) => (
                            <button
                              key={n}
                              onClick={() => { onJumpToSlide(n); onClose() }}
                              className="text-[10px] text-accent/60 hover:text-accent transition-colors bg-white/3 rounded px-1.5 py-0.5"
                            >
                              Slide {n}
                            </button>
                          ))}
                        </div>
                      )}
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
