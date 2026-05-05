import { useState, useEffect } from "react"
import { fetchJargonDetector } from "../../lib/studioApi"
import type { JargonHit } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function JargonDetectorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ hits: JargonHit[]; total: number; top_jargon: { word: string; count: number }[] } | null>(null)
  const [error, setError]     = useState("")
  const [wordFilter, setWordFilter] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchJargonDetector(docId))
    } catch {
      setError("Failed to scan for jargon")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const hits = data ? (wordFilter ? data.hits.filter(h => h.word === wordFilter) : data.hits) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Jargon Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">Find overused corporate buzzwords</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning for jargon…</span>
            </div>
          )}

          {data && !loading && (
            data.total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No jargon detected.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setWordFilter(null)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${!wordFilter ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40"}`}>
                    All ({data.total})
                  </button>
                  {data.top_jargon.slice(0, 8).map((j) => (
                    <button key={j.word} onClick={() => setWordFilter(j.word === wordFilter ? null : j.word)}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${wordFilter === j.word ? "bg-orange-400/15 border-orange-400/30 text-orange-400" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}>
                      {j.word} ({j.count})
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  {hits.slice(0, 25).map((h, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { onJumpToSlide(h.slide_n); onClose() }}
                          className="text-[10px] text-accent/60 hover:text-accent transition-colors shrink-0">
                          Slide {h.slide_n}
                        </button>
                        <span className="text-orange-400/70 text-[10px] bg-orange-400/8 px-1.5 py-0.5 rounded">{h.word}</span>
                      </div>
                      <p className="text-white/45 text-xs truncate">{h.text}</p>
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
