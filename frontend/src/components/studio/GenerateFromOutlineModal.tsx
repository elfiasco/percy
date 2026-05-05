/**
 * GenerateFromOutlineModal — AI-powered bulk slide generation from a text outline.
 * Each non-empty line = one slide. Uses Claude to fill in content.
 */

import { useState, useEffect, useRef } from "react"
import { generateFromOutline } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onGenerated: (newSlideCount: number) => void
}

export default function GenerateFromOutlineModal({ docId, onClose, onGenerated }: Props) {
  const [outline, setOutline] = useState("")
  const [append, setAppend]   = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<{ created: number; topics: string[] } | null>(null)
  const textareaRef           = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const lineCount = outline.split("\n").filter((l) => l.trim()).length

  const handleGenerate = async () => {
    if (!outline.trim() || generating) return
    setGenerating(true)
    setError(null)
    try {
      const r = await generateFromOutline(docId, outline, append)
      setResult({ created: r.created, topics: r.topics })
      onGenerated(r.slide_count)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface border border-edge rounded-xl shadow-2xl w-[560px] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div>
            <span className="text-sm font-semibold text-slate-200">✨ Generate from Outline</span>
            <p className="text-[10px] text-muted/70 mt-0.5">One line = one slide. Claude generates content for each topic.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-xl leading-none px-2">✕</button>
        </div>

        {result ? (
          /* success state */
          <div className="px-5 py-6 flex flex-col items-center gap-4">
            <div className="text-green-400 text-4xl">✓</div>
            <p className="text-sm text-slate-200 font-semibold">Generated {result.created} slides!</p>
            <ul className="text-xs text-muted space-y-0.5 max-h-40 overflow-y-auto w-full">
              {result.topics.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted/40 font-mono w-4 shrink-0">{i+1}</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-1.5 rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          /* input state */
          <div className="px-5 py-4 flex flex-col gap-3">
            <div>
              <label className="text-[10px] text-muted/70 uppercase tracking-wider mb-1 block">
                Outline — one topic per line ({lineCount} slide{lineCount !== 1 ? "s" : ""})
              </label>
              <textarea
                ref={textareaRef}
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                placeholder={"Introduction\nProblem Statement\nOur Solution\nKey Benefits\nNext Steps"}
                rows={8}
                className="w-full text-xs bg-base border border-edge rounded px-3 py-2 text-slate-300
                           placeholder:text-muted/40 focus:outline-none focus:border-accent resize-none leading-relaxed"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={append}
                  onChange={(e) => setAppend(e.target.checked)}
                  className="accent-accent"
                />
                Append slides (uncheck to replace all)
              </label>
              {lineCount > 0 && lineCount > 25 && (
                <span className="text-xs text-amber-400">Max 25 slides per generation</span>
              )}
            </div>

            {error && (
              <p className="text-xs text-bad bg-bad/10 border border-bad/30 rounded px-3 py-1.5">{error}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded border border-edge text-muted hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || lineCount === 0 || lineCount > 25}
                className="text-xs px-4 py-1.5 rounded bg-paper/30 text-paper border border-paper/40
                           hover:bg-paper/40 transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                {generating ? `Generating ${lineCount} slides…` : `Generate ${lineCount} slide${lineCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
