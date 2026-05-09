import { useState, useRef, useCallback, useEffect } from "react"
import getStroke from "perfect-freehand"
import type { FreeformPathCmd } from "../../lib/studioApi"

interface Props {
  mode: "pen" | "polygon"
  slideWidthIn: number
  slideHeightIn: number
  onFinish: (commands: FreeformPathCmd[]) => void
  onCancel: () => void
}

// Convert percent coords (0–100) → slide inches
function pctToIn(x_pct: number, y_pct: number, sw: number, sh: number): [number, number] {
  return [x_pct / 100 * sw, y_pct / 100 * sh]
}

// perfect-freehand stroke path string from points array
function strokeToPath(stroke: [number, number][]): string {
  if (stroke.length < 2) return ""
  const d: string[] = [`M ${stroke[0][0]} ${stroke[0][1]}`]
  for (let i = 1; i < stroke.length; i++) {
    d.push(`L ${stroke[i][0]} ${stroke[i][1]}`)
  }
  d.push("Z")
  return d.join(" ")
}

export default function FreeformDrawOverlay({ mode, slideWidthIn, slideHeightIn, onFinish, onCancel }: Props) {
  // Pen mode state
  const [penPts, setPenPts] = useState<[number, number, number][]>([])
  const penDrawing = useRef(false)

  // Polygon mode state
  const [polyPts, setPolyPts] = useState<[number, number][]>([])
  const [hover, setHover] = useState<[number, number] | null>(null)
  // Track last click time for dbl-click detection on touch devices
  const lastClickRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // Keyboard: Escape cancels, Enter/Return closes polygon
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return }
      if (e.key === "Enter" || e.key === "Return") {
        if (mode === "polygon" && polyPts.length >= 3) {
          finishPolygon(polyPts)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [mode, polyPts, onCancel])

  const getSVGPct = useCallback((e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / rect.width) * 100,
      ((e.clientY - rect.top) / rect.height) * 100,
    ]
  }, [])

  // ── Pen mode ────────────────────────────────────────────────────────────────

  const onPenPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== "pen") return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = getSVGPct(e)
    penDrawing.current = true
    setPenPts([[x, y, e.pressure || 0.5]])
  }, [mode, getSVGPct])

  const onPenPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!penDrawing.current || mode !== "pen") return
    const [x, y] = getSVGPct(e)
    setPenPts(pts => [...pts, [x, y, e.pressure || 0.5]])
  }, [mode, getSVGPct])

  const onPenPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!penDrawing.current || mode !== "pen") return
    penDrawing.current = false
    const [x, y] = getSVGPct(e)
    const final = [...penPts, [x, y, 0] as [number, number, number]]
    if (final.length < 2) { onCancel(); return }

    // Downsample: keep every 3rd point to avoid enormous command lists
    const sampled: [number, number, number][] = []
    for (let i = 0; i < final.length; i++) {
      if (i === 0 || i === final.length - 1 || i % 3 === 0) sampled.push(final[i])
    }
    const commands: FreeformPathCmd[] = [
      { cmd: "M", pts: [pctToIn(sampled[0][0], sampled[0][1], slideWidthIn, slideHeightIn)] },
      ...sampled.slice(1).map(pt => ({ cmd: "L" as const, pts: [pctToIn(pt[0], pt[1], slideWidthIn, slideHeightIn)] })),
    ]
    onFinish(commands)
  }, [mode, penPts, slideWidthIn, slideHeightIn, onFinish, onCancel, getSVGPct])

  // ── Polygon mode ─────────────────────────────────────────────────────────────

  const finishPolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 2) { onCancel(); return }
    const commands: FreeformPathCmd[] = [
      { cmd: "M", pts: [pctToIn(pts[0][0], pts[0][1], slideWidthIn, slideHeightIn)] },
      ...pts.slice(1).map(pt => ({ cmd: "L" as const, pts: [pctToIn(pt[0], pt[1], slideWidthIn, slideHeightIn)] })),
      { cmd: "Z", pts: [] },
    ]
    onFinish(commands)
  }, [slideWidthIn, slideHeightIn, onFinish, onCancel])

  const onPolyClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== "polygon") return
    e.preventDefault()
    const [x, y] = getSVGPct(e)
    const now = Date.now()
    const last = lastClickRef.current
    // Detect double-click (within 350 ms and 3% of same position)
    if (last && now - last.t < 350 && Math.abs(x - last.x) < 3 && Math.abs(y - last.y) < 3) {
      lastClickRef.current = null
      const cur = polyPts
      if (cur.length >= 2) finishPolygon(cur)
      return
    }
    lastClickRef.current = { x, y, t: now }
    setPolyPts(pts => [...pts, [x, y]])
  }, [mode, polyPts, getSVGPct, finishPolygon])

  const onPolyMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== "polygon") return
    const [x, y] = getSVGPct(e)
    setHover([x, y])
  }, [mode, getSVGPct])

  // ── Render pen stroke via perfect-freehand ────────────────────────────────
  let penPath = ""
  if (mode === "pen" && penPts.length > 1) {
    const raw = getStroke(penPts.map(([x, y, p]) => [x, y, p]), {
      size: 1.5,
      thinning: 0.4,
      smoothing: 0.5,
      streamline: 0.5,
    }) as [number, number][]
    penPath = strokeToPath(raw)
  }

  // Close-point indicator (clicking first anchor closes polygon)
  const canClose = mode === "polygon" && polyPts.length >= 3

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ zIndex: 25000, cursor: "crosshair", touchAction: "none" }}
      onPointerDown={mode === "pen" ? onPenPointerDown : undefined}
      onPointerMove={mode === "pen" ? onPenPointerMove : undefined}
      onPointerUp={mode === "pen" ? onPenPointerUp : undefined}
      onClick={mode === "polygon" ? onPolyClick : undefined}
      onMouseMove={mode === "polygon" ? onPolyMouseMove : undefined}
      onMouseLeave={() => setHover(null)}
    >
      {/* semi-transparent overlay so the slide is still visible */}
      <rect x="0" y="0" width="100" height="100" fill="rgba(99,102,241,0.04)" />

      {/* Pen stroke preview */}
      {penPath && (
        <path d={penPath} fill="rgba(68,114,196,0.85)" stroke="none" />
      )}

      {/* Polygon edges so far */}
      {mode === "polygon" && polyPts.length > 1 && (
        <polyline
          points={polyPts.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="rgba(68,114,196,0.15)"
          stroke="#4472C4"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Preview edge to cursor */}
      {mode === "polygon" && polyPts.length >= 1 && hover && (
        <line
          x1={polyPts[polyPts.length - 1][0]} y1={polyPts[polyPts.length - 1][1]}
          x2={hover[0]} y2={hover[1]}
          stroke="#4472C4" strokeWidth="0.5" strokeDasharray="2 1.5"
          vectorEffect="non-scaling-stroke" opacity="0.7"
        />
      )}

      {/* Anchor points */}
      {mode === "polygon" && polyPts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y} r="0.9"
          fill="white" stroke="#4472C4" strokeWidth="0.35"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* First anchor — close indicator when polygon has 3+ points */}
      {canClose && polyPts.length > 0 && (
        <circle
          cx={polyPts[0][0]} cy={polyPts[0][1]} r="1.6"
          fill="rgba(68,114,196,0.25)" stroke="#4472C4" strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Hint text */}
      <text
        x="50" y="99"
        textAnchor="middle" fontSize="1.5"
        fill="rgba(68,114,196,0.7)"
        style={{ fontFamily: "system-ui, sans-serif", pointerEvents: "none" }}
      >
        {mode === "pen"
          ? "Draw — release to finish · Esc to cancel"
          : polyPts.length < 2
            ? "Click to place anchors · Esc to cancel"
            : "Double-click or Enter to close · Esc to cancel"}
      </text>
    </svg>
  )
}
