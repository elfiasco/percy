import { useState } from "react"
import { generateDeckSummary } from "../../lib/studioApi"
import type { DeckSummaryStructured } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const AUDIENCES = [
  { id: "executive", label: "Executive",  desc: "Business impact, ROI, strategy" },
  { id: "technical",  label: "Technical",  desc: "Methods, data, implementation" },
  { id: "general",    label: "General",    desc: "Clear language, broad appeal" },
]

const FORMATS = [
  { id: "structured", label: "Structured (JSON)" },
  { id: "narrative",  label: "Narrative prose" },
  { id: "bullets",    label: "Bullet points" },
]

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "text-green-400",
  neutral: "text-yellow-400",
  negative: "text-red-400",
}

export default function DeckSummaryModal({ docId, onClose }: Props) {
  const [audience, setAudience] = useState<"executive" | "technical" | "general">("executive")
  const [format, setFormat]     = useState<"structured" | "narrative" | "bullets">("structured")
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<{ format: string; data: DeckSummaryStructured | null; raw: string; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const r = await generateDeckSummary(docId, audience, format)
      setResult(r)
    } catch {
      setError("Failed to generate summary")
    } finally {
      setLoading(false)
    }
  }

  const copyText = () => {
    if (!result) return
    const text = result.raw
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Deck Summarizer</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate an intelligent summary of your entire presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!result && (
            <>
              {/* audience */}
              <div>
                <p className="text-white/50 text-xs mb-2">Target audience</p>
                <div className="grid grid-cols-3 gap-2">
                  {AUDIENCES.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAudience(a.id as typeof audience)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${audience === a.id ? "border-accent/50 bg-accent/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/8"}`}
                    >
                      <div className="font-medium text-[13px]">{a.label}</div>
                      <div className="text-[11px] text-white/40 mt-0.5">{a.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* format */}
              <div>
                <p className="text-white/50 text-xs mb-2">Output format</p>
                <div className="flex gap-2">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id as typeof format)}
                      className={`flex-1 py-2 rounded-lg border text-xs transition-colors ${format === f.id ? "border-accent/50 bg-accent/10 text-white" : "border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/8"}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Analyzing presentation…
                  </span>
                ) : "Generate Summary"}
              </button>
            </>
          )}

          {result && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-white/40 text-xs">{result.slide_count} slides analyzed</span>
                <div className="flex gap-2">
                  <button
                    onClick={copyText}
                    className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/50 hover:text-white hover:bg-white/8 transition-colors"
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => setResult(null)}
                    className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>

              {result.format === "structured" && result.data ? (
                <div className="space-y-3">
                  {result.data.title && (
                    <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3">
                      <p className="text-accent text-[10px] uppercase tracking-wider mb-1">Deck Title</p>
                      <p className="text-white font-semibold text-sm">{result.data.title}</p>
                    </div>
                  )}
                  {result.data.core_message && (
                    <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                      <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Core Message</p>
                      <p className="text-white/80 text-sm leading-relaxed">{result.data.core_message}</p>
                      {result.data.sentiment && (
                        <span className={`text-[10px] mt-1 inline-block ${SENTIMENT_COLOR[result.data.sentiment] ?? "text-white/40"}`}>
                          {result.data.sentiment} tone
                        </span>
                      )}
                    </div>
                  )}
                  {result.data.key_points && result.data.key_points.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                      <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Key Points</p>
                      <ul className="space-y-1.5">
                        {result.data.key_points.map((p, i) => (
                          <li key={i} className="text-white/70 text-xs flex gap-2">
                            <span className="text-accent shrink-0">•</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.data.action_items && result.data.action_items.length > 0 && (
                    <div className="bg-green-400/5 border border-green-400/15 rounded-lg px-4 py-3">
                      <p className="text-green-400/60 text-[10px] uppercase tracking-wider mb-2">Action Items</p>
                      <ul className="space-y-1.5">
                        {result.data.action_items.map((a, i) => (
                          <li key={i} className="text-white/70 text-xs flex gap-2">
                            <span className="text-green-400 shrink-0">→</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.data.open_questions && result.data.open_questions.length > 0 && (
                    <div className="bg-yellow-400/5 border border-yellow-400/15 rounded-lg px-4 py-3">
                      <p className="text-yellow-400/60 text-[10px] uppercase tracking-wider mb-2">Open Questions</p>
                      <ul className="space-y-1.5">
                        {result.data.open_questions.map((q, i) => (
                          <li key={i} className="text-white/70 text-xs flex gap-2">
                            <span className="text-yellow-400 shrink-0">?</span>
                            <span>{q}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-white/70 text-xs font-mono leading-relaxed bg-black/30 border border-white/10 rounded-lg p-4 max-h-[50vh] overflow-y-auto">
                  {result.raw}
                </pre>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
