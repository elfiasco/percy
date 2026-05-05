import { useState } from "react"
import { fetchObjectionMap } from "../../lib/studioApi"
import type { ObjectionTheme } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const severityColor = (s: ObjectionTheme["severity"]) => ({
  low:    "text-green-400 border-green-400/20 bg-green-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  high:   "text-red-400 border-red-400/20 bg-red-400/8",
})[s]

export default function ObjectionMapModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [themes, setThemes] = useState<ObjectionTheme[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchObjectionMap(docId)
      setThemes(res.themes)
    } catch {
      setError("Failed to generate objection map")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Objection Map</h2>
            <p className="text-white/40 text-xs mt-0.5">AI groups audience objections by theme cluster</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Mapping objections…</p>
            </div>
          )}

          {themes && !loading && (
            <div className="space-y-3">
              {themes.map((t, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-white/80 text-xs font-semibold flex-1">{t.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${severityColor(t.severity)}`}>{t.severity}</span>
                  </div>
                  <ul className="space-y-1">
                    {t.objections.map((o, j) => (
                      <li key={j} className="text-xs text-white/60 flex gap-1.5">
                        <span className="text-red-400/40 shrink-0">•</span><span>{o}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-accent/65 text-xs leading-relaxed border-t border-white/8 pt-2">→ {t.suggested_response}</p>
                </div>
              ))}
              {themes.length === 0 && <div className="text-white/30 text-xs text-center py-4">No objection themes identified.</div>}
            </div>
          )}

          {themes === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Map" to generate an objection theme map.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Mapping…" : "Map"}
          </button>
        </div>
      </div>
    </div>
  )
}
