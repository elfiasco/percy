/**
 * FontSwapPanel — shows all unique fonts in the deck and lets you swap one for another.
 */

import { useState, useEffect, useCallback } from "react"
import { fetchFontPalette, replaceFont } from "../../lib/studioApi"

const COMMON_FONTS = [
  "Arial", "Arial Black", "Arial Narrow", "Calibri", "Calibri Light",
  "Cambria", "Century Gothic", "Comic Sans MS", "Courier New",
  "Franklin Gothic Medium", "Futura", "Garamond", "Georgia",
  "Gill Sans MT", "Helvetica", "Impact", "Lato", "Lucida Console",
  "Montserrat", "Open Sans", "Palatino Linotype", "Roboto",
  "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
]

interface Props {
  docId: string
  onClose: () => void
  onReplaced?: (affectedSlides: number[]) => void
}

export default function FontSwapPanel({ docId, onClose, onReplaced }: Props) {
  const [fonts, setFonts]         = useState<string[]>([])
  const [loading, setLoading]     = useState(true)
  const [pickedOld, setPickedOld] = useState<string | null>(null)
  const [newFont, setNewFont]     = useState("")
  const [replacing, setReplacing] = useState(false)
  const [lastResult, setLastResult] = useState<{ replaced: number; slides: number[] } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchFontPalette(docId)
      .then((r) => setFonts(r.fonts))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const handleReplace = useCallback(async () => {
    if (!pickedOld || !newFont.trim()) return
    setReplacing(true)
    try {
      const res = await replaceFont(docId, pickedOld, newFont.trim())
      setLastResult({ replaced: res.replaced, slides: res.affected_slides })
      onReplaced?.(res.affected_slides)
      const pal = await fetchFontPalette(docId)
      setFonts(pal.fonts)
      setPickedOld(null)
      setNewFont("")
    } catch (e) {
      console.error("replace-font failed:", e)
    } finally {
      setReplacing(false)
    }
  }, [docId, pickedOld, newFont, onReplaced])

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
          <span className="text-sm font-semibold text-slate-200">🔤 Font Swap</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          {/* font palette */}
          <div>
            <div className="text-[10px] text-muted uppercase tracking-widest mb-2">
              Fonts in deck ({fonts.length})
            </div>
            {loading ? (
              <div className="text-xs text-muted animate-pulse">Loading fonts…</div>
            ) : fonts.length === 0 ? (
              <div className="text-xs text-muted/50 italic">No fonts found</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {fonts.map((f) => (
                  <button
                    key={f}
                    onClick={() => { setPickedOld(f); setNewFont(f) }}
                    className={[
                      "px-2.5 py-1 rounded text-xs border transition-colors",
                      pickedOld === f
                        ? "bg-paper/30 text-paper border-paper/60"
                        : "bg-white/5 text-slate-300 border-edge hover:bg-white/10",
                    ].join(" ")}
                    style={{ fontFamily: f }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* replacement font */}
          {pickedOld && (
            <div className="space-y-2">
              <div className="text-[10px] text-muted uppercase tracking-widest">
                Replace "{pickedOld}" with:
              </div>
              <div className="flex-1 min-w-0">
                <input
                  list="font-swap-list"
                  type="text"
                  value={newFont}
                  onChange={(e) => setNewFont(e.target.value)}
                  placeholder="New font name…"
                  className="w-full text-sm bg-base border border-edge rounded px-3 py-2
                             text-slate-200 focus:outline-none focus:border-accent"
                  style={{ fontFamily: newFont || undefined }}
                />
                <datalist id="font-swap-list">
                  {[...new Set([...fonts, ...COMMON_FONTS])].sort().map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <button
                onClick={handleReplace}
                disabled={replacing || !newFont.trim() || newFont.trim() === pickedOld}
                className="w-full text-sm py-2 rounded bg-paper/20 text-paper
                           border border-paper/30 hover:bg-paper/30 transition-colors
                           disabled:opacity-40"
              >
                {replacing ? "Replacing…" : `Replace all "${pickedOld}" → "${newFont}"`}
              </button>
            </div>
          )}

          {/* result */}
          {lastResult && (
            <div className={`text-xs rounded px-3 py-2 border ${
              lastResult.replaced > 0
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-white/5 border-edge text-muted"
            }`}>
              {lastResult.replaced > 0
                ? `Replaced ${lastResult.replaced} run${lastResult.replaced !== 1 ? "s" : ""} across ${lastResult.slides.length} slide${lastResult.slides.length !== 1 ? "s" : ""} (${lastResult.slides.join(", ")})`
                : "No matching font runs found"}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
