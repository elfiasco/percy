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

export default function PresentationMode({ docId, slideCount, startSlide = 1, onClose }: Props) {
  const [current, setCurrent]           = useState(startSlide)
  const [transitioning, setTransitioning] = useState(false)
  const [showNotes, setShowNotes]       = useState(false)
  const [notes, setNotes]               = useState<Record<number, string>>({})
  const [showTimer, setShowTimer]       = useState(false)
  const { elapsed, paused, toggle: toggleTimer, reset: resetTimer } = useTimer()
  const [slideStart, setSlideStart]     = useState(0)
  const [slideTimes, setSlideTimes]     = useState<Record<number, number>>({})
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
    // record time spent on current slide
    setSlideTimes((prev) => ({ ...prev, [current]: (prev[current] ?? 0) + (elapsed - slideStart) }))
    setSlideStart(elapsed)
    setTransitioning(true)
    setTimeout(() => {
      setCurrent(clamped)
      setTransitioning(false)
    }, 120)
  }, [current, slideCount, transitioning, elapsed, slideStart])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setShowNotes((v) => !v); return }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setShowTimer((v) => !v); return }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); toggleTimer(); return }
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
      {/* slide image */}
      <div
        className="relative shrink-0"
        style={{
          width: "100%",
          aspectRatio: "16/9",
          maxHeight: showNotes ? "72vh" : "100vh",
          transition: "opacity 0.12s, max-height 0.2s",
          opacity: transitioning ? 0 : 1,
        }}
      >
        <img
          src={slideUrl(current)}
          alt={`Slide ${current}`}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
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

      {/* keyboard hint */}
      <div className="absolute top-3 left-4 text-white/25 text-[10px] font-mono">
        ← → navigate · N notes · T timer · P pause · Esc exit
      </div>
    </div>
  )
}
