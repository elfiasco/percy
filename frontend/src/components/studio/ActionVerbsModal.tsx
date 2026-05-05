import { useState, useEffect } from "react"
import { fetchActionVerbs } from "../../lib/studioApi"
import type { ActionVerbsSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const ratingColor = (r: ActionVerbsSlide["rating"]) =>
  r === "strong" ? "text-green-400 bg-green-400/8 border-green-400/20"
  : r === "weak"  ? "text-red-400 bg-red-400/8 border-red-400/20"
  : "text-yellow-400 bg-yellow-400/8 border-yellow-400/20"

export default function ActionVerbsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: ActionVerbsSlide[] } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "weak" | "strong">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchActionVerbs(docId))
    } catch {
      setError("Failed to audit action verbs")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const slides = data ? (filter === "all" ? data.slides : data.slides.filter(s => s.rating === filter || (filter === "weak" && s.rating === "mixed"))) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Action Verbs Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Flag weak/nominalized language vs. strong verbs</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Auditing language…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>Strong: <span className="text-green-400/70">{data.slides.filter(s => s.rating === "strong").length}</span></span>
                <span>Weak: <span className="text-red-400/70">{data.slides.filter(s => s.rating === "weak").length}</span></span>
                <span>Mixed: <span className="text-yellow-400/70">{data.slides.filter(s => s.rating === "mixed").length}</span></span>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "weak", "strong"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {f === "weak" ? "Weak/Mixed" : f === "all" ? "All" : "Strong"}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {slides.map((s) => (
                  <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {s.slide_n}</button>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${ratingColor(s.rating)}`}>{s.rating}</span>
                    </div>
                    {s.strong_verbs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.strong_verbs.map(v => (
                          <span key={v} className="text-[10px] px-1.5 py-0.5 rounded border border-green-400/20 bg-green-400/8 text-green-300">{v}</span>
                        ))}
                      </div>
                    )}
                    {s.weak_words.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.weak_words.map(v => (
                          <span key={v} className="text-[10px] px-1.5 py-0.5 rounded border border-red-400/20 bg-red-400/8 text-red-300">{v}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {slides.length === 0 && (
                  <div className="text-white/30 text-xs text-center py-4">No slides match this filter.</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Auditing…" : "Re-audit"}
          </button>
        </div>
      </div>
    </div>
  )
}
