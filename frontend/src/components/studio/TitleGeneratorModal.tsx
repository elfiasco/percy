import { useState } from "react"
import { generateTitles } from "../../lib/studioApi"
import type { TitleGenerationResult } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (affected: number[]) => void
}

const TONE_OPTIONS = [
  { key: "professional", label: "Professional" },
  { key: "concise",      label: "Concise" },
  { key: "engaging",     label: "Engaging" },
  { key: "formal",       label: "Formal" },
  { key: "casual",       label: "Casual" },
]

export default function TitleGeneratorModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [tone, setTone]           = useState("professional")
  const [scope, setScope]         = useState<"all" | "current">("all")
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState("")
  const [results, setResults]     = useState<TitleGenerationResult[] | null>(null)
  const [applied, setApplied]     = useState(false)

  const preview = async () => {
    setLoading(true)
    setError("")
    setApplied(false)
    try {
      const slides = scope === "current" ? [currentSlide] : undefined
      const r = await generateTitles(docId, slides, tone, false)
      setResults(r.results)
    } catch {
      setError("Failed to generate titles")
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    setLoading(true)
    setError("")
    try {
      const slides = scope === "current" ? [currentSlide] : undefined
      const r = await generateTitles(docId, slides, tone, true)
      setResults(r.results)
      setApplied(true)
      onApplied(r.affected_slides)
    } catch {
      setError("Failed to apply titles")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Slide Title Generator</h2>
            <p className="text-white/40 text-xs mt-0.5">Rewrite or fill in missing slide titles with AI</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}
          {applied && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Titles applied to {results?.length} slide{results?.length !== 1 ? "s" : ""}.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Tone</label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTone(t.key)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${tone === t.key ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Scope</label>
            <div className="flex gap-2">
              {(["all", "current"] as const).map((s) => (
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

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Generating titles…</span>
            </div>
          )}

          {results && !loading && (
            <div className="space-y-1.5">
              <div className="text-white/40 text-xs font-medium">Preview</div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white/30 text-[10px] w-12 shrink-0">Slide {r.slide_n}</span>
                      {!r.has_title_el && <span className="text-yellow-400/70 text-[10px]">(no title element)</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-white/25 text-[10px] mb-0.5">Before</div>
                        <div className="text-white/40 text-xs">{r.original || "(empty)"}</div>
                      </div>
                      <div>
                        <div className="text-accent/50 text-[10px] mb-0.5">After</div>
                        <div className="text-white/80 text-xs">{r.new_title}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            <button
              onClick={preview}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/90 disabled:opacity-40 transition-colors"
            >
              Preview
            </button>
            <button
              onClick={apply}
              disabled={loading || applied}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {applied ? "Applied ✓" : "Generate & Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
