/**
 * Debounced Yjs → Bridge JSON save-back.
 *
 * When a collab session is active, element changes are written to the Y.Doc
 * first (optimistic) and then persisted to the REST API. This module watches
 * for Y.Doc mutations and flushes pending saves at most once per DEBOUNCE_MS.
 *
 * Why needed: rapid drag operations and style changes produce many Y.Doc
 * mutations, but we only want a single REST call at the end of the burst.
 * Without this, each Yjs change would fire a separate API request.
 *
 * The save-back only flushes geometry (position/size/rotation) and style data
 * since those are the fields we now write into Yjs first. Text content is
 * handled by the Tiptap renderers directly (they call updateElementText on
 * blur). Chart and table data still go through the REST-first path.
 */

import type { YjsRoom } from "./yjsRoom"
import { readElementScalar, getElementStyleData } from "./bridgeYjsAdapter"
import { updateElementPosition, updateElementStyle } from "../studioApi"
import type { ElementGeometryUpdate } from "../studio/commands"

const DEBOUNCE_MS = 800

interface PendingFlush {
  geometry: Map<string, ElementGeometryUpdate>
  style: Map<string, Record<string, unknown>>
  timer: ReturnType<typeof setTimeout> | null
}

const _pending = new Map<string, PendingFlush>()

function getOrCreatePending(roomId: string): PendingFlush {
  if (!_pending.has(roomId)) {
    _pending.set(roomId, { geometry: new Map(), style: new Map(), timer: null })
  }
  return _pending.get(roomId)!
}

async function flushRoom(
  roomId: string,
  room: YjsRoom,
  docId: string,
  slideN: number,
): Promise<void> {
  const p = _pending.get(roomId)
  if (!p) return

  const geoEntries = [...p.geometry.entries()]
  const styleEntries = [...p.style.entries()]
  p.geometry.clear()
  p.style.clear()
  p.timer = null

  await Promise.allSettled([
    ...geoEntries.map(([elementId, update]) =>
      updateElementPosition(docId, slideN, elementId, update).catch((err) => {
        console.warn("[Percy Yjs save-back] geometry flush failed:", elementId, err)
      }),
    ),
    ...styleEntries.map(([elementId]) => {
      const style = getElementStyleData(room, elementId)
      if (!style) return Promise.resolve()
      return updateElementStyle(docId, slideN, elementId, style).catch((err) => {
        console.warn("[Percy Yjs save-back] style flush failed:", elementId, err)
      })
    }),
  ])
}

function scheduleFlush(
  roomId: string,
  room: YjsRoom,
  docId: string,
  slideN: number,
): void {
  const p = getOrCreatePending(roomId)
  if (p.timer !== null) clearTimeout(p.timer)
  p.timer = setTimeout(() => {
    flushRoom(roomId, room, docId, slideN).catch(() => {})
  }, DEBOUNCE_MS)
}

/**
 * Start watching a room for mutations that need to be saved back to the
 * REST API. Returns an unsubscribe function.
 *
 * Only watches fields that are written to Yjs first (geometry + style).
 * Skips flushing if the mutation was caused by the local client directly
 * calling a REST API (those paths already set the data server-side).
 */
export function startYjsSaveBack(
  room: YjsRoom,
  docId: string,
  slideN: number,
): () => void {
  const { roomId } = room
  const p = getOrCreatePending(roomId)

  const handler = (events: import("yjs").YMapEvent<unknown>[], tx: import("yjs").Transaction) => {
    if (tx.local) return  // skip: local direct REST-API writes handle their own persistence

    for (const event of events) {
      if (!(event.target instanceof (room.doc.getMap("elements").constructor as unknown as typeof Map))) continue
      const elementId = [...(event.target as unknown as Map<string, unknown>).entries()]
        .find(([, v]) => v instanceof Map)
        ?.[0]
      if (!elementId) continue

      // Determine what changed
      const changed = event.changes.keys
      const geoFields = new Set(["left_in", "top_in", "width_in", "height_in", "rotation", "flip_h", "flip_v", "z_index"])
      const styleChanged = changed.has("style_data")
      const geoChanged = [...changed.keys()].some((k) => geoFields.has(k))

      if (geoChanged) {
        const snap = readElementScalar(room, elementId)
        if (snap) p.geometry.set(elementId, snap as ElementGeometryUpdate)
      }
      if (styleChanged) {
        p.style.set(elementId, {})
      }
    }

    if (p.geometry.size > 0 || p.style.size > 0) {
      scheduleFlush(roomId, room, docId, slideN)
    }
  }

  const elements = room.doc.getMap("elements")
  elements.observeDeep(handler)
  return () => {
    elements.unobserveDeep(handler)
    if (p.timer !== null) {
      clearTimeout(p.timer)
      // Flush immediately on cleanup to avoid losing pending writes.
      flushRoom(roomId, room, docId, slideN).catch(() => {})
    }
    _pending.delete(roomId)
  }
}
