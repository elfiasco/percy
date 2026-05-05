import { useState, useEffect } from "react"
import { fetchPlaceholderFinder } from "../../lib/studioApi"
import type { PlaceholderSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PlaceholderFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: PlaceholderSlide[]; total_slides: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchPlaceholderFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find placeholders"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Placeholder Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Detect TODO, TBD, [placeholder] text</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning for placeholders…</span>
            </div>
          ) : data && (
            data.total_slides === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No placeholder text found — deck looks complete!
              </div>
            ) : (
              <>
                <div className="text-red-400/70 text-xs">
                  {data.total_slides} slide{data.total_slides !== 1 ? "s" : ""} with placeholder content
                </div>
                <div className="space-y-2">
                  {data.slides.map((s) => (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <button
                          onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors"
                        >
                          Slide {s.slide_n}
                        </button>
                        <span className="text-white/25 text-xs ml-auto">{s.count} match{s.count !== 1 ? "es" : ""}</span>
                      </div>
                      <div className="px-3 py-2 space-y-1">
                        {s.matches.map((m, i) => (
                          <div key={i} className="text-xs">
                            <span className="text-red-400/70 font-mono bg-red-400/10 px-1 rounded">{m.match}</span>
                            {m.context && <span className="text-white/30 ml-1 italic">…{m.context}…</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
