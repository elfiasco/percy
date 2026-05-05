import { useState, useEffect } from "react"
import { fetchWordCloud } from "../../lib/studioApi"
import type { WordCloudWord } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
}

const COLORS = [
  "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f87171",
  "#c084fc", "#38bdf8", "#4ade80", "#fb923c", "#e879f9",
]

export default function WordCloudModal({ docId, slideCount, currentSlide, onClose }: Props) {
  const [slideN, setSlideN]   = useState(currentSlide)
  const [topN, setTopN]       = useState(30)
  const [loading, setLoading] = useState(false)
  const [words, setWords]     = useState<WordCloudWord[] | null>(null)
  const [totalWords, setTotal] = useState(0)
  const [error, setError]     = useState("")

  const load = async (n = slideN, top = topN) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchWordCloud(docId, n, top)
      setWords(r.words)
      setTotal(r.total_words)
    } catch {
      setError("Failed to generate word cloud")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxCount = words && words.length > 0 ? words[0].count : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Word Cloud</h2>
            <p className="text-white/40 text-xs mt-0.5">Visual frequency map of words on this slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-white/60 text-xs">Slide:</label>
              <input
                type="number" min={1} max={slideCount} value={slideN}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(slideCount, parseInt(e.target.value) || 1))
                  setSlideN(v)
                  load(v, topN)
                }}
                className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-white/60 text-xs">Top:</label>
              {[20, 30, 40].map((n) => (
                <button
                  key={n}
                  onClick={() => { setTopN(n); load(slideN, n) }}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${topN === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {words !== null && <span className="text-white/25 text-xs ml-auto">{totalWords} total words</span>}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Building word cloud…</p>
            </div>
          ) : words !== null && (
            words.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-white/30">
                <p className="text-sm">No significant words found on this slide.</p>
              </div>
            ) : (
              <>
                {/* Cloud visualization */}
                <div className="bg-white/3 border border-white/8 rounded-xl p-6 flex flex-wrap gap-3 justify-center items-center min-h-[180px]">
                  {words.map((w, i) => {
                    const size = 10 + Math.round(w.weight * 24)
                    const color = COLORS[i % COLORS.length]
                    return (
                      <span
                        key={w.word}
                        className="select-none transition-opacity hover:opacity-100 font-semibold"
                        style={{ fontSize: `${size}px`, color, opacity: 0.5 + w.weight * 0.5 }}
                        title={`${w.count}×`}
                      >
                        {w.word}
                      </span>
                    )
                  })}
                </div>

                {/* Frequency table */}
                <div className="space-y-1">
                  <div className="text-white/30 text-xs font-medium">Frequency</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {words.slice(0, 15).map((w) => (
                      <div key={w.word} className="flex items-center gap-2 bg-white/3 rounded px-2 py-1">
                        <div
                          className="h-1.5 rounded-full bg-accent/50 shrink-0"
                          style={{ width: `${Math.round(w.weight * 48)}px` }}
                        />
                        <span className="text-white/60 text-xs flex-1 truncate">{w.word}</span>
                        <span className="text-white/30 text-[10px] shrink-0">{w.count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
