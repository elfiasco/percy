import { useState } from "react"
import { fetchKeyMessageExtractor } from "../../lib/studioApi"
import type { KeyMessage } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const rankLabel = ["", "🥇", "🥈", "🥉"]
const confidenceColor = (n: number) =>
  n >= 8 ? "text-green-400" : n >= 5 ? "text-yellow-400" : "text-red-400"

export default function KeyMessageExtractorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<KeyMessage[] | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchKeyMessageExtractor(docId)
      setMessages(res.messages)
    } catch {
      setError("Failed to extract key messages")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Key Message Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies the top 3 things your deck is saying</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting key messages…</p>
            </div>
          )}

          {messages && !loading && (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.rank} className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{rankLabel[m.rank] ?? `#${m.rank}`}</span>
                    <span className={`ml-auto text-xs ${confidenceColor(m.confidence)}`}>Confidence: {m.confidence}/10</span>
                  </div>
                  <p className="text-white/80 text-sm leading-relaxed font-medium">{m.message}</p>
                  {m.evidence_slides.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-white/30">Supported by:</span>
                      {m.evidence_slides.map(n => (
                        <button key={n} onClick={() => { onJumpToSlide(n); onClose() }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 bg-accent/8 text-accent/60 hover:text-accent transition-colors">
                          s{n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {messages.length === 0 && <div className="text-white/30 text-xs text-center py-4">No key messages identified.</div>}
            </div>
          )}

          {messages === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Extract" to find the 3 key messages in your deck.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
