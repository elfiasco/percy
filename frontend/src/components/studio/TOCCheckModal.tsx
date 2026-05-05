import { useState, useEffect } from "react"
import { fetchTOCCheck } from "../../lib/studioApi"
import type { TOCMatch, TOCMismatch } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TOCCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    toc_found: boolean
    toc_slide: number | null
    matches: TOCMatch[]
    mismatches: TOCMismatch[]
    missing: Array<{ slide_n: number; title: string }>
  } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchTOCCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check table of contents"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Table of Contents Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Verify TOC entries match actual slide titles</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Checking TOC…</span>
            </div>
          ) : data && (
            !data.toc_found ? (
              <div className="text-white/40 text-xs bg-white/5 border border-white/8 rounded-lg px-3 py-3 text-center">
                No agenda or table of contents slide detected.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/40">TOC on</span>
                  <button
                    onClick={() => { onJumpToSlide(data.toc_slide!); onClose() }}
                    className="text-accent/70 hover:text-accent transition-colors"
                  >
                    Slide {data.toc_slide}
                  </button>
                </div>

                {data.matches.length > 0 && (
                  <div>
                    <p className="text-green-400/70 text-xs font-medium mb-2">Matched ({data.matches.length})</p>
                    <div className="space-y-1">
                      {data.matches.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 bg-green-400/5 border border-green-400/15 rounded px-3 py-1.5">
                          <span className="text-green-400/50 text-xs shrink-0">✓</span>
                          <span className="text-white/50 text-xs flex-1 truncate">"{m.toc_item}"</span>
                          <button
                            onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                            className="text-[10px] text-accent/50 hover:text-accent transition-colors shrink-0"
                          >
                            Slide {m.slide_n}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.mismatches.length > 0 && (
                  <div>
                    <p className="text-red-400/70 text-xs font-medium mb-2">Not found ({data.mismatches.length})</p>
                    <div className="space-y-1">
                      {data.mismatches.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 bg-red-400/5 border border-red-400/15 rounded px-3 py-1.5">
                          <span className="text-red-400/50 text-xs shrink-0">✗</span>
                          <span className="text-white/50 text-xs">"{m.toc_item}" — {m.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.missing.length > 0 && (
                  <div>
                    <p className="text-yellow-400/70 text-xs font-medium mb-2">Slides missing from TOC ({data.missing.length})</p>
                    <div className="space-y-1">
                      {data.missing.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 bg-yellow-400/5 border border-yellow-400/15 rounded px-3 py-1.5">
                          <button
                            onClick={() => { onJumpToSlide(m.slide_n); onClose() }}
                            className="text-[10px] text-accent/50 hover:text-accent transition-colors shrink-0"
                          >
                            Slide {m.slide_n}
                          </button>
                          <span className="text-white/45 text-xs truncate">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
