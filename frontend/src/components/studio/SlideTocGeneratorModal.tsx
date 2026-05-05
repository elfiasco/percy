import { useState } from "react"
import { fetchSlideTocGenerator } from "../../lib/studioApi"
import type { TocGeneratorResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function SlideTocGeneratorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TocGeneratorResult | null>(null)
  const [error, setError] = useState("")
  const [view, setView] = useState<"structured" | "text">("structured")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideTocGenerator(docId)
      setData(res)
    } catch {
      setError("Failed to generate table of contents")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!data?.formatted_toc) return
    navigator.clipboard.writeText(data.formatted_toc)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Table of Contents Generator</h2>
            <p className="text-white/40 text-xs mt-0.5">AI groups slides into sections and generates a formatted TOC</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating TOC…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {(["structured", "text"] as const).map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors capitalize ${view === v ? "bg-accent/20 text-accent border border-accent/30" : "text-white/30 hover:text-white/60"}`}>
                      {v}
                    </button>
                  ))}
                </div>
                <button onClick={copy}
                  className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-white/70 transition-colors">
                  {copied ? "Copied!" : "Copy TOC"}
                </button>
              </div>

              {view === "structured" ? (
                <div className="space-y-3">
                  {data.sections.map((sec, i) => (
                    <div key={i} className="space-y-1">
                      <p className="text-[10px] text-white/40 uppercase tracking-wider">{sec.section_title}</p>
                      {sec.slides.map(s => (
                        <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                          className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors">
                          <span className="text-[10px] text-white/30 shrink-0 w-14">Slide {s.slide_n}</span>
                          <p className="flex-1 text-[10px] text-white/60 truncate">{s.title}</p>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="text-[10px] text-white/50 leading-relaxed font-mono bg-white/3 border border-white/8 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
                  {data.formatted_toc}
                </pre>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to create a table of contents.</div>
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
