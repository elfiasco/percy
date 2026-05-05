import { useState } from "react"
import { fetchTimerEstimate } from "../../lib/studioApi"
import type { SlideTimerEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TimerEstimateModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [wpm, setWpm]         = useState(130)
  const [data, setData]       = useState<{
    slides: SlideTimerEntry[]
    total_seconds: number
    total_mm_ss: string
    total_words: number
    wpm: number
  } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchTimerEstimate(docId, wpm))
    } catch {
      setError("Failed to estimate timings")
    } finally {
      setLoading(false)
    }
  }

  const barWidth = (secs: number, max: number) => `${Math.min(100, (secs / max) * 100)}%`
  const maxSecs = data ? Math.max(...data.slides.map(s => s.seconds), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Timer Estimate</h2>
            <p className="text-white/40 text-xs mt-0.5">Estimate speaking time per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Speaking pace (WPM):</span>
            {[100, 120, 130, 150].map((w) => (
              <button key={w} onClick={() => setWpm(w)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${wpm === w ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                {w}
              </button>
            ))}
          </div>

          {data && !loading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <p className="text-white/80 font-semibold text-lg">{data.total_mm_ss}</p>
                  <p className="text-white/30 text-[10px] mt-0.5">Total estimated time</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <p className="text-white/80 font-semibold text-lg">{data.total_words}</p>
                  <p className="text-white/30 text-[10px] mt-0.5">Total words</p>
                </div>
              </div>

              <div className="space-y-1.5">
                {data.slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/30 rounded-full transition-all" style={{ width: barWidth(s.seconds, maxSecs) }} />
                    </div>
                    <span className="text-white/40 text-xs font-mono w-10 text-right shrink-0">{s.mm_ss}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!data && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Estimate" to calculate per-slide timings.</div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Estimating timings…</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Estimating…" : "Estimate"}
          </button>
        </div>
      </div>
    </div>
  )
}
