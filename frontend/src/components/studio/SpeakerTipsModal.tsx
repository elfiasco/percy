import { useState } from "react"
import { fetchSpeakerTips } from "../../lib/studioApi"
import type { SpeakerTip } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SpeakerTipsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [tips, setTips] = useState<SpeakerTip[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSpeakerTips(docId)
      setTips(res.tips)
    } catch {
      setError("Failed to generate speaker tips")
    } finally {
      setLoading(false)
    }
  }

  const techniqueColor = (t: string) => {
    const lower = t.toLowerCase()
    if (lower.includes("story")) return "text-paper border-paper/20 bg-paper/8"
    if (lower.includes("pause")) return "text-blue-400 border-blue-400/20 bg-blue-400/8"
    if (lower.includes("question")) return "text-yellow-400 border-yellow-400/20 bg-yellow-400/8"
    if (lower.includes("data") || lower.includes("stat")) return "text-cyan-400 border-cyan-400/20 bg-cyan-400/8"
    return "text-white/40 border-white/10 bg-white/5"
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Speaker Tips</h2>
            <p className="text-white/40 text-xs mt-0.5">AI coaching notes for each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating speaker tips…</p>
            </div>
          )}

          {tips && !loading && (
            <>
              <p className="text-xs text-white/30">{tips.length} tips across your slides</p>
              <div className="space-y-2">
                {tips.map((t, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { onJumpToSlide(t.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors shrink-0">
                        Slide {t.slide_n}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${techniqueColor(t.technique)}`}>{t.technique}</span>
                    </div>
                    <p className="text-white/70 text-xs leading-relaxed">{t.tip}</p>
                  </div>
                ))}
                {tips.length === 0 && <div className="text-white/30 text-xs text-center py-4">No tips generated.</div>}
              </div>
            </>
          )}

          {tips === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to get speaker coaching tips.</div>
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
