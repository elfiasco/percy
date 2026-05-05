import { useState, useEffect } from "react"
import { fetchBulletAnalysis } from "../../lib/studioApi"
import type { LongBullet } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function BulletAnalysisModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    total_bullets: number
    avg_words: number
    max_depth: number
    depth_distribution: Record<string, number>
    long_bullets: LongBullet[]
    verdicts: string[]
  } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchBulletAnalysis(docId))
    } catch {
      setError("Failed to analyze bullets")
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
            <h2 className="text-white font-semibold text-sm">Bullet Point Analysis</h2>
            <p className="text-white/40 text-xs mt-0.5">Analyze bullet length, depth, and structure</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing bullets…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Total bullets", value: data.total_bullets },
                  { label: "Avg. words", value: data.avg_words },
                  { label: "Max depth", value: `L${data.max_depth}` },
                ].map((s) => (
                  <div key={s.label} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                    <p className="text-white/80 font-semibold text-base">{s.value}</p>
                    <p className="text-white/30 text-[10px] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {data.verdicts.map((v, i) => (
                  <p key={i} className={`text-xs leading-relaxed px-3 py-1.5 rounded-lg border ${v.includes("good") ? "text-green-400/80 bg-green-400/8 border-green-400/20" : "text-yellow-400/80 bg-yellow-400/8 border-yellow-400/20"}`}>
                    {v}
                  </p>
                ))}
              </div>

              {data.long_bullets.length > 0 && (
                <>
                  <p className="text-white/30 text-xs uppercase tracking-wide">Long Bullets (&gt;18 words)</p>
                  <div className="space-y-1.5">
                    {data.long_bullets.map((b, i) => (
                      <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { onJumpToSlide(b.slide_n); onClose() }}
                            className="text-[10px] text-accent/60 hover:text-accent transition-colors">
                            Slide {b.slide_n}
                          </button>
                          <span className="text-yellow-400/50 text-[10px]">{b.words}w · L{b.level}</span>
                        </div>
                        <p className="text-white/45 text-xs truncate">{b.text}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
