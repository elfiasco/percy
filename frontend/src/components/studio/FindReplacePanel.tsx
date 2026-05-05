/**
 * FindReplacePanel — floating find & replace panel for Percy Studio.
 * Searches text across all slides; replaces in-place in the Bridge model.
 */

import { useState, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { searchText, replaceText } from "../../lib/studioApi"
import type { TextSearchMatch } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number, elementId?: string) => void
  onReplaced: () => void
}

export default function FindReplacePanel({ docId, onClose, onJumpToSlide, onReplaced }: Props) {
  const [find, setFind]             = useState("")
  const [replace, setReplace]       = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex]     = useState(false)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [regexError, setRegexError] = useState<string | null>(null)
  const [matches, setMatches]       = useState<TextSearchMatch[]>([])
  const [searching, setSearching]   = useState(false)
  const [replacing, setReplacing]   = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const findRef = useRef<HTMLInputElement>(null)

  useEffect(() => { findRef.current?.focus() }, [])

  useEffect(() => {
    if (!find.trim()) { setMatches([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try { setMatches(await searchText(docId, find, includeNotes)) }
      catch { setMatches([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [docId, find, includeNotes])

  // validate regex
  useEffect(() => {
    if (!useRegex || !find) { setRegexError(null); return }
    try { new RegExp(find); setRegexError(null) }
    catch (e: unknown) { setRegexError(e instanceof Error ? e.message : "Invalid regex") }
  }, [find, useRegex])

  async function handleReplace() {
    if (!find.trim() || (useRegex && regexError)) return
    setReplacing(true)
    setLastResult(null)
    try {
      const res = await replaceText(docId, find, replace, caseSensitive, useRegex, includeNotes)
      setLastResult(
        res.replaced === 0
          ? "No matches found"
          : `Replaced ${res.replaced} occurrence${res.replaced !== 1 ? "s" : ""} on ${res.affected_slides.length} slide${res.affected_slides.length !== 1 ? "s" : ""}`,
      )
      setMatches([])
      if (res.replaced > 0) onReplaced()
    } catch (e) {
      setLastResult(`Error: ${e}`)
    } finally {
      setReplacing(false)
    }
  }

  return (
    <div className="absolute top-0 right-0 w-80 bg-surface border-l border-b border-edge shadow-2xl z-50 flex flex-col text-sm">
      {/* header */}
      <div className="flex items-center px-3 py-2 border-b border-edge">
        <span className="text-xs font-semibold text-slate-300 flex-1">Find & Replace</span>
        <button onClick={onClose} className="p-0.5 text-muted hover:text-slate-200 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {/* find */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-0.5">Find</label>
          <input
            ref={findRef}
            className="w-full bg-black/30 border border-edge rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent/60"
            placeholder="Search text…"
            value={find}
            onChange={e => { setFind(e.target.value); setLastResult(null) }}
            onKeyDown={e => { if (e.key === "Escape") onClose() }}
          />
        </div>

        {/* replace */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-0.5">Replace with</label>
          <input
            className="w-full bg-black/30 border border-edge rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent/60"
            placeholder="Replacement text…"
            value={replace}
            onChange={e => setReplace(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleReplace(); if (e.key === "Escape") onClose() }}
          />
        </div>

        {/* options */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={e => setCaseSensitive(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-xs text-muted">Match case</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={e => setUseRegex(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-xs text-muted font-mono">.*</span>
            <span className="text-xs text-muted">Regex</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={e => setIncludeNotes(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-xs text-muted">Notes</span>
          </label>
        </div>
        {regexError && (
          <p className="text-[10px] text-bad">{regexError}</p>
        )}

        {/* replace button */}
        <button
          onClick={handleReplace}
          disabled={!find.trim() || replacing}
          className="w-full text-xs py-1.5 rounded bg-accent/20 text-accent border border-accent/30
                     hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {replacing ? "Replacing…" : "Replace All"}
        </button>

        {/* result message */}
        {lastResult && (
          <p className={`text-xs ${lastResult.startsWith("Error") ? "text-bad" : lastResult === "No matches found" ? "text-muted" : "text-good"}`}>
            {lastResult}
          </p>
        )}
      </div>

      {/* match list */}
      {matches.length > 0 && (
        <div className="border-t border-edge max-h-48 overflow-y-auto">
          <p className="text-[10px] text-muted uppercase tracking-wide px-3 py-1.5 border-b border-edge">
            {searching ? "Searching…" : `${matches.length} match${matches.length !== 1 ? "es" : ""}`}
          </p>
          {matches.map((m, i) => (
            <button
              key={i}
              onClick={() => onJumpToSlide(m.slide_n, m.in_notes ? undefined : m.element_id)}
              className="w-full text-left px-3 py-1.5 hover:bg-white/5 border-b border-edge/50 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-accent-light shrink-0">Slide {m.slide_n}</span>
                {m.in_notes
                  ? <span className="text-[10px] text-paper/70 shrink-0">Notes</span>
                  : <span className="text-[10px] text-muted shrink-0">{m.element_type.replace("Bridge", "")}</span>
                }
              </div>
              <p className="text-[10px] text-muted truncate mt-0.5">{m.preview}</p>
            </button>
          ))}
        </div>
      )}
      {find.trim() && !searching && matches.length === 0 && !lastResult && (
        <p className="text-[10px] text-muted px-3 pb-2">No matches</p>
      )}
    </div>
  )
}
