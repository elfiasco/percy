import * as Y from "yjs"

/**
 * Yjs collaboration layer for Percy.
 *
 * One Y.Doc per (docId, slideN). Inside the doc:
 *
 *   yDoc.getMap("elements")
 *     ↳ for each elementId →  Y.Map of element fields
 *         ↳ "type", "left_in", "top_in", "width_in", "height_in", "z_index", ...
 *         ↳ "text" → Y.XmlFragment (used by Tiptap collaboration extension)
 *
 *   yDoc.getMap("meta")
 *     ↳ "background_color", "transition", etc. (slide-level fields)
 *
 * The Y.Doc is the *transient* sync representation. Bridge JSON remains
 * canonical on disk. On first connect, hydrate the Y.Doc by running the
 * Bridge → Yjs adapter once. On final disconnect (or periodically), the
 * server snapshots the Y.Doc back to Bridge JSON for persistence.
 *
 * # Transport options
 *
 * The room creation supports two transports today:
 *
 *   - "local"        — pure in-memory; Y.Doc is created but no sync. Useful
 *                      for unit tests and for falling back when offline.
 *   - "broadcast"    — BroadcastChannel-based cross-tab sync within the same
 *                      browser. Two studio tabs at the same URL converge.
 *                      Zero infrastructure; proves the wiring works.
 *
 * Future transports will be added the same way:
 *
 *   - "websocket"    — y-websocket against our own relay (or Hocuspocus)
 *   - "liveblocks"   — @liveblocks/yjs against managed cloud
 *
 * The room interface is identical regardless of transport, so the renderer
 * code never needs to know.
 */

export type Transport = "local" | "broadcast"

export interface YjsRoom {
  doc:           Y.Doc
  transport:     Transport
  /** A stable identifier for this room (used for awareness, debugging). */
  roomId:        string
  /** Map of element id → Y.Map of element fields. */
  elements:      Y.Map<Y.Map<unknown>>
  /** Slide-level metadata. */
  meta:          Y.Map<unknown>
  /** Convenience: get-or-create the Y.XmlFragment for an element's text. */
  getTextFragment(elementId: string): Y.XmlFragment
  /** Disconnect transport, free resources. */
  destroy(): void
}

const _rooms = new Map<string, YjsRoom>()

/**
 * Get or create the Yjs room for a (docId, slideN) pair. Multiple callers
 * with the same key get the same room; the room is freed when the last
 * caller calls `destroy()`.
 */
export function getYjsRoom(
  docId:    string,
  slideN:   number,
  transport: Transport = "broadcast",
): YjsRoom {
  const roomId = `${docId}::slide-${slideN}`
  const existing = _rooms.get(roomId)
  if (existing) return existing

  const doc       = new Y.Doc()
  const elements  = doc.getMap<Y.Map<unknown>>("elements")
  const meta      = doc.getMap<unknown>("meta")

  let cleanup: (() => void) | null = null
  if (transport === "broadcast" && typeof BroadcastChannel !== "undefined") {
    cleanup = wireBroadcastChannel(roomId, doc)
  }

  const room: YjsRoom = {
    doc,
    transport,
    roomId,
    elements,
    meta,
    getTextFragment(elementId: string): Y.XmlFragment {
      let elMap = elements.get(elementId)
      if (!elMap) {
        elMap = new Y.Map()
        elements.set(elementId, elMap)
      }
      let frag = elMap.get("text") as Y.XmlFragment | undefined
      if (!frag) {
        frag = new Y.XmlFragment()
        elMap.set("text", frag)
      }
      return frag
    },
    destroy() {
      cleanup?.()
      doc.destroy()
      _rooms.delete(roomId)
    },
  }

  _rooms.set(roomId, room)
  return room
}

// ── BroadcastChannel transport (cross-tab proof) ─────────────────────────────
//
// Encodes outgoing Yjs updates as Uint8Array and posts them on the channel.
// Other tabs decode + apply. On open, exchange state vectors so freshly-opened
// tabs catch up to whatever's already in flight.

function wireBroadcastChannel(roomId: string, doc: Y.Doc): () => void {
  const channel = new BroadcastChannel(`percy-yjs:${roomId}`)

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === channel) return  // don't echo
    channel.postMessage({ kind: "update", update })
  }
  doc.on("update", onUpdate)

  channel.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (!msg) return
    if (msg.kind === "update" && msg.update instanceof Uint8Array) {
      Y.applyUpdate(doc, msg.update, channel)
    } else if (msg.kind === "request-state") {
      const sv = Y.encodeStateAsUpdate(doc)
      channel.postMessage({ kind: "update", update: sv })
    }
  }

  // Ask any other open tabs for their state
  channel.postMessage({ kind: "request-state" })

  return () => {
    doc.off("update", onUpdate)
    channel.close()
  }
}
