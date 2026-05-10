import { useState, useRef, useEffect, useCallback } from "react"
import { addSlide, deleteSlide, duplicateSlide, moveSlide, fetchNotesSummary, importSlides, fetchSlideLabels, setSlideLabel, setSlideTag, setSlideTransition, fetchSlideTransitions, fetchSlideSections, setSlideSection, fetchComments, exportSlideUrl, setSlidesBackground, getTimerBudget, setTimerBudget, setSlideBackgroundImage, fetchSlideRatings, setSlideRating, fetchPresentationCheck, fetchSlidePins, pinSlide, fetchHiddenSlides, setSlideHidden } from "../../lib/studioApi"

const TAG_COLORS = [
  { color: null,      label: "None" },
  { color: "#EF4444", label: "Red" },
  { color: "#F97316", label: "Orange" },
  { color: "#EAB308", label: "Yellow" },
  { color: "#22C55E", label: "Green" },
  { color: "#3B82F6", label: "Blue" },
  { color: "#A855F7", label: "Purple" },
  { color: "#EC4899", label: "Pink" },
]

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  dirtySlides?: Set<number>
  refreshKey?: number
  pinnedSlides?: Set<number>
  onPinChange?: (slideN: number, pinned: boolean) => void
  onSelect: (n: number) => void
  onSlideCountChange: (newCount: number, focusSlide: number) => void
}

interface ContextMenu {
  x: number
  y: number
  slideN: number
}

