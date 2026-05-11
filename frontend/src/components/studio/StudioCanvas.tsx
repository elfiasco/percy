import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { createImageElement, elementPngUrl, broadcastElement, rewriteElementText, generateTalkingPoints } from "../../lib/studioApi"
import type { FreeformPathCmd } from "../../lib/studioApi"
import { CanvasContext } from "./CanvasContext"
import ElementOverlay from "./ElementOverlay"
import InlineTextEditor from "./InlineTextEditor"
import AnnotationOverlay from "./AnnotationOverlay"
import PlacementOverlay from "./PlacementOverlay"
import FreeformDrawOverlay from "./FreeformDrawOverlay"
import { getCollabContext } from "../../lib/collab/collabContext"
import { hydrateSlide, observeElement, observeSlideElements, updateElementFields } from "../../lib/collab/bridgeYjsAdapter"
import type { YjsRoom } from "../../lib/collab/yjsRoom"
import * as Y from "yjs"
import { setLocalSelection, setLocalPointer } from "../../lib/collab/awareness"
import RemotePresenceLayer from "./RemotePresenceLayer"
import LiveCursorLayer from "./LiveCursorLayer"
import { commitElementGeometry } from "../../lib/studio/commands"
import { studioStore, useStudioStore } from "../../lib/studio/store"

interface Props {
  docId: string
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
  refreshKey?: number
  onSelectElement: (el: StudioElement | null) => void
  onMultiSelect?: (ids: Set<string>) => void
  onElementRotated?: (el: StudioElement) => void
  onDeleteElement?: (id: string) => void
  onDuplicateElement?: (id: string) => void
  onToggleLockElement?: (id: string, locked: boolean) => void
  onToggleHiddenElement?: (id: string, hidden: boolean) => void
  onZIndexChange?: (id: string) => void
  onGroupElements?: () => void
  onUngroupElement?: (id: string) => void
  focusMode?: boolean
  onToggleFocusMode?: () => void
  onSlideContextMenu?: (x: number, y: number) => void
  onBroadcastElement?: (pushedTo: number) => void
  onSplitElement?: (elementId: string) => void
  onEditConnect?: (elementId: string) => void
  connectIds?: Set<string>
  colorBlindMode?: string | null
  onAltDuplicate?: (id: string, leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  // Placement mode
  placingShapeType?: string | null
  onPlaceShape?: (leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  onCancelPlace?: () => void
  // Freeform draw mode
  drawMode?: "pen" | "polygon" | null
  onFinishFreeform?: (commands: FreeformPathCmd[]) => void
  onCancelDraw?: () => void
}

export default function StudioCanvas({ docId, slideN, slideWidthIn, slideHeightIn, refreshKey, onSelectElement, onMultiSelect, onElementRotated, onDeleteElement, onDuplicateElement, onToggleLockElement, onToggleHiddenElement, onZIndexChange, onGroupElements, onUngroupElement, focusMode, onToggleFocusMode, onSlideContextMenu, onBroadcastElement, onSplitElement, onEditConnect, connectIds, colorBlindMode, onAltDuplicate, placingShapeType, onPlaceShape, onCancelPlace, drawMode, onFinishFreeform, onCancelDraw }: Props) {
  const containerRef               = useRef<HTMLDivElement>(null)
  const studio                      = useStudioStore()
  const elements                    = studio.elements
  const bgColor                     = studio.backgroundColor
  const selectedIds                 = useMemo(() => new Set(studio.selectedIds), [studio.selectedIds])
  const loading                     = studio.loading
  const error                       = studio.error
  const renderKeys                  = studio.renderKeys
  const elementsRef                 = useRef<StudioElement[]>([])
  const selectedIdsRef              = useRef<Set<string>>(new Set())
  const [zoom, setZoom]             = useState(1.0)
  const [rubberBand, setRubberBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const rbStart                     = useRef<{ x: number; y: number } | null>(null)
  const [gridOn, setGridOn]         = useState(false)
  const [snapOn, setSnapOn]         = useState(false)
  const [rulerOn, setRulerOn]       = useState(false)
  const [snapGuides, setSnapGuides]     = useState<{ type: "h" | "v"; pos: number }[]>([])
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu]           = useState<{ id: string; x: number; y: number } | null>(null)
  const [rewriteInput, setRewriteInput] = useState<{ id: string; instruction: string; busy: boolean } | null>(null)
  const [talkingPoints, setTalkingPoints] = useState<{ id: string; points: string[]; loading: boolean } | null>(null)
  const [dragOver, setDragOver]         = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [dragInfo, setDragInfo]         = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [annotating, setAnnotating]     = useState(false)
  const GRID_IN                     = 0.25

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest("[data-gs-ctx-menu]")) setCtxMenu(null)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [ctxMenu])

