/**
 * NotesReviewPanel — scrollable list of all slide notes, editable inline.
 * Opens as a full-screen overlay. Shows thumbnail, word count, AI generate per slide.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { updateSlideNotes, generateSlideNotes, notesExportUrl, notesPagesPdfUrl, exportScriptUrl } from "../../lib/studioApi"

interface SlideNote {
  slideN: number
  text: string
  dirty: boolean
}

interface Props {
  docId: string
  slideCount: number
  initialSlide?: number
  refreshKey?: number
  onClose: () => void
  onJumpToSlide?: (n: number) => void
}

const WPM = 130

function wordCount(t: string) {
  return t.trim() ? t.trim().split(/\s+/).length : 0
}

function fmtTime(secs: number) {
  if (secs <= 0) return null
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m${s > 0 ? `${s}s` : ""}` : `${s}s`
}

export default function NotesReviewPanel({
  docId, slideCount, initialSlide, refreshKey, onClose, onJumpToSlide,
}: Props) {
  const [notes, setNotes] = useState<SlideNote[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<"all" | "with" | "without">("all")
  const [search, setSearch] = useState("")
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const activeRef = useRef<HTMLDivElement>(null)

  // load all notes in parallel
  useEffect(() => {
    setLoading(true)
    const fetches = Array.from({ length: slideCount }, (_, i) => i + 1).map((n) =>
      fetch(`/api/docs/${docId}/slides/${n}/notes`)
        .then((r) => r.json())
        .then((r: { notes_text: string }) => ({ slideN: n, text: r.notes_text ?? "", dirty: false }))
        .catch(() => ({ slideN: n, text: "", dirty: false }))
    )
    Promise.all(fetches).then((all) => {
      setNotes(all)
      setLoading(false)
    })
  }, [docId, slideCount, refreshKey])

  // scroll active slide into view on open
  useEffect(() => {
    if (!loading && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [loading])

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const handleChange = useCallback((n: number, text: string) => {
    setNotes((prev) => prev.map((s) => s.slideN === n ? { ...s, text, dirty: true } : s))
    clearTimeout(saveTimers.current[n])
    saveTimers.current[n] = setTimeout(() => {
      updateSlideNotes(docId, n, text)
        .then(() => setNotes((prev) => prev.map((s) => s.slideN === n ? { ...s, dirty: false } : s)))
        .catch(() => {})
    }, 800)
  }, [docId])

  const handleGenerate = useCallback(async (n: number) => {
    setGenerating((g) => new Set([...g, n]))
    try {
      const r = await generateSlideNotes(docId, n)
      handleChange(n, r.notes_text)
    } catch (e) { console.error("generate notes failed:", e) }
    finally { setGenerating((g) => { const next = new Set(g); next.delete(n); return next }) }
  }, [docId, handleChange])

  const filtered = notes.filter((s) => {
    if (filter === "with" && !s.text.trim()) return false
    if (filter === "without" && s.text.trim()) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!s.text.toLowerCase().includes(q) && !String(s.slideN).includes(q)) return false
    }
    return true
  })

  const totalWords = notes.reduce((sum, s) => sum + wordCount(s.text), 0)
  const totalSecs = Math.round((totalWords / WPM) * 60)
  const slidesWithNotes = notes.filter((s) => s.text.trim()).length

  return (
    <div
      className="fixed inset-0 z-[99999] bg-black/70 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex flex-col h-full max-w-4xl mx-auto w-full bg-[#0f1117] shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-slate-200 shrink-0">📝 Notes Review</span>
            <span className="text-[11px] text-muted/70 shrink-0">
              {slidesWithNotes}/{slideCount} slides · {totalWords}w
              {totalSecs > 0 && ` · ~${fmtTime(totalSecs)}`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* export links */}
            <a
              href={notesExportUrl(docId)}
              download
              className="text-[10px] px-2 py-1 rounded border border-edge text-muted hover:text-slate-200 hover:bg-white/5 transition-colors no-underline"
              title="Download as Markdown"
            >↓ MD</a>
            <a
              href={notesPagesPdfUrl(docId)}
              download
              className="text-[10px] px-2 py-1 rounded border border-edge text-muted hover:text-slate-200 hover:bg-white/5 transition-colors no-underline"
              title="Download notes pages as PDF"
            >↓ PDF</a>
            <a
              href={exportScriptUrl(docId)}
              download
              className="text-[10px] px-2 py-1 rounded border border-edge text-muted hover:text-slate-200 hover:bg-white/5 transition-colors no-underline"
              title="Download speaker script"
            >↓ Script</a>
            <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none ml-1">✕</button>
          </div>
        </div>

        {/* filter/search bar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-edge/50 shrink-0">
          {(["all", "with", "without"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors capitalize ${
                filter === f
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "border-edge text-muted hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              {f === "all" ? "All slides" : f === "with" ? "Has notes" : "Missing notes"}
            </button>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 text-xs bg-base border border-edge rounded px-2 py-1 text-slate-300
                       placeholder:text-muted/40 focus:outline-none focus:border-accent"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setSearch("") }}
          />
        </div>

        {/* list */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted text-sm animate-pulse">
            Loading notes…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
            {filtered.length === 0 ? (
              <p className="text-muted/50 text-sm text-center py-8">No slides match the filter.</p>
            ) : filtered.map((s) => {
              const wc = wordCount(s.text)
              const secs = Math.round((wc / WPM) * 60)
              const isActive = s.slideN === initialSlide
              const isGen = generating.has(s.slideN)
              return (
                <div
                  key={s.slideN}
                  ref={isActive ? activeRef : undefined}
                  className={`flex gap-3 rounded-lg p-3 border transition-colors ${
                    isActive
                      ? "border-accent/40 bg-accent/5"
                      : "border-edge/40 bg-white/2 hover:border-edge/70"
                  }`}
                >
                  {/* thumbnail */}
                  <div className="shrink-0 flex flex-col items-center gap-1">
                    <div
                      className="w-24 aspect-video bg-base rounded overflow-hidden cursor-pointer hover:ring-1 hover:ring-accent/50"
                      onClick={() => { onJumpToSlide?.(s.slideN); onClose() }}
                      title={`Jump to slide ${s.slideN}`}
                    >
                      <img
                        src={`/api/docs/${docId}/slides/${s.slideN}/bridge.png?v=${refreshKey ?? 0}`}
                        alt={`Slide ${s.slideN}`}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </div>
                    <span className={`text-[10px] font-mono ${isActive ? "text-accent" : "text-muted/70"}`}>
                      {s.slideN}
                    </span>
                  </div>

                  {/* notes editor */}
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      {wc > 0 && (
                        <span className={`text-[10px] ${
                          wc >= 80 ? "text-emerald-400/80" : wc >= 30 ? "text-amber-400/80" : "text-muted/60"
                        }`}>
                          {wc}w{secs > 0 ? ` · ~${fmtTime(secs)}` : ""}
                        </span>
                      )}
                      {s.dirty && <span className="text-[9px] text-amber-400/70">saving…</span>}
                      <div className="flex-1" />
                      <button
                        onClick={() => handleGenerate(s.slideN)}
                        disabled={isGen}
                        title="Generate notes with AI"
                        className="text-[9px] px-1.5 py-0.5 rounded border border-paper/30 text-paper/60
                                   hover:bg-paper/10 hover:text-paper transition-colors disabled:opacity-40"
                      >
                        {isGen ? "✨…" : "✨ Generate"}
                      </button>
                    </div>
                    <textarea
                      value={s.text}
                      onChange={(e) => handleChange(s.slideN, e.target.value)}
                      placeholder="Add speaker notes for this slide…"
                      rows={3}
                      spellCheck
                      className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1.5
                                 text-slate-300 placeholder:text-muted/40 focus:outline-none focus:border-accent
                                 resize-y leading-relaxed min-h-[56px]"
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
