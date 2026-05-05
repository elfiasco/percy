import { useState } from "react"
import { fetchDeckElevatorPitch } from "../../lib/studioApi"
import type { DeckElevatorPitch } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

type Variant = "main" | "formal" | "casual" | "bold"

const variants: { key: Variant; label: string; color: string }[] = [
  { key: "main",   label: "Main",   color: "text-accent border-accent/30 bg-accent/8" },
  { key: "formal", label: "Formal", color: "text-blue-400 border-blue-400/20 bg-blue-400/8" },
  { key: "casual", label: "Casual", color: "text-green-400 border-green-400/20 bg-green-400/8" },
  { key: "bold",   label: "Bold",   color: "text-red-400 border-red-400/20 bg-red-400/8" },
]

export default function DeckElevatorPitchModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DeckElevatorPitch | null>(null)
  const [error, setError] = useState("")
  const [active, setActive] = useState<Variant>("main")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchDeckElevatorPitch(docId))
    } catch {
      setError("Failed to generate elevator pitch")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!data) return
    navigator.clipboard.writeText(data[active]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Elevator Pitch</h2>
            <p className="text-white/40 text-xs mt-0.5">AI writes a 30-second pitch in 3 styles</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Writing pitch…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-2">
                {variants.map(v => (
                  <button key={v.key} onClick={() => setActive(v.key)}
                    className={`px-3 py-1 rounded text-xs border transition-colors ${
                      active === v.key ? v.color : "bg-white/5 border-white/10 text-white/40"
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-4 min-h-[100px]">
                <p className="text-white/80 text-sm leading-relaxed">{data[active]}</p>
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to write your 30-second elevator pitch.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {data && (
              <button onClick={copy}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/80 transition-colors">
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            <button onClick={run} disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
              {loading ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
