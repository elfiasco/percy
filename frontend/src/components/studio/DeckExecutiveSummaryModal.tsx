import { useState } from "react"
import { fetchDeckExecutiveSummary } from "../../lib/studioApi"
import type { ExecSummaryResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function DeckExecutiveSummaryModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ExecSummaryResult | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchDeckExecutiveSummary(docId)
      setData(res)
    } catch {
      setError("Failed to generate executive summary")
    } finally {
      setLoading(false)
    }
  }

  const copyAll = () => {
    if (!data) return
    const text = [
      `TL;DR: ${data.tldr}`,
      "",
      "Key Takeaways:",
      ...data.key_takeaways.map((t, i) => `${i + 1}. ${t}`),
      "",
      `CTA: ${data.call_to_action}`,
      `Read time: ${data.estimated_read_time}`,
    ].join("\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Executive Summary</h2>
            <p className="text-white/40 text-xs mt-0.5">AI writes a C-suite-ready summary of your presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Summarizing deck…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-3">
                <p className="text-[10px] text-accent/50 uppercase tracking-wider mb-1">TL;DR</p>
                <p className="text-sm text-white/80 leading-relaxed">{data.tldr}</p>
              </div>

              <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-2">
                <p className="text-[10px] text-white/30 uppercase tracking-wider">Key Takeaways</p>
                {data.key_takeaways.map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[10px] text-accent/50 shrink-0 mt-0.5">{i + 1}.</span>
                    <p className="text-[11px] text-white/65 leading-relaxed">{t}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg p-3">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Call to Action</p>
                  <p className="text-[11px] text-white/60 leading-relaxed">{data.call_to_action}</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg p-3">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Est. Read Time</p>
                  <p className="text-[11px] text-white/60">{data.estimated_read_time}</p>
                </div>
              </div>
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Summarize" to generate an executive summary.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
            {data && (
              <button onClick={copyAll} className="text-sm text-white/40 hover:text-white/70 px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
          </div>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Summarizing…" : "Summarize"}
          </button>
        </div>
      </div>
    </div>
  )
}
