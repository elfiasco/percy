import { useState } from "react"
import { fetchFlowFeedback } from "../../lib/studioApi"
import type { FlowFeedback } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

function ScoreRing({ score }: { score: number }) {
  const pct = (score / 10) * 100
  const color = score >= 8 ? "#4ade80" : score >= 5 ? "#facc15" : "#f87171"
  const r = 16
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle
        cx="22" cy="22" r={r} fill="none"
        stroke={color} strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
      <text x="22" y="22" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="10" fontWeight="bold">
        {score}
      </text>
    </svg>
  )
}

function SectionCard({ title, section }: { title: string; section: { score: number; feedback: string } }) {
  return (
    <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 flex items-start gap-3">
      <ScoreRing score={section.score} />
      <div>
        <div className="text-white/70 text-xs font-medium">{title}</div>
        <p className="text-white/45 text-xs mt-0.5 leading-relaxed">{section.feedback}</p>
      </div>
    </div>
  )
}

export default function FlowFeedbackModal({ docId, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [data, setData]         = useState<FlowFeedback | null>(null)
  const [error, setError]       = useState("")

  const analyze = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchFlowFeedback(docId)
      setData(r)
    } catch {
      setError("Failed to analyze deck flow")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Flow Feedback</h2>
            <p className="text-white/40 text-xs mt-0.5">AI reviews your narrative arc and story structure</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing narrative flow…</p>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Overall score + summary */}
              <div className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-lg px-4 py-3">
                <ScoreRing score={data.overall_score} />
                <div>
                  <div className="text-white/60 text-xs font-medium">Overall Flow Score</div>
                  <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{data.summary}</p>
                </div>
              </div>

              {/* Section scores */}
              <div className="space-y-2">
                <SectionCard title="Opening" section={data.opening} />
                <SectionCard title="Middle / Body" section={data.middle} />
                <SectionCard title="Closing" section={data.closing} />
                <SectionCard title="Transitions" section={data.transitions} />
              </div>

              {/* Strengths & improvements */}
              <div className="grid grid-cols-2 gap-3">
                {data.strengths.length > 0 && (
                  <div className="bg-green-400/5 border border-green-400/15 rounded-lg px-3 py-2">
                    <div className="text-green-400 text-xs font-medium mb-1">Strengths</div>
                    <ul className="space-y-0.5">
                      {data.strengths.map((s, i) => (
                        <li key={i} className="text-white/50 text-xs flex gap-1.5">
                          <span className="text-green-400/60">✓</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.improvements.length > 0 && (
                  <div className="bg-yellow-400/5 border border-yellow-400/15 rounded-lg px-3 py-2">
                    <div className="text-yellow-400 text-xs font-medium mb-1">Improvements</div>
                    <ul className="space-y-0.5">
                      {data.improvements.map((s, i) => (
                        <li key={i} className="text-white/50 text-xs flex gap-1.5">
                          <span className="text-yellow-400/60">→</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {data === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30">
              <p className="text-sm">Click "Analyze Flow" to get AI feedback on your deck structure.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button
            onClick={analyze}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Analyzing…" : data ? "Re-analyze" : "Analyze Flow"}
          </button>
        </div>
      </div>
    </div>
  )
}
