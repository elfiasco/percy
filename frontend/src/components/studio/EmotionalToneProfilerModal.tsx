import { useState } from "react"
import { fetchEmotionalToneProfiler } from "../../lib/studioApi"
import type { EmotionalToneResult, ToneProfile } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const toneColor: Record<string, string> = {
  optimistic:    "text-green-400 border-green-400/20 bg-green-400/8",
  urgent:        "text-red-400 border-red-400/20 bg-red-400/8",
  empathetic:    "text-pink-400 border-pink-400/20 bg-pink-400/8",
  authoritative: "text-blue-400 border-blue-400/20 bg-blue-400/8",
  neutral:       "text-white/40 border-white/10 bg-white/5",
  anxious:       "text-orange-400 border-orange-400/20 bg-orange-400/8",
  inspiring:     "text-accent border-accent/20 bg-accent/8",
  sobering:      "text-paper border-paper/20 bg-paper/8",
}

export default function EmotionalToneProfilerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<EmotionalToneResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchEmotionalToneProfiler(docId)
      setData(res)
    } catch {
      setError("Failed to profile emotional tone")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Emotional Tone Profiler</h2>
            <p className="text-white/40 text-xs mt-0.5">AI maps the emotional tone across all slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Profiling emotional tone…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Dominant: <span className="text-white/70 capitalize">{data.dominant_tone}</span></span>
                <span>Consistency: <span className={`${data.tone_consistency >= 7 ? "text-green-400" : data.tone_consistency >= 4 ? "text-yellow-400" : "text-red-400"}`}>{data.tone_consistency}/10</span></span>
              </div>

              {data.recommendation && (
                <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-2.5">
                  <p className="text-xs text-accent/70 leading-relaxed">→ {data.recommendation}</p>
                </div>
              )}

              <div className="space-y-1.5">
                {data.profiles.map((p: ToneProfile) => (
                  <button key={p.slide_n} onClick={() => { onJumpToSlide(p.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {p.slide_n}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize shrink-0 ${toneColor[p.tone.toLowerCase()] ?? "text-white/40 border-white/10 bg-white/5"}`}>{p.tone}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/40 rounded-full" style={{ width: `${(p.intensity / 10) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-white/30 shrink-0">{p.intensity}/10</span>
                    {p.key_words.length > 0 && (
                      <div className="flex gap-1 shrink-0">
                        {p.key_words.slice(0, 2).map((w, i) => (
                          <span key={i} className="text-[9px] px-1 rounded bg-white/5 text-white/30">{w}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Profile" to analyze emotional tone.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Profiling…" : "Profile"}
          </button>
        </div>
      </div>
    </div>
  )
}
