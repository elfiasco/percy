import { useState } from "react"
import { autoTagSlides } from "../../lib/studioApi"
import type { SlideAutoTag } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TAG_COLORS = [
  "bg-paper/15 text-paper border-paper/20",
  "bg-blue-400/15 text-blue-300 border-blue-400/20",
  "bg-green-400/15 text-green-300 border-green-400/20",
  "bg-yellow-400/15 text-yellow-300 border-yellow-400/20",
  "bg-orange-400/15 text-orange-300 border-orange-400/20",
  "bg-red-400/15 text-red-300 border-red-400/20",
  "bg-cyan-400/15 text-cyan-300 border-cyan-400/20",
  "bg-pink-400/15 text-pink-300 border-pink-400/20",
]

const tagColorMap: Record<string, string> = {}
let colorIdx = 0
function getTagColor(tag: string): string {
  if (!tagColorMap[tag]) {
    tagColorMap[tag] = TAG_COLORS[colorIdx % TAG_COLORS.length]
    colorIdx++
  }
  return tagColorMap[tag]
}

export default function AutoTagSlidesModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<{ slides: SlideAutoTag[]; slide_count: number; tagged_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [filterTag, setFilterTag] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await autoTagSlides(docId)
      setResult(r)
    } catch {
      setError("Failed to generate tags")
    } finally {
      setLoading(false)
    }
  }

  const allTags = result
    ? [...new Set(result.slides.flatMap((s) => s.tags))].sort()
    : []

  const filtered = result
    ? result.slides.filter((s) => !filterTag || s.tags.includes(filterTag))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Slide Tags</h2>
            <p className="text-white/40 text-xs mt-0.5">Auto-assign topic tags to each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!result && (
            <div className="text-center space-y-3 py-6">
              <p className="text-white/40 text-sm">AI will analyze each slide and assign 1-3 topic tags based on content.</p>
              <button
                onClick={run}
                disabled={loading}
                className="px-6 py-2.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm hover:bg-accent/25 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center gap-2"><span className="animate-spin">✦</span> Analyzing slides…</span>
                ) : "Generate Tags"}
              </button>
            </div>
          )}

          {result && (
            <>
              {/* summary + re-run */}
              <div className="flex items-center gap-3">
                <span className="text-white/50 text-xs flex-1">
                  {result.tagged_count} of {result.slide_count} slides tagged · {allTags.length} unique topics
                </span>
                <button onClick={() => { setResult(null); setFilterTag(null) }} className="text-xs text-white/30 hover:text-white/60">Re-run</button>
              </div>

              {/* tag filter cloud */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterTag(null)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${!filterTag ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTag(tag === filterTag ? null : tag)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${filterTag === tag ? getTagColor(tag) : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {/* slide list */}
              <div className="space-y-1.5">
                {filtered.map((slide) => (
                  <div
                    key={slide.slide_n}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-white/3 hover:bg-white/5 cursor-pointer group"
                    onClick={() => { onJumpToSlide(slide.slide_n); onClose() }}
                  >
                    <span className="text-white/40 text-xs font-mono w-14 shrink-0">Slide {slide.slide_n}</span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {slide.tags.length > 0
                        ? slide.tags.map((tag) => (
                            <span key={tag} className={`text-xs px-2 py-0.5 rounded-full border ${getTagColor(tag)}`}>{tag}</span>
                          ))
                        : <span className="text-white/20 text-xs">—</span>}
                    </div>
                    <span className="text-white/20 text-xs group-hover:text-white/50 transition-colors shrink-0">↗</span>
                  </div>
                ))}
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
