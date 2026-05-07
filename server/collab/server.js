/**
 * Percy collaboration server — production version.
 *
 * Architecture:
 *
 *   client (Tiptap + y-prosemirror + WebsocketProvider)
 *      ↕  WebSocket  (auth via percy_session cookie/token in query string)
 *   collab server (this file)
 *      ↕  Y.Doc per (docId, slideN) in memory
 *      ├──→ FastAPI for hydration + save-back  (every text element)
 *      └──→ Postgres for periodic Y.Doc snapshots (yjs_snapshots table)
 *
 * Bridge JSON stays canonical. The Y.Doc is a transient editing cache.
 *
 *   Hydration (cold start, no snapshot):
 *     1. fetchSlideElements(docId, slideN) → enumerate elements
 *     2. fetchElementText(elId) for each text-bearing element
 *     3. Seed each element's Y.XmlFragment with paragraphsToTiptap(content)
 *
 *   Live editing:
 *     - Yjs sync protocol updates flow between connected clients
 *     - Each update is broadcast to other clients in the room
 *     - Snapshot to Postgres every 5s (debounced)
 *
 *   Save-back (every 5s of activity, plus on graceful disconnect):
 *     - For each dirty element, yXmlFragmentToProsemirrorJSON → tiptapToParagraphs
 *     - PATCH /api/docs/<id>/slides/<n>/elements/<el>/text
 *     - Track per-element hashes so unchanged elements don't re-POST
 *
 * Configuration via env:
 *
 *   PORT                  — listening port (default 1234)
 *   HOST                  — bind host (default 0.0.0.0)
 *   PERCY_API_BASE        — FastAPI URL (default http://localhost:8000)
 *   PERCY_JWT_SECRET      — same secret as the FastAPI backend (for auth)
 *   PERCY_SERVICE_TOKEN   — optional, for service-level FastAPI calls
 *   DATABASE_URL          — Postgres for snapshots; falls back to filesystem
 *   SAVE_BACK_INTERVAL_MS — debounce for save-back (default 5000)
 *   SNAPSHOT_INTERVAL_MS  — debounce for Y.Doc → Postgres (default 5000)
 */

import { WebSocketServer } from "ws"
import * as Y from "yjs"
import * as syncProtocol      from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import http from "http"
import { URL as NodeURL } from "url"
import jwt from "jsonwebtoken"

import {
  newConnectionBucket, trackUserConnection, checkRoomBudget, rateLimitConfig,
} from "./lib/rateLimit.js"
import { pickStore } from "./lib/persistence.js"
import { getBackplane } from "./lib/backplane.js"
import {
  fetchSlideElements, fetchElementText, patchElementText,
  bulkPatchElementText, verifyUser,
} from "./lib/fastapiClient.js"
import {
  RoomSaveTracker, hydrateRoom, saveBackRoom,
} from "./lib/bridgeSync.js"

// ── Config ──────────────────────────────────────────────────────────────────

const PORT                 = parseInt(process.env.PORT || "1234", 10)
const HOST                 = process.env.HOST || "0.0.0.0"
const PERCY_JWT_SECRET     = process.env.PERCY_JWT_SECRET || ""
const SAVE_BACK_INTERVAL   = parseInt(process.env.SAVE_BACK_INTERVAL_MS || "5000", 10)
const SNAPSHOT_INTERVAL    = parseInt(process.env.SNAPSHOT_INTERVAL_MS  || "5000", 10)
const PING_INTERVAL        = 30_000
const ROOM_IDLE_GC_MS      = 5 * 60 * 1000   // 5min with zero clients → free Y.Doc

const MESSAGE_SYNC      = 0
const MESSAGE_AWARENESS = 1

// Single global persistence store, picked at startup.
const store = await pickStore()
// Optional Redis backplane for multi-instance fan-out. Null if REDIS_URL unset.
const backplane = await getBackplane()

// ── Room registry ───────────────────────────────────────────────────────────

class Room {
  constructor(name) {
    this.name      = name
    this.doc       = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)
    this.conns     = new Set()

    const { docId, slideN } = parseRoomName(name) || {}
    this.docId  = docId  ?? null
    this.slideN = slideN ?? null
    this.tracker = new RoomSaveTracker(name, parseRoomName)

    // Pick *some* user token for save-back (the most recently joined). When
    // the user disconnects, we move to the next, or fall back to service
    // token. This lets the audit log attribute most edits to the right user.
    this._tokenStack = []

