/**
 * ColorSwapPanel — shows all unique colors in the deck and lets you swap one for another.
 * Uses POST /replace-color backend endpoint.
 */

import { useState, useEffect, useCallback } from "react"
import { fetchColorPalette, replaceColor } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onReplaced?: (affectedSlides: number[]) => void
}

export default function ColorSwapPanel({ docId, onClose, onReplaced }: Props) {
  const [colors, setColors]       = useState<string[]>([])
  const [loading, setLoading]     = useState(true)
  const [pickedOld, setPickedOld] = useState<string | null>(null)
  const [newColor, setNewColor]   = useState("#000000")
  const [tolerance, setTolerance] = useState(10)
  const [replacing, setReplacing] = useState(false)
  const [lastResult, setLastResult] = useState<{ replaced: number; slides: number[] } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchColorPalette(docId)
      .then((r) => setColors(r.colors))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  const handleReplace = useCallback(async () => {
    if (!pickedOld) return
    setReplacing(true)
    try {
      const res = await replaceColor(docId, pickedOld, newColor, tolerance)
      setLastResult({ replaced: res.replaced, slides: res.affected_slides })
      onReplaced?.(res.affected_slides)
      // Refresh palette
      const pal = await fetchColorPalette(docId)
      setColors(pal.colors)
    } catch (e) {
      console.error("replace-color failed:", e)
    } finally {
      setReplacing(false)
    }
  }, [docId, pickedOld, newColor, tolerance, onReplaced])

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">🎨 Color Swap</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          {/* color palette grid */}
          <div>
            <div className="text-[10px] text-muted uppercase tracking-widest mb-2">
              Deck Colors — click to select "old" color
            </div>
            {loading ? (
              <div className="text-xs text-muted animate-pulse">Loading palette…</div>
            ) : colors.length === 0 ? (
              <div className="text-xs text-muted/50 italic">No solid fill colors found</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setPickedOld(c); setNewColor(c) }}
                    title={c}
                    className={`relative w-8 h-8 rounded border-2 transition-all ${
                      pickedOld === c
                        ? "border-white scale-110 shadow-lg"
                        : "border-transparent hover:border-white/50 hover:scale-105"
                    }`}
                    style={{ background: c }}
                  >
                    {pickedOld === c && (
                      <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold"
                        style={{ textShadow: "0 0 4px #000" }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* swap controls */}
          {pickedOld && (
            <div className="space-y-3">
              <div className="text-[10px] text-muted uppercase tracking-widest">Replace</div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded border border-edge" style={{ background: pickedOld }} />
                  <span className="text-xs font-mono text-slate-300">{pickedOld}</span>
                </div>
                <span className="text-muted text-sm">→</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-edge bg-transparent"
                  />
                  <input
                    type="text"
                    value={newColor}
                    onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setNewColor(e.target.value) }}
                    className="w-24 text-xs font-mono bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted">
                Tolerance:
                <input
                  type="range" min={0} max={60} value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="w-24 accent-indigo-500"
                />
                <span className="font-mono w-6">{tolerance}</span>
              </label>

              <button
                onClick={handleReplace}
                disabled={replacing || newColor === pickedOld}
                className="w-full text-xs py-2 rounded bg-paper/20 text-paper border border-paper/30
                           hover:bg-paper/30 transition-colors disabled:opacity-40"
              >
                {replacing ? "Replacing…" : `Replace ${pickedOld} → ${newColor}`}
              </button>

              {lastResult && (
                <div className={`text-xs rounded px-2 py-1.5 ${lastResult.replaced > 0 ? "bg-good/10 text-good" : "bg-muted/10 text-muted"}`}>
                  {lastResult.replaced > 0
                    ? `✓ Replaced ${lastResult.replaced} occurrence${lastResult.replaced !== 1 ? "s" : ""} on ${lastResult.slides.length} slide${lastResult.slides.length !== 1 ? "s" : ""}`
                    : "No matches found within tolerance"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
