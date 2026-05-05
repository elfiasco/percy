/**
 * AIPresentationScoreModal — AI-powered presentation quality scorer.
 * Sends the deck's text to Claude and displays a structured score with feedback.
 */

import { useState, useEffect, useCallback } from "react"
import { aiScorePresentation } from "../../lib/studioApi"
import type { PresentationScore } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  structure:          { label: "Structure",           icon: "⊟" },
  clarity:            { label: "Clarity",             icon: "◎" },
  pacing:             { label: "Pacing",              icon: "⏱" },
  visual_consistency: { label: "Visual Consistency",  icon: "🎨" },
  engagement:         { label: "Engagement",          icon: "⚡" },
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color =
    score >= 8 ? "bg-emerald-500" :
    score >= 6 ? "bg-amber-400" :
    score >= 4 ? "bg-orange-500" :
    "bg-red-500"
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-slate-300 w-6 text-right shrink-0">{score}</span>
    </div>
  )
}

function OverallRing({ score }: { score: number }) {
  const pct = score / 10
  const r = 38
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  const color =
    score >= 8 ? "#10b981" :
    score >= 6 ? "#f59e0b" :
    score >= 4 ? "#f97316" :
    "#ef4444"

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle
          cx="48" cy="48" r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
        <text x="48" y="53" textAnchor="middle" fontSize="22" fontWeight="bold" fill="white">
          {score.toFixed(1)}
        </text>
      </svg>
      <span className="text-[10px] text-muted uppercase tracking-wide">out of 10</span>
    </div>
  )
}

export default function AIPresentationScoreModal({ docId, onClose }: Props) {
  const [scoring, setScoring]   = useState(false)
  const [result, setResult]     = useState<PresentationScore | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const runScore = useCallback(async () => {
    setScoring(true)
    setError(null)
    try {
      const r = await aiScorePresentation(docId)
      setResult(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scoring failed")
    } finally {
      setScoring(false)
    }
  }, [docId])

  useEffect(() => {
    runScore()
  }, [runScore])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">✨ AI Presentation Score</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {scoring && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted animate-pulse">Analyzing your presentation…</p>
              <p className="text-[11px] text-muted/50 text-center max-w-xs">
                Claude is reviewing your slides for structure, clarity, pacing, and engagement.
              </p>
            </div>
          )}

          {error && !scoring && (
            <div className="flex flex-col items-center gap-3 py-8">
              <span className="text-3xl opacity-40">⚠</span>
              <p className="text-sm text-red-400 text-center">{error}</p>
              {error.includes("ANTHROPIC_API_KEY") && (
                <p className="text-[11px] text-muted/60 text-center">
                  Set the ANTHROPIC_API_KEY environment variable to enable AI scoring.
                </p>
              )}
              <button
                onClick={runScore}
                className="text-xs px-4 py-1.5 rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {result && !scoring && (
            <div className="space-y-5">
              {/* overall score */}
              <div className="flex items-center gap-6 bg-white/5 rounded-xl p-4 border border-white/10">
                <OverallRing score={result.overall_score} />
                <div className="flex-1">
                  <div className="text-xs text-muted uppercase tracking-wide mb-1">Overall Score</div>
                  <div className="text-sm text-slate-200 leading-snug">{result.one_line_summary}</div>
                </div>
              </div>

              {/* category scores */}
              <div>
                <div className="text-[11px] text-muted uppercase tracking-wide mb-2">Category Breakdown</div>
                <div className="space-y-2.5">
                  {(Object.entries(result.categories) as [string, { score: number; feedback: string }][]).map(([key, cat]) => {
                    const meta = CATEGORY_LABELS[key] ?? { label: key, icon: "●" }
                    return (
                      <div key={key}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] w-4 text-center text-muted">{meta.icon}</span>
                          <span className="text-[11px] text-slate-300 w-32 shrink-0">{meta.label}</span>
                          <ScoreBar score={cat.score} />
                        </div>
                        <p className="text-[10px] text-muted/60 pl-6">{cat.feedback}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* strengths */}
              {result.strengths.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wide mb-2">Strengths</div>
                  <ul className="space-y-1">
                    {result.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-emerald-300/80">
                        <span className="text-emerald-400 mt-px">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* top issues */}
              {result.top_issues.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wide mb-2">Areas to Improve</div>
                  <ul className="space-y-1">
                    {result.top_issues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-amber-300/80">
                        <span className="text-amber-400 mt-px">!</span>
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        {result && !scoring && (
          <div className="shrink-0 px-5 py-3 border-t border-edge flex gap-2">
            <button
              onClick={runScore}
              className="flex-1 text-sm py-2 rounded bg-accent/20 text-accent border border-accent/30
                         hover:bg-accent/30 transition-colors"
            >
              Re-score
            </button>
            <button
              onClick={onClose}
              className="text-sm py-2 px-4 rounded bg-white/5 text-muted border border-edge
                         hover:bg-white/10 hover:text-slate-200 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
