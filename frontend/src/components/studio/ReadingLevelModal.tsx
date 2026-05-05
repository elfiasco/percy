import { useState, useEffect } from "react"
import { fetchReadingLevel } from "../../lib/studioApi"
import type { SlideReadingMetrics } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_META: Record<string, { color: string; icon: string }> = {
  "Easy":     { color: "text-green-300 bg-green-400/10 border-green-400/20",    icon: "✓" },
  "Standard": { color: "text-blue-300 bg-blue-400/10 border-blue-400/20",       icon: "◉" },
  "Difficult":{ color: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20", icon: "⚠" },
  "Complex":  { color: "text-red-300 bg-red-400/10 border-red-400/20",          icon: "⛔" },
  "Empty":    { color: "text-white/20 bg-white/5 border-white/10",              icon: "—" },
}

function GradeBar({ ease }: { ease: number }) {
  const clamped = Math.max(0, Math.min(100, ease))
  const color = ease >= 80 ? "bg-green-400" : ease >= 60 ? "bg-blue-400" : ease >= 40 ? "bg-yellow-400" : "bg-red-400"
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-white/40 text-[10px] font-mono w-8 text-right shrink-0">{ease.toFixed(0)}</span>
    </div>
  )
}

export default function ReadingLevelModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideReadingMetrics[]; overall: SlideReadingMetrics | null; slide_count: number } | null>(null)
  const [error, setError]     = useState("")
  const [sortBy, setSortBy]   = useState<"slide" | "ease">("slide")

  useEffect(() => {
    fetchReadingLevel(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to compute reading levels"))
      .finally(() => setLoading(false))
  }, [docId])

  const sorted = data
    ? [...data.slides].sort((a, b) =>
        sortBy === "ease"
          ? ((a.reading_ease ?? 999) - (b.reading_ease ?? 999))
          : (a.slide_n - b.slide_n)
      )
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Reading Level</h2>
            <p className="text-white/40 text-xs mt-0.5">Flesch-Kincaid reading ease per slide</p>
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
              <p className="text-sm">Analyzing text…</p>
            </div>
          ) : data && (
            <>
              {/* overall stats */}
              {data.overall && (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Reading Ease",  value: data.overall.reading_ease?.toFixed(1) ?? "—" },
                    { label: "Grade Level",   value: data.overall.grade_level?.toFixed(1) ?? "—" },
                    { label: "Overall",       value: data.overall.label },
                    { label: "Word Count",    value: data.overall.word_count.toLocaleString() },
                  ].map((s) => (
                    <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center">
                      <div className="text-white font-medium text-sm">{s.value}</div>
                      <div className="text-white/30 text-[10px] mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* legend */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(LABEL_META).filter(([k]) => k !== "Empty").map(([label, m]) => (
                  <div key={label} className={`px-2 py-0.5 rounded border text-xs ${m.color}`}>
                    {m.icon} {label}
                  </div>
                ))}
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-white/30 text-xs">Sort:</span>
                  {(["slide", "ease"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${sortBy === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      {s === "slide" ? "Slide #" : "Ease ↑"}
                    </button>
                  ))}
                </div>
              </div>

              {/* slide list */}
              <div className="space-y-1">
                {sorted.map((slide) => {
                  const m = LABEL_META[slide.label] ?? LABEL_META["Standard"]
                  const ease = slide.reading_ease
                  return (
                    <div
                      key={slide.slide_n}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 bg-white/3 hover:bg-white/5 cursor-pointer group"
                      onClick={() => { onJumpToSlide(slide.slide_n); onClose() }}
                    >
                      <span className="text-white/40 text-xs font-mono w-14 shrink-0">Slide {slide.slide_n}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${m.color}`}>{m.icon} {slide.label}</span>
                      <div className="flex-1">
                        {ease !== null
                          ? <GradeBar ease={ease} />
                          : <span className="text-white/20 text-xs">—</span>}
                      </div>
                      {slide.grade_level !== null && (
                        <span className="text-white/30 text-xs font-mono shrink-0">Gr.{slide.grade_level.toFixed(1)}</span>
                      )}
                      <span className="text-white/20 text-[10px] group-hover:text-white/50 transition-colors shrink-0">↗</span>
                    </div>
                  )
                })}
              </div>

              <div className="text-white/25 text-xs text-center pt-2">
                Higher ease score = easier to read. Grade level = US school grade equivalent.
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
