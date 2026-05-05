import { useState } from "react"
import { fetchVisualMetaphorChecker } from "../../lib/studioApi"
import type { VisualMetaphorResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const effectStyle: Record<string, string> = {
  strong:   "text-green-400 border-green-400/20 bg-green-400/8",
  moderate: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  weak:     "text-red-400 border-red-400/20 bg-red-400/8",
}

export default function VisualMetaphorCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<VisualMetaphorResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchVisualMetaphorChecker(docId)
      setData(res)
    } catch {
      setError("Failed to check visual metaphors")
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
            <h2 className="text-white font-semibold text-sm">Visual Metaphor Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies metaphors and analogies used in your presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Finding metaphors…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-2">
              {data.metaphors.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No notable metaphors or analogies detected.</div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30">{data.metaphors.length} metaphor{data.metaphors.length !== 1 ? "s" : ""} found</p>
                  {data.metaphors.map((m, i) => (
                    <div key={i} className="border border-white/8 rounded-lg overflow-hidden">
                      <button onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                        <span className="text-[10px] text-white/40 shrink-0 w-14 pt-0.5">Slide {m.slide_n}</span>
                        <p className="flex-1 text-[11px] text-white/70 font-medium">{m.metaphor}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${effectStyle[m.effectiveness] ?? "text-white/40 border-white/10"}`}>{m.effectiveness}</span>
                      </button>
                      <div className="border-t border-white/5 px-4 py-2">
                        <p className="text-[10px] text-white/30">Represents: <span className="text-white/50">{m.represents}</span></p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Check" to identify visual metaphors.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Checking…" : "Check"}
          </button>
        </div>
      </div>
    </div>
  )
}
