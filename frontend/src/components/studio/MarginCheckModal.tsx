import { useState, useEffect } from "react"
import { fetchMarginCheck } from "../../lib/studioApi"
import type { MarginViolation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const SIDE_LABEL: Record<string, string> = {
  left: "Left edge", right: "Right edge", top: "Top edge", bottom: "Bottom edge",
}

export default function MarginCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ violations: MarginViolation[]; total: number; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [marginIn, setMarginIn] = useState(0.3)

  const run = async (m: number) => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchMarginCheck(docId, m))
    } catch {
      setError("Failed to run margin check")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run(marginIn) }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const groupedBySlide = data
    ? data.violations.reduce<Record<number, MarginViolation[]>>((acc, v) => {
        ;(acc[v.slide_n] = acc[v.slide_n] || []).push(v)
        return acc
      }, {})
    : {}

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Margin Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Find elements too close to slide edges</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* margin selector */}
          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Margin threshold:</span>
            {[0.2, 0.3, 0.4, 0.5].map((m) => (
              <button
                key={m}
                onClick={() => { setMarginIn(m); run(m) }}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${marginIn === m ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >
                {m}"
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Checking margins…</span>
            </div>
          ) : data && (
            data.total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No margin violations found — all elements are within the {marginIn}" safe zone.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/80 text-xs">
                  {data.total} violation{data.total !== 1 ? "s" : ""} across {Object.keys(groupedBySlide).length} slide{Object.keys(groupedBySlide).length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-2">
                  {Object.entries(groupedBySlide).sort(([a], [b]) => Number(a) - Number(b)).map(([slideN, viols]) => (
                    <div key={slideN} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <button
                          onClick={() => { onJumpToSlide(Number(slideN)); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors font-medium"
                        >
                          Slide {slideN}
                        </button>
                        <span className="text-white/25 text-xs ml-auto">{viols.length} element{viols.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="divide-y divide-white/5">
                        {viols.map((v, i) => (
                          <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                            <span className="text-white/50 text-xs flex-1 truncate">{v.element_name || v.element_id}</span>
                            <span className="text-yellow-400/60 text-xs shrink-0">{SIDE_LABEL[v.side] ?? v.side}</span>
                            <span className="text-white/25 text-[10px] font-mono shrink-0">{v.distance_in.toFixed(2)}"</span>
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
