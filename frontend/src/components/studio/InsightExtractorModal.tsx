import { useState } from "react"
import { fetchInsightExtractor } from "../../lib/studioApi"
import type { InsightEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const categoryLabel: Record<InsightEntry["category"], { label: string; color: string }> = {
  stat:     { label: "Stat",     color: "text-blue-400 border-blue-400/20 bg-blue-400/8" },
  claim:    { label: "Claim",    color: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8" },
  action:   { label: "Action",   color: "text-green-400 border-green-400/20 bg-green-400/8" },
  metaphor: { label: "Metaphor", color: "text-paper border-paper/20 bg-paper/8" },
  quote:    { label: "Quote",    color: "text-accent border-accent/20 bg-accent/8" },
}

const impactColor = (n: number) =>
  n >= 8 ? "text-green-400" : n >= 5 ? "text-yellow-400" : "text-white/40"

export default function InsightExtractorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<InsightEntry[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchInsightExtractor(docId)
      setInsights(res.insights)
    } catch {
      setError("Failed to extract insights")
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
            <h2 className="text-white font-semibold text-sm">Insight Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI surfaces the most quotable, high-impact moments in your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting insights…</p>
            </div>
          )}

          {insights && !loading && (
            <div className="space-y-2">
              {insights.map((insight, i) => {
                const cat = categoryLabel[insight.category] ?? { label: insight.category, color: "text-white/40 border-white/10 bg-white/5" }
                return (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(insight.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                        Slide {insight.slide_n}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${cat.color}`}>{cat.label}</span>
                      <span className={`ml-auto text-xs font-bold ${impactColor(insight.impact)}`}>{insight.impact}/10</span>
                    </div>
                    <p className="text-white/80 text-xs leading-relaxed">"{insight.quote}"</p>
                  </div>
                )
              })}
              {insights.length === 0 && <div className="text-white/30 text-xs text-center py-4">No insights found.</div>}
            </div>
          )}

          {insights === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Extract" to find the best insights in your deck.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
