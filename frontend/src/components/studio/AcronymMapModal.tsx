import { useState, useEffect } from "react"
import { fetchAcronymMap } from "../../lib/studioApi"
import type { AcronymMapEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function AcronymMapModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ acronyms: AcronymMapEntry[]; total_unique: number } | null>(null)
  const [error, setError]     = useState("")
  const [search, setSearch]   = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchAcronymMap(docId))
    } catch {
      setError("Failed to build acronym map")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const acronyms = data ? data.acronyms.filter(a =>
    !search || a.acronym.toLowerCase().includes(search.toLowerCase())
  ) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Acronym Map</h2>
            <p className="text-white/40 text-xs mt-0.5">All capital-letter acronyms and their slide locations</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Building map…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">{data.total_unique} unique acronym{data.total_unique !== 1 ? "s" : ""}</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/25 outline-none focus:border-accent/40 w-28"
                />
              </div>

              {acronyms.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No acronyms found.</div>
              ) : (
                <div className="space-y-1.5">
                  {acronyms.map((a) => (
                    <div key={a.acronym} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <span className="text-xs font-mono font-bold text-white/80 w-16 shrink-0">{a.acronym}</span>
                      <span className="text-white/30 text-[10px] shrink-0">{a.count}×</span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {a.slides.map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 bg-accent/8 text-accent/70 hover:text-accent transition-colors">
                            s{n}
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
            {loading ? "Building…" : "Re-build"}
          </button>
        </div>
      </div>
    </div>
  )
}