  // Keep refs in sync for hot keyboard/drag handlers.
  useEffect(() => { elementsRef.current = elements }, [elements])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])

  // ── Phase B: subscribe to Y.Doc for live element updates ─────────────────
  // The collab context is a module-singleton set by Studio.tsx via
  // useStudioCollab. We pull it on every render but treat null as "collab
  // off" — in that case we fall back to the API-driven path entirely.
  const collab = getCollabContext()
  const room: YjsRoom | null = collab?.enabled ? collab.room : null

  // ── fetch elements when slide changes or parent refreshes ─────────────────
  useEffect(() => {
    let cancelled = false
    studioStore.loadSlide(docId, slideN)
      .then((res) => {
        if (!cancelled) {
          // Read collab context at resolve time, not at effect-schedule time.
          // The effect captures docId/slideN but NOT room — room may have been
          // stale (pointing at the previous slide's Y.Doc) when the effect was
          // scheduled because useStudioCollab sets the new room asynchronously.
          const currentCollab = getCollabContext()
          const currentRoom = currentCollab?.enabled ? currentCollab.room : null
          if (currentRoom) {
            try { hydrateSlide(currentRoom, res.elements, res.background_color) }
            catch (e) { console.warn("[Percy] Y.Doc hydrate failed:", e) }
          }
          studioStore.bumpRenderKeys(res.elements.map((el) => el.id))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [docId, slideN, refreshKey])

  // ── Y.Doc live subscription: when any element's scalar fields change in
  //    the Y.Doc (local edit OR remote peer), re-render that element. The
  //    initial setElements above is what makes the elements list visible;
  //    after that, Y.Doc is the live source of truth for transforms.
  useEffect(() => {
    if (!room) return
    const unsubs: Array<() => void> = []
    // Top-level: when the elements MAP itself changes (add/remove), refresh
    // the per-element observers list.
    const capturedRoom = room
    const wireElement = (id: string) => {
      const off = observeElement(room, id, (snap) => {
        // Guard: reject updates from a room that is no longer the active room.
        // React effect cleanup runs asynchronously, so the old room's observers
        // can fire during the gap between room context update and cleanup —
        // causing cross-slide contamination when two slides share an element ID.
        if (getCollabContext()?.room !== capturedRoom) return
        studioStore.updateElement(id, snap)
      })
      unsubs.push(off)
      // Phase C — watch revision counters; when a peer bumps style/text/
      // render_rev we bump renderKey so the renderer re-fetches via API.
      const elementsMap = room.doc.getMap("elements") as unknown as { get: (k: string) => Y.Map<unknown> | undefined }
      const elMap = elementsMap.get(id)
      if (elMap) {
        const onRev = (ev: Y.YMapEvent<unknown>) => {
          let bump = false
          ev.changes.keys.forEach((_, key) => {
            if (key === "style_rev" || key === "text_rev" || key === "render_rev") bump = true
          })
          if (bump) studioStore.bumpRenderKeys([id])
        }
        elMap.observe(onRev)
        unsubs.push(() => elMap.unobserve(onRev))
      }
    }
    const offTop = observeSlideElements(room, (ids) => {
      // (Re)wire per-element observers each time the set changes.
      while (unsubs.length > 1) { const u = unsubs.pop(); u?.() }
      for (const id of ids) wireElement(id)
    })
    unsubs.push(offTop)
    return () => { for (const u of unsubs) u() }
  }, [room, slideWidthIn, slideHeightIn])

  // ── keyboard: Escape deselects, G=grid, S=snap ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tgt.tagName)) return
      // contenteditable (Tiptap, ProseMirror) — let the editor handle the key
      if (tgt.isContentEditable || tgt.closest('[contenteditable="true"]')) return
      if (e.key === "Escape") { studioStore.clearSelection(); onSelectElement(null); onMultiSelect?.(new Set()) }
      // Enter → enter text edit mode for selected text/shape element (Google Slides behavior)
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const sel = selectedIdsRef.current
        if (sel.size === 1) {
          const id = [...sel][0]
          const el = elementsRef.current.find((e) => e.id === id)
          if (el && (el.type === "BridgeText" || el.type === "BridgeShape")) {
            e.preventDefault()
            // BridgeText/Shape use native Tiptap editors — simulate a click on the element
            const overlay = document.querySelector(`[data-element="true"][style*="${id}"]`) as HTMLElement | null
            if (overlay) overlay.click()
          }
        }
      }
      if (e.key === "g" || e.key === "G") { if (!e.ctrlKey && !e.metaKey) setGridOn((v) => !v) }
      if (e.key === "s" || e.key === "S") { if (!e.ctrlKey && !e.metaKey) setSnapOn((v) => !v) }
      if (e.key === "r" || e.key === "R") { if (!e.ctrlKey && !e.metaKey) setRulerOn((v) => !v) }
      // Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0 reset
      if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom((z) => Math.min(4, z + 0.25))
      }
      if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom((z) => Math.max(0.25, z - 0.25))
      }
      if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom(1)
      }
      // Ctrl+A — select all
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const all = new Set(elementsRef.current.map((el) => el.id))
        onSelectElement(null)
        onMultiSelect?.(all)
        studioStore.setSelectedIds(all)
      }
      // Ctrl+[ / Ctrl+] send backward / bring forward
      // Ctrl+Shift+[ / Ctrl+Shift+] send to back / bring to front
      if ((e.key === "[" || e.key === "]") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const elsList = elementsRef.current
        const sorted = [...elsList].sort((a, b) => a.z_index - b.z_index)
        const selId = selectedIdsRef.current.size === 1 ? [...selectedIdsRef.current][0] : null
        const el = selId ? elsList.find((e) => e.id === selId) : null
        if (el) {
          const idx = sorted.findIndex((e) => e.id === el.id)
          const maxZ = Math.max(...sorted.map((e) => e.z_index))
          const minZ = Math.min(...sorted.map((e) => e.z_index))
          let newZ: number | null = null
          if (e.key === "]") {
            newZ = e.shiftKey ? maxZ + 1 : (sorted[idx + 1]?.z_index ?? maxZ) + 0.5
          } else {
            newZ = e.shiftKey ? minZ - 1 : (sorted[idx - 1]?.z_index ?? minZ) - 0.5
          }
          if (newZ !== null && newZ !== el.z_index) {
            if (room) {
              try { updateElementFields(room, el.id, { z_index: newZ }) }
              catch { /* no-op */ }
            }
            commitElementGeometry(el.id, { z_index: newZ })
              .then((updated) => {
                if (updated) onSelectElement(updated)
                onZIndexChange?.(el.id)
              })
              .catch(() => {})
          }
        }
      }
      // Tab / Shift+Tab — cycle through elements
      if (e.key === "Tab") {
        e.preventDefault()
        const sorted = [...elementsRef.current].sort((a, b) => a.z_index - b.z_index)
        if (!sorted.length) return
        const prev = selectedIdsRef.current
        const prevId = prev.size === 1 ? [...prev][0] : null
        const idx = prevId ? sorted.findIndex((el) => el.id === prevId) : -1
        const next = e.shiftKey
          ? sorted[(idx - 1 + sorted.length) % sorted.length]
          : sorted[(idx + 1) % sorted.length]
        const nextSet = new Set([next.id])
        studioStore.setSelectedIds(nextSet)
        onSelectElement(next)
        onMultiSelect?.(nextSet)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onSelectElement])

  const handleSelect = useCallback((id: string, shiftKey = false) => {
    const prev = selectedIdsRef.current
    const next = shiftKey ? new Set(prev) : new Set<string>()
    if (shiftKey && prev.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    studioStore.setSelectedIds(next)
    if (next.size === 1) {
      const el = elementsRef.current.find((e) => e.id === [...next][0]) ?? null
      onSelectElement(el)
      if (room && el) {
        try { setLocalSelection(room, { elementId: el.id, elementName: el.name }) }
        catch { /* no-op */ }
      }
    } else {
      onSelectElement(null)
      if (room) { try { setLocalSelection(room, null) } catch { /* no-op */ } }
    }
    onMultiSelect?.(next)
  }, [onSelectElement, onMultiSelect, room])

  const handleDeselect = useCallback(() => {
    studioStore.clearSelection()
    onSelectElement(null)
    onMultiSelect?.(new Set())
    if (room) { try { setLocalSelection(room, null) } catch { /* no-op */ } }
  }, [onSelectElement, onMultiSelect, room])

  const snap = useCallback((v: number) => snapOn ? Math.round(v / GRID_IN) * GRID_IN : v, [snapOn, GRID_IN])

  const handleCommit = useCallback(async (
    id: string,
    leftIn: number, topIn: number, widthIn: number, heightIn: number,
  ) => {
    const fields = {
      left_in:   snap(leftIn),
      top_in:    snap(topIn),
      width_in:  snap(widthIn),
      height_in: snap(heightIn),
    }
    // Phase B: write Y.Doc FIRST so UI + remote peers update instantly.
    if (room) {
      try { updateElementFields(room, id, fields) }
      catch (e) { console.warn("[Percy] Y.Doc position write failed:", e) }
    }
    // Persistence still goes through the API for now — server collab worker
    // will take this over in Phase D. Treat the API response as a no-op
    // (Y.Doc subscription already updated React state).
    try {
      const updated = await commitElementGeometry(id, fields)
      if (updated && selectedIdsRef.current.size <= 1) onSelectElement(updated)
      studioStore.bumpRenderKeys([id])
    } catch (e) {
      console.error("element update (persistence) failed:", e)
    }
  }, [room, docId, slideN, onSelectElement, snap, selectedIds])

  const handleMultiMove = useCallback(async (deltaLeftIn: number, deltaTopIn: number) => {
    const ids = [...selectedIdsRef.current]
    const currentElements = elementsRef.current
    // Phase B: batch the Y.Doc writes in one transaction so peers see one
    // event for the whole multi-move, not N.
    if (room) {
      try {
        room.doc.transact(() => {
          for (const id of ids) {
            const el = currentElements.find((e) => e.id === id)
            if (!el) continue
            updateElementFields(room, id, {
              left_in: snap(el.left_in + deltaLeftIn),
              top_in:  snap(el.top_in  + deltaTopIn),
            })
          }
        })
      } catch (e) { console.warn("[Percy] multi-move Y.Doc write failed:", e) }
    }
    try {
      const updates = await Promise.all(
        ids.map((id) => {
          const el = currentElements.find((e) => e.id === id)
          if (!el) return Promise.resolve(null)
          return commitElementGeometry(id, {
            left_in: snap(el.left_in + deltaLeftIn),
            top_in:  snap(el.top_in  + deltaTopIn),
          })
        })
      )
      const valid = updates.filter((u): u is NonNullable<typeof u> => u !== null)
      studioStore.bumpRenderKeys(valid.map((u) => u.id))
    } catch (e) {
      console.error("multi-move (persistence) failed:", e)
    }
  }, [room, docId, slideN, selectedIds, snap])

  const handleRotate = useCallback(async (id: string, rotation: number) => {
    // Write to Y.Doc first so peers see the rotation immediately.
    if (room) {
      try { updateElementFields(room, id, { rotation }) }
      catch (e) { console.warn("[Percy] Y.Doc rotation write failed:", e) }
    }
    try {
      const updated = await commitElementGeometry(id, { rotation })
      if (!updated) return
      onSelectElement(updated)
      onElementRotated?.(updated)
      studioStore.bumpRenderKeys([id])
    } catch (e) {
      console.error("rotation update failed:", e)
    }
  }, [room, docId, slideN, onSelectElement, onElementRotated])

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Only start a rubber-band selection when the pointerdown actually
    // originated on the empty canvas — not on an element overlay or any
    // descendant. Otherwise calling setPointerCapture here steals the click
    // away from the element (pointerup + click get redirected to the canvas
    // div), so left-clicks on text boxes silently do nothing while right-
    // clicks work. The element overlay walks up to the canvas via
    // closest('[data-element]') so we look for that.
    const target = e.target as HTMLElement
    if (target && target.closest('[data-element="true"]')) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top)  / rect.height) * 100
    rbStart.current = { x, y }
    setRubberBand(null)
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    e.stopPropagation()
  }, [])

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rbStart.current) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * 100
    const cy = ((e.clientY - rect.top)  / rect.height) * 100
    const { x, y } = rbStart.current
    setRubberBand({
      x: Math.min(x, cx), y: Math.min(y, cy),
      w: Math.abs(cx - x), h: Math.abs(cy - y),
    })
  }, [])

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = rbStart.current
    if (!start) return
    rbStart.current = null

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * 100
    const cy = ((e.clientY - rect.top)  / rect.height) * 100

    const rx = Math.min(start.x, cx)
    const ry = Math.min(start.y, cy)
    const rw = Math.abs(cx - start.x)
    const rh = Math.abs(cy - start.y)

    setRubberBand(null)

    if (rw < 0.5 && rh < 0.5) {
      handleDeselect()
      return
    }

    const inside = elementsRef.current.filter((el) => {
      const el_r = el.left_pct + el.width_pct
      const el_b = el.top_pct  + el.height_pct
      return el.left_pct < rx + rw && el_r > rx && el.top_pct < ry + rh && el_b > ry
    })

    if (inside.length === 0) {
      handleDeselect()
    } else {
      const ids = new Set(inside.map((el) => el.id))
      studioStore.setSelectedIds(ids)
      if (inside.length === 1) {
        onSelectElement(inside[0])
      } else {
        onSelectElement(null)
      }
      onMultiSelect?.(ids)
    }
  }, [handleDeselect, onSelectElement, onMultiSelect])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom((z) => Math.min(4, Math.max(0.25, z - e.deltaY * 0.001)))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.type.startsWith("image/")) return
    setUploading(true)
    try {
      const el = await createImageElement(docId, slideN, file)
      studioStore.upsertElement(el)
      studioStore.selectOne(el.id)
      onSelectElement(el)
    } catch (err) {
      console.error("image drop upload failed:", err)
    } finally {
      setUploading(false)
    }
  }, [docId, slideN, onSelectElement])

  const aspectRatio = slideWidthIn > 0 && slideHeightIn > 0
    ? slideWidthIn / slideHeightIn
    : 16 / 9

  return (
    <CanvasContext.Provider value={{ containerRef, slideWidthIn, slideHeightIn }}>
      <div
        className="relative flex flex-col items-center justify-center w-full h-full p-6 bg-[#e8eaed] select-none overflow-auto"
        onWheel={handleWheel}
      >
        {/* floating zoom control — bottom-right, like Figma / Keynote */}
        <ZoomControl zoom={zoom} setZoom={setZoom} />

        {/* canvas wrapper — maintains slide aspect ratio */}
        <div
          data-slide-canvas="true"
          data-slide-n={slideN}
          className="relative shadow-2xl shrink-0"
          style={{
            aspectRatio: `${aspectRatio}`,
            height: `${zoom * 85}vh`,
            minWidth: 0,
            overflow: rulerOn ? "visible" : "hidden",
            backgroundColor: "white",
            // Scale factor: how many vh units equal one typographic point,
            // given this slide's height in inches. Used by BridgeTextStyle and
            // BridgeParagraph to render font/spacing in physical canvas units
            // rather than CSS pt (which assumes 96 DPI, not 120 DPI reference).
            ["--pt-scale"]: slideHeightIn > 0 ? zoom * 85 / (slideHeightIn * 72) : zoom * 85 / (7.5 * 72),
            // PowerPoint-style: stronger drop shadow so the slide reads as a
            // discrete object floating above the workspace.
            boxShadow: "0 14px 40px -10px rgba(0,0,0,0.30), 0 4px 12px -2px rgba(0,0,0,0.12)",
          }}
          onClick={handleDeselect}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("[data-element]")) return
            e.preventDefault()
            onSlideContextMenu?.(e.clientX, e.clientY)
          }}
          onPointerMoveCapture={(e) => {
            // Broadcast local mouse position as a percent of the slide
            // bounds. Awareness updates throttle naturally; LiveCursorLayer
            // smooths the rendered position.
            if (!room) return
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const x_pct = ((e.clientX - rect.left) / rect.width) * 100
            const y_pct = ((e.clientY - rect.top)  / rect.height) * 100
            if (x_pct < 0 || x_pct > 100 || y_pct < 0 || y_pct > 100) return
            try { setLocalPointer(room, { x_pct, y_pct }) } catch { /* no-op */ }
          }}
          onPointerLeave={() => {
            if (room) { try { setLocalPointer(room, null) } catch { /* no-op */ } }
          }}
        >
          {/* rulers */}
          {rulerOn && slideWidthIn > 0 && slideHeightIn > 0 && (() => {
            const RULER_PX = 16
            const hTicks = Array.from({ length: Math.floor(slideWidthIn) + 1 }, (_, i) => i)
            const vTicks = Array.from({ length: Math.floor(slideHeightIn) + 1 }, (_, i) => i)
            const hHalves = Array.from({ length: Math.floor(slideWidthIn * 2) + 1 }, (_, i) => i * 0.5).filter((v) => v % 1 !== 0)
            const vHalves = Array.from({ length: Math.floor(slideHeightIn * 2) + 1 }, (_, i) => i * 0.5).filter((v) => v % 1 !== 0)
            return (
              <>
                {/* horizontal ruler — above the canvas */}
                <svg
                  className="absolute pointer-events-none"
                  style={{ left: 0, right: 0, top: -RULER_PX, width: "100%", height: RULER_PX, zIndex: 20000 }}
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect width="100%" height="100%" fill="rgba(15,15,25,0.92)" />
                  {hTicks.map((i) => {
                    const x = `${(i / slideWidthIn) * 100}%`
                    return (
                      <g key={i}>
                        <line x1={x} y1="0" x2={x} y2="10" stroke="rgba(148,163,184,0.6)" strokeWidth={0.75} />
                        {i > 0 && i < slideWidthIn && (
                          <text x={x} y="9" fontSize={7} fill="rgba(148,163,184,0.7)" textAnchor="middle">{i}</text>
                        )}
                      </g>
                    )
                  })}
                  {hHalves.map((v) => (
                    <line key={v} x1={`${(v / slideWidthIn) * 100}%`} y1="4" x2={`${(v / slideWidthIn) * 100}%`} y2="10" stroke="rgba(148,163,184,0.35)" strokeWidth={0.5} />
                  ))}
                </svg>
                {/* vertical ruler — left of the canvas */}
                <svg
                  className="absolute pointer-events-none"
                  style={{ top: 0, bottom: 0, left: -RULER_PX, width: RULER_PX, height: "100%", zIndex: 20000 }}
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect width="100%" height="100%" fill="rgba(15,15,25,0.92)" />
                  {vTicks.map((i) => {
                    const y = `${(i / slideHeightIn) * 100}%`
                    return (
                      <g key={i}>
                        <line x1="0" y1={y} x2="10" y2={y} stroke="rgba(148,163,184,0.6)" strokeWidth={0.75} />
                        {i > 0 && i < slideHeightIn && (
                          <text y={y} x="9" fontSize={7} fill="rgba(148,163,184,0.7)" textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90, 9, ${(i / slideHeightIn) * 100})`}>{i}</text>
                        )}
                      </g>
                    )
                  })}
                  {vHalves.map((v) => (
                    <line key={v} x1="4" y1={`${(v / slideHeightIn) * 100}%`} x2="10" y2={`${(v / slideHeightIn) * 100}%`} stroke="rgba(148,163,184,0.35)" strokeWidth={0.5} />
                  ))}
                </svg>
              </>
            )
          })()}
          {/* SVG filter defs for color blindness simulation */}
          <svg width="0" height="0" className="absolute" aria-hidden="true">
            <defs>
              <filter id="percy-cb-protanopia" colorInterpolationFilters="linearRGB">
                <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
              </filter>
              <filter id="percy-cb-deuteranopia" colorInterpolationFilters="linearRGB">
                <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
              </filter>
              <filter id="percy-cb-tritanopia" colorInterpolationFilters="linearRGB">
                <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
              </filter>
              <filter id="percy-cb-achromatopsia" colorInterpolationFilters="linearRGB">
                <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
              </filter>
            </defs>
          </svg>

          <div
            ref={containerRef}
            className="absolute inset-0"
            style={colorBlindMode ? { filter: `url(#percy-cb-${colorBlindMode})` } : undefined}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* drag-over overlay */}
            {(dragOver || uploading) && (
              <div className="absolute inset-0 z-[99000] flex items-center justify-center pointer-events-none"
                style={{ background: "rgba(99,102,241,0.15)", border: "3px dashed rgba(99,102,241,0.8)" }}>
                <span className="text-paper text-sm font-semibold bg-black/60 px-4 py-2 rounded-lg">
                  {uploading ? "Uploading…" : "Drop image to insert"}
                </span>
              </div>
            )}
            {/* slide background — use document background color or white */}
            <div className="absolute inset-0" style={{ background: bgColor ?? "#FFFFFF", zIndex: 0 }} />

            {/* grid overlay — Google Slides style: subtle light gray dot grid */}
            {gridOn && slideWidthIn > 0 && slideHeightIn > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%", zIndex: 5000 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Vertical lines */}
                {Array.from({ length: Math.floor(slideWidthIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={`${(i * GRID_IN / slideWidthIn) * 100}%`}
                    y1="0%" x2={`${(i * GRID_IN / slideWidthIn) * 100}%`} y2="100%"
                    stroke="rgba(0,0,0,0.10)" strokeWidth={0.5}
                    strokeDasharray={i % 4 === 0 ? "none" : "2 4"}
                  />
                ))}
                {/* Horizontal lines */}
                {Array.from({ length: Math.floor(slideHeightIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`h${i}`}
                    y1={`${(i * GRID_IN / slideHeightIn) * 100}%`}
                    x1="0%" y2={`${(i * GRID_IN / slideHeightIn) * 100}%`} x2="100%"
                    stroke="rgba(0,0,0,0.10)" strokeWidth={0.5}
                    strokeDasharray={i % 4 === 0 ? "none" : "2 4"}
                  />
                ))}
              </svg>
            )}

            {/* smart guide lines — Google Slides red solid lines */}
            {snapGuides.length > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%", zIndex: 19999 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {snapGuides.map((g, i) =>
                  g.type === "v" ? (
                    <line key={i} x1={`${g.pos}%`} y1="0%" x2={`${g.pos}%`} y2="100%"
                      stroke="#ea4335" strokeWidth={1} />
                  ) : (
                    <line key={i} x1="0%" y1={`${g.pos}%`} x2="100%" y2={`${g.pos}%`}
                      stroke="#ea4335" strokeWidth={1} />
                  )
                )}
              </svg>
            )}

            {/* Phase E: remote collaborators' selection rings + live cursors */}
            <RemotePresenceLayer elements={elements} />
            <LiveCursorLayer room={room} />

            {/* Empty-slide state — rich Google Slides-style insertion buttons */}
            {!loading && elements.length === 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: 1 }}
              >
                <div className="text-center select-none flex flex-col items-center" style={{ color: "#5f6368" }}>
                  <div style={{
                    fontSize: "clamp(16px, 2vw, 24px)", fontWeight: 400, letterSpacing: "-0.01em",
                    color: "#3c4043", marginBottom: 4, fontFamily: "'Google Sans', system-ui, sans-serif",
                  }}>
                    Add content to this slide
                  </div>
                  <div style={{ fontSize: 12, color: "#80868b", marginBottom: 24, fontFamily: "'Google Sans', system-ui, sans-serif" }}>
                    Drop an image, paste data, or pick an element below
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[
                      { label: "Text", icon: "T",  type: "text_box" },
                      { label: "Shape", icon: "■", type: "rect" },
                      { label: "Image", icon: "🖼", type: "__image__" },
                      { label: "Chart", icon: "📊", type: "__chart__" },
                      { label: "Table", icon: "▦", type: "__table__" },
                    ].map((b) => (
                      <button
                        key={b.label}
                        onClick={() => {
                          // Dispatch a custom event that Studio handles
                          window.dispatchEvent(new CustomEvent("percy:empty-slide-insert", { detail: { type: b.type } }))
                        }}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                          padding: "12px 18px",
                          background: "#fff", border: "1px solid #dadce0", borderRadius: 8,
                          color: "#3c4043", fontSize: 12,
                          fontFamily: "'Google Sans', system-ui, sans-serif",
                          cursor: "pointer",
                          transition: "background 80ms, border-color 80ms, transform 80ms",
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLButtonElement
                          el.style.background = "#f8f9fa"
                          el.style.borderColor = "#1a73e8"
                          el.style.color = "#1a73e8"
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLButtonElement
                          el.style.background = "#fff"
                          el.style.borderColor = "#dadce0"
                          el.style.color = "#3c4043"
                        }}
                      >
                        <span style={{ fontSize: 24, lineHeight: 1 }}>{b.icon}</span>
                        <span>{b.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* element overlays — each carries its own render PNG */}
            {[...elements].sort((a, b) => a.z_index - b.z_index).map((el) => (
              <ElementOverlay
                // Include slideN in the key so element id collisions across
                // slides (slide-direct "8" on multiple slides, layout-derived
                // "l11" etc.) force a fresh mount of ElementOverlay on
                // navigation. Without this, the renderer component instance
                // persists with the previous slide's cached text payload —
                // visible as "! text load failed" overlays atop the prior
                // slide's content when the new slide doesn't contain that id.
                key={`${slideN}-${el.id}`}
                element={el}
                selected={selectedIds.has(el.id)}
                isMultiSelected={selectedIds.size > 1 && selectedIds.has(el.id)}
                snapEnabled={snapOn}
                otherElements={elements.filter((e) => e.id !== el.id)}
                docId={docId}
                slideN={slideN}
                renderKey={renderKeys[el.id] ?? 0}
                onSelect={handleSelect}
                onCommit={handleCommit}
                onMultiMove={handleMultiMove}
                onRotate={handleRotate}
                onSnapLines={setSnapGuides}
                onInlineEdit={(id) => { setInlineEditId(id) }}
                onContextMenu={(id, x, y) => setCtxMenu({ id, x, y })}
                onDragInfo={setDragInfo}
                hasConnect={connectIds?.has(el.id) ?? false}
                onAltDuplicate={onAltDuplicate}
              />
            ))}
            {/* multi-select bounding box — Google blue dashed */}
            {selectedIds.size > 1 && (() => {
              const sel = elements.filter((e) => selectedIds.has(e.id))
              if (!sel.length) return null
              const minL = Math.min(...sel.map((e) => e.left_pct))
              const minT = Math.min(...sel.map((e) => e.top_pct))
              const maxR = Math.max(...sel.map((e) => e.left_pct + e.width_pct))
              const maxB = Math.max(...sel.map((e) => e.top_pct + e.height_pct))
              return (
                <>
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: `${minL}%`, top: `${minT}%`,
                      width: `${maxR - minL}%`, height: `${maxB - minT}%`,
                      border: "1.5px dashed #1a73e8",
                      zIndex: 10000,
                      boxSizing: "border-box",
                    }}
                  />
                  <MultiSelectToolbar
                    count={selectedIds.size}
                    style={{
                      position: "absolute",
                      left: `${minL}%`, top: `${minT}%`,
                      transform: "translateY(-40px)",
                      zIndex: 10001,
                    }}
                    onAlign={(a) => {
                      // Hook into Studio's handleAlignElements via custom event
                      window.dispatchEvent(new CustomEvent("percy:multi-align", { detail: { alignment: a } }))
                    }}
                    onGroup={() => {
                      window.dispatchEvent(new CustomEvent("percy:multi-group"))
                    }}
                  />
                </>
              )
            })()}

            {/* rubber-band selection rect — Google blue fill + border */}
            {rubberBand && rubberBand.w > 0.2 && rubberBand.h > 0.2 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${rubberBand.x}%`, top: `${rubberBand.y}%`,
                  width: `${rubberBand.w}%`, height: `${rubberBand.h}%`,
                  border: "1px solid #1a73e8",
                  background: "rgba(26,115,232,0.10)",
                  zIndex: 20000,
                  boxSizing: "border-box",
                }}
              />
            )}

            {/* inline text editor */}
            {inlineEditId && (() => {
              const el = elements.find((e) => e.id === inlineEditId)
              if (!el) return null
              return (
                <InlineTextEditor
                  key={inlineEditId}
                  element={el}
                  docId={docId}
                  slideN={slideN}
                  onCommit={() => {
                    setInlineEditId(null)
                    studioStore.bumpRenderKeys([inlineEditId])
                  }}
                  onCancel={() => setInlineEditId(null)}
                />
              )
            })()}

            {/* loading shimmer */}
            {loading && (
              <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                <span className="inline-block w-5 h-5 border-2 border-[#1a73e8] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* error */}
            {error && !loading && (
              <div className="absolute bottom-2 left-2 text-xs text-bad bg-surface/90 px-2 py-1 rounded">
                {error}
              </div>
            )}
          </div>

          {/* annotation overlay */}
          {annotating && (
            <AnnotationOverlay
              slideN={slideN}
              onClose={() => setAnnotating(false)}
            />
          )}

          {/* placement mode overlay — drag to define element bounds */}
          {placingShapeType && onPlaceShape && (
            <PlacementOverlay
              slideWidthIn={slideWidthIn}
              slideHeightIn={slideHeightIn}
              onPlace={onPlaceShape}
              onCancel={onCancelPlace ?? (() => {})}
            />
          )}

          {/* freeform draw overlay — pen or polygon */}
          {drawMode && onFinishFreeform && (
            <FreeformDrawOverlay
              mode={drawMode}
              slideWidthIn={slideWidthIn}
              slideHeightIn={slideHeightIn}
              onFinish={onFinishFreeform}
              onCancel={onCancelDraw ?? (() => {})}
            />
          )}
        </div>

        {/* element context menu */}
        {ctxMenu && (() => {
          const el = elements.find((e) => e.id === ctxMenu.id)
          if (!el) return null
          const zVals = elements.map((e) => e.z_index)
          const maxZ  = Math.max(...zVals)
          const minZ  = Math.min(...zVals)
          const sorted = [...elements].sort((a, b) => a.z_index - b.z_index)
          const idx    = sorted.findIndex((e) => e.id === el.id)

          const changeZ = async (newZ: number) => {
            try {
              const updated = await commitElementGeometry(el.id, { z_index: newZ })
              if (updated && selectedIdsRef.current.size <= 1) onSelectElement(updated)
              onZIndexChange?.(el.id)
            } catch (e) { console.error("z-index change failed:", e) }
            setCtxMenu(null)
          }

          const items: ({ label: string; action: () => void; danger?: boolean; dim?: boolean; shortcut?: string } | null)[] = [
            { label: "Edit Connect…", action: () => { onEditConnect?.(el.id); setCtxMenu(null) } },
            null,
            { label: "Cut",       action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true })); setCtxMenu(null) }, shortcut: "⌘X" },
            { label: "Copy",      action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true })); setCtxMenu(null) }, shortcut: "⌘C" },
            { label: "Paste",     action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true })); setCtxMenu(null) }, shortcut: "⌘V" },
            { label: "Duplicate", action: () => { onDuplicateElement?.(el.id); setCtxMenu(null) }, shortcut: "⌘D" },
            { label: "Delete",    action: () => { onDeleteElement?.(el.id); setCtxMenu(null) }, danger: true, shortcut: "Del" },
            null,
            { label: el.locked ? "Unlock" : "Lock", action: () => { onToggleLockElement?.(el.id, !el.locked); setCtxMenu(null) } },
            { label: el.hidden ? "Show" : "Hide",   action: () => { onToggleHiddenElement?.(el.id, !el.hidden); setCtxMenu(null) } },
            null,
            selectedIds.size > 1 && onGroupElements
              ? { label: `Group ${selectedIds.size} elements`, action: () => { onGroupElements(); setCtxMenu(null) }, shortcut: "⌘G" }
              : null,
            el.type === "BridgeGroup" && onUngroupElement
              ? { label: "Ungroup", action: () => { onUngroupElement(el.id); setCtxMenu(null) }, shortcut: "⌘⇧G" }
              : null,
            null,
            { label: "Bring to front",  action: () => changeZ(maxZ + 1), dim: el.z_index === maxZ, shortcut: "⌘⇧]" },
            { label: "Bring forward",   action: () => { const above = sorted[idx + 1]; if (above) changeZ(above.z_index + 0.5); else setCtxMenu(null) }, dim: idx >= sorted.length - 1, shortcut: "⌘]" },
            { label: "Send backward",   action: () => { const below = sorted[idx - 1]; if (below) changeZ(below.z_index - 0.5); else setCtxMenu(null) }, dim: idx <= 0, shortcut: "⌘[" },
            { label: "Send to back",    action: () => changeZ(minZ - 1), dim: el.z_index === minZ, shortcut: "⌘⇧[" },
            null,
            {
              label: `Select all ${el.type.replace(/^Bridge/, "")}s`,
              action: () => {
                const sameType = elements.filter((e) => e.type === el.type)
                const ids = new Set(sameType.map((e) => e.id))
                studioStore.setSelectedIds(ids)
                onMultiSelect?.(ids)
                onSelectElement(sameType.length === 1 ? sameType[0] : null)
                setCtxMenu(null)
              },
              dim: elements.filter((e) => e.type === el.type).length <= 1,
            },
          ]
          return (
            <GsContextMenu
              x={ctxMenu.x} y={ctxMenu.y}
              el={el}
              items={items}
              docId={docId}
              slideN={slideN}
              rewriteInput={rewriteInput}
              setRewriteInput={setRewriteInput}
              talkingPoints={talkingPoints}
              setTalkingPoints={setTalkingPoints}
              onBroadcast={() => {
                broadcastElement(docId, slideN, el.id)
                  .then((r) => onBroadcastElement?.(r.pushed_to))
                  .catch((err) => console.error("broadcast failed:", err))
                setCtxMenu(null)
              }}
              onSplit={onSplitElement ? () => { onSplitElement(el.id); setCtxMenu(null) } : undefined}
              onClose={() => setCtxMenu(null)}
              onGenerateTalkingPoints={() => {
                setTalkingPoints({ id: el.id, points: [], loading: true })
                generateTalkingPoints(docId, slideN, el.id)
                  .then((r) => setTalkingPoints({ id: el.id, points: r.points, loading: false }))
                  .catch(() => setTalkingPoints(null))
              }}
              onRewriteCommit={(instruction) => {
                setRewriteInput((r) => r ? { ...r, busy: true } : r)
                rewriteElementText(docId, slideN, el.id, instruction)
                  .then(() => {
                    studioStore.bumpRenderKeys([el.id])
                    onZIndexChange?.(el.id)
                    setCtxMenu(null)
                    setRewriteInput(null)
                  })
                  .catch((err) => { console.error("rewrite failed:", err); setRewriteInput((r) => r ? { ...r, busy: false } : r) })
              }}
              elementPngUrl={elementPngUrl(docId, slideN, el.id)}
              elementName={el.name}
            />
          )
        })()}

        {/* position/size HUD during drag — Google Slides style dark pill */}
        {dragInfo && (
          <div
            className="fixed z-[99997] pointer-events-none"
            style={{
              left: "50%", transform: "translateX(-50%)", top: 14,
              background: "#202124", color: "#fff",
              fontSize: 11, fontFamily: "'Google Sans', system-ui, sans-serif",
              fontWeight: 500, lineHeight: "20px",
              padding: "2px 10px", borderRadius: 3,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              letterSpacing: "0.01em",
            }}
          >
            x: {dragInfo.x}" · y: {dragInfo.y}" · {dragInfo.w}" × {dragInfo.h}"
          </div>
        )}

        {/* click-away to dismiss context menu */}
        {ctxMenu && (
          <div
            className="fixed inset-0 z-[99998]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}
          />
        )}

        {/* status bar */}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted shrink-0">
          <span>{loading ? "…" : `${elements.length} element${elements.length !== 1 ? "s" : ""}`}</span>
          {selectedIds.size === 1 && (
            <span className="text-accent-light">
              · {elements.find((e) => e.id === [...selectedIds][0])?.name ?? [...selectedIds][0]} selected
            </span>
          )}
          {selectedIds.size > 1 && (
            <span className="text-paper">
              · {selectedIds.size} elements selected
            </span>
          )}
          <button
            onClick={() => setGridOn((g) => !g)}
            title="Toggle grid overlay (0.25 in)"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              gridOn
                ? "bg-paper/30 text-paper border-paper/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setSnapOn((s) => !s)}
            title="Toggle snap to grid"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              snapOn
                ? "bg-paper/30 text-paper border-paper/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            Snap
          </button>
          <button
            onClick={() => setRulerOn((r) => !r)}
            title="Toggle rulers (R)"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              rulerOn
                ? "bg-paper/30 text-paper border-paper/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            Ruler
          </button>
          {onToggleFocusMode && (
            <button
              onClick={onToggleFocusMode}
              title="Toggle focus mode (Ctrl+\)"
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                focusMode
                  ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/40"
                  : "bg-white/5 border-edge hover:bg-white/10"
              }`}
            >
              {focusMode ? "⊙ Focus" : "Focus"}
            </button>
          )}
          <button
            onClick={() => setAnnotating((a) => !a)}
            title="Toggle annotation/markup mode"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              annotating
                ? "bg-red-500/30 text-red-300 border-red-500/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            {annotating ? "✏ Annotate" : "Annotate"}
          </button>
          {/* Zoom moved to a floating control at the canvas corner — see ZoomControl. */}
        </div>
      </div>
    </CanvasContext.Provider>
  )
}

