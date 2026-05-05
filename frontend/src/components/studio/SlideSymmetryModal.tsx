import { useState, useEffect } from "react"
import { fetchSlideSymmetry } from "../../lib/studioApi"
import type { SlideSymmetryEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const balanceColor = (b: SlideSymmetryEntry["balance"]) => ({
  balanced:     "text-green-400 border-green-400/20 bg-green-400/8",
  "left-heavy": "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  "right-heavy":"text-blue-400 border-blue-400/20 bg-blue-400/8",
})[b]

export default function SlideSymmetryModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides: SlideSymmetryEntry[]; imbalanced_count: number } | null>(null)
  const [error, setError] = useState("")
  const [showOnly, setShowOnly] = useState<"all" | "imbalanced">("all")

  useEffect(() => {
    setLoading(true)
    fetchSlideSymmetry(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze slide symmetry"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (showOnly === "imbalanced" ? data.slides.filter(s => s.balance !== "balanced") : data.slides)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Symmetry</h2>
            <p className="text-white/40 text-xs mt-0.5">Left/right content balance per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing symmetry…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Imbalanced: <span className="text-yellow-400">{data.imbalanced_count}</span></span>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setShowOnly("all")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${showOnly === "all" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>All</button>
                  <button onClick={() => setShowOnly("imbalanced")}
                    className={`px-3 py-1 rounded border text-xs transition-colors ${showOnly === "imbalanced" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400" : "bg-white/5 border-white/10 text-white/40"}`}>Imbalanced</button>
                </div>
              </div>

              <div className="space-y-1.5">
                {filtered.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                    <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden flex">
                      <div className="h-full bg-yellow-400/40" style={{ width: `${s.left_pct}%` }} />
                      <div className="h-full bg-blue-400/40" style={{ width: `${s.right_pct}%` }} />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${balanceColor(s.balance)}`}>{s.balance}</span>
                    <span className="text-[10px] text-white/30 w-12 text-right shrink-0">±{s.diff}%</span>
                  </button>
                ))}
              </div>
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
