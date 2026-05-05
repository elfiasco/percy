import { useState, useEffect } from "react"
import { fetchBulletBrevity } from "../../lib/studioApi"
import type { BulletBrevityEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function BulletBrevityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ flagged: BulletBrevityEntry[]; total_bullets: number; total_flagged: number; threshold: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchBulletBrevity(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze bullet lengths"))
      .finally(() => setLoading(false))
  }, [docId])

  const excessColor = (excess: number) =>
    excess >= 15 ? "text-red-400" : excess >= 7 ? "text-yellow-400" : "text-white/50"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Bullet Brevity Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags bullets exceeding the recommended word count</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking bullet lengths…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Total bullets: <span className="text-white/70">{data.total_bullets}</span></span>
                <span>Too long: <span className="text-red-400">{data.total_flagged}</span></span>
                <span>Threshold: <span className="text-white/70">{data.threshold} words</span></span>
              </div>

              {data.flagged.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  All bullets are concise. Great work!
                </div>
              ) : (
                <div className="space-y-2">
                  {data.flagged.map((b, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(b.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">
                          Slide {b.slide_n}
                        </button>
                        <span className={`text-xs font-medium ${excessColor(b.excess)}`}>
                          {b.word_count} words (+{b.excess} over)
                        </span>
                      </div>
                      <p className="text-white/65 text-xs leading-relaxed line-clamp-3">{b.text}</p>
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
