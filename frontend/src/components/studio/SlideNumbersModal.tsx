/**
 * SlideNumbersModal — add slide numbers to all slides at once.
 */

import { useState, useEffect, useCallback } from "react"
import { addSlideNumbers } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onAdded: () => void
}

type Position = "bottom-right" | "bottom-center" | "bottom-left"
type Style    = "plain" | "total" | "slide"

const POSITION_OPTIONS: { id: Position; label: string }[] = [
  { id: "bottom-right",  label: "Bottom Right" },
  { id: "bottom-center", label: "Bottom Center" },
  { id: "bottom-left",   label: "Bottom Left" },
]

const STYLE_OPTIONS: { id: Style; label: string; example: (n: number, t: number) => string }[] = [
  { id: "plain", label: "Plain number",         example: (n, _) => String(n) },
  { id: "total", label: "Number / Total",       example: (n, t) => `${n} / ${t}` },
  { id: "slide", label: '"Slide N" label',      example: (n, _) => `Slide ${n}` },
]

export default function SlideNumbersModal({ docId, slideCount, onClose, onAdded }: Props) {
  const [position, setPosition]     = useState<Position>("bottom-right")
  const [style, setStyle]           = useState<Style>("plain")
  const [fontSize, setFontSize]     = useState("11")
  const [color, setColor]           = useState("#888888")
  const [skipFirst, setSkipFirst]   = useState(true)
  const [startNumber, setStartNumber] = useState("1")
  const [adding, setAdding]         = useState(false)
  const [result, setResult]         = useState<{ added: number } | null>(null)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const handleAdd = useCallback(async () => {
    setAdding(true)
    setError(null)
    try {
      const r = await addSlideNumbers(docId, {
        position,
        style,
        font_size: parseFloat(fontSize) || 11,
        color,
        skip_first: skipFirst,
        start_number: parseInt(startNumber, 10) || 1,
      })
      setResult({ added: r.added })
      onAdded()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add slide numbers")
    } finally {
      setAdding(false)
    }
  }, [docId, position, style, fontSize, color, skipFirst, startNumber, onAdded])

  const exampleStyle = STYLE_OPTIONS.find((s) => s.id === style)!
  const exampleNum   = skipFirst ? 2 : 1
  const previewText  = exampleStyle.example(exampleNum, slideCount)

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[440px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">Add Slide Numbers</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-4">

          {/* position */}
          <div>
            <label className="block text-[11px] text-muted mb-1.5">Position</label>
            <div className="flex gap-2">
              {POSITION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setPosition(opt.id)}
                  className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                    position === opt.id
                      ? "bg-accent/20 text-accent border-accent/40"
                      : "bg-white/5 text-muted border-edge hover:bg-white/10 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* style */}
          <div>
            <label className="block text-[11px] text-muted mb-1.5">Number style</label>
            <div className="space-y-1.5">
              {STYLE_OPTIONS.map((opt) => (
                <label key={opt.id} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    checked={style === opt.id}
                    onChange={() => setStyle(opt.id)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-slate-300 flex-1">{opt.label}</span>
                  <span className="text-[10px] font-mono text-muted/60 bg-white/5 px-2 py-0.5 rounded">
                    {opt.example(2, slideCount)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* options row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted mb-1">Font size (pt)</label>
              <input
                type="number"
                value={fontSize}
                min={6}
                max={24}
                step={0.5}
                onChange={(e) => setFontSize(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full text-sm bg-base border border-edge rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Start number</label>
              <input
                type="number"
                value={startNumber}
                min={0}
                step={1}
                onChange={(e) => setStartNumber(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full text-sm bg-base border border-edge rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1">
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
                  className="flex-1 text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent font-mono"
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={skipFirst}
              onChange={(e) => setSkipFirst(e.target.checked)}
              className="accent-accent w-3.5 h-3.5"
            />
            <span className="text-xs text-slate-300">Skip first slide (title slide)</span>
          </label>

          {/* preview */}
          <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3">
            <div className="text-[10px] text-muted uppercase tracking-wide mb-2">Preview</div>
            <div className="relative bg-white/5 rounded h-16 mx-auto" style={{ maxWidth: 240 }}>
              <div
                className="absolute text-[10px] font-mono"
                style={{
                  color,
                  fontSize: `${Math.min(parseFloat(fontSize) || 11, 16)}px`,
                  bottom: 4,
                  right: position === "bottom-right" ? 8 : undefined,
                  left: position === "bottom-left" ? 8 : position === "bottom-center" ? "50%" : undefined,
                  transform: position === "bottom-center" ? "translateX(-50%)" : undefined,
                }}
              >
                {previewText}
              </div>
            </div>
          </div>

          {result && (
            <div className="text-xs rounded px-3 py-2 border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              Added slide numbers to {result.added} slide{result.added !== 1 ? "s" : ""}
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
            disabled={adding}
            className="w-full text-sm py-2 rounded bg-accent/20 text-accent border border-accent/30
                       hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {adding ? "Adding…" : result ? "Add Again" : `Add Slide Numbers to ${skipFirst ? slideCount - 1 : slideCount} Slides`}
          </button>
        </div>
      </div>
    </div>
  )
}
