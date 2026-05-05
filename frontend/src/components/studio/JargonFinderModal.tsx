import { useState } from "react"
import { fetchJargonFinder } from "../../lib/studioApi"
import type { JargonFinderResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const riskStyle: Record<string, string> = {
  high:   "text-red-400 border-red-400/20 bg-red-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  low:    "text-green-400 border-green-400/20 bg-green-400/8",
}

export default function JargonFinderModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<JargonFinderResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchJargonFinder(docId)
      setData(res)
    } catch {
      setError("Failed to find jargon")
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
            <h2 className="text-white font-semibold text-sm">Jargon Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies technical terms that may confuse a general audience</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for jargon…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-2">
              {data.jargon.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-6">No problematic jargon found.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.jargon.length} term{data.jargon.length !== 1 ? "s" : ""} flagged</p>
                  {[...data.jargon].sort((a, b) => {
                    const order = { high: 0, medium: 1, low: 2 }
                    return (order[a.audience_risk] ?? 1) - (order[b.audience_risk] ?? 1)
                  }).map((j, i) => (
                    <div key={i} className="border border-white/8 rounded-lg overflow-hidden">
                      <button onClick={() => { onJumpToSlide(j.slide_n); onClose() }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                        <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {j.slide_n}</span>
                        <span className="flex-1 text-[11px] text-white/70 font-medium">{j.term}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${riskStyle[j.audience_risk] ?? "text-white/40 border-white/10"}`}>{j.audience_risk}</span>
                      </button>
                      <div className="border-t border-white/5 px-4 py-2 flex items-center gap-2">
                        <span className="text-[9px] text-white/20">→</span>
                        <p className="text-[10px] text-accent/60">{j.suggestion}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find" to detect industry jargon.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Find"}
          </button>
        </div>
      </div>
    </div>
  )
}
