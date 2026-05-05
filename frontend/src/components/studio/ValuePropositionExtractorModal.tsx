import { useState } from "react"
import { fetchValuePropositionExtractor } from "../../lib/studioApi"
import type { ValueProposition } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${value >= 7 ? "bg-green-400/60" : value >= 4 ? "bg-yellow-400/60" : "bg-red-400/60"}`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-[10px] text-white/40 shrink-0">{value}/10</span>
    </div>
  )
}

export default function ValuePropositionExtractorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ValueProposition | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchValuePropositionExtractor(docId)
      setData(res)
    } catch {
      setError("Failed to extract value proposition")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Value Proposition Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI extracts and rates your core value proposition</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting value proposition…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-3">
                <p className="text-[10px] text-accent/60 font-semibold uppercase tracking-wide mb-1">Value Proposition</p>
                <p className="text-sm text-white/80 leading-relaxed">{data.value_proposition}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-white/40 font-semibold mb-1">Target Audience</p>
                  <p className="text-white/65 leading-relaxed">{data.target_audience}</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-white/40 font-semibold mb-1">Primary Benefit</p>
                  <p className="text-white/65 leading-relaxed">{data.primary_benefit}</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 col-span-2">
                  <p className="text-[10px] text-white/40 font-semibold mb-1">Differentiator</p>
                  <p className="text-white/65 leading-relaxed">{data.differentiator}</p>
                </div>
              </div>

              <div className="space-y-2">
                <ScoreBar label="Clarity" value={data.clarity_score} />
                <ScoreBar label="Strength" value={data.strength_score} />
              </div>

              {data.improvement && (
                <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                  <p className="text-[10px] text-white/40 font-semibold mb-1">Improvement</p>
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.improvement}</p>
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Extract" to identify your core value proposition.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
