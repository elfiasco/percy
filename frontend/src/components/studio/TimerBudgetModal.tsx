import { useState, useEffect } from "react"
import { fetchTimerBudgetPlan, notesExportUrl } from "../../lib/studioApi"
import type { TimerBudgetSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

const PRESET_DURATIONS = [5, 10, 15, 20, 30, 45, 60]

export default function TimerBudgetModal({ docId, slideCount, onClose, onJumpToSlide }: Props) {
  const [minutes, setMinutes]   = useState(20)
  const [custom, setCustom]     = useState("")
  const [loading, setLoading]   = useState(false)
  const [budget, setBudget]     = useState<{ slides: TimerBudgetSlide[]; total_minutes: number; total_slides: number; avg_seconds: number } | null>(null)
  const [error, setError]       = useState("")

  const load = async (mins: number) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchTimerBudgetPlan(docId, mins)
      setBudget(r)
    } catch {
      setError("Failed to calculate budget")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(minutes)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxSeconds = budget ? Math.max(1, ...budget.slides.map((s) => s.seconds)) : 1

  const barColor = (seconds: number) => {
    const ratio = seconds / maxSeconds
    if (ratio > 0.75) return "bg-red-400"
    if (ratio > 0.45) return "bg-yellow-400"
    return "bg-accent"
  }

  const applyMinutes = () => {
    const n = custom.trim() ? parseFloat(custom) : minutes
    if (n > 0 && n <= 360) {
      setMinutes(n)
      load(n)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Timer Budget</h2>
            <p className="text-white/40 text-xs mt-0.5">Distribute presentation time based on slide content weight</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* duration picker */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Total Presentation Time</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => { setMinutes(d); setCustom(""); load(d) }}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${minutes === d && !custom ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {d}m
                </button>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="custom"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyMinutes() }}
                  className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs placeholder-white/20 focus:outline-none focus:border-accent/50"
                />
                <span className="text-white/30 text-xs">min</span>
                <button
                  onClick={applyMinutes}
                  className="text-xs px-2 py-1.5 rounded bg-white/5 border border-white/10 text-white/50 hover:text-white/80 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>

          {/* summary */}
          {budget && (
            <div className="flex items-center gap-4 text-xs text-white/40 border border-white/10 rounded-lg px-4 py-2.5 bg-white/3">
              <span>{budget.total_slides} slides</span>
              <span className="text-white/20">·</span>
              <span>{budget.total_minutes}m total</span>
              <span className="text-white/20">·</span>
              <span>{fmt(budget.avg_seconds)} avg per slide</span>
            </div>
          )}

          {/* slide list */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Calculating…</p>
            </div>
          ) : budget && (
            <div className="space-y-1.5">
              {budget.slides.map((slide) => (
                <div
                  key={slide.slide_n}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-white/3 hover:bg-white/5 cursor-pointer group"
                  onClick={() => { onJumpToSlide(slide.slide_n); onClose() }}
                >
                  <span className="text-white/40 text-xs font-mono w-12 shrink-0">Slide {slide.slide_n}</span>
                  <div className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(slide.seconds)}`}
                      style={{ width: `${Math.round((slide.seconds / maxSeconds) * 100)}%` }}
                    />
                  </div>
                  <span className="text-white text-xs font-mono w-14 text-right shrink-0">{fmt(slide.seconds)}</span>
                  <span className="text-white/20 text-[10px] group-hover:text-white/50 transition-colors shrink-0">↗</span>
                </div>
              ))}
            </div>
          )}

          {/* notes export */}
          <div className="border-t border-white/10 pt-4">
            <p className="text-white/40 text-xs mb-2">Export speaker notes for rehearsal:</p>
            <div className="flex gap-2">
              <a
                href={notesExportUrl(docId, "md")}
                download
                className="text-xs px-3 py-1.5 rounded border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                ⬇ Notes as Markdown
              </a>
              <a
                href={notesExportUrl(docId, "txt")}
                download
                className="text-xs px-3 py-1.5 rounded border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                ⬇ Notes as Text
              </a>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
