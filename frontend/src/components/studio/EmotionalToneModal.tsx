import { useState, useEffect } from "react"
import { fetchEmotionalTone } from "../../lib/studioApi"
import type { SlideToneResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TONE_META: Record<string, { color: string; emoji: string }> = {
  "Inspiring":    { color: "text-paper bg-paper/10 border-paper/20",   emoji: "✨" },
  "Urgent":       { color: "text-red-300 bg-red-400/10 border-red-400/20",            emoji: "⚡" },
  "Calm":         { color: "text-blue-300 bg-blue-400/10 border-blue-400/20",         emoji: "☁" },
  "Analytical":   { color: "text-cyan-300 bg-cyan-400/10 border-cyan-400/20",         emoji: "◎" },
  "Cautionary":   { color: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20",   emoji: "⚠" },
  "Motivational": { color: "text-orange-300 bg-orange-400/10 border-orange-400/20",   emoji: "🔥" },
  "Neutral":      { color: "text-white/40 bg-white/5 border-white/10",                emoji: "◉" },
  "Celebratory":  { color: "text-green-300 bg-green-400/10 border-green-400/20",      emoji: "★" },
}

export default function EmotionalToneModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: SlideToneResult[]; tone_distribution: Record<string, number>; dominant_tone: string; slide_count: number } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<string>("all")

  useEffect(() => {
    fetchEmotionalTone(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to analyze emotional tone"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? data.slides.filter((s) => filter === "all" || s.tone === filter)
    : []

  const tones = data ? Object.keys(data.tone_distribution) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Emotional Tone Analyzer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI-detected tone and emotional register per slide</p>
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
              <p className="text-sm">Analyzing tone…</p>
            </div>
          ) : data && (
            <>
              {/* dominant tone */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-white/40 text-xs">Dominant tone:</span>
                  {(() => {
                    const m = TONE_META[data.dominant_tone] ?? TONE_META["Neutral"]
                    return (
                      <span className={`text-sm font-medium px-2 py-0.5 rounded border ${m.color}`}>
                        {m.emoji} {data.dominant_tone}
                      </span>
                    )
                  })()}
                </div>
              </div>

              {/* distribution */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setFilter("all")}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === "all" ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  All ({data.slide_count})
                </button>
                {tones.map((tone) => {
                  const m = TONE_META[tone] ?? TONE_META["Neutral"]
                  const cnt = data.tone_distribution[tone]
                  return (
                    <button
                      key={tone}
                      onClick={() => setFilter(tone)}
                      className={`px-2.5 py-1 rounded text-xs border transition-colors ${filter === tone ? m.color : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      {m.emoji} {tone} ({cnt})
                    </button>
                  )
                })}
              </div>

              {/* slide list */}
              <div className="space-y-1.5">
                {filtered.map((slide) => {
                  const m = TONE_META[slide.tone] ?? TONE_META["Neutral"]
                  return (
                    <div
                      key={slide.slide_n}
                      className="flex items-start gap-3 rounded-lg px-4 py-3 bg-white/3 hover:bg-white/5 cursor-pointer group border border-white/5 hover:border-white/10"
                      onClick={() => { onJumpToSlide(slide.slide_n); onClose() }}
                    >
                      <span className="text-white/40 text-xs font-mono w-14 shrink-0 mt-0.5">Slide {slide.slide_n}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${m.color}`}>{m.emoji} {slide.tone}</span>
                          <span className={`text-[10px] ${slide.confidence === "high" ? "text-white/40" : "text-white/20"}`}>{slide.confidence}</span>
                        </div>
                        {slide.note && (
                          <p className="text-white/40 text-xs mt-1 leading-relaxed">{slide.note}</p>
                        )}
                      </div>
                      <span className="text-white/20 text-xs group-hover:text-white/50 transition-colors mt-0.5 shrink-0">↗</span>
                    </div>
                  )
                })}
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
