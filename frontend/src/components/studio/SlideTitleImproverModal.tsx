import { useState } from "react"
import { fetchSlideTitleImprover } from "../../lib/studioApi"
import type { TitleImproverResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTitleImproverModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TitleImproverResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideTitleImprover(docId)
      setData(res)
    } catch {
      setError("Failed to improve titles")
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
            <h2 className="text-white font-semibold text-sm">Slide Title Improver</h2>
            <p className="text-white/40 text-xs mt-0.5">AI suggests clearer, action-oriented titles for each slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Improving titles…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-2">
              {data.slides.map(s => (
                <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                  className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-3 transition-colors border border-white/5">
                  <span className="text-[10px] text-white/40 shrink-0 w-14 mt-0.5">Slide {s.slide_n}</span>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-white/20 uppercase tracking-wider w-12 shrink-0">Before</span>
                      <p className="text-[11px] text-white/40 line-through">{s.current || "(no title)"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-green-400/50 uppercase tracking-wider w-12 shrink-0">After</span>
                      <p className="text-[11px] text-green-400/80 font-medium">{s.improved}</p>
                    </div>
                    <p className="text-[10px] text-white/30 leading-relaxed">{s.reason}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Improve" to get better title suggestions.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Improving…" : "Improve"}
          </button>
        </div>
      </div>
    </div>
  )
}
