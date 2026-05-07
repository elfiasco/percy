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

/**
 * Return the room's awareness — the SAME instance the WebsocketProvider
 * was constructed with, so local writes propagate over the wire and
 * remote updates land in this same map. (We used to mint a separate
 * Awareness per roomId here; that meant our presence updates lived in
 * a different bucket than the one y-websocket synchronized, and peers
 * never saw each other.)
 */
export function getAwareness(room: YjsRoom): Awareness {
  return room.awareness
}

export function setLocalUser(room: YjsRoom, user: PercyUserPresence): void {
  const aw = getAwareness(room)
  aw.setLocalStateField("user", { name: user.name, color: user.color, userId: user.userId })
  if (user.selection) aw.setLocalStateField("selection", user.selection)
}

/** Update just the local user's selection (which element they have picked). */
export function setLocalSelection(
  room: YjsRoom, selection: PercyUserPresence["selection"] | null,
): void {
  getAwareness(room).setLocalStateField("selection", selection || null)
}

/** Update just the local user's caret-in-text position for an element. */
export function setLocalCaret(
  room: YjsRoom, caret: { elementId: string; pos: number } | null,
): void {
  getAwareness(room).setLocalStateField("caret", caret || null)
}

/**
 * Broadcast where the local user's mouse pointer is on the slide canvas.
 * Coordinates are PERCENTAGES of the slide bounds so peers can scale into
 * their own canvas size at any zoom level.
 */
export function setLocalPointer(
  room: YjsRoom, pointer: { x_pct: number; y_pct: number } | null,
): void {
  getAwareness(room).setLocalStateField("pointer", pointer || null)
}

/**
 * Broadcast that the local user has entered text-edit mode on an element.
 * Peers render a stronger glow on that element so the collab feels live
 * (Figma-style "X is editing this").
 */
export function setLocalEditing(
  room: YjsRoom, editing: { elementId: string } | null,
): void {
  getAwareness(room).setLocalStateField("editing", editing || null)
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
