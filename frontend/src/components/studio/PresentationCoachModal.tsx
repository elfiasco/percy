import { useState } from "react"
import { runPresentationCoach } from "../../lib/studioApi"
import type { CoachTip } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: string }> = {
  structure:   { label: "Structure",   color: "text-paper bg-paper/10 border-paper/20",  icon: "⬡" },
  clarity:     { label: "Clarity",     color: "text-blue-300 bg-blue-400/10 border-blue-400/20",       icon: "◉" },
  engagement:  { label: "Engagement",  color: "text-amber-300 bg-amber-400/10 border-amber-400/20",    icon: "★" },
  pacing:      { label: "Pacing",      color: "text-cyan-300 bg-cyan-400/10 border-cyan-400/20",       icon: "⏱" },
  content:     { label: "Content",     color: "text-green-300 bg-green-400/10 border-green-400/20",    icon: "✦" },
}

const SEV_DOT: Record<string, string> = {
  high:   "bg-red-400",
  medium: "bg-yellow-400",
  low:    "bg-white/30",
}

export default function PresentationCoachModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [tips, setTips]       = useState<CoachTip[] | null>(null)
  const [meta, setMeta]       = useState<{ total: number; slide_count: number; high_priority: number; category_counts: Record<string, number> } | null>(null)
  const [filter, setFilter]   = useState<string>("all")
  const [error, setError]     = useState("")

  const handleRun = async () => {
    setLoading(true)
    setError("")
    setTips(null)
    setMeta(null)
    try {
      const r = await runPresentationCoach(docId)
      setTips(r.tips)
      setMeta({ total: r.total, slide_count: r.slide_count, high_priority: r.high_priority, category_counts: r.category_counts })
    } catch {
      setError("Failed to run presentation coach")
    } finally {
      setLoading(false)
    }
  }

  const filtered = tips?.filter((t) => filter === "all" || t.category === filter) ?? []
  const categories = tips ? [...new Set(tips.map((t) => t.category))] : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Presentation Coach</h2>
            <p className="text-white/40 text-xs mt-0.5">Structure, pacing, and delivery feedback for your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!tips && (
            <div className="space-y-3">
              <p className="text-white/50 text-sm leading-relaxed">
                Claude will review your presentation for structural issues, pacing problems, and engagement opportunities.
                You'll receive actionable coaching tips prioritized by impact.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {Object.entries(CATEGORY_META).map(([id, m]) => (
                  <div key={id} className="bg-white/5 border border-white/8 rounded-lg py-2.5 px-2">
                    <div className="text-lg mb-0.5">{m.icon}</div>
                    <div className="text-white/60 text-[11px]">{m.label}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleRun}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Analyzing presentation…
                  </span>
                ) : "Run Presentation Coach"}
              </button>
            </div>
          )}

          {tips !== null && (
            <>
              {/* summary */}
              {meta && (
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                  <div className="flex-1 text-white/50 text-xs">
                    {meta.total} tip{meta.total !== 1 ? "s" : ""} across {meta.slide_count} slides
                  </div>
                  {meta.high_priority > 0 && (
                    <span className="text-red-300 text-xs bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5">
                      {meta.high_priority} high priority
                    </span>
                  )}
                  <button
                    onClick={() => { setTips(null); setMeta(null) }}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    Re-run
                  </button>
                </div>
              )}

              {/* category filter */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setFilter("all")}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === "all" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  All ({tips.length})
                </button>
                {categories.map((cat) => {
                  const m = CATEGORY_META[cat] ?? { label: cat, color: "text-white/50 bg-white/5 border-white/10", icon: "•" }
                  const cnt = tips.filter((t) => t.category === cat).length
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilter(cat)}
                      className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === cat ? m.color : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      {m.icon} {m.label} ({cnt})
                    </button>
                  )
                })}
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-6 text-white/30 text-sm">No tips in this category</div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((tip, i) => {
                    const catMeta = CATEGORY_META[tip.category] ?? { label: tip.category, color: "text-white/50 bg-white/5 border-white/10", icon: "•" }
                    return (
                      <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${SEV_DOT[tip.severity] ?? "bg-white/20"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${catMeta.color}`}>
                                {catMeta.icon} {catMeta.label}
                              </span>
                              <span className={`text-[10px] ${tip.severity === "high" ? "text-red-400" : tip.severity === "medium" ? "text-yellow-400" : "text-white/30"}`}>
                                {tip.severity}
                              </span>
                            </div>
                            <p className="text-white/80 text-sm leading-relaxed">{tip.tip}</p>
                            {tip.slide_n !== null && (
                              <button
                                onClick={() => { onJumpToSlide(tip.slide_n!); onClose() }}
                                className="text-white/30 text-xs hover:text-white/60 transition-colors mt-1"
                              >
                                Slide {tip.slide_n} ↗
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
