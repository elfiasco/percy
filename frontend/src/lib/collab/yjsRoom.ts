import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { Awareness } from "y-protocols/awareness"

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

export type Transport = "local" | "broadcast" | "websocket"

/**
 * Where the websocket transport connects. Configurable at runtime via
 * VITE_YJS_WS_URL; in production this would point at our Hocuspocus or
 * y-websocket relay (or a Liveblocks-style provider URL).
 *
 * If unset, the websocket transport silently falls back to broadcast so the
 * studio stays usable in local dev.
 */
const YJS_WS_URL = (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_YJS_WS_URL) || ""

export interface YjsRoom {
  doc:           Y.Doc
  transport:     Transport
  /** A stable identifier for this room (used for awareness, debugging). */
  roomId:        string
  /** Map of element id → Y.Map of element fields. */
  elements:      Y.Map<Y.Map<unknown>>
  /** Slide-level metadata. */
  meta:          Y.Map<unknown>
  /** Awareness instance shared with the WS transport so peer presence syncs. */
  awareness:     Awareness
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
  token: string = "",
): YjsRoom {
  const roomId = `${docId}::slide-${slideN}`
  const existing = _rooms.get(roomId)
  if (existing) return existing

  const doc       = new Y.Doc()
  const elements  = doc.getMap<Y.Map<unknown>>("elements")
  const meta      = doc.getMap<unknown>("meta")
  // Awareness constructor initializes to {} (non-null). Do NOT call setLocalState(null)
  // here — y-websocket only broadcasts awareness on connect if getLocalState() !== null,
  // and setLocalStateField is a no-op when state is null.
  const awareness = new Awareness(doc)

  let cleanup: (() => void) | null = null
  let effectiveTransport = transport
  if (transport === "websocket") {
    if (YJS_WS_URL) {
      cleanup = wireWebsocket(YJS_WS_URL, roomId, doc, token, awareness)
    } else {
      // Server URL not configured — fall back so dev works.
      effectiveTransport = "broadcast"
    }
  }
  if (effectiveTransport === "broadcast" && typeof BroadcastChannel !== "undefined") {
    cleanup = wireBroadcastChannel(roomId, doc)
  }

  const room: YjsRoom = {
    doc,
    transport: effectiveTransport,
    roomId,
    elements,
    meta,
    awareness,
    getTextFragment(elementId: string): Y.XmlFragment {
      // Top-level fragment keyed by element id. `doc.getXmlFragment(name)`
      // always returns an attached fragment (frag.doc === room.doc).
      // Detached fragments were the cause of the y-tiptap `.doc undefined`
      // crash in production.
      return doc.getXmlFragment(`text:${elementId}`)
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

// ── WebSocket transport (cross-machine) ─────────────────────────────────────
//
// y-websocket is the simplest production transport. Stand up the server
// with `npx y-websocket-server --port 1234` for dev, or run Hocuspocus
// (drop-in replacement with persistence + auth) in production.
//
// VITE_YJS_WS_URL controls where this connects: e.g. "ws://localhost:1234".

function wireWebsocket(
  wsUrl: string, roomId: string, doc: Y.Doc, token: string, awareness: Awareness,
): () => void {
  const params = token ? { token } : undefined
  const provider = new WebsocketProvider(wsUrl, roomId, doc, {
    connect: true,
    params,
    // Critical: tell y-websocket to use OUR awareness instance so the
    // useStudioCollab side and the wire side share the same state. By
    // default y-websocket creates its own and our setLocalUser writes
    // are invisible to peers.
    awareness,
  })
  let reconnectFails = 0
  let bcCleanup: (() => void) | null = null
  provider.on("status", (e: { status: string }) => {
    if (e.status === "connected") { reconnectFails = 0; return }
    if (e.status === "disconnected") {
      reconnectFails += 1
      // App Runner Envoy returns 403 on every WebSocket upgrade — until
      // the relay is moved behind an ALB this is a known dead transport.
      // After a couple of failures, silently bring up BroadcastChannel so
      // multi-tab-same-browser collaboration still works.
      if (reconnectFails === 2 && !bcCleanup && typeof BroadcastChannel !== "undefined") {
        console.warn("[Percy] yjs ws keeps disconnecting; falling back to BroadcastChannel")
        bcCleanup = wireBroadcastChannel(roomId, doc)
      }
    }
  })
  return () => {
    bcCleanup?.()
    provider.disconnect()
    provider.destroy()
  }
}

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
