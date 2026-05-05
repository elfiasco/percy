import { useState } from "react"
import { fetchSlideTransitionsAdvisor } from "../../lib/studioApi"
import type { TransitionAdvice } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const transitionColor: Record<string, string> = {
  fade:   "text-blue-400 border-blue-400/20 bg-blue-400/8",
  push:   "text-cyan-400 border-cyan-400/20 bg-cyan-400/8",
  cut:    "text-white/50 border-white/15 bg-white/5",
  morph:  "text-accent border-accent/20 bg-accent/8",
  zoom:   "text-green-400 border-green-400/20 bg-green-400/8",
  reveal: "text-paper border-paper/20 bg-paper/8",
  wipe:   "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  none:   "text-white/30 border-white/10 bg-white/5",
}

export default function SlideTransitionsAdvisorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [transitions, setTransitions] = useState<TransitionAdvice[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideTransitionsAdvisor(docId)
      setTransitions(res.transitions)
    } catch {
      setError("Failed to generate transition advice")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Transitions Advisor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI recommends transition types based on content flow</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Advising transitions…</p>
            </div>
          )}

          {transitions && !loading && (
            transitions.map((t, i) => (
              <div key={i} className="flex items-start gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                <span className="text-[10px] text-white/40 shrink-0 w-20 mt-0.5">
                  {t.from_slide} → {t.to_slide}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${transitionColor[t.type] ?? "text-white/40 border-white/10 bg-white/5"}`}>{t.type}</span>
                <p className="text-xs text-white/55 leading-relaxed flex-1">{t.rationale}</p>
              </div>
            ))
          )}

          {transitions !== null && transitions.length === 0 && !loading && (
            <div className="text-white/30 text-xs text-center py-4">No transitions generated.</div>
          )}

          {transitions === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Advise" to get AI transition recommendations.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Advising…" : "Advise"}
          </button>
        </div>
      </div>
    </div>
  )
}
