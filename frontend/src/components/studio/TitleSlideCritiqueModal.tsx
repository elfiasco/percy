import { useState } from "react"
import { fetchTitleSlideCritique } from "../../lib/studioApi"
import type { TitleSlideCritique } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function TitleSlideCritiqueModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<TitleSlideCritique | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchTitleSlideCritique(docId))
    } catch {
      setError("Failed to critique title slide")
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = data
    ? data.score >= 8 ? "text-green-400" : data.score >= 5 ? "text-yellow-400" : "text-red-400"
    : ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Title Slide Critique</h2>
            <p className="text-white/40 text-xs mt-0.5">AI reviews your opening slide for impact</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing title slide…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-3xl font-bold ${scoreColor}`}>{data.score}</span>
                <span className="text-white/30 text-sm">/10</span>
                <p className="text-white/50 text-xs ml-2 italic flex-1">{data.overall}</p>
              </div>

              {data.strengths.length > 0 && (
                <div>
                  <p className="text-green-400/70 text-xs font-medium mb-1">Strengths</p>
                  <ul className="space-y-1">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="text-white/50 text-xs flex gap-2">
                        <span className="text-green-400/50 shrink-0">✓</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.weaknesses.length > 0 && (
                <div>
                  <p className="text-red-400/70 text-xs font-medium mb-1">Weaknesses</p>
                  <ul className="space-y-1">
                    {data.weaknesses.map((w, i) => (
                      <li key={i} className="text-white/50 text-xs flex gap-2">
                        <span className="text-red-400/50 shrink-0">✗</span>{w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.suggestions.length > 0 && (
                <div>
                  <p className="text-accent/70 text-xs font-medium mb-1">Suggestions</p>
                  <ul className="space-y-1">
                    {data.suggestions.map((s, i) => (
                      <li key={i} className="text-white/50 text-xs flex gap-2">
                        <span className="text-accent/50 shrink-0">→</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {!data && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Critique" to get AI feedback on your title slide.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Analyzing…" : data ? "Re-analyze" : "Critique"}
          </button>
        </div>
      </div>
    </div>
  )
}
