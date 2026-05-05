import { useState, useEffect } from "react"
import type { GrammarIssue } from "../../lib/studioApi"
import { runGrammarCheck, rewriteElementText } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide?: (n: number) => void
  onFixed?: () => void
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  spelling: { bg: "bg-red-500/10",    text: "text-red-300",    border: "border-red-500/30" },
  grammar:  { bg: "bg-amber-500/10",  text: "text-amber-300",  border: "border-amber-500/30" },
  clarity:  { bg: "bg-sky-500/10",    text: "text-sky-300",    border: "border-sky-500/30" },
  style:    { bg: "bg-slate-500/10",  text: "text-slate-400",  border: "border-slate-500/30" },
}

const TYPE_ICONS: Record<string, string> = {
  spelling: "✗",
  grammar:  "⚠",
  clarity:  "◑",
  style:    "●",
}

export default function GrammarCheckModal({ docId, onClose, onJumpToSlide, onFixed }: Props) {
  const [issues, setIssues]       = useState<GrammarIssue[]>([])
  const [loading, setLoading]     = useState(false)
  const [checked, setChecked]     = useState(0)
  const [fixing, setFixing]       = useState<string | null>(null)
  const [fixed, setFixed]         = useState<Set<string>>(new Set())
  const [filter, setFilter]       = useState<string>("all")

  const runCheck = () => {
    setLoading(true)
    setIssues([])
    setFixed(new Set())
    runGrammarCheck(docId)
      .then((r) => { setIssues(r.issues); setChecked(r.checked) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { runCheck() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFix = async (issue: GrammarIssue) => {
    const key = `${issue.slide_n}:${issue.element_id}`
    setFixing(key)
    try {
      const instruction = `Replace "${issue.original_text}" with: "${issue.suggestion}". Make only that specific change, leave the rest of the text intact.`
      await rewriteElementText(docId, issue.slide_n, issue.element_id, instruction, true)
      setFixed((prev) => new Set([...prev, key]))
      onFixed?.()
    } catch (e) {
      console.error("fix failed:", e)
    }
    setFixing(null)
  }

  const filteredIssues = filter === "all"
    ? issues
    : issues.filter((i) => i.issue_type === filter)

  const activeIssues = filteredIssues.filter((i) => !fixed.has(`${i.slide_n}:${i.element_id}`))
  const counts = {
    all:      issues.length,
    spelling: issues.filter((i) => i.issue_type === "spelling").length,
    grammar:  issues.filter((i) => i.issue_type === "grammar").length,
    clarity:  issues.filter((i) => i.issue_type === "clarity").length,
    style:    issues.filter((i) => i.issue_type === "style").length,
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-edge rounded-xl shadow-2xl w-[700px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Grammar & Clarity Check</h2>
            <p className="text-[11px] text-muted mt-0.5">
              {loading ? "Analyzing your deck…"
                : checked > 0 ? `Checked ${checked} text elements · ${issues.length} issue${issues.length !== 1 ? "s" : ""} found`
                : "AI-powered grammar, spelling and clarity checker"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runCheck}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded border border-edge text-muted hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {loading ? "Checking…" : "↺ Re-check"}
            </button>
            <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">×</button>
          </div>
        </div>

        {/* filter tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-edge/50 shrink-0 bg-black/10">
          {(["all", "spelling", "grammar", "clarity", "style"] as const).map((t) => {
            const c = counts[t]
            const colors = t !== "all" ? TYPE_COLORS[t] : null
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-3 py-1 rounded text-[11px] transition-colors border ${
                  filter === t
                    ? colors ? `${colors.bg} ${colors.text} ${colors.border}` : "bg-white/10 text-slate-200 border-white/20"
                    : "border-transparent text-muted hover:text-slate-300 hover:bg-white/5"
                }`}
              >
                {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                {c > 0 && <span className="ml-1.5 opacity-70">{c}</span>}
              </button>
            )
          })}
        </div>

        {/* issues list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Analyzing presentation text…</span>
            </div>
          ) : activeIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted">
              <span className="text-3xl">✓</span>
              <span className="text-sm">{issues.length === 0 ? "No issues found" : "All visible issues resolved"}</span>
              {fixed.size > 0 && <span className="text-[11px] text-emerald-400">{fixed.size} issue{fixed.size !== 1 ? "s" : ""} fixed this session</span>}
            </div>
          ) : (
            <div className="divide-y divide-edge/30">
              {activeIssues.map((issue, idx) => {
                const key = `${issue.slide_n}:${issue.element_id}`
                const isFixing = fixing === key
                const colors = TYPE_COLORS[issue.issue_type] ?? TYPE_COLORS.style
                return (
                  <div key={idx} className="px-5 py-3 hover:bg-white/3 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-5 h-5 shrink-0 rounded flex items-center justify-center text-[10px] font-bold ${colors.bg} ${colors.text} ${colors.border} border`}>
                        {TYPE_ICONS[issue.issue_type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            onClick={() => onJumpToSlide?.(issue.slide_n)}
                            className="text-[10px] font-semibold text-accent-light hover:underline shrink-0"
                          >
                            Slide {issue.slide_n}
                          </button>
                          <span className="text-[10px] text-muted truncate">{issue.element_name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                            {issue.issue_type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-1">{issue.message}</div>
                        <div className="flex items-start gap-2 text-[11px]">
                          <div className="flex-1 min-w-0">
                            <div className="text-muted/70 mb-0.5">Found:</div>
                            <div className="font-mono text-red-300/80 bg-red-500/5 rounded px-2 py-1 border border-red-500/15 truncate">{issue.original_text}</div>
                          </div>
                          <div className="text-muted self-center mt-4">→</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-muted/70 mb-0.5">Suggestion:</div>
                            <div className="font-mono text-emerald-300/80 bg-emerald-500/5 rounded px-2 py-1 border border-emerald-500/15 truncate">{issue.suggestion}</div>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleFix(issue)}
                        disabled={isFixing}
                        className="shrink-0 mt-1 px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[11px] hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        title="Apply AI fix to this element"
                      >
                        {isFixing ? "…" : "Fix"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-edge shrink-0 flex items-center justify-between text-[11px] text-muted">
          <span>
            {fixed.size > 0 && <span className="text-emerald-400 mr-3">{fixed.size} fixed</span>}
            {activeIssues.length > 0 && `${activeIssues.length} remaining`}
          </span>
          <button onClick={onClose} className="px-4 py-1.5 rounded border border-edge hover:bg-white/5 transition-colors text-slate-300">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
