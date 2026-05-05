import { useState } from "react"
import { fetchPresentationSummaryBullets } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function PresentationSummaryBulletsModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [bullets, setBullets] = useState<string[] | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchPresentationSummaryBullets(docId)
      setBullets(res.bullets)
    } catch {
      setError("Failed to generate summary")
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!bullets) return
    navigator.clipboard.writeText(bullets.map(b => `• ${b}`).join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Executive Summary</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates a 5-bullet summary of the entire deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Summarizing deck…</p>
            </div>
          )}

          {bullets && !loading && (
            <ul className="space-y-2.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-3 bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                  <span className="text-accent/60 text-xs font-semibold shrink-0 mt-0.5">{i + 1}.</span>
                  <p className="text-white/75 text-sm leading-relaxed">{b}</p>
                </li>
              ))}
            </ul>
          )}

          {bullets !== null && bullets.length === 0 && !loading && (
            <div className="text-white/30 text-xs text-center py-4">No summary generated.</div>
          )}

          {bullets === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Summarize" to generate an executive summary.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {bullets && bullets.length > 0 && (
              <button onClick={copy}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/90 transition-colors">
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            <button onClick={run} disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
              {loading ? "Summarizing…" : "Summarize"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
