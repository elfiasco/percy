import { useState } from "react"
import { fetchSlideTaglines } from "../../lib/studioApi"
import type { SlideTaglineEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTaglinesModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [taglines, setTaglines] = useState<SlideTaglineEntry[] | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideTaglines(docId)
      setTaglines(res.taglines)
    } catch {
      setError("Failed to generate taglines")
    } finally {
      setLoading(false)
    }
  }

  const copy = (t: SlideTaglineEntry) => {
    navigator.clipboard.writeText(t.tagline).then(() => {
      setCopied(t.slide_n)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Taglines</h2>
            <p className="text-white/40 text-xs mt-0.5">AI writes a punchy one-liner for each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Writing taglines…</p>
            </div>
          )}

          {taglines && !loading && (
            taglines.map((t) => (
              <div key={t.slide_n} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                <button onClick={() => { onJumpToSlide(t.slide_n); onClose() }}
                  className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0 w-14">
                  Slide {t.slide_n}
                </button>
                <p className="text-white/75 text-xs flex-1 leading-relaxed italic">"{t.tagline}"</p>
                <button onClick={() => copy(t)}
                  className="text-[10px] text-white/30 hover:text-white/60 transition-colors shrink-0">
                  {copied === t.slide_n ? "✓" : "copy"}
                </button>
              </div>
            ))
          )}

          {taglines === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to write taglines for each slide.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
