import { useState } from "react"
import { expandNotes } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (slideN: number) => void
}

export default function NotesExpandModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [slideN, setSlideN]       = useState(currentSlide)
  const [preview, setPreview]     = useState("")
  const [original, setOriginal]   = useState("")
  const [loading, setLoading]     = useState(false)
  const [applied, setApplied]     = useState(false)
  const [error, setError]         = useState("")
  const [noNotes, setNoNotes]     = useState(false)

  const generate = async () => {
    setLoading(true)
    setError("")
    setPreview("")
    setOriginal("")
    setApplied(false)
    setNoNotes(false)
    try {
      const r = await expandNotes(docId, slideN, false)
      if (r.message && !r.expanded) {
        setNoNotes(true)
        return
      }
      setPreview(r.expanded)
      setOriginal(r.original)
    } catch {
      setError("Failed to expand notes")
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    setLoading(true)
    setError("")
    try {
      await expandNotes(docId, slideN, true)
      setApplied(true)
      onApplied(slideN)
    } catch {
      setError("Failed to apply expanded notes")
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
            <h2 className="text-white font-semibold text-sm">Speaker Notes Auto-Expand</h2>
            <p className="text-white/40 text-xs mt-0.5">AI turns brief bullet notes into full speaking paragraphs</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {applied && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Notes applied to slide {slideN}.
            </div>
          )}

          {noNotes && (
            <div className="text-yellow-400 text-xs bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2">
              Slide {slideN} has no speaker notes to expand.
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="text-white/60 text-xs shrink-0">Slide:</label>
            <input
              type="number"
              min={1}
              max={slideCount}
              value={slideN}
              onChange={(e) => setSlideN(Math.max(1, Math.min(slideCount, parseInt(e.target.value) || 1)))}
              className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50"
            />
            <span className="text-white/25 text-xs">of {slideCount}</span>
          </div>

          {original && (
            <div className="space-y-1">
              <div className="text-white/40 text-xs font-medium">Original notes</div>
              <div className="bg-white/3 border border-white/10 rounded-lg px-3 py-2 text-white/40 text-xs leading-relaxed whitespace-pre-wrap">{original}</div>
            </div>
          )}

          {preview && (
            <div className="space-y-1">
              <div className="text-white/60 text-xs font-medium">Expanded notes</div>
              <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 text-white/70 text-xs leading-relaxed whitespace-pre-wrap">{preview}</div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Expanding notes…</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/90 disabled:opacity-40 transition-colors"
            >
              Preview
            </button>
            <button
              onClick={apply}
              disabled={loading || !preview || applied}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {applied ? "Applied" : "Apply to Slide"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
