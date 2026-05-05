/**
 * AgendaSlideModal — insert a formatted agenda/TOC slide from the deck's titles.
 */

import { useState, useEffect, useCallback } from "react"
import { fetchDocumentOutline, insertAgendaSlide } from "../../lib/studioApi"
import type { SlideOutlineEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onInserted: (newSlideN: number, newSlideCount: number) => void
}

export default function AgendaSlideModal({ docId, slideCount, currentSlide, onClose, onInserted }: Props) {
  const [entries, setEntries]     = useState<SlideOutlineEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [inserting, setInserting] = useState(false)
  const [title, setTitle]         = useState("Agenda")
  const [afterN, setAfterN]       = useState(0)
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [result, setResult]       = useState<{ n: number; count: number } | null>(null)

  useEffect(() => {
    fetchDocumentOutline(docId)
      .then((r) => {
        const valid = r.slides.filter((s) => s.title.trim())
        setEntries(r.slides)
        setSelected(new Set(valid.map((s) => s.slide_n)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const toggleAll = useCallback(() => {
    const valid = entries.filter((e) => e.title.trim())
    if (selected.size === valid.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(valid.map((e) => e.slide_n)))
    }
  }, [entries, selected])

  const toggle = useCallback((n: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }, [])

  const handleInsert = useCallback(async () => {
    setInserting(true)
    try {
      const slideNums = selected.size > 0 ? [...selected].sort((a, b) => a - b) : null
      const r = await insertAgendaSlide(docId, {
        title: title.trim() || "Agenda",
        after_n: afterN,
        slide_numbers: slideNums,
      })
      setResult({ n: r.new_slide_n, count: r.item_count })
      onInserted(r.new_slide_n, r.slide_count)
    } catch (e) {
      console.error("insert agenda failed:", e)
    } finally {
      setInserting(false)
    }
  }, [docId, title, afterN, selected, onInserted])

  const validCount = entries.filter((e) => e.title.trim()).length
  const selectedCount = [...selected].filter((n) => entries.find((e) => e.slide_n === n && e.title.trim())).length

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">Insert Agenda Slide</span>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-4">

          {/* title input */}
          <div>
            <label className="block text-[11px] text-muted mb-1">Slide title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full text-sm bg-base border border-edge rounded px-3 py-1.5 text-slate-200
                         focus:outline-none focus:border-accent placeholder:text-muted/40"
              placeholder="Agenda"
            />
          </div>

          {/* insert position */}
          <div>
            <label className="block text-[11px] text-muted mb-1">Insert position</label>
            <select
              value={afterN}
              onChange={(e) => setAfterN(Number(e.target.value))}
              className="w-full text-sm bg-base border border-edge rounded px-3 py-1.5 text-slate-200
                         focus:outline-none focus:border-accent"
            >
              <option value={0}>Before slide 1 (at the beginning)</option>
              {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>After slide {n}{n === currentSlide ? " (current)" : ""}</option>
              ))}
            </select>
          </div>

          {/* slide selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-muted">Slides to include ({selectedCount} of {validCount})</span>
              <button
                onClick={toggleAll}
                className="text-[10px] text-accent hover:text-accent/80 transition-colors"
              >
                {selectedCount === validCount ? "Deselect all" : "Select all"}
              </button>
            </div>
            {loading ? (
              <div className="py-4 text-center text-sm text-muted animate-pulse">Loading slides…</div>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-thin pr-1">
                {entries.map((entry) => {
                  const hasTitle = Boolean(entry.title.trim())
                  return (
                    <label
                      key={entry.slide_n}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded cursor-pointer transition-colors
                        ${hasTitle ? "hover:bg-white/5" : "opacity-40 cursor-default"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(entry.slide_n)}
                        disabled={!hasTitle}
                        onChange={() => hasTitle && toggle(entry.slide_n)}
                        className="accent-accent w-3.5 h-3.5 shrink-0"
                      />
                      <span className="text-[10px] text-muted/60 w-6 shrink-0 text-right font-mono">{entry.slide_n}</span>
                      <span className="text-sm text-slate-300 truncate">
                        {entry.title || <span className="italic text-muted/50">(no title)</span>}
                      </span>
                      {entry.section && (
                        <span className="text-[10px] text-paper/70 ml-auto shrink-0">{entry.section}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* preview hint */}
          {selectedCount > 0 && (
            <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3">
              <div className="text-[10px] text-muted uppercase tracking-wide mb-2">Preview</div>
              <div className="text-[11px] font-bold text-white mb-1.5">{title || "Agenda"}</div>
              <div className="space-y-0.5">
                {[...selected]
                  .sort((a, b) => a - b)
                  .slice(0, 8)
                  .map((n) => {
                    const entry = entries.find((e) => e.slide_n === n)
                    return entry ? (
                      <div key={n} className="text-[10px] text-slate-400">
                        {n}. {entry.title}
                      </div>
                    ) : null
                  })}
                {selectedCount > 8 && (
                  <div className="text-[10px] text-muted/60 italic">…and {selectedCount - 8} more</div>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="text-xs rounded px-3 py-2 border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              Inserted agenda slide at position {result.n} with {result.count} item{result.count !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="shrink-0 px-5 py-3 border-t border-edge">
          <button
            onClick={handleInsert}
            disabled={inserting || selectedCount === 0 || loading}
            className="w-full text-sm py-2 rounded bg-accent/20 text-accent border border-accent/30
                       hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {inserting ? "Inserting…" : result ? "Insert Again" : `Insert Agenda Slide (${selectedCount} items)`}
          </button>
        </div>
      </div>
    </div>
  )
}
