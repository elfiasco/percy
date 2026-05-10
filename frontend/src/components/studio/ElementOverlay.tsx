import { useRef, useCallback, useState, type CSSProperties } from "react"
import type { StudioElement, ResizeHandle } from "../../lib/studioTypes"
import { useCanvas } from "./CanvasContext"
import { getRenderer } from "./renderers/RendererRegistry"
import ElementErrorBoundary from "./ElementErrorBoundary"
import { studioStore } from "../../lib/studio/store"

// Element types whose native renderers handle inline editing themselves —
// dblclick should signal them to enter edit mode rather than open the legacy
// InlineTextEditor.
const NATIVE_EDIT_TYPES = new Set(["BridgeTable", "BridgeText", "BridgeShape"])

// Module-load banner so we can verify the deployed bundle contains this code.
// eslint-disable-next-line no-console
if (typeof window !== "undefined") (window as Record<string, unknown>).__percy_overlay_loaded = true

// ── Google Slides design tokens ───────────────────────────────────────────────
const GS_BLUE        = "#1a73e8"          // primary selection color
const GS_BLUE_ALPHA  = "rgba(26,115,232,0.12)"  // selection fill (unused on shapes, used on empty canvas)
const HANDLE_SIZE    = 8                  // px — square resize handle
const HANDLE_HALF    = HANDLE_SIZE / 2   // 4px
const ROT_DIST       = 28                // px above element top-center
const ROT_SIZE       = 10               // diameter of rotation handle circle

const HANDLE_DIRS: ResizeHandle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"]

// Google Slides cursor map (matches nw-resize, ne-resize, etc.)
const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: "nw-resize", n: "n-resize",  ne: "ne-resize",
  w:  "w-resize",                   e:  "e-resize",
  sw: "sw-resize", s: "s-resize",  se: "se-resize",
}

// Position each 8×8 handle relative to the element bounding box
const HANDLE_STYLE: Record<ResizeHandle, CSSProperties> = {
  nw: { top:  -HANDLE_HALF, left:  -HANDLE_HALF },
  n:  { top:  -HANDLE_HALF, left: "50%", transform: "translateX(-50%)" },
  ne: { top:  -HANDLE_HALF, right: -HANDLE_HALF },
  w:  { top: "50%", left:  -HANDLE_HALF, transform: "translateY(-50%)" },
  e:  { top: "50%", right: -HANDLE_HALF, transform: "translateY(-50%)" },
  sw: { bottom: -HANDLE_HALF, left:  -HANDLE_HALF },
  s:  { bottom: -HANDLE_HALF, left: "50%", transform: "translateX(-50%)" },
  se: { bottom: -HANDLE_HALF, right: -HANDLE_HALF },
}

interface DragState {
  mode: "move" | "resize"
  handle?: ResizeHandle
  startX: number
  startY: number
  startLeftPct: number
  startTopPct: number
  startWidthPct: number
  startHeightPct: number
  containerW: number
  containerH: number
  altHeld: boolean
  pointerId: number
  captureTarget: HTMLElement
  /** Drag threshold not yet exceeded — letting click events bubble to inner renderers. */
  pending: boolean
}

const DRAG_THRESHOLD_PX = 3   // pointer must move this far before drag activates

interface SnapLine { type: "h" | "v"; pos: number }

