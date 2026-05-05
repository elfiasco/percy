import { useState } from "react"
import { suggestDeckTitles } from "../../lib/studioApi"
import type { DeckTitleSuggestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const STYLES = [
  { key: "professional", label: "Professional" },
  { key: "compelling",   label: "Compelling" },
  { key: "concise",      label: "Concise" },
  { key: "creative",     label: "Creative" },
  { key: "bold",         label: "Bold" },
]

export default function DeckTitleModal({ docId, onClose }: Props) {
  const [style, setStyle]         = useState("professional")
  const [loading, setLoading]     = useState(false)
  const [titles, setTitles]       = useState<DeckTitleSuggestion[] | null>(null)
  const [error, setError]         = useState("")
  const [copied, setCopied]       = useState<number | null>(null)

  const generate = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await suggestDeckTitles(docId, 5, style)
      setTitles(r.titles)
    } catch {
      setError("Failed to generate title suggestions")
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(idx)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Title Suggester</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates compelling title options for your presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Style</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStyle(s.key)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${style === s.key ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Generating titles…</span>
            </div>
          )}

          {titles !== null && !loading && (
            <div className="space-y-2">
              {titles.map((t, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-white/80 text-sm font-medium">{t.title}</p>
                    <button
                      onClick={() => copy(t.title, i)}
                      className="text-[10px] text-white/30 hover:text-white/70 shrink-0 transition-colors"
                    >
                      {copied === i ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  {t.rationale && (
                    <p className="text-white/35 text-xs mt-1 leading-relaxed">{t.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {titles === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Generate" to get title suggestions.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={generate}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Generating…" : titles ? "Regenerate" : "Generate Titles"}
          </button>
        </div>
      </div>
    </div>
  )
}
