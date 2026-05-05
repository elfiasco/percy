import { useState, useEffect } from "react"
import { fetchCompetitiveLanguage } from "../../lib/studioApi"
import type { CompetitiveSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  "comparison":          "text-blue-300 bg-blue-400/8 border-blue-400/20",
  "competitor reference":"text-orange-300 bg-orange-400/8 border-orange-400/20",
  "market claim":        "text-yellow-300 bg-yellow-400/8 border-yellow-400/20",
  "superlative":         "text-paper bg-paper/8 border-paper/20",
  "uniqueness claim":    "text-cyan-300 bg-cyan-400/8 border-cyan-400/20",
  "exclusivity claim":   "text-red-300 bg-red-400/8 border-red-400/20",
}

export default function CompetitiveLanguageModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ slides: CompetitiveSlide[]; total: number } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchCompetitiveLanguage(docId))
    } catch {
      setError("Failed to detect competitive language")
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
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Competitive Language</h2>
            <p className="text-white/40 text-xs mt-0.5">Find comparisons, superlatives, and competitor references</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning language…</span>
            </div>
          )}

          {data && !loading && (
            data.total === 0 ? (
              <div className="text-white/40 text-xs text-center py-6">No competitive language detected.</div>
            ) : (
              <>
                <p className="text-white/40 text-xs">{data.total} instance{data.total !== 1 ? "s" : ""} across {data.slides.length} slide{data.slides.length !== 1 ? "s" : ""}</p>
                <div className="space-y-2">
                  {data.slides.map((s) => (
                    <div key={s.slide_n} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-2">
                      <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="text-xs text-accent/60 hover:text-accent transition-colors">Slide {s.slide_n}</button>
                      {s.hits.map((h, i) => (
                        <div key={i} className="space-y-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${CATEGORY_COLORS[h.category] ?? "text-white/40 bg-white/5 border-white/10"}`}>{h.category}</span>
                          <p className="text-white/50 text-xs leading-relaxed">{h.text}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>
    </div>
  )
}
