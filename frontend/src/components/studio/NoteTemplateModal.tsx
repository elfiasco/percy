import { useState } from "react"
import { insertNoteTemplate } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (slideN: number) => void
}

const TEMPLATES: Array<{ key: "intro" | "main" | "transition" | "cta" | "data"; label: string; desc: string }> = [
  { key: "intro",      label: "Introduction",  desc: "Opening remarks, overview, hook" },
  { key: "main",       label: "Main Point",    desc: "Key message, evidence, Q&A prep" },
  { key: "transition", label: "Transition",    desc: "Bridge between sections" },
  { key: "cta",        label: "Call to Action", desc: "The ask, timeline, next steps" },
  { key: "data",       label: "Data Slide",    desc: "Chart explanation, insight, caveats" },
]

export default function NoteTemplateModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [slideN, setSlideN]         = useState(currentSlide)
  const [template, setTemplate]     = useState<"intro" | "main" | "transition" | "cta" | "data">("main")
  const [overwrite, setOverwrite]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<string | null>(null)
  const [error, setError]           = useState("")

  const apply = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await insertNoteTemplate(docId, slideN, template, overwrite)
      setResult(r.notes)
      onApplied(slideN)
    } catch {
      setError("Failed to insert template")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Speaker Note Templates</h2>
            <p className="text-white/40 text-xs mt-0.5">Insert structured speaking frameworks into slide notes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {result && (
            <div className="bg-white/3 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-green-400 text-xs mb-1">Template applied to slide {slideN}</div>
              <pre className="text-white/50 text-[10px] leading-relaxed whitespace-pre-wrap font-mono">{result}</pre>
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

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Template type</label>
            <div className="space-y-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplate(t.key)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition-all ${template === t.key ? "bg-accent/10 border-accent/40" : "bg-white/3 border-white/10 hover:border-white/20"}`}
                >
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${template === t.key ? "text-accent" : "text-white/70"}`}>{t.label}</div>
                    <div className="text-white/30 text-xs mt-0.5">{t.desc}</div>
                  </div>
                  {template === t.key && <span className="text-accent text-sm">✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setOverwrite(!overwrite)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${overwrite ? "bg-accent/20 border-accent/50" : "bg-white/5 border-white/20"}`}
            >
              {overwrite && <span className="text-accent text-[10px]">✓</span>}
            </button>
            <span className="text-white/50 text-xs">Overwrite existing notes (default: append)</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={apply}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Applying…" : "Insert Template"}
          </button>
        </div>
      </div>
    </div>
  )
}
