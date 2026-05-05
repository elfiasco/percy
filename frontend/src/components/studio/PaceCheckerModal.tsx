import { useState, useEffect } from "react"
import { fetchPaceCheck } from "../../lib/studioApi"
import type { PaceViolation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function PaceCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [maxWords, setMaxWords] = useState(75)
  const [data, setData]       = useState<{ violations: PaceViolation[]; total: number; max_words: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async (mw: number) => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchPaceCheck(docId, mw))
    } catch {
      setError("Failed to run pace check")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run(maxWords) }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Pace Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">Find slides that are too wordy to present at pace</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Max words per slide:</span>
            {[50, 75, 100, 150].map((n) => (
              <button
                key={n}
                onClick={() => { setMaxWords(n); run(n) }}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${maxWords === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >
                {n}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Checking…</span>
            </div>
          ) : data && (
            data.total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                All slides are within the {data.max_words}-word limit.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/70 text-xs">
                  {data.total} slide{data.total !== 1 ? "s" : ""} over the {data.max_words}-word limit
                </div>
                <div className="space-y-1.5">
                  {data.violations.map((v) => (
                    <div key={v.slide_n} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded px-3 py-2">
                      <button
                        onClick={() => { onJumpToSlide(v.slide_n); onClose() }}
                        className="text-xs text-accent/70 hover:text-accent transition-colors shrink-0"
                      >
                        Slide {v.slide_n}
                      </button>
                      <div className="flex-1">
                        <div className="flex gap-3 text-xs">
                          <span className="text-white/60">{v.word_count} words</span>
                          <span className="text-red-400/60">+{v.over_by} over</span>
                        </div>
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
