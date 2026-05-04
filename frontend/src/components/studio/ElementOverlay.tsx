import { useRef, useCallback, useState, type CSSProperties } from "react"
import type { StudioElement, ResizeHandle } from "../../lib/studioTypes"
import { useCanvas } from "./CanvasContext"

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

interface Props {
  element: StudioElement
  selected: boolean
  docId: string
  slideN: number
  renderKey: number
  onSelect: (id: string, shiftKey?: boolean) => void
  onCommit: (id: string, leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  onRotate?: (id: string, rotation: number) => void
}

export default function ElementOverlay({
  element, selected, docId, slideN, renderKey, onSelect, onCommit, onRotate,
}: Props) {
  const { containerRef, slideWidthIn, slideHeightIn } = useCanvas()
  const overlayRef   = useRef<HTMLDivElement>(null)
  const dragState    = useRef<DragState | null>(null)
  const rotDragStart = useRef<{ clientX: number; clientY: number; startRot: number; centerX: number; centerY: number } | null>(null)
  const [liveRotation, setLiveRotation] = useState<number | null>(null)
  const color      = TYPE_COLOR[element.type] ?? "#6366F1"
  const [imgOk, setImgOk] = useState(true)

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
    }

    el.style.left   = `${l}%`
    el.style.top    = `${t}%`
    el.style.width  = `${w}%`
    el.style.height = `${h}%`
  }, [])

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

    onCommit(
      element.id,
      lPct / 100 * slideWidthIn,
      tPct / 100 * slideHeightIn,
      wPct / 100 * slideWidthIn,
      hPct / 100 * slideHeightIn,
    )
  }, [element.id, slideWidthIn, slideHeightIn, onCommit])

  const isLocked = element.locked
  const isHidden = element.hidden

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        e.stopPropagation()
        if (!isLocked) onSelect(element.id, e.shiftKey)
      }}
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
        zIndex:        selected ? 9999 : element.z_index,
        boxSizing:     "border-box",
        cursor:        isLocked ? "not-allowed" : (selected ? "move" : "pointer"),
        overflow:      "visible",
        willChange:    "left, top, width, height, transform",
        outline:       selected ? `2px solid ${color}` : "none",
        outlineOffset: "-1px",
        opacity:       isHidden ? 0.25 : 1,
      }}
    >
      {/* inner content — clipped to element bounds */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {imgOk ? (
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
        )}
      </div>

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
