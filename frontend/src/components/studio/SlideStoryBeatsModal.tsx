import { useState } from "react"
import { fetchSlideStoryBeats } from "../../lib/studioApi"
import type { StoryBeatEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const beatColor = (beat: string) => {
  const map: Record<string, string> = {
    setup:    "text-blue-400 border-blue-400/20 bg-blue-400/8",
    problem:  "text-red-400 border-red-400/20 bg-red-400/8",
    evidence: "text-cyan-400 border-cyan-400/20 bg-cyan-400/8",
    pivot:    "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
    solution: "text-green-400 border-green-400/20 bg-green-400/8",
    benefit:  "text-emerald-400 border-emerald-400/20 bg-emerald-400/8",
    proof:    "text-paper border-paper/20 bg-paper/8",
    objection:"text-orange-400 border-orange-400/20 bg-orange-400/8",
    close:    "text-accent border-accent/20 bg-accent/8",
    cta:      "text-pink-400 border-pink-400/20 bg-pink-400/8",
    context:  "text-white/40 border-white/10 bg-white/5",
  }
  return map[beat.toLowerCase()] ?? "text-white/40 border-white/10 bg-white/5"
}

export default function SlideStoryBeatsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [beats, setBeats] = useState<StoryBeatEntry[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideStoryBeats(docId)
      setBeats(res.beats)
    } catch {
      setError("Failed to analyze story beats")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Story Beats</h2>
            <p className="text-white/40 text-xs mt-0.5">AI labels each slide with its narrative role</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing story structure…</p>
            </div>
          )}

          {beats && !loading && (
            beats.map((b) => (
              <div key={b.slide_n} className="flex items-start gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                <button onClick={() => { onJumpToSlide(b.slide_n); onClose() }}
                  className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0 w-14 text-left">
                  Slide {b.slide_n}
                </button>
                <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${beatColor(b.beat)}`}>{b.beat}</span>
                <p className="text-white/55 text-xs leading-relaxed">{b.description}</p>
              </div>
            ))
          )}

          {beats !== null && beats.length === 0 && !loading && (
            <div className="text-white/30 text-xs text-center py-4">No story beats identified.</div>
          )}

          {beats === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to map the narrative story beats.</div>
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
