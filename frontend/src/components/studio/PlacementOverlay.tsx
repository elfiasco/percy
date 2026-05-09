import { useState, useRef, useCallback, useEffect } from "react"

interface Props {
  slideWidthIn: number
  slideHeightIn: number
  onPlace: (leftIn: number, topIn: number, widthIn: number, heightIn: number) => void
  onCancel: () => void
}

export default function PlacementOverlay({ slideWidthIn, slideHeightIn, onPlace, onCancel }: Props) {
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onCancel])

  const getPct = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / rect.width) * 100,
      ((e.clientY - rect.top) / rect.height) * 100,
    ]
  }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = getPct(e)
    dragStart.current = { x, y }
    setPreview(null)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    const [cx, cy] = getPct(e)
    const { x, y } = dragStart.current
    setPreview({
      x: Math.min(x, cx), y: Math.min(y, cy),
      w: Math.abs(cx - x), h: Math.abs(cy - y),
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return

    const [cx, cy] = getPct(e)
    const rx = Math.min(start.x, cx), ry = Math.min(start.y, cy)
    const rw = Math.abs(cx - start.x), rh = Math.abs(cy - start.y)
    setPreview(null)

    if (rw < 1 && rh < 1) {
      // Click without drag → place default 3×2 in centered at click
      const clickXIn = (start.x / 100) * slideWidthIn
      const clickYIn = (start.y / 100) * slideHeightIn
      const W = 3.0, H = 2.0
      onPlace(Math.max(0, clickXIn - W / 2), Math.max(0, clickYIn - H / 2), W, H)
    } else {
      const leftIn = (rx / 100) * slideWidthIn
      const topIn  = (ry / 100) * slideHeightIn
      const wIn    = (rw / 100) * slideWidthIn
      const hIn    = (rh / 100) * slideHeightIn
      onPlace(leftIn, topIn, Math.max(0.25, wIn), Math.max(0.25, hIn))
    }
  }, [slideWidthIn, slideHeightIn, onPlace])

  return (
    <div
      className="absolute inset-0"
      style={{ zIndex: 25000, cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* drag preview rect */}
      {preview && preview.w > 0.3 && preview.h > 0.3 && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${preview.x}%`, top: `${preview.y}%`,
            width: `${preview.w}%`, height: `${preview.h}%`,
            border: "2px dashed rgba(68,114,196,0.9)",
            background: "rgba(68,114,196,0.08)",
            boxSizing: "border-box",
          }}
        />
      )}
      {/* instruction overlay at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 flex justify-center pb-1 pointer-events-none"
        style={{ zIndex: 1 }}
      >
        <span className="text-[10px] px-2 py-0.5 rounded"
          style={{ background: "rgba(68,114,196,0.85)", color: "white" }}>
          Drag to place · Click for default size · Esc to cancel
        </span>
      </div>
    </div>
  )
}
