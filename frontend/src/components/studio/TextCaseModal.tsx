import { useState } from "react"
import { changeTextCase } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (affectedSlides: number[]) => void
}

type CaseOption = "upper" | "lower" | "title" | "sentence"
type ScopeOption = "all" | "current"

const CASE_OPTIONS: { key: CaseOption; label: string; example: string }[] = [
  { key: "upper",    label: "UPPERCASE",     example: "HELLO WORLD" },
  { key: "lower",    label: "lowercase",     example: "hello world" },
  { key: "title",    label: "Title Case",    example: "Hello World" },
  { key: "sentence", label: "Sentence case", example: "Hello world" },
]

export default function TextCaseModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [caseOpt, setCaseOpt] = useState<CaseOption>("title")
  const [scope, setScope]     = useState<ScopeOption>("all")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")
  const [result, setResult]   = useState<{ changed: number; affected_slides: number[] } | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const slides = scope === "current" ? [currentSlide] : undefined
      const r = await changeTextCase(docId, caseOpt, slides)
      setResult(r)
      if (r.changed > 0) onApplied(r.affected_slides)
    } catch {
      setError("Failed to apply text case transformation.")
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
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Case Changer</h2>
            <p className="text-white/40 text-xs mt-0.5">Apply a case transformation to all slide text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* case selection */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Case Style</label>
            <div className="grid grid-cols-2 gap-2">
              {CASE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setCaseOpt(opt.key)}
                  className={`px-3 py-3 rounded-lg border text-left transition-colors ${caseOpt === opt.key ? "bg-accent/15 border-accent/30" : "bg-white/5 border-white/10 hover:border-white/20"}`}
                >
                  <div className={`text-sm font-medium ${caseOpt === opt.key ? "text-accent" : "text-white/80"}`}>{opt.label}</div>
                  <div className="text-white/30 text-xs mt-0.5 font-mono">{opt.example}</div>
                </button>
              ))}
            </div>
          </div>

          {/* scope */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Scope</label>
            <div className="flex gap-2">
              {(["all", "current"] as ScopeOption[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s === "all" ? `All Slides (${slideCount})` : `Current Slide (${currentSlide})`}
                </button>
              ))}
            </div>
          </div>

          {/* result */}
          {result && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${result.changed > 0 ? "text-green-400 bg-green-400/10 border-green-400/20" : "text-white/40 bg-white/5 border-white/10"}`}>
              {result.changed > 0
                ? `Applied to ${result.changed} text run${result.changed !== 1 ? "s" : ""} across ${result.affected_slides.length} slide${result.affected_slides.length !== 1 ? "s" : ""}.`
                : "No text found to transform."}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between items-center">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-4 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  )
}