    this._snapshotTimer = null
    this._saveBackTimer = null
    this._idleGCTimer   = null
    this._loaded        = false

    this.doc.on("update", (_update, origin) => {
      this._scheduleSnapshot()
      // origin === conn means came from a client — that's the case where
      // we need to save back. Local-server updates (hydration) don't trigger
      // save-back to avoid an immediate POST after cold-start.
      if (origin && origin !== this && origin !== "hydration") {
        this._scheduleSaveBack()
      }
    })
  }

  /** Cold-start: load snapshot if it exists, else hydrate from FastAPI. */
  async load() {
    if (this._loaded) return
    this._loaded = true

    const data = await store.load(this.name).catch((e) => {
      console.warn(`[room ${this.name}] snapshot load failed:`, e.message)
      return null
    })
    if (data) {
      Y.applyUpdate(this.doc, data, "hydration")
      console.log(`[room ${this.name}] loaded snapshot (${data.length} bytes)`)
      return
    }

    // No snapshot — hydrate from Bridge. Use the most-recent user token
    // if we have one (we don't on first connect — handled in handleConnection).
    if (this.docId == null || this.slideN == null) return
    const token = this._tokenStack[this._tokenStack.length - 1] ?? null
    try {
      const slidePayload = await fetchSlideElements(this.docId, this.slideN, token)
      await hydrateRoom(this, slidePayload, async (elId) => {
        return fetchElementText(this.docId, this.slideN, elId, token)
      })
      console.log(`[room ${this.name}] hydrated ${slidePayload.elements?.length ?? 0} elements from Bridge`)
    } catch (e) {
      console.warn(`[room ${this.name}] hydration failed:`, e.message)
    }
  }

  pushToken(t) { if (t) this._tokenStack.push(t) }
  popToken(t)  { const i = this._tokenStack.lastIndexOf(t); if (i >= 0) this._tokenStack.splice(i, 1) }
  currentToken() { return this._tokenStack[this._tokenStack.length - 1] ?? null }

  // ── snapshot loop ────────────────────────────────────────────────────────
  _scheduleSnapshot() {
    if (this._snapshotTimer) return
    this._snapshotTimer = setTimeout(() => this._writeSnapshot(), SNAPSHOT_INTERVAL)
  }
  async _writeSnapshot() {
    this._snapshotTimer = null
    try {
      const update = Y.encodeStateAsUpdate(this.doc)
      await store.save(this.name, update)
    } catch (e) {
      console.error(`[room ${this.name}] snapshot write failed:`, e)
    }
  }

  // ── save-back loop ───────────────────────────────────────────────────────
  _scheduleSaveBack() {
    if (this._saveBackTimer) return
    this._saveBackTimer = setTimeout(() => this._runSaveBack(), SAVE_BACK_INTERVAL)
  }
  async _runSaveBack() {
    this._saveBackTimer = null
    if (this.docId == null || this.slideN == null) return
    const token = this.currentToken()
    if (!token) {
      // No authenticated user available — defer (stays dirty; will retry).
      return
    }
    try {
      const saved = await saveBackRoom(
        this,
        this.tracker,
        async (elementId, bridge) => {
          await patchElementText(this.docId, this.slideN, elementId, bridge, token)
        },
        async (updates) => {
          return await bulkPatchElementText(this.docId, this.slideN, updates, token)
        },
      )
      if (saved > 0) {
        console.log(`[room ${this.name}] save-back persisted ${saved} element${saved === 1 ? "" : "s"}`)
      }
    } catch (e) {
      console.error(`[room ${this.name}] save-back failed:`, e.message)
    }
  }

  /** Force flush before disconnect / shutdown. */
  async flush() {
    if (this._saveBackTimer) {
      clearTimeout(this._saveBackTimer)
      this._saveBackTimer = null
    }
    await this._runSaveBack()
    if (this._snapshotTimer) {
      clearTimeout(this._snapshotTimer)
      this._snapshotTimer = null
    }
    await this._writeSnapshot()
  }

  // ── idle GC ──────────────────────────────────────────────────────────────
  scheduleIdleGC() {
    if (this._idleGCTimer) clearTimeout(this._idleGCTimer)
    this._idleGCTimer = setTimeout(async () => {
      if (this.conns.size > 0) return
      await this.flush()
      if (backplane) await backplane.leaveRoom(this.name).catch(() => {})
      this.doc.destroy()
      rooms.delete(this.name)
      console.log(`[room ${this.name}] idle-evicted`)
    }, ROOM_IDLE_GC_MS)
  }
  cancelIdleGC() {
    if (this._idleGCTimer) { clearTimeout(this._idleGCTimer); this._idleGCTimer = null }
  }
}

