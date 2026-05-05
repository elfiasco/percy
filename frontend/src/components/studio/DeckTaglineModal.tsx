import { useState } from "react"
import { generateDeckTagline } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied?: () => void
}

export default function DeckTaglineModal({ docId, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(false)
  const [tagline, setTagline] = useState("")
  const [error, setError]     = useState("")
  const [applied, setApplied] = useState(false)

  const generate = async (applyIt = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await generateDeckTagline(docId, applyIt)
      setTagline(r.tagline)
      if (applyIt) { setApplied(true); onApplied?.() }
    } catch {
      setError("Failed to generate tagline")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Tagline</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates a punchy one-line summary</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-4">
              <div className="animate-spin text-base">✦</div>
              <span>Writing tagline…</span>
            </div>
          ) : tagline ? (
            <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
              <p className="text-white/80 text-base font-medium italic">"{tagline}"</p>
              {applied && <p className="text-green-400/60 text-xs mt-2">Added to first slide</p>}
            </div>
          ) : (
            <p className="text-white/40 text-xs">Click "Generate" to produce a tagline from your deck content.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {tagline && !applied && (
              <button
                onClick={() => generate(true)}
                disabled={loading}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Add to Slide 1
              </button>
            )}
            <button
              onClick={() => generate(false)}
              disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Generating…" : tagline ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
