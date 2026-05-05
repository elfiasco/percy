import { useState, useEffect } from "react"
import type { ReorderSuggestion } from "../../lib/studioApi"
import { suggestSlideReorder, reorderSlides } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onApplied: (newCount: number) => void
}

export default function ReorderSuggestModal({ docId, slideCount, onClose, onApplied }: Props) {
  const [loading, setLoading]       = useState(true)
  const [suggestion, setSuggestion] = useState<ReorderSuggestion | null>(null)
  const [applying, setApplying]     = useState(false)
  const [applied, setApplied]       = useState(false)
  const [error, setError]           = useState("")

  useEffect(() => {
    suggestSlideReorder(docId)
      .then(setSuggestion)
      .catch(() => setError("Failed to get suggestions. Check that the backend is running and ANTHROPIC_API_KEY is set."))
      .finally(() => setLoading(false))
  }, [docId])

  const handleApply = async () => {
    if (!suggestion) return
    setApplying(true)
    try {
      const r = await reorderSlides(docId, suggestion.suggested_order)
      setApplied(true)
      onApplied(r.slide_count)
    } catch (e) {
      setError("Failed to apply reorder.")
      console.error("reorder failed:", e)
    } finally {
      setApplying(false)
    }
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
            <h2 className="text-white font-semibold text-sm">AI Slide Reorder Suggestion</h2>
            <p className="text-white/40 text-xs mt-0.5">Optimal narrative order for {slideCount} slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <div className="animate-spin text-2xl mb-3">✦</div>
              <p className="text-sm">Analyzing narrative flow…</p>
            </div>
          )}

          {error && !loading && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {suggestion && !loading && (
            <>
              {/* rationale */}
              <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">
                <p className="text-accent text-xs font-medium mb-1">AI Analysis</p>
                <p className="text-white/70 text-xs leading-relaxed">{suggestion.rationale}</p>
              </div>

              {/* change summary */}
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${suggestion.changes === 0 ? "text-green-400" : "text-amber-400"}`}>
                  {suggestion.changes === 0
                    ? "✓ Current order is already optimal"
                    : `${suggestion.changes} slide${suggestion.changes !== 1 ? "s" : ""} would be repositioned`}
                </span>
              </div>

              {/* key moves */}
              {suggestion.key_moves.length > 0 && (
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Key changes</p>
                  <div className="space-y-1.5">
                    {suggestion.key_moves.map((move, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs bg-white/5 rounded-lg px-3 py-2">
                        <span className="text-white/50 shrink-0 mt-0.5">
                          #{move.from} → #{move.to}
                        </span>
                        <span className="text-white/70">{move.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* side-by-side order comparison */}
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Order comparison</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-white/30 text-[11px] mb-1.5">Current order</p>
                    <div className="space-y-0.5">
                      {suggestion.original_order.slice(0, 20).map((n, i) => {
                        const moved = suggestion.suggested_order[i] !== n
                        return (
                          <div key={i} className={`text-xs px-2 py-0.5 rounded ${moved ? "text-red-300/70 bg-red-400/5" : "text-white/40"}`}>
                            {i + 1}. Slide {n}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-white/30 text-[11px] mb-1.5">Suggested order</p>
                    <div className="space-y-0.5">
                      {suggestion.suggested_order.slice(0, 20).map((n, i) => {
                        const moved = suggestion.original_order[i] !== n
                        return (
                          <div key={i} className={`text-xs px-2 py-0.5 rounded ${moved ? "text-green-300/80 bg-green-400/8 font-medium" : "text-white/40"}`}>
                            {i + 1}. Slide {n}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {suggestion.original_order.length > 20 && (
                  <p className="text-white/25 text-[11px] mt-1">…and {suggestion.original_order.length - 20} more slides</p>
                )}
              </div>

              {applied && (
                <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
                  ✓ Slide order applied successfully
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {suggestion && !applied && suggestion.changes > 0 && (
            <button
              onClick={handleApply}
              disabled={applying}
              className="text-sm bg-accent hover:bg-accent/80 disabled:bg-white/10 disabled:text-white/30 text-white px-5 py-1.5 rounded-lg transition-colors font-medium"
            >
              {applying ? "Applying…" : "Apply Suggested Order"}
            </button>
          )}
          {(applied || (suggestion && suggestion.changes === 0)) && (
            <button
              onClick={onClose}
              className="text-sm bg-accent/70 text-white px-5 py-1.5 rounded-lg"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
