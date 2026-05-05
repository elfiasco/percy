import { useState } from "react"
import { fetchAudienceJourneyMap } from "../../lib/studioApi"
import type { JourneySlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const emotionColor = (emotion: string) => {
  const map: Record<string, string> = {
    curious:   "text-cyan-400 border-cyan-400/20 bg-cyan-400/8",
    confused:  "text-orange-400 border-orange-400/20 bg-orange-400/8",
    skeptical: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
    engaged:   "text-blue-400 border-blue-400/20 bg-blue-400/8",
    excited:   "text-green-400 border-green-400/20 bg-green-400/8",
    concerned: "text-red-400 border-red-400/20 bg-red-400/8",
    relieved:  "text-emerald-400 border-emerald-400/20 bg-emerald-400/8",
    convinced: "text-accent border-accent/20 bg-accent/8",
    inspired:  "text-paper border-paper/20 bg-paper/8",
    bored:     "text-white/30 border-white/10 bg-white/5",
  }
  return map[emotion.toLowerCase()] ?? "text-white/40 border-white/10 bg-white/5"
}

export default function AudienceJourneyMapModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [journey, setJourney] = useState<JourneySlide[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchAudienceJourneyMap(docId)
      setJourney(res.journey)
    } catch {
      setError("Failed to map audience journey")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Audience Journey Map</h2>
            <p className="text-white/40 text-xs mt-0.5">AI predicts audience emotions slide-by-slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping audience journey…</p>
            </div>
          )}

          {journey && !loading && (
            journey.map((j) => (
              <button key={j.slide_n} onClick={() => { onJumpToSlide(j.slide_n); onClose() }}
                className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {j.slide_n}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${emotionColor(j.emotion)}`}>{j.emotion}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/50 rounded-full" style={{ width: `${(j.intensity / 10) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-white/30 shrink-0">{j.intensity}/10</span>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">{j.description}</p>
                </div>
              </button>
            ))
          )}

          {journey !== null && journey.length === 0 && !loading && (
            <div className="text-white/30 text-xs text-center py-4">No journey data.</div>
          )}

          {journey === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Map Journey" to analyze audience emotions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Mapping…" : "Map Journey"}
          </button>
        </div>
      </div>
    </div>
  )
}
