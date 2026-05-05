import { useState, useEffect } from "react"
import { fetchTextStats } from "../../lib/studioApi"
import type { SlideTextStats } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TextStatsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideTextStats[]; deck_word_count: number; deck_unique_words: number; slide_count: number; avg_words_per_slide: number } | null>(null)
  const [error, setError]     = useState("")
  const [sort, setSort]       = useState<"slide" | "words" | "sentences">("slide")

  useEffect(() => {
    fetchTextStats(docId)
      .then(setData)
      .catch(() => setError("Failed to load text statistics"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data
    ? [...data.slides].sort((a, b) =>
        sort === "slide" ? a.slide_n - b.slide_n
        : sort === "words" ? b.word_count - a.word_count
        : b.sentence_count - a.sentence_count
      )
    : []

  const maxWords = data ? Math.max(...data.slides.map((s) => s.word_count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[660px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Statistics</h2>
            <p className="text-white/40 text-xs mt-0.5">Word counts, sentences, and readability metrics per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing text…</p>
            </div>
          ) : data && (
            <>
              {/* Deck totals */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Total words", value: data.deck_word_count },
                  { label: "Unique words", value: data.deck_unique_words },
                  { label: "Avg / slide", value: data.avg_words_per_slide },
                  { label: "Slides", value: data.slide_count },
                ].map((m) => (
                  <div key={m.label} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                    <div className="text-white/80 font-semibold">{m.value}</div>
                    <div className="text-white/35 text-xs mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-white/40 text-xs">Sort by:</span>
                {(["slide", "words", "sentences"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${sort === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    {s === "slide" ? "Slide #" : s}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {/* Header */}
                <div className="grid grid-cols-[60px_1fr_50px_60px_65px_65px] gap-2 px-3 text-white/25 text-[10px]">
                  <span>Slide</span>
                  <span>Words</span>
                  <span className="text-right">Words</span>
                  <span className="text-right">Sents</span>
                  <span className="text-right">Avg len</span>
                  <span className="text-right">Long ≥25</span>
                </div>
                {slides.map((s) => (
                  <div key={s.slide_n} className="grid grid-cols-[60px_1fr_50px_60px_65px_65px] gap-2 items-center bg-white/3 border border-white/8 rounded-lg px-3 py-1.5">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors text-left"
                    >
                      Slide {s.slide_n}
                    </button>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/40"
                        style={{ width: `${(s.word_count / maxWords) * 100}%` }}
                      />
                    </div>
                    <span className="text-white/50 text-xs font-mono text-right">{s.word_count}</span>
                    <span className="text-white/40 text-xs font-mono text-right">{s.sentence_count}</span>
                    <span className="text-white/40 text-xs font-mono text-right">{s.avg_sentence_length}w</span>
                    <span className={`text-xs font-mono text-right ${s.long_sentences > 0 ? "text-yellow-400" : "text-white/25"}`}>
                      {s.long_sentences}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
