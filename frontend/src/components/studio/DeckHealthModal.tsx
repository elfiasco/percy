import { useState, useEffect } from "react"
import { fetchDocStats, fetchReadabilityScores, fetchContentDensity, findSimilarSlides, fetchPresentationCheck } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
  onOpenFeature: (feature: string) => void
}

interface HealthMetric {
  id: string
  label: string
  score: number       // 0-100
  badge: string
  summary: string
  action?: string
  actionLabel?: string
  warn: boolean
}

function ScoreRing({ score }: { score: number }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444"
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x="36" y="41" textAnchor="middle" fontSize="14" fontWeight="bold" fill={color}>{score}</text>
    </svg>
  )
}

export default function DeckHealthModal({ docId, onClose, onJumpToSlide, onOpenFeature }: Props) {
  const [loading, setLoading] = useState(true)
  const [overall, setOverall] = useState(0)
  const [metrics, setMetrics] = useState<HealthMetric[]>([])
  const [error, setError]     = useState("")

  useEffect(() => {
    const run = async () => {
      try {
        const [stats, readability, density, similar, check] = await Promise.allSettled([
          fetchDocStats(docId),
          fetchReadabilityScores(docId),
          fetchContentDensity(docId),
          findSimilarSlides(docId, 0.65),
          fetchPresentationCheck(docId),
        ])

        const m: HealthMetric[] = []

        // Readability metric
        if (readability.status === "fulfilled") {
          const score = readability.value.overall_score
          const s = score !== null ? Math.round(Math.min(100, Math.max(0, score))) : 50
          m.push({
            id: "readability",
            label: "Readability",
            score: s,
            badge: readability.value.overall_label,
            summary: score !== null ? `Overall Flesch score: ${score.toFixed(0)} (${readability.value.overall_label})` : "Could not compute — insufficient text",
            action: "readability",
            actionLabel: "See per-slide breakdown",
            warn: s < 40,
          })
        }

        // Content density metric
        if (density.status === "fulfilled") {
          const { crowded_slides, sparse_slides, slides } = density.value
          const problemCount = crowded_slides.length + sparse_slides.length
          const s = Math.max(0, 100 - problemCount * 12)
          m.push({
            id: "density",
            label: "Content Balance",
            score: s,
            badge: problemCount === 0 ? "balanced" : `${problemCount} issues`,
            summary: crowded_slides.length > 0
              ? `${crowded_slides.length} crowded slide${crowded_slides.length !== 1 ? "s" : ""}: ${crowded_slides.slice(0, 4).join(", ")}${crowded_slides.length > 4 ? "…" : ""}`
              : sparse_slides.length > 0
              ? `${sparse_slides.length} sparse slide${sparse_slides.length !== 1 ? "s" : ""}`
              : `All ${slides.length} slides are well-balanced`,
            action: "content-density",
            actionLabel: "Open density report",
            warn: problemCount > 0,
          })
        }

        // Similar slides metric
        if (similar.status === "fulfilled") {
          const pairs = similar.value.pairs.length
          const s = Math.max(0, 100 - pairs * 20)
          m.push({
            id: "similar",
            label: "Unique Content",
            score: s,
            badge: pairs === 0 ? "all unique" : `${pairs} pair${pairs !== 1 ? "s" : ""}`,
            summary: pairs === 0
              ? "No duplicate or near-duplicate slides found"
              : `${pairs} pair${pairs !== 1 ? "s" : ""} of similar slides detected — consider merging`,
            action: "similar-slides",
            actionLabel: "Find similar slides",
            warn: pairs > 0,
          })
        }

        // Presentation check metric
        if (check.status === "fulfilled") {
          const { issue_count, issues } = check.value
          const errors  = issues.filter((i) => i.severity === "error").length
          const warnings = issues.filter((i) => i.severity === "warning").length
          const s = Math.max(0, 100 - errors * 15 - warnings * 5)
          m.push({
            id: "quality",
            label: "Quality Check",
            score: s,
            badge: issue_count === 0 ? "no issues" : `${issue_count} issue${issue_count !== 1 ? "s" : ""}`,
            summary: issue_count === 0
              ? "All quality checks passed"
              : `${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""} found across slides`,
            action: "presentation-check",
            actionLabel: "View issues",
            warn: errors > 0 || warnings > 2,
          })
        }

        // Stats metric (word coverage)
        if (stats.status === "fulfilled") {
          const { slide_count, slides_with_notes, word_count } = stats.value
          const notesCoverage = Math.round(((slides_with_notes ?? 0) / Math.max(1, slide_count)) * 100)
          const s = notesCoverage
          m.push({
            id: "notes",
            label: "Speaker Notes",
            score: s,
            badge: `${notesCoverage}% covered`,
            summary: `${slides_with_notes ?? 0} of ${slide_count} slides have speaker notes · ${word_count} total words in deck`,
            action: "notes-review",
            actionLabel: "Add missing notes",
            warn: notesCoverage < 50 && slide_count > 3,
          })
        }

        setMetrics(m)
        const avg = m.length > 0 ? Math.round(m.reduce((a, b) => a + b.score, 0) / m.length) : 0
        setOverall(avg)
      } catch (e) {
        setError("Failed to load health metrics.")
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const overallLabel = overall >= 80 ? "Excellent" : overall >= 60 ? "Good" : overall >= 40 ? "Needs Work" : "Poor"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Health Dashboard</h2>
            <p className="text-white/40 text-xs mt-0.5">Overall quality assessment across {metrics.length} dimensions</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/40 space-y-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Running health checks…</p>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!loading && metrics.length > 0 && (
            <>
              {/* overall score */}
              <div className="flex items-center gap-5 bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                <ScoreRing score={overall} />
                <div>
                  <div className="text-white font-semibold text-lg">{overall}/100 — {overallLabel}</div>
                  <div className="text-white/40 text-xs mt-1">
                    Composite score across readability, content balance, uniqueness, quality, and notes coverage
                  </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {metrics.filter((m) => m.warn).map((m) => (
                      <span key={m.id} className="text-[10px] text-red-300 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5">
                        ⚠ {m.label}
                      </span>
                    ))}
                    {metrics.filter((m) => !m.warn).map((m) => (
                      <span key={m.id} className="text-[10px] text-green-300/70 bg-green-400/5 border border-green-400/15 rounded px-1.5 py-0.5">
                        ✓ {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* per-metric cards */}
              <div className="grid grid-cols-1 gap-2">
                {metrics.map((m) => (
                  <div key={m.id} className={`flex items-center gap-4 rounded-lg px-4 py-3 border ${m.warn ? "bg-red-400/5 border-red-400/20" : "bg-green-400/5 border-green-400/15"}`}>
                    <div className="text-center w-10 shrink-0">
                      <div className={`text-xl font-mono font-bold ${m.warn ? "text-red-400" : "text-green-400"}`}>{m.score}</div>
                      <div className="text-white/25 text-[9px]">/100</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{m.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${m.warn ? "text-red-300 bg-red-400/10 border-red-400/20" : "text-green-300 bg-green-400/10 border-green-400/20"}`}>
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-white/50 text-xs mt-0.5 truncate">{m.summary}</p>
                    </div>
                    {m.action && m.actionLabel && (
                      <button
                        onClick={() => { onOpenFeature(m.action!); onClose() }}
                        className="text-xs text-accent hover:text-accent/80 shrink-0 border border-accent/30 px-2.5 py-1 rounded-md hover:bg-accent/10 transition-colors"
                      >
                        {m.actionLabel}
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
