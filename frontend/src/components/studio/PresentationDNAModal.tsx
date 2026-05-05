import { useState } from "react"
import { fetchPresentationDNA } from "../../lib/studioApi"
import type { PresentationDNA } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function PresentationDNAModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PresentationDNA | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchPresentationDNA(docId))
    } catch {
      setError("Failed to analyze presentation DNA")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Presentation DNA</h2>
            <p className="text-white/40 text-xs mt-0.5">AI decodes the unique character of your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Decoding DNA…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-accent/8 border border-accent/20 rounded-lg px-4 py-3 text-center">
                <p className="text-xs text-white/40 mb-1">Archetype</p>
                <p className="text-accent font-semibold text-base">{data.archetype}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-white/40 mb-1">Style</p>
                  <p className="text-white/80 text-xs leading-relaxed">{data.style}</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-white/40 mb-1">Personality</p>
                  <p className="text-white/80 text-xs leading-relaxed">{data.personality}</p>
                </div>
              </div>

              {data.signature_phrases.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-white/40 mb-2">Signature Phrases</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.signature_phrases.map((p, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-accent/20 bg-accent/8 text-accent/70">"{p}"</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-green-400/70 mb-2">Strengths</p>
                  <ul className="space-y-1">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-white/60 flex gap-1.5">
                        <span className="text-green-400/50 shrink-0">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-yellow-400/70 mb-2">Blind Spots</p>
                  <ul className="space-y-1">
                    {data.blind_spots.map((b, i) => (
                      <li key={i} className="text-xs text-white/60 flex gap-1.5">
                        <span className="text-yellow-400/50 shrink-0">⚠</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to decode your presentation DNA.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
