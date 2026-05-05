/**
 * DocStatsModal — shows document statistics: slide count, element counts by type, word count.
 */

import { useEffect, useState } from "react"
import { fetchDocStats } from "../../lib/studioApi"
import type { DocStats } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  BridgeShape:     "Shapes",
  BridgeText:      "Text Boxes",
  BridgeChart:     "Charts",
  BridgeTable:     "Tables",
  BridgeImage:     "Images",
  BridgeFreeform:  "Freeforms",
  BridgeConnector: "Connectors",
  BridgeGroup:     "Groups",
}

const TYPE_COLOR: Record<string, string> = {
  BridgeShape:     "bg-paper",
  BridgeText:      "bg-green-500",
  BridgeChart:     "bg-amber-500",
  BridgeTable:     "bg-paper",
  BridgeImage:     "bg-pink-500",
  BridgeFreeform:  "bg-cyan-500",
  BridgeConnector: "bg-slate-400",
  BridgeGroup:     "bg-slate-500",
}

export default function DocStatsModal({ docId, onClose }: Props) {
  const [stats, setStats]   = useState<DocStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDocStats(docId)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[420px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <span className="text-sm font-semibold text-slate-200">📊 Document Stats</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-xs text-muted animate-pulse text-center">Loading…</div>
        ) : stats ? (
          <div className="p-5 space-y-4">
            {/* summary row */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Slides",   value: stats.slide_count },
                { label: "Elements", value: stats.total_elements },
                { label: "Words",    value: stats.word_count },
                { label: "Hidden",   value: stats.hidden_count ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="bg-base/60 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-slate-200">{value.toLocaleString()}</div>
                  <div className="text-[10px] text-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* duration estimate */}
            {(stats.word_count > 0 || stats.notes_word_count > 0) && (() => {
              const totalWords = stats.word_count + stats.notes_word_count
              const minMins = Math.max(1, Math.floor(totalWords / 130))
              const maxMins = Math.max(1, Math.ceil(totalWords / 100))
              return (
                <div className="bg-paper/10 border border-paper/20 rounded-lg px-4 py-3 flex items-center gap-3">
                  <span className="text-2xl">⏱</span>
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{minMins}–{maxMins} min</div>
                    <div className="text-[10px] text-muted">estimated presentation time · {totalWords.toLocaleString()} total words
                      {stats.notes_word_count > 0 && ` (${stats.notes_word_count.toLocaleString()} in notes)`}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* notes coverage */}
            {stats.slides_with_notes !== undefined && (
              <div className="bg-base/60 rounded-lg px-4 py-3">
                <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Notes Coverage</div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-white/10 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        (stats.notes_coverage_pct ?? 0) >= 80 ? "bg-emerald-500" :
                        (stats.notes_coverage_pct ?? 0) >= 40 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${stats.notes_coverage_pct ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-300 shrink-0">
                    {stats.slides_with_notes} / {stats.slide_count} slides ({stats.notes_coverage_pct}%)
                  </span>
                </div>
                {stats.section_count !== undefined && stats.section_count > 0 && (
                  <div className="mt-2 text-[10px] text-paper/70">
                    {stats.section_count} section{stats.section_count !== 1 ? "s" : ""}: {(stats.sections ?? []).join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* ratings distribution */}
            {stats.rated_count !== undefined && stats.rated_count > 0 && (
              <div>
                <div className="text-[10px] text-muted uppercase tracking-widest mb-2">
                  Ratings ({stats.rated_count} of {stats.slide_count} rated)
                </div>
                <div className="space-y-1">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = (stats.ratings_distribution ?? {})[star] ?? 0
                    const pct = stats.rated_count! > 0 ? Math.round((count / stats.rated_count!) * 100) : 0
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-[10px] text-amber-400 w-10 shrink-0">{"★".repeat(star)}</span>
                        <div className="flex-1 bg-white/10 rounded-full h-1.5">
                          <div className="bg-amber-400/60 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted font-mono w-6 text-right">{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* sections breakdown */}
            {stats.sections_with_counts && Object.keys(stats.sections_with_counts).length > 0 && (
              <div>
                <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Sections</div>
                <div className="space-y-1">
                  {Object.entries(stats.sections_with_counts).map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between py-0.5 border-b border-edge/20 last:border-0">
                      <span className="text-xs text-paper/80 truncate">§ {name}</span>
                      <span className="text-[10px] text-muted/60 font-mono shrink-0 ml-2">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* element type breakdown */}
            {Object.keys(stats.type_counts).length > 0 && (
              <div>
                <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Element Types</div>
                <div className="space-y-1.5">
                  {Object.entries(stats.type_counts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const pct = stats.total_elements > 0
                        ? Math.round((count / stats.total_elements) * 100)
                        : 0
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${TYPE_COLOR[type] ?? "bg-slate-500"}`} />
                          <span className="text-xs text-slate-300 flex-1">{TYPE_LABEL[type] ?? type}</span>
                          <span className="text-xs font-mono text-muted">{count}</span>
                          <div className="w-20 bg-white/10 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${TYPE_COLOR[type] ?? "bg-slate-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted w-8 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-8 text-xs text-muted text-center">Failed to load stats</div>
        )}
      </div>
    </div>
  )
}
