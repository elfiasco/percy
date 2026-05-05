import { useState, useEffect } from "react"
import type { SimilarSlidesPair } from "../../lib/studioApi"
import { findSimilarSlides } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SimilarSlidesModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [pairs, setPairs]       = useState<SimilarSlidesPair[]>([])
  const [total, setTotal]       = useState(0)
  const [threshold, setThreshold] = useState(0.55)
  const [error, setError]       = useState("")

  const load = (t = threshold) => {
    setLoading(true)
    setError("")
    findSimilarSlides(docId, t)
      .then((r) => { setPairs(r.pairs); setTotal(r.total_slides) })
      .catch(() => setError("Failed to analyze slides."))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const THRESHOLDS = [
    { label: "Very Similar (≥80%)", value: 0.80 },
    { label: "Similar (≥65%)",      value: 0.65 },
    { label: "Somewhat Similar (≥50%)", value: 0.50 },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Similar Slide Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Find potential duplicate or near-duplicate slides across {total} slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {/* threshold selector */}
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Similarity threshold</p>
            <div className="flex gap-2 flex-wrap">
              {THRESHOLDS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => { setThreshold(t.value); load(t.value) }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    threshold === t.value
                      ? "border-accent/60 bg-accent/10 text-white"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-10 text-white/40">
              <span className="animate-pulse">Analyzing…</span>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!loading && pairs.length === 0 && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-green-400 text-sm font-medium">No similar slides found</p>
              <p className="text-white/30 text-xs mt-1">All slides appear unique at this threshold</p>
            </div>
          )}

          {!loading && pairs.length > 0 && (
            <div className="space-y-2">
              <p className="text-amber-400/80 text-xs">
                Found {pairs.length} pair{pairs.length !== 1 ? "s" : ""} of similar slides — review them to remove duplicates
              </p>
              {pairs.map((pair, i) => {
                const pct = Math.round(pair.similarity * 100)
                const barColor = pct >= 80 ? "bg-red-500" : pct >= 65 ? "bg-amber-500" : "bg-yellow-600"
                return (
                  <div key={i} className="bg-white/[0.04] border border-white/10 rounded-lg p-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { onJumpToSlide(pair.slide_a); onClose() }}
                          className="text-xs font-mono text-accent hover:text-accent/80 bg-accent/10 px-2 py-0.5 rounded border border-accent/20"
                        >
                          Slide {pair.slide_a}
                        </button>
                        <span className="text-white/30 text-xs">↔</span>
                        <button
                          onClick={() => { onJumpToSlide(pair.slide_b); onClose() }}
                          className="text-xs font-mono text-accent hover:text-accent/80 bg-accent/10 px-2 py-0.5 rounded border border-accent/20"
                        >
                          Slide {pair.slide_b}
                        </button>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-mono font-medium ${pct >= 80 ? "text-red-400" : pct >= 65 ? "text-amber-400" : "text-yellow-500"}`}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {pair.shared_words.slice(0, 10).map((w) => (
                        <span key={w} className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">{w}</span>
                      ))}
                      {pair.shared_words.length > 10 && (
                        <span className="text-[10px] text-white/25">+{pair.shared_words.length - 10} more</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
