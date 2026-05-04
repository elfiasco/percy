/**
 * OutlinePanel — collapsible left panel showing slide titles in order.
 * Click a slide to jump to it. Inline-edit the title text.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { fetchDocumentOutline, updateElementText, fetchSlideLabels } from "../../lib/studioApi"
import type { SlideOutlineEntry } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  refreshKey?: number
  onJumpToSlide: (n: number) => void
}

export default function OutlinePanel({ docId, slideCount, selectedSlide, refreshKey, onJumpToSlide }: Props) {
  const [entries, setEntries]     = useState<SlideOutlineEntry[]>([])
  const [slideLabels, setLabels]  = useState<Record<number, string>>({})
  const [slideTags, setTags]       = useState<Record<number, string>>({})
  const [editingN, setEditingN]   = useState<number | null>(null)
  const [editVal, setEditVal]     = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocumentOutline(docId)
      .then((r) => setEntries(r.slides))
      .catch(() => {})
    fetchSlideLabels(docId)
      .then((r) => {
        setLabels(Object.fromEntries(Object.entries(r.labels).map(([k, v]) => [Number(k), v])))
        setTags(Object.fromEntries(Object.entries(r.tags ?? {}).map(([k, v]) => [Number(k), v])))
      })
      .catch(() => {})
  }, [docId, slideCount, refreshKey])

  useEffect(() => {
    if (editingN !== null) inputRef.current?.focus()
  }, [editingN])

  const commitEdit = useCallback(async (entry: SlideOutlineEntry) => {
    const trimmed = editVal.trim()
    if (trimmed && trimmed !== entry.title && entry.title_el_id) {
      try {
        await updateElementText(docId, entry.slide_n, entry.title_el_id, {
          kind: "paragraphs",
          paragraphs: [{ runs: [{ text: trimmed }] }],
        })
        setEntries((prev) => prev.map((e) => e.slide_n === entry.slide_n ? { ...e, title: trimmed } : e))
      } catch (err) { console.error("title update failed:", err) }
    }
    setEditingN(null)
  }, [editVal, docId])

  return (
    <div className="w-52 shrink-0 border-r border-edge bg-surface flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-edge shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-muted uppercase tracking-widest font-semibold">Outline</span>
        <span className="text-[10px] text-muted/50 ml-auto">{entries.length} slides</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {entries.map((entry) => {
          const isSelected = entry.slide_n === selectedSlide
          return (
            <div
              key={entry.slide_n}
              className={[
                "px-3 py-2 border-b border-edge/40 last:border-b-0 cursor-pointer group",
                isSelected ? "bg-accent/10" : "hover:bg-white/5",
              ].join(" ")}
              onClick={() => onJumpToSlide(entry.slide_n)}
            >
              <div className="flex items-baseline gap-1.5">
                {slideTags[entry.slide_n] && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mt-0.5"
                    style={{ background: slideTags[entry.slide_n], alignSelf: "center" }}
                  />
                )}
                <span className={`text-[10px] shrink-0 font-mono ${isSelected ? "text-accent-light" : "text-muted/60"}`}>
                  {entry.slide_n}
                </span>
                {editingN === entry.slide_n ? (
                  <input
                    ref={inputRef}
                    className="flex-1 min-w-0 text-xs bg-black/40 border border-accent/60 rounded px-1 py-0 text-slate-200 focus:outline-none"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(entry)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === "Enter") { e.preventDefault(); commitEdit(entry) }
                      if (e.key === "Escape") setEditingN(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className={`text-xs truncate flex-1 min-w-0 ${isSelected ? "text-slate-200 font-medium" : "text-slate-400"}`}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (entry.title_el_id) {
                        setEditingN(entry.slide_n)
                        setEditVal(entry.title)
                      }
                    }}
                    title={entry.title || "(untitled)"}
                  >
                    {entry.title || <span className="text-muted/40 italic">untitled</span>}
                  </span>
                )}
              </div>
              {slideLabels[entry.slide_n] && (
                <p className="text-[10px] text-indigo-300/60 truncate mt-0.5 ml-5">
                  {slideLabels[entry.slide_n]}
                </p>
              )}
              {entry.body_preview && (
                <p className="text-[10px] text-muted/50 truncate mt-0.5 ml-5">{entry.body_preview}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