const rooms = new Map()

async function getOrCreateRoom(name) {
  let room = rooms.get(name)
  if (room) {
    room.cancelIdleGC()
    return room
  }
  // Reject if the server is already at its room budget — keeps a runaway
  // client from exhausting memory by opening thousands of unique rooms.
  const budget = checkRoomBudget(rooms.size)
  if (!budget.ok) {
    const err = new Error(budget.reason)
    err.code = "ROOM_BUDGET"
    throw err
  }
  room = new Room(name)
  rooms.set(name, room)
  // Bind to backplane so updates fan out to other instances
  if (backplane) {
    await backplane.bindRoom(name, room.doc).catch((e) =>
      console.warn(`backplane bind ${name} failed:`, e.message))
  }
  return room
}

/**
 * Room name parser. Studio sends `<docId>::slide-<n>`.
 */
function parseRoomName(name) {
  const m = name.match(/^(.+)::slide-(\d+)$/)
  if (!m) return null
  return { docId: m[1], slideN: parseInt(m[2], 10) }
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function authenticate(request) {
  const url = new NodeURL(request.url, "http://localhost")
  // Token can come from query string (the WebsocketProvider 'params' option
  // appends them) OR the cookie header (browsers preserve cookies on WS).
  let token = url.searchParams.get("token") || ""
  if (!token) {
    const cookie = request.headers.cookie ?? ""
    const m = cookie.match(/percy_session=([^;]+)/)
    if (m) token = m[1]
  }
  if (!token) {
    // In dev with no JWT secret configured, allow connections through so
    // the BroadcastChannel-style local demo still works against this server.
    if (!PERCY_JWT_SECRET) {
      return { token: null, user: { id: "anonymous", name: "Anonymous" } }
    }
    throw new Error("no auth token")
  }
  // Decode locally for fast path
  let payload
  try {
    payload = jwt.verify(token, PERCY_JWT_SECRET)
  } catch (e) {
    throw new Error(`invalid token: ${e.message}`)
  }
  // Verify user exists (single round-trip; cached upstream by FastAPI)
  let user
  try {
    user = await verifyUser(token)
  } catch (e) {
    throw new Error(`auth failed: ${e.message}`)
  }
  return { token, user, payload }
}

// ── Per-connection handler ──────────────────────────────────────────────────

async function handleConnection(conn, request, auth) {
  const url = new NodeURL(request.url, "http://localhost")
  const roomName = decodeURIComponent(url.pathname.slice(1)) || "default"

  // Cap concurrent connections per user (multi-tab is fine; bots are not)
  const userTrack = trackUserConnection(auth.user.id)
  if (!userTrack.ok) {
    console.warn(`auth ok but user-cap exceeded: ${auth.user.id} — ${userTrack.reason}`)
    try { conn.close(1008, "too many connections") } catch {}
    return
  }

  let room
  try {
    room = await getOrCreateRoom(roomName)
  } catch (e) {
    if (e.code === "ROOM_BUDGET") {
      try { conn.close(1013, "service overloaded") } catch {}
      userTrack.release()
      return
    }
    throw e
  }
  room.pushToken(auth.token)   // push BEFORE load so hydration has a token
  await room.load()
  room.conns.add(conn)
  console.log(`[room ${roomName}] +1 (${room.conns.size}) — ${auth.user.name || auth.user.id}`)

  // Per-connection rate limit — sized for ~200 msg/s with brief burst headroom
  const bucket = newConnectionBucket()

  // Track clientIDs that this connection owns (populated when awareness arrives)
  const connClientIDs = new Set()

  // Initial sync: send sync step 1 + initial awareness
  {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    conn.send(encoding.toUint8Array(enc))
  }
  {
    const states = Array.from(room.awareness.getStates().keys())
    if (states.length > 0) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, states),
      )
      conn.send(encoding.toUint8Array(enc))
    }
  }

  const onDocUpdate = (update, origin) => {
    if (origin === conn) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeUpdate(enc, update)
    try { conn.send(encoding.toUint8Array(enc)) } catch {}
  }
  room.doc.on("update", onDocUpdate)

  const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    if (origin === conn) return
    const changed = added.concat(updated).concat(removed)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed))
    try { conn.send(encoding.toUint8Array(enc)) } catch {}
  }
  room.awareness.on("update", onAwarenessUpdate)

  // Ping/pong
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) { conn.terminate(); return }
    pongReceived = false
    try { conn.ping() } catch { conn.terminate() }
  }, PING_INTERVAL)
  conn.on("pong", () => { pongReceived = true })

  conn.on("message", (raw) => {
    if (!bucket.consume()) {
      // Drop this message; possibly close if the bucket has overflowed
      // sustainedly (a client that's blasting at 5x limit for 30s is misbehaving).
      if (bucket.shouldTerminate()) {
        console.warn(`[room ${roomName}] terminating ${auth.user.id} for sustained rate violation`)
        try { conn.close(1008, "rate limit") } catch {}
      }
      return
    }
    try {
      const message = new Uint8Array(raw)
      const dec = decoding.createDecoder(message)
      const type = decoding.readVarUint(dec)
      if (type === MESSAGE_SYNC) {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(dec, enc, room.doc, conn)
        if (encoding.length(enc) > 1) conn.send(encoding.toUint8Array(enc))
      } else if (type === MESSAGE_AWARENESS) {
        const awarenessUpdate = decoding.readVarUint8Array(dec)
        // Track which clientIDs this connection is sending for (for disconnect cleanup)
        const prevSize = room.awareness.getStates().size
        awarenessProtocol.applyAwarenessUpdate(room.awareness, awarenessUpdate, conn)
        // Any new state keys added by this update belong to this connection
        room.awareness.getStates().forEach((_state, clientId) => {
          if (clientId !== room.awareness.clientID) connClientIDs.add(clientId)
        })
        void prevSize // suppress unused warning
      }
    } catch (e) {
      console.error("message handler error:", e)
    }
  })

  conn.on("close", async () => {
    clearInterval(pingInterval)
    room.doc.off("update", onDocUpdate)
    room.awareness.off("update", onAwarenessUpdate)
    if (connClientIDs.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(connClientIDs), conn)
    }
    room.conns.delete(conn)
    room.popToken(auth.token)
    userTrack.release()
    console.log(`[room ${roomName}] -1 (${room.conns.size} remaining)`)
    if (room.conns.size === 0) {
      await room.flush()
      room.scheduleIdleGC()
    }
  })
}

