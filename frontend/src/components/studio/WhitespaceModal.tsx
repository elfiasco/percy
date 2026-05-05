import { useState, useEffect } from "react"
import { fetchWhitespaceAnalysis } from "../../lib/studioApi"
import type { WhitespaceSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const barColor = (pct: number) =>
  pct < 20 ? "bg-red-400/40" : pct > 80 ? "bg-yellow-400/40" : "bg-green-400/40"

export default function WhitespaceModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    slides: WhitespaceSlide[]
    avg_whitespace_pct: number
    crowded: WhitespaceSlide[]
    empty_heavy: WhitespaceSlide[]
  } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchWhitespaceAnalysis(docId))
    } catch {
      setError("Failed to analyze whitespace")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Whitespace Analysis</h2>
            <p className="text-white/40 text-xs mt-0.5">Empty vs. occupied area per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Measuring whitespace…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Avg. whitespace", value: `${data.avg_whitespace_pct}%` },
                  { label: "Crowded slides", value: data.crowded.length },
                  { label: "Very sparse slides", value: data.empty_heavy.length },
                ].map((s) => (
                  <div key={s.label} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                    <p className="text-white/80 font-semibold text-base">{s.value}</p>
                    <p className="text-white/30 text-[10px] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {data.slides.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0">
                      Slide {s.slide_n}
                    </button>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(s.whitespace_pct)}`} style={{ width: `${s.whitespace_pct}%` }} />
                    </div>
                    <span className="text-white/30 text-xs font-mono w-8 text-right shrink-0">{s.whitespace_pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
