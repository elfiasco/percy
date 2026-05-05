import { useState } from "react"
import { fetchDeckPersonality } from "../../lib/studioApi"
import type { DeckPersonality } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const archetypeColor: Record<string, string> = {
  authoritative: "text-blue-400 border-blue-400/25 bg-blue-400/10",
  approachable:  "text-green-400 border-green-400/25 bg-green-400/10",
  visionary:     "text-paper border-paper/25 bg-paper/10",
  analytical:    "text-cyan-400 border-cyan-400/25 bg-cyan-400/10",
  inspirational: "text-accent border-accent/25 bg-accent/10",
  urgent:        "text-red-400 border-red-400/25 bg-red-400/10",
  educational:   "text-yellow-400 border-yellow-400/25 bg-yellow-400/10",
  conversational:"text-emerald-400 border-emerald-400/25 bg-emerald-400/10",
  bold:          "text-orange-400 border-orange-400/25 bg-orange-400/10",
  subtle:        "text-white/50 border-white/15 bg-white/5",
}

export default function DeckPersonalityModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DeckPersonality | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchDeckPersonality(docId)
      setData(res)
    } catch {
      setError("Failed to analyze deck personality")
    } finally {
      setLoading(false)
    }
  }

  const color = data ? (archetypeColor[data.archetype.toLowerCase()] ?? "text-white/50 border-white/15 bg-white/5") : ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Personality</h2>
            <p className="text-white/40 text-xs mt-0.5">AI assigns an archetype and tone profile to your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing personality…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`text-sm px-3 py-1 rounded-lg border font-semibold capitalize ${color}`}>{data.archetype}</span>
                <div className="flex gap-1.5">
                  {data.tone_words.map((w, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/50 capitalize">{w}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-400/5 border border-green-400/15 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-green-400/70 font-semibold mb-1.5 uppercase tracking-wide">Strengths</p>
                  <ul className="space-y-1">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-white/60 flex gap-1.5"><span className="text-green-400/50">+</span>{s}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-red-400/5 border border-red-400/15 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-red-400/70 font-semibold mb-1.5 uppercase tracking-wide">Risks</p>
                  <ul className="space-y-1">
                    {data.risks.map((r, i) => (
                      <li key={i} className="text-xs text-white/60 flex gap-1.5"><span className="text-red-400/50">−</span>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-3">
                <p className="text-[10px] text-accent/70 font-semibold mb-1 uppercase tracking-wide">Recommendation</p>
                <p className="text-sm text-white/70 leading-relaxed">{data.recommendation}</p>
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to discover your deck's personality archetype.</div>
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
