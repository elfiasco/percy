import { useState } from "react"
import { fetchTaglineVariations } from "../../lib/studioApi"
import type { TaglineVariation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const TONE_COLORS: Record<string, string> = {
  professional:  "text-blue-300 bg-blue-400/8 border-blue-400/20",
  inspirational: "text-yellow-300 bg-yellow-400/8 border-yellow-400/20",
  urgent:        "text-red-300 bg-red-400/8 border-red-400/20",
  playful:       "text-green-300 bg-green-400/8 border-green-400/20",
  technical:     "text-cyan-300 bg-cyan-400/8 border-cyan-400/20",
  executive:     "text-paper bg-paper/8 border-paper/20",
}

export default function TaglineVariationsModal({ docId, onClose }: Props) {
  const [loading, setLoading]     = useState(false)
  const [variations, setVariations] = useState<TaglineVariation[] | null>(null)
  const [error, setError]         = useState("")
  const [copied, setCopied]       = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchTaglineVariations(docId)
      setVariations(res.variations)
    } catch {
      setError("Failed to generate tagline variations")
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Tagline Variations</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates deck titles in 6 different tones</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating variations…</p>
            </div>
          )}

          {variations !== null && !loading && (
            <div className="space-y-2">
              {variations.map((v, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${TONE_COLORS[v.tone.toLowerCase()] ?? "text-white/40 bg-white/5 border-white/10"}`}>
                      {v.tone}
                    </span>
                    <button onClick={() => copy(`${v.title}\n${v.tagline}`, i)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/30 hover:text-white/60 transition-colors shrink-0">
                      {copied === i ? "✓" : "Copy"}
                    </button>
                  </div>
                  <p className="text-white/80 text-sm font-medium leading-tight">{v.title}</p>
                  {v.tagline && <p className="text-white/45 text-xs leading-relaxed">{v.tagline}</p>}
                </div>
              ))}
            </div>
          )}

          {variations === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to get title variations.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
