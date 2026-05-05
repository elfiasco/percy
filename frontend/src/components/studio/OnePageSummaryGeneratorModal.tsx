import { useState } from "react"
import { fetchOnePageSummaryGenerator } from "../../lib/studioApi"
import type { OnePageSummaryResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function OnePageSummaryGeneratorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<OnePageSummaryResult | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchOnePageSummaryGenerator(docId)
      setData(res)
    } catch {
      setError("Failed to generate summary")
    } finally {
      setLoading(false)
    }
  }

  const copyAll = () => {
    if (!data) return
    const text = [
      `Background: ${data.background}`,
      "",
      `Main Argument: ${data.main_argument}`,
      "",
      "Supporting Points:",
      ...data.supporting_points.map((p, i) => `${i + 1}. ${p}`),
      "",
      "Evidence:",
      ...data.evidence_highlights.map(e => `• ${e}`),
      "",
      `Conclusion: ${data.conclusion}`,
      "",
      "Next Steps:",
      ...data.next_steps.map(n => `→ ${n}`),
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
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">One-Page Summary Generator</h2>
            <p className="text-white/40 text-xs mt-0.5">AI writes a full structured summary of the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Writing summary…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-3">
              {[
                { label: "Background", content: data.background },
                { label: "Main Argument", content: data.main_argument },
                { label: "Conclusion", content: data.conclusion },
              ].map(({ label, content }) => content ? (
                <div key={label} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-[11px] text-white/65 leading-relaxed">{content}</p>
                </div>
              ) : null)}

              {data.supporting_points.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Supporting Points</p>
                  {data.supporting_points.map((p, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[10px] text-accent/50 shrink-0">{i + 1}.</span>
                      <p className="text-[11px] text-white/60 leading-relaxed">{p}</p>
                    </div>
                  ))}
                </div>
              )}

              {data.evidence_highlights.length > 0 && (
                <div className="bg-blue-400/5 border border-blue-400/15 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-blue-400/60 uppercase tracking-wider">Evidence Highlights</p>
                  {data.evidence_highlights.map((e, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {e}</p>
                  ))}
                </div>
              )}

              {data.next_steps.length > 0 && (
                <div className="bg-green-400/5 border border-green-400/15 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-green-400/60 uppercase tracking-wider">Next Steps</p>
                  {data.next_steps.map((n, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">→ {n}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Generate" to create a one-page summary.</div>
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
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
