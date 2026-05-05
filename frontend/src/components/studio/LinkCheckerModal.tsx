import { useState, useEffect } from "react"
import { fetchLinkCheck } from "../../lib/studioApi"
import type { LinkResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function LinkCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ links: LinkResult[]; total: number; invalid: number; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchLinkCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check links"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Link Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">All URLs and hyperlinks in the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning links…</span>
            </div>
          ) : data && (
            data.total === 0 ? (
              <div className="text-white/40 text-xs bg-white/5 border border-white/8 rounded-lg px-3 py-3 text-center">
                No URLs or hyperlinks found in this deck.
              </div>
            ) : (
              <>
                <div className="flex gap-4 text-xs">
                  <span className="text-white/40">{data.total} link{data.total !== 1 ? "s" : ""} found</span>
                  {data.invalid > 0 && (
                    <span className="text-red-400/70">{data.invalid} invalid format</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {data.links.map((link, i) => (
                    <div key={i} className={`flex items-start gap-2 rounded px-3 py-2 border ${link.valid_format ? "bg-white/3 border-white/8" : "bg-red-400/5 border-red-400/15"}`}>
                      <button
                        onClick={() => { onJumpToSlide(link.slide_n); onClose() }}
                        className="text-[10px] text-accent/50 hover:text-accent transition-colors shrink-0 mt-0.5 w-12"
                      >
                        Slide {link.slide_n}
                      </button>
                      <span className="text-white/55 text-xs font-mono break-all flex-1">{link.url}</span>
                      {!link.valid_format && (
                        <span className="text-red-400/60 text-[10px] shrink-0">{link.note}</span>
                      )}
                    </div>
                  ))}
                </div>
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
