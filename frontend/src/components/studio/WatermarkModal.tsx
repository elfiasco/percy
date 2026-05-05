/**
 * WatermarkModal — add a diagonal text watermark to all slides.
 */

import { useState, useEffect, useCallback } from "react"
import { addWatermark } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onAdded: () => void
}

const PRESETS = [
  { label: "CONFIDENTIAL", color: "#CC0000" },
  { label: "DRAFT",        color: "#0066CC" },
  { label: "INTERNAL",     color: "#884400" },
  { label: "SAMPLE",       color: "#006600" },
  { label: "DO NOT COPY",  color: "#660066" },
]

export default function WatermarkModal({ docId, slideCount, onClose, onAdded }: Props) {
  const [text, setText]         = useState("CONFIDENTIAL")
  const [color, setColor]       = useState("#CC0000")
  const [opacity, setOpacity]   = useState("15")
  const [fontSize, setFontSize] = useState("48")
  const [angle, setAngle]       = useState("-35")
  const [adding, setAdding]     = useState(false)
  const [result, setResult]     = useState<{ added: number } | null>(null)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const handleAdd = useCallback(async () => {
    if (!text.trim()) return
    setAdding(true)
    setError(null)
    try {
      const r = await addWatermark(docId, {
        text: text.trim(),
        color,
        opacity: (parseFloat(opacity) || 15) / 100,
        font_size: parseFloat(fontSize) || 48,
        angle: parseFloat(angle) || -35,
      })
      setResult({ added: r.added })
      onAdded()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add watermark")
    } finally {
      setAdding(false)
    }
  }, [docId, text, color, opacity, fontSize, angle, onAdded])

  // compute preview color (blended toward white at current opacity)
  function blendToWhite(hex: string, opacity: number): string {
    const h = hex.replace("#", "")
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const r2 = Math.round(r + (255 - r) * (1 - opacity / 100))
    const g2 = Math.round(g + (255 - g) * (1 - opacity / 100))
    const b2 = Math.round(b + (255 - b) * (1 - opacity / 100))
    return `rgb(${r2},${g2},${b2})`
  }
  const previewColor = blendToWhite(color.length === 7 ? color : "#CC0000", parseFloat(opacity) || 15)

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[460px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">Add Watermark</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-4">

          {/* presets */}
          <div>
            <label className="block text-[11px] text-muted mb-1.5">Presets</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setText(p.label); setColor(p.color) }}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    text === p.label && color === p.color
                      ? "bg-accent/20 text-accent border-accent/40"
                      : "bg-white/5 text-muted border-edge hover:bg-white/10 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* text */}
          <div>
            <label className="block text-[11px] text-muted mb-1">Watermark text</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full text-sm bg-base border border-edge rounded px-3 py-1.5 text-slate-200
                         focus:outline-none focus:border-accent placeholder:text-muted/40 uppercase"
              placeholder="CONFIDENTIAL"
            />
          </div>

          {/* color and opacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-7 rounded border border-edge cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="flex-1 text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200
                             focus:outline-none focus:border-accent font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Opacity (%)</label>
              <input
                type="range"
                min={5}
                max={60}
                value={opacity}
                onChange={(e) => setOpacity(e.target.value)}
                className="w-full mt-1.5 accent-accent"
              />
              <div className="text-[10px] text-muted/60 text-center">{opacity}%</div>
            </div>
          </div>

          {/* size and angle */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted mb-1">Font size (pt)</label>
              <input
                type="number"
                value={fontSize}
                min={12}
                max={120}
                step={2}
                onChange={(e) => setFontSize(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full text-sm bg-base border border-edge rounded px-2.5 py-1 text-slate-200
                           focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Angle (degrees)</label>
              <input
                type="number"
                value={angle}
                min={-90}
                max={90}
                step={5}
                onChange={(e) => setAngle(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full text-sm bg-base border border-edge rounded px-2.5 py-1 text-slate-200
                           focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* preview */}
          <div>
            <label className="block text-[11px] text-muted mb-1.5">Preview</label>
            <div className="relative bg-white/5 rounded-lg h-20 overflow-hidden border border-white/10 flex items-center justify-center">
              <span
                className="font-bold pointer-events-none select-none"
                style={{
                  color: previewColor,
                  fontSize: `${Math.min(parseFloat(fontSize) || 48, 36)}px`,
                  transform: `rotate(${parseFloat(angle) || -35}deg)`,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.08em",
                }}
              >
                {text || "WATERMARK"}
              </span>
            </div>
          </div>

          {result && (
            <div className="text-xs rounded px-3 py-2 border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              Added watermark to {result.added} slide{result.added !== 1 ? "s" : ""}
            </div>
          )}
          {error && (
            <div className="text-xs rounded px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="shrink-0 px-5 py-3 border-t border-edge">
          <button
            onClick={handleAdd}
            disabled={adding || !text.trim()}
            className="w-full text-sm py-2 rounded bg-accent/20 text-accent border border-accent/30
                       hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {adding ? "Adding…" : result ? "Add Again" : `Add Watermark to All ${slideCount} Slides`}
          </button>
        </div>
      </div>
    </div>
  )
}
