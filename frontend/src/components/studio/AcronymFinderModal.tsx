import { useState, useEffect } from "react"
import { fetchAcronymFinder } from "../../lib/studioApi"
import type { AcronymEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function AcronymFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ acronyms: AcronymEntry[]; total_unique: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchAcronymFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to scan for acronyms"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Acronym Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">Scans for unexplained acronyms and abbreviations</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for acronyms…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="text-xs text-white/40">
                Found <span className="text-white/70">{data.total_unique}</span> unique acronyms
              </div>

              {data.acronyms.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No acronyms found.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.acronyms.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <span className="text-xs text-white/80 font-mono font-semibold w-16 shrink-0">{a.acronym}</span>
                      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                        {a.slides.slice(0, 8).map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 bg-accent/8 text-accent/70 hover:text-accent transition-colors">
                            s{n}
                          </button>
                        ))}
                        {a.slides.length > 8 && <span className="text-[10px] text-white/30">+{a.slides.length - 8}</span>}
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0">{a.count}×</span>
                    </div>
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