export default function StudioSlideStrip({
  docId, slideCount, selectedSlide, dirtySlides, refreshKey, pinnedSlides: pinnedSlidesProp, onPinChange, onSelect, onSlideCountChange,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [busy, setBusy]               = useState(false)
  const [stripKey, setStripKey]       = useState(0)
  const [dragSlide, setDragSlide]     = useState<number | null>(null)
  const [dropTarget, setDropTarget]   = useState<number | null>(null)
  const [hoverN, setHoverN]           = useState<number | null>(null)
  const [hoverY, setHoverY]           = useState(0)
  const [slidesWithNotes, setSlidesWithNotes] = useState<Set<number>>(new Set())
  const [notesWordCounts, setNotesWordCounts] = useState<Record<number, number>>({})
  const [commentCounts, setCommentCounts]   = useState<Record<number, number>>({})
  const [importing, setImporting]     = useState(false)
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set())
  const [thumbnailSize, setThumbnailSize] = useState<"sm" | "md">("sm")
  const [slideLabels, setSlideLabels] = useState<Record<number, string>>({})
  const [slideTags, setSlideTags]     = useState<Record<number, string>>({})
  const [editingLabel, setEditingLabel] = useState<number | null>(null)
  const [editLabelText, setEditLabelText] = useState("")
  const [slideTransitions, setSlideTransitions] = useState<Record<number, string>>({})
  const [slideSections, setSlideSections]       = useState<Record<number, string>>({})
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [filterTag, setFilterTag]     = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [slideRatings, setSlideRatings]   = useState<Record<number, number>>({})
  const [slideIssues, setSlideIssues]     = useState<Record<number, "warning" | "error">>({})
  const [pinnedSlidesInternal, setPinnedSlidesInternal] = useState<Set<number>>(new Set())
  const pinnedSlides = pinnedSlidesProp ?? pinnedSlidesInternal
  const [hiddenSlides, setHiddenSlides]   = useState<Set<number>>(new Set())
  const [timerBudgetMin, setTimerBudgetMin] = useState<number | null>(null)
  const [editingTimer, setEditingTimer] = useState(false)
  const [timerInput, setTimerInput]   = useState("")
  const importInputRef                = useRef<HTMLInputElement>(null)
  const bgImageInputRef               = useRef<HTMLInputElement>(null)
  const bgImageTargetRef              = useRef<number>(0)
  const stripRef = useRef<HTMLDivElement>(null)

  // Fetch notes summary and slide labels on mount/refresh
  useEffect(() => {
    fetchNotesSummary(docId)
      .then((r) => {
        setSlidesWithNotes(new Set(r.slides_with_notes))
        if (r.word_counts) {
          setNotesWordCounts(Object.fromEntries(Object.entries(r.word_counts).map(([k, v]) => [Number(k), v as number])))
        }
      })
      .catch(() => {})
    fetchSlideLabels(docId)
      .then((r) => {
        setSlideLabels(Object.fromEntries(Object.entries(r.labels).map(([k, v]) => [Number(k), v])))
        setSlideTags(Object.fromEntries(Object.entries(r.tags ?? {}).map(([k, v]) => [Number(k), v])))
      })
      .catch(() => {})
    fetchSlideTransitions(docId)
      .then((r) => setSlideTransitions(
        Object.fromEntries(Object.entries(r.transitions).map(([k, v]) => [Number(k), v.transition]))
      ))
      .catch(() => {})
    fetchSlideSections(docId)
      .then((r) => setSlideSections(
        Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [Number(k), v as string]))
      ))
      .catch(() => {})
    fetchComments(docId)
      .then((r) => {
        const counts: Record<number, number> = {}
        for (const c of r.comments) {
          if (!c.resolved) counts[c.slide_n] = (counts[c.slide_n] ?? 0) + 1
        }
        setCommentCounts(counts)
      })
      .catch(() => {})
    getTimerBudget(docId)
      .then((r) => setTimerBudgetMin(r.total_minutes))
      .catch(() => {})
    fetchSlideRatings(docId)
      .then((r) => setSlideRatings(Object.fromEntries(Object.entries(r.ratings).map(([k, v]) => [Number(k), v]))))
      .catch(() => {})
    fetchSlidePins(docId)
      .then((r) => setPinnedSlidesInternal(new Set(r.pinned)))
      .catch(() => {})
    fetchHiddenSlides(docId)
      .then((r) => setHiddenSlides(new Set(r.hidden)))
      .catch(() => {})
    fetchPresentationCheck(docId)
      .then((r) => {
        const map: Record<number, "warning" | "error"> = {}
        for (const issue of r.issues) {
          if (issue.severity === "error") map[issue.slide_n] = "error"
          else if (!map[issue.slide_n]) map[issue.slide_n] = "warning"
        }
        setSlideIssues(map)
      })
      .catch(() => {})
  }, [docId, stripKey, refreshKey])

  const commitLabel = useCallback(async (n: number, text: string) => {
    setEditingLabel(null)
    const trimmed = text.trim()
    setSlideLabels((prev) => ({ ...prev, [n]: trimmed }))
    try {
      await setSlideLabel(docId, n, trimmed)
    } catch (e) { console.error("label save failed:", e) }
  }, [docId])

  // close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [contextMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, n: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, slideN: n })
  }, [])

  const run = useCallback(async (fn: () => Promise<{ slide_count: number; new_slide_n?: number }>, focus?: (r: { slide_count: number; new_slide_n?: number }) => number) => {
    setBusy(true)
    setContextMenu(null)
    try {
      const r = await fn()
      const focusSlide = focus ? focus(r) : Math.min(selectedSlide, r.slide_count)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, focusSlide)
    } catch (e) {
      console.error("slide action failed:", e)
    } finally {
      setBusy(false)
    }
  }, [selectedSlide, onSlideCountChange])

  const handleAdd = useCallback(() => {
    run(
      () => addSlide(docId, selectedSlide),
      (r) => r.new_slide_n ?? selectedSlide + 1,
    )
  }, [docId, selectedSlide, run])

  const handleDelete = useCallback(async (n?: number) => {
    const toDelete = n !== undefined ? [n] : [...multiSelected].sort((a, b) => b - a)
    if (!toDelete.length) return
    setBusy(true)
    setContextMenu(null)
    try {
      let lastCount = slideCount
      for (const slideN of toDelete) {
        const r = await deleteSlide(docId, slideN) as { slide_count: number }
        lastCount = r.slide_count
      }
      setMultiSelected(new Set())
      setStripKey((k) => k + 1)
      onSlideCountChange(lastCount, Math.min(selectedSlide, lastCount))
    } catch (e) {
      console.error("delete slide(s) failed:", e)
    } finally {
      setBusy(false)
    }
  }, [docId, selectedSlide, slideCount, multiSelected, onSlideCountChange])

  const handleDuplicate = useCallback(async (n?: number) => {
    const toDup = n !== undefined ? [n] : [...multiSelected].sort((a, b) => a - b)
    if (!toDup.length) return
    setBusy(true)
    setContextMenu(null)
    try {
      let lastNewN = toDup[0]
      let lastCount = slideCount
      for (const slideN of toDup) {
        const r = await duplicateSlide(docId, slideN)
        lastNewN  = r.new_slide_n ?? slideN + 1
        lastCount = r.slide_count
      }
      setMultiSelected(new Set())
      setStripKey((k) => k + 1)
      onSlideCountChange(lastCount, lastNewN)
    } catch (e) {
      console.error("duplicate slide(s) failed:", e)
    } finally {
      setBusy(false)
    }
  }, [docId, slideCount, multiSelected, onSlideCountChange])

  const handleMoveUp = useCallback((n: number) => {
    if (n <= 1) return
    if (pinnedSlides.has(n)) { alert(`Slide ${n} is pinned — unpin it first to reorder.`); return }
    setMultiSelected(new Set())
    run(
      () => moveSlide(docId, n, n - 1) as Promise<{ slide_count: number }>,
      () => n - 1,
    )
  }, [docId, run, pinnedSlides])

  const handleMoveDown = useCallback((n: number) => {
    if (n >= slideCount) return
    if (pinnedSlides.has(n)) { alert(`Slide ${n} is pinned — unpin it first to reorder.`); return }
    setMultiSelected(new Set())
    run(
      () => moveSlide(docId, n, n + 1) as Promise<{ slide_count: number }>,
      () => n + 1,
    )
  }, [docId, slideCount, run, pinnedSlides])

  // Ctrl+Up / Ctrl+Down to reorder the active slide
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      e.preventDefault()
      if (e.key === "ArrowUp") handleMoveUp(selectedSlide)
      else handleMoveDown(selectedSlide)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selectedSlide, handleMoveUp, handleMoveDown])

  const handleSlideClick = useCallback((e: React.MouseEvent, n: number) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle into multi-select
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.has(n)) { next.delete(n) } else { next.add(n) }
        return next
      })
    } else if (e.shiftKey && selectedSlide) {
      // Shift+click: range select
      const lo = Math.min(selectedSlide, n)
      const hi = Math.max(selectedSlide, n)
      setMultiSelected(new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)))
    } else {
      // Normal click: clear multi-select, set active
      setMultiSelected(new Set())
      onSelect(n)
    }
  }, [selectedSlide, onSelect])

  const handleDragStart = useCallback((e: React.DragEvent, n: number) => {
    setDragSlide(n)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(n))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, n: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget(n)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetN: number) => {
    e.preventDefault()
    const srcN = dragSlide
    setDragSlide(null)
    setDropTarget(null)
    if (!srcN || srcN === targetN) return
    run(
      () => moveSlide(docId, srcN, targetN) as Promise<{ slide_count: number }>,
      () => targetN,
    )
  }, [dragSlide, docId, run])

  const handleDragEnd = useCallback(() => {
    setDragSlide(null)
    setDropTarget(null)
  }, [])

  const handleImport = useCallback(async (file: File) => {
    setImporting(true)
    try {
      const r = await importSlides(docId, file)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, r.slide_count - r.imported + 1)
    } catch (e) {
      console.error("import slides failed:", e)
    } finally {
      setImporting(false)
    }
  }, [docId, onSlideCountChange])

  return (
    <div
      ref={stripRef}
      className="w-44 shrink-0 flex flex-col border-r border-[#e0e0e0] bg-[#f8f9fa] min-h-0"
      style={{ fontFamily: "'Google Sans',Roboto,sans-serif" }}
    >
      {/* ── Slides / Outline tab row (PPT-style) ──────────────── */}
      <div className="flex items-stretch border-b border-gray-300 bg-white shrink-0">
        <button
          className="flex-1 py-1.5 text-[11px] font-medium text-[#1a73e8] border-b-2 border-[#1a73e8] bg-white transition-colors"
          title="Slides panel"
        >
          Slides
        </button>
        <button
          className="flex-1 py-1.5 text-[11px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors border-b-2 border-transparent"
          title="Outline panel (shows slide text)"
          onClick={() => {/* outline toggle handled by ribbon View > Outline */}}
        >
          Outline
        </button>
        <div className="flex items-center px-1 gap-0.5 border-l border-gray-200">
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Import slides from PPTX"
            className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-colors text-xs disabled:opacity-40"
          >
            {importing ? "…" : "⤵"}
          </button>
          <button
            onClick={handleAdd}
            disabled={busy}
            title="Add slide after current"
            className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-colors text-sm font-bold disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* multi-select action bar */}
      {multiSelected.size > 0 && (
        <div className="px-2 py-1 border-b border-gray-200 bg-[#e8f0fe] shrink-0 flex items-center gap-1">
          <span className="text-[10px] text-[#1a73e8] font-medium">{multiSelected.size} selected</span>
          <button
            onClick={() => handleDuplicate()}
            disabled={busy}
            title="Duplicate selected"
            className="text-[9px] px-1 py-0.5 rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-40"
          >⊕</button>
          <button
            onClick={() => handleDelete()}
            disabled={busy || slideCount - multiSelected.size < 1}
            title="Delete selected"
            className="text-[9px] px-1 py-0.5 rounded bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 transition-colors disabled:opacity-40"
          >✕</button>
          <button
            onClick={() => setMultiSelected(new Set())}
            title="Clear selection"
            className="text-[9px] px-1 text-gray-400 hover:text-gray-600 transition-colors ml-auto"
          >✕ clear</button>
          {/* bg color picker for multi-selected */}
          <label
            title="Set background color for selected slides"
            className="text-[9px] px-1 py-0.5 rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
          >
              🎨
              <input
                type="color"
                className="hidden"
                onChange={(e) => {
                  const slides = [...multiSelected]
                  setSlidesBackground(docId, slides, e.target.value)
                    .then(() => setStripKey((k) => k + 1))
                    .catch(() => {})
                }}
              />
            </label>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = "" } }}
      />
      <input
        ref={bgImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          const n = bgImageTargetRef.current
          setBusy(true)
          try {
            await setSlideBackgroundImage(docId, n, f)
            setStripKey((k) => k + 1)
            onSlideCountChange(slideCount, selectedSlide)
          } catch (err) { console.error("bg image upload failed:", err) }
          finally { setBusy(false) }
        }}
      />

      {/* tag filter bar */}
      {Object.keys(slideTags).length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200 shrink-0 flex-wrap">
          <button
            onClick={() => setFilterTag(null)}
            title="Show all slides"
            className={`text-[8px] px-1 py-0.5 rounded transition-colors ${!filterTag ? "bg-gray-300 text-gray-700" : "text-gray-400 hover:text-gray-600"}`}
          >
            All
          </button>
          {TAG_COLORS.filter((t) => t.color && Object.values(slideTags).includes(t.color)).map((t) => (
            <button
              key={t.color}
              onClick={() => setFilterTag(filterTag === t.color ? null : t.color)}
              title={`Filter: ${t.label}`}
              className="w-3 h-3 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: t.color!,
                borderColor: filterTag === t.color ? "#1a1a1a" : "transparent",
              }}
            />
          ))}
        </div>
      )}

      {/* search bar */}
      <div className="px-2 py-1 border-b border-gray-200 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search slides…"
          className="w-full text-[10px] bg-white border border-gray-300 rounded px-1.5 py-0.5
                     text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-[#1a73e8]"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setSearchQuery("") }}
        />
      </div>

      {/* timer budget bar */}
      <div className="px-2 py-1 border-b border-gray-200 shrink-0 flex items-center gap-1">
        <span className="text-[8px] text-gray-400 shrink-0">⏱</span>
        {editingTimer ? (
          <input
            autoFocus
            type="number"
            min="1"
            max="999"
            value={timerInput}
            onChange={(e) => setTimerInput(e.target.value)}
            onBlur={async () => {
              setEditingTimer(false)
              const mins = timerInput.trim() ? parseFloat(timerInput) : null
              const valid = mins !== null && mins > 0 ? mins : null
              setTimerBudgetMin(valid)
              try { await setTimerBudget(docId, valid) } catch { /* ignore */ }
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              if (e.key === "Escape") { setEditingTimer(false); setTimerInput("") }
            }}
            placeholder="min"
            className="w-10 text-[9px] bg-white border border-gray-300 rounded px-1 py-0.5
                       text-gray-700 focus:outline-none focus:border-[#1a73e8]"
          />
        ) : (
          <button
            onClick={() => { setEditingTimer(true); setTimerInput(timerBudgetMin !== null ? String(timerBudgetMin) : "") }}
            className="text-[9px] text-gray-400 hover:text-gray-600 transition-colors truncate"
            title="Set total presentation time budget"
          >
            {timerBudgetMin !== null
              ? `${timerBudgetMin}m → ${Math.round((timerBudgetMin * 60) / slideCount)}s/slide`
              : "Set time budget…"}
          </button>
        )}
        {timerBudgetMin !== null && !editingTimer && (
          <button
            onClick={async () => { setTimerBudgetMin(null); try { await setTimerBudget(docId, null) } catch { /* ignore */ } }}
            className="text-[8px] text-gray-300 hover:text-red-500 transition-colors ml-auto shrink-0"
            title="Clear timer budget"
          >×</button>
        )}
      </div>

      {/* slide list — PPT style: thumbnail fills width, number+label below */}
      <div key={stripKey} className="flex flex-col gap-0 py-2 px-2 overflow-y-auto flex-1">
        {Array.from({ length: slideCount }, (_, i) => i + 1).filter((n) => {
          if (filterTag && slideTags[n] !== filterTag) return false
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            const labelMatch = (slideLabels[n] ?? "").toLowerCase().includes(q)
            const sectionMatch = (slideSections[n] ?? "").toLowerCase().includes(q)
            const numMatch = String(n).includes(q)
            if (!labelMatch && !sectionMatch && !numMatch) return false
          }
          return true
        }).map((n) => {
          const active    = n === selectedSlide
          const dirty     = dirtySlides?.has(n) ?? false
          const hasNotes  = slidesWithNotes.has(n)
          const isMulti   = multiSelected.has(n)
          const tagColor  = slideTags[n] ?? null
          const isDragging = dragSlide === n
          const isDropTarget = dropTarget === n && dragSlide !== null && dragSlide !== n
          const sectionName = slideSections[n]
          const prevSection = n > 1 ? slideSections[n - 1] : undefined
          const isNewSection = sectionName && sectionName !== prevSection
          const isCollapsed = sectionName ? collapsedSections.has(sectionName) : false
          const sectionSlideCount = sectionName
            ? Array.from({ length: slideCount }, (_, i) => i + 1).filter((s) => slideSections[s] === sectionName).length
            : 0
          return (
            <div key={`wrap-${n}`} className="flex flex-col w-full gap-0 mb-1">
              {isNewSection && (
                <button
                  className="w-full px-1 py-0.5 mt-1 mb-0.5 text-[9px] font-semibold text-gray-500 border-t border-gray-300 truncate flex items-center gap-1 hover:text-gray-700 transition-colors text-left uppercase tracking-widest"
                  title={`${isCollapsed ? "Expand" : "Collapse"} section: ${sectionName}`}
                  onClick={() => setCollapsedSections((prev) => {
                    const next = new Set(prev)
                    if (next.has(sectionName)) next.delete(sectionName); else next.add(sectionName)
                    return next
                  })}
                >
                  <span className="text-[8px]">{isCollapsed ? "▶" : "▼"}</span>
                  <span>{sectionName}</span>
                  {isCollapsed && <span className="ml-auto text-gray-400 font-mono normal-case tracking-normal">{sectionSlideCount}</span>}
                </button>
              )}
            {!isCollapsed && (
              <div
                draggable
                data-slide-strip
                data-slide-n={n}
                onDragStart={(e) => handleDragStart(e, n)}
                onDragOver={(e) => handleDragOver(e, n)}
                onDrop={(e) => handleDrop(e, n)}
                onDragEnd={handleDragEnd}
                className={[
                  "flex flex-col rounded transition-all group w-full cursor-grab active:cursor-grabbing p-1",
                  active      ? "ring-2 ring-[#1a73e8] bg-[#e8f0fe]"
                    : isMulti ? "ring-1 ring-gray-400 bg-gray-100"
                    : "hover:bg-gray-200",
                  isDragging  ? "opacity-40" : hiddenSlides.has(n) ? "opacity-50" : "",
                  isDropTarget ? "ring-2 ring-[#1a73e8] bg-[#e8f0fe]" : "",
                ].join(" ")}
                onClick={(e) => handleSlideClick(e, n)}
                onContextMenu={(e) => handleContextMenu(e, n)}
                onMouseEnter={(e) => { setHoverN(n); setHoverY((e.currentTarget as HTMLElement).getBoundingClientRect().top) }}
                onMouseLeave={() => setHoverN(null)}
                key={n}
              >
                {/* ── Thumbnail — fills full width, 16:9 ratio ── */}
                <div className="w-full aspect-video bg-white border border-gray-300 overflow-hidden relative shadow-sm">
                  <img
                    src={`/api/docs/${docId}/slides/${n}/bridge.png?v=${stripKey}-${refreshKey ?? 0}`}
                    alt={`Slide ${n}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  {/* overlays */}
                  {hasNotes && (() => {
                    const wc = notesWordCounts[n] ?? 0
                    const quality = wc >= 80 ? "text-emerald-600" : wc >= 30 ? "text-amber-600" : "text-gray-500"
                    const label = wc >= 80 ? "📝" : wc >= 30 ? "📋" : "✏"
                    return (
                      <span title={`Speaker notes: ${wc} words`}
                        className={`absolute bottom-0.5 right-0.5 text-[8px] ${quality} bg-white/80 rounded px-0.5 leading-tight shadow-sm`}>
                        {label}
                      </span>
                    )
                  })()}
                  {tagColor && (
                    <span title={`Tagged: ${TAG_COLORS.find((t) => t.color === tagColor)?.label ?? tagColor}`}
                      className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full border border-white/60 shadow-sm"
                      style={{ background: tagColor }} />
                  )}
                  {slideTransitions[n] && (
                    <span title={`Transition: ${slideTransitions[n]}`}
                      className="absolute bottom-0.5 left-0.5 text-[8px] text-gray-600 bg-white/80 rounded px-0.5 leading-tight">
                      ▷
                    </span>
                  )}
                  {timerBudgetMin !== null && (() => {
                    const secsPerSlide = Math.round((timerBudgetMin * 60) / slideCount)
                    const display = secsPerSlide >= 60 ? `${Math.round(secsPerSlide / 6) / 10}m` : `${secsPerSlide}s`
                    return (
                      <span title={`Timer: ~${secsPerSlide}s per slide`}
                        className="absolute top-0.5 right-0.5 text-[7px] text-blue-700 bg-blue-50/90 rounded px-0.5 leading-tight font-mono">
                        {display}
                      </span>
                    )
                  })()}
                  {commentCounts[n] > 0 && (
                    <span title={`${commentCounts[n]} open comment${commentCounts[n] !== 1 ? "s" : ""}`}
                      className="absolute top-0.5 right-0.5 text-[7px] font-bold text-white bg-orange-500 rounded-full min-w-[13px] h-[13px] flex items-center justify-center leading-none shadow-sm">
                      {commentCounts[n]}
                    </span>
                  )}
                  {slideIssues[n] && (
                    <span title={`QA: ${slideIssues[n]}`}
                      className={`absolute bottom-0.5 right-0.5 text-[7px] rounded px-0.5 leading-tight font-bold ${
                        slideIssues[n] === "error" ? "text-red-600 bg-red-100" : "text-amber-600 bg-amber-100"
                      }`}>
                      {slideIssues[n] === "error" ? "✕" : "⚠"}
                    </span>
                  )}
                  {pinnedSlides.has(n) && (
                    <span title="Pinned" className="absolute bottom-0.5 left-0.5 text-[9px]">📌</span>
                  )}
                  {hiddenSlides.has(n) && (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/50 text-[9px] text-gray-500 font-semibold tracking-wider uppercase pointer-events-none">
                      Hidden
                    </span>
                  )}
                  {dirty && (
                    <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" title="Unsaved changes" />
                  )}
                </div>

                {/* ── Number + label below thumbnail (PPT style) ── */}
                <div className="flex items-center gap-1 mt-0.5 px-0.5">
                  <span className={`text-[10px] font-medium tabular-nums shrink-0 ${active ? "text-[#1a73e8]" : "text-gray-500"}`}>
                    {n}
                  </span>
                  {editingLabel === n ? (
                    <input
                      autoFocus
                      value={editLabelText}
                      onChange={(e) => setEditLabelText(e.target.value)}
                      onBlur={() => commitLabel(n, editLabelText)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter") { e.preventDefault(); commitLabel(n, editLabelText) }
                        if (e.key === "Escape") { setEditingLabel(null) }
                      }}
                      className="flex-1 min-w-0 text-[9px] bg-white border border-[#1a73e8] rounded px-1 py-0 text-gray-800 focus:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : slideLabels[n] ? (
                    <span
                      title={`Label: ${slideLabels[n]} — double-click to edit`}
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(n); setEditLabelText(slideLabels[n] ?? "") }}
                      className="flex-1 min-w-0 text-[9px] text-gray-500 truncate cursor-text"
                    >
                      {slideLabels[n]}
                    </span>
                  ) : (
                    <span
                      title="Double-click to add a label"
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(n); setEditLabelText("") }}
                      className="flex-1 text-[9px] text-transparent hover:text-gray-300 transition-colors cursor-text"
                    >
                      +label
                    </span>
                  )}
                  {/* star rating — visible on hover or when rated */}
                  <div
                    className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                      (slideRatings[n] ?? 0) > 0 || hoverN === n ? "opacity-100" : "opacity-0"
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {[1, 2, 3, 4, 5].map((star) => {
                      const current = slideRatings[n] ?? 0
                      return (
                        <button key={star}
                          title={current === star ? "Clear rating" : `Rate ${star} star${star !== 1 ? "s" : ""}`}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const newRating = current === star ? null : star
                            setSlideRatings((prev) => { const next = { ...prev }; if (newRating === null) delete next[n]; else next[n] = newRating; return next })
                            await setSlideRating(docId, n, newRating).catch(() => {})
                          }}
                          className={`text-[8px] leading-none ${star <= current ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}`}
                        >★</button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
            </div>
          )
        })}
      </div>

      {/* hover preview */}
      {hoverN !== null && !contextMenu && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: 180,
            top: Math.max(8, Math.min(hoverY - 20, window.innerHeight - 130)),
          }}
        >
          <div className="bg-white border border-gray-300 rounded shadow-2xl p-1 w-64">
            <img
              src={`/api/docs/${docId}/slides/${hoverN}/bridge.png?v=${stripKey}-${refreshKey ?? 0}`}
              alt={`Slide ${hoverN} preview`}
              className="w-full aspect-video rounded object-cover block"
            />
            <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
              <span className="text-[10px] text-gray-500">Slide {hoverN}</span>
              <div className="flex items-center gap-1">
                {hiddenSlides.has(hoverN) && <span className="text-[8px] text-gray-400">hidden</span>}
                {pinnedSlides.has(hoverN) && <span className="text-[9px]">📌</span>}
                {slideRatings[hoverN] && <span className="text-[9px] text-amber-500">{"★".repeat(slideRatings[hoverN])}</span>}
              </div>
            </div>
            {(slideSections[hoverN] || notesWordCounts[hoverN] > 0 || slideIssues[hoverN]) && (
              <div className="flex flex-wrap gap-1 px-1 pb-1">
                {slideSections[hoverN] && (
                  <span className="text-[8px] text-gray-500">§ {slideSections[hoverN]}</span>
                )}
                {notesWordCounts[hoverN] > 0 && (
                  <span className="text-[8px] text-emerald-600">{notesWordCounts[hoverN]}w notes</span>
                )}
                {slideIssues[hoverN] && (
                  <span className={`text-[8px] font-bold ${slideIssues[hoverN] === "error" ? "text-red-400" : "text-amber-400"}`}>
                    {slideIssues[hoverN] === "error" ? "✕ error" : "⚠ warning"}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] bg-white border border-gray-300 rounded shadow-xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <CtxItem onClick={() => { setEditingLabel(contextMenu.slideN); setEditLabelText(slideLabels[contextMenu.slideN] ?? ""); setContextMenu(null) }}>
            Rename slide
          </CtxItem>
          <CtxItem onClick={() => {
            const n = contextMenu.slideN
            const current = slideSections[n] ?? ""
            const name = window.prompt("Section name (blank to clear):", current)
            if (name === null) { setContextMenu(null); return }
            const trimmed = name.trim()
            setSlideSections((prev) => {
              const next = { ...prev }
              if (trimmed) next[n] = trimmed; else delete next[n]
              return next
            })
            setSlideSection(docId, n, trimmed || "").catch(() => {})
            setContextMenu(null)
          }}>
            Set section…
          </CtxItem>
          {/* tag color picker */}
          <div className="px-3 py-1.5">
            <div className="text-[9px] text-gray-400 mb-1.5 uppercase tracking-wider">Color tag</div>
            <div className="flex flex-wrap gap-1">
              {TAG_COLORS.map((t) => (
                <button
                  key={t.color ?? "none"}
                  title={t.label}
                  onClick={() => {
                    const n = contextMenu.slideN
                    setSlideTags((prev) => {
                      const next = { ...prev }
                      if (t.color) next[n] = t.color; else delete next[n]
                      return next
                    })
                    setSlideTag(docId, n, t.color).catch(() => {})
                    setContextMenu(null)
                  }}
                  className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    background: t.color ?? "transparent",
                    borderColor: t.color ? (slideTags[contextMenu.slideN] === t.color ? "#fff" : "rgba(255,255,255,0.2)") : "rgba(255,255,255,0.3)",
                  }}
                />
              ))}
            </div>
          </div>
          {/* transition picker */}
          <div className="px-3 py-1.5">
            <div className="text-[9px] text-gray-400 mb-1.5 uppercase tracking-wider">Transition</div>
            <div className="flex flex-wrap gap-1">
              {(["none","fade","slide","zoom","flip","push","wipe","dissolve"] as const).map((t) => {
                const active = (slideTransitions[contextMenu.slideN] ?? "none") === t
                return (
                  <button
                    key={t}
                    title={t}
                    onClick={() => {
                      const n = contextMenu.slideN
                      setSlideTransitions((prev) => {
                        const next = { ...prev }
                        if (t === "none") delete next[n]; else next[n] = t
                        return next
                      })
                      setSlideTransition(docId, n, t).catch(() => {})
                      setContextMenu(null)
                    }}
                    className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors capitalize ${
                      active
                        ? "bg-[#1a73e8]/10 text-[#1a73e8] border-[#1a73e8]/30"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="border-t border-gray-200 my-1" />
          <CtxItem onClick={() => run(() => addSlide(docId, contextMenu.slideN - 1), (r) => r.new_slide_n ?? contextMenu.slideN)}>
            Insert before
          </CtxItem>
          <CtxItem onClick={() => run(() => addSlide(docId, contextMenu.slideN), (r) => r.new_slide_n ?? contextMenu.slideN + 1)}>
            Insert after
          </CtxItem>
          <CtxItem onClick={() => handleDuplicate(contextMenu.slideN)}>Duplicate slide</CtxItem>
          <div className="border-t border-gray-200 my-1" />
          <CtxItem onClick={() => handleMoveUp(contextMenu.slideN)} disabled={contextMenu.slideN <= 1}>
            Move up
          </CtxItem>
          <CtxItem onClick={() => handleMoveDown(contextMenu.slideN)} disabled={contextMenu.slideN >= slideCount}>
            Move down
          </CtxItem>
          <div className="border-t border-gray-200 my-1" />
          <CtxItem onClick={async () => {
            const n = contextMenu.slideN
            const isHidden = hiddenSlides.has(n)
            setHiddenSlides((prev) => {
              const next = new Set(prev)
              if (isHidden) next.delete(n); else next.add(n)
              return next
            })
            await setSlideHidden(docId, n, !isHidden).catch(() => {})
            setContextMenu(null)
          }}>
            {hiddenSlides.has(contextMenu.slideN) ? "Show slide" : "Hide slide"}
          </CtxItem>
          <CtxItem onClick={async () => {
            const n = contextMenu.slideN
            const isPinned = pinnedSlides.has(n)
            setPinnedSlidesInternal((prev) => {
              const next = new Set(prev)
              if (isPinned) next.delete(n); else next.add(n)
              return next
            })
            onPinChange?.(n, !isPinned)
            await pinSlide(docId, n, !isPinned).catch(() => {})
            setContextMenu(null)
          }}>
            {pinnedSlides.has(contextMenu.slideN) ? "Unpin slide" : "Pin slide"}
          </CtxItem>
          <CtxItem onClick={() => {
            bgImageTargetRef.current = contextMenu.slideN
            setContextMenu(null)
            bgImageInputRef.current?.click()
          }}>
            Set background image…
          </CtxItem>
          <CtxItem onClick={() => { window.open(`/api/docs/${docId}/slides/${contextMenu.slideN}/bridge.png`, "_blank"); setContextMenu(null) }}>
            Download PNG
          </CtxItem>
          <CtxItem onClick={() => { window.open(exportSlideUrl(docId, contextMenu.slideN), "_blank"); setContextMenu(null) }}>
            Download as PPTX
          </CtxItem>
          <div className="border-t border-gray-200 my-1" />
          <CtxItem
            onClick={() => handleDelete(contextMenu.slideN)}
            disabled={slideCount <= 1}
            danger
          >
            Delete slide
          </CtxItem>
        </div>
      )}
    </div>
  )
}

function CtxItem({
  children, onClick, disabled, danger,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "w-full text-left px-3 py-1 text-[12px] transition-colors",
        disabled ? "text-gray-300 cursor-default" :
        danger   ? "text-red-600 hover:bg-red-50" :
                   "text-gray-700 hover:bg-gray-100",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
