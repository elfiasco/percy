import { useState } from "react"
import { fetchDataInsights } from "../../lib/studioApi"
import type { DataInsight } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "text-green-400 bg-green-400/10 border-green-400/25",
  negative: "text-red-400 bg-red-400/10 border-red-400/25",
  neutral:  "text-white/40 bg-white/5 border-white/15",
}

export default function DataInsightsModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<DataInsight[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchDataInsights(docId)
      setData(r.insights)
    } catch {
      setError("Failed to extract data insights")
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
            <h2 className="text-white font-semibold text-sm">Data Insights</h2>
            <p className="text-white/40 text-xs mt-0.5">AI extracts statistics and data claims from your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting data…</p>
            </div>
          )}

          {data !== null && !loading && (
            data.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">No statistics or data claims found.</div>
            ) : (
              <div className="space-y-2">
                {data.map((item, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1">
                        <span className="text-white/70 text-sm font-medium">{item.value}</span>
                        {item.metric && <span className="text-white/40 text-xs ml-2">{item.metric}</span>}
                      </div>
                      {item.sentiment && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${SENTIMENT_STYLE[item.sentiment] ?? SENTIMENT_STYLE.neutral}`}>
                          {item.sentiment}
                        </span>
                      )}
                    </div>
                    {item.context && <p className="text-white/40 text-xs">{item.context}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Extract" to find statistics and data claims in your deck.
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
