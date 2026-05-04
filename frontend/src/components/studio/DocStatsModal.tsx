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
  BridgeShape:     "bg-indigo-500",
  BridgeText:      "bg-green-500",
  BridgeChart:     "bg-amber-500",
  BridgeTable:     "bg-purple-500",
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
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[380px]"
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
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Slides",   value: stats.slide_count },
                { label: "Elements", value: stats.total_elements },
                { label: "Words",    value: stats.word_count },
              ].map(({ label, value }) => (
                <div key={label} className="bg-base/60 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-200">{value.toLocaleString()}</div>
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
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
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
