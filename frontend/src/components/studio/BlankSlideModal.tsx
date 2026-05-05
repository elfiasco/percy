import { useState, useEffect } from "react"
import { findBlankSlides } from "../../lib/studioApi"
import type { BlankSlideInfo } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TYPE_STYLE: Record<string, string> = {
  empty:   "text-red-400 bg-red-400/8 border-red-400/20",
  no_text: "text-orange-400 bg-orange-400/8 border-orange-400/20",
  sparse:  "text-yellow-400 bg-yellow-400/8 border-yellow-400/20",
}

const TYPE_DESC: Record<string, string> = {
  empty:   "Completely empty",
  no_text: "Has elements but no text",
  sparse:  "Very little text",
}

export default function BlankSlideModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ blank: BlankSlideInfo[]; sparse: BlankSlideInfo[]; total_empty: number; total_sparse: number; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [minWords, setMinWords] = useState(3)

  const load = async (w = minWords) => {
    setLoading(true)
    setError("")
    try {
      const r = await findBlankSlides(docId, w)
      setData(r)
    } catch {
      setError("Failed to find blank slides")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const all = data ? [...data.blank, ...data.sparse].sort((a, b) => a.slide_n - b.slide_n) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Blank Slide Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Find slides with no or very little content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <label className="text-white/60 text-xs">Min words threshold:</label>
            {[1, 3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => { setMinWords(n); load(n) }}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${minWords === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >
                {n}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning…</span>
            </div>
          ) : data && (
            <>
              {all.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="text-3xl text-green-400">✓</div>
                  <p className="text-white/50 text-sm">All slides have content above the threshold.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-red-400/8 border border-red-400/20 rounded-lg px-3 py-2 text-center">
                      <div className="text-red-400 font-semibold text-lg">{data.total_empty}</div>
                      <div className="text-white/35 text-xs mt-0.5">Empty / no text</div>
                    </div>
                    <div className="bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-2 text-center">
                      <div className="text-yellow-400 font-semibold text-lg">{data.total_sparse}</div>
                      <div className="text-white/35 text-xs mt-0.5">Sparse (&lt;{minWords} words)</div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {all.map((s) => (
                      <div key={s.slide_n} className={`rounded-lg border px-4 py-2.5 flex items-center gap-3 ${TYPE_STYLE[s.type]}`}>
                        <div className="flex-1">
                          <span className="font-medium text-sm">Slide {s.slide_n}</span>
                          <span className="ml-2 text-xs opacity-60">— {TYPE_DESC[s.type]}</span>
                          {s.words > 0 && <span className="ml-2 text-xs opacity-40">({s.words} word{s.words !== 1 ? "s" : ""})</span>}
                        </div>
                        <button
                          onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                        >
                          Go ↗
                        </button>
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
