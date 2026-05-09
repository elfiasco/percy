import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { createImageElement, elementPngUrl, broadcastElement, rewriteElementText, generateTalkingPoints } from "../../lib/studioApi"
import { CanvasContext } from "./CanvasContext"
import ElementOverlay from "./ElementOverlay"
import InlineTextEditor from "./InlineTextEditor"
import AnnotationOverlay from "./AnnotationOverlay"
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
  connectIds?: Set<string>   // element IDs (on this slide) that have a Python connect attached
  colorBlindMode?: string | null
}

export default function StudioCanvas({ docId, slideN, slideWidthIn, slideHeightIn, refreshKey, onSelectElement, onMultiSelect, onElementRotated, onDeleteElement, onDuplicateElement, onToggleLockElement, onToggleHiddenElement, onZIndexChange, onGroupElements, onUngroupElement, focusMode, onToggleFocusMode, onSlideContextMenu, onBroadcastElement, onSplitElement, onEditConnect, connectIds, colorBlindMode }: Props) {
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
      // Ctrl+[ send backward, Ctrl+] bring forward
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
            const above = sorted[idx + 1]
            newZ = above ? above.z_index + 0.5 : maxZ
          } else {
            const below = sorted[idx - 1]
            newZ = below ? below.z_index - 0.5 : minZ
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
        className="relative flex flex-col items-center justify-center w-full h-full p-6 bg-[#d6d6d6] select-none overflow-auto"
        onWheel={handleWheel}
      >
        {/* floating zoom control — bottom-right, like Figma / Keynote */}
        <ZoomControl zoom={zoom} setZoom={setZoom} />

        {/* canvas wrapper — maintains slide aspect ratio */}
        <div
          data-slide-canvas="true"
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

            {/* grid overlay */}
            {gridOn && slideWidthIn > 0 && slideHeightIn > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%", zIndex: 5000 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {Array.from({ length: Math.floor(slideWidthIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={`${(i * GRID_IN / slideWidthIn) * 100}%`}
                    y1="0%" x2={`${(i * GRID_IN / slideWidthIn) * 100}%`} y2="100%"
                    stroke="rgba(99,102,241,0.25)" strokeWidth={0.5}
                  />
                ))}
                {Array.from({ length: Math.floor(slideHeightIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`h${i}`}
                    y1={`${(i * GRID_IN / slideHeightIn) * 100}%`}
                    x1="0%" y2={`${(i * GRID_IN / slideHeightIn) * 100}%`} x2="100%"
                    stroke="rgba(99,102,241,0.25)" strokeWidth={0.5}
                  />
                ))}
              </svg>
            )}

            {/* snap guide lines — shown during element drag */}
            {snapGuides.length > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%", zIndex: 19999 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {snapGuides.map((g, i) =>
                  g.type === "v" ? (
                    <line key={i} x1={`${g.pos}%`} y1="0%" x2={`${g.pos}%`} y2="100%"
                      stroke="rgba(239,68,68,0.85)" strokeWidth={1} strokeDasharray="4 3" />
                  ) : (
                    <line key={i} x1="0%" y1={`${g.pos}%`} x2="100%" y2={`${g.pos}%`}
                      stroke="rgba(239,68,68,0.85)" strokeWidth={1} strokeDasharray="4 3" />
                  )
                )}
              </svg>
            )}

            {/* Phase E: remote collaborators' selection rings + live cursors */}
            <RemotePresenceLayer elements={elements} />
            <LiveCursorLayer room={room} />

            {/* PowerPoint-style empty-state hint when slide has no elements */}
            {!loading && elements.length === 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ zIndex: 1 }}
              >
                <div className="text-center select-none" style={{ color: "rgba(0,0,0,0.30)" }}>
                  <div style={{ fontSize: "clamp(18px, 2.4vw, 32px)", fontWeight: 300, letterSpacing: "-0.01em" }}>
                    Click to add a text box
                  </div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.16em]" style={{ opacity: 0.6 }}>
                    or use the Insert tab to add shapes, charts, images
                  </div>
                </div>
              </div>
            )}

            {/* element overlays — each carries its own render PNG */}
            {[...elements].sort((a, b) => a.z_index - b.z_index).map((el) => (
              <ElementOverlay
                key={el.id}
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
              />
            ))}
            {/* multi-select bounding box */}
            {selectedIds.size > 1 && (() => {
              const sel = elements.filter((e) => selectedIds.has(e.id))
              if (!sel.length) return null
              const minL = Math.min(...sel.map((e) => e.left_pct))
              const minT = Math.min(...sel.map((e) => e.top_pct))
              const maxR = Math.max(...sel.map((e) => e.left_pct + e.width_pct))
              const maxB = Math.max(...sel.map((e) => e.top_pct + e.height_pct))
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${minL}%`, top: `${minT}%`,
                    width: `${maxR - minL}%`, height: `${maxB - minT}%`,
                    border: "2px dashed rgba(99,102,241,0.8)",
                    zIndex: 10000,
                    boxSizing: "border-box",
                  }}
                />
              )
            })()}

            {/* rubber-band selection rect */}
            {rubberBand && rubberBand.w > 0.2 && rubberBand.h > 0.2 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${rubberBand.x}%`, top: `${rubberBand.y}%`,
                  width: `${rubberBand.w}%`, height: `${rubberBand.h}%`,
                  border: "1.5px dashed rgba(99,102,241,0.9)",
                  background: "rgba(99,102,241,0.08)",
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
              <div className="absolute inset-0 bg-base/60 flex items-center justify-center">
                <span className="text-xs text-muted animate-pulse">Loading elements…</span>
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

          const items: ({ label: string; action: () => void; danger?: boolean; dim?: boolean } | null)[] = [
            { label: "⚙ Edit Connect…", action: () => { onEditConnect?.(el.id); setCtxMenu(null) } },
            null,
            { label: "Duplicate", action: () => { onDuplicateElement?.(el.id); setCtxMenu(null) } },
            { label: "Delete",    action: () => { onDeleteElement?.(el.id); setCtxMenu(null) }, danger: true },
            null,
            { label: el.locked ? "Unlock" : "Lock", action: () => { onToggleLockElement?.(el.id, !el.locked); setCtxMenu(null) } },
            { label: el.hidden ? "Show" : "Hide",   action: () => { onToggleHiddenElement?.(el.id, !el.hidden); setCtxMenu(null) } },
            null,
            selectedIds.size > 1 && onGroupElements
              ? { label: `Group ${selectedIds.size} Elements`, action: () => { onGroupElements(); setCtxMenu(null) } }
              : null,
            el.type === "BridgeGroup" && onUngroupElement
              ? { label: "Ungroup", action: () => { onUngroupElement(el.id); setCtxMenu(null) } }
              : null,
            null,
            { label: "Bring to Front",  action: () => changeZ(maxZ + 1), dim: el.z_index === maxZ },
            { label: "Bring Forward",   action: () => { const above = sorted[idx + 1]; if (above) changeZ(above.z_index + 0.5); else setCtxMenu(null) }, dim: idx >= sorted.length - 1 },
            { label: "Send Backward",   action: () => { const below = sorted[idx - 1]; if (below) changeZ(below.z_index - 0.5); else setCtxMenu(null) }, dim: idx <= 0 },
            { label: "Send to Back",    action: () => changeZ(minZ - 1), dim: el.z_index === minZ },
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
            <div
              className="fixed z-[99999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[170px] text-xs"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {items.map((item, i) =>
                item === null ? (
                  <div key={i} className="border-t border-edge/50 my-1" />
                ) : (
                  <button
                    key={i}
                    onClick={item.action}
                    disabled={item.dim}
                    className={`w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-default ${
                      item.danger ? "text-red-400 hover:text-red-300" : "text-slate-300"
                    }`}
                  >
                    {item.label}
                  </button>
                )
              )}
              <div className="border-t border-edge/50 my-1" />
              <button
                onClick={() => {
                  broadcastElement(docId, slideN, el.id)
                    .then((r) => { onBroadcastElement?.(r.pushed_to) })
                    .catch((err) => console.error("broadcast failed:", err))
                  setCtxMenu(null)
                }}
                title="Copy this element to every other slide at the same position"
                className="w-full text-left px-3 py-1.5 hover:bg-sky-500/10 hover:text-sky-300 transition-colors text-slate-300"
              >
                ⊕ Push to all slides
              </button>
              {onSplitElement && (el.type === "BridgeText" || el.type === "BridgeShape" || el.type === "BridgeFreeform") && (
                <>
                  <button
                    onClick={() => { onSplitElement(el.id); setCtxMenu(null) }}
                    title="Split each paragraph of this element onto its own new slide"
                    className="w-full text-left px-3 py-1.5 hover:bg-paper/10 hover:text-paper transition-colors text-slate-300"
                  >
                    ⊗ Split to slides
                  </button>
                </>
              )}
              <div className="border-t border-edge/50 my-1" />
              {/* AI Rewrite */}
              {rewriteInput?.id === el.id ? (
                <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <div className="text-[10px] text-muted mb-1">Rewrite instruction</div>
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={rewriteInput.instruction}
                      onChange={(e) => setRewriteInput((r) => r ? { ...r, instruction: e.target.value } : r)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter" && rewriteInput.instruction.trim() && !rewriteInput.busy) {
                          setRewriteInput((r) => r ? { ...r, busy: true } : r)
                          rewriteElementText(docId, slideN, el.id, rewriteInput.instruction)
                            .then(() => {
                              studioStore.bumpRenderKeys([el.id])
                              onZIndexChange?.(el.id)
                              setCtxMenu(null)
                              setRewriteInput(null)
                            })
                            .catch((err) => { console.error("rewrite failed:", err); setRewriteInput((r) => r ? { ...r, busy: false } : r) })
                        }
                        if (e.key === "Escape") { setRewriteInput(null) }
                      }}
                      placeholder="e.g. make shorter, formal tone…"
                      className="flex-1 text-[11px] bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
                    />
                    <button
                      disabled={!rewriteInput.instruction.trim() || rewriteInput.busy}
                      onClick={() => {
                        if (!rewriteInput.instruction.trim()) return
                        setRewriteInput((r) => r ? { ...r, busy: true } : r)
                        rewriteElementText(docId, slideN, el.id, rewriteInput.instruction)
                          .then(() => {
                            studioStore.bumpRenderKeys([el.id])
                            onZIndexChange?.(el.id)
                            setCtxMenu(null)
                            setRewriteInput(null)
                          })
                          .catch((err) => { console.error("rewrite failed:", err); setRewriteInput((r) => r ? { ...r, busy: false } : r) })
                      }}
                      className="px-2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-40 text-[10px]"
                    >
                      {rewriteInput.busy ? "…" : "↵"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setRewriteInput({ id: el.id, instruction: "", busy: false }) }}
                  title="Use AI to rewrite this element's text"
                  className="w-full text-left px-3 py-1.5 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors text-slate-300"
                >
                  ✨ AI Rewrite…
                </button>
              )}
              {/* Talking Points */}
              {(el.type === "BridgeText" || el.type === "BridgeShape" || el.type === "BridgeFreeform") && (
                talkingPoints?.id === el.id ? (
                  <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-amber-300/80">Talking Points</span>
                      <button onClick={() => setTalkingPoints(null)} className="text-[10px] text-white/30 hover:text-white/60">×</button>
                    </div>
                    {talkingPoints.loading ? (
                      <div className="text-[10px] text-white/40 py-1 animate-pulse">Generating…</div>
                    ) : (
                      <ul className="space-y-1">
                        {talkingPoints.points.map((pt, i) => (
                          <li key={i} className="text-[10px] text-white/70 leading-relaxed pl-2 border-l border-amber-400/30">
                            {pt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setTalkingPoints({ id: el.id, points: [], loading: true })
                      generateTalkingPoints(docId, slideN, el.id)
                        .then((r) => setTalkingPoints({ id: el.id, points: r.points, loading: false }))
                        .catch(() => setTalkingPoints(null))
                    }}
                    title="Generate talking points for this element's text"
                    className="w-full text-left px-3 py-1.5 hover:bg-amber-500/10 hover:text-amber-300 transition-colors text-slate-300"
                  >
                    💬 Talking Points…
                  </button>
                )
              )}
              <div className="border-t border-edge/50 my-1" />
              <a
                href={elementPngUrl(docId, slideN, el.id)}
                download={`${el.name.replace(/[^a-z0-9]/gi, "_")}.png`}
                onClick={() => setCtxMenu(null)}
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors text-slate-300 flex items-center gap-1.5 no-underline"
              >
                ↓ Download as PNG
              </a>
            </div>
          )
        })()}

        {/* position HUD during drag */}
        {dragInfo && (
          <div
            className="fixed z-[99997] pointer-events-none bg-black/80 text-white/90 text-[10px] font-mono
                       rounded px-2 py-1 border border-white/10 leading-tight"
            style={{ left: "50%", transform: "translateX(-50%)", top: 12 }}
          >
            x {dragInfo.x}" · y {dragInfo.y}" · {dragInfo.w}" × {dragInfo.h}"
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
