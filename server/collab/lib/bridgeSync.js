/**
 * Bridge sync — the piece that keeps Bridge JSON canonical even while
 * collaborative editing is happening on a transient Y.Doc.
 *
 * Direction A (hydration):    Bridge JSON  →  Y.XmlFragment
 *   Used on cold-start when no snapshot exists. Server fetches the slide's
 *   text content from FastAPI, runs paragraphsToTiptap, then
 *   prosemirrorJSONToYXmlFragment to seed each element's shared fragment.
 *
 * Direction B (save-back):    Y.XmlFragment  →  Bridge JSON  →  FastAPI
 *   Runs on a debounced timer per room (5s of idle activity) and on
 *   graceful disconnect of the last client. Walks every text element with
 *   a non-empty fragment, runs yXmlFragmentToProsemirrorJSON, then
 *   tiptapToParagraphs, then PATCHes the existing /api/.../text endpoint.
 *
 * Why this is fast:
 *   - Reads/writes against the in-memory Y.Doc are O(1)
 *   - Conversion happens off the sync hot path (timer, not on every keystroke)
 *   - Network calls are parallelized per element with Promise.all
 *   - Only DIRTY elements are saved (compare hash of last persisted JSON)
 *
 * Why Bridge stays canonical:
 *   - Y.Doc is a CACHE during editing; Bridge JSON is the system of record
 *   - Every serialization passes through the same paragraphs/runs schema the
 *     rest of Percy already understands
 *   - On disconnect, last word is the Bridge JSON in Postgres via FastAPI
 */

import { yXmlFragmentToProsemirrorJSON, prosemirrorJSONToYXmlFragment } from "y-prosemirror"
import { getSchema } from "@tiptap/core"
import { bridgeExtensions } from "./extensions.js"
import { paragraphsToTiptap, tiptapToParagraphs } from "./tiptapAdapter.js"
import * as Y from "yjs"
import { createHash } from "crypto"

// Build the schema once — the client uses the exact same set.
const SCHEMA = getSchema(bridgeExtensions())

// ── Hydration: Bridge JSON → Y.XmlFragment ───────────────────────────────────

/**
 * Seed a single element's text fragment from Bridge ParagraphsTextContent.
 * No-op if the fragment already has content (live edits win).
 */
export function hydrateElementText(elMap, paragraphsContent) {
  let frag = elMap.get("text")
  if (!(frag instanceof Y.XmlFragment)) {
    frag = new Y.XmlFragment()
    elMap.set("text", frag)
  }
  if (frag.length > 0) return frag
  const pmJSON = paragraphsToTiptap(paragraphsContent)
  prosemirrorJSONToYXmlFragment(SCHEMA, pmJSON, frag)
  return frag
}

/**
 * Hydrate every text element in a room from a server-provided slide payload.
 *
 * `slidePayload.elements` is the existing /api/docs/<id>/slides/<n>/elements
 * response shape; we pair each element with the text content fetched from
 * /api/docs/<id>/slides/<n>/elements/<el>/text and seed accordingly.
 */
export async function hydrateRoom(room, slidePayload, fetchElementText) {
  const textTasks = slidePayload.elements
    .filter((el) => el.type === "BridgeText" || el.type === "BridgeShape")
    .map(async (el) => {
      try {
        const content = await fetchElementText(el.id)
        if (content?.kind !== "paragraphs") return
        const elMap = getOrCreateElementMap(room, el.id)
        hydrateElementText(elMap, content)
      } catch (e) {
        console.warn(`hydrate ${el.id} failed:`, e.message)
      }
    })
  // Hydrate scalar element fields too (position, etc.) so later renderers
  // can read them from the Y.Doc directly.
  for (const el of slidePayload.elements) {
    const elMap = getOrCreateElementMap(room, el.id)
    room.doc.transact(() => {
      for (const k of SCALAR_FIELDS) {
        if (!elMap.has(k)) elMap.set(k, el[k])
      }
    })
  }
  await Promise.all(textTasks)
}

const SCALAR_FIELDS = [
  "type", "name", "label",
  "left_in", "top_in", "width_in", "height_in",
  "left_pct", "top_pct", "width_pct", "height_pct",
  "rotation", "flip_h", "flip_v",
  "z_index", "locked", "hidden", "animation",
]

function getOrCreateElementMap(room, elementId) {
  let elements = room.doc.getMap("elements")
  let elMap = elements.get(elementId)
  if (!(elMap instanceof Y.Map)) {
    elMap = new Y.Map()
    elements.set(elementId, elMap)
  }
  return elMap
}

// ── Save-back: Y.XmlFragment → Bridge JSON → FastAPI ─────────────────────────

/**
 * Per-room sync state. Tracks last-persisted hash per element so we only
 * POST when content actually changed since last save.
 */
export class RoomSaveTracker {
  constructor(roomName, parseRoomName) {
    this.roomName = roomName
    const parsed  = parseRoomName(roomName)
    this.docId    = parsed?.docId ?? null
    this.slideN   = parsed?.slideN ?? null
    this.lastHash = new Map()    // elementId → sha1 hash of last saved JSON
    this._inflight = new Set()   // elementIds currently being POSTed
  }

  /** Compute the set of dirty elements in this room since last save. */
  collectDirty(room) {
    const elements = room.doc.getMap("elements")
    const dirty = []
    elements.forEach((elMap, elementId) => {
      const frag = elMap.get("text")
      if (!(frag instanceof Y.XmlFragment) || frag.length === 0) return
      const pmJSON = yXmlFragmentToProsemirrorJSON(frag)
      const bridge = tiptapToParagraphs(pmJSON)
      const h = sha1(JSON.stringify(bridge))
      if (this.lastHash.get(elementId) === h) return  // unchanged
      dirty.push({ elementId, bridge, hash: h })
    })
    return dirty
  }

  markSaved(elementId, hash) {
    this.lastHash.set(elementId, hash)
  }
}

function sha1(s) {
  return createHash("sha1").update(s).digest("hex")
}

/**
 * Push every dirty element back to FastAPI. Returns the number of elements
 * actually saved. Caller throttles via a debounce timer — typically 5s
 * idle between calls, plus an immediate flush on disconnect.
 *
 * `apiPatchElementText(elementId, bridge)` is provided by the caller so
 * this module doesn't have to know how to authenticate to FastAPI.
 */
export async function saveBackRoom(room, tracker, apiPatchElementText) {
  const dirty = tracker.collectDirty(room)
  if (dirty.length === 0) return 0

  let saved = 0
  await Promise.all(dirty.map(async ({ elementId, bridge, hash }) => {
    if (tracker._inflight.has(elementId)) return
    tracker._inflight.add(elementId)
    try {
      await apiPatchElementText(elementId, bridge)
      tracker.markSaved(elementId, hash)
      saved++
    } catch (e) {
      console.warn(`[room ${tracker.roomName}] save-back ${elementId} failed:`, e.message)
    } finally {
      tracker._inflight.delete(elementId)
    }
  }))
  return saved
}
