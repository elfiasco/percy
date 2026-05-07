import { useEffect, useRef, useState } from "react"
import { getAwareness } from "../../lib/collab/awareness"
import type { YjsRoom } from "../../lib/collab/yjsRoom"

/**
 * LiveCursorLayer — Figma/Multiplayer-style live mouse cursors. One colored
 * arrow + name pill per remote user, rAF-interpolated between awareness
 * updates so motion stays buttery even at low update rates.
 *
 * Coordinates arrive as percent of slide bounds, so the same code works at
 * any zoom level — the layer is rendered as a child of the slide wrapper
 * and uses `left: x%; top: y%`.
 *
 * Accepts `room` as a prop so the awareness subscription re-establishes
 * whenever the room becomes available (the collab context is set async).
 */

interface RemotePointer {
  userId:  string
  name:    string
  color:   string
  /** Latest target from awareness. */
  targetX: number
  targetY: number
  /** Currently rendered (interpolated). */
  x: number
  y: number
}

const SVG_CURSOR = (color: string) => (
  <svg
    width="20" height="22" viewBox="0 0 20 22" xmlns="http://www.w3.org/2000/svg"
    style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}
  >
    <path
      d="M2 2 L18 12 L11 13 L8 20 Z"
      fill={color}
      stroke="white"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

export default function LiveCursorLayer({ room }: { room: YjsRoom | null }) {
  const [remotes, setRemotes] = useState<RemotePointer[]>([])
  const stateRef = useRef<Map<string, RemotePointer>>(new Map())
  const rafRef = useRef<number | null>(null)

  // Pull from awareness whenever it updates → fold into the local state map.
  // Re-runs when `room` changes (null → room instance once collab context is set).
  useEffect(() => {
    if (!room) { setRemotes([]); return }
    const aw = getAwareness(room)
    const onUpdate = () => {
      const next = new Map<string, RemotePointer>()
      aw.getStates().forEach((state, clientId) => {
        if (clientId === aw.clientID) return
        const u = state.user as { userId?: string; name?: string; color?: string } | undefined
        const p = state.pointer as { x_pct?: number; y_pct?: number } | undefined
        if (!u?.userId || !u.name || !u.color) return
        if (typeof p?.x_pct !== "number" || typeof p?.y_pct !== "number") return
        const prior = stateRef.current.get(u.userId)
        next.set(u.userId, {
          userId: u.userId, name: u.name, color: u.color,
          targetX: p.x_pct, targetY: p.y_pct,
          x: prior?.x ?? p.x_pct,
          y: prior?.y ?? p.y_pct,
        })
      })
      stateRef.current = next
      setRemotes([...next.values()])
    }
    aw.on("update", onUpdate)
    onUpdate()
    return () => { aw.off("update", onUpdate) }
  }, [room])

  // rAF interpolation tick. Eases each rendered position toward its target.
  useEffect(() => {
    const tick = () => {
      let needRender = false
      stateRef.current.forEach((r) => {
        const dx = r.targetX - r.x, dy = r.targetY - r.y
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
          r.x += dx * 0.25
          r.y += dy * 0.25
          needRender = true
        } else if (r.x !== r.targetX || r.y !== r.targetY) {
          r.x = r.targetX; r.y = r.targetY; needRender = true
        }
      })
      if (needRender) setRemotes([...stateRef.current.values()])
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [])

  if (remotes.length === 0) return null

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
      {remotes.map((r) => (
        <div
          key={r.userId}
          className="absolute"
          style={{
            left: `${r.x}%`,
            top:  `${r.y}%`,
            transform: "translate(-2px, -2px)",
            willChange: "left, top",
          }}
        >
          {SVG_CURSOR(r.color)}
          <div
            className="absolute left-3 top-5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white whitespace-nowrap rounded-sm"
            style={{
              backgroundColor: r.color,
              boxShadow: `0 1px 4px ${r.color}55`,
            }}
          >
            {r.name}
          </div>
        </div>
      ))}
    </div>
  )
}
