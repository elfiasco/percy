import { useState, useEffect } from "react"
import { fetchSpeakingPace } from "../../lib/studioApi"
import type { SpeakingPaceSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const WPM_PRESETS = [
  { label: "Slow (100)", value: 100 },
  { label: "Average (130)", value: 130 },
  { label: "Fast (160)", value: 160 },
  { label: "Very fast (200)", value: 200 },
]

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export default function SpeakingPaceModal({ docId, onClose, onJumpToSlide }: Props) {
  const [wpm, setWpm]           = useState(130)
  const [loading, setLoading]   = useState(false)
  const [data, setData]         = useState<{ slides: SpeakingPaceSlide[]; wpm: number; total_seconds: number; total_minutes: number; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [includeNotes, setIncludeNotes] = useState(true)

  const load = async (w = wpm) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchSpeakingPace(docId, w)
      setData(r)
    } catch {
      setError("Failed to estimate speaking pace")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxSeconds = data
    ? Math.max(...data.slides.map((s) => includeNotes ? s.total_seconds : s.body_seconds), 1)
    : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Speaking Pace Estimator</h2>
            <p className="text-white/40 text-xs mt-0.5">Estimate talk time per slide at your speaking rate</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/40 text-xs">Words per minute:</span>
            {WPM_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setWpm(p.value); load(p.value) }}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${wpm === p.value ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setIncludeNotes(!includeNotes)}
              className={`ml-auto px-2.5 py-1 rounded text-xs border transition-colors ${includeNotes ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
            >
              {includeNotes ? "Notes: ON" : "Notes: OFF"}
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Calculating…</p>
            </div>
          ) : data && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold">{formatTime(data.total_seconds)}</div>
                  <div className="text-white/35 text-xs mt-0.5">Total time</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold">{data.wpm}</div>
                  <div className="text-white/35 text-xs mt-0.5">WPM</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold">
                    {formatTime(data.total_seconds / Math.max(data.slide_count, 1))}
                  </div>
                  <div className="text-white/35 text-xs mt-0.5">Avg / slide</div>
                </div>
              </div>

              {/* Per-slide bars */}
              <div className="space-y-1.5">
                {data.slides.map((s) => {
                  const secs = includeNotes ? s.total_seconds : s.body_seconds
                  return (
                    <div key={s.slide_n} className="flex items-center gap-3">
                      <button
                        onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-white/40 hover:text-accent transition-colors shrink-0 w-14 text-right"
                      >
                        Slide {s.slide_n}
                      </button>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent/50 transition-all"
                          style={{ width: `${(secs / maxSeconds) * 100}%` }}
                        />
                      </div>
                      <span className="text-white/40 text-xs font-mono shrink-0 w-14 text-right">{formatTime(secs)}</span>
                      <span className="text-white/20 text-[10px] shrink-0 w-14">{s.words}w</span>
                    </div>
                  )
                })}
              </div>
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
