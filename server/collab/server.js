/**
 * Percy collaboration server — Yjs WebSocket relay.
 *
 * Architecture:
 *
 *   client (Tiptap + y-prosemirror + WebsocketProvider)
 *      ↕  WebSocket
 *   server (this file)
 *      ↕  Yjs sync protocol (binary frames)
 *   in-memory Y.Doc per room
 *      └── periodic snapshot to disk (./snapshots/<roomId>.bin)
 *
 * Each connection joins a room (the path of the WebSocket URL — e.g.
 * `ws://host/<docId>::slide-<n>`). Multiple connections to the same room
 * share a Y.Doc; Yjs handles conflict-free merges.
 *
 * Persistence: simple file-based for now. On disconnect from an empty
 * room, snapshot the Y.Doc state vector to ./snapshots/<roomId>.bin.
 * On first connect to an empty room, load the snapshot if it exists.
 *
 * # Run
 *
 *   cd server/collab
 *   npm install
 *   PORT=1234 node server.js
 *
 * # Configure the studio to use it
 *
 *   echo "VITE_YJS_WS_URL=ws://localhost:1234" >> frontend/.env.local
 *   # In Studio.tsx, change transport: "broadcast" → "websocket"
 *   npm run dev
 *
 * Two browser windows on different machines (or just two browsers on the
 * same machine) at the same studio URL will now sync.
 *
 * # Production hardening (not done here)
 *
 *   - Auth: validate the JWT in the connection's `token` query param against
 *     PERCY_JWT_SECRET, check user has access to the docId.
 *   - Persistence: swap the file-snapshot for Postgres (yjs_snapshots table).
 *   - Save back to Bridge: periodically run `tiptapToParagraphs` over each
 *     element's Y.XmlFragment and POST to the existing `/api/docs/.../text`
 *     endpoints, so the Y.Doc state and the Bridge JSON stay in sync.
 *   - Idle eviction: free Y.Docs after 5min of zero connections.
 *   - TLS: terminate at a reverse proxy (nginx, Caddy) or Cloudflare.
 */

import { WebSocketServer } from "ws"
import * as Y from "yjs"
import * as syncProtocol      from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { promises as fs } from "fs"
import path  from "path"
import http  from "http"

const PORT          = parseInt(process.env.PORT || "1234", 10)
const HOST          = process.env.HOST || "0.0.0.0"
const SNAPSHOT_DIR  = process.env.SNAPSHOT_DIR || "./snapshots"
const SNAPSHOT_DEBOUNCE_MS = 2000
const PING_INTERVAL = 30_000

// ── Yjs protocol message types (from y-protocols) ───────────────────────────
const MESSAGE_SYNC      = 0
const MESSAGE_AWARENESS = 1

// ── Room registry ────────────────────────────────────────────────────────────

class Room {
  constructor(name) {
    this.name      = name
    this.doc       = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)   // server has no awareness state
    this.conns     = new Set()
    this.snapshotPath = path.join(SNAPSHOT_DIR, encodeURIComponent(name) + ".bin")

    this._snapshotTimer = null
    const onUpdate = () => this._scheduleSnapshot()
    this.doc.on("update", onUpdate)
  }

  async loadSnapshot() {
    try {
      const buf = await fs.readFile(this.snapshotPath)
      Y.applyUpdate(this.doc, new Uint8Array(buf))
      console.log(`[room ${this.name}] loaded snapshot (${buf.length} bytes)`)
    } catch (e) {
      if (e.code !== "ENOENT") console.warn(`[room ${this.name}] snapshot load failed:`, e)
    }
  }

  _scheduleSnapshot() {
    if (this._snapshotTimer) clearTimeout(this._snapshotTimer)
    this._snapshotTimer = setTimeout(() => this._writeSnapshot(), SNAPSHOT_DEBOUNCE_MS)
  }

  async _writeSnapshot() {
    this._snapshotTimer = null
    try {
      const update = Y.encodeStateAsUpdate(this.doc)
      await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
      await fs.writeFile(this.snapshotPath, update)
    } catch (e) {
      console.error(`[room ${this.name}] snapshot write failed:`, e)
    }
  }

  /** Broadcast a binary message to every connected client except `origin`. */
  broadcast(origin, message) {
    for (const conn of this.conns) {
      if (conn === origin) continue
      if (conn.readyState !== 1 /* OPEN */) continue
      try { conn.send(message) } catch (e) { console.warn("broadcast failed:", e) }
    }
  }

  destroy() {
    if (this._snapshotTimer) clearTimeout(this._snapshotTimer)
    this.doc.destroy()
  }
}

