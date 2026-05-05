import { useState, useEffect } from "react"
import { fetchSectionWordCounts } from "../../lib/studioApi"
import type { SectionWordCount } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SectionWordCountModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ sections: SectionWordCount[]; total_words: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchSectionWordCounts(docId)
      .then(setData)
      .catch(() => setError("Failed to load section word counts"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxWords = data && data.sections.length > 0 ? Math.max(...data.sections.map((s) => s.word_count)) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Section Word Counts</h2>
            <p className="text-white/40 text-xs mt-0.5">Word distribution across deck sections</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Counting words…</span>
            </div>
          ) : data && (
            <>
              <div className="flex gap-4 text-xs text-white/40">
                <span>{data.total_words.toLocaleString()} total words</span>
                <span>·</span>
                <span>{data.sections.length} sections</span>
              </div>

              <div className="space-y-2">
                {data.sections.map((sec, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-sm font-medium truncate flex-1 mr-2">{sec.name}</span>
                      <span className="text-white/40 text-xs font-mono shrink-0">{sec.word_count.toLocaleString()} words</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-accent/50 rounded-full"
                        style={{ width: `${(sec.word_count / maxWords) * 100}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {sec.slides.map((n) => (
                        <button
                          key={n}
                          onClick={() => { onJumpToSlide(n); onClose() }}
                          className="text-[10px] text-accent/60 hover:text-accent transition-colors bg-white/3 rounded px-1.5 py-0.5"
                        >
                          Slide {n}
                        </button>
                      ))}
                    </div>
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
