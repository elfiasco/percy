import { useState, useEffect } from "react"
import { fetchHeaderFooterCheck } from "../../lib/studioApi"
import type { HeaderFooterEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function HeaderFooterCheckModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ headers: HeaderFooterEntry[]; footers: HeaderFooterEntry[]; header_count: number; footer_count: number } | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"headers" | "footers">("headers")

  useEffect(() => {
    setLoading(true)
    fetchHeaderFooterCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to check header/footer consistency"))
      .finally(() => setLoading(false))
  }, [docId])

  const entries = data ? (tab === "headers" ? data.headers : data.footers) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Header/Footer Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Recurring header and footer text across slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning headers and footers…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => setTab("headers")}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${tab === "headers" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Headers ({data.header_count})
                </button>
                <button onClick={() => setTab("footers")}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${tab === "footers" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>
                  Footers ({data.footer_count})
                </button>
              </div>

              {entries.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">
                  No consistent {tab} found (recurring text in top/bottom 10% of slides).
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map((e, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1.5">
                      <p className="text-white/70 text-xs">{e.text}</p>
                      <div className="flex flex-wrap gap-1">
                        {e.slides.map(n => (
                          <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                            s{n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