// ── Floating zoom control ────────────────────────────────────────────────────
// Lives at the bottom-right of the canvas area, à la Figma / Keynote.

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

function ZoomControl({ zoom, setZoom }: { zoom: number; setZoom: (fn: (z: number) => number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div
      ref={ref}
      className="absolute bottom-3 right-3 z-30 flex items-center bg-surface/95 border border-edge shadow-lg backdrop-blur-sm"
      style={{ background: "rgb(var(--surface))" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
        title="Zoom out (⌘−)"
        className="w-7 h-7 flex items-center justify-center text-paper hover:bg-paper/10 transition-colors text-base"
      >−</button>
      <button
        onClick={() => setOpen((o) => !o)}
        className="font-mono text-[11px] text-paper px-2 h-7 hover:bg-paper/5 transition-colors min-w-[60px] tabular-nums"
        title="Set zoom level"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(8, z + 0.1))}
        title="Zoom in (⌘+)"
        className="w-7 h-7 flex items-center justify-center text-paper hover:bg-paper/10 transition-colors text-base"
      >+</button>
      <div className="w-px h-5 bg-edge mx-1" />
      <button
        onClick={() => setZoom(() => 1)}
        title="Fit (⌘0)"
        className="px-2 h-7 text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper hover:bg-paper/5 transition-colors"
      >Fit</button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-1 bg-surface border border-edge shadow-2xl min-w-[120px]"
          style={{ background: "rgb(var(--surface))" }}
        >
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setZoom(() => p); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-paper/10 transition-colors ${
                Math.abs(zoom - p) < 0.01 ? "text-paper bg-paper/5" : "text-muted"
              }`}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Multi-select alignment/distribute toolbar (Figma/Slides parity) ────────
// Floats above the multi-select bounding box. Provides quick access to
// align-left/center/right/top/middle/bottom, distribute-horizontal/vertical,
// and group. Dispatches custom events that Studio.tsx listens for.

function MultiSelectToolbar({
  count, style, onAlign, onGroup,
}: {
  count: number
  style:  React.CSSProperties
  onAlign: (alignment: string) => void
  onGroup: () => void
}) {
  return (
    <div
      style={{
        ...style,
        display: "flex", gap: 2,
        background: "#fff",
        border: "1px solid #dadce0", borderRadius: 6,
        padding: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        fontSize: 11, whiteSpace: "nowrap",
        pointerEvents: "all",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span style={{ fontSize: 11, color: "#5f6368", padding: "4px 8px 4px 6px", fontWeight: 500 }}>
        {count} selected
      </span>
      <MSDiv />
      <MSBtn icon="⫷" title="Align left"    onClick={() => onAlign("left")} />
      <MSBtn icon="⊟" title="Align center"  onClick={() => onAlign("center")} />
      <MSBtn icon="⫸" title="Align right"   onClick={() => onAlign("right")} />
      <MSDiv />
      <MSBtn icon="⫳" title="Align top"     onClick={() => onAlign("top")} />
      <MSBtn icon="⊟" title="Align middle"  onClick={() => onAlign("middle")} />
      <MSBtn icon="⫴" title="Align bottom"  onClick={() => onAlign("bottom")} />
      <MSDiv />
      <MSBtn icon="↔" title="Distribute horizontally" onClick={() => onAlign("distribute_h")} />
      <MSBtn icon="↕" title="Distribute vertically"   onClick={() => onAlign("distribute_v")} />
      <MSDiv />
      <MSBtn icon="◳" title="Group (⌘G)"   onClick={onGroup} />
    </div>
  )
}

function MSBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      style={{
        width: 26, height: 24,
        padding: 0,
        background: "transparent",
        border: "1px solid transparent",
        color: "#3c4043", fontSize: 13,
        borderRadius: 3, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
    >
      {icon}
    </button>
  )
}
function MSDiv() {
  return <div style={{ width: 1, background: "#e0e0e0", margin: "2px 2px" }} />
}

// ── Google Slides-style context menu ─────────────────────────────────────────
// White background, Material Design typography, keyboard shortcut hints

interface GsCtxItem { label: string; action: () => void; danger?: boolean; dim?: boolean; shortcut?: string }

function GsContextMenu({
  x, y, el, items, rewriteInput, setRewriteInput, talkingPoints, setTalkingPoints,
  onBroadcast, onSplit, onClose, onGenerateTalkingPoints, onRewriteCommit,
  elementPngUrl, elementName,
}: {
  x: number; y: number
  el: import("../../lib/studioTypes").StudioElement
  items: (GsCtxItem | null)[]
  docId: string; slideN: number
  rewriteInput: { id: string; instruction: string; busy: boolean } | null
  setRewriteInput: (v: { id: string; instruction: string; busy: boolean } | null) => void
  talkingPoints: { id: string; points: string[]; loading: boolean } | null
  setTalkingPoints: (v: { id: string; points: string[]; loading: boolean } | null) => void
  onBroadcast: () => void
  onSplit?: () => void
  onClose: () => void
  onGenerateTalkingPoints: () => void
  onRewriteCommit: (instruction: string) => void
  elementPngUrl: string
  elementName: string
}) {
  // Clamp menu to viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 400),
    zIndex: 99999,
    background: "#fff",
    border: "1px solid #dadce0",
    borderRadius: 4,
    boxShadow: "0 2px 10px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.10)",
    minWidth: 200,
    padding: "4px 0",
    fontFamily: "'Google Sans', system-ui, sans-serif",
    fontSize: 13,
    color: "#3c4043",
    userSelect: "none",
  }

  const btnStyle = (danger?: boolean, dim?: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "6px 16px",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: dim ? "default" : "pointer",
    color: danger ? "#d93025" : dim ? "#80868b" : "#3c4043",
    fontSize: 13,
    lineHeight: "20px",
    opacity: dim ? 0.5 : 1,
    transition: "background 80ms",
  })

  return (
    <div style={menuStyle} data-gs-ctx-menu="true" onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: "#e0e0e0", margin: "4px 0" }} />
        ) : (
          <button
            key={i}
            onClick={item.dim ? undefined : item.action}
            style={btnStyle(item.danger, item.dim)}
            onMouseEnter={(e) => { if (!item.dim) (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span style={{ fontSize: 11, color: "#80868b", marginLeft: 16 }}>{item.shortcut}</span>}
          </button>
        )
      )}

      <div style={{ height: 1, background: "#e0e0e0", margin: "4px 0" }} />

      {/* Push to all slides */}
      <button
        onClick={onBroadcast}
        style={btnStyle()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
        title="Copy to all other slides at the same position"
      >
        Push to all slides
      </button>

      {/* Split to slides */}
      {onSplit && (el.type === "BridgeText" || el.type === "BridgeShape" || el.type === "BridgeFreeform") && (
        <button
          onClick={onSplit}
          style={btnStyle()}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
          title="Split each paragraph to its own slide"
        >
          Split to slides
        </button>
      )}

      <div style={{ height: 1, background: "#e0e0e0", margin: "4px 0" }} />

      {/* AI Rewrite */}
      {rewriteInput?.id === el.id ? (
        <div style={{ padding: "6px 12px" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: "#80868b", marginBottom: 4 }}>Rewrite instruction</div>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              autoFocus
              value={rewriteInput.instruction}
              onChange={(e) => setRewriteInput({ ...rewriteInput, instruction: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter" && rewriteInput.instruction.trim() && !rewriteInput.busy) {
                  onRewriteCommit(rewriteInput.instruction)
                }
                if (e.key === "Escape") { setRewriteInput(null) }
              }}
              placeholder="e.g. make shorter, formal tone…"
              style={{
                flex: 1, fontSize: 12, border: "1px solid #dadce0", borderRadius: 4,
                padding: "4px 8px", outline: "none", color: "#3c4043",
              }}
            />
            <button
              disabled={!rewriteInput.instruction.trim() || rewriteInput.busy}
              onClick={() => rewriteInput.instruction.trim() && !rewriteInput.busy && onRewriteCommit(rewriteInput.instruction)}
              style={{
                padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                background: "#1a73e8", color: "#fff", border: "none",
                opacity: !rewriteInput.instruction.trim() || rewriteInput.busy ? 0.5 : 1,
              }}
            >
              {rewriteInput.busy ? "…" : "Go"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setRewriteInput({ id: el.id, instruction: "", busy: false })}
          style={btnStyle()}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
        >
          ✨ AI Rewrite…
        </button>
      )}

      {/* Talking Points */}
      {(el.type === "BridgeText" || el.type === "BridgeShape" || el.type === "BridgeFreeform") && (
        talkingPoints?.id === el.id ? (
          <div style={{ padding: "6px 12px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#f9ab00", fontWeight: 500 }}>Talking Points</span>
              <button onClick={() => setTalkingPoints(null)} style={{ fontSize: 12, color: "#80868b", background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
            {talkingPoints.loading ? (
              <div style={{ fontSize: 11, color: "#80868b" }}>Generating…</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {talkingPoints.points.map((pt, i) => (
                  <li key={i} style={{ fontSize: 11, color: "#3c4043", padding: "2px 0 2px 8px", borderLeft: "2px solid #f9ab00" }}>
                    {pt}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button
            onClick={onGenerateTalkingPoints}
            style={btnStyle()}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
          >
            💬 Talking Points…
          </button>
        )
      )}

      <div style={{ height: 1, background: "#e0e0e0", margin: "4px 0" }} />

      {/* Download PNG */}
      <a
        href={elementPngUrl}
        download={`${elementName.replace(/[^a-z0-9]/gi, "_")}.png`}
        onClick={onClose}
        style={{
          ...btnStyle(),
          display: "flex",
          textDecoration: "none",
          color: "#3c4043",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#f1f3f4" }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "none" }}
      >
        Save as PNG
      </a>
    </div>
  )
}
