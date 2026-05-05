import { useState } from "react"
import { optimizeTitles, applyTitle } from "../../lib/studioApi"
import type { TitleSuggestion } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
  onApplied: () => void
}

export default function TitleOptimizerModal({ docId, onClose, onJumpToSlide, onApplied }: Props) {
  const [loading, setLoading]         = useState(false)
  const [suggestions, setSuggestions] = useState<TitleSuggestion[] | null>(null)
  const [meta, setMeta]               = useState<{ improved_count: number; slide_count: number } | null>(null)
  const [applying, setApplying]       = useState<number | null>(null)
  const [applied, setApplied]         = useState<Set<number>>(new Set())
  const [edits, setEdits]             = useState<Record<number, string>>({})
  const [showAll, setShowAll]         = useState(false)
  const [error, setError]             = useState("")

  const handleAnalyze = async () => {
    setLoading(true)
    setError("")
    setSuggestions(null)
    setMeta(null)
    setApplied(new Set())
    setEdits({})
    try {
      const r = await optimizeTitles(docId)
      setSuggestions(r.suggestions)
      setMeta({ improved_count: r.improved_count, slide_count: r.slide_count })
    } catch {
      setError("Failed to analyze titles")
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async (sug: TitleSuggestion) => {
    const title = edits[sug.slide_n] ?? sug.suggested
    setApplying(sug.slide_n)
    try {
      await applyTitle(docId, sug.slide_n, title)
      setApplied((prev) => { const s = new Set(prev); s.add(sug.slide_n); return s })
      onApplied()
    } catch {
      setError(`Failed to apply title for slide ${sug.slide_n}`)
    } finally {
      setApplying(null)
    }
  }

  const handleApplyAll = async () => {
    if (!suggestions) return
    const improvable = suggestions.filter((s) => s.reason !== "Already strong" && !applied.has(s.slide_n))
    for (const sug of improvable) {
      await handleApply(sug)
    }
  }

  const filtered = suggestions
    ? (showAll ? suggestions : suggestions.filter((s) => s.reason !== "Already strong"))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Title Optimizer</h2>
            <p className="text-white/40 text-xs mt-0.5">Improve slide titles for impact and clarity</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!suggestions && (
            <div className="space-y-3">
              <p className="text-white/50 text-sm">
                Claude will analyze each slide title and suggest shorter, more impactful alternatives.
                You can review and selectively apply suggestions.
              </p>
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Analyzing titles…
                  </span>
                ) : "Analyze Titles"}
              </button>
            </div>
          )}

          {suggestions !== null && (
            <>
              {meta && (
                <div className="flex items-center gap-3">
                  <span className="text-white/40 text-xs flex-1">
                    {meta.improved_count} improvement{meta.improved_count !== 1 ? "s" : ""} suggested across {meta.slide_count} slides
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAll}
                      onChange={(e) => setShowAll(e.target.checked)}
                      className="accent-accent"
                    />
                    <span className="text-white/40 text-xs">Show all</span>
                  </label>
                  {meta.improved_count > 1 && (
                    <button
                      onClick={handleApplyAll}
                      className="text-xs px-2.5 py-1 rounded border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                    >
                      Apply all
                    </button>
                  )}
                  <button
                    onClick={() => { setSuggestions(null); setMeta(null) }}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    Re-analyze
                  </button>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="text-center py-8 text-white/30 text-sm">All titles are already strong!</div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((sug) => {
                    const isApplied = applied.has(sug.slide_n)
                    const isStrong  = sug.reason === "Already strong"
                    const editVal   = edits[sug.slide_n] ?? sug.suggested
                    return (
                      <div
                        key={sug.slide_n}
                        className={`rounded-lg border px-4 py-3 space-y-2 ${isApplied ? "border-green-400/20 bg-green-400/5" : isStrong ? "border-white/8 bg-white/3 opacity-60" : "border-white/10 bg-white/5"}`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { onJumpToSlide(sug.slide_n) }}
                            className="text-white/30 text-[10px] hover:text-white/60 shrink-0"
                          >
                            Slide {sug.slide_n}
                          </button>
                          {isApplied && <span className="text-green-400 text-[10px]">✓ Applied</span>}
                          {isStrong && <span className="text-white/30 text-[10px]">Already strong</span>}
                        </div>
                        <div className="text-white/40 text-xs line-through">{sug.original}</div>
                        {!isStrong && (
                          <input
                            type="text"
                            value={editVal}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [sug.slide_n]: e.target.value }))}
                            className="w-full bg-transparent border-b border-white/15 text-white text-sm py-0.5 focus:outline-none focus:border-accent/50"
                          />
                        )}
                        {!isStrong && (
                          <div className="flex items-center gap-2">
                            <span className="text-white/30 text-[10px] flex-1 italic">{sug.reason}</span>
                            <button
                              onClick={() => handleApply(sug)}
                              disabled={applying === sug.slide_n || isApplied}
                              className="text-xs px-2.5 py-1 rounded border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors"
                            >
                              {applying === sug.slide_n ? "Applying…" : isApplied ? "Applied" : "Apply"}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
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
