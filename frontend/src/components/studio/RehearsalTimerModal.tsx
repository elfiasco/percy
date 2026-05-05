import { useState, useEffect, useRef } from "react"

interface Props {
  docId: string
  slideCount: number
  startSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function fmtShort(sec: number) {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export default function RehearsalTimerModal({ slideCount, startSlide, onClose, onJumpToSlide }: Props) {
  const [current, setCurrent]           = useState(startSlide)
  const [running, setRunning]           = useState(false)
  const [totalMs, setTotalMs]           = useState(0)
  const [slideMs, setSlideMs]           = useState(0)
  const [slideTimes, setSlideTimes]     = useState<number[]>(Array(slideCount + 1).fill(0))
  const [finished, setFinished]         = useState(false)
  const [suggestedSec, setSuggestedSec] = useState(60)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef    = useRef<number>(0)
  const slideStartRef = useRef<number>(0)

  // suggested time per slide: 60s default, can be adjusted
  const [targetMin, setTargetMin] = useState(1)
  const totalTarget = slideCount * targetMin * 60 * 1000

  useEffect(() => {
    setSuggestedSec(targetMin * 60)
  }, [targetMin])

  const startTimer = () => {
    if (running) return
    const now = Date.now()
    startRef.current = now - totalMs
    slideStartRef.current = now - slideMs
    setRunning(true)
    intervalRef.current = setInterval(() => {
      const t = Date.now()
      setTotalMs(t - startRef.current)
      setSlideMs(t - slideStartRef.current)
    }, 100)
  }

  const pauseTimer = () => {
    if (!running) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRunning(false)
  }

  const advanceSlide = (delta: number) => {
    const elapsed = slideMs
    setSlideTimes((prev) => {
      const next = [...prev]
      next[current] = (next[current] || 0) + elapsed
      return next
    })
    const next = current + delta
    if (next < 1 || next > slideCount) {
      if (next > slideCount) {
        pauseTimer()
        setFinished(true)
      }
      return
    }
    setCurrent(next)
    onJumpToSlide(next)
    setSlideMs(0)
    if (running) slideStartRef.current = Date.now()
  }

  const reset = () => {
    pauseTimer()
    setTotalMs(0)
    setSlideMs(0)
    setSlideTimes(Array(slideCount + 1).fill(0))
    setCurrent(startSlide)
    onJumpToSlide(startSlide)
    setFinished(false)
  }

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const pace = totalMs > 0 ? totalMs / current : 0
  const paceColor = pace > suggestedSec * 1000 * 1.3 ? "text-red-400" : pace < suggestedSec * 1000 * 0.7 ? "text-yellow-400" : "text-green-400"
  const overallPct = totalTarget > 0 ? Math.min(100, (totalMs / totalTarget) * 100) : 0

  const recordedSlides = slideTimes.slice(1).filter((t) => t > 0)
  const avgMs = recordedSlides.length > 0 ? recordedSlides.reduce((a, b) => a + b, 0) / recordedSlides.length : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Rehearsal Timer</h2>
            <p className="text-white/40 text-xs mt-0.5">Practice your timing across {slideCount} slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {finished ? (
            <div className="space-y-4">
              <div className="bg-green-400/10 border border-green-400/20 rounded-xl px-5 py-4 text-center">
                <div className="text-green-400 text-2xl mb-1">✓</div>
                <div className="text-white font-semibold">Rehearsal Complete</div>
                <div className="text-white/40 text-xs mt-1">Total time: {fmt(totalMs)} of {fmt(totalTarget)} target</div>
              </div>
              <div className="space-y-1.5">
                {slideTimes.slice(1).map((t, i) => {
                  const n = i + 1
                  const overTarget = t > suggestedSec * 1000 * 1.3
                  const underTarget = t < suggestedSec * 1000 * 0.6
                  return (
                    <div
                      key={n}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/8 cursor-pointer hover:bg-white/8 transition-colors"
                      onClick={() => { onJumpToSlide(n); onClose() }}
                    >
                      <span className="text-white/40 text-xs w-8 shrink-0">#{n}</span>
                      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${overTarget ? "bg-red-400" : underTarget ? "bg-yellow-400" : "bg-green-400"}`}
                          style={{ width: `${Math.min(100, (t / (suggestedSec * 1000 * 2)) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs shrink-0 ${overTarget ? "text-red-300" : underTarget ? "text-yellow-300" : "text-white/60"}`}>
                        {t > 0 ? fmt(t) : "—"}
                      </span>
                    </div>
                  )
                })}
              </div>
              {avgMs > 0 && (
                <div className="text-center text-white/40 text-xs">
                  Avg per slide: {fmt(avgMs)} · Target: {fmtShort(suggestedSec)} per slide
                </div>
              )}
              <button
                onClick={reset}
                className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors border border-white/10"
              >
                Restart Rehearsal
              </button>
            </div>
          ) : (
            <>
              {/* target time setting */}
              <div className="flex items-center gap-3 bg-white/5 border border-white/8 rounded-lg px-4 py-2">
                <span className="text-white/50 text-xs">Target</span>
                <input
                  type="number"
                  min={1} max={30}
                  value={targetMin}
                  onChange={(e) => setTargetMin(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 text-center bg-transparent text-white text-sm border-b border-white/20 focus:outline-none focus:border-accent"
                />
                <span className="text-white/50 text-xs">min/slide · {Math.floor(slideCount * targetMin / 60)}h {(slideCount * targetMin) % 60}m total</span>
              </div>

              {/* main timer */}
              <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-5 text-center space-y-3">
                <div className="text-white/40 text-xs uppercase tracking-wider">Current Slide</div>
                <div className="text-white font-bold text-5xl font-mono tracking-tight">{fmt(slideMs)}</div>
                <div className={`text-xs font-mono ${paceColor}`}>
                  {pace > 0 ? `Avg pace: ${fmt(pace)}/slide` : "Not started"}
                </div>
                {/* progress bar */}
                <div className="bg-white/10 rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${slideMs > suggestedSec * 1000 * 1.3 ? "bg-red-400" : "bg-accent"}`}
                    style={{ width: `${Math.min(100, (slideMs / (suggestedSec * 1000)) * 100)}%` }}
                  />
                </div>
                <div className="text-white/30 text-[10px]">Slide target: {fmtShort(suggestedSec)}</div>
              </div>

              {/* total */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-white/5 border border-white/8 rounded-lg px-4 py-2.5 text-center">
                  <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Total</div>
                  <div className="text-white font-mono font-semibold text-lg">{fmt(totalMs)}</div>
                </div>
                <div className="flex-1 bg-white/5 border border-white/8 rounded-lg px-4 py-2.5 text-center">
                  <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Slide</div>
                  <div className="text-white font-mono font-semibold text-lg">{current} / {slideCount}</div>
                </div>
                <div className="flex-1 bg-white/5 border border-white/8 rounded-lg px-4 py-2.5 text-center">
                  <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Pace</div>
                  <div className="text-white/50 text-[10px] mt-1">
                    <div className="bg-white/10 rounded-full h-1 overflow-hidden">
                      <div className="h-full bg-accent/60 rounded-full" style={{ width: `${overallPct}%` }} />
                    </div>
                    <div className="text-white/30 mt-1">{Math.round(overallPct)}% of target</div>
                  </div>
                </div>
              </div>

              {/* controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => advanceSlide(-1)}
                  disabled={current <= 1}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 text-sm transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => running ? pauseTimer() : startTimer()}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${running ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20" : "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"}`}
                >
                  {running ? "⏸ Pause" : totalMs === 0 ? "▶ Start" : "▶ Resume"}
                </button>
                <button
                  onClick={() => advanceSlide(1)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 text-sm transition-colors"
                >
                  Next →
                </button>
              </div>

              <button
                onClick={reset}
                className="w-full py-1.5 rounded-lg text-white/30 hover:text-white/60 text-xs transition-colors"
              >
                Reset
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
