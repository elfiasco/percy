import { useState } from "react"
import { summarizeSlides } from "../../lib/studioApi"
import type { SlideSummary } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied: () => void
}

export default function SlideSummarizerModal({ docId, onClose, onApplied }: Props) {
  const [loading, setLoading]     = useState(false)
  const [summaries, setSummaries] = useState<SlideSummary[] | null>(null)
  const [error, setError]         = useState("")
  const [applied, setApplied]     = useState(false)

  const run = async (applyToNotes = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await summarizeSlides(docId, applyToNotes)
      setSummaries(r.summaries)
      if (applyToNotes) {
        setApplied(true)
        onApplied()
      }
    } catch {
      setError("Failed to generate summaries")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Slide Summarizer</h2>
            <p className="text-white/40 text-xs mt-0.5">One-sentence summary per slide — preview or add to notes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {applied && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Summaries prepended to speaker notes on all slides.
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Summarizing slides… (one AI call per slide)</p>
            </div>
          )}

          {summaries && !loading && (
            <div className="space-y-1.5">
              {summaries.map((s) => (
                <div key={s.slide_n} className="flex gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                  <span className="text-white/30 text-xs shrink-0 w-14 text-right pt-0.5">Slide {s.slide_n}</span>
                  <p className="text-white/65 text-xs leading-relaxed">{s.summary}</p>
                </div>
              ))}
            </div>
          )}

          {summaries === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Generate" to summarize all slides.</p>
              <p className="text-xs mt-1 opacity-60">May take a moment for large decks.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            <button
              onClick={() => run(false)}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/90 disabled:opacity-40 transition-colors"
            >
              Preview
            </button>
            <button
              onClick={() => run(true)}
              disabled={loading || applied}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {applied ? "Applied ✓" : "Add to Notes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
