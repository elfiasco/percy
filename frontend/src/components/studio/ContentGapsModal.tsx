import { useState } from "react"
import { detectContentGaps } from "../../lib/studioApi"
import type { ContentGap } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const DECK_TYPES = [
  { key: "general",    label: "General" },
  { key: "pitch",      label: "Pitch Deck" },
  { key: "sales",      label: "Sales Deck" },
  { key: "report",     label: "Report" },
  { key: "proposal",   label: "Proposal" },
  { key: "training",   label: "Training" },
  { key: "technical",  label: "Technical" },
]

const IMP_COLOR: Record<string, string> = {
  high:   "text-red-400 bg-red-400/10 border-red-400/25",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25",
  low:    "text-white/40 bg-white/5 border-white/15",
}

const COVERAGE_COLOR: Record<string, string> = {
  good: "text-green-400",
  fair: "text-yellow-400",
  poor: "text-red-400",
}

export default function ContentGapsModal({ docId, onClose }: Props) {
  const [deckType, setDeckType] = useState("general")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState("")
  const [gaps, setGaps]         = useState<ContentGap[] | null>(null)
  const [coverage, setCoverage] = useState("")
  const [summary, setSummary]   = useState("")

  const scan = async () => {
    setLoading(true)
    setError("")
    setGaps(null)
    try {
      const r = await detectContentGaps(docId, deckType)
      setGaps(r.gaps)
      setCoverage(r.overall_coverage)
      setSummary(r.summary)
    } catch {
      setError("Failed to detect content gaps")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Content Gap Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">AI flags missing topics expected for your deck type</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* Deck type selector */}
          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Deck type</label>
            <div className="flex flex-wrap gap-2">
              {DECK_TYPES.map((dt) => (
                <button
                  key={dt.key}
                  onClick={() => setDeckType(dt.key)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${deckType === dt.key ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing content coverage…</p>
            </div>
          )}

          {gaps !== null && !loading && (
            <>
              {/* Coverage badge */}
              <div className="flex items-center gap-3">
                <span className="text-white/40 text-xs">Overall coverage:</span>
                <span className={`text-sm font-semibold capitalize ${COVERAGE_COLOR[coverage] || "text-white/60"}`}>{coverage}</span>
              </div>

              {summary && (
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-white/50 text-xs leading-relaxed">{summary}</div>
              )}

              {gaps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="text-3xl">✓</div>
                  <p className="text-white/50 text-sm">No significant gaps detected</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-white/40 text-xs">
                    Found <span className="text-white/70 font-medium">{gaps.length}</span> potential gap{gaps.length !== 1 ? "s" : ""}
                  </div>
                  {gaps.map((g, i) => (
                    <div key={i} className={`rounded-lg border px-4 py-3 ${IMP_COLOR[g.importance]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm">{g.topic}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 capitalize ${IMP_COLOR[g.importance]}`}>{g.importance}</span>
                      </div>
                      <p className="text-xs mt-1 opacity-75 leading-relaxed">{g.suggestion}</p>
                      {g.insert_after_slide > 0 && (
                        <p className="text-[10px] mt-1 opacity-50">Suggested position: after slide {g.insert_after_slide}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={scan}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Analyzing…" : "Detect Gaps"}
          </button>
        </div>
      </div>
    </div>
  )
}
