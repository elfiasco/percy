import { useState } from "react"
import { fetchCompetitorMentionFinder } from "../../lib/studioApi"
import type { CompetitorMentionResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const framingColor: Record<string, string> = {
  positive:    "text-green-400 border-green-400/20 bg-green-400/8",
  negative:    "text-red-400 border-red-400/20 bg-red-400/8",
  neutral:     "text-white/40 border-white/10 bg-white/5",
  comparative: "text-blue-400 border-blue-400/20 bg-blue-400/8",
}

export default function CompetitorMentionFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<CompetitorMentionResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchCompetitorMentionFinder(docId)
      setData(res)
    } catch {
      setError("Failed to find competitor mentions")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Competitor Mention Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies competitor brand names and references</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for competitors…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Found: <span className="text-white/70">{data.total} mention{data.total !== 1 ? "s" : ""}</span></span>
              </div>

              {data.summary && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.summary}</p>
                </div>
              )}

              {data.mentions.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No competitor mentions found.</div>
              ) : (
                <div className="space-y-2">
                  {data.mentions.map((m, i) => (
                    <button key={i} onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {m.slide_n}</span>
                      <div className="flex-1 space-y-0.5">
                        <p className="text-[11px] text-white/70 font-medium">{m.competitor}</p>
                        <p className="text-[10px] text-white/40 leading-snug">{m.context}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${framingColor[m.framing] ?? "text-white/40 border-white/10 bg-white/5"}`}>{m.framing}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Scan" to find competitor mentions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>
      </div>
    </div>
  )
}
