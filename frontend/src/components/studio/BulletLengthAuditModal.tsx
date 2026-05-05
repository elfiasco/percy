import { useState, useEffect } from "react"
import { fetchBulletLengthAudit } from "../../lib/studioApi"
import type { BulletLengthResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function BulletLengthAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<BulletLengthResult | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchBulletLengthAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit bullet length"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Bullet Length Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags bullet points with more than 15 words</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing bullets…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Long bullets: <span className={data.total_long > 0 ? "text-yellow-400" : "text-green-400"}>{data.total_long}</span></span>
                <span>Flagged slides: <span className="text-white/70">{data.flagged_slides.length}</span></span>
              </div>

              {data.per_slide.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">All bullets are concise (≤15 words).</div>
              ) : (
                <div className="space-y-3">
                  {data.per_slide.map(s => (
                    <div key={s.slide_n} className="border border-white/8 rounded-lg overflow-hidden">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left">
                        <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                        <span className="flex-1 text-[10px] text-yellow-400/70">{s.count} long bullet{s.count !== 1 ? "s" : ""}</span>
                      </button>
                      <div className="border-t border-white/5 px-3 py-2 space-y-2">
                        {s.long_bullets.map((b, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[10px] text-white/20 shrink-0 mt-0.5">{b.word_count}w</span>
                            <p className="text-[10px] text-white/50 leading-relaxed">{b.text}</p>
                          </div>
                        ))}
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