interface Props {
  element: StudioElement
  selected: boolean
  isMultiSelected: boolean
  snapEnabled?: boolean
  otherElements?: StudioElement[]
  docId: string
  slideN: number
  renderKey: number
  onSelect: (id: string, shiftKey?: boolean) => void
  onCommit: (id: string, leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  onMultiMove?: (deltaLeftIn: number, deltaTopIn: number) => void
  onRotate?: (id: string, rotation: number) => void
  onSnapLines?: (lines: SnapLine[]) => void
  onInlineEdit?: (id: string) => void
  onContextMenu?: (id: string, x: number, y: number) => void
  onDragInfo?: (info: { x: number; y: number; w: number; h: number } | null) => void
  hasConnect?: boolean
  onAltDuplicate?: (id: string, leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
}

const TEXT_TYPES = new Set(["BridgeText", "BridgeShape"])

export default function ElementOverlay({
  element, selected, isMultiSelected, snapEnabled, otherElements, docId, slideN, renderKey,
  onSelect, onCommit, onMultiMove, onRotate, onSnapLines, onInlineEdit, onContextMenu,
  onDragInfo, hasConnect, onAltDuplicate,
}: Props) {
  const { containerRef, slideWidthIn, slideHeightIn } = useCanvas()
  const overlayRef   = useRef<HTMLDivElement>(null)
  const dragState    = useRef<DragState | null>(null)
  const rotDragStart = useRef<{ clientX: number; clientY: number; startRot: number; centerX: number; centerY: number } | null>(null)
  const [liveRotation, setLiveRotation]   = useState<number | null>(null)
  const [activeResize, setActiveResize]   = useState(false)
  const [imgOk, setImgOk]                 = useState(true)
  const [hovered, setHovered]             = useState(false)
  // Hover state for handles (to show size tooltip)
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle | null>(null)

  const prevKeyRef = useRef(renderKey)
  if (prevKeyRef.current !== renderKey) {
    prevKeyRef.current = renderKey
    setImgOk(true)
  }

  const imgSrc = `/api/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(element.id)}/element-png?v=${renderKey}`

  // ── Drag start ───────────────────────────────────────────────────────────────
  // For "move" mode, we DEFER preventDefault until the pointer actually moves
  // beyond DRAG_THRESHOLD_PX. This lets click/dblclick events bubble through
  // to inner renderers (Tiptap text/table) when the user just clicks without
  // dragging. For "resize" mode we activate drag immediately because the user
  // grabbed a resize handle — there's no ambiguity.
  const startInteraction = useCallback((
    e: React.PointerEvent,
    mode: "move" | "resize",
    handle?: ResizeHandle,
  ) => {
    e.stopPropagation()
    if (mode === "resize") e.preventDefault()
    const container = containerRef.current
    if (!container || !overlayRef.current) return
    const rect = container.getBoundingClientRect()
    dragState.current = {
      mode, handle,
      startX:         e.clientX,
      startY:         e.clientY,
      startLeftPct:   element.left_pct,
      startTopPct:    element.top_pct,
      startWidthPct:  element.width_pct,
      startHeightPct: element.height_pct,
      containerW:     rect.width,
      containerH:     rect.height,
      altHeld:        e.altKey,
      pointerId:      e.pointerId,
      captureTarget:  e.target as HTMLElement,
      pending:        mode === "move",   // resize commits immediately, move waits for movement
    }
    if (mode === "resize") {
      setActiveResize(true)
      // Resize commits immediately — capture pointer so we don't lose it during drag
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
    // For "move", DEFER pointer capture until movement crosses the threshold.
    // Capturing on pointerdown can suppress click/dblclick on inner editors.
  }, [element, containerRef])

  // ── Pointer move ─────────────────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current
    const el = overlayRef.current
    if (!ds || !el) return

    // Drag threshold: don't commit to a move drag until pointer has moved
    // at least DRAG_THRESHOLD_PX. Below that, this is a click — let click
    // events propagate to the inner renderer.
    if (ds.pending) {
      const movedPx = Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY)
      if (movedPx < DRAG_THRESHOLD_PX) return
      ds.pending = false
      e.preventDefault()   // now we're really dragging
      // Capture the pointer now that we're committed to a drag
      try { ds.captureTarget.setPointerCapture(ds.pointerId) } catch {}
    }

    const dxPct = (e.clientX - ds.startX) / ds.containerW * 100
    const dyPct = (e.clientY - ds.startY) / ds.containerH * 100

    let l = ds.startLeftPct
    let t = ds.startTopPct
    let w = ds.startWidthPct
    let h = ds.startHeightPct

    if (ds.mode === "move") {
      ds.altHeld = e.altKey
      l = Math.max(0, Math.min(100 - w, l + dxPct))
      t = Math.max(0, Math.min(100 - h, t + dyPct))

      // Google Slides-style snap: 5 screen pixels threshold, to edges+centers of other elements
      if (snapEnabled && !isMultiSelected) {
        const THRESH    = (5 / ds.containerW) * 100
        const elRight   = l + w
        const elCenterX = l + w / 2
        const elBottom  = t + h
        const elCenterY = t + h / 2

        let bestDx = THRESH + 1
        let bestDy = THRESH + 1

        const slideGuideX = [0, 50, 100]
        const slideGuideY = [0, 50, 100]
        for (const gx of slideGuideX) {
          for (const selfX of [l, elRight, elCenterX]) {
            const d = Math.abs(selfX - gx)
            if (d < THRESH && d < Math.abs(bestDx)) {
              bestDx = selfX === l ? gx - l : selfX === elRight ? gx - elRight : gx - elCenterX
            }
          }
        }
        for (const gy of slideGuideY) {
          for (const selfY of [t, elBottom, elCenterY]) {
            const d = Math.abs(selfY - gy)
            if (d < THRESH && d < Math.abs(bestDy)) {
              bestDy = selfY === t ? gy - t : selfY === elBottom ? gy - elBottom : gy - elCenterY
            }
          }
        }
        if (otherElements) {
          for (const other of otherElements) {
            const oL = other.left_pct, oT = other.top_pct
            const oR = oL + other.width_pct, oB = oT + other.height_pct
            const oCX = oL + other.width_pct / 2, oCY = oT + other.height_pct / 2
            for (const selfX of [l, elRight, elCenterX]) {
              for (const otherX of [oL, oR, oCX]) {
                const d = Math.abs(selfX - otherX)
                if (d < THRESH && d < Math.abs(bestDx)) {
                  bestDx = selfX === l ? otherX - l : selfX === elRight ? otherX - elRight : otherX - elCenterX
                }
              }
            }
            for (const selfY of [t, elBottom, elCenterY]) {
              for (const otherY of [oT, oB, oCY]) {
                const d = Math.abs(selfY - otherY)
                if (d < THRESH && d < Math.abs(bestDy)) {
                  bestDy = selfY === t ? otherY - t : selfY === elBottom ? otherY - elBottom : otherY - elCenterY
                }
              }
            }
          }
        }
        if (Math.abs(bestDx) <= THRESH) l = Math.max(0, Math.min(100 - w, l + bestDx))
        if (Math.abs(bestDy) <= THRESH) t = Math.max(0, Math.min(100 - h, t + bestDy))
      }

      // Shift+drag: constrain to horizontal or vertical axis
      if (e.shiftKey) {
        if (Math.abs(dxPct) > Math.abs(dyPct)) {
          t = ds.startTopPct
        } else {
          l = ds.startLeftPct
        }
      }
    } else {
      const dir = ds.handle!

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+resize: resize from center (symmetric) — Google Slides behavior on PC/Mac
        const startCX = ds.startLeftPct  + ds.startWidthPct  / 2
        const startCY = ds.startTopPct   + ds.startHeightPct / 2
        if (dir.includes("e") || dir.includes("w")) {
          const sign = dir.includes("e") ? 1 : -1
          const halfW = Math.max(0.5, ds.startWidthPct / 2 + sign * dxPct / 2)
          w = halfW * 2; l = Math.max(0, startCX - halfW)
        }
        if (dir.includes("s") || dir.includes("n")) {
          const sign = dir.includes("s") ? 1 : -1
          const halfH = Math.max(0.5, ds.startHeightPct / 2 + sign * dyPct / 2)
          h = halfH * 2; t = Math.max(0, startCY - halfH)
        }
      } else {
        if (dir.includes("e")) { w = Math.min(Math.max(1, ds.startWidthPct  + dxPct), 100 - l) }
        if (dir.includes("s")) { h = Math.min(Math.max(1, ds.startHeightPct + dyPct), 100 - t) }
        if (dir.includes("w")) {
          const newL = Math.max(0, Math.min(l + w - 1, l + dxPct))
          w = w + (l - newL); l = newL
        }
        if (dir.includes("n")) {
          const newT = Math.max(0, Math.min(t + h - 1, t + dyPct))
          h = h + (t - newT); t = newT
        }
      }

      // Shift+resize: lock aspect ratio — Google Slides does this with corner handles
      if (e.shiftKey && ds.startHeightPct > 0) {
        const ar = ds.startWidthPct / ds.startHeightPct
        if (dir.includes("e") || dir.includes("w")) {
          h = w / ar
        } else {
          w = h * ar
        }
      }
    }

    el.style.left   = `${l}%`
    el.style.top    = `${t}%`
    el.style.width  = `${w}%`
    el.style.height = `${h}%`

    if (onDragInfo && slideWidthIn > 0 && slideHeightIn > 0) {
      onDragInfo({
        x: parseFloat(((l / 100) * slideWidthIn).toFixed(2)),
        y: parseFloat(((t / 100) * slideHeightIn).toFixed(2)),
        w: parseFloat(((w / 100) * slideWidthIn).toFixed(2)),
        h: parseFloat(((h / 100) * slideHeightIn).toFixed(2)),
      })
    }

    // Smart guides during move
    if (ds.mode === "move" && onSnapLines) {
      const guides: SnapLine[] = []
      const GUIDE_THRESH = 0.8
      const cx = l + w / 2, cy = t + h / 2
      const r = l + w, b = t + h
      for (const xPos of [0, 50, 100]) {
        if ([l, cx, r].some((v) => Math.abs(v - xPos) < GUIDE_THRESH))
          guides.push({ type: "v", pos: xPos })
      }
      for (const yPos of [0, 50, 100]) {
        if ([t, cy, b].some((v) => Math.abs(v - yPos) < GUIDE_THRESH))
          guides.push({ type: "h", pos: yPos })
      }
      if (snapEnabled && otherElements) {
        for (const other of otherElements) {
          const oL = other.left_pct, oT = other.top_pct
          const oR = oL + other.width_pct, oB = oT + other.height_pct
          const oCX = oL + other.width_pct / 2, oCY = oT + other.height_pct / 2
          for (const otherX of [oL, oR, oCX]) {
            if ([l, cx, r].some((v) => Math.abs(v - otherX) < GUIDE_THRESH) &&
                !guides.some((g) => g.type === "v" && g.pos === otherX))
              guides.push({ type: "v", pos: otherX })
          }
          for (const otherY of [oT, oB, oCY]) {
            if ([t, cy, b].some((v) => Math.abs(v - otherY) < GUIDE_THRESH) &&
                !guides.some((g) => g.type === "h" && g.pos === otherY))
              guides.push({ type: "h", pos: otherY })
          }
        }
      }
      onSnapLines(guides)
    }
  }, [onSnapLines, snapEnabled, otherElements, onDragInfo, slideWidthIn, slideHeightIn, isMultiSelected])

  // ── Rotation ─────────────────────────────────────────────────────────────────
  const handleRotatePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = overlayRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top  + rect.height / 2
    rotDragStart.current = { clientX: e.clientX, clientY: e.clientY, startRot: element.rotation, centerX, centerY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [element.rotation])

  const handleRotatePointerMove = useCallback((e: React.PointerEvent) => {
    const rs = rotDragStart.current
    if (!rs) return
    const dx = e.clientX - rs.centerX
    const dy = e.clientY - rs.centerY
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90
    // Shift = snap to 15° increments (Google Slides behavior)
    const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10
    setLiveRotation(snapped)
  }, [])

  const handleRotatePointerUp = useCallback((e: React.PointerEvent) => {
    const rs = rotDragStart.current
    rotDragStart.current = null
    setLiveRotation(null)
    if (!rs || !onRotate) return
    const dx = e.clientX - rs.centerX
    const dy = e.clientY - rs.centerY
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90
    const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10
    onRotate(element.id, ((snapped % 360) + 360) % 360)
  }, [element.id, onRotate])

  // ── Pointer up ───────────────────────────────────────────────────────────────
  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    const ds = dragState.current
    const el = overlayRef.current
    if (!ds || !el) return
    dragState.current = null
    setActiveResize(false)
    onSnapLines?.([])
    onDragInfo?.(null)

    // If drag was never activated (pending threshold not exceeded), this was
    // a click — don't commit any geometry change. The inner renderer's click
    // handlers will fire normally.
    if (ds.pending) return

    const lPct = parseFloat(el.style.left)
    const tPct = parseFloat(el.style.top)
    const wPct = parseFloat(el.style.width)
    const hPct = parseFloat(el.style.height)

    const moved =
      Math.abs(lPct - ds.startLeftPct)   > 0.01 ||
      Math.abs(tPct - ds.startTopPct)    > 0.01 ||
      Math.abs(wPct - ds.startWidthPct)  > 0.01 ||
      Math.abs(hPct - ds.startHeightPct) > 0.01

    if (!moved) return

    const leftIn   = lPct / 100 * slideWidthIn
    const topIn    = tPct / 100 * slideHeightIn
    const widthIn  = wPct / 100 * slideWidthIn
    const heightIn = hPct / 100 * slideHeightIn

    if (ds.mode === "move" && isMultiSelected && onMultiMove) {
      const deltaLeftIn = (lPct - ds.startLeftPct) / 100 * slideWidthIn
      const deltaTopIn  = (tPct - ds.startTopPct)  / 100 * slideHeightIn
      onMultiMove(deltaLeftIn, deltaTopIn)
    } else if (ds.mode === "move" && ds.altHeld && onAltDuplicate) {
      el.style.left   = `${ds.startLeftPct}%`
      el.style.top    = `${ds.startTopPct}%`
      el.style.width  = `${ds.startWidthPct}%`
      el.style.height = `${ds.startHeightPct}%`
      onAltDuplicate(element.id, leftIn, topIn, widthIn, heightIn)
    } else {
      onCommit(element.id, leftIn, topIn, widthIn, heightIn)
    }
  }, [element.id, isMultiSelected, slideWidthIn, slideHeightIn, onCommit, onMultiMove, onAltDuplicate])

  const isLocked = element.locked
  const isHidden = element.hidden
  const rotation = liveRotation ?? element.rotation

  // ── Native renderer or fallback PNG ──────────────────────────────────────────
  const renderContent = () => {
    if (activeResize) {
      // During resize: show ghost outline instead of live content (prevents jarring)
      return (
        <div style={{
          width: "100%", height: "100%",
          background: GS_BLUE_ALPHA,
          border: `1px solid ${GS_BLUE}`,
          boxSizing: "border-box",
        }} />
      )
    }
    const NativeR = getRenderer(element.type)
    if (NativeR) {
      return (
        <ElementErrorBoundary elementId={element.id} label={element.label || element.name}>
          <NativeR element={element} docId={docId} slideN={slideN} renderKey={renderKey} selected={selected} />
        </ElementErrorBoundary>
      )
    }
    return imgOk ? (
      <img
        src={imgSrc}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", display: "block", objectFit: "fill", userSelect: "none", pointerEvents: "none" }}
        onError={() => setImgOk(false)}
        onLoad={() => setImgOk(true)}
      />
    ) : (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: `${GS_BLUE}18`, color: GS_BLUE, fontSize: 9, fontFamily: "monospace", opacity: 0.6,
      }}>
        {element.label}
      </div>
    )
  }

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        e.stopPropagation()
        if (!isLocked) onSelect(element.id, e.shiftKey)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // eslint-disable-next-line no-console
        console.log("[Percy] ElementOverlay dblclick", { id: element.id, type: element.type, selected, locked: isLocked })
        if (isLocked) return
        // Native edit types (Tiptap-backed): atomically select + signal edit.
        // Done synchronously here (not via React state in inner renderers) to
        // dodge the click1+click2 race where 'selected' hasn't propagated yet.
        if (NATIVE_EDIT_TYPES.has(element.type)) {
          if (!selected) onSelect(element.id, false)
          studioStore.setEditingElement(element.id)
          // eslint-disable-next-line no-console
          console.log("[Percy] setEditingElement called", element.id)
          return
        }
        // Legacy inline editor for non-native text-bearing types (BridgeFreeform etc.)
        if (onInlineEdit && TEXT_TYPES.has(element.type)) onInlineEdit(element.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLocked) onSelect(element.id)
        onContextMenu?.(element.id, e.clientX, e.clientY)
      }}
      title={!selected ? `${element.label || element.name}${isLocked ? " · locked" : ""}${isHidden ? " · hidden" : ""}` : undefined}
      data-element="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => { if (selected && !isLocked) startInteraction(e, "move") }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position:      "absolute",
        left:          `${element.left_pct}%`,
        top:           `${element.top_pct}%`,
        width:         `${element.width_pct}%`,
        height:        `${element.height_pct}%`,
        transform:     rotation ? `rotate(${rotation}deg)` : undefined,
        zIndex:        selected ? 9999 : element.z_index + 2000,
        boxSizing:     "border-box",
        cursor:        isLocked ? "not-allowed" : (selected ? "move" : "default"),
        overflow:      "visible",
        willChange:    "left, top, width, height, transform",
        // Google Slides: 1.5px blue on selection; 1px thin on hover (unselected)
        outline:       selected
          ? `1.5px solid ${GS_BLUE}`
          : hovered && !isLocked
            ? `1px solid ${GS_BLUE}`
            : "none",
        outlineOffset: "-0.5px",
        opacity:       isHidden ? 0.3 : 1,
      }}
    >
      {/* inner content — clipped to element bounds */}
      <div style={{
        position: "absolute", inset: 0,
        overflow: element.type === "BridgeConnector" ? "visible" : "hidden",
      }}>
        {renderContent()}
      </div>

      {/* Python connect badge */}
      {hasConnect && (
        <div title="Bound to a Python connect" style={{
          position: "absolute", top: 2, right: 2,
          background: "var(--champagne)", color: "#0a0a0a",
          fontSize: 9, fontWeight: 700, padding: "1px 4px",
          borderRadius: 2, pointerEvents: "none", zIndex: 10001,
          letterSpacing: "0.12em", textTransform: "uppercase",
        }}>
          PY
        </div>
      )}

      {/* Lock/hidden badges when not selected */}
      {!selected && (isLocked || isHidden) && (
        <div style={{
          position: "absolute", bottom: 2, right: 2,
          display: "flex", gap: 2, pointerEvents: "none", zIndex: 10001,
        }}>
          {isLocked && <span style={{ fontSize: 10, background: "rgba(0,0,0,0.45)", borderRadius: 3, padding: "1px 3px" }}>🔒</span>}
          {isHidden && <span style={{ fontSize: 10, background: "rgba(0,0,0,0.45)", borderRadius: 3, padding: "1px 3px" }}>👁</span>}
        </div>
      )}

      {/* Rotation indicator during rotate drag */}
      {liveRotation !== null && (
        <div style={{
          position: "absolute", top: -22, left: "50%", transform: "translateX(-50%)",
          background: "#202124", color: "#fff",
          fontSize: 11, fontWeight: 500, fontFamily: "Google Sans, system-ui, sans-serif",
          padding: "2px 6px", borderRadius: 3,
          pointerEvents: "none", zIndex: 10002, whiteSpace: "nowrap",
        }}>
          {((liveRotation % 360) + 360) % 360}°
        </div>
      )}

      {/* ── Rotation handle (Google Slides style) ── */}
      {selected && !isLocked && onRotate && (
        <>
          {/* Connecting line from element top-center to rotation handle */}
          <svg
            style={{
              position: "absolute",
              top: -(ROT_DIST + ROT_SIZE),
              left: "50%",
              transform: "translateX(-50%)",
              width: 1,
              height: ROT_DIST + ROT_SIZE,
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 10001,
            }}
          >
            <line x1="0.5" y1="0" x2="0.5" y2={ROT_DIST + ROT_SIZE}
              stroke={GS_BLUE} strokeWidth={1} />
          </svg>

          {/* Rotation circle handle */}
          <div
            onPointerDown={handleRotatePointerDown}
            onPointerMove={handleRotatePointerMove}
            onPointerUp={handleRotatePointerUp}
            title="Drag to rotate · Shift to snap 15°"
            style={{
              position:      "absolute",
              top:           -(ROT_DIST + ROT_SIZE),
              left:          "50%",
              transform:     "translateX(-50%)",
              width:         ROT_SIZE,
              height:        ROT_SIZE,
              background:    "#fff",
              border:        `1.5px solid ${GS_BLUE}`,
              borderRadius:  "50%",
              zIndex:        10002,
              pointerEvents: "all",
              cursor:        rotDragStart.current ? "grabbing" : "grab",
              boxShadow:     "0 1px 3px rgba(0,0,0,0.20)",
            }}
          />
        </>
      )}

      {/* ── Resize handles — Google Slides square style ── */}
      {selected && !isLocked && HANDLE_DIRS.map((dir) => (
        <div
          key={dir}
          onPointerDown={(e) => startInteraction(e, "resize", dir)}
          onMouseEnter={() => setHoveredHandle(dir)}
          onMouseLeave={() => setHoveredHandle(null)}
          style={{
            position:      "absolute",
            width:         HANDLE_SIZE,
            height:        HANDLE_SIZE,
            background:    "#fff",
            border:        `1.5px solid ${GS_BLUE}`,
            borderRadius:  1,          // Google uses nearly-square (1px corner radius)
            zIndex:        10001,
            pointerEvents: "all",
            cursor:        HANDLE_CURSOR[dir],
            boxShadow:     hoveredHandle === dir
              ? `0 0 0 2px ${GS_BLUE}40, 0 1px 4px rgba(0,0,0,0.22)`
              : "0 1px 3px rgba(0,0,0,0.16)",
            transition:    "box-shadow 80ms ease",
            ...HANDLE_STYLE[dir],
          }}
        />
      ))}
    </div>
  )
}
