import { useState, useEffect } from "react"
import { findDuplicateText } from "../../lib/studioApi"
import type { DuplicateGroup } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const THRESHOLD_OPTIONS = [
  { label: "Strict (95%)", value: 0.95 },
  { label: "High (85%)",   value: 0.85 },
  { label: "Medium (70%)", value: 0.70 },
  { label: "Loose (55%)",  value: 0.55 },
]

export default function DuplicateFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]     = useState(false)
  const [data, setData]           = useState<{ duplicates: DuplicateGroup[]; total_groups: number; slide_count: number; threshold: number } | null>(null)
  const [error, setError]         = useState("")
  const [threshold, setThreshold] = useState(0.85)
  const [expanded, setExpanded]   = useState<number | null>(null)

  const scan = async (t = threshold) => {
    setLoading(true)
    setError("")
    try {
      const r = await findDuplicateText(docId, t)
      setData(r)
      setExpanded(null)
    } catch {
      setError("Failed to scan for duplicates")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { scan() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Duplicate Content Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect slides with near-identical text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* threshold selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/40 text-xs">Similarity threshold:</span>
            {THRESHOLD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setThreshold(opt.value); scan(opt.value) }}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${threshold === opt.value ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
              >
                {opt.label}
              </button>
            ))}
            <button onClick={() => scan()} className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors">Rescan</button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for duplicates…</p>
            </div>
          ) : data && (
            <>
              {data.total_groups === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="text-3xl">✓</div>
                  <p className="text-white/50 text-sm">No duplicate content found</p>
                  <p className="text-white/25 text-xs">All slides have unique text content above the threshold</p>
                </div>
              ) : (
                <>
                  <div className="text-white/40 text-xs">
                    Found <span className="text-white/70 font-medium">{data.total_groups}</span> pair{data.total_groups !== 1 ? "s" : ""} with {Math.round(threshold * 100)}%+ similarity
                  </div>

                  <div className="space-y-2">
                    {data.duplicates.map((group, idx) => (
                      <div key={idx} className="rounded-lg border border-yellow-400/20 overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-yellow-400/5 hover:bg-yellow-400/10 text-left"
                          onClick={() => setExpanded(expanded === idx ? null : idx)}
                        >
                          <span className="text-yellow-300 text-xs shrink-0">⚠</span>
                          <span className="text-white/70 text-xs flex-1">
                            Slide {group.slides[0]} ↔ Slide {group.slides[1]}
                          </span>
                          <span className="text-yellow-300/70 text-xs font-mono shrink-0">{Math.round(group.similarity * 100)}% similar</span>
                          <span className="text-white/30 text-xs ml-2">{expanded === idx ? "▲" : "▼"}</span>
                        </button>

                        {expanded === idx && (
                          <div className="px-4 py-3 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              {group.slides.map((n, i) => (
                                <div key={n} className="space-y-1">
                                  <button
                                    onClick={() => { onJumpToSlide(n); onClose() }}
                                    className="text-xs text-accent/70 hover:text-accent transition-colors"
                                  >
                                    Slide {n} ↗
                                  </button>
                                  <p className="text-white/40 text-xs bg-white/5 rounded px-2 py-1.5 leading-relaxed">
                                    {group.previews[i] || "—"}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <p className="text-white/25 text-[10px]">
                              {group.shared_words} shared words. Consider merging or differentiating these slides.
                            </p>
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
