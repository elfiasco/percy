import { useState, useEffect } from "react"
import { fetchKeywords } from "../../lib/studioApi"
import type { DeckKeyword } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function KeywordCloudModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [keywords, setKeywords] = useState<DeckKeyword[]>([])
  const [meta, setMeta]         = useState<{ slide_count: number; total_words: number } | null>(null)
  const [selected, setSelected] = useState<DeckKeyword | null>(null)
  const [view, setView]         = useState<"cloud" | "table">("cloud")
  const [error, setError]       = useState("")

  useEffect(() => {
    fetchKeywords(docId, 40)
      .then((r) => {
        setKeywords(r.keywords)
        setMeta({ slide_count: r.slide_count, total_words: r.total_words })
      })
      .catch(() => setError("Failed to extract keywords"))
      .finally(() => setLoading(false))
  }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxScore = keywords.length > 0 ? keywords[0].score : 1
  const minScore = keywords.length > 0 ? keywords[keywords.length - 1].score : 0

  const fontSize = (score: number) => {
    if (maxScore === minScore) return 18
    const normalized = (score - minScore) / (maxScore - minScore)
    return Math.round(11 + normalized * 22)
  }

  const opacity = (score: number) => {
    if (maxScore === minScore) return 0.8
    const normalized = (score - minScore) / (maxScore - minScore)
    return 0.4 + normalized * 0.6
  }

  const ACCENT_COLORS = [
    "#818cf8", "#34d399", "#f59e0b", "#60a5fa", "#a78bfa",
    "#fb923c", "#38bdf8", "#4ade80", "#facc15", "#f472b6",
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Keyword Cloud</h2>
            <p className="text-white/40 text-xs mt-0.5">
              {meta ? `Top themes across ${meta.slide_count} slides · ${meta.total_words.toLocaleString()} words` : "Analyzing deck…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white/5 border border-white/10 rounded-lg overflow-hidden text-xs">
              <button
                onClick={() => setView("cloud")}
                className={`px-3 py-1.5 transition-colors ${view === "cloud" ? "bg-accent/20 text-accent" : "text-white/50 hover:text-white"}`}
              >
                Cloud
              </button>
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 transition-colors ${view === "table" ? "bg-accent/20 text-accent" : "text-white/50 hover:text-white"}`}
              >
                Table
              </button>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting keywords…</p>
            </div>
          )}

          {!loading && keywords.length === 0 && (
            <div className="text-center py-10 text-white/30 text-sm">No significant keywords found in deck</div>
          )}

          {!loading && keywords.length > 0 && view === "cloud" && (
            <div className="bg-black/20 border border-white/8 rounded-xl p-5 min-h-[200px] flex flex-wrap gap-x-3 gap-y-2 items-center justify-center">
              {keywords.map((kw, i) => (
                <button
                  key={kw.word}
                  onClick={() => setSelected(selected?.word === kw.word ? null : kw)}
                  className={`transition-all rounded px-1 py-0.5 ${selected?.word === kw.word ? "bg-accent/20 outline outline-1 outline-accent/50" : "hover:bg-white/10"}`}
                  style={{
                    fontSize: fontSize(kw.score),
                    color: ACCENT_COLORS[i % ACCENT_COLORS.length],
                    opacity: opacity(kw.score),
                    fontWeight: kw.score > maxScore * 0.5 ? 600 : 400,
                  }}
                  title={`"${kw.word}" — ${kw.count} occurrences on ${kw.slide_count} slide${kw.slide_count !== 1 ? "s" : ""}`}
                >
                  {kw.word}
                </button>
              ))}
            </div>
          )}

          {selected && view === "cloud" && (
            <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold text-sm">"{selected.word}"</span>
                <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/60 text-xs">×</button>
              </div>
              <div className="flex gap-4 text-white/50 text-xs">
                <span>{selected.count} occurrences</span>
                <span>{selected.slide_count} slide{selected.slide_count !== 1 ? "s" : ""}</span>
                <span>score: {selected.score.toFixed(1)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.slides.map((n) => (
                  <button
                    key={n}
                    onClick={() => { onJumpToSlide(n); onClose() }}
                    className="text-xs px-2 py-0.5 rounded border border-accent/25 text-accent/70 hover:text-accent hover:bg-accent/10 transition-colors"
                  >
                    Slide {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && keywords.length > 0 && view === "table" && (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_5rem_4rem_4rem] text-[10px] text-white/25 uppercase tracking-wider px-2 pb-1">
                <span>Keyword</span>
                <span className="text-right">Frequency</span>
                <span className="text-right">Slides</span>
                <span className="text-right">Score</span>
              </div>
              {keywords.map((kw, i) => (
                <button
                  key={kw.word}
                  onClick={() => setSelected(selected?.word === kw.word ? null : kw)}
                  className={`w-full grid grid-cols-[1fr_5rem_4rem_4rem] items-center px-2 py-2 rounded-lg text-sm transition-colors ${selected?.word === kw.word ? "bg-accent/10 border border-accent/20" : "hover:bg-white/5"}`}
                >
                  <span
                    className="text-left font-medium"
                    style={{ color: ACCENT_COLORS[i % ACCENT_COLORS.length] }}
                  >
                    {kw.word}
                  </span>
                  <span className="text-right text-white/50 text-xs">{kw.count}×</span>
                  <span className="text-right text-white/50 text-xs">{kw.slide_count}</span>
                  <span className="text-right text-white/30 text-[11px] font-mono">{kw.score.toFixed(1)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
