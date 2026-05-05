import { useState } from "react"
import { fetchObjectionHandler } from "../../lib/studioApi"
import type { ObjectionEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

type Severity = "all" | "easy" | "medium" | "tough"

const severityColor = (s: ObjectionEntry["severity"]) => ({
  easy:   "text-green-400 border-green-400/20 bg-green-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  tough:  "text-red-400 border-red-400/20 bg-red-400/8",
})[s]

export default function ObjectionHandlerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [objections, setObjections] = useState<ObjectionEntry[] | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<Severity>("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchObjectionHandler(docId)
      setObjections(res.objections)
    } catch {
      setError("Failed to generate objection handler")
    } finally {
      setLoading(false)
    }
  }

  const filtered = objections ? (filter === "all" ? objections : objections.filter(o => o.severity === filter)) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Objection Handler</h2>
            <p className="text-white/40 text-xs mt-0.5">AI anticipates audience objections with rebuttals</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Anticipating objections…</p>
            </div>
          )}

          {objections && !loading && (
            <>
              <div className="flex items-center gap-2">
                {(["all", "easy", "medium", "tough"] as Severity[]).map(s => (
                  <button key={s} onClick={() => setFilter(s)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                      filter === s
                        ? s === "all"    ? "bg-white/10 border-white/20 text-white"
                        : s === "easy"   ? "bg-green-400/15 border-green-400/30 text-green-400"
                        : s === "medium" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400"
                                         : "bg-red-400/15 border-red-400/30 text-red-400"
                        : "bg-white/5 border-white/10 text-white/40"
                    }`}>
                    {s}{s !== "all" && objections ? ` (${objections.filter(o => o.severity === s).length})` : ""}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filtered.map((o, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(o.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                        Slide {o.slide_n}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${severityColor(o.severity)}`}>{o.severity}</span>
                    </div>
                    <div>
                      <p className="text-white/80 text-xs leading-relaxed font-medium">"{o.objection}"</p>
                      <p className="text-accent/60 text-xs leading-relaxed mt-1">→ {o.rebuttal}</p>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && <div className="text-white/30 text-xs text-center py-4">No objections in this category.</div>}
              </div>
            </>
          )}

          {objections === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to anticipate audience objections.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
