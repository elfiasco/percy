import { useState } from "react"
import { keywordSpotlight } from "../../lib/studioApi"
import type { KeywordMatch } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function KeywordSpotlightModal({ docId, onClose, onJumpToSlide }: Props) {
  const [keyword, setKeyword]         = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [matches, setMatches]         = useState<KeywordMatch[] | null>(null)
  const [totalHits, setTotalHits]     = useState(0)
  const [error, setError]             = useState("")
  const [expanded, setExpanded]       = useState<number | null>(null)

  const search = async () => {
    if (!keyword.trim()) return
    setLoading(true)
    setError("")
    setMatches(null)
    try {
      const r = await keywordSpotlight(docId, keyword.trim(), caseSensitive)
      setMatches(r.matches)
      setTotalHits(r.total_hits)
    } catch {
      setError("Search failed")
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search()
  }

  const highlight = (text: string, kw: string, cs: boolean) => {
    const idx = cs ? text.indexOf(kw) : text.toLowerCase().indexOf(kw.toLowerCase())
    if (idx === -1) return <span className="text-white/40 text-xs">{text}</span>
    return (
      <span className="text-white/40 text-xs">
        {text.slice(0, idx)}
        <mark className="bg-yellow-400/25 text-yellow-300 rounded px-0.5">{text.slice(idx, idx + kw.length)}</mark>
        {text.slice(idx + kw.length)}
      </span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Keyword Spotlight</h2>
            <p className="text-white/40 text-xs mt-0.5">Find all slides and elements containing a keyword</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Enter keyword…"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-accent/50"
              autoFocus
            />
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`px-2.5 py-2 rounded-lg text-xs border transition-colors ${caseSensitive ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              title="Case sensitive"
            >
              Aa
            </button>
            <button
              onClick={search}
              disabled={loading || !keyword.trim()}
              className="px-4 py-2 rounded-lg text-xs bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              Search
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Searching…</span>
            </div>
          )}

          {matches !== null && !loading && (
            matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-white/30">
                <p className="text-sm">No matches found for "{keyword}"</p>
              </div>
            ) : (
              <>
                <div className="text-white/40 text-xs">
                  <span className="text-white/70 font-medium">{totalHits}</span> hit{totalHits !== 1 ? "s" : ""} across <span className="text-white/70 font-medium">{matches.length}</span> slide{matches.length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-2">
                  {matches.map((m) => (
                    <div key={m.slide_n} className="rounded-lg border border-yellow-400/20 overflow-hidden">
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-yellow-400/5 hover:bg-yellow-400/10 text-left"
                        onClick={() => setExpanded(expanded === m.slide_n ? null : m.slide_n)}
                      >
                        <span className="text-white/60 text-xs flex-1">Slide {m.slide_n}</span>
                        <span className="text-yellow-300/70 text-xs font-mono">{m.total_hits} hit{m.total_hits !== 1 ? "s" : ""}</span>
                        <span className="text-white/25 text-xs ml-2">{expanded === m.slide_n ? "▲" : "▼"}</span>
                      </button>
                      {expanded === m.slide_n && (
                        <div className="px-4 py-3 space-y-2 border-t border-yellow-400/10">
                          <button
                            onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors"
                          >
                            Go to slide {m.slide_n} ↗
                          </button>
                          {m.elements.map((el, i) => (
                            <div key={i} className="bg-white/3 rounded px-2 py-1.5">
                              <div className="text-white/25 text-[10px] mb-0.5">{el.role || "element"} · {el.count}×</div>
                              {highlight(el.preview, keyword, caseSensitive)}
                            </div>
                          ))}
                        </div>
                      )}
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
