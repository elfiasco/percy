import { useState, useEffect } from "react"
import { fetchAbbreviationFinder } from "../../lib/studioApi"
import type { AbbreviationResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function AbbreviationFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AbbreviationResult | null>(null)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchAbbreviationFinder(docId)
      .then(setData)
      .catch(() => setError("Failed to find abbreviations"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? data.abbreviations.filter(a => a.abbr.toLowerCase().includes(search.toLowerCase()))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Abbreviation Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">All uppercase abbreviations and acronyms detected in slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning abbreviations…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter abbreviations…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 placeholder-white/20 outline-none focus:border-accent/40"
                />
                <span className="text-[10px] text-white/30 shrink-0">{filtered.length} shown</span>
              </div>

              {filtered.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No abbreviations found.</div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 border border-white/5 rounded-lg px-3 py-2">
                      <span className="text-[11px] text-white/80 font-mono font-semibold w-16 shrink-0">{a.abbr}</span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {a.slides.map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[9px] text-accent/70 bg-accent/8 border border-accent/20 px-1.5 py-0.5 rounded hover:bg-accent/20 transition-colors">
                            s{n}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] text-white/20 shrink-0">{a.slides.length}×</span>
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
