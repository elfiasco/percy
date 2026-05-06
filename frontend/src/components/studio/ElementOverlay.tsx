import { useRef, useCallback, useState, type CSSProperties } from "react"
import type { StudioElement, ResizeHandle } from "../../lib/studioTypes"
import { useCanvas } from "./CanvasContext"
import { getRenderer } from "./renderers/RendererRegistry"

const TYPE_COLOR: Record<string, string> = {
  BridgeShape:     "#6366F1",
  BridgeText:      "#22C55E",
  BridgeChart:     "#F59E0B",
  BridgeTable:     "#A855F7",
  BridgeImage:     "#EC4899",
  BridgeFreeform:  "#06B6D4",
  BridgeConnector: "#94A3B8",
  BridgeGroup:     "#64748B",
}

const HANDLE_DIRS: ResizeHandle[] = ["nw","n","ne","w","e","sw","s","se"]

const HANDLE_STYLE: Record<ResizeHandle, CSSProperties> = {
  nw: { top: -5, left: -5,                                           cursor: "nw-resize" },
  n:  { top: -5, left: "50%", transform: "translateX(-50%)",         cursor: "n-resize"  },
  ne: { top: -5, right: -5,                                          cursor: "ne-resize" },
  w:  { top: "50%", left: -5, transform: "translateY(-50%)",         cursor: "w-resize"  },
  e:  { top: "50%", right: -5, transform: "translateY(-50%)",        cursor: "e-resize"  },
  sw: { bottom: -5, left: -5,                                        cursor: "sw-resize" },
  s:  { bottom: -5, left: "50%", transform: "translateX(-50%)",      cursor: "s-resize"  },
  se: { bottom: -5, right: -5,                                       cursor: "se-resize" },
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
}

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
  hasConnect?: boolean   // show a corner badge if element has a Python connect attached
}

const TEXT_TYPES = new Set(["BridgeText", "BridgeShape"])

