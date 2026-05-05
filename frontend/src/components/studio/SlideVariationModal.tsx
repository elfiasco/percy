import { useState } from "react"
import type { SlideVariation } from "../../lib/studioApi"
import { generateSlideVariations, insertSlideVariation } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  onClose: () => void
  onInserted: (newSlideN: number, newCount: number) => void
}

const STYLE_OPTIONS = [
  { id: "persuasive", label: "More Persuasive", icon: "🎯", desc: "Compelling language, action verbs, quantified impact" },
  { id: "concise",   label: "More Concise",    icon: "✂",  desc: "Cut to essentials, remove filler" },
  { id: "executive", label: "Executive Tone",  icon: "👔", desc: "Formal, strategic, board-ready language" },
  { id: "casual",    label: "Casual Tone",     icon: "💬", desc: "Conversational, friendly, approachable" },
]

const STYLE_COLORS: Record<string, string> = {
  persuasive: "border-orange-400/40 text-orange-300",
  concise:    "border-blue-400/40 text-blue-300",
  executive:  "border-paper/40 text-paper",
  casual:     "border-green-400/40 text-green-300",
}

const STYLE_BG: Record<string, string> = {
  persuasive: "bg-orange-400/8",
  concise:    "bg-blue-400/8",
  executive:  "bg-paper/8",
  casual:     "bg-green-400/8",
}

export default function SlideVariationModal({ docId, slideN, onClose, onInserted }: Props) {
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set(["persuasive", "concise"]))
  const [generating, setGenerating]         = useState(false)
  const [variations, setVariations]         = useState<SlideVariation[]>([])
  const [inserting, setInserting]           = useState<string | null>(null)
  const [insertedStyles, setInsertedStyles] = useState<Set<string>>(new Set())
  const [error, setError]                   = useState("")

  const toggleStyle = (id: string) => {
    setSelectedStyles((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setVariations([])
    setError("")
    setInsertedStyles(new Set())
    try {
      const r = await generateSlideVariations(docId, slideN, [...selectedStyles])
      if (r.variations.length === 0) {
        setError("No text elements found on this slide to generate variations from.")
      } else {
        setVariations(r.variations)
      }
    } catch (e) {
      setError("Failed to generate variations. Check that the backend is running and ANTHROPIC_API_KEY is set.")
      console.error("generate variations failed:", e)
    } finally {
      setGenerating(false)
    }
  }

  const handleInsert = async (variation: SlideVariation) => {
    setInserting(variation.style)
    try {
      const rewrites = variation.rewrites.map((rw) => ({ element_id: rw.element_id, text: rw.rewritten }))
      const r = await insertSlideVariation(docId, slideN, rewrites, variation.label)
      setInsertedStyles((prev) => new Set([...prev, variation.style]))
      onInserted(r.new_slide_n, r.slide_count)
    } catch (e) {
      console.error("insert variation failed:", e)
    } finally {
      setInserting(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[680px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Slide Variations</h2>
            <p className="text-white/40 text-xs mt-0.5">Rewrite slide {slideN} text in different communication styles</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* style selector */}
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Select styles to generate</p>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => toggleStyle(opt.id)}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                    selectedStyles.has(opt.id)
                      ? "border-accent/60 bg-accent/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70"
                  }`}
                >
                  <span className="text-base mt-0.5 shrink-0">{opt.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-[11px] opacity-60 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || selectedStyles.size === 0}
            className="w-full py-2.5 bg-accent hover:bg-accent/80 disabled:bg-white/10 disabled:text-white/30 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {generating
              ? "Generating…"
              : `Generate ${selectedStyles.size} Variation${selectedStyles.size !== 1 ? "s" : ""}`}
          </button>

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* results */}
          {variations.length > 0 && (
            <div className="space-y-3">
              <p className="text-white/40 text-xs uppercase tracking-wider">Generated variations — click to insert as a new slide</p>
              {variations.map((variation) => {
                const isInserted = insertedStyles.has(variation.style)
                const colorCls = STYLE_COLORS[variation.style] ?? "border-white/20 text-white/70"
                const bgCls    = STYLE_BG[variation.style]    ?? "bg-white/5"
                return (
                  <div key={variation.style} className={`rounded-lg border p-4 ${colorCls} ${bgCls}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">{variation.label}</span>
                      <button
                        onClick={() => handleInsert(variation)}
                        disabled={inserting !== null || isInserted}
                        className={`text-xs px-3 py-1 rounded-md transition-colors ${
                          isInserted
                            ? "bg-green-500/20 text-green-400 border border-green-400/30 cursor-default"
                            : "bg-white/10 hover:bg-white/20 disabled:opacity-40 border border-white/10"
                        }`}
                      >
                        {isInserted
                          ? "✓ Inserted"
                          : inserting === variation.style
                          ? "Inserting…"
                          : "Insert as Slide"}
                      </button>
                    </div>
                    {/* preview rewrites */}
                    <div className="space-y-2">
                      {variation.rewrites.slice(0, 5).map((rw, i) => (
                        <div key={i} className="text-[11px] space-y-0.5">
                          <div className="text-white/30 line-through leading-relaxed">{rw.original}</div>
                          <div className="text-white/85 leading-relaxed">{rw.rewritten}</div>
                        </div>
                      ))}
                      {variation.rewrites.length > 5 && (
                        <div className="text-[11px] text-white/30">+{variation.rewrites.length - 5} more elements</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-between items-center shrink-0">
          {insertedStyles.size > 0 ? (
            <span className="text-green-400 text-xs">
              ✓ {insertedStyles.size} variation slide{insertedStyles.size !== 1 ? "s" : ""} inserted after slide {slideN}
            </span>
          ) : <span />}
          <button
            onClick={onClose}
            className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
