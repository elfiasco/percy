import { useState, useEffect } from "react"
import { detectLayoutIssues } from "../../lib/studioApi"
import type { LayoutIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
  onFixed: () => void
}

const ISSUE_META: Record<string, { label: string; color: string; icon: string }> = {
  "out-of-bounds": { label: "Out of Bounds",  color: "text-red-300 bg-red-400/10 border-red-400/20",       icon: "⛔" },
  "overlap":       { label: "Overlap",         color: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20", icon: "⚠" },
  "zero-size":     { label: "Zero Size",       color: "text-orange-300 bg-orange-400/10 border-orange-400/20", icon: "◻" },
}

export default function LayoutIssuesModal({ docId, onClose, onJumpToSlide, onFixed }: Props) {
  const [loading, setLoading]   = useState(true)
  const [issues, setIssues]     = useState<LayoutIssue[]>([])
  const [meta, setMeta]         = useState<{ total: number; slide_count: number; fixed: number; by_type: Record<string, number> } | null>(null)
  const [filter, setFilter]     = useState<string>("all")
  const [fixing, setFixing]     = useState(false)
  const [error, setError]       = useState("")

  const load = async (withFix = false) => {
    if (withFix) setFixing(true)
    else setLoading(true)
    setError("")
    try {
      const r = await detectLayoutIssues(docId, withFix)
      setIssues(r.issues)
      setMeta({ total: r.total, slide_count: r.slide_count, fixed: r.fixed, by_type: r.by_type })
      if (withFix && r.fixed > 0) onFixed()
    } catch {
      setError("Failed to scan layout")
    } finally {
      setLoading(false)
      setFixing(false)
    }
  }

  useEffect(() => { load() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === "all" ? issues : issues.filter((i) => i.issue === filter)
  const issueTypes = [...new Set(issues.map((i) => i.issue))]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Layout Issues</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect out-of-bounds, overlaps, and sizing problems</p>
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
              <p className="text-sm">Scanning layout…</p>
            </div>
          ) : (
            <>
              {/* summary */}
              <div className="flex items-center gap-3">
                {meta && (
                  <>
                    <span className="text-white/40 text-xs flex-1">
                      {meta.total === 0 ? "No layout issues found" : `${meta.total} issue${meta.total !== 1 ? "s" : ""} across ${meta.slide_count} slides`}
                    </span>
                    {meta.by_type["out-of-bounds"] > 0 && (
                      <button
                        onClick={() => load(true)}
                        disabled={fixing}
                        className="text-xs px-2.5 py-1 rounded border border-amber-400/30 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 transition-colors"
                      >
                        {fixing ? "Fixing…" : `Auto-fix ${meta.by_type["out-of-bounds"]} out-of-bounds`}
                      </button>
                    )}
                    <button
                      onClick={() => load()}
                      className="text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                      Rescan
                    </button>
                  </>
                )}
              </div>

              {/* type filter */}
              {issueTypes.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilter("all")}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === "all" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    All ({issues.length})
                  </button>
                  {issueTypes.map((t) => {
                    const m = ISSUE_META[t] ?? { label: t, color: "text-white/50 bg-white/5 border-white/10", icon: "•" }
                    const cnt = issues.filter((i) => i.issue === t).length
                    return (
                      <button
                        key={t}
                        onClick={() => setFilter(t)}
                        className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === t ? m.color : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                      >
                        {m.icon} {m.label} ({cnt})
                      </button>
                    )
                  })}
                </div>
              )}

              {issues.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="text-3xl">✓</div>
                  <p className="text-white/50 text-sm">No layout issues detected</p>
                  <p className="text-white/25 text-xs">All elements are within slide bounds and properly sized</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((issue, i) => {
                    const m = ISSUE_META[issue.issue] ?? { label: issue.issue, color: "text-white/50 bg-white/5 border-white/10", icon: "•" }
                    return (
                      <div key={i} className={`rounded-lg border px-4 py-3 ${m.color}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-lg shrink-0">{m.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white text-sm font-medium truncate">{issue.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${m.color}`}>{m.label}</span>
                            </div>
                            <p className="text-white/50 text-xs mt-0.5">{issue.detail}</p>
                          </div>
                          <button
                            onClick={() => { onJumpToSlide(issue.slide_n); onClose() }}
                            className="text-xs text-white/30 hover:text-white/60 shrink-0 transition-colors"
                          >
                            Slide {issue.slide_n} ↗
                          </button>
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
