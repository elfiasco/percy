import { useState } from "react"
import { fetchMetaphorDensity } from "../../lib/studioApi"
import type { MetaphorEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TYPE_COLORS: Record<string, string> = {
  metaphor:        "text-paper bg-paper/8 border-paper/20",
  simile:          "text-blue-300 bg-blue-400/8 border-blue-400/20",
  personification: "text-green-300 bg-green-400/8 border-green-400/20",
  hyperbole:       "text-red-300 bg-red-400/8 border-red-400/20",
  other:           "text-white/40 bg-white/5 border-white/10",
}

export default function MetaphorDensityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(false)
  const [data, setData]         = useState<{ metaphors: MetaphorEntry[]; total: number; slides_with_metaphors: number } | null>(null)
  const [error, setError]       = useState("")
  const [filter, setFilter]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchMetaphorDensity(docId))
    } catch {
      setError("Failed to identify metaphors")
    } finally {
      setLoading(false)
    }
  }

  const metaphors = data ? (filter ? data.metaphors.filter(m => m.type === filter) : data.metaphors) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Metaphor Density</h2>
            <p className="text-white/40 text-xs mt-0.5">AI finds figurative language across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Identifying metaphors…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Total: <span className="text-white/70">{data.total}</span></span>
                <span>Slides: <span className="text-white/70">{data.slides_with_metaphors}</span></span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFilter("")}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${!filter ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                  All
                </button>
                {["metaphor", "simile", "personification", "hyperbole", "other"].map(t => (
                  <button key={t} onClick={() => setFilter(t === filter ? "" : t)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filter === t ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {t}
                  </button>
                ))}
              </div>

              {metaphors.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No metaphors match this filter.</div>
              ) : (
                <div className="space-y-2">
                  {metaphors.map((m, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <button onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                          className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {m.slide_n}</button>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${TYPE_COLORS[m.type] ?? TYPE_COLORS.other}`}>{m.type}</span>
                      </div>
                      <p className="text-white/60 text-xs leading-relaxed italic">"{m.phrase}"</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to identify figurative language.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Finding…" : "Find"}
          </button>
        </div>
      </div>
    </div>
  )
}
