/**
 * PresentationMode — fullscreen slideshow viewer.
 * Arrow keys / PageUp/Down navigate, N toggles presenter notes, Escape exits.
 * Preloads next/prev slides for smooth transitions.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { getSlideNotes, fetchSlideTransitions, fetchSlideSections, getTimerBudget, fetchHiddenSlides } from "../../lib/studioApi"

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
  const [transition, setTransition]     = useState<"fade" | "slide" | "zoom" | "none" | "flip" | "push" | "wipe" | "dissolve">("fade")
  const [transDir, setTransDir]         = useState<1 | -1>(1)
  const [slideTransitions, setSlideTransitions] = useState<Record<number, string>>({})
  const [targetMinutes, setTargetMinutes] = useState<number | null>(null)
  const [showTeleprompter, setShowTeleprompter] = useState(false)
  const [telepFontSize, setTelepFontSize] = useState(28)
  const [speakerView, setSpeakerView] = useState(false)
  const [slideSections, setSlideSections] = useState<Record<number, string>>({})
  const [hiddenSlides, setHiddenSlides]   = useState<Set<number>>(new Set())
  const [_timerBudgetMin, _setTimerBudgetMin] = useState<number | null>(null)
  // Drawing tools
  const [showMiniMap, setShowMiniMap]   = useState(false)
  const [showRehearsalReport, setShowRehearsalReport] = useState(false)
  const [editingSlideN, setEditingSlideN] = useState(false)
  const [slideNInput, setSlideNInput]   = useState("")
  const [speaking, setSpeaking]         = useState(false)
  const [drawMode, setDrawMode]         = useState(false)
  const [penColor, setPenColor]         = useState("#FF3B30")
  const [penSize, setPenSize]           = useState(4)
  const [eraserMode, setEraserMode]     = useState(false)
  const [laserMode, setLaserMode]       = useState(false)
  const [laserPos, setLaserPos]         = useState<{ x: number; y: number } | null>(null)
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
    // Stop speech synthesis on slide change
    if (speaking) { window.speechSynthesis?.cancel(); setSpeaking(false) }
  }, [current, autoplay])

  // Fetch notes for current slide (and adjacent) when notes panel, teleprompter, or speaker view is open
  useEffect(() => {
    if (!showNotes && !showTeleprompter && !speakerView) return
    const toFetch = [current - 1, current, current + 1].filter((n) => n >= 1 && n <= slideCount && !(n in notes))
    for (const n of toFetch) {
      getSlideNotes(docId, n)
        .then((r) => setNotes((prev) => ({ ...prev, [n]: r.notes_text })))
        .catch(() => setNotes((prev) => ({ ...prev, [n]: "" })))
    }
  }, [current, showNotes, showTeleprompter, speakerView, docId, slideCount])

  // Load per-slide transition overrides and section data
  useEffect(() => {
    fetchSlideTransitions(docId)
      .then((r) => setSlideTransitions(
        Object.fromEntries(Object.entries(r.transitions).map(([k, v]) => [Number(k), v.transition]))
      ))
      .catch(() => {})
    fetchSlideSections(docId)
      .then((r) => setSlideSections(
        Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [Number(k), v as string]))
      ))
      .catch(() => {})
    getTimerBudget(docId)
      .then((r) => { if (r.total_minutes) { setTargetMinutes(r.total_minutes); _setTimerBudgetMin(r.total_minutes) } })
      .catch(() => {})
    fetchHiddenSlides(docId)
      .then((r) => setHiddenSlides(new Set(r.hidden)))
      .catch(() => {})
  }, [docId])

  // Per-slide transition: use slide's stored transition if set, else global default
  const effectiveTransition = (slideTransitions[current] as typeof transition | undefined) ?? transition

  const go = useCallback((n: number) => {
    if (transitioning) return
    let clamped = Math.max(1, Math.min(slideCount, n))
    // Skip hidden slides — find nearest visible slide in same direction
    if (hiddenSlides.has(clamped) && clamped !== current) {
      const dir = n > current ? 1 : -1
      let candidate = clamped + dir
      while (candidate >= 1 && candidate <= slideCount && hiddenSlides.has(candidate)) candidate += dir
      if (candidate >= 1 && candidate <= slideCount) clamped = candidate
      else return // all slides in that direction are hidden
    }
    if (clamped === current) return
    setTransDir(clamped > current ? 1 : -1)
    setSlideTimes((prev) => ({ ...prev, [current]: (prev[current] ?? 0) + (elapsed - slideStart) }))
    setSlideStart(elapsed)
    setTransitioning(true)
    const eff = (slideTransitions[clamped] as "fade" | "slide" | "zoom" | "none" | undefined) ?? transition
    const dur = eff === "none" ? 0 : eff === "flip" ? 250 : eff === "push" ? 220 : 180
    setTimeout(() => {
      setCurrent(clamped)
      setTransitioning(false)
    }, dur)
  }, [current, slideCount, transitioning, elapsed, slideStart, transition, slideTransitions, hiddenSlides])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If timer has been running (any slide time recorded), show rehearsal report
        if (Object.keys(slideTimes).length > 0 || elapsed > 0) {
          setShowRehearsalReport(true)
        } else {
          onClose()
        }
        return
      }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setShowNotes((v) => !v); return }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setShowTimer((v) => !v); return }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); toggleTimer(); return }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); setAutoplay((v) => !v); return }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); setDrawMode((v) => !v); setLaserMode(false); return }
      if (e.key === "l" || e.key === "L") { e.preventDefault(); setLaserMode((v) => !v); setDrawMode(false); return }
      if (e.key === "m" || e.key === "M") { e.preventDefault(); setShowMiniMap((v) => !v); return }
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); setShowTeleprompter((v) => !v); return }
      if (e.key === "v" || e.key === "V") { e.preventDefault(); setSpeakerView((v) => !v); return }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault()
        const ctx = drawCanvasRef.current?.getContext("2d")
        if (ctx && drawCanvasRef.current) ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
        return
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          // Jump to next section start
          const slides = Array.from({ length: slideCount }, (_, i) => i + 1)
          const nextSectionSlide = slides.find((n) => n > current && slideSections[n])
          go(nextSectionSlide ?? slideCount)
        } else {
          go(current + 1)
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          // Jump to previous section start
          const slides = Array.from({ length: slideCount }, (_, i) => slideCount - i)
          const prevSectionSlide = slides.find((n) => n < current && slideSections[n])
          go(prevSectionSlide ?? 1)
        } else {
          go(current - 1)
        }
      }
      if (e.key === "Home") { e.preventDefault(); go(1) }
      if (e.key === "End")  { e.preventDefault(); go(slideCount) }
      // Number keys 1-9 jump to slide N (or N*10 for slides > 9 with Shift)
      if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const n = parseInt(e.key, 10)
        if (n <= slideCount) { e.preventDefault(); go(n) }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [current, go, onClose, slideCount, toggleTimer, slideSections, slideTimes, elapsed])

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
          transition: effectiveTransition === "none" ? "max-height 0.2s" :
                      effectiveTransition === "flip"  ? "transform 0.25s ease, max-height 0.2s" :
                      effectiveTransition === "wipe"  ? "clip-path 0.22s ease, max-height 0.2s" :
                                                        "transform 0.18s ease, opacity 0.15s ease, max-height 0.2s",
          opacity: transitioning && !["slide", "push", "flip", "wipe"].includes(effectiveTransition) ? 0 :
                   transitioning && effectiveTransition === "dissolve" ? 0.1 : 1,
          transform: transitioning ? (
            effectiveTransition === "slide"   ? `translateX(${transDir * 8}%)` :
            effectiveTransition === "push"    ? `translateX(${transDir * 100}%)` :
            effectiveTransition === "zoom"    ? "scale(0.93)" :
            effectiveTransition === "flip"    ? `rotateY(${transDir * 90}deg)` :
            "none"
          ) : "none",
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
            cursor: (drawMode || laserMode) ? (laserMode ? "none" : "crosshair") : "none",
            pointerEvents: (drawMode || laserMode) ? "all" : "none",
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            if (!drawMode && !laserMode) return
            e.stopPropagation()
            if (laserMode) { setLaserPos({ x: e.clientX, y: e.clientY }); return }
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
            if (laserMode) { setLaserPos({ x: e.clientX, y: e.clientY }); return }
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
            if (eraserMode) {
              ctx.globalCompositeOperation = "destination-out"
              ctx.strokeStyle = "rgba(0,0,0,1)"
              ctx.lineWidth = penSize * 4 * (canvas.width / rect.width)
            } else {
              ctx.globalCompositeOperation = "source-over"
              ctx.strokeStyle = penColor
              ctx.lineWidth = penSize * (canvas.width / rect.width)
            }
            ctx.lineCap = "round"
            ctx.lineJoin = "round"
            ctx.moveTo(last.x, last.y)
            ctx.lineTo(x, y)
            ctx.stroke()
            ctx.globalCompositeOperation = "source-over"
            lastPtRef.current = { x, y }
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            drawingRef.current = false
            lastPtRef.current = null
            if (laserMode) setLaserPos(null)
          }}
          onPointerLeave={() => { if (laserMode) setLaserPos(null) }}
        />
        {/* laser pointer dot */}
        {laserMode && laserPos && (
          <div
            className="fixed pointer-events-none"
            style={{
              left: laserPos.x - 10,
              top: laserPos.y - 10,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "rgba(255,60,60,0.85)",
              boxShadow: "0 0 8px 4px rgba(255,60,60,0.5), 0 0 20px 8px rgba(255,60,60,0.2)",
              zIndex: 99999,
            }}
          />
        )}
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

      {/* section badge */}
      {slideSections[current] && (
        <div className="absolute top-4 right-4 text-[11px] font-semibold uppercase tracking-widest text-paper/80 bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm pointer-events-none">
          § {slideSections[current]}
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
        {editingSlideN ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={slideCount}
            value={slideNInput}
            onChange={(e) => setSlideNInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(slideNInput, 10)
              if (!isNaN(n) && n >= 1 && n <= slideCount) go(n)
              setEditingSlideN(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") {
                const n = parseInt(slideNInput, 10)
                if (!isNaN(n) && n >= 1 && n <= slideCount) go(n)
                setEditingSlideN(false)
              }
              if (e.key === "Escape") setEditingSlideN(false)
            }}
            className="w-16 text-center text-white/80 text-xs font-mono bg-black/60 border border-white/30 rounded-full py-0.5 px-2 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-white/60 text-xs font-mono px-2 bg-black/40 rounded-full py-0.5 cursor-pointer hover:text-white/90 hover:bg-black/60 transition-colors"
            title="Click to jump to a slide"
            onClick={(e) => { e.stopPropagation(); setSlideNInput(String(current)); setEditingSlideN(true) }}
          >
            {current} / {slideCount}
          </span>
        )}
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
        onClick={(e) => {
          e.stopPropagation()
          if (Object.keys(slideTimes).length > 0 || elapsed > 0) {
            setShowRehearsalReport(true)
          } else {
            onClose()
          }
        }}
        title="Exit presentation (Esc)"
        className="absolute top-3 right-4 text-white/40 hover:text-white/80 text-xl transition-colors"
      >
        ✕
      </button>

      {/* mini-map toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowMiniMap((v) => !v) }}
        title="Toggle slide mini-map (M)"
        className={`absolute top-3 right-[4.5rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          showMiniMap
            ? "text-sky-300 border-sky-400/40 bg-sky-500/20"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        Map
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

      {/* speaker view toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setSpeakerView((v) => !v) }}
        title="Toggle speaker view (V)"
        className={`absolute top-3 right-[13rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          speakerView
            ? "text-teal-300 border-teal-400/40 bg-teal-500/20"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        Speaker
      </button>

      {/* teleprompter toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowTeleprompter((v) => !v) }}
        title="Toggle teleprompter (Z)"
        className={`absolute top-3 right-[10.5rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          showTeleprompter
            ? "text-emerald-300 border-emerald-400/40 bg-emerald-500/20"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        Telep
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
        {(["none", "fade", "slide", "zoom", "flip", "push", "wipe", "dissolve"] as const).map((t) => (
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
        onClick={(e) => { e.stopPropagation(); setDrawMode((v) => !v); setLaserMode(false) }}
        title="Toggle draw mode (D)"
        className={`absolute top-3 right-[15rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          drawMode
            ? "text-white/80 border-white/40 bg-white/15"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        ✏ Draw
      </button>

      {/* laser pointer toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setLaserMode((v) => !v); setDrawMode(false) }}
        title="Toggle laser pointer (L)"
        className={`absolute top-3 right-[11.5rem] text-xs px-2 py-0.5 rounded border transition-colors ${
          laserMode
            ? "text-red-400 border-red-400/50 bg-red-400/15"
            : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
        }`}
      >
        🔴 Laser
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
            onClick={() => { setEraserMode((v) => !v); setLaserMode(false) }}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${eraserMode ? "bg-white text-black" : "text-white/50 hover:text-white"}`}
            title="Eraser"
          >
            ✦
          </button>
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

      {/* laser pointer toggle button — shown always in toolbar */}

      {/* timer display */}
      {showTimer && (() => {
        const targetSecs = targetMinutes != null ? targetMinutes * 60 : null
        const overTime = targetSecs != null && elapsed > targetSecs
        const nearEnd  = targetSecs != null && elapsed > targetSecs * 0.85 && !overTime
        const timerColor = overTime ? "text-red-400" : nearEnd ? "text-amber-300" : paused ? "text-white/40" : "text-white/90"
        return (
          <div
            className="absolute bottom-20 right-4 bg-black/70 rounded-lg px-3 py-2 text-right select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`text-2xl font-mono font-bold tracking-wider transition-colors ${timerColor}`}>
              {fmtTime(elapsed)}
              {targetSecs != null && (
                <span className="text-sm font-normal ml-1 text-white/30">/ {fmtTime(targetSecs)}</span>
              )}
            </div>
            {(() => {
              const slideElapsed = (slideTimes[current] ?? 0) + (elapsed - slideStart)
              const slideTarget = targetSecs != null ? Math.floor(targetSecs / slideCount) : null
              const slideOver = slideTarget != null && slideElapsed > slideTarget
              return (
                <div className={`text-[9px] font-mono mt-0.5 ${slideOver ? "text-amber-400/80" : "text-white/30"}`}>
                  slide {fmtTime(slideElapsed)}
                  {slideTarget != null && (
                    <span className="text-white/20 ml-1">/ {fmtTime(slideTarget)}</span>
                  )}
                </div>
              )
            })()}
            {overTime && (
              <div className="text-[9px] text-red-400 mt-0.5">⏱ Over time by {fmtTime(elapsed - targetSecs!)}</div>
            )}
            {/* quick target presets */}
            <div className="flex gap-0.5 mt-1 justify-end">
              {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => setTargetMinutes(m)}
                  className={`text-[8px] px-1 py-0.5 rounded transition-colors ${
                    targetMinutes === m
                      ? "bg-white/20 text-white/80"
                      : "bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/60"
                  }`}
                  title={`Set target: ${m}min`}
                >
                  {m}m
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-1.5 justify-end items-center">
              <input
                type="number"
                min={1} max={180}
                value={targetMinutes ?? ""}
                onChange={(e) => setTargetMinutes(e.target.value ? Number(e.target.value) : null)}
                placeholder="min"
                title="Set target duration in minutes"
                className="w-12 text-[9px] text-right bg-white/10 text-white/60 rounded px-1 py-0.5 border border-white/10 focus:outline-none"
              />
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
        )
      })()}

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
            className="h-full bg-paper transition-none"
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
              ? "text-paper border-paper/40 bg-paper/20 hover:bg-paper/30"
              : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/25"
          }`}
        >
          {autoplay ? "⏹ Auto" : "▶ Auto"}
        </button>
      </div>

      {/* speaker view side panel */}
      {speakerView && (
        <div
          className="absolute top-0 right-0 bottom-0 w-72 bg-neutral-950/95 border-l border-white/10 flex flex-col overflow-hidden z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
            <span className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">Speaker View</span>
            <div className="flex items-center gap-1 text-white/40 text-[10px] font-mono">
              <span>{current}</span>
              <span>/</span>
              <span>{slideCount}</span>
            </div>
          </div>
          {/* next slide preview */}
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Up next</div>
            {current < slideCount ? (
              <div className="w-full aspect-video rounded overflow-hidden bg-black border border-white/10">
                <img
                  src={slideUrl(current + 1)}
                  alt={`Slide ${current + 1}`}
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-full aspect-video rounded bg-white/5 border border-white/10 flex items-center justify-center">
                <span className="text-white/30 text-xs">End of presentation</span>
              </div>
            )}
          </div>
          {/* current slide notes */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] text-white/30 uppercase tracking-widest">Notes — Slide {current}</div>
              {"speechSynthesis" in window && currentNotes?.trim() && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (speaking) {
                      window.speechSynthesis.cancel()
                      setSpeaking(false)
                    } else {
                      const utt = new SpeechSynthesisUtterance(currentNotes!)
                      utt.rate = 0.9
                      utt.onend = () => setSpeaking(false)
                      utt.onerror = () => setSpeaking(false)
                      window.speechSynthesis.speak(utt)
                      setSpeaking(true)
                    }
                  }}
                  title={speaking ? "Stop reading" : "Read notes aloud"}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                    speaking
                      ? "text-sky-300 border-sky-400/40 bg-sky-500/20"
                      : "text-white/30 border-white/10 hover:text-white/60"
                  }`}
                >
                  {speaking ? "⏹" : "▶ Read"}
                </button>
              )}
            </div>
            {currentNotes === null ? (
              <div className="text-white/30 text-xs animate-pulse">Loading…</div>
            ) : currentNotes.trim() ? (
              <p className="text-white/75 text-sm leading-relaxed whitespace-pre-wrap">{currentNotes}</p>
            ) : (
              <p className="text-white/20 text-xs italic">No notes</p>
            )}
          </div>
        </div>
      )}

      {/* teleprompter overlay */}
      {showTeleprompter && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-black/85 backdrop-blur-sm border-t border-white/10"
          style={{ maxHeight: "40vh", padding: "1.5rem 3rem 4rem" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400/60 text-[10px] uppercase tracking-widest font-semibold">Teleprompter — Slide {current}</span>
              <button
                onClick={() => setTelepFontSize((s) => Math.min(64, s + 4))}
                title="Larger text"
                className="text-white/40 hover:text-white/70 text-xs w-5 h-5 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center"
              >A+</button>
              <button
                onClick={() => setTelepFontSize((s) => Math.max(16, s - 4))}
                title="Smaller text"
                className="text-white/40 hover:text-white/70 text-xs w-5 h-5 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center"
              >A-</button>
            </div>
            <button
              onClick={() => setShowTeleprompter(false)}
              className="text-white/30 hover:text-white/60 text-sm transition-colors"
              title="Hide teleprompter (Z)"
            >
              ▾
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(40vh - 4rem)" }}>
            {currentNotes === null ? (
              <p className="text-white/30 animate-pulse" style={{ fontSize: telepFontSize }}>Loading…</p>
            ) : currentNotes.trim() ? (
              <p
                className="text-white leading-relaxed whitespace-pre-wrap font-sans"
                style={{ fontSize: telepFontSize, lineHeight: 1.5 }}
              >
                {currentNotes}
              </p>
            ) : (
              <p className="text-white/20 italic" style={{ fontSize: telepFontSize }}>No notes for this slide.</p>
            )}
          </div>
        </div>
      )}

      {/* rehearsal report modal */}
      {showRehearsalReport && (() => {
        const targetSecs = targetMinutes != null ? targetMinutes * 60 : null
        const slideTarget = targetSecs != null ? Math.floor(targetSecs / slideCount) : null
        const allSlideTimes = { ...slideTimes, [current]: (slideTimes[current] ?? 0) + (elapsed - slideStart) }
        return (
          <div
            className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <span className="text-sm font-semibold text-white/90">Rehearsal Report</span>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 text-xs font-mono">Total: {fmtTime(elapsed)}{targetSecs ? ` / ${fmtTime(targetSecs)}` : ""}</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/30 text-[10px] uppercase tracking-wider border-b border-white/5">
                      <th className="text-left pb-1.5 font-medium">Slide</th>
                      <th className="text-right pb-1.5 font-medium">Time</th>
                      {slideTarget && <th className="text-right pb-1.5 font-medium">Target</th>}
                      {slideTarget && <th className="text-right pb-1.5 font-medium">Δ</th>}
                      <th className="pb-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => {
                      const t = allSlideTimes[n] ?? 0
                      const delta = slideTarget != null ? t - slideTarget : null
                      const over = delta != null && delta > 0
                      const under = delta != null && delta < 0
                      const pct = slideTarget ? Math.min(100, (t / slideTarget) * 100) : 0
                      return (
                        <tr key={n} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-1.5 pr-3">
                            <span className="text-white/60 font-mono">{n}</span>
                            {slideSections[n] && (
                              <span className="ml-2 text-[9px] text-paper/60 font-medium">§ {slideSections[n]}</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right font-mono text-white/70">{t > 0 ? fmtTime(t) : "—"}</td>
                          {slideTarget && (
                            <td className="py-1.5 text-right font-mono text-white/30">{fmtTime(slideTarget)}</td>
                          )}
                          {slideTarget && (
                            <td className={`py-1.5 text-right font-mono text-[11px] ${over ? "text-red-400" : under ? "text-emerald-400" : "text-white/30"}`}>
                              {delta != null && delta !== 0 ? `${over ? "+" : ""}${fmtTime(Math.abs(delta))}` : "—"}
                            </td>
                          )}
                          <td className="py-1.5 pl-2 w-16">
                            {slideTarget && t > 0 && (
                              <div className="w-full bg-white/10 rounded-full h-1">
                                <div
                                  className={`h-1 rounded-full ${over ? "bg-red-500" : "bg-emerald-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                <button
                  onClick={() => { setShowRehearsalReport(false); resetTimer() }}
                  className="text-xs px-3 py-1.5 rounded border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 transition-colors"
                >
                  Continue Presenting
                </button>
                <button
                  onClick={() => { setShowRehearsalReport(false); onClose() }}
                  className="text-xs px-4 py-1.5 rounded bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
                >
                  Exit
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* slide mini-map — M to toggle */}
      {showMiniMap && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-white/10 overflow-x-auto flex items-center gap-1 px-3 py-2"
          style={{ maxHeight: "8rem" }}
          onClick={(e) => e.stopPropagation()}
        >
          {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => go(n)}
              className={`shrink-0 rounded overflow-hidden border-2 transition-all ${
                n === current ? "border-paper scale-110 shadow-lg" :
                hiddenSlides.has(n) ? "border-white/10 opacity-30" :
                "border-transparent hover:border-white/30"
              }`}
              style={{ width: 80, aspectRatio: "16/9" }}
              title={`Slide ${n}`}
            >
              <img
                src={slideUrl(n)}
                alt={`Slide ${n}`}
                className="w-full h-full object-contain bg-neutral-900"
                loading="lazy"
              />
              <div className={`text-center text-[8px] mt-0 py-0.5 font-mono ${n === current ? "text-paper" : "text-white/30"}`}>
                {n}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* keyboard hint */}
      <div className="absolute top-3 left-4 text-white/25 text-[10px] font-mono">
        ← → navigate · Ctrl+← → section jump · N notes · V speaker · Z telep · T timer · A auto · D draw · M map · Esc exit
      </div>
    </div>
  )
}
