import { useState, useEffect, useRef, useCallback } from "react"
import type { DocInfo } from "../../lib/types"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchSlideElements, updateElementPosition, renderSingleSlide, deleteElement, duplicateElement, undoDoc, redoDoc, createNewElement, copyElementToSlide } from "../../lib/studioApi"
import * as api from "../../lib/api"
import StudioSlideStrip from "./StudioSlideStrip"
import StudioCanvas from "./StudioCanvas"
import StudioPropertiesPanel from "./StudioPropertiesPanel"
import StudioToolbar from "./StudioToolbar"
import StudioChat from "./StudioChat"
import FindReplacePanel from "./FindReplacePanel"

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
  const selectedSlideRef = useRef(1)
  selectedSlideRef.current = selectedSlide
  const clipboardRef = useRef<{ slideN: number; elementId: string } | null>(null)

  // keep a ref so the arrow-key handler always sees the latest element
  const selectedElementRef = useRef<StudioElement | null>(null)
  selectedElementRef.current = selectedElement

  // fetch slide dimensions when slide changes
  useEffect(() => {
    fetchSlideElements(doc.doc_id, selectedSlide)
      .then((res) => {
        setSlideWidthIn(res.slide_width_in)
        setSlideHeightIn(res.slide_height_in)
      })
      .catch(() => {})
  }, [doc.doc_id, selectedSlide])

  // ── re-render current slide PNG then bump refreshKey ─────────────────────
  const rerender = useCallback(async () => {
    const n = selectedSlideRef.current
    try { await renderSingleSlide(doc.doc_id, n) } catch { /* non-fatal */ }
    setRefreshKey((k) => k + 1)
  }, [doc.doc_id])

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
      await rerender()
    } catch (e) {
      console.error("z-index commit failed:", e)
    }
  }, [doc.doc_id, rerender])

  // ── delete selected element ────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      await deleteElement(doc.doc_id, selectedSlideRef.current, el.id)
      setSelectedElement(null)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("delete failed:", e)
    }
  }, [doc.doc_id])

  // ── duplicate selected element ─────────────────────────────────────────────
  const handleDuplicate = useCallback(async () => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const dup = await duplicateElement(doc.doc_id, selectedSlideRef.current, el.id)
      setSelectedElement(dup)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("duplicate failed:", e)
    }
  }, [doc.doc_id])

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

      // Ctrl+Z → undo, Ctrl+Y or Ctrl+Shift+Z → redo
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        undoDoc(doc.doc_id).then(() => {
          setSelectedElement(null)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }
      if (((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) ||
          ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault()
        redoDoc(doc.doc_id).then(() => {
          setSelectedElement(null)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }

      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      const el = selectedElementRef.current
      if (!el) return
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
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("insert failed:", e)
    }
  }, [doc.doc_id])

  const handleSlideCountChange = useCallback((newCount: number, focusSlide: number) => {
    setLocalSlideCount(newCount)
    setSelectedSlide(focusSlide)
    setSelectedElement(null)
    setRefreshKey((k) => k + 1)
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
        onRebuild={onRebuild}
        rebuilding={rebuilding}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
        findReplaceOpen={findReplaceOpen}
        onToggleFindReplace={() => setFindReplaceOpen((o) => !o)}
        onSaveToCloud={doc.cloud_bundle_uri ? handleSaveToCloud : undefined}
        savingToCloud={savingToCloud}
      />

      {/* ── main area: slide strip + canvas + properties ── */}
      <div className="flex flex-1 min-h-0 min-w-0 relative">
        <StudioSlideStrip
          docId={doc.doc_id}
          slideCount={localSlideCount}
          selectedSlide={selectedSlide}
          onSelect={handleSlideSelect}
          onSlideCountChange={handleSlideCountChange}
        />

        <StudioCanvas
          docId={doc.doc_id}
          slideN={selectedSlide}
          slideWidthIn={slideWidthIn}
          slideHeightIn={slideHeightIn}
          refreshKey={refreshKey}
          onSelectElement={setSelectedElement}
        />

        <StudioPropertiesPanel
          element={selectedElement}
          slideN={selectedSlide}
          slideWidthIn={slideWidthIn}
          slideHeightIn={slideHeightIn}
          docId={doc.doc_id}
          onTextCommit={rerender}
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
    </div>
  )
}
