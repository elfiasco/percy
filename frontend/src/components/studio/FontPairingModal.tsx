import { useState } from "react"
import { fetchFontPairing } from "../../lib/studioApi"
import type { FontPairing } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function FontPairingModal({ docId, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [data, setData]         = useState<{ current_fonts: string[]; pairings: FontPairing[] } | null>(null)
  const [error, setError]       = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchFontPairing(docId))
    } catch {
      setError("Failed to generate font pairing suggestions")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Font Pairing Suggestions</h2>
            <p className="text-white/40 text-xs mt-0.5">AI suggests harmonious heading + body font combos</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Suggesting pairings…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {data.current_fonts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.current_fonts.map((f) => (
                    <span key={f} className="text-[10px] text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded">{f}</span>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {data.pairings.map((p, i) => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Heading</p>
                        <p className="text-accent/80 text-sm font-medium">{p.heading}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Body</p>
                        <p className="text-white/70 text-sm">{p.body}</p>
                      </div>
                    </div>
                    <p className="text-white/40 text-xs leading-relaxed">{p.reason}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Suggest" to get font pairing ideas.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Suggesting…" : "Suggest"}
          </button>
        </div>
      </div>
    </div>
  )
}
