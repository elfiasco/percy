import { useState } from "react"
import { fetchPersuasionIntensityRater } from "../../lib/studioApi"
import type { PersuasionIntensityResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PersuasionIntensityRaterModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PersuasionIntensityResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchPersuasionIntensityRater(docId)
      setData(res)
    } catch {
      setError("Failed to rate persuasion intensity")
    } finally {
      setLoading(false)
    }
  }

  const maxIntensity = data ? Math.max(...data.per_slide.map(s => s.intensity), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Persuasion Intensity Rater</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rates how persuasive each slide is (1–10)</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Rating persuasion…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Avg: <span className="text-white/70">{data.avg_intensity}/10</span></span>
                <span>Peak: <span className="text-accent">Slide {data.peak_slide}</span></span>
              </div>

              <div className="space-y-1.5">
                {data.per_slide.map(s => {
                  const pct = (s.intensity / 10) * 100
                  const color = s.intensity >= 7 ? "bg-green-400/50" : s.intensity >= 4 ? "bg-yellow-400/50" : "bg-red-400/50"
                  return (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors">
                      <span className="text-[10px] text-white/40 shrink-0 w-14 mt-0.5">Slide {s.slide_n}</span>
                      <div className="flex-1 space-y-1">
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                        {s.drivers.length > 0 && (
                          <p className="text-[9px] text-white/25">{s.drivers.slice(0, 2).join(" · ")}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-white/50 shrink-0 w-6 text-right">{s.intensity}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Rate" to score persuasion per slide.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Rating…" : "Rate"}
          </button>
        </div>
      </div>
    </div>
  )
}
