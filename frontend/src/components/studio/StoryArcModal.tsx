import { useState } from "react"
import { fetchStoryArc } from "../../lib/studioApi"
import type { StoryArcSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const STAGE_COLOR: Record<string, string> = {
  hook:       "bg-yellow-400/15 border-yellow-400/25 text-yellow-300",
  context:    "bg-blue-400/15 border-blue-400/25 text-blue-300",
  problem:    "bg-red-400/15 border-red-400/25 text-red-300",
  solution:   "bg-green-400/15 border-green-400/25 text-green-300",
  evidence:   "bg-teal-400/15 border-teal-400/25 text-teal-300",
  objection:  "bg-orange-400/15 border-orange-400/25 text-orange-300",
  resolution: "bg-paper/15 border-paper/25 text-paper",
  cta:        "bg-accent/15 border-accent/25 text-accent",
  other:      "bg-white/5 border-white/10 text-white/40",
}

export default function StoryArcModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [arc, setArc]         = useState<StoryArcSlide[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchStoryArc(docId)
      setArc(res.arc)
    } catch {
      setError("Failed to analyze story arc")
    } finally {
      setLoading(false)
    }
  }

  const stageCounts = arc ? arc.reduce((acc, s) => { acc[s.stage] = (acc[s.stage] ?? 0) + 1; return acc }, {} as Record<string, number>) : {}

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Story Arc</h2>
            <p className="text-white/40 text-xs mt-0.5">AI maps each slide to a narrative stage</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping story arc…</p>
            </div>
          )}

          {arc && !loading && (
            <>
              {Object.keys(stageCounts).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(stageCounts).map(([stage, cnt]) => (
                    <span key={stage} className={`text-[10px] px-2 py-0.5 rounded border capitalize ${STAGE_COLOR[stage] ?? STAGE_COLOR.other}`}>
                      {stage} × {cnt}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                {arc.map((s) => (
                  <button
                    key={s.slide_n}
                    onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2 hover:bg-white/5 text-left transition-colors"
                  >
                    <span className="text-white/25 text-xs w-10 shrink-0 text-right">#{s.slide_n}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${STAGE_COLOR[s.stage] ?? STAGE_COLOR.other}`}>
                      {s.stage}
                    </span>
                    <span className="text-white/55 text-xs truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {arc === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to map your deck's narrative.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
