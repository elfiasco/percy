import { useState } from "react"
import { extractCitations } from "../../lib/studioApi"
import type { Citation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const TYPE_STYLE: Record<string, string> = {
  stat:  "text-blue-400 bg-blue-400/10 border-blue-400/20",
  study: "text-paper bg-paper/10 border-paper/20",
  quote: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  fact:  "text-green-400 bg-green-400/10 border-green-400/20",
}

const TYPE_ICON: Record<string, string> = {
  stat: "📊", study: "📄", quote: '"', fact: "✓",
}

export default function CitationTrackerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]       = useState(false)
  const [citations, setCitations]   = useState<Citation[] | null>(null)
  const [error, setError]           = useState("")
  const [filter, setFilter]         = useState<"all" | "stat" | "study" | "quote" | "fact">("all")

  const scan = async () => {
    setLoading(true)
    setError("")
    setCitations(null)
    try {
      const r = await extractCitations(docId)
      setCitations(r.citations)
    } catch {
      setError("Failed to extract citations")
    } finally {
      setLoading(false)
    }
  }

  const filtered = citations
    ? (filter === "all" ? citations : citations.filter((c) => c.type === filter))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Citation Tracker</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies claims, stats, and quotes that need sources</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning for claims and citations…</p>
            </div>
          )}

          {citations !== null && !loading && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white/40 text-xs">{citations.length} item{citations.length !== 1 ? "s" : ""} found</span>
                <div className="ml-auto flex gap-1.5">
                  {(["all", "stat", "study", "quote", "fact"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/35 hover:text-white/60"}`}
                    >
                      {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/30">
                  <p className="text-sm">No items match the selected filter.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((c, i) => (
                    <div key={i} className="rounded-lg border border-white/10 px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${TYPE_STYLE[c.type]}`}>
                          {TYPE_ICON[c.type]} {c.type}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white/75 text-xs leading-relaxed">{c.claim}</p>
                          {c.suggested_source && (
                            <p className="text-white/30 text-[10px] mt-1">Suggested source: {c.suggested_source}</p>
                          )}
                        </div>
                        <button
                          onClick={() => { onJumpToSlide(c.slide_n); onClose() }}
                          className="text-[10px] text-accent/50 hover:text-accent transition-colors shrink-0"
                        >
                          Slide {c.slide_n} ↗
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {citations === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Scan" to find claims that need citations.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={scan}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Scanning…" : "Scan for Citations"}
          </button>
        </div>
      </div>
    </div>
  )
}
