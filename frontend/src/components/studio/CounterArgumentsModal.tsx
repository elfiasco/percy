import { useState } from "react"
import { fetchCounterArguments } from "../../lib/studioApi"
import type { CounterArgument } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function CounterArgumentsModal({ docId, onClose }: Props) {
  const [count, setCount]     = useState(5)
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<CounterArgument[] | null>(null)
  const [error, setError]     = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchCounterArguments(docId, count)
      setData(r.counterarguments)
    } catch {
      setError("Failed to generate counterarguments")
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
            <h2 className="text-white font-semibold text-sm">Counterargument Prep</h2>
            <p className="text-white/40 text-xs mt-0.5">AI anticipates objections so you can prepare responses</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs">Number of counterarguments:</span>
            {[3, 5, 7].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${count === n ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}
              >{n}</button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Thinking critically…</p>
            </div>
          )}

          {data !== null && !loading && (
            data.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">No counterarguments generated.</div>
            ) : (
              <div className="space-y-2">
                {data.map((item, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/4"
                      onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                      <span className="text-red-400/50 text-xs shrink-0 mt-0.5">↯</span>
                      <div className="flex-1">
                        <p className="text-white/70 text-sm leading-snug">{item.counterargument}</p>
                        {item.claim && <p className="text-white/30 text-xs mt-0.5 italic">re: "{item.claim}"</p>}
                      </div>
                      <span className="text-white/20 text-xs shrink-0">{expanded === i ? "▲" : "▼"}</span>
                    </button>
                    {expanded === i && item.suggested_response && (
                      <div className="px-4 pb-3 pt-0 border-t border-white/5">
                        <p className="text-green-400/60 text-[10px] uppercase tracking-wide mb-1">Suggested response</p>
                        <p className="text-white/50 text-xs leading-relaxed">{item.suggested_response}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">
              Click "Generate" to see potential objections and how to respond.
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
            {loading ? "Thinking…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