export default function ElementOverlay({
  element, selected, isMultiSelected, snapEnabled, otherElements, docId, slideN, renderKey, onSelect, onCommit, onMultiMove, onRotate, onSnapLines, onInlineEdit, onContextMenu, onDragInfo, hasConnect,
}: Props) {
  const { containerRef, slideWidthIn, slideHeightIn } = useCanvas()
  const overlayRef   = useRef<HTMLDivElement>(null)
  const dragState    = useRef<DragState | null>(null)
  const rotDragStart = useRef<{ clientX: number; clientY: number; startRot: number; centerX: number; centerY: number } | null>(null)
  const [liveRotation, setLiveRotation] = useState<number | null>(null)
  const [activeResize, setActiveResize] = useState(false)
  const color      = TYPE_COLOR[element.type] ?? "#6366F1"
  const [imgOk, setImgOk] = useState(true)
  // For text/shape elements, stretch doesn't make visual sense — use contain
  const isTextLike = element.type === "BridgeText" || element.type === "BridgeShape"

  // Reset img error state when renderKey changes
  const prevKeyRef = useRef(renderKey)
  if (prevKeyRef.current !== renderKey) {
    prevKeyRef.current = renderKey
    setImgOk(true)
  }

  const imgSrc = `/api/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(element.id)}/element-png?v=${renderKey}`

  const startInteraction = useCallback((
    e: React.PointerEvent,
    mode: "move" | "resize",
    handle?: ResizeHandle,
  ) => {
    e.preventDefault()
    e.stopPropagation()

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
    }
    if (mode === "resize") setActiveResize(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [element, containerRef])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current
    const el = overlayRef.current
    if (!ds || !el) return

    const dxPct = (e.clientX - ds.startX) / ds.containerW * 100
    const dyPct = (e.clientY - ds.startY) / ds.containerH * 100

    let l = ds.startLeftPct
    let t = ds.startTopPct
    let w = ds.startWidthPct
    let h = ds.startHeightPct

    if (ds.mode === "move") {
      l = Math.max(0, Math.min(100 - w, l + dxPct))
      t = Math.max(0, Math.min(100 - h, t + dyPct))

      // snap to other element edges/centers + slide guides when snap is enabled
      if (snapEnabled && !isMultiSelected) {
        const THRESH = 1.0  // percent
        const elRight  = l + w
        const elCenterX = l + w / 2
        const elBottom = t + h
        const elCenterY = t + h / 2

        let bestDx = THRESH + 1
        let bestDy = THRESH + 1

        // Snap to slide center lines and thirds
        const slideGuideX = [50, 100/3, 200/3]
        const slideGuideY = [50, 100/3, 200/3]
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

        if (otherElements && otherElements.length > 0) {
          for (const other of otherElements) {
            const oL = other.left_pct, oT = other.top_pct
            const oR = oL + other.width_pct, oB = oT + other.height_pct
            const oCX = oL + other.width_pct / 2, oCY = oT + other.height_pct / 2

            // X axis: snap left/right/center to other's left/right/center
            for (const selfX of [l, elRight, elCenterX]) {
              for (const otherX of [oL, oR, oCX]) {
                const d = Math.abs(selfX - otherX)
                if (d < THRESH && d < Math.abs(bestDx)) {
                  bestDx = selfX === l ? otherX - l : selfX === elRight ? otherX - elRight : otherX - elCenterX
                }
              }
            }

            // Y axis
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
    } else {
      const dir = ds.handle!
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
      // Shift-resize: lock aspect ratio (use width as the leading axis)
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

    // Emit drag info for position HUD
    if (onDragInfo && slideWidthIn > 0 && slideHeightIn > 0) {
      onDragInfo({
        x: parseFloat(((l / 100) * slideWidthIn).toFixed(2)),
        y: parseFloat(((t / 100) * slideHeightIn).toFixed(2)),
        w: parseFloat(((w / 100) * slideWidthIn).toFixed(2)),
        h: parseFloat(((h / 100) * slideHeightIn).toFixed(2)),
      })
    }

    // Compute snap guide lines when moving
    if (ds.mode === "move" && onSnapLines) {
      const guides: SnapLine[] = []
      const GUIDE_THRESH = 0.8
      const cx = l + w / 2, cy = t + h / 2
      const r = l + w, b = t + h
      // Slide edge/center/thirds guides
      for (const xPos of [0, 100/3, 50, 200/3, 100]) {
        for (const self of [l, cx, r]) {
          if (Math.abs(self - xPos) < GUIDE_THRESH) { guides.push({ type: "v", pos: xPos }); break }
        }
      }
      for (const yPos of [0, 100/3, 50, 200/3, 100]) {
        for (const self of [t, cy, b]) {
          if (Math.abs(self - yPos) < GUIDE_THRESH) { guides.push({ type: "h", pos: yPos }); break }
        }
      }
      // Element-to-element guides (when snap is on)
      if (snapEnabled && otherElements) {
        for (const other of otherElements) {
          const oL = other.left_pct, oT = other.top_pct
          const oR = oL + other.width_pct, oB = oT + other.height_pct
          const oCX = oL + other.width_pct / 2, oCY = oT + other.height_pct / 2
          for (const otherX of [oL, oR, oCX]) {
            for (const self of [l, cx, r]) {
              if (Math.abs(self - otherX) < GUIDE_THRESH) {
                if (!guides.some((g) => g.type === "v" && g.pos === otherX))
                  guides.push({ type: "v", pos: otherX })
                break
              }
            }
          }
          for (const otherY of [oT, oB, oCY]) {
            for (const self of [t, cy, b]) {
              if (Math.abs(self - otherY) < GUIDE_THRESH) {
                if (!guides.some((g) => g.type === "h" && g.pos === otherY))
                  guides.push({ type: "h", pos: otherY })
                break
              }
            }
          }
        }
      }
      onSnapLines(guides)
    }
  }, [onSnapLines])

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
    // snap to 15° increments when shift held
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

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    const ds = dragState.current
    const el = overlayRef.current
    if (!ds || !el) return
    dragState.current = null
    setActiveResize(false)
    onSnapLines?.([])
    onDragInfo?.(null)

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

    if (ds.mode === "move" && isMultiSelected && onMultiMove) {
      const deltaLeftIn  = (lPct - ds.startLeftPct)  / 100 * slideWidthIn
      const deltaTopIn   = (tPct - ds.startTopPct)   / 100 * slideHeightIn
      onMultiMove(deltaLeftIn, deltaTopIn)
    } else {
      onCommit(
        element.id,
        lPct / 100 * slideWidthIn,
        tPct / 100 * slideHeightIn,
        wPct / 100 * slideWidthIn,
        hPct / 100 * slideHeightIn,
      )
    }
  }, [element.id, isMultiSelected, slideWidthIn, slideHeightIn, onCommit, onMultiMove])

  const isLocked = element.locked
  const isHidden = element.hidden

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        e.stopPropagation()
        if (!isLocked) onSelect(element.id, e.shiftKey)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // BridgeText and BridgeShape both render natively now — their own
        // click handlers drive edit mode (Tiptap), so we skip the legacy
        // textarea path entirely for those types.
        if (element.type === "BridgeText" || element.type === "BridgeShape") return
        if (!isLocked && onInlineEdit && TEXT_TYPES.has(element.type)) {
          onInlineEdit(element.id)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLocked) onSelect(element.id)
        onContextMenu?.(element.id, e.clientX, e.clientY)
      }}
      title={!selected ? `${element.label || element.name} (${element.type.replace("Bridge", "")})${element.text_preview ? `\n"${element.text_preview}"` : ""}${isLocked ? " · locked" : ""}${isHidden ? " · hidden" : ""}` : undefined}
      data-element="true"
      onPointerDown={(e) => { if (selected && !isLocked) startInteraction(e, "move") }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position:      "absolute",
        left:          `${element.left_pct}%`,
        top:           `${element.top_pct}%`,
        width:         `${element.width_pct}%`,
        height:        `${element.height_pct}%`,
        transform:     (liveRotation ?? element.rotation) ? `rotate(${liveRotation ?? element.rotation}deg)` : undefined,
        // Offset z-index by +2000 so PowerPoint background placeholders (which use
        // large negative z-indices in the Bridge model, e.g. -1000) still render
        // above the slide background div. Selected stays on top via 9999.
        zIndex:        selected ? 9999 : element.z_index + 2000,
        boxSizing:     "border-box",
        cursor:        isLocked ? "not-allowed" : (selected ? "move" : "pointer"),
        overflow:      "visible",
        willChange:    "left, top, width, height, transform",
        outline:       selected ? `2px solid ${color}` : "none",
        outlineOffset: "-1px",
        opacity:       isHidden ? 0.25 : 1,
      }}
    >
      {/* inner content — clipped to element bounds (except connectors, whose
         arrowheads can extend past the bbox) */}
      <div style={{
        position: "absolute", inset: 0,
        overflow: element.type === "BridgeConnector" ? "visible" : "hidden",
      }}>
        {/* During active resize of text/shape, hide image and show a dashed placeholder so text doesn't stretch */}
        {isTextLike && activeResize ? (
          <div
            style={{
              width: "100%", height: "100%",
              background: `${color}10`,
              border: `1.5px dashed ${color}60`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, color, fontFamily: "monospace", opacity: 0.7,
              boxSizing: "border-box",
            }}
          >
            {element.label}
          </div>
        ) : (() => {
          // Native renderer (charts, future tables/connectors): registered components draw
          // their own DOM/SVG using typed Bridge data; the PNG fallback is skipped.
          const NativeR = getRenderer(element.type)
          if (NativeR) {
            return (
              <NativeR
                element={element}
                docId={docId}
                slideN={slideN}
                renderKey={renderKey}
                selected={selected}
              />
            )
          }
          return imgOk ? (
            <img
              src={imgSrc}
              alt=""
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                display: "block",
                objectFit: "fill",
                userSelect: "none",
                pointerEvents: "none",
              }}
              onError={() => setImgOk(false)}
              onLoad={() => setImgOk(true)}
            />
          ) : (
            <div
              style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `${color}22`, color, fontSize: 9, fontFamily: "monospace", opacity: 0.5,
              }}
            >
              {element.label}
            </div>
          )
        })()}
      </div>

      {/* connect badge — visible when an element has a Python binding (champagne) */}
      {hasConnect && (
        <div
          title="Bound to a Python connect"
          style={{
            position: "absolute",
            top: 2, right: 2,
            background: "var(--champagne)",
            color: "#0a0a0a",
            fontSize: 9,
            fontWeight: 600,
            padding: "1px 5px",
            borderRadius: 0,                    // sharp corners — calling-card style
            pointerEvents: "none",
            zIndex: 10001,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          PY
        </div>
      )}

      {/* lock/hidden badges — always visible on non-selected elements */}
      {!selected && (isLocked || isHidden) && (
        <div
          style={{
            position: "absolute", bottom: 2, right: 2,
            display: "flex", gap: 2,
            pointerEvents: "none",
            zIndex: 10001,
          }}
        >
          {isLocked && (
            <span style={{ fontSize: 10, lineHeight: 1, background: "rgba(0,0,0,0.55)", borderRadius: 3, padding: "1px 3px" }}>
              🔒
            </span>
          )}
          {isHidden && (
            <span style={{ fontSize: 10, lineHeight: 1, background: "rgba(0,0,0,0.55)", borderRadius: 3, padding: "1px 3px" }}>
              👁
            </span>
          )}
        </div>
      )}

      {/* type label badge — selected only */}
      {selected && (
        <div
          style={{
            position: "absolute", top: -20, left: 0,
            background: color, color: "#fff",
            fontSize: 10, fontFamily: "monospace",
            padding: "0 4px", borderRadius: "3px 3px 0 0",
            lineHeight: "20px", whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 10002,
          }}
        >
          {element.label}{element.name !== element.id ? ` · ${element.name}` : ""}
          {isLocked && " 🔒"}
          {isHidden && " 👁"}
          {liveRotation !== null && ` ${liveRotation.toFixed(0)}°`}
        </div>
      )}

      {/* rotate handle — circle above top-center edge */}
      {selected && onRotate && (
        <div
          onPointerDown={handleRotatePointerDown}
          onPointerMove={handleRotatePointerMove}
          onPointerUp={handleRotatePointerUp}
          title="Drag to rotate (Shift = snap 15°)"
          style={{
            position:      "absolute",
            top:           -32,
            left:          "50%",
            transform:     "translateX(-50%)",
            width:         14,
            height:        14,
            background:    "#fff",
            border:        `2px solid ${color}`,
            borderRadius:  "50%",
            zIndex:        10002,
            pointerEvents: "all",
            cursor:        "grab",
            display:       "flex",
            alignItems:    "center",
            justifyContent:"center",
            fontSize:      8,
            userSelect:    "none",
          }}
        >
          ↻
        </div>
      )}

      {/* resize handles — selected and not locked */}
      {selected && !isLocked && HANDLE_DIRS.map((dir) => (
        <div
          key={dir}
          onPointerDown={(e) => startInteraction(e, "resize", dir)}
          style={{
            position:      "absolute",
            width:         8,
            height:        8,
            background:    "#fff",
            border:        `2px solid ${color}`,
            borderRadius:  2,
            zIndex:        10001,
            pointerEvents: "all",
            ...HANDLE_STYLE[dir],
          }}
        />
      ))}
    </div>
  )
}
