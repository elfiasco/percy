import { useState } from "react"
import { fetchIcebreakerSlideGenerator } from "../../lib/studioApi"
import type { IcebreakerResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const formatColor: Record<string, string> = {
  poll:     "text-blue-400 border-blue-400/20 bg-blue-400/8",
  question: "text-paper border-paper/20 bg-paper/8",
  activity: "text-green-400 border-green-400/20 bg-green-400/8",
  fact:     "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
}

export default function IcebreakerSlideGeneratorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<IcebreakerResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchIcebreakerSlideGenerator(docId)
      setData(res)
    } catch {
      setError("Failed to generate icebreakers")
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
            <h2 className="text-white font-semibold text-sm">Icebreaker Slide Generator</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates engaging opening activities tailored to your topic</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating icebreakers…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-3">
              {data.icebreakers.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No icebreakers generated.</div>
              ) : data.icebreakers.map((ice, i) => (
                <div key={i} className="border border-white/8 rounded-lg p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-white/80 text-xs font-medium">{ice.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${formatColor[ice.format] ?? "text-white/40 border-white/10 bg-white/5"}`}>{ice.format}</span>
                      <span className="text-[10px] text-white/30">{ice.duration_min}min</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-white/55 leading-relaxed">{ice.description}</p>
                </div>
              ))}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to get icebreaker ideas.</div>
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
