import { useEffect, useState } from "react"
import { getCollabContext } from "../../lib/collab/collabContext"
import { getAwareness } from "../../lib/collab/awareness"
import type { StudioElement } from "../../lib/studioTypes"

/**
 * Renders one colored selection ring + name tag per remote user, positioned
 * over whichever element they currently have selected on this slide.
 *
 * Replaces the half of CollaborationCursor we actually want (peer presence)
 * without wiring up the y-prosemirror plugin that crashes Tiptap v3 init.
 *
 * In-text caret rendering for collaborators happens in a separate phase —
 * for now this is "I can see who's looking at what element."
 */
interface RemoteSelection {
  userId:    string
  name:      string
  color:     string
  elementId: string
  editing:   boolean
}

export default function RemotePresenceLayer({
  elements,
}: { elements: StudioElement[] }) {
  const [remotes, setRemotes] = useState<RemoteSelection[]>([])

  useEffect(() => {
    const collab = getCollabContext()
    if (!collab?.enabled) { setRemotes([]); return }
    const aw = getAwareness(collab.room)
    const refresh = () => {
      const out: RemoteSelection[] = []
      aw.getStates().forEach((state, clientId) => {
        if (clientId === aw.clientID) return
        const u = state.user as { userId?: string; name?: string; color?: string } | undefined
        const sel = state.selection as { elementId?: string } | undefined
        const ed  = state.editing  as { elementId?: string } | undefined
        if (!u?.userId || !u.name || !u.color) return
        // Editing implies selection. Prefer editing's elementId if present.
        const elementId = ed?.elementId || sel?.elementId
        if (!elementId) return
        out.push({ userId: u.userId, name: u.name, color: u.color, elementId, editing: !!ed?.elementId })
      })
      setRemotes(out)
    }
    aw.on("update", refresh)
    refresh()
    return () => { aw.off("update", refresh) }
  }, [])

  if (remotes.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes percy-remote-ring-pulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--ring-color, transparent); }
          50%      { box-shadow: 0 0 0 4px var(--ring-color, transparent); }
        }
      `}</style>
      {remotes.map((r) => {
        const el = elements.find((e) => e.id === r.elementId)
        if (!el) return null
        const ringRgba   = r.editing ? `${r.color}99` : `${r.color}55`
        const outlineW   = r.editing ? "2.5px" : "1.5px"
        const animDur    = r.editing ? "1.0s" : "1.6s"
        return (
          <div
            key={`${r.userId}-${r.elementId}`}
            className="absolute pointer-events-none"
            style={{
              left:   `${el.left_pct}%`,
              top:    `${el.top_pct}%`,
              width:  `${el.width_pct}%`,
              height: `${el.height_pct}%`,
              outline:       `${outlineW} solid ${r.color}`,
              outlineOffset: "-1.5px",
              zIndex: 9998,
              ["--ring-color" as string]: ringRgba,
              animation: `percy-remote-ring-pulse ${animDur} ease-in-out infinite`,
              transition: "left 120ms ease-out, top 120ms ease-out, width 120ms ease-out, height 120ms ease-out",
            }}
          >
            <div
              className="absolute -top-5 left-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white whitespace-nowrap rounded-sm flex items-center gap-1"
              style={{
                backgroundColor: r.color,
                boxShadow: `0 1px 4px ${r.color}55`,
              }}
            >
              {r.name}
              {r.editing && <span className="opacity-80">· typing</span>}
            </div>
          </div>
        )
      })}
    </>
  )
}
