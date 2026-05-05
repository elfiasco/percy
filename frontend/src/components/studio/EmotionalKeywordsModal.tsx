import { useState, useEffect } from "react"
import { fetchEmotionalKeywords } from "../../lib/studioApi"
import type { EmotionalHit } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const CAT_COLOR: Record<string, string> = {
  urgency:    "text-red-400 bg-red-400/10 border-red-400/20",
  trust:      "text-blue-400 bg-blue-400/10 border-blue-400/20",
  excitement: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  fear:       "text-orange-400 bg-orange-400/10 border-orange-400/20",
  growth:     "text-green-400 bg-green-400/10 border-green-400/20",
}

export default function EmotionalKeywordsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ hits: EmotionalHit[]; total: number; by_category: Record<string, number> } | null>(null)
  const [filter, setFilter]     = useState<string>("all")
  const [error, setError]       = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchEmotionalKeywords(docId))
    } catch {
      setError("Failed to scan emotional keywords")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const hits = data ? (filter === "all" ? data.hits : data.hits.filter(h => h.category === filter)) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Emotional Keywords</h2>
            <p className="text-white/40 text-xs mt-0.5">Highlight emotionally-charged language by category</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning keywords…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFilter("all")}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${filter === "all" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                  All ({data.total})
                </button>
                {Object.entries(data.by_category).map(([cat, cnt]) => (
                  <button key={cat} onClick={() => setFilter(cat)}
                    className={`px-2 py-0.5 rounded text-xs border capitalize transition-colors ${filter === cat ? `${CAT_COLOR[cat] ?? "text-white/60 bg-white/5 border-white/10"}` : "bg-white/5 border-white/10 text-white/40"}`}>
                    {cat} ({cnt})
                  </button>
                ))}
              </div>

              {hits.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No matches in this category.</div>
              ) : (
                <div className="space-y-1.5">
                  {hits.map((h, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { onJumpToSlide(h.slide_n); onClose() }}
                          className="text-[10px] text-accent/60 hover:text-accent transition-colors">
                          Slide {h.slide_n}
                        </button>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${CAT_COLOR[h.category] ?? "text-white/50 bg-white/5 border-white/10"}`}>
                          {h.category}
                        </span>
                        <div className="flex gap-1 ml-auto">
                          {h.matched_words.map((w) => (
                            <span key={w} className="text-[10px] font-mono text-white/40 bg-white/5 px-1 rounded">{w}</span>
                          ))}
                        </div>
                      </div>
                      <p className="text-white/50 text-xs leading-relaxed truncate">{h.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>
    </div>
  )
}
