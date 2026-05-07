import * as Y from "yjs"
import type { YjsRoom } from "./yjsRoom"
import type { StudioElement } from "../studioTypes"

/**
 * Bridge ↔ Y.Doc adapter.
 *
 * The Bridge JSON / dataclass model is the canonical, persisted, agent-facing
 * representation of every Percy document. This adapter is the **only** place
 * where that model is translated into the Y.Doc shape used by the live studio
 * editing surface, and back again.
 *
 * Y.Doc shape (per slide room):
 *
 *   yDoc.getMap("slide_meta") : Y.Map
 *     "background_color":  string | null
 *
 *   yDoc.getMap("elements") : Y.Map<Y.Map>
 *     <id> :
 *        "type":       string                ("BridgeText" | "BridgeShape" | …)
 *        "label":      string
 *        "name":       string
 *        "left_in":    number
 *        "top_in":     number
 *        "width_in":   number
 *        "height_in":  number
 *        "rotation":   number
 *        "flip_h":     boolean
 *        "flip_v":     boolean
 *        "z_index":    number
 *        "locked":     boolean
 *        "hidden":     boolean
 *
 *   yDoc.getXmlFragment(`text:${elementId}`) : Y.XmlFragment
 *     Tiptap content for text-bearing elements (top-level for guaranteed
 *     attachment — see the Aug-2026 incident notes in TiptapTextRenderer).
 *
 * NEW FIELDS: anything not listed above stays Bridge-only. To bring a field
 * into the studio's local-first hot path, add it here AND to a renderer
 * that subscribes to it. Round-trip tests live next to this file.
 */

// Fields we copy verbatim from StudioElement → Y.Map. Order matches the
// dataclass order in src/percy/bridge/elements.py for diff-ability.
const SCALAR_FIELDS = [
  "type", "label", "name",
  "left_in", "top_in", "width_in", "height_in",
  "rotation", "flip_h", "flip_v",
  "z_index", "locked", "hidden", "animation",
] as const

// Phase C — non-scalar data (style/font/image) doesn't fit cleanly into
// flat scalars, so we broadcast revision counters and let peers re-fetch
// the actual payload via the existing API endpoints. Cheap to broadcast,
// keeps the Y.Doc small, and avoids a parallel schema for style data.
const REV_FIELDS = ["style_rev", "text_rev", "render_rev"] as const
type RevField = (typeof REV_FIELDS)[number]

export function bumpRev(room: YjsRoom, elementId: string, field: RevField): void {
  const m = elementMap(room, elementId)
  const cur = (m.get(field) as number | undefined) ?? 0
  m.set(field, cur + 1)
}

export function getRev(room: YjsRoom, elementId: string, field: RevField): number {
  const m = room.doc.getMap<Y.Map<unknown>>("elements").get(elementId)
  return (m?.get(field) as number | undefined) ?? 0
}

type ScalarField = (typeof SCALAR_FIELDS)[number]

export function elementMap(room: YjsRoom, elementId: string): Y.Map<unknown> {
  const elements = room.doc.getMap<Y.Map<unknown>>("elements")
  let m = elements.get(elementId)
  if (!m) {
    m = new Y.Map()
    elements.set(elementId, m)
  }
  return m
}

/**
 * Hydrate a single element's scalar fields. Idempotent — only writes a key
 * if the Y.Map doesn't already have it (so live remote edits aren't clobbered
 * when a re-fetch happens on slide reopen).
 */
export function hydrateElement(room: YjsRoom, el: StudioElement): Y.Map<unknown> {
  const m = elementMap(room, el.id)
  room.doc.transact(() => {
    for (const k of SCALAR_FIELDS) {
      if (!m.has(k)) m.set(k, (el as unknown as Record<string, unknown>)[k])
    }
  })
  return m
}

export function hydrateSlide(
  room: YjsRoom,
  elements: StudioElement[],
  background_color: string | null,
): void {
  room.doc.transact(() => {
    const meta = room.doc.getMap("slide_meta")
    if (!meta.has("background_color")) meta.set("background_color", background_color)
    for (const el of elements) hydrateElement(room, el)
  })
}

/**
 * Read a single element's scalar fields back out of the Y.Doc as a partial
 * StudioElement. Used by:
 *   - the server save-back loop (translate Y.Doc back into Bridge JSON)
 *   - any UI that wants a snapshot view of the current state
 *
 * Percent-based fields (left_pct etc.) are derived from the inch values plus
 * the slide bounds and are NOT stored in the Y.Doc — re-derive on read.
 */
export function readElementScalar(
  room: YjsRoom, elementId: string,
): Partial<StudioElement> | null {
  const m = room.doc.getMap<Y.Map<unknown>>("elements").get(elementId)
  if (!m) return null
  const out: Record<string, unknown> = {}
  for (const k of SCALAR_FIELDS) {
    if (m.has(k)) out[k] = m.get(k)
  }
  return out as Partial<StudioElement>
}

/** Atomically update a subset of element fields. */
export function updateElementFields(
  room: YjsRoom,
  elementId: string,
  fields: Partial<Record<ScalarField, unknown>>,
): void {
  const m = elementMap(room, elementId)
  room.doc.transact(() => {
    for (const [k, v] of Object.entries(fields)) {
      m.set(k, v)
    }
  })
}

/** Subscribe to element-level changes; returns an unsubscribe function. */
export function observeElement(
  room: YjsRoom,
  elementId: string,
  cb: (snapshot: Partial<StudioElement>) => void,
): () => void {
  const m = elementMap(room, elementId)
  const handler = () => {
    const snap = readElementScalar(room, elementId)
    if (snap) cb(snap)
  }
  m.observe(handler)
  return () => m.unobserve(handler)
}

/** Subscribe to slide-level changes (additions, removals, reorder). */
export function observeSlideElements(
  room: YjsRoom,
  cb: (ids: string[]) => void,
): () => void {
  const elements = room.doc.getMap<Y.Map<unknown>>("elements")
  const handler = () => cb([...elements.keys()])
  elements.observe(handler)
  // Initial dispatch
  cb([...elements.keys()])
  return () => elements.unobserve(handler)
}

/** Remove an element from the Y.Doc + clean its text fragment. */
export function deleteElement(room: YjsRoom, elementId: string): void {
  room.doc.transact(() => {
    const elements = room.doc.getMap<Y.Map<unknown>>("elements")
    elements.delete(elementId)
    // Y.XmlFragment top-level entries can't be deleted via API, but we can
    // empty them so a stale id doesn't confuse renderers.
    const frag = room.doc.getXmlFragment(`text:${elementId}`)
    if (frag.length > 0) frag.delete(0, frag.length)
  })
}
