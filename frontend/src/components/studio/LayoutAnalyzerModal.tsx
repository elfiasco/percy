import { useState, useEffect } from "react"
import { fetchLayoutIssues } from "../../lib/studioApi"
import type { SlideLayoutIssues } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const ISSUE_ICON: Record<string, string> = {
  out_of_bounds: "⬚",
  zero_size:     "✕",
  overlap:       "⊠",
}

const ISSUE_COLOR: Record<string, string> = {
  out_of_bounds: "text-red-400 border-red-400/20 bg-red-400/5",
  zero_size:     "text-orange-400 border-orange-400/20 bg-orange-400/5",
  overlap:       "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
}

export default function LayoutAnalyzerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ slides_with_issues: SlideLayoutIssues[]; total_issues: number; slide_count: number; clean: boolean } | null>(null)
  const [error, setError]       = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filter, setFilter]     = useState<"all" | "out_of_bounds" | "zero_size" | "overlap">("all")

  useEffect(() => {
    fetchLayoutIssues(docId)
      .then(setData)
      .catch(() => setError("Failed to analyze layout"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data?.slides_with_issues.map((s) => ({
    ...s,
    issues: filter === "all" ? s.issues : s.issues.filter((i) => i.issue === filter),
  })).filter((s) => s.issues.length > 0) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Layout Analyzer</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect misaligned, overlapping, or out-of-bounds elements</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing layout…</p>
            </div>
          ) : data && (
            <>
              {data.clean ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="text-3xl">✓</div>
                  <p className="text-white/50 text-sm">No layout issues found</p>
                  <p className="text-white/25 text-xs">All elements are within bounds and non-overlapping</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-red-400 text-xs font-medium">{data.total_issues} issue{data.total_issues !== 1 ? "s" : ""}</span>
                    <span className="text-white/25 text-xs">across {data.slides_with_issues.length} slide{data.slides_with_issues.length !== 1 ? "s" : ""}</span>
                    <div className="ml-auto flex gap-1.5">
                      {(["all", "out_of_bounds", "zero_size", "overlap"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/35 hover:text-white/60"}`}
                        >
                          {f === "all" ? "All" : f === "out_of_bounds" ? "Out of bounds" : f === "zero_size" ? "Zero size" : "Overlap"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {filtered.map((s) => (
                      <div key={s.slide_n} className="rounded-lg border border-white/10 overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/3 hover:bg-white/6 text-left"
                          onClick={() => setExpanded(expanded === s.slide_n ? null : s.slide_n)}
                        >
                          <span className="text-white/60 text-xs flex-1">Slide {s.slide_n}</span>
                          <span className="text-white/30 text-xs">{s.issues.length} issue{s.issues.length !== 1 ? "s" : ""}</span>
                          <span className="text-white/25 text-xs ml-2">{expanded === s.slide_n ? "▲" : "▼"}</span>
                        </button>
                        {expanded === s.slide_n && (
                          <div className="px-4 py-3 space-y-2 border-t border-white/8">
                            <button
                              onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                              className="text-xs text-accent/60 hover:text-accent transition-colors"
                            >
                              Go to slide {s.slide_n} ↗
                            </button>
                            {s.issues.map((issue, i) => (
                              <div key={i} className={`rounded border px-3 py-2 text-xs ${ISSUE_COLOR[issue.issue]}`}>
                                <div className="flex items-center gap-2">
                                  <span>{ISSUE_ICON[issue.issue]}</span>
                                  <span className="font-medium capitalize">{issue.issue.replace(/_/g, " ")}</span>
                                  <span className="opacity-60 truncate ml-1">{issue.label}</span>
                                </div>
                                <p className="mt-0.5 opacity-65 text-[10px] leading-relaxed">{issue.detail}</p>
                              </div>
                            ))}
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
