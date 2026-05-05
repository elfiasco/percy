import { useState } from "react"
import { fetchNarrativeGaps } from "../../lib/studioApi"
import type { NarrativeGap } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function NarrativeGapsModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [gaps, setGaps]       = useState<NarrativeGap[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchNarrativeGaps(docId)
      setGaps(res.gaps)
    } catch {
      setError("Failed to detect narrative gaps")
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
            <h2 className="text-white font-semibold text-sm">Narrative Gaps</h2>
            <p className="text-white/40 text-xs mt-0.5">AI detects missing transitions and story threads</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing narrative…</p>
            </div>
          )}

          {gaps !== null && !loading && (
            gaps.length === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No narrative gaps detected. The story flows well.
              </div>
            ) : (
              <>
                <p className="text-white/40 text-xs">{gaps.length} gap{gaps.length !== 1 ? "s" : ""} detected</p>
                <div className="space-y-2">
                  {gaps.map((g, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      {g.location && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-400/20 bg-yellow-400/8 text-yellow-300">{g.location}</span>
                      )}
                      <p className="text-white/60 text-xs leading-relaxed">{g.description}</p>
                      {g.suggestion && (
                        <p className="text-accent/60 text-xs leading-relaxed">→ {g.suggestion}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )
          )}

          {gaps === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to find narrative gaps.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
