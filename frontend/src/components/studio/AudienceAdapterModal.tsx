import { useState } from "react"
import { adaptForAudience } from "../../lib/studioApi"
import type { AudienceAdaptSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: () => void
}

const PRESET_AUDIENCES = [
  { label: "C-Suite / Executive", value: "C-suite executives who need high-level summaries and business impact" },
  { label: "Technical Team", value: "engineers and technical staff who want details, specs, and implementation notes" },
  { label: "General Public", value: "a general audience with no domain expertise — use simple language and analogies" },
  { label: "Sales / Marketing", value: "sales and marketing professionals focused on value propositions and customer outcomes" },
  { label: "Students / Learners", value: "students learning this topic for the first time — use clear definitions and examples" },
  { label: "Investors", value: "investors evaluating ROI, market opportunity, and financial impact" },
]

type ScopeMode = "all" | "current" | "range"

export default function AudienceAdapterModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [audience, setAudience]       = useState("")
  const [scope, setScope]             = useState<ScopeMode>("all")
  const [rangeFrom, setRangeFrom]     = useState(1)
  const [rangeTo, setRangeTo]         = useState(slideCount)
  const [result, setResult]           = useState<{ slides: AudienceAdaptSlide[]; total_changed: number; applied: boolean; audience: string; slides_processed: number } | null>(null)
  const [loading, setLoading]         = useState(false)
  const [applying, setApplying]       = useState(false)
  const [error, setError]             = useState("")
  const [expandedSlide, setExpandedSlide] = useState<number | null>(null)

  const slidesParam = (): number[] | undefined => {
    if (scope === "all") return undefined
    if (scope === "current") return [currentSlide]
    const from = Math.max(1, rangeFrom)
    const to   = Math.min(slideCount, rangeTo)
    return Array.from({ length: to - from + 1 }, (_, i) => from + i)
  }

  const run = async (doApply = false) => {
    if (!audience.trim()) { setError("Please describe the target audience."); return }
    if (doApply) setApplying(true)
    else setLoading(true)
    setError("")
    try {
      const r = await adaptForAudience(docId, audience.trim(), slidesParam(), doApply)
      setResult(r)
      if (doApply && r.applied) onApplied()
    } catch {
      setError("Adaptation failed. Please try again.")
    } finally {
      setLoading(false)
      setApplying(false)
    }
  }

  const totalChanges = result?.slides.reduce((sum, s) => sum + s.elements.length, 0) ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Audience Adapter</h2>
            <p className="text-white/40 text-xs mt-0.5">Rewrite slide content for a specific target audience</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* audience input */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Target Audience</label>
            <textarea
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Describe the audience, e.g. 'C-suite executives focused on ROI and strategic impact'"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/25 resize-none focus:outline-none focus:border-accent/50"
            />
            {/* presets */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_AUDIENCES.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setAudience(p.value)}
                  className="text-xs px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 bg-white/5 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* scope */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Scope</label>
            <div className="flex gap-2">
              {(["all", "current", "range"] as ScopeMode[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s === "all" ? "All Slides" : s === "current" ? `Current (${currentSlide})` : "Range"}
                </button>
              ))}
            </div>
            {scope === "range" && (
              <div className="flex items-center gap-2">
                <span className="text-white/40 text-xs">Slides</span>
                <input
                  type="number" min={1} max={slideCount} value={rangeFrom}
                  onChange={(e) => setRangeFrom(Number(e.target.value))}
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-accent/50"
                />
                <span className="text-white/40 text-xs">to</span>
                <input
                  type="number" min={1} max={slideCount} value={rangeTo}
                  onChange={(e) => setRangeTo(Number(e.target.value))}
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-accent/50"
                />
                <span className="text-white/40 text-xs">of {slideCount}</span>
              </div>
            )}
          </div>

          {/* preview button */}
          {!result && (
            <button
              onClick={() => run(false)}
              disabled={loading || !audience.trim()}
              className="w-full py-2 rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Generating preview…" : "Preview Adaptations"}
            </button>
          )}

          {/* results */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 text-white/50 text-xs">
                  {totalChanges === 0
                    ? "No changes needed — content already suits this audience."
                    : `${totalChanges} text change${totalChanges !== 1 ? "s" : ""} across ${result.slides.length} slide${result.slides.length !== 1 ? "s" : ""}`}
                </div>
                <button
                  onClick={() => { setResult(null) }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Re-run
                </button>
              </div>

              {result.slides.map((slide) => (
                <div key={slide.slide_n} className="rounded-lg border border-white/10 overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/5 hover:bg-white/8 text-left"
                    onClick={() => setExpandedSlide(expandedSlide === slide.slide_n ? null : slide.slide_n)}
                  >
                    <span className="text-white/60 text-xs font-mono w-14 shrink-0">Slide {slide.slide_n}</span>
                    <span className="text-white/40 text-xs flex-1">{slide.elements.length} element{slide.elements.length !== 1 ? "s" : ""} changed</span>
                    <span className="text-white/30 text-xs">{expandedSlide === slide.slide_n ? "▲" : "▼"}</span>
                  </button>

                  {expandedSlide === slide.slide_n && (
                    <div className="divide-y divide-white/5">
                      {slide.elements.map((el) => (
                        <div key={el.element_id} className="px-4 py-3 space-y-2">
                          <div className="text-white/30 text-[10px] font-mono">{el.element_id}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <div className="text-white/30 text-[10px] uppercase tracking-wide">Original</div>
                              <p className="text-white/60 text-xs bg-white/5 rounded px-2 py-1.5 leading-relaxed">{el.original}</p>
                            </div>
                            <div className="space-y-1">
                              <div className="text-accent/60 text-[10px] uppercase tracking-wide">Adapted</div>
                              <p className="text-white text-xs bg-accent/5 border border-accent/10 rounded px-2 py-1.5 leading-relaxed">{el.adapted}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {totalChanges > 0 && !result.applied && (
                <button
                  onClick={() => run(true)}
                  disabled={applying}
                  className="w-full py-2 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 text-sm hover:bg-green-500/25 disabled:opacity-40 transition-colors"
                >
                  {applying ? "Applying…" : `Apply ${totalChanges} Change${totalChanges !== 1 ? "s" : ""} to Deck`}
                </button>
              )}

              {result.applied && (
                <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2 text-center">
                  Applied — deck updated for <span className="text-green-300 font-medium">{result.audience}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
