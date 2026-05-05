import { useState } from "react"
import { fetchSectionTitleSuggestions } from "../../lib/studioApi"
import type { SectionTitleSuggestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SectionTitleModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<SectionTitleSuggestion[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchSectionTitleSuggestions(docId)
      setData(r.suggestions)
    } catch {
      setError("Failed to suggest section titles")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Section Title Optimizer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI suggests more impactful slide titles</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing titles…</p>
            </div>
          )}

          {data !== null && !loading && (
            data.length === 0 ? (
              <div className="text-green-400/80 text-xs text-center py-8">All slide titles look great — no improvements needed.</div>
            ) : (
              <div className="space-y-2">
                {data.map((s, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-2">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors"
                    >
                      Slide {s.slide_n}
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-white/25 text-[10px] uppercase tracking-wide mb-1">Current</p>
                        <p className="text-white/55 text-sm">{s.current}</p>
                      </div>
                      <div>
                        <p className="text-accent/50 text-[10px] uppercase tracking-wide mb-1">Suggested</p>
                        <p className="text-white/75 text-sm font-medium">{s.suggested}</p>
                      </div>
                    </div>
                    {s.reason && <p className="text-white/30 text-xs">{s.reason}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Suggest" to get AI-powered title improvements.
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
            {loading ? "Analyzing…" : "Suggest"}
          </button>
        </div>
      </div>
    </div>
  )
}
