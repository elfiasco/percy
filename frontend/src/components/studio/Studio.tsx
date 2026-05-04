import { useState, useEffect, useRef, useCallback } from "react"
import type { DocInfo } from "../../lib/types"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchSlideElements, updateElementPosition, renderSingleSlide, deleteElement, duplicateElement, undoDoc, redoDoc, createNewElement, copyElementToSlide, createImageElement, fetchUndoState } from "../../lib/studioApi"
import * as api from "../../lib/api"
import StudioSlideStrip from "./StudioSlideStrip"
import StudioCanvas from "./StudioCanvas"
import StudioPropertiesPanel from "./StudioPropertiesPanel"
import StudioToolbar from "./StudioToolbar"
import StudioChat from "./StudioChat"
import StudioNotesBar from "./StudioNotesBar"
import CommandPalette from "./CommandPalette"
import FindReplacePanel from "./FindReplacePanel"
import KeyboardShortcutsModal from "./KeyboardShortcutsModal"

interface Props {
  doc: DocInfo
  onRebuild: () => void
  rebuilding: boolean
}

export default function Studio({ doc, onRebuild, rebuilding }: Props) {
  const [selectedSlide, setSelectedSlide]     = useState(1)
  const [selectedElement, setSelectedElement] = useState<StudioElement | null>(null)
  const [slideWidthIn, setSlideWidthIn]       = useState(13.333)
  const [slideHeightIn, setSlideHeightIn]     = useState(7.5)
  const [refreshKey, setRefreshKey]           = useState(0)
  const [chatOpen, setChatOpen]               = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [localSlideCount, setLocalSlideCount] = useState(doc.slide_count)
  const [savingToCloud, setSavingToCloud]     = useState(false)
  const [shortcutsOpen, setShortcutsOpen]       = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [dirtySlides, setDirtySlides]         = useState<Set<number>>(new Set())
  const [multiSelectIds, setMultiSelectIds]   = useState<Set<string>>(new Set())
  const [undoDepth, setUndoDepth]             = useState(0)
  const [redoDepth, setRedoDepth]             = useState(0)
  const [slideElements, setSlideElements]     = useState<StudioElement[]>([])
  const selectedSlideRef = useRef(1)
  selectedSlideRef.current = selectedSlide
  const clipboardRef = useRef<{ slideN: number; elementId: string } | null>(null)

  // keep a ref so the arrow-key handler always sees the latest element
  const selectedElementRef = useRef<StudioElement | null>(null)
  selectedElementRef.current = selectedElement

  // fetch initial undo/redo state on mount
  useEffect(() => {
    fetchUndoState(doc.doc_id)
      .then((r) => { setUndoDepth(r.undo_depth); setRedoDepth(r.redo_depth) })
      .catch(() => {})
  }, [doc.doc_id])

  // fetch slide dimensions + element list when slide changes or refreshKey bumps
  useEffect(() => {
    fetchSlideElements(doc.doc_id, selectedSlide)
      .then((res) => {
        setSlideWidthIn(res.slide_width_in)
        setSlideHeightIn(res.slide_height_in)
        setSlideElements(res.elements)
      })
      .catch(() => {})
  }, [doc.doc_id, selectedSlide, refreshKey])

  const markDirty = useCallback((n: number) => {
    setDirtySlides((prev) => { const next = new Set(prev); next.add(n); return next })
  }, [])

  // ── re-render current slide PNG then bump refreshKey ─────────────────────
  const rerender = useCallback(async () => {
    const n = selectedSlideRef.current
    markDirty(n)
    try { await renderSingleSlide(doc.doc_id, n) } catch { /* non-fatal */ }
    setRefreshKey((k) => k + 1)
  }, [doc.doc_id, markDirty])

  // ── commit a position/size change from toolbar or arrow keys ──────────────
  const handleCommitPosition = useCallback(async (
    leftIn: number, topIn: number, widthIn: number, heightIn: number,
  ) => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const updated = await updateElementPosition(doc.doc_id, selectedSlideRef.current, el.id, {
        left_in: leftIn, top_in: topIn, width_in: widthIn, height_in: heightIn,
      })
      setSelectedElement(updated)
      markDirty(selectedSlideRef.current)
      await rerender()
    } catch (e) {
      console.error("position commit failed:", e)
    }
  }, [doc.doc_id, rerender])

  // ── commit a z-index change from arrange buttons ───────────────────────────
  const handleCommitZIndex = useCallback(async (zIndex: number) => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const updated = await updateElementPosition(doc.doc_id, selectedSlideRef.current, el.id, { z_index: zIndex })
      setSelectedElement(updated)
      markDirty(selectedSlideRef.current)
      await rerender()
    } catch (e) {
      console.error("z-index commit failed:", e)
    }
  }, [doc.doc_id, rerender])

  const multiSelectIdsRef = useRef<Set<string>>(new Set())
  multiSelectIdsRef.current = multiSelectIds

  // ── delete selected element(s) ────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const ids = multiSelectIdsRef.current
    const el  = selectedElementRef.current
    const toDelete = ids.size > 0 ? [...ids] : el ? [el.id] : []
    if (!toDelete.length) return
    try {
      for (const id of toDelete) {
        await deleteElement(doc.doc_id, selectedSlideRef.current, id)
      }
      setSelectedElement(null)
      setMultiSelectIds(new Set())
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("delete failed:", e)
    }
  }, [doc.doc_id, markDirty])

  // ── duplicate selected element(s) ─────────────────────────────────────────
  const handleDuplicate = useCallback(async () => {
    const ids = multiSelectIdsRef.current
    const el  = selectedElementRef.current
    const toDup = ids.size > 0 ? [...ids] : el ? [el.id] : []
    if (!toDup.length) return
    try {
      let lastDup: StudioElement | null = null
      for (const id of toDup) {
        lastDup = await duplicateElement(doc.doc_id, selectedSlideRef.current, id)
      }
      if (lastDup) setSelectedElement(lastDup)
      setMultiSelectIds(new Set())
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("duplicate failed:", e)
    }
  }, [doc.doc_id, markDirty])

  // ── arrow key nudge + Delete/Duplicate keyboard shortcuts ─────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return

      // Delete / Backspace → remove element
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementRef.current) { e.preventDefault(); handleDelete() }
        return
      }

      // Ctrl+C → copy element to clipboard
      if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
        const el = selectedElementRef.current
        if (el) {
          e.preventDefault()
          clipboardRef.current = { slideN: selectedSlideRef.current, elementId: el.id }
        }
        return
      }

      // Ctrl+V → paste element from clipboard onto current slide
      if ((e.key === "v" || e.key === "V") && (e.ctrlKey || e.metaKey)) {
        const clip = clipboardRef.current
        if (clip) {
          e.preventDefault()
          copyElementToSlide(doc.doc_id, clip.slideN, clip.elementId, selectedSlideRef.current)
            .then((el) => {
              markDirty(selectedSlideRef.current)
              setRefreshKey((k) => k + 1)
              setSelectedElement(el)
            })
            .catch((err) => console.error("paste failed:", err))
        }
        return
      }

      // Ctrl+D → duplicate
      if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) {
        if (selectedElementRef.current) { e.preventDefault(); handleDuplicate() }
        return
      }

      // Ctrl+S → rebuild
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onRebuild()
        return
      }

      // Ctrl+H or Ctrl+F → find & replace
      if ((e.key === "h" || e.key === "H" || e.key === "f" || e.key === "F") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setFindReplaceOpen((o) => !o)
        return
      }

      // ? → keyboard shortcuts help
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
        return
      }

      // Ctrl+K → command palette (jump to element)
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setCommandPaletteOpen((o) => !o)
        return
      }

      // Ctrl+Z → undo, Ctrl+Y or Ctrl+Shift+Z → redo
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        undoDoc(doc.doc_id).then((r) => {
          setSelectedElement(null)
          setUndoDepth(r.undo_depth)
          setRedoDepth(r.redo_depth)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }
      if (((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) ||
          ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault()
        redoDoc(doc.doc_id).then((r) => {
          setSelectedElement(null)
          setUndoDepth(r.undo_depth)
          setRedoDepth(r.redo_depth)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }

      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      const el = selectedElementRef.current
      if (!el || el.locked) return
      e.preventDefault()
      const step = e.shiftKey ? 1.0 : 0.1
      const dl = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
      const dt = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0
      handleCommitPosition(
        Math.max(0, el.left_in + dl),
        Math.max(0, el.top_in  + dt),
        el.width_in,
        el.height_in,
      )
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleCommitPosition, handleDelete, handleDuplicate])

  const handleSlideSelect = useCallback((n: number) => {
    setSelectedSlide(n)
    setSelectedElement(null)
    setMultiSelectIds(new Set())
  }, [])

  const handleInsertShape = useCallback(async (shapeType: string) => {
    try {
      const el = await createNewElement(doc.doc_id, selectedSlideRef.current, {
        shape_type: shapeType,
        left_in: 1.0, top_in: 1.0, width_in: 3.0, height_in: 2.0,
        fill_color: "#4472C4",
        label: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      })
      setSelectedElement(el)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("insert failed:", e)
    }
  }, [doc.doc_id, markDirty])

  const handleInsertImage = useCallback(async (file: File) => {
    try {
      const el = await createImageElement(doc.doc_id, selectedSlideRef.current, file)
      setSelectedElement(el)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("insert image failed:", e)
    }
  }, [doc.doc_id, markDirty])

  const handleSlideCountChange = useCallback((newCount: number, focusSlide: number) => {
    setLocalSlideCount(newCount)
    setSelectedSlide(focusSlide)
    setSelectedElement(null)
    setRefreshKey((k) => k + 1)
  }, [])

  const handleJumpToElement = useCallback((slideN: number, _elementId: string) => {
    setSelectedSlide(slideN)
    setSelectedElement(null)
    setMultiSelectIds(new Set())
  }, [])

  const handleSaveToCloud = useCallback(async () => {
    setSavingToCloud(true)
    try {
      const res = await api.saveToCloud(doc.doc_id)
      if (res.version_archived) {
        console.info("Previous bundle archived at:", res.version_archived)
      }
    } catch (e) {
      console.error("Save to cloud failed:", e)
    } finally {
      setSavingToCloud(false)
    }
  }, [doc.doc_id])

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* ── toolbar ──────────────────────────────────────── */}
      <StudioToolbar
        doc={{ ...doc, slide_count: localSlideCount }}
        slideN={selectedSlide}
        slideWidthIn={slideWidthIn}
        slideHeightIn={slideHeightIn}
        selectedElement={selectedElement}
        onCommitPosition={handleCommitPosition}
        onCommitZIndex={handleCommitZIndex}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onInsertShape={handleInsertShape}
        onInsertImage={handleInsertImage}
        onRebuild={() => { setDirtySlides(new Set()); onRebuild() }}
        rebuilding={rebuilding}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
        findReplaceOpen={findReplaceOpen}
        onToggleFindReplace={() => setFindReplaceOpen((o) => !o)}
        onSaveToCloud={doc.cloud_bundle_uri ? handleSaveToCloud : undefined}
        savingToCloud={savingToCloud}
        undoDepth={undoDepth}
        redoDepth={redoDepth}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      {/* ── main area: slide strip + canvas + properties ── */}
      <div className="flex flex-1 min-h-0 min-w-0 relative">
        <StudioSlideStrip
          docId={doc.doc_id}
          slideCount={localSlideCount}
          selectedSlide={selectedSlide}
          dirtySlides={dirtySlides}
          refreshKey={refreshKey}
          onSelect={handleSlideSelect}
          onSlideCountChange={handleSlideCountChange}
        />

        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <StudioCanvas
            docId={doc.doc_id}
            slideN={selectedSlide}
            slideWidthIn={slideWidthIn}
            slideHeightIn={slideHeightIn}
            refreshKey={refreshKey}
            onSelectElement={setSelectedElement}
            onMultiSelect={setMultiSelectIds}
          />
          <StudioNotesBar docId={doc.doc_id} slideN={selectedSlide} />
        </div>

        <StudioPropertiesPanel
          element={selectedElement}
          elements={slideElements}
          slideN={selectedSlide}
          slideWidthIn={slideWidthIn}
          slideHeightIn={slideHeightIn}
          docId={doc.doc_id}
          onTextCommit={rerender}
          onSelectElement={setSelectedElement}
        />

        {chatOpen && (
          <StudioChat
            docId={doc.doc_id}
            slideN={selectedSlide}
            selectedElement={selectedElement}
            onClose={() => setChatOpen(false)}
            onRefresh={() => setRefreshKey((k) => k + 1)}
          />
        )}

        {findReplaceOpen && (
          <FindReplacePanel
            docId={doc.doc_id}
            onClose={() => setFindReplaceOpen(false)}
            onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
            onReplaced={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>

      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          docId={doc.doc_id}
          onClose={() => setCommandPaletteOpen(false)}
          onJump={handleJumpToElement}
        />
      )}
    </div>
  )
}
