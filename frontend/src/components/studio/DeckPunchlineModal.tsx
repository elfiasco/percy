import { useState } from "react"
import { fetchDeckPunchline } from "../../lib/studioApi"
import type { DeckPunchlineResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DeckPunchlineModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<DeckPunchlineResult | null>(null)
  const [error, setError]     = useState("")
  const [copied, setCopied]   = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchDeckPunchline(docId))
    } catch {
      setError("Failed to generate punchline")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!data) return
    navigator.clipboard.writeText(`${data.punchline}\n\n${data.takeaway}`)
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
            <h2 className="text-white font-semibold text-sm">Deck Punchline</h2>
            <p className="text-white/40 text-xs mt-0.5">AI distills your deck into one memorable sentence</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Crafting punchline…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="bg-accent/5 border border-accent/25 rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-accent/50 uppercase tracking-wider">Core Message</p>
                <p className="text-white text-base font-semibold leading-snug">{data.punchline}</p>
              </div>

              {data.takeaway && (
                <div className="space-y-1">
                  <p className="text-white/40 text-xs font-medium uppercase tracking-wide">Takeaway</p>
                  <p className="text-white/60 text-sm leading-relaxed">{data.takeaway}</p>
                </div>
              )}

              {data.proof_points.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-white/40 text-xs font-medium uppercase tracking-wide">Proof Points</p>
                  {data.proof_points.map((p, i) => (
                    <div key={i} className="flex gap-2 text-xs text-white/55">
                      <span className="text-accent/50 shrink-0">•</span>
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to distill your deck's core message.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
            {data && (
              <button onClick={copy} className="text-sm text-white/40 hover:text-white/70 px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                {copied ? "✓ Copied" : "Copy"}
              </button>
            )}
          </div>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : data ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
