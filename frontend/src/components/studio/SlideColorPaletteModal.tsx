import { useState, useEffect } from "react"
import { fetchSlideColorPalette } from "../../lib/studioApi"
import type { ColorPaletteResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

function ColorSwatch({ hex }: { hex: string }) {
  const display = hex.length === 6 ? `#${hex}` : hex
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: display }} />
      <span className="text-[9px] text-white/30 font-mono">{display.toLowerCase()}</span>
    </div>
  )
}

export default function SlideColorPaletteModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ColorPaletteResult | null>(null)
  const [error, setError] = useState("")
  const [view, setView] = useState<"palette" | "slides">("palette")

  useEffect(() => {
    setLoading(true)
    fetchSlideColorPalette(docId)
      .then(setData)
      .catch(() => setError("Failed to extract color palette"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Color Palette</h2>
            <p className="text-white/40 text-xs mt-0.5">Dominant fill and text colors across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting colors…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">Unique colors: <span className="text-white/70">{data.total_unique}</span></span>
                <div className="flex gap-1">
                  {(["palette", "slides"] as const).map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${view === v ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {view === "palette" && (
                <div className="space-y-2">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Top Colors</p>
                  {data.top_colors.length === 0 ? (
                    <p className="text-white/30 text-xs text-center py-4">No color data found.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {data.top_colors.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                          <div className="w-8 h-8 rounded-md border border-white/10 shrink-0" style={{ backgroundColor: `#${c.hex}` }} />
                          <div>
                            <p className="text-[10px] text-white/50 font-mono">#{c.hex.toLowerCase()}</p>
                            <p className="text-[10px] text-white/30">{c.count} use{c.count !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {view === "slides" && (
                <div className="space-y-1.5">
                  {data.per_slide.filter(s => s.colors.length > 0).map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {s.colors.slice(0, 6).map((c, i) => (
                          <div key={i} className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: `#${c}` }} title={`#${c}`} />
                        ))}
                        {s.colors.length > 6 && <span className="text-[9px] text-white/30">+{s.colors.length - 6}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
