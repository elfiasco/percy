import { useState, useEffect } from "react"
import { fetchSpeakerNoteLengthChecker } from "../../lib/studioApi"
import type { SpeakerNoteLengthResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SpeakerNoteLengthCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SpeakerNoteLengthResult | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "issues">("issues")

  useEffect(() => {
    setLoading(true)
    fetchSpeakerNoteLengthChecker(docId)
      .then(setData)
      .catch(() => setError("Failed to check speaker note lengths"))
      .finally(() => setLoading(false))
  }, [docId])

  const slides = data ? data.per_slide.filter(s => {
    if (filter === "issues") return s.too_short || s.too_long || s.word_count === 0
    return true
  }) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Speaker Note Length Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Flags missing, too-short, or too-long speaker notes</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking speaker notes…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>Avg: <span className="text-white/70">{data.avg_words}w</span></span>
                  <span>No notes: <span className="text-red-400">{data.no_notes.length}</span></span>
                  <span>Too short: <span className="text-yellow-400">{data.too_short.length}</span></span>
                  <span>Too long: <span className="text-blue-400">{data.too_long.length}</span></span>
                </div>
                <div className="flex gap-1">
                  {(["issues", "all"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${filter === f ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {slides.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">
                  {filter === "issues" ? "All speaker notes look good." : "No slides found."}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {slides.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 space-y-0.5">
                        {s.preview ? (
                          <p className="text-[11px] text-white/50 leading-snug truncate">{s.preview}</p>
                        ) : (
                          <p className="text-[11px] text-white/20 italic">no notes</p>
                        )}
                        <div className="flex gap-1.5 mt-0.5">
                          {s.word_count === 0 && <span className="text-[10px] text-red-400/70 border border-red-400/20 bg-red-400/8 px-1 rounded">empty</span>}
                          {s.too_short && <span className="text-[10px] text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/8 px-1 rounded">too short</span>}
                          {s.too_long && <span className="text-[10px] text-blue-400/70 border border-blue-400/20 bg-blue-400/8 px-1 rounded">too long</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0">{s.word_count}w</span>
                    </button>
                  ))}
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
