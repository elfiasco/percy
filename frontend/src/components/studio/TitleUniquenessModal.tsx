import { useState, useEffect } from "react"
import { fetchTitleUniqueness } from "../../lib/studioApi"
import type { TitleDuplicate } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TitleUniquenessModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ duplicates: TitleDuplicate[]; unique: number; total: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchTitleUniqueness(docId))
    } catch {
      setError("Failed to check title uniqueness")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Title Uniqueness</h2>
            <p className="text-white/40 text-xs mt-0.5">Find duplicate slide titles across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Checking titles…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Total titles: <span className="text-white/70">{data.total}</span></span>
                <span>Unique: <span className="text-green-400/70">{data.unique}</span></span>
                <span>Duplicated: <span className="text-red-400/70">{data.duplicates.length}</span></span>
              </div>

              {data.duplicates.length === 0 ? (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  All slide titles are unique.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.duplicates.map((d, i) => (
                    <div key={i} className="bg-white/3 border border-red-400/15 rounded-lg px-3 py-2.5 space-y-1.5">
                      <p className="text-white/70 text-xs font-medium capitalize">"{d.title}"</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[10px]">Used on:</span>
                        {d.slides.map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-red-400/20 bg-red-400/8 text-red-300/70 hover:text-red-300 transition-colors">
                            Slide {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Checking…" : "Re-check"}
          </button>
        </div>
      </div>
    </div>
  )
}
