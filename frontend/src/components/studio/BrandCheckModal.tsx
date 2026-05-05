import { useState } from "react"
import type { BrandViolation } from "../../lib/studioApi"
import { runBrandCheck, fetchColorPalette, fetchFontPalette } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

type ViolationType = "all" | "off-brand-fill" | "off-brand-font" | "off-brand-text-color"

const TYPE_LABELS: Record<string, string> = {
  "off-brand-fill":       "Fill Color",
  "off-brand-font":       "Font",
  "off-brand-text-color": "Text Color",
}

const TYPE_COLORS: Record<string, string> = {
  "off-brand-fill":       "text-orange-300 bg-orange-400/10 border-orange-400/30",
  "off-brand-font":       "text-sky-300 bg-sky-400/10 border-sky-400/30",
  "off-brand-text-color": "text-paper bg-paper/10 border-paper/30",
}

export default function BrandCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [fonts, setFonts]         = useState<string>("")
  const [colors, setColors]       = useState<string>("")
  const [running, setRunning]     = useState(false)
  const [result, setResult]       = useState<{ violations: BrandViolation[]; total: number; checked_slides: number } | null>(null)
  const [filter, setFilter]       = useState<ViolationType>("all")
  const [error, setError]         = useState("")
  const [loadingPalette, setLoadingPalette] = useState(false)

  const loadPalette = async () => {
    setLoadingPalette(true)
    try {
      const [colorRes, fontRes] = await Promise.all([
        fetchColorPalette(docId),
        fetchFontPalette(docId),
      ])
      setColors(colorRes.colors.join(", "))
      setFonts(fontRes.fonts.join(", "))
    } catch { /* ignore */ }
    setLoadingPalette(false)
  }

  const handleRun = async () => {
    setRunning(true)
    setError("")
    setResult(null)
    try {
      const parsedFonts  = fonts.split(",").map((f) => f.trim()).filter(Boolean)
      const parsedColors = colors.split(",").map((c) => c.trim()).filter(Boolean)
      const r = await runBrandCheck(
        docId,
        parsedFonts.length > 0 ? parsedFonts : undefined,
        parsedColors.length > 0 ? parsedColors : undefined,
      )
      setResult(r)
    } catch {
      setError("Brand check failed.")
    } finally {
      setRunning(false)
    }
  }

  const visible = result?.violations.filter((v) =>
    filter === "all" || v.type === filter,
  ) ?? []

  const typeCounts = result?.violations.reduce((acc, v) => {
    acc[v.type] = (acc[v.type] ?? 0) + 1
    return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Brand Consistency Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Verify all elements use approved brand colors and fonts</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* brand configuration */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-white/40 text-xs uppercase tracking-wider">Brand Guidelines</p>
              <button
                onClick={loadPalette}
                disabled={loadingPalette}
                className="text-xs text-accent/70 hover:text-accent disabled:opacity-40 transition-colors"
              >
                {loadingPalette ? "Loading…" : "↓ Load from deck palette"}
              </button>
            </div>
            <div>
              <label className="text-white/30 text-xs block mb-1">Allowed fonts (comma-separated, leave empty to skip check)</label>
              <input
                type="text"
                value={fonts}
                onChange={(e) => setFonts(e.target.value)}
                placeholder="e.g. Roboto, Helvetica Neue, Open Sans"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-white/30 text-xs block mb-1">Allowed colors (hex, comma-separated, ±25 tolerance)</label>
              <input
                type="text"
                value={colors}
                onChange={(e) => setColors(e.target.value)}
                placeholder="e.g. #1A1A2E, #16213E, #E94560"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-accent"
              />
              {colors && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {colors.split(",").map((c) => c.trim()).filter((c) => c.startsWith("#")).map((c) => (
                    <div key={c} className="w-4 h-4 rounded border border-white/20 shrink-0" style={{ background: c }} title={c} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={running || (!fonts.trim() && !colors.trim())}
            className="w-full py-2.5 bg-accent hover:bg-accent/80 disabled:bg-white/10 disabled:text-white/30 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {running ? "Checking…" : "Run Brand Check"}
          </button>

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {result && (
            <div className="space-y-3">
              {result.total === 0 ? (
                <div className="text-center py-6">
                  <div className="text-2xl mb-1">✓</div>
                  <p className="text-green-400 text-sm">All elements comply with brand guidelines</p>
                  <p className="text-white/30 text-xs mt-1">{result.checked_slides} slides checked</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-amber-400 text-xs font-medium">{result.total} violation{result.total !== 1 ? "s" : ""} across {result.checked_slides} slides</span>
                  </div>
                  {/* filter tabs */}
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => setFilter("all")}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${filter === "all" ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      All ({result.total})
                    </button>
                    {(Object.entries(typeCounts) as Array<[string, number]>).map(([type, count]) => (
                      <button
                        key={type}
                        onClick={() => setFilter(type as ViolationType)}
                        className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${filter === type ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/40 hover:text-white/70"}`}
                      >
                        {TYPE_LABELS[type] ?? type} ({count})
                      </button>
                    ))}
                  </div>
                  {/* violations list */}
                  <div className="space-y-1.5">
                    {visible.slice(0, 50).map((v, i) => (
                      <div key={i} className="flex items-start gap-2 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${TYPE_COLORS[v.type] ?? "text-white/50 bg-white/5 border-white/10"}`}>
                          {TYPE_LABELS[v.type] ?? v.type}
                        </span>
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => { onJumpToSlide(v.slide_n); onClose() }}
                            className="text-accent text-xs hover:text-accent/80"
                          >
                            Slide {v.slide_n}
                          </button>
                          <span className="text-white/30 text-xs mx-1">·</span>
                          <span className="text-white/50 text-xs">{v.detail}</span>
                        </div>
                        {v.value.startsWith("#") && (
                          <div className="w-3.5 h-3.5 rounded shrink-0 border border-white/20" style={{ background: v.value }} />
                        )}
                      </div>
                    ))}
                    {visible.length > 50 && (
                      <p className="text-white/25 text-xs text-center py-1">…{visible.length - 50} more violations</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
