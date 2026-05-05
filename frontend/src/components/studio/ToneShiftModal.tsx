import { useState } from "react"
import { fetchToneShift } from "../../lib/studioApi"
import type { ToneShift } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ToneShiftModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [shifts, setShifts]   = useState<ToneShift[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchToneShift(docId)
      setShifts(res.shifts)
    } catch {
      setError("Failed to detect tone shifts")
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
            <h2 className="text-white font-semibold text-sm">Tone Shift Alert</h2>
            <p className="text-white/40 text-xs mt-0.5">AI detects unexpected tone changes between slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Detecting tone shifts…</p>
            </div>
          )}

          {shifts !== null && !loading && (
            shifts.length === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No unexpected tone shifts detected.
              </div>
            ) : (
              <div className="space-y-2">
                {shifts.map((s, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => { onJumpToSlide(s.before_slide); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {s.before_slide}</button>
                      <span className="text-white/20 text-[10px]">→</span>
                      <button onClick={() => { onJumpToSlide(s.after_slide); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {s.after_slide}</button>
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-blue-300 text-[10px] px-1.5 py-0.5 rounded border border-blue-400/20 bg-blue-400/8 capitalize">{s.from_tone}</span>
                        <span className="text-white/20 text-[10px]">→</span>
                        <span className="text-orange-300 text-[10px] px-1.5 py-0.5 rounded border border-orange-400/20 bg-orange-400/8 capitalize">{s.to_tone}</span>
                      </div>
                    </div>
                    {s.description && <p className="text-white/45 text-xs leading-relaxed">{s.description}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {shifts === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to detect tone shifts.</div>
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
