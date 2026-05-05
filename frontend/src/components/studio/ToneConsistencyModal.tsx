import { useState, useEffect } from "react"
import { fetchToneConsistency } from "../../lib/studioApi"
import type { ToneIssue } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function ToneConsistencyModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ overall_tone: string; consistent: boolean; summary: string; issues: ToneIssue[] } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchToneConsistency(docId))
    } catch {
      setError("Failed to analyze tone")
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
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Tone Consistency</h2>
            <p className="text-white/40 text-xs mt-0.5">Check that writing tone is uniform across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing tone…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded border ${data.consistent ? "text-green-400 border-green-400/20 bg-green-400/8" : "text-yellow-400 border-yellow-400/20 bg-yellow-400/8"}`}>
                  {data.consistent ? "Consistent" : "Inconsistent"}
                </span>
                <span className="text-white/50 text-xs">Overall tone: <span className="text-white/80 capitalize">{data.overall_tone}</span></span>
              </div>

              <p className="text-white/55 text-xs leading-relaxed">{data.summary}</p>

              {data.issues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-white/30 text-xs uppercase tracking-wide">Tone Shifts Detected</p>
                  {data.issues.map((iss, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { onJumpToSlide(iss.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors shrink-0">
                          Slide {iss.slide_n}
                        </button>
                        <span className="text-yellow-400/70 text-xs capitalize">{iss.detected_tone}</span>
                      </div>
                      <p className="text-white/45 text-xs">{iss.issue}</p>
                    </div>
                  ))}
                </div>
              )}

              {data.issues.length === 0 && (
                <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                  No tone inconsistencies detected.
                </div>
              )}
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
