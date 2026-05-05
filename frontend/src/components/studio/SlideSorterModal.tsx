import { useState, useCallback, useEffect, useRef } from "react"
import { moveSlide, deleteSlide, duplicateSlide, fetchSlideLabels, fetchHiddenSlides, fetchSlidePins, fetchSlideRatings, fetchSlideSections, fetchNotesSummary, setSlideHidden, setSlideSection, setSlideTag, setSlideLabel, bulkDeleteSlides, bulkDuplicateSlides, exportSubsetUrl, reorderSlides } from "../../lib/studioApi"

const TAG_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#6366f1","#ec4899","#8b5cf6","#64748b"]

interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  onClose: () => void
  onJump: (n: number) => void
  onSlideCountChange: (newCount: number, focusSlide: number) => void
}

export default function SlideSorterModal({
  docId, slideCount, selectedSlide, onClose, onJump, onSlideCountChange,
}: Props) {
  const [dragSlide, setDragSlide] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [localCount, setLocalCount] = useState(slideCount)
  const [stripKey, setStripKey] = useState(0)
  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(new Set([selectedSlide]))
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; n: number } | null>(null)
  const [slideLabels, setSlideLabels] = useState<Record<number, string>>({})
  const [slideTags, setSlideTags] = useState<Record<number, string>>({})
  const [hiddenSlides, setHiddenSlides] = useState<Set<number>>(new Set())
  const [pinnedSlides, setPinnedSlides] = useState<Set<number>>(new Set())
  const [slideRatings, setSlideRatings] = useState<Record<number, number>>({})
  const [editingLabel, setEditingLabel] = useState<{ n: number; val: string } | null>(null)
  const [slideSections, setSlideSections] = useState<Record<number, string>>({})
  const [showSections, setShowSections] = useState(true)
  const [thumbSize, setThumbSize] = useState(140)
  const [hoverSlide, setHoverSlide] = useState<{ n: number; rect: DOMRect } | null>(null)
  const [sortMenu, setSortMenu] = useState(false)
  const [notesWordCounts, setNotesWordCounts] = useState<Record<number, number>>({})
  const lastClickRef = useRef<number | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchSlideLabels(docId)
      .then((r) => {
        setSlideLabels(Object.fromEntries(Object.entries(r.labels).map(([k, v]) => [Number(k), v])))
        setSlideTags(Object.fromEntries(Object.entries(r.tags ?? {}).map(([k, v]) => [Number(k), v])))
      })
      .catch(() => {})
    fetchHiddenSlides(docId).then((r) => setHiddenSlides(new Set(r.hidden))).catch(() => {})
    fetchSlidePins(docId).then((r) => setPinnedSlides(new Set(r.pinned))).catch(() => {})
    fetchSlideRatings(docId).then((r) => setSlideRatings(Object.fromEntries(Object.entries(r.ratings).map(([k, v]) => [Number(k), v])))).catch(() => {})
    fetchSlideSections(docId).then((r) => setSlideSections(Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [Number(k), v])))).catch(() => {})
    fetchNotesSummary(docId).then((r) => {
      if (r.word_counts) setNotesWordCounts(Object.fromEntries(Object.entries(r.word_counts).map(([k, v]) => [Number(k), v as number])))
    }).catch(() => {})
  }, [docId, stripKey])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (ctxMenu) { setCtxMenu(null); return } onClose() }
      if ((e.key === "Delete" || e.key === "Backspace") && !ctxMenu) {
        e.preventDefault()
        const toDelete = [...selectedSlides].sort((a, b) => b - a)
        if (!toDelete.length || localCount <= toDelete.length) return
        ;(async () => {
          setBusy(true)
          let count = localCount
          for (const n of toDelete) {
            try { const r = await deleteSlide(docId, n); count = r.slide_count } catch {}
          }
          const focus = Math.min(Math.min(...selectedSlides), count)
          setLocalCount(count); setStripKey((k) => k + 1)
          setSelectedSlides(new Set([focus]))
          onSlideCountChange(count, focus)
          setBusy(false)
        })()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [ctxMenu, onClose, selectedSlides, localCount, docId, onSlideCountChange])

  const run = useCallback(async (
    fn: () => Promise<{ slide_count: number; new_slide_n?: number }>,
    focusFn?: (r: { slide_count: number; new_slide_n?: number }) => number,
  ) => {
    setBusy(true)
    try {
      const r = await fn()
      const focus = focusFn ? focusFn(r) : Math.min(selectedSlide, r.slide_count)
      setLocalCount(r.slide_count)
      setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, focus)
    } catch (e) {
      console.error("sorter action failed:", e)
    } finally {
      setBusy(false)
    }
  }, [selectedSlide, onSlideCountChange])

  const handleDrop = useCallback((targetN: number) => {
    const src = dragSlide
    setDragSlide(null)
    setDropTarget(null)
    if (!src || src === targetN) return
    run(
      () => moveSlide(docId, src, targetN) as Promise<{ slide_count: number }>,
      () => targetN,
    )
  }, [dragSlide, docId, run])

  const handleSlideClick = useCallback((n: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      const anchor = lastClickRef.current ?? n
      const lo = Math.min(anchor, n)
      const hi = Math.max(anchor, n)
      setSelectedSlides(new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)))
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedSlides((prev) => {
        const next = new Set(prev)
        if (next.has(n)) next.delete(n); else next.add(n)
        return next
      })
      lastClickRef.current = n
    } else {
      lastClickRef.current = n
      setSelectedSlides(new Set([n]))
      onJump(n)
      onClose()
    }
  }, [onJump, onClose])

  const handleDuplicate = useCallback(async (n: number) => {
    setCtxMenu(null)
    setBusy(true)
    try {
      const r = await duplicateSlide(docId, n)
      setLocalCount(r.slide_count); setStripKey((k) => k + 1)
      onSlideCountChange(r.slide_count, r.new_slide_n)
    } catch (e) { console.error("dup failed:", e) }
    finally { setBusy(false) }
  }, [docId, onSlideCountChange])

  const handleDelete = useCallback(async (n: number) => {
    setCtxMenu(null)
    if (localCount <= 1) return
    setBusy(true)
    try {
      const r = await deleteSlide(docId, n)
      const focus = Math.min(n, r.slide_count)
      setLocalCount(r.slide_count); setStripKey((k) => k + 1)
      setSelectedSlides(new Set([focus]))
      onSlideCountChange(r.slide_count, focus)
    } catch (e) { console.error("delete failed:", e) }
    finally { setBusy(false) }
  }, [docId, localCount, onSlideCountChange])

  return (
    <div
      className="fixed inset-0 z-[99997] flex items-center justify-center bg-black/70"
      onClick={() => { if (ctxMenu) { setCtxMenu(null) } else { onClose() } }}
    >
      <div
        ref={modalRef}
        className="bg-surface border border-edge rounded-xl shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 900px)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <span className="text-sm font-semibold text-slate-200">
            Slide Sorter — {localCount} slides
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSelectedSlides(new Set(Array.from({ length: localCount }, (_, i) => i + 1)))}
                className="text-[10px] text-muted/60 hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
              >
                All
              </button>
              <button
                onClick={() => setSelectedSlides(new Set())}
                className="text-[10px] text-muted/60 hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
              >
                None
              </button>
              {selectedSlides.size > 0 && (
                <span className="text-[10px] text-accent-light font-mono">{selectedSlides.size} sel</span>
              )}
              <button
                onClick={() => setShowSections((v) => !v)}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${showSections ? "text-paper bg-paper/30" : "text-muted/60 hover:text-slate-300 hover:bg-white/5"}`}
              >
                §
              </button>
              <div className="relative">
                <button
                  onClick={() => setSortMenu((v) => !v)}
                  className="text-[10px] text-muted/60 hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                  title="Sort slides"
                >
                  ⇅
                </button>
                {sortMenu && (
                  <>
                    <div className="fixed inset-0 z-[99998]" onClick={() => setSortMenu(false)} />
                    <div className="absolute top-full left-0 mt-1 z-[99999] bg-surface border border-edge rounded-lg shadow-2xl py-1 w-44 text-xs">
                      {[
                        { label: "By section", key: "section" },
                        { label: "By rating (high→low)", key: "rating_desc" },
                        { label: "By rating (low→high)", key: "rating_asc" },
                        { label: "By label (A→Z)", key: "label_asc" },
                        { label: "Hidden slides last", key: "hidden_last" },
                      ].map(({ label, key }) => (
                        <button
                          key={key}
                          className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                          onClick={async () => {
                            setSortMenu(false)
                            const nums = Array.from({ length: localCount }, (_, i) => i + 1)
                            let sorted: number[]
                            if (key === "section") {
                              sorted = [...nums].sort((a, b) => (slideSections[a] ?? "").localeCompare(slideSections[b] ?? "") || a - b)
                            } else if (key === "rating_desc") {
                              sorted = [...nums].sort((a, b) => (slideRatings[b] ?? 0) - (slideRatings[a] ?? 0) || a - b)
                            } else if (key === "rating_asc") {
                              sorted = [...nums].sort((a, b) => (slideRatings[a] ?? 999) - (slideRatings[b] ?? 999) || a - b)
                            } else if (key === "label_asc") {
                              sorted = [...nums].sort((a, b) => (slideLabels[a] ?? "").localeCompare(slideLabels[b] ?? "") || a - b)
                            } else {
                              sorted = [...nums].sort((a, b) => Number(hiddenSlides.has(a)) - Number(hiddenSlides.has(b)) || a - b)
                            }
                            setBusy(true)
                            try {
                              const r = await reorderSlides(docId, sorted)
                              setStripKey((k) => k + 1)
                              onSlideCountChange(r.slide_count, selectedSlide)
                            } catch (e) { console.error("reorder failed:", e) }
                            finally { setBusy(false) }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted/40">⊞</span>
              <input
                type="range" min={80} max={220} step={20} value={thumbSize}
                onChange={(e) => setThumbSize(Number(e.target.value))}
                className="w-16 accent-indigo-400 cursor-pointer"
                title={`Thumbnail size: ${thumbSize}px`}
              />
              <span className="text-[9px] text-muted/40">⊞</span>
            </div>
            <span className="text-[10px] text-muted/50">Drag to reorder · Click to jump · Right-click for options</span>
            <button onClick={onClose} className="text-muted hover:text-slate-200 transition-colors text-lg w-6 h-6 flex items-center justify-center">✕</button>
          </div>
        </div>

        {/* grid */}
        <div className="overflow-y-auto flex-1 p-4 scrollbar-thin">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
            {Array.from({ length: localCount }, (_, i) => i + 1).map((n) => {
              const active = selectedSlides.has(n)
              const isCurrent = n === selectedSlide
              const isDragging = dragSlide === n
              const isDropTarget = dropTarget === n && dragSlide !== null && dragSlide !== n
              const sectionHere = showSections && slideSections[n]
              const prevSection = n > 1 ? slideSections[n - 1] : null
              const isNewSection = sectionHere && sectionHere !== prevSection
              return (
                <>
                {isNewSection && (
                  <div key={`sec-${stripKey}-${n}`} style={{ gridColumn: "1 / -1" }} className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-semibold text-paper uppercase tracking-widest">
                      {sectionHere}
                    </span>
                    <div className="flex-1 h-px bg-paper/40" />
                  </div>
                )}
                <div
                  key={`${stripKey}-${n}`}
                  draggable={!busy}
                  onDragStart={(e) => { setDragSlide(n); e.dataTransfer.effectAllowed = "move" }}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(n) }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(n) }}
                  onDragEnd={() => { setDragSlide(null); setDropTarget(null) }}
                  onClick={(e) => handleSlideClick(n, e)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, n }) }}
                  onMouseEnter={(e) => setHoverSlide({ n, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                  onMouseLeave={() => setHoverSlide(null)}
                  className={[
                    "flex flex-col items-center gap-1 rounded-lg p-2 cursor-pointer transition-all select-none",
                    active       ? "ring-2 ring-accent bg-accent/10" : "hover:bg-white/5",
                    isCurrent    ? "ring-2 ring-accent" : "",
                    isDragging   ? "opacity-30" : "",
                    isDropTarget ? "ring-2 ring-paper bg-paper/10 scale-105" : "",
                  ].join(" ")}
                >
                  <div className={`w-full aspect-video bg-base rounded overflow-hidden relative ${hiddenSlides.has(n) ? "opacity-40" : ""}`}>
                    <img
                      src={`/api/docs/${docId}/slides/${n}/bridge.png?v=${stripKey}`}
                      alt={`Slide ${n}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {slideTags[n] && (
                      <span
                        className="absolute top-1 right-1 w-2 h-2 rounded-full border border-white/20"
                        style={{ background: slideTags[n] }}
                      />
                    )}
                    {pinnedSlides.has(n) && (
                      <span className="absolute top-1 left-1 text-[9px]">📌</span>
                    )}
                    {hiddenSlides.has(n) && (
                      <span className="absolute bottom-1 left-1 text-[8px] text-white/50 bg-black/50 rounded px-0.5">hidden</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 w-full px-0.5" onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel({ n, val: slideLabels[n] ?? "" }) }}>
                    <span className={`text-[10px] shrink-0 font-mono ${active ? "text-accent-light font-semibold" : "text-muted/60"}`}>
                      {n}
                    </span>
                    {slideRatings[n] != null && (
                      <span className="text-[9px] text-amber-400/80 shrink-0">
                        {"★".repeat(slideRatings[n])}
                      </span>
                    )}
                    {editingLabel?.n === n ? (
                      <input
                        autoFocus
                        value={editingLabel.val}
                        onChange={(e) => setEditingLabel({ n, val: e.target.value })}
                        onBlur={async () => {
                          const label = editingLabel.val.trim()
                          setSlideLabels((prev) => ({ ...prev, [n]: label }))
                          setEditingLabel(null)
                          await setSlideLabel(docId, n, label).catch(() => {})
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                          if (e.key === "Escape") setEditingLabel(null)
                          e.stopPropagation()
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-paper bg-base border border-accent/50 rounded px-1 w-full min-w-0 outline-none"
                        placeholder="label…"
                      />
                    ) : (
                      <span className="text-[10px] text-paper/70 truncate cursor-text" title="Double-click to edit label">
                        {slideLabels[n] || <span className="text-muted/30 italic">label</span>}
                      </span>
                    )}
                  </div>
                </div>
                </>
              )
            })}
          </div>
        </div>

        <div className="px-5 py-2 border-t border-edge text-[10px] text-muted/40 text-center shrink-0 flex items-center justify-between gap-2">
          <span>Click to jump · Shift-range · Ctrl+Click toggle · Right-click for options · Del to delete · Drag to reorder</span>
          {selectedSlides.size > 1 && (
            <a
              href={exportSubsetUrl(docId, [...selectedSlides].sort((a, b) => a - b))}
              download
              className="text-[10px] text-paper hover:text-paper bg-paper/30 px-2 py-0.5 rounded border border-paper/40 hover:border-paper transition-colors whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              ↓ {selectedSlides.size} slides as PPTX
            </a>
          )}
        </div>
      </div>

      {/* hover preview */}
      {hoverSlide && !dragSlide && (
        <div
          className="fixed z-[99996] pointer-events-none"
          style={{
            left: Math.min(hoverSlide.rect.right + 8, window.innerWidth - 288),
            top: Math.max(8, hoverSlide.rect.top - 20),
          }}
        >
          <div className="bg-surface border border-edge rounded-lg shadow-2xl p-2 w-64">
            <img
              src={`/api/docs/${docId}/slides/${hoverSlide.n}/bridge.png?v=${stripKey}`}
              alt=""
              className="w-full aspect-video object-cover rounded"
            />
            <div className="mt-1.5 flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-muted/60">Slide {hoverSlide.n}</span>
                {slideRatings[hoverSlide.n] != null && (
                  <span className="text-[10px] text-amber-400">{"★".repeat(slideRatings[hoverSlide.n])}</span>
                )}
                {slideTags[hoverSlide.n] && (
                  <span className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0" style={{ background: slideTags[hoverSlide.n] }} />
                )}
                {hiddenSlides.has(hoverSlide.n) && <span className="text-[9px] text-white/40 bg-black/30 px-1 rounded">hidden</span>}
                {pinnedSlides.has(hoverSlide.n) && <span className="text-[10px]">📌</span>}
              </div>
              {slideLabels[hoverSlide.n] && (
                <span className="text-[10px] text-paper/70">{slideLabels[hoverSlide.n]}</span>
              )}
              {slideSections[hoverSlide.n] && (
                <span className="text-[9px] text-paper/60">§ {slideSections[hoverSlide.n]}</span>
              )}
              {notesWordCounts[hoverSlide.n] > 0 && (
                <span className="text-[9px] text-muted/50">
                  {notesWordCounts[hoverSlide.n]} note words · ~{Math.ceil(notesWordCounts[hoverSlide.n] / 130)}min read
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* right-click context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-[99999] bg-surface border border-edge rounded-lg shadow-2xl py-1 w-48 text-xs"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-200"
              onClick={() => { onJump(ctxMenu.n); onClose() }}
            >
              Jump to slide {ctxMenu.n}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
              onClick={() => handleDuplicate(ctxMenu.n)}
            >
              Duplicate
            </button>
            <div className="border-t border-edge my-1" />
            <div className="px-3 py-1">
              <div className="text-[9px] text-muted/50 uppercase tracking-wider mb-1.5">Tag color</div>
              <div className="flex gap-1 flex-wrap">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    title={c}
                    className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-125"
                    style={{ background: c, borderColor: slideTags[ctxMenu.n] === c ? "white" : "transparent" }}
                    onClick={async () => {
                      const newColor = slideTags[ctxMenu.n] === c ? null : c
                      setSlideTags((prev) => { const n = { ...prev }; if (newColor) n[ctxMenu.n] = newColor; else delete n[ctxMenu.n]; return n })
                      await setSlideTag(docId, ctxMenu.n, newColor).catch(() => {})
                      setCtxMenu(null)
                    }}
                  />
                ))}
                <button
                  title="Clear tag"
                  className="w-4 h-4 rounded-full border border-edge/50 flex items-center justify-center text-[8px] text-muted hover:bg-white/10 transition-colors"
                  onClick={async () => {
                    setSlideTags((prev) => { const n = { ...prev }; delete n[ctxMenu.n]; return n })
                    await setSlideTag(docId, ctxMenu.n, null).catch(() => {})
                    setCtxMenu(null)
                  }}
                >✕</button>
              </div>
            </div>
            <div className="border-t border-edge my-1" />
            {selectedSlides.size > 1 && (
              <>
                <div className="px-3 py-0.5 text-[9px] text-muted/50 uppercase tracking-wider">
                  {selectedSlides.size} selected
                </div>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                  onClick={async () => {
                    setCtxMenu(null)
                    setBusy(true)
                    try {
                      const r = await bulkDuplicateSlides(docId, [...selectedSlides])
                      setLocalCount(r.slide_count); setStripKey((k) => k + 1)
                      onSlideCountChange(r.slide_count, r.new_slide_numbers[0] ?? selectedSlide)
                    } catch (e) { console.error("bulk dup failed:", e) }
                    finally { setBusy(false) }
                  }}
                >
                  Duplicate all selected
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                  onClick={async () => {
                    const sectionName = window.prompt("Set section for all selected slides (blank to clear):", "")
                    if (sectionName === null) { setCtxMenu(null); return }
                    const trimmed = sectionName.trim()
                    await Promise.all([...selectedSlides].map((n) => setSlideSection(docId, n, trimmed || null).catch(() => {})))
                    setCtxMenu(null)
                  }}
                >
                  Set section for all…
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                  onClick={async () => {
                    const anyVisible = [...selectedSlides].some((n) => !hiddenSlides.has(n))
                    setHiddenSlides((prev) => {
                      const next = new Set(prev)
                      for (const n of selectedSlides) {
                        if (anyVisible) next.add(n); else next.delete(n)
                      }
                      return next
                    })
                    await Promise.all([...selectedSlides].map((n) => setSlideHidden(docId, n, anyVisible).catch(() => {})))
                    setCtxMenu(null)
                  }}
                >
                  {[...selectedSlides].some((n) => !hiddenSlides.has(n)) ? "Hide all selected" : "Show all selected"}
                </button>
                <div className="px-3 py-1">
                  <div className="text-[9px] text-muted/50 uppercase tracking-wider mb-1.5">Tag all selected</div>
                  <div className="flex gap-1 flex-wrap">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        title={c}
                        className="w-4 h-4 rounded-full border border-white/20 transition-transform hover:scale-125"
                        style={{ background: c }}
                        onClick={async () => {
                          setSlideTags((prev) => {
                            const next = { ...prev }
                            for (const n of selectedSlides) next[n] = c
                            return next
                          })
                          await Promise.all([...selectedSlides].map((n) => setSlideTag(docId, n, c).catch(() => {})))
                          setCtxMenu(null)
                        }}
                      />
                    ))}
                    <button
                      title="Clear tags"
                      className="w-4 h-4 rounded-full border border-edge/50 flex items-center justify-center text-[8px] text-muted hover:bg-white/10 transition-colors"
                      onClick={async () => {
                        setSlideTags((prev) => {
                          const next = { ...prev }
                          for (const n of selectedSlides) delete next[n]
                          return next
                        })
                        await Promise.all([...selectedSlides].map((n) => setSlideTag(docId, n, null).catch(() => {})))
                        setCtxMenu(null)
                      }}
                    >✕</button>
                  </div>
                </div>
                <div className="border-t border-edge my-1" />
              </>
            )}
            {selectedSlides.size > 1 ? (
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 text-bad"
                onClick={async () => {
                  setCtxMenu(null)
                  if (localCount <= selectedSlides.size) return
                  setBusy(true)
                  try {
                    const r = await bulkDeleteSlides(docId, [...selectedSlides])
                    const focus = Math.min(Math.min(...selectedSlides), r.slide_count)
                    setLocalCount(r.slide_count); setStripKey((k) => k + 1)
                    setSelectedSlides(new Set([focus]))
                    onSlideCountChange(r.slide_count, focus)
                  } catch (e) { console.error("bulk delete failed:", e) }
                  finally { setBusy(false) }
                }}
              >
                Delete {selectedSlides.size} slides
              </button>
            ) : (
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 text-bad"
                onClick={() => handleDelete(ctxMenu.n)}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
