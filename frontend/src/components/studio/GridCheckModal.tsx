import { useState, useEffect } from "react"
import { fetchGridCheck } from "../../lib/studioApi"
import type { GridSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function GridCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [gridSize, setGridSize] = useState(0.25)
  const [data, setData]       = useState<{ slides: GridSlide[]; total: number; grid_size: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async (g: number) => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchGridCheck(docId, g))
    } catch {
      setError("Failed to run grid check")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run(gridSize) }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Grid Alignment Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Find elements not snapped to the grid</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Grid size:</span>
            {[0.1, 0.25, 0.5, 1.0].map((g) => (
              <button key={g} onClick={() => { setGridSize(g); run(g) }}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${gridSize === g ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >{g}"</button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Checking grid…</span>
            </div>
          ) : data && (
            data.total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                All elements are snapped to the {data.grid_size}" grid.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/70 text-xs">
                  {data.total} element{data.total !== 1 ? "s" : ""} off-grid across {data.slides.length} slide{data.slides.length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-2">
                  {data.slides.map((s) => (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors"
                        >Slide {s.slide_n}</button>
                        <span className="text-white/25 text-xs ml-auto">{s.count} element{s.count !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="divide-y divide-white/5">
                        {s.off_grid.map((el, i) => (
                          <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                            <span className="text-white/45 flex-1 truncate">{el.label}</span>
                            <span className="text-white/25 font-mono text-[10px] shrink-0">({el.left}", {el.top}") → ({el.snap_left}", {el.snap_top}")</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
