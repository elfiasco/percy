import { useState } from "react"
import { fetchAcronymExplainer } from "../../lib/studioApi"
import type { AcronymEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const CAT_COLOR: Record<string, string> = {
  technical: "text-blue-400/70 bg-blue-400/8",
  business:  "text-green-400/70 bg-green-400/8",
  medical:   "text-red-400/70 bg-red-400/8",
  legal:     "text-yellow-400/70 bg-yellow-400/8",
  general:   "text-white/40 bg-white/5",
  unknown:   "text-white/25 bg-white/3",
}

export default function AcronymExplainerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(false)
  const [acronyms, setAcronyms] = useState<AcronymEntry[] | null>(null)
  const [error, setError]       = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchAcronymExplainer(docId)
      setAcronyms(res.acronyms)
    } catch {
      setError("Failed to find acronyms")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Acronym Explainer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies and explains all acronyms in your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Finding acronyms…</p>
            </div>
          )}

          {acronyms !== null && !loading && (
            acronyms.length === 0 ? (
              <div className="text-white/40 text-xs text-center py-8">No acronyms detected in this deck.</div>
            ) : (
              <div className="space-y-1.5">
                {acronyms.map((a) => (
                  <div key={a.acronym} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 flex items-start gap-3">
                    <span className="text-accent font-bold text-sm w-16 shrink-0">{a.acronym}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/70 text-xs">{a.meaning}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${CAT_COLOR[a.category] ?? CAT_COLOR.general}`}>{a.category}</span>
                        <div className="flex gap-1">
                          {a.slides.slice(0, 6).map((n) => (
                            <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                              className="text-[10px] text-white/25 hover:text-accent/70 bg-white/5 px-1.5 py-0.5 rounded transition-colors">
                              #{n}
                            </button>
                          ))}
                          {a.slides.length > 6 && <span className="text-[10px] text-white/20">+{a.slides.length - 6}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {acronyms === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Find Acronyms" to scan your deck.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Finding…" : "Find Acronyms"}
          </button>
        </div>
      </div>
    </div>
  )
}
