import { useState } from "react"
import { capitalizeTitles } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (affected: number[]) => void
}

const STYLES = [
  { key: "title" as const,    label: "Title Case",    example: "The Quick Brown Fox" },
  { key: "sentence" as const, label: "Sentence case", example: "The quick brown fox" },
  { key: "upper" as const,    label: "ALL CAPS",      example: "THE QUICK BROWN FOX" },
]

export default function CapitalizeTitlesModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [style, setStyle]     = useState<"title" | "sentence" | "upper">("title")
  const [scope, setScope]     = useState<"all" | "current">("all")
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ changed: number; affected_slides: number[] } | null>(null)
  const [error, setError]     = useState("")

  const apply = async () => {
    setLoading(true)
    setError("")
    try {
      const slides = scope === "current" ? [currentSlide] : undefined
      const r = await capitalizeTitles(docId, style, slides)
      setResult(r)
      onApplied(r.affected_slides)
    } catch {
      setError("Failed to capitalize titles")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold text-sm">Capitalize Titles</h2>
            <p className="text-white/40 text-xs mt-0.5">Apply consistent capitalization to slide title elements</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {result && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              {result.changed === 0
                ? "Titles are already correctly capitalized."
                : `Updated ${result.changed} title${result.changed !== 1 ? "s" : ""} on ${result.affected_slides.length} slide${result.affected_slides.length !== 1 ? "s" : ""}.`
              }
            </div>
          )}

          <div className="space-y-2">
            {STYLES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                className={`w-full flex items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-all ${style === s.key ? "bg-accent/10 border-accent/40" : "bg-white/3 border-white/10 hover:border-white/20"}`}
              >
                <div>
                  <div className={`text-sm font-medium ${style === s.key ? "text-accent" : "text-white/70"}`}>{s.label}</div>
                  <div className="text-white/30 text-xs mt-0.5 font-mono">{s.example}</div>
                </div>
                {style === s.key && <span className="text-accent">✓</span>}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Apply to</label>
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
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={apply}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  )
}
