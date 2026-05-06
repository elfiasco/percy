import { Awareness } from "y-protocols/awareness"
import type { YjsRoom } from "./yjsRoom"

/**
 * Per-room awareness state. Used by the Tiptap CollaborationCursor extension
 * to render remote users' cursors and selection halos, and by future presence
 * indicators (avatar pills, "Maria is editing slide 3", etc.).
 *
 * Awareness state is *ephemeral* — it isn't persisted. When a user disconnects,
 * their awareness disappears. Y.Doc data persists; awareness does not.
 */

export interface PercyUserPresence {
  userId:    string
  name:      string
  color:     string             // CSS color for cursor/halo
  selection?: { elementId: string; elementName?: string }
}

const _awareness = new Map<string, Awareness>()

export function getAwareness(room: YjsRoom): Awareness {
  let aw = _awareness.get(room.roomId)
  if (!aw) {
    aw = new Awareness(room.doc)
    _awareness.set(room.roomId, aw)
  }
  return aw
}

export function setLocalUser(room: YjsRoom, user: PercyUserPresence): void {
  const aw = getAwareness(room)
  aw.setLocalStateField("user", { name: user.name, color: user.color, userId: user.userId })
  if (user.selection) aw.setLocalStateField("selection", user.selection)
}

export function getRemoteUsers(room: YjsRoom): PercyUserPresence[] {
  const aw = getAwareness(room)
  const out: PercyUserPresence[] = []
  aw.getStates().forEach((state, clientId) => {
    if (clientId === aw.clientID) return
    const u = state.user as { userId?: string; name?: string; color?: string } | undefined
    if (!u || !u.userId || !u.name || !u.color) return
    out.push({
      userId:    u.userId,
      name:      u.name,
      color:     u.color,
      selection: state.selection as PercyUserPresence["selection"],
    })
  })
  return out
}

/** Stable, distinguishable color picked from the user id. */
export function colorForUser(userId: string): string {
  // 8 well-spaced hues in our palette range (warm + cool mix)
  const palette = [
    "#e8c97a",  // champagne
    "#64a298",  // verdigris
    "#a06d3b",  // ochre-warm
    "#b85842",  // brick
    "#6d8a6d",  // sage-shaded
    "#4a6b8a",  // ink-blue
    "#9a4a8a",  // mauve
    "#3d8888",  // teal-deep
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}
