import { useState } from "react"
import { fetchOpeningCloserEvaluator } from "../../lib/studioApi"
import type { SlideEval } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${value >= 7 ? "bg-green-400/60" : value >= 4 ? "bg-yellow-400/60" : "bg-red-400/60"}`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-[10px] text-white/40 w-6 text-right shrink-0">{value}/10</span>
    </div>
  )
}

function SlideEvalCard({ title, slideN, eval: e, onJump }: { title: string; slideN: number; eval: SlideEval; onJump: () => void }) {
  return (
    <div className="bg-white/3 border border-white/8 rounded-lg px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-white/80 text-xs font-semibold">{title}</h3>
        <button onClick={onJump} className="text-[10px] text-accent/60 hover:text-accent transition-colors">Slide {slideN}</button>
      </div>
      <div className="space-y-1.5">
        <ScoreBar label="Impact" value={e.impact} />
        <ScoreBar label="Clarity" value={e.clarity} />
      </div>
      {e.verdict && <p className="text-xs text-white/60 italic">{e.verdict}</p>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[10px] text-green-400/60 font-semibold mb-0.5">Strength</p>
          <p className="text-white/55 leading-relaxed">{e.strength}</p>
        </div>
        <div>
          <p className="text-[10px] text-accent/60 font-semibold mb-0.5">Improve</p>
          <p className="text-white/55 leading-relaxed">{e.improvement}</p>
        </div>
      </div>
    </div>
  )
}

export default function OpeningCloserEvaluatorModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ opening: SlideEval; closing: SlideEval } | null>(null)
  const [slideCount, setSlideCount] = useState(0)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchOpeningCloserEvaluator(docId)
      setData(res)
      setSlideCount(0)
    } catch {
      setError("Failed to evaluate opening/closing")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Opening & Closer Evaluator</h2>
            <p className="text-white/40 text-xs mt-0.5">AI evaluates the quality of your first and last slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Evaluating opening and closing…</p>
            </div>
          )}

          {data && !loading && data.opening && data.closing && (
            <>
              <SlideEvalCard title="Opening Slide" slideN={1} eval={data.opening}
                onJump={() => { onJumpToSlide(1); onClose() }} />
              <SlideEvalCard title="Closing Slide" slideN={slideCount || 999} eval={data.closing}
                onJump={() => onClose()} />
            </>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Evaluate" to assess your opening and closing slides.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Evaluating…" : "Evaluate"}
          </button>
        </div>
      </div>
    </div>
  )
}
