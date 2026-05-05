import { useState } from "react"
import { addFootnote } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onAdded: (slideN: number) => void
}

export default function FootnoteModal({ docId, slideCount, currentSlide, onClose, onAdded }: Props) {
  const [slideN, setSlideN]     = useState(currentSlide)
  const [text, setText]         = useState("")
  const [fontSize, setFontSize] = useState(8)
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)
  const [error, setError]       = useState("")

  const apply = async () => {
    if (!text.trim()) { setError("Footnote text is required"); return }
    setLoading(true)
    setError("")
    try {
      await addFootnote(docId, slideN, text.trim(), fontSize)
      setSuccess(true)
      onAdded(slideN)
    } catch {
      setError("Failed to add footnote")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold text-sm">Add Footnote</h2>
            <p className="text-white/40 text-xs mt-0.5">Insert small footnote text at the bottom of a slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}
          {success && <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">Footnote added to slide {slideN}.</div>}

          <div className="flex items-center gap-3">
            <label className="text-white/60 text-xs shrink-0">Slide:</label>
            <input
              type="number" min={1} max={slideCount} value={slideN}
              onChange={(e) => setSlideN(Math.max(1, Math.min(slideCount, parseInt(e.target.value) || 1)))}
              className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50"
            />
            <label className="text-white/60 text-xs shrink-0 ml-2">Font size:</label>
            <select
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
            >
              {[6, 7, 8, 9, 10, 11].map((n) => <option key={n} value={n}>{n}pt</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-white/60 text-xs font-medium">Footnote text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Source: Smith et al. 2024 | © Company Name"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/25 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>

          {/* Live preview */}
          <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-2">
            <div className="text-white/25 text-[10px]">Preview</div>
            <div className="bg-gray-800 rounded relative h-24 flex items-end p-2">
              <p className="text-gray-400 leading-tight" style={{ fontSize: `${fontSize * 1.2}px` }}>
                {text || "Footnote text will appear here…"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={apply}
            disabled={loading || !text.trim()}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Adding…" : "Add Footnote"}
          </button>
        </div>
      </div>
    </div>
  )
}
