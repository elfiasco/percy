import { useState } from "react"
import { fetchPersuasionFramework } from "../../lib/studioApi"
import type { PersuasionFrameworkSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const MODE_COLORS: Record<string, string> = {
  ethos:  "text-paper bg-paper/8 border-paper/20",
  pathos: "text-red-300 bg-red-400/8 border-red-400/20",
  logos:  "text-blue-300 bg-blue-400/8 border-blue-400/20",
  mixed:  "text-yellow-300 bg-yellow-400/8 border-yellow-400/20",
}

export default function PersuasionFrameworkModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{
    slides: PersuasionFrameworkSlide[]
    ethos_pct: number
    pathos_pct: number
    logos_pct: number
    recommendation: string
  } | null>(null)
  const [error, setError]     = useState("")
  const [filter, setFilter]   = useState<"all" | "ethos" | "pathos" | "logos">("all")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchPersuasionFramework(docId))
    } catch {
      setError("Failed to analyze persuasion framework")
    } finally {
      setLoading(false)
    }
  }

  const slides = data ? (filter === "all" ? data.slides : data.slides.filter(s => s.mode === filter || s.mode === "mixed")) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Persuasion Framework</h2>
            <p className="text-white/40 text-xs mt-0.5">Ethos / Pathos / Logos analysis per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing rhetoric…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Ethos", pct: data.ethos_pct, color: "text-paper" },
                  { label: "Pathos", pct: data.pathos_pct, color: "text-red-300" },
                  { label: "Logos", pct: data.logos_pct, color: "text-blue-300" },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="bg-white/3 border border-white/8 rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{pct}%</div>
                    <div className="text-white/40 text-xs mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {data.recommendation && (
                <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
                  <p className="text-accent/70 text-xs leading-relaxed">{data.recommendation}</p>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {(["all", "ethos", "pathos", "logos"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    {f}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {slides.map((s) => (
                  <div key={s.slide_n} className="flex items-start gap-3">
                    <button onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-accent/60 hover:text-accent transition-colors w-14 text-right shrink-0 mt-0.5">
                      Slide {s.slide_n}
                    </button>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${MODE_COLORS[s.mode] ?? "text-white/40 bg-white/5 border-white/10"}`}>{s.mode}</span>
                    {s.note && <span className="text-white/40 text-xs leading-relaxed flex-1">{s.note}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to map Ethos/Pathos/Logos across slides.</div>
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
