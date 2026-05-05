import { useState } from "react"
import { fetchSectionSummary } from "../../lib/studioApi"

interface Props {
  docId: string
  totalSlides: number
  onClose: () => void
}

export default function SectionSummaryModal({ docId, totalSlides, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [scope, setScope]       = useState<"all" | "range">("all")
  const [from, setFrom]         = useState(1)
  const [to, setTo]             = useState(Math.min(5, totalSlides))
  const [data, setData]         = useState<{ summary: string; bullets: string[]; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const range: number[] = []
      if (scope === "range") {
        for (let i = from; i <= to; i++) range.push(i)
      }
      setData(await fetchSectionSummary(docId, range))
    } catch {
      setError("Failed to generate summary")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!data) return
    const text = [data.summary, "", ...data.bullets.map(b => `• ${b}`)].join("\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Section Summary</h2>
            <p className="text-white/40 text-xs mt-0.5">AI summary of a section or the whole deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            {(["all", "range"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-3 py-1 rounded text-xs border capitalize transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                {s === "all" ? "Whole Deck" : "Slide Range"}
              </button>
            ))}
          </div>

          {scope === "range" && (
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-xs">Slides</span>
              <input type="number" min={1} max={totalSlides} value={from} onChange={(e) => setFrom(+e.target.value)}
                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/40" />
              <span className="text-white/30 text-xs">to</span>
              <input type="number" min={1} max={totalSlides} value={to} onChange={(e) => setTo(+e.target.value)}
                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/40" />
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating summary…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <p className="text-white/60 text-xs leading-relaxed">{data.summary}</p>
              {data.bullets.length > 0 && (
                <ul className="space-y-1.5">
                  {data.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-xs text-white/55 leading-relaxed">
                      <span className="text-accent/50 shrink-0">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={copy}
                className="text-xs text-white/35 hover:text-white/60 border border-white/10 hover:border-white/20 rounded px-3 py-1 transition-colors">
                {copied ? "Copied!" : "Copy summary"}
              </button>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to summarize.</div>
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
