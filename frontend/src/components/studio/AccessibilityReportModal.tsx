import { useState, useEffect } from "react"
import { fetchAccessibilityReport } from "../../lib/studioApi"
import type { SlideAccessibility } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const ISSUE_META: Record<string, { label: string; color: string; icon: string }> = {
  "missing-alt-text": { label: "Missing Alt Text",   color: "text-red-300 bg-red-400/10 border-red-400/20",       icon: "⛔" },
  "small-font":       { label: "Small Font",          color: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20", icon: "⚠" },
  "low-contrast":     { label: "Low Contrast",        color: "text-orange-300 bg-orange-400/10 border-orange-400/20",icon: "◎" },
  "missing-title":    { label: "Missing Title",       color: "text-blue-300 bg-blue-400/10 border-blue-400/20",    icon: "○" },
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400"
  const label = score >= 80 ? "Good" : score >= 60 ? "Fair" : "Needs Work"
  return (
    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
      <div className={`text-3xl font-bold ${color}`}>{score}</div>
      <div>
        <div className={`text-sm font-medium ${color}`}>{label}</div>
        <div className="text-white/30 text-xs">Accessibility Score</div>
      </div>
    </div>
  )
}

export default function AccessibilityReportModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]     = useState(true)
  const [data, setData]           = useState<{ slides: SlideAccessibility[]; total_issues: number; high_severity: number; score: number; slide_count: number; clean_slides: number } | null>(null)
  const [error, setError]         = useState("")
  const [filter, setFilter]       = useState<string>("all")
  const [expandedSlide, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    fetchAccessibilityReport(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to run accessibility check"))
      .finally(() => setLoading(false))
  }, [docId])

  const issueTypes = data
    ? [...new Set(data.slides.flatMap((s) => s.issues.map((i) => i.type)))]
    : []

  const filtered = data
    ? data.slides.filter((s) =>
        filter === "all" || s.issues.some((i) => i.type === filter)
      ).map((s) => ({
        ...s,
        issues: filter === "all" ? s.issues : s.issues.filter((i) => i.type === filter),
      }))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Accessibility Report</h2>
            <p className="text-white/40 text-xs mt-0.5">Alt text, contrast, font size, and title checks</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking accessibility…</p>
            </div>
          ) : data && (
            <>
              {/* summary */}
              <div className="flex items-center gap-3">
                <ScoreGauge score={data.score} />
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {[
                    { label: "Issues", value: data.total_issues, color: data.total_issues > 0 ? "text-red-400" : "text-green-400" },
                    { label: "High Severity", value: data.high_severity, color: data.high_severity > 0 ? "text-red-400" : "text-white/60" },
                    { label: "Clean Slides", value: data.clean_slides, color: "text-white/60" },
                  ].map((s) => (
                    <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-center">
                      <div className={`text-sm font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-white/30 text-[10px]">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {data.total_issues === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="text-3xl">✓</div>
                  <p className="text-white/50 text-sm">No accessibility issues found</p>
                </div>
              ) : (
                <>
                  {/* filter */}
                  {issueTypes.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setFilter("all")}
                        className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === "all" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                      >
                        All
                      </button>
                      {issueTypes.map((t) => {
                        const m = ISSUE_META[t] ?? { label: t, color: "text-white/40 bg-white/5 border-white/10", icon: "•" }
                        return (
                          <button
                            key={t}
                            onClick={() => setFilter(t)}
                            className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === t ? m.color : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                          >
                            {m.icon} {m.label}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* slides */}
                  <div className="space-y-2">
                    {filtered.map((slide) => (
                      <div key={slide.slide_n} className="rounded-lg border border-white/10 overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/5 hover:bg-white/8 text-left"
                          onClick={() => setExpanded(expandedSlide === slide.slide_n ? null : slide.slide_n)}
                        >
                          <span className="text-white/60 text-xs font-mono w-14 shrink-0">Slide {slide.slide_n}</span>
                          <div className="flex flex-wrap gap-1 flex-1">
                            {slide.issues.slice(0, 3).map((issue, i) => {
                              const m = ISSUE_META[issue.type] ?? { color: "text-white/40 bg-white/5 border-white/10", icon: "•", label: issue.type }
                              return (
                                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${m.color}`}>{m.icon} {m.label}</span>
                              )
                            })}
                            {slide.issues.length > 3 && (
                              <span className="text-[10px] text-white/30">+{slide.issues.length - 3} more</span>
                            )}
                          </div>
                          <span className="text-white/30 text-xs ml-2">{expandedSlide === slide.slide_n ? "▲" : "▼"}</span>
                        </button>

                        {expandedSlide === slide.slide_n && (
                          <div className="divide-y divide-white/5">
                            {slide.issues.map((issue, i) => {
                              const m = ISSUE_META[issue.type] ?? { color: "text-white/40 bg-white/5 border-white/10", icon: "•", label: issue.type }
                              return (
                                <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                                  <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${m.color}`}>{m.icon}</span>
                                  <p className="text-white/60 text-xs leading-relaxed flex-1">{issue.detail}</p>
                                  <span className={`text-[10px] shrink-0 ${issue.severity === "high" ? "text-red-400/60" : "text-yellow-400/60"}`}>{issue.severity}</span>
                                </div>
                              )
                            })}
                            <div className="px-4 py-2">
                              <button
                                onClick={() => { onJumpToSlide(slide.slide_n); onClose() }}
                                className="text-xs text-accent/70 hover:text-accent transition-colors"
                              >
                                Open Slide {slide.slide_n} ↗
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
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
