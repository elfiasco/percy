import { useState, useEffect } from "react"
import { fetchPresentationCheck, type PresentationIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const SEVERITY_ICON: Record<string, string> = {
  error:   "✗",
  warning: "⚠",
  info:    "ℹ",
}
const SEVERITY_COLOR: Record<string, string> = {
  error:   "text-red-400",
  warning: "text-amber-400",
  info:    "text-sky-400",
}
const TYPE_LABEL: Record<string, string> = {
  no_notes:          "Missing notes",
  no_text:           "No text content",
  too_many_elements: "Too many elements",
  missing_alt_text:  "Missing alt text",
}

export default function PresentationCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [issues, setIssues]     = useState<PresentationIssue[]>([])
  const [slideCount, setSlideCount] = useState(0)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [filterSev, setFilterSev]   = useState<string | null>(null)

  useEffect(() => {
    fetchPresentationCheck(docId)
      .then((r) => { setIssues(r.issues); setSlideCount(r.slide_count) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const types = [...new Set(issues.map((i) => i.type))]
  const filtered = issues.filter((i) =>
    (!filterType || i.type === filterType) &&
    (!filterSev  || i.severity === filterSev)
  )

  const severityOrder = { error: 0, warning: 1, info: 2 }
  const sorted = [...filtered].sort((a, b) =>
    (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || a.slide_n - b.slide_n
  )

  const scoreColor = issues.length === 0 ? "text-emerald-400" :
    issues.some((i) => i.severity === "error")   ? "text-red-400" :
    issues.some((i) => i.severity === "warning") ? "text-amber-400" : "text-sky-400"

  return (
    <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 640px)", maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div>
            <span className="text-sm font-semibold text-slate-200">Presentation Check</span>
            <span className="ml-2 text-xs text-muted">{slideCount} slides</span>
          </div>
          <div className="flex items-center gap-3">
            {!loading && (
              <span className={`text-sm font-bold ${scoreColor}`}>
                {issues.length === 0 ? "✓ No issues" : `${issues.length} issue${issues.length !== 1 ? "s" : ""}`}
              </span>
            )}
            <button onClick={onClose} className="text-muted hover:text-slate-200 transition-colors text-lg w-6 h-6 flex items-center justify-center">✕</button>
          </div>
        </div>

        {/* filters */}
        {!loading && issues.length > 0 && (
          <div className="flex items-center gap-2 px-5 py-2 border-b border-edge/50 shrink-0 flex-wrap">
            <span className="text-[10px] text-muted uppercase tracking-widest">Filter:</span>
            {["error", "warning", "info"].filter((s) => issues.some((i) => i.severity === s)).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSev(filterSev === s ? null : s)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors capitalize ${
                  filterSev === s
                    ? `${SEVERITY_COLOR[s]} border-current bg-current/10`
                    : "text-muted border-edge hover:text-slate-300"
                }`}
              >
                {SEVERITY_ICON[s]} {s}
              </button>
            ))}
            <div className="w-px h-3 bg-edge" />
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(filterType === t ? null : t)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  filterType === t
                    ? "text-violet-300 border-violet-400/40 bg-violet-500/10"
                    : "text-muted border-edge hover:text-slate-300"
                }`}
              >
                {TYPE_LABEL[t] ?? t}
              </button>
            ))}
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading ? (
            <div className="text-muted text-sm animate-pulse">Running checks…</div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <span className="text-4xl">✓</span>
              <span className="text-emerald-400 font-semibold">
                {issues.length === 0 ? "No issues found!" : "No issues match the filter."}
              </span>
              {issues.length === 0 && (
                <span className="text-muted text-sm text-center">
                  Your presentation looks good. All {slideCount} slides have text content and your quality checks passed.
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {sorted.map((issue, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-2.5 rounded bg-white/3 hover:bg-white/6 border border-edge/40 group transition-colors"
                >
                  <span className={`text-sm shrink-0 mt-0.5 ${SEVERITY_COLOR[issue.severity]}`}>
                    {SEVERITY_ICON[issue.severity]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${SEVERITY_COLOR[issue.severity]}`}>
                        {TYPE_LABEL[issue.type] ?? issue.type}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300">{issue.message}</div>
                  </div>
                  <button
                    onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                    className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-edge text-muted hover:text-slate-200 hover:border-accent/50 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Go →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
