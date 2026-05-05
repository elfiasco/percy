import { useState, useEffect } from "react"
import { fetchClutterScores } from "../../lib/studioApi"
import type { SlideClutterPoint } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_COLOR: Record<string, string> = {
  clean:     "text-green-400 bg-green-400/10 border-green-400/25",
  moderate:  "text-yellow-400 bg-yellow-400/10 border-yellow-400/25",
  cluttered: "text-red-400 bg-red-400/10 border-red-400/25",
}

const BAR_COLOR: Record<string, string> = {
  clean: "bg-green-400/50",
  moderate: "bg-yellow-400/50",
  cluttered: "bg-red-400/60",
}

export default function ClutterScoreModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideClutterPoint[]; avg_clutter: number; cluttered_count: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchClutterScores(docId)
      .then(setData)
      .catch(() => setError("Failed to compute clutter scores"))
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
            <h2 className="text-white font-semibold text-sm">Clutter Score</h2>
            <p className="text-white/40 text-xs mt-0.5">Visual crowding and overlap per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Scoring slides…</span>
            </div>
          ) : data && (
            <>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-white/40">Avg clutter: <span className="text-white/60 font-medium">{data.avg_clutter}/10</span></span>
                {data.cluttered_count > 0 && (
                  <span className="text-red-400/70">{data.cluttered_count} cluttered slide{data.cluttered_count !== 1 ? "s" : ""}</span>
                )}
                <div className="flex gap-2 ml-auto">
                  {(["clean", "moderate", "cluttered"] as const).map((l) => (
                    <span key={l} className={`px-1.5 py-0.5 rounded border text-[10px] ${LABEL_COLOR[l]}`}>{l}</span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {data.slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-white/35 hover:text-accent transition-colors shrink-0 w-14 text-right"
                    >
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${BAR_COLOR[s.label]}`}
                        style={{ width: `${(s.clutter_score / 10) * 100}%` }}
                        title={`${s.elements} elements · ${s.overlap_in2}in² overlap`}
                      />
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 w-16 text-center ${LABEL_COLOR[s.label]}`}>{s.label}</span>
                    <span className="text-white/25 text-[10px] font-mono w-6 text-right">{s.clutter_score}</span>
                  </div>
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
