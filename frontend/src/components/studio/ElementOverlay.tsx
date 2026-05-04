import { useRef, useCallback, type CSSProperties } from "react"
import type { StudioElement, ResizeHandle } from "../../lib/studioTypes"
import { useCanvas } from "./CanvasContext"

// ── element type → border color ──────────────────────────────────────────────
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
  nw: { top: -4, left: -4,          cursor: "nw-resize" },
  n:  { top: -4, left: "50%", transform: "translateX(-50%)", cursor: "n-resize" },
  ne: { top: -4, right: -4,         cursor: "ne-resize" },
  w:  { top: "50%", left: -4, transform: "translateY(-50%)", cursor: "w-resize" },
  e:  { top: "50%", right: -4, transform: "translateY(-50%)", cursor: "e-resize" },
  sw: { bottom: -4, left: -4,       cursor: "sw-resize" },
  s:  { bottom: -4, left: "50%", transform: "translateX(-50%)", cursor: "s-resize" },
  se: { bottom: -4, right: -4,      cursor: "se-resize" },
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
  onSelect: (id: string) => void
  onCommit: (id: string, leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
}

export default function ElementOverlay({ element, selected, onSelect, onCommit }: Props) {
  const { containerRef, slideWidthIn, slideHeightIn } = useCanvas()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragState  = useRef<DragState | null>(null)
  const color      = TYPE_COLOR[element.type] ?? "#6366F1"

  // ── drag start (move or resize) ──────────────────────────────────────────
  const startInteraction = useCallback((
    e: React.PointerEvent,
    mode: "move" | "resize",
    handle?: ResizeHandle,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(element.id)

    const container = containerRef.current
    if (!container || !overlayRef.current) return
    const rect = container.getBoundingClientRect()

    dragState.current = {
      mode, handle,
      startX:          e.clientX,
      startY:          e.clientY,
      startLeftPct:    element.left_pct,
      startTopPct:     element.top_pct,
      startWidthPct:   element.width_pct,
      startHeightPct:  element.height_pct,
      containerW:      rect.width,
      containerH:      rect.height,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [element, containerRef, onSelect])

  // ── pointer move — direct DOM update, zero React overhead ────────────────
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
      if (dir.includes("e")) {
        w = Math.max(1, ds.startWidthPct + dxPct)
        w = Math.min(w, 100 - l)
      }
      if (dir.includes("s")) {
        h = Math.max(1, ds.startHeightPct + dyPct)
        h = Math.min(h, 100 - t)
      }
      if (dir.includes("w")) {
        const newL = Math.max(0, Math.min(l + w - 1, l + dxPct))
        w = w + (l - newL)
        l = newL
      }
      if (dir.includes("n")) {
        const newT = Math.max(0, Math.min(t + h - 1, t + dyPct))
        h = h + (t - newT)
        t = newT
      }
    }

    el.style.left   = `${l}%`
    el.style.top    = `${t}%`
    el.style.width  = `${w}%`
    el.style.height = `${h}%`
  }, [])

  // ── pointer up — commit final position ───────────────────────────────────
  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    const ds = dragState.current
    const el = overlayRef.current
    if (!ds || !el) return
    dragState.current = null

    const lPct = parseFloat(el.style.left)
    const tPct = parseFloat(el.style.top)
    const wPct = parseFloat(el.style.width)
    const hPct = parseFloat(el.style.height)

    const leftIn   = lPct / 100 * slideWidthIn
    const topIn    = tPct / 100 * slideHeightIn
    const widthIn  = wPct / 100 * slideWidthIn
    const heightIn = hPct / 100 * slideHeightIn

    onCommit(element.id, leftIn, topIn, widthIn, heightIn)
  }, [element.id, slideWidthIn, slideHeightIn, onCommit])

  const borderWidth = selected ? 2 : 1
  const opacity     = selected ? 1 : 0

  return (
    <div
      ref={overlayRef}
      onPointerDown={(e) => startInteraction(e, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position:   "absolute",
        left:       `${element.left_pct}%`,
        top:        `${element.top_pct}%`,
        width:      `${element.width_pct}%`,
        height:     `${element.height_pct}%`,
        transform:  element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        zIndex:     selected ? 9999 : element.z_index,
        boxSizing:  "border-box",
        cursor:     "move",
        outline:    `${borderWidth}px solid ${color}`,
        outlineOffset: "-1px",
        willChange: "left, top, width, height",
      }}
      className="group"
    >
      {/* hover highlight when not selected */}
      {!selected && (
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ outline: `1px solid ${color}`, outlineOffset: "-1px" }}
        />
      )}

      {/* element type badge — top left */}
      {selected && (
        <div
          className="absolute -top-5 left-0 text-[10px] font-mono px-1 rounded-t leading-5 whitespace-nowrap"
          style={{ background: color, color: "#fff", pointerEvents: "none" }}
        >
          {element.label}
          {element.name !== element.id ? ` · ${element.name}` : ""}
        </div>
      )}

      {/* resize handles — only when selected */}
      {selected && HANDLE_DIRS.map((dir) => (
        <div
          key={dir}
          onPointerDown={(e) => startInteraction(e, "resize", dir)}
          style={{
            position:  "absolute",
            width:     8,
            height:    8,
            background: "#fff",
            border:    `2px solid ${color}`,
            borderRadius: 2,
            zIndex:    10001,
            pointerEvents: "all",
            ...HANDLE_STYLE[dir],
          }}
        />
      ))}

      {/* invisible fill to catch pointer events inside the element */}
      <div className="absolute inset-0" style={{ opacity }} />
    </div>
  )
}
