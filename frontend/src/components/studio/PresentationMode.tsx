/**
 * PresentationMode — fullscreen slideshow viewer.
 * Arrow keys / PageUp/Down navigate, Escape exits.
 * Preloads next/prev slides for smooth transitions.
 */

import { useState, useEffect, useCallback, useRef } from "react"

interface Props {
  docId: string
  slideCount: number
  startSlide?: number
  onClose: () => void
}

export default function PresentationMode({ docId, slideCount, startSlide = 1, onClose }: Props) {
  const [current, setCurrent] = useState(startSlide)
  const [transitioning, setTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const slideUrl = (n: number) => `/api/docs/${docId}/slides/${n}/bridge.png`

  // Preload adjacent slides
  useEffect(() => {
    const prev = current > 1 ? current - 1 : null
    const next = current < slideCount ? current + 1 : null
    for (const n of [prev, next]) {
      if (n) {
        const img = new Image()
        img.src = slideUrl(n)
      }
    }
  }, [current, slideCount, docId])

  const go = useCallback((n: number) => {
    if (transitioning) return
    const clamped = Math.max(1, Math.min(slideCount, n))
    if (clamped === current) return
    setTransitioning(true)
    setTimeout(() => {
      setCurrent(clamped)
      setTransitioning(false)
    }, 120)
  }, [current, slideCount, transitioning])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
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

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[99999] bg-black flex flex-col items-center justify-center select-none outline-none"
      onClick={() => go(current + 1)}
    >
      {/* slide image */}
      <div
        className="relative"
        style={{
          maxWidth: "100vw",
          maxHeight: "100vh",
          aspectRatio: "16/9",
          width: "min(100vw, 177.78vh)",
          transition: "opacity 0.12s",
          opacity: transitioning ? 0 : 1,
        }}
      >
        <img
          src={slideUrl(current)}
          alt={`Slide ${current}`}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      </div>

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
        ← → navigate · Esc exit
      </div>
    </div>
  )
}
