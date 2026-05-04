import { useRef, useEffect } from "react"
import type { Grade } from "../lib/types"
import { slideUrl } from "../lib/api"

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  grades: Record<number, Grade>
  diagnosticCounts: Record<number, number>
  pixelScores: Record<number, number>
  cacheBust: number
  onSelect: (n: number) => void
}

const GRADE_DOT: Record<Grade, string> = {
  good:    "bg-good",
  partial: "bg-partial",
  bad:     "bg-bad",
}

function pixelScoreColor(rms: number): string {
  if (rms < 5)  return "bg-good/80 text-black"
  if (rms < 15) return "bg-partial/80 text-black"
  return "bg-bad/80 text-white"
}

export default function SlideStrip({
  docId, slideCount, selectedSlide, grades, diagnosticCounts, pixelScores, cacheBust, onSelect,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null)

  // Scroll selected thumbnail into view
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-slide="${selectedSlide}"]`)
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" })
  }, [selectedSlide])

  return (
    <div
      ref={stripRef}
      className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-thin shrink-0
                 border-b border-edge bg-surface"
    >
      {Array.from({ length: slideCount }, (_, i) => {
        const n = i + 1
        const active = n === selectedSlide
        const grade  = grades[n]
        const diagnosticCount = diagnosticCounts[n] ?? 0
        const pixelRms = pixelScores[n]
        return (
          <button
            key={n}
            data-slide={n}
            onClick={() => onSelect(n)}
            className={`relative shrink-0 rounded overflow-hidden border transition-all
              ${active
                ? "border-accent ring-1 ring-accent"
                : "border-edge hover:border-slate-500"}`}
            style={{ width: 88, height: 66 }}
          >
            <img
              src={`${slideUrl.bridge(docId, n)}${cacheBust ? `?v=${cacheBust}` : ""}`}
              alt={`Slide ${n}`}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
            />
            {/* slide number badge */}
            <span
              className={`absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded
                ${active ? "bg-accent text-white" : "bg-black/60 text-slate-300"}`}
            >
              {n}
            </span>
            {/* grade dot */}
            {grade && (
              <span
                className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${GRADE_DOT[grade]}`}
              />
            )}
            {diagnosticCount > 0 && (
              <span
                className="absolute top-0.5 left-0.5 min-w-3 h-3 px-0.5 rounded-sm bg-partial text-black text-[8px] leading-3 font-semibold"
                title={`${diagnosticCount} diagnostics`}
              >
                {diagnosticCount > 9 ? "9+" : diagnosticCount}
              </span>
            )}
            {pixelRms !== undefined && (
              <span
                className={`absolute bottom-0.5 right-0.5 h-3 px-0.5 rounded-sm text-[8px] leading-3 font-semibold ${pixelScoreColor(pixelRms)}`}
                title={`Pixel RMS vs original: ${pixelRms}`}
              >
                {pixelRms < 10 ? pixelRms.toFixed(1) : Math.round(pixelRms)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