// ── HTTP + WebSocket startup ────────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      ok:        true,
      rooms:     rooms.size,
      uptime:    process.uptime(),
      hasAuth:   !!PERCY_JWT_SECRET,
      transport: "y-websocket-protocol",
    }))
    return
  }
  res.writeHead(200, { "content-type": "text/plain" })
  res.end("Percy collaboration server. Connect via WebSocket.")
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on("upgrade", (request, socket, head) => {
  authenticate(request)
    .then((auth) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleConnection(ws, request, auth).catch((e) => {
          console.error("connection setup failed:", e)
          try { ws.close() } catch {}
        })
      })
    })
    .catch((e) => {
      console.warn("auth rejected:", e.message)
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
    })
})

httpServer.listen(PORT, HOST, () => {
  const rl = rateLimitConfig()
  console.log(`Percy collab server on ws://${HOST}:${PORT}`)
  console.log(`  auth:        ${PERCY_JWT_SECRET ? "JWT verification enabled" : "DISABLED (set PERCY_JWT_SECRET)"}`)
  console.log(`  api base:    ${process.env.PERCY_API_BASE || "http://localhost:8000"}`)
  console.log(`  save-back:   every ${SAVE_BACK_INTERVAL}ms of activity`)
  console.log(`  snapshots:   every ${SNAPSHOT_INTERVAL}ms`)
  console.log(`  rate limit:  ${rl.msgPerSec} msg/s/conn · ${rl.userConcurrentConns} conns/user · ${rl.maxRooms} rooms max`)
  console.log(`  backplane:   ${backplane ? "Redis (multi-instance fan-out)" : "single-instance (set REDIS_URL to enable)"}`)
})

// ── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown() {
  console.log("shutting down…")
  await Promise.all([...rooms.values()].map((r) => r.flush()))
  for (const conn of wss.clients) { try { conn.close() } catch {} }
  httpServer.close(() => process.exit(0))
}
process.on("SIGINT",  shutdown)
process.on("SIGTERM", shutdown)
