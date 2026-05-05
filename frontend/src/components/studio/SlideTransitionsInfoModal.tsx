import { useState, useEffect } from "react"
import { fetchSlideTransitionsInfo } from "../../lib/studioApi"
import type { SlideTransitionInfo } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTransitionsInfoModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides: SlideTransitionInfo[]; with_transition: number; without_transition: number } | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "has" | "none">("all")

  useEffect(() => {
    setLoading(true)
    fetchSlideTransitionsInfo(docId)
      .then(setData)
      .catch(() => setError("Failed to load transition info"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? filter === "has"  ? data.slides.filter(s => s.has_transition)
    : filter === "none" ? data.slides.filter(s => !s.has_transition)
    : data.slides
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Transition Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Shows which slides have explicit transitions set</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Reading transitions…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>With transition: <span className="text-green-400">{data.with_transition}</span></span>
                <span>Without: <span className="text-yellow-400">{data.without_transition}</span></span>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "has", "none"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                      filter === f ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"
                    }`}>
                    {f === "all" ? "All" : f === "has" ? "Has Transition" : "No Transition"}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {filtered.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2 hover:bg-white/5 transition-colors text-left">
                    <span className="text-xs text-white/50 w-14 shrink-0">Slide {s.slide_n}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${
                      s.has_transition
                        ? "text-green-400 border-green-400/20 bg-green-400/8"
                        : "text-white/30 border-white/10 bg-white/5"
                    }`}>
                      {s.has_transition ? "✓" : "—"}
                    </span>
                    <span className="text-xs text-white/50 truncate">{s.type}</span>
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