const rooms = new Map()

async function getOrCreateRoom(name) {
  let room = rooms.get(name)
  if (room) return room
  room = new Room(name)
  rooms.set(name, room)
  await room.loadSnapshot()
  return room
}

// ── WebSocket handler ───────────────────────────────────────────────────────

function handleConnection(conn, request) {
  const url = new URL(request.url, "http://localhost")
  // Room name is the URL path, stripped of leading slash.
  // Studio sends `ws://host/<docId>::slide-<n>` so the path is the room id.
  const roomName = decodeURIComponent(url.pathname.slice(1)) || "default"

  ;(async () => {
    const room = await getOrCreateRoom(roomName)
    room.conns.add(conn)
    console.log(`[room ${roomName}] +1 client (${room.conns.size} total)`)

    // Send initial sync step 1 — clients respond with their state vector
    // so we know what updates to ship.
    {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(enc, room.doc)
      conn.send(encoding.toUint8Array(enc))
    }
    // Send initial awareness state
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

    // Forward Yjs updates to other clients in the room
    const onDocUpdate = (update, origin) => {
      if (origin === conn) return  // don't echo
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_SYNC)
      syncProtocol.writeUpdate(enc, update)
      try { conn.send(encoding.toUint8Array(enc)) } catch {}
    }
    room.doc.on("update", onDocUpdate)

    const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === conn) return
      const changedClients = added.concat(updated).concat(removed)
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients),
      )
      try { conn.send(encoding.toUint8Array(enc)) } catch {}
    }
    room.awareness.on("update", onAwarenessUpdate)

    // Ping/pong to keep the connection alive through proxies
    let pongReceived = true
    const pingInterval = setInterval(() => {
      if (!pongReceived) { conn.terminate(); return }
      pongReceived = false
      try { conn.ping() } catch { conn.terminate() }
    }, PING_INTERVAL)
    conn.on("pong", () => { pongReceived = true })

    conn.on("message", (raw) => {
      try {
        const message = new Uint8Array(raw)
        const dec = decoding.createDecoder(message)
        const type = decoding.readVarUint(dec)
        if (type === MESSAGE_SYNC) {
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(dec, enc, room.doc, conn /* transactionOrigin */)
          if (encoding.length(enc) > 1) {
            conn.send(encoding.toUint8Array(enc))
          }
        } else if (type === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(dec),
            conn,
          )
        }
      } catch (e) {
        console.error("message handler error:", e)
      }
    })

    conn.on("close", () => {
      clearInterval(pingInterval)
      room.doc.off("update", onDocUpdate)
      room.awareness.off("update", onAwarenessUpdate)
      awarenessProtocol.removeAwarenessStates(room.awareness, [conn._clientID].filter(Boolean), conn)
      room.conns.delete(conn)
      console.log(`[room ${roomName}] -1 client (${room.conns.size} remaining)`)
      // Force a final snapshot so disconnect-with-pending-changes persists.
      room._scheduleSnapshot()
    })
  })().catch((e) => {
    console.error("connection setup failed:", e)
    try { conn.close() } catch {}
  })
}

// ── HTTP + WebSocket startup ────────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  // Tiny health endpoint
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }))
    return
  }
  res.writeHead(200, { "content-type": "text/plain" })
  res.end("Percy collaboration server. Connect via WebSocket.")
})

const wss = new WebSocketServer({ server: httpServer })
wss.on("connection", handleConnection)

httpServer.listen(PORT, HOST, () => {
  console.log(`Percy collab server listening on ws://${HOST}:${PORT}`)
  console.log(`Snapshots → ${path.resolve(SNAPSHOT_DIR)}`)
})

// ── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown() {
  console.log("shutting down…")
  // Force snapshot every active room
  await Promise.all([...rooms.values()].map((r) => r._writeSnapshot()))
  for (const conn of wss.clients) { try { conn.close() } catch {} }
  httpServer.close(() => process.exit(0))
}
process.on("SIGINT",  shutdown)
process.on("SIGTERM", shutdown)
