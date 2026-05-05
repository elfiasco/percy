import { useState } from "react"
import { fetchPresenterNotesSummarizer } from "../../lib/studioApi"
import type { PresenterNotesSummaryResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function PresenterNotesSummarizerModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PresenterNotesSummaryResult | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchPresenterNotesSummarizer(docId)
      setData(res)
    } catch {
      setError("Failed to summarize presenter notes")
    } finally {
      setLoading(false)
    }
  }

  const copyText = () => {
    if (!data) return
    const text = [data.summary, "", "Key Points:", ...data.key_points.map(p => `• ${p}`)].join("\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Presenter Notes Summarizer</h2>
            <p className="text-white/40 text-xs mt-0.5">AI condenses all speaker notes into a quick presenter briefing</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Summarizing notes…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-white/30">{data.total_slides_with_notes} slide{data.total_slides_with_notes !== 1 ? "s" : ""} with notes</p>
                <button onClick={copyText}
                  className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              {data.summary && (
                <div className="bg-white/3 border border-white/8 rounded-lg p-4">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Briefing</p>
                  <p className="text-[11px] text-white/60 leading-relaxed">{data.summary}</p>
                </div>
              )}

              {data.key_points.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Key Points</p>
                  {data.key_points.map((pt, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {pt}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Summarize" to get a presenter briefing from your notes.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Summarizing…" : "Summarize"}
          </button>
        </div>
      </div>
    </div>
  )
}
