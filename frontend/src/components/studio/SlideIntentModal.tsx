import { useState } from "react"
import { fetchSlideIntent } from "../../lib/studioApi"
import type { SlideIntentEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const INTENT_COLORS: Record<string, string> = {
  inform:       "text-blue-300 bg-blue-400/8 border-blue-400/20",
  persuade:     "text-orange-300 bg-orange-400/8 border-orange-400/20",
  inspire:      "text-yellow-300 bg-yellow-400/8 border-yellow-400/20",
  demonstrate:  "text-cyan-300 bg-cyan-400/8 border-cyan-400/20",
  summarize:    "text-paper bg-paper/8 border-paper/20",
  introduce:    "text-green-300 bg-green-400/8 border-green-400/20",
  transition:   "text-white/40 bg-white/5 border-white/10",
  conclude:     "text-red-300 bg-red-400/8 border-red-400/20",
  "call-to-action": "text-accent bg-accent/8 border-accent/20",
  engage:       "text-pink-300 bg-pink-400/8 border-pink-400/20",
}

export default function SlideIntentModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ slides: SlideIntentEntry[]; intent_distribution: Record<string, number> } | null>(null)
  const [error, setError]     = useState("")
  const [filterIntent, setFilterIntent] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchSlideIntent(docId))
    } catch {
      setError("Failed to map slide intents")
    } finally {
      setLoading(false)
    }
  }

  const slides = data ? (filterIntent ? data.slides.filter(s => s.intent === filterIntent) : data.slides) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Intent Map</h2>
            <p className="text-white/40 text-xs mt-0.5">AI assigns communicative intent to each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping intents…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFilterIntent("")}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${!filterIntent ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                  All
                </button>
                {Object.entries(data.intent_distribution).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                  <button key={intent} onClick={() => setFilterIntent(intent === filterIntent ? "" : intent)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filterIntent === intent ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {intent} ({count})
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${INTENT_COLORS[s.intent] ?? "text-white/40 bg-white/5 border-white/10"}`}>{s.intent}</span>
                    <span className={`text-[10px] shrink-0 ${s.confidence === "high" ? "text-green-400/50" : s.confidence === "medium" ? "text-yellow-400/50" : "text-white/25"}`}>{s.confidence}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Map" to assign intent to each slide.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Mapping…" : "Map"}
          </button>
        </div>
      </div>
    </div>
  )
}
