import { useState } from "react"
import { translateSlides } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onTranslated: (affectedSlides: number[]) => void
}

const LANGUAGES = [
  "Spanish", "French", "German", "Portuguese", "Italian",
  "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean",
  "Arabic", "Russian", "Dutch", "Polish", "Swedish", "Turkish",
  "Hindi", "Vietnamese", "Thai", "Indonesian", "Malay",
]

type Scope = "all" | "current" | "range"

export default function TranslateModal({ docId, slideCount, currentSlide, onClose, onTranslated }: Props) {
  const [language, setLanguage]         = useState("Spanish")
  const [customLang, setCustomLang]     = useState("")
  const [scope, setScope]               = useState<Scope>("all")
  const [rangeFrom, setRangeFrom]       = useState(1)
  const [rangeTo, setRangeTo]           = useState(slideCount)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [translating, setTranslating]   = useState(false)
  const [result, setResult]             = useState<{ translated: number; affected: number[] } | null>(null)
  const [error, setError]               = useState("")

  const targetLang = customLang.trim() || language

  const getSlideNumbers = (): number[] | null => {
    if (scope === "all") return null
    if (scope === "current") return [currentSlide]
    const from = Math.max(1, Math.min(rangeFrom, slideCount))
    const to   = Math.max(from, Math.min(rangeTo, slideCount))
    return Array.from({ length: to - from + 1 }, (_, i) => from + i)
  }

  const handleTranslate = async () => {
    setTranslating(true)
    setError("")
    setResult(null)
    try {
      const slideNumbers = getSlideNumbers()
      const r = await translateSlides(docId, targetLang, slideNumbers, includeNotes)
      setResult({ translated: r.translated, affected: r.affected_slides })
      onTranslated(r.affected_slides)
    } catch (e) {
      setError("Translation failed. Check that the backend is running and ANTHROPIC_API_KEY is set.")
      console.error("translate failed:", e)
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Slide Translation</h2>
            <p className="text-white/40 text-xs mt-0.5">Translate slide text to another language via Claude</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* language picker */}
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">Target language</label>
            <select
              value={language}
              onChange={(e) => { setLanguage(e.target.value); setCustomLang("") }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            >
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              type="text"
              placeholder="Or type any language (e.g. Ukrainian, Catalan…)"
              value={customLang}
              onChange={(e) => setCustomLang(e.target.value)}
              className="mt-1.5 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-accent"
            />
            {customLang.trim() && (
              <p className="text-accent text-xs mt-1">Will translate to: {customLang.trim()}</p>
            )}
          </div>

          {/* scope */}
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">Slide scope</label>
            <div className="flex gap-2">
              {(["all", "current", "range"] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    scope === s
                      ? "border-accent/60 bg-accent/10 text-white"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                  }`}
                >
                  {s === "all" ? `All (${slideCount})` : s === "current" ? `Current (${currentSlide})` : "Range"}
                </button>
              ))}
            </div>
            {scope === "range" && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-white/40 text-xs">Slides</span>
                <input
                  type="number"
                  min={1}
                  max={slideCount}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(Number(e.target.value))}
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-white/40 text-xs">to</span>
                <input
                  type="number"
                  min={rangeFrom}
                  max={slideCount}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(Number(e.target.value))}
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            )}
          </div>

          {/* include notes toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(e) => setIncludeNotes(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-white/60 text-xs">Also translate speaker notes</span>
          </label>

          {/* translate button */}
          <button
            onClick={handleTranslate}
            disabled={translating || !targetLang}
            className="w-full py-2.5 bg-accent hover:bg-accent/80 disabled:bg-white/10 disabled:text-white/30 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {translating ? "Translating…" : `Translate to ${targetLang}`}
          </button>

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {result && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              ✓ Translated {result.translated} text element{result.translated !== 1 ? "s" : ""} across {result.affected.length} slide{result.affected.length !== 1 ? "s" : ""}
              {result.affected.length > 0 && (
                <span className="text-green-400/60"> (slides {result.affected.slice(0, 8).join(", ")}{result.affected.length > 8 ? "…" : ""})</span>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
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
