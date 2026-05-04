/**
 * PresentationMode — fullscreen slideshow viewer.
 * Arrow keys / PageUp/Down navigate, N toggles presenter notes, Escape exits.
 * Preloads next/prev slides for smooth transitions.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { getSlideNotes } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  startSlide?: number
  onClose: () => void
}

function useTimer() {
  const [elapsed, setElapsed]     = useState(0)
  const startRef                  = useRef(Date.now())
  const pausedRef                 = useRef(false)
  const [paused, setPaused]       = useState(false)
  const savedRef                  = useRef(0)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      setElapsed(savedRef.current + Math.floor((Date.now() - startRef.current) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [paused])

  const toggle = useCallback(() => {
    if (pausedRef.current) {
      startRef.current = Date.now()
      pausedRef.current = false
      setPaused(false)
    } else {
      savedRef.current = elapsed
      pausedRef.current = true
      setPaused(true)
    }
  }, [elapsed])

  const reset = useCallback(() => {
    savedRef.current = 0
    startRef.current = Date.now()
    pausedRef.current = false
    setPaused(false)
    setElapsed(0)
  }, [])

  return { elapsed, paused, toggle, reset }
}

function fmtTime(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

const PEN_COLORS = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#FFFFFF", "#000000"]

export default function PresentationMode({ docId, slideCount, startSlide = 1, onClose }: Props) {
  const [current, setCurrent]           = useState(startSlide)
  const [transitioning, setTransitioning] = useState(false)
  const [showNotes, setShowNotes]       = useState(false)
  const [notes, setNotes]               = useState<Record<number, string>>({})
  const [showTimer, setShowTimer]       = useState(false)
  const { elapsed, paused, toggle: toggleTimer, reset: resetTimer } = useTimer()
  const [slideStart, setSlideStart]     = useState(0)
  const [slideTimes, setSlideTimes]     = useState<Record<number, number>>({})
  const [autoplay, setAutoplay]         = useState(false)
  const [autoDelay, setAutoDelay]       = useState(5)
  const [showAutoSettings, setShowAutoSettings] = useState(false)
  const autoProgressRef                 = useRef(0)
  const [autoProgress, setAutoProgress] = useState(0)
  const [transition, setTransition]     = useState<"fade" | "slide" | "zoom" | "none">("fade")
  const [transDir, setTransDir]         = useState<1 | -1>(1)
  // Drawing tools
  const [drawMode, setDrawMode]         = useState(false)
  const [penColor, setPenColor]         = useState("#FF3B30")
  const [penSize, setPenSize]           = useState(4)
  const drawCanvasRef                   = useRef<HTMLCanvasElement>(null)
  const drawingRef                      = useRef(false)
  const lastPtRef                       = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const slideUrl = (n: number) => `/api/docs/${docId}/slides/${n}/bridge.png`

  // Preload adjacent slides
  useEffect(() => {
    const prev = current > 1 ? current - 1 : null
    const next = current < slideCount ? current + 1 : null
    for (const n of [prev, next]) {
      if (n) { const img = new Image(); img.src = slideUrl(n) }
    }
  }, [current, slideCount, docId])

  // Autoplay: advance slides on a timer with progress bar
  useEffect(() => {
    if (!autoplay) { autoProgressRef.current = 0; setAutoProgress(0); return }
    const total = autoDelay * 1000
    const tick  = 50
    autoProgressRef.current = 0
    setAutoProgress(0)
    const id = setInterval(() => {
      autoProgressRef.current += tick
      const pct = Math.min(100, (autoProgressRef.current / total) * 100)
      setAutoProgress(pct)
      if (autoProgressRef.current >= total) {
        autoProgressRef.current = 0
        setCurrent((c) => {
          const next = c < slideCount ? c + 1 : 1
          return next
        })
      }
    }, tick)
    return () => clearInterval(id)
  }, [autoplay, autoDelay, slideCount])

  // Reset autoplay progress when slide changes manually
  useEffect(() => {
    if (autoplay) { autoProgressRef.current = 0; setAutoProgress(0) }
    // Clear drawing canvas on slide change
    const ctx = drawCanvasRef.current?.getContext("2d")
    if (ctx && drawCanvasRef.current) ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
  }, [current, autoplay])

  // Fetch notes for current slide (and adjacent) when notes panel is open
  useEffect(() => {
    if (!showNotes) return
    const toFetch = [current - 1, current, current + 1].filter((n) => n >= 1 && n <= slideCount && !(n in notes))
    for (const n of toFetch) {
      getSlideNotes(docId, n)
        .then((r) => setNotes((prev) => ({ ...prev, [n]: r.notes_text })))
        .catch(() => setNotes((prev) => ({ ...prev, [n]: "" })))
    }
  }, [current, showNotes, docId, slideCount])

  const go = useCallback((n: number) => {
    if (transitioning) return
    const clamped = Math.max(1, Math.min(slideCount, n))
    if (clamped === current) return
    setTransDir(clamped > current ? 1 : -1)
    setSlideTimes((prev) => ({ ...prev, [current]: (prev[current] ?? 0) + (elapsed - slideStart) }))
    setSlideStart(elapsed)
    setTransitioning(true)
    const dur = transition === "none" ? 0 : 180
    setTimeout(() => {
      setCurrent(clamped)
      setTransitioning(false)
    }, dur)
  }, [current, slideCount, transitioning, elapsed, slideStart, transition])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setShowNotes((v) => !v); return }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setShowTimer((v) => !v); return }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); toggleTimer(); return }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); setAutoplay((v) => !v); return }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); setDrawMode((v) => !v); return }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault()
        const ctx = drawCanvasRef.current?.getContext("2d")
        if (ctx && drawCanvasRef.current) ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
        return
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault(); go(current + 1)
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault(); go(current - 1)
      }
      if (e.key === "Home") { e.preventDefault(); go(1) }
      if (e.key === "End")  { e.preventDefault(); go(slideCount) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [current, go, onClose, slideCount])

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const currentNotes = notes[current] ?? null

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[99999] bg-black flex flex-col items-center select-none outline-none"
      style={{ justifyContent: showNotes ? "flex-start" : "center" }}
      onClick={() => go(current + 1)}
    >
      {/* slide image + drawing overlay */}
      <div
        className="relative shrink-0"
        style={{
          width: "100%",
          aspectRatio: "16/9",
          maxHeight: showNotes ? "72vh" : "100vh",
          transition: transition === "none" ? "max-height 0.2s" :
                      transition === "fade"  ? "opacity 0.18s ease, max-height 0.2s" :
                      transition === "slide" ? "transform 0.18s ease, opacity 0.1s, max-height 0.2s" :
                                              "transform 0.18s ease, opacity 0.12s, max-height 0.2s",
          opacity: transitioning && transition !== "slide" ? 0 : 1,
          transform: transitioning
            ? transition === "slide" ? `translateX(${transDir * 8}%)` : transition === "zoom" ? "scale(0.93)" : "none"
            : "none",
        }}
        onClick={drawMode ? (e) => e.stopPropagation() : undefined}
      >
        <img
          src={slideUrl(current)}
          alt={`Slide ${current}`}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
        {/* drawing canvas overlay */}
        <canvas
          ref={drawCanvasRef}
          width={1920}
          height={1080}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: drawMode ? "crosshair" : "none",
            pointerEvents: drawMode ? "all" : "none",
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            if (!drawMode) return
            e.stopPropagation()
            const canvas = drawCanvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const sx = canvas.width / rect.width
            const sy = canvas.height / rect.height
            const x = (e.clientX - rect.left) * sx
            const y = (e.clientY - rect.top) * sy
            drawingRef.current = true
            lastPtRef.current = { x, y }
            canvas.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drawMode || !drawingRef.current) return
            e.stopPropagation()
            const canvas = drawCanvasRef.current
            if (!canvas) return
            const ctx = canvas.getContext("2d")
            if (!ctx) return
            const rect = canvas.getBoundingClientRect()
            const sx = canvas.width / rect.width
            const sy = canvas.height / rect.height
            const x = (e.clientX - rect.left) * sx
            const y = (e.clientY - rect.top) * sy
            const last = lastPtRef.current!
            ctx.beginPath()
            ctx.strokeStyle = penColor
            ctx.lineWidth = penSize * (canvas.width / rect.width)
            ctx.lineCap = "round"
            ctx.lineJoin = "round"
            ctx.moveTo(last.x, last.y)
            ctx.lineTo(x, y)
            ctx.stroke()
            lastPtRef.current = { x, y }
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            drawingRef.current = false
            lastPtRef.current = null
          }}
        />
      </div>

      {/* presenter notes panel */}
      {showNotes && (
        <div
          className="w-full flex-1 bg-neutral-900 border-t border-white/10 overflow-y-auto p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">Presenter Notes — Slide {current}</span>
              <button
                onClick={() => setShowNotes(false)}
                className="text-white/30 hover:text-white/60 text-sm transition-colors"
                title="Hide notes (N)"
              >
                ▾
              </button>
            </div>
            {currentNotes === null ? (
              <div className="text-white/30 text-sm italic animate-pulse">Loading…</div>
            ) : currentNotes.trim() ? (
              <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-sans">{currentNotes}</p>
            ) : (
              <p className="text-white/25 text-sm italic">No notes for this slide.</p>
            )}
          </div>
        </div>
      )}

      {/* slide counter */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => go(current - 1)}
          disabled={current <= 1}
          className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center disabled:opacity-30 transition-colors"
        >
          ‹
        </button>
        <span className="text-white/60 text-xs font-mono px-2 bg-black/40 rounded-full py-0.5">
          {current} / {slideCount}
        </span>
        <button
          onClick={() => go(current + 1)}
          disabled={current >= slideCount}
          className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center disabled:opacity-30 transition-colors"
        >
          ›
        </button>
      </div>

      {/* close button */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        title="Exit presentation (Esc)"
        className="absolute top-3 right-4 text-white/40 hover:text-white/80 text-xl transition-colors"
      >
        ✕
      </button>

      {/* notes toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowNotes((v) => !v) }}
        title="Toggle presenter notes (N)"
        className={`absolute top-3 right-14 text-xs px-2 py-0.5 rounded border transition-colors ${
          showNotes
            ? "text-white/70 border-white/30 bg-white/10"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        Notes
      </button>

      {/* timer toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowTimer((v) => !v) }}
        title="Toggle timer (T)"
        className={`absolute top-3 right-[7.5rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          showTimer
            ? "text-white/70 border-white/30 bg-white/10"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        Timer
      </button>

      {/* transition picker */}
      <div
        className="absolute top-3 right-[15rem] flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {(["none", "fade", "slide", "zoom"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTransition(t)}
            title={`Transition: ${t}`}
            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
              transition === t
                ? "text-white/70 border-white/30 bg-white/10"
                : "text-white/25 border-white/10 hover:text-white/50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* draw mode toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setDrawMode((v) => !v) }}
        title="Toggle draw mode (D)"
        className={`absolute top-3 right-[11.5rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          drawMode
            ? "text-white/80 border-white/40 bg-white/15"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        ✏ Draw
      </button>

      {/* drawing toolbar — shown when draw mode is on */}
      {drawMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-[5.5rem] flex items-center gap-2 bg-black/70 rounded-full px-3 py-1.5 backdrop-blur-sm border border-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setPenColor(c)}
              title={c}
              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: c === penColor ? "#fff" : "transparent",
                transform: c === penColor ? "scale(1.25)" : undefined,
              }}
            />
          ))}
          <div className="w-px h-4 bg-white/20 mx-1" />
          {[2, 4, 8].map((sz) => (
            <button
              key={sz}
              onClick={() => setPenSize(sz)}
              className={`rounded-full transition-all ${penSize === sz ? "bg-white" : "bg-white/30 hover:bg-white/50"}`}
              style={{ width: sz * 2.5 + 4, height: sz * 2.5 + 4 }}
              title={`Pen size ${sz}`}
            />
          ))}
          <div className="w-px h-4 bg-white/20 mx-1" />
          <button
            onClick={() => {
              const ctx = drawCanvasRef.current?.getContext("2d")
              if (ctx && drawCanvasRef.current) ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
            }}
            className="text-white/50 hover:text-white text-xs transition-colors"
            title="Clear drawings (C)"
          >
            Clear
          </button>
        </div>
      )}

      {/* timer display */}
      {showTimer && (
        <div
          className="absolute bottom-20 right-4 bg-black/60 rounded-lg px-3 py-2 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`text-2xl font-mono font-bold tracking-wider ${paused ? "text-white/40" : "text-white/90"}`}>
            {fmtTime(elapsed)}
          </div>
          <div className="text-white/30 text-[9px] font-mono mt-0.5">
            slide {fmtTime((slideTimes[current] ?? 0) + (elapsed - slideStart))}
          </div>
          <div className="flex gap-1 mt-1.5 justify-end">
            <button
              onClick={toggleTimer}
              className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 transition-colors"
            >
              {paused ? "▶" : "⏸"}
            </button>
            <button
              onClick={resetTimer}
              className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 transition-colors"
            >
              ↺
            </button>
          </div>
        </div>
      )}

      {/* slide dots — up to 30 slides */}
      {slideCount <= 30 && (
        <div
          className="absolute bottom-14 left-1/2 -translate-x-1/2 flex gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {Array.from({ length: slideCount }, (_, i) => (
            <button
              key={i}
              onClick={() => go(i + 1)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i + 1 === current ? "bg-white" : "bg-white/25 hover:bg-white/50"
              }`}
            />
          ))}
        </div>
      )}

      {/* autoplay progress bar */}
      {autoplay && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className="h-full bg-indigo-400 transition-none"
            style={{ width: `${autoProgress}%` }}
          />
        </div>
      )}

      {/* autoplay controls */}
      <div
        className="absolute bottom-4 right-4 flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {showAutoSettings && (
          <div className="flex items-center gap-1 bg-black/60 rounded px-2 py-1">
            <span className="text-white/40 text-[10px]">every</span>
            <input
              type="number"
              min={1}
              max={120}
              value={autoDelay}
              onChange={(e) => setAutoDelay(Math.max(1, Math.min(120, Number(e.target.value))))}
              className="w-10 text-xs bg-white/10 border border-white/20 rounded px-1 py-0.5 text-white/80 text-center focus:outline-none"
            />
            <span className="text-white/40 text-[10px]">s</span>
          </div>
        )}
        <button
          onClick={() => setShowAutoSettings((v) => !v)}
          title="Autoplay settings"
          className="text-white/30 hover:text-white/60 text-xs px-1 transition-colors"
        >
          ⚙
        </button>
        <button
          onClick={() => setAutoplay((v) => !v)}
          title={autoplay ? "Stop autoplay (A)" : "Start autoplay (A)"}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            autoplay
              ? "text-indigo-300 border-indigo-400/40 bg-indigo-500/20 hover:bg-indigo-500/30"
              : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
          }`}
        >
          {autoplay ? "⏹ Auto" : "▶ Auto"}
        </button>
      </div>

      {/* keyboard hint */}
      <div className="absolute top-3 left-4 text-white/25 text-[10px] font-mono">
        ← → navigate · N notes · T timer · A auto · D draw · Esc exit
      </div>
    </div>
  )
}
