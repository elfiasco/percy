import { useState } from "react"
import { fetchFirstImpression } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const scoreColor = (s: number) => s >= 8 ? "text-green-400" : s >= 5 ? "text-yellow-400" : "text-red-400"
const scoreBg    = (s: number) => s >= 8 ? "border-green-400/25 bg-green-400/8" : s >= 5 ? "border-yellow-400/25 bg-yellow-400/8" : "border-red-400/25 bg-red-400/8"

export default function FirstImpressionModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ score: number; verdict: string; strengths: string[]; improvements: string[] } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchFirstImpression(docId))
    } catch {
      setError("Failed to score first impression")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">First Impression Score</h2>
            <p className="text-white/40 text-xs mt-0.5">AI critiques your opening slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Evaluating first slide…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className={`flex items-center gap-4 border rounded-xl px-4 py-3 ${scoreBg(data.score)}`}>
                <span className={`text-4xl font-bold ${scoreColor(data.score)}`}>{data.score}</span>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">First impression score</p>
                  <p className="text-white/65 text-xs leading-relaxed">{data.verdict}</p>
                </div>
              </div>

              {data.strengths.length > 0 && (
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Strengths</p>
                  <ul className="space-y-1">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-green-400/70 leading-relaxed">
                        <span className="shrink-0">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.improvements.length > 0 && (
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1.5">Improvements</p>
                  <ul className="space-y-1">
                    {data.improvements.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-yellow-400/70 leading-relaxed">
                        <span className="shrink-0">→</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Score" to evaluate your opening slide.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scoring…" : "Score"}
          </button>
        </div>
      </div>
    </div>
  )
}
