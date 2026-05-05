import { useState } from "react"
import { fetchActionPlan } from "../../lib/studioApi"
import type { ActionItem } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const PRIORITY_STYLE: Record<string, string> = {
  high:   "text-red-400 bg-red-400/10 border-red-400/25",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25",
  low:    "text-green-400 bg-green-400/10 border-green-400/25",
}

export default function ActionPlanModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<ActionItem[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchActionPlan(docId)
      setData(r.actions)
    } catch {
      setError("Failed to extract action plan")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Action Plan Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI extracts action items with owners and timelines</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting actions…</p>
            </div>
          )}

          {data !== null && !loading && (
            data.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">No action items found.</div>
            ) : (
              <div className="space-y-2">
                {data.map((item, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 space-y-1.5">
                    <p className="text-white/75 text-sm">{item.action}</p>
                    <div className="flex items-center gap-3 text-xs">
                      {item.owner && <span className="text-white/40">👤 {item.owner}</span>}
                      {item.deadline && <span className="text-white/40">📅 {item.deadline}</span>}
                      {item.priority && (
                        <span className={`ml-auto px-1.5 py-0.5 rounded border text-[10px] capitalize ${PRIORITY_STYLE[item.priority] ?? "text-white/40 bg-white/5 border-white/15"}`}>
                          {item.priority}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Extract" to pull action items from the deck.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={run}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
