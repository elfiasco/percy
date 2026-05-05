import { useState } from "react"
import { diffSlides } from "../../lib/studioApi"
import type { SlideDiffOp } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideDiffModal({ docId, slideCount, currentSlide, onClose, onJumpToSlide }: Props) {
  const [slideA, setSlideA] = useState(currentSlide)
  const [slideB, setSlideB] = useState(Math.min(currentSlide + 1, slideCount))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    diff: SlideDiffOp[]
    added_words: number
    removed_words: number
    similarity_pct: number
    word_count_a: number
    word_count_b: number
  } | null>(null)
  const [error, setError] = useState("")

  const handleDiff = async () => {
    if (slideA === slideB) {
      setError("Select two different slides to compare")
      return
    }
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const r = await diffSlides(docId, slideA, slideB)
      setResult(r)
    } catch {
      setError("Failed to compute diff")
    } finally {
      setLoading(false)
    }
  }

  const slideNums = Array.from({ length: slideCount }, (_, i) => i + 1)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Text Diff</h2>
            <p className="text-white/40 text-xs mt-0.5">Compare text content between any two slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* slide picker */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-white/40 text-[10px] uppercase tracking-wider block mb-1">Slide A (base)</label>
              <div className="flex items-center gap-2">
                <select
                  value={slideA}
                  onChange={(e) => setSlideA(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/15 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-accent/50"
                >
                  {slideNums.map((n) => <option key={n} value={n}>Slide {n}</option>)}
                </select>
                <button
                  onClick={() => { onJumpToSlide(slideA) }}
                  className="text-xs text-white/40 hover:text-white/70 px-2 py-1.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                  title="Jump to this slide"
                >↗</button>
              </div>
            </div>

            <div className="text-white/30 pt-5">vs</div>

            <div className="flex-1">
              <label className="text-white/40 text-[10px] uppercase tracking-wider block mb-1">Slide B (compare)</label>
              <div className="flex items-center gap-2">
                <select
                  value={slideB}
                  onChange={(e) => setSlideB(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/15 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-accent/50"
                >
                  {slideNums.map((n) => <option key={n} value={n}>Slide {n}</option>)}
                </select>
                <button
                  onClick={() => { onJumpToSlide(slideB) }}
                  className="text-xs text-white/40 hover:text-white/70 px-2 py-1.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                  title="Jump to this slide"
                >↗</button>
              </div>
            </div>
          </div>

          <button
            onClick={handleDiff}
            disabled={loading || slideA === slideB}
            className="w-full py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
          >
            {loading ? "Computing diff…" : "Compare Slides"}
          </button>

          {result && (
            <>
              {/* stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center">
                  <div className="text-white font-mono font-semibold text-lg">{result.similarity_pct}%</div>
                  <div className="text-white/30 text-[10px]">similar</div>
                </div>
                <div className="bg-green-400/5 border border-green-400/15 rounded-lg px-3 py-2 text-center">
                  <div className="text-green-400 font-mono font-semibold text-lg">+{result.added_words}</div>
                  <div className="text-white/30 text-[10px]">added</div>
                </div>
                <div className="bg-red-400/5 border border-red-400/15 rounded-lg px-3 py-2 text-center">
                  <div className="text-red-400 font-mono font-semibold text-lg">-{result.removed_words}</div>
                  <div className="text-white/30 text-[10px]">removed</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/60 font-mono text-sm">{result.word_count_a}→{result.word_count_b}</div>
                  <div className="text-white/30 text-[10px]">word count</div>
                </div>
              </div>

              {/* diff view */}
              <div className="bg-black/30 border border-white/10 rounded-lg p-4 max-h-[40vh] overflow-y-auto font-mono text-sm leading-relaxed">
                {result.diff.length === 0 ? (
                  <span className="text-white/30">Slides have no text content</span>
                ) : (
                  <p className="text-wrap">
                    {result.diff.map((op, i) => {
                      if (op.type === "equal") return <span key={i} className="text-white/60">{op.text} </span>
                      if (op.type === "added") return <mark key={i} className="bg-green-500/25 text-green-300 rounded px-0.5 not-italic">{op.text} </mark>
                      if (op.type === "removed") return <del key={i} className="bg-red-500/20 text-red-300/70 rounded px-0.5">{op.text} </del>
                      return null
                    })}
                  </p>
                )}
              </div>

              <div className="flex gap-3 text-[10px] text-white/30">
                <span className="flex items-center gap-1.5"><mark className="bg-green-500/25 text-green-300 px-1 rounded not-italic">text</mark> Added in Slide B</span>
                <span className="flex items-center gap-1.5"><del className="bg-red-500/20 text-red-300/70 px-1 rounded">text</del> Removed from Slide A</span>
                <span className="flex items-center gap-1.5 text-white/20">unchanged text</span>
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
