/**
 * Redis pub/sub backplane for multi-instance fan-out.
 *
 * Without this, two collab server instances behind a load balancer have
 * disjoint Y.Docs per room — a user on instance A and a user on instance B
 * editing the same slide would never see each other.
 *
 * With this, every Yjs update made by a client on instance A is published
 * to a Redis channel keyed by room name; instance B subscribes to the same
 * channel and applies the update to its own Y.Doc, then forwards to its
 * connected clients.
 *
 *   client A → instance 1 → [Y.Doc 1] → publish to redis:room:<X>
 *                                        ↓
 *   client B ← instance 2 ← [Y.Doc 2] ← subscribe to redis:room:<X>
 *
 * Activated by setting REDIS_URL. Without it, the server runs single-instance
 * (current behavior).
 *
 * Latency: in-region Redis adds ~1-3ms to update propagation. Sticky sessions
 * are NOT required — any client can connect to any instance and stay in sync.
 */

import * as Y from "yjs"

const REDIS_URL = process.env.REDIS_URL || ""

export class Backplane {
  constructor(redisUrl) {
    this.url = redisUrl
    this.publisher = null
    this.subscriber = null
    this.rooms = new Map()  // roomName → { doc, instanceId }
    this.instanceId = Math.random().toString(36).slice(2, 10)
  }

  async connect() {
    if (this.publisher) return
    const { default: Redis } = await import("ioredis")
    this.publisher  = new Redis(this.url, { lazyConnect: true })
    this.subscriber = new Redis(this.url, { lazyConnect: true })
    await Promise.all([this.publisher.connect(), this.subscriber.connect()])
    this.subscriber.on("messageBuffer", (channelBuf, payloadBuf) => {
      const channel = channelBuf.toString()
      this._dispatchUpdate(channel, payloadBuf)
    })
    console.log(`backplane: connected (instance ${this.instanceId})`)
  }

  /** Bind a room's Y.Doc to the backplane. Subscribes to its channel and
   *  publishes outgoing updates. Idempotent. */
  async bindRoom(roomName, doc) {
    if (this.rooms.has(roomName)) return
    const channel = `percy:room:${roomName}`
    this.rooms.set(roomName, { doc, channel })

    // Outgoing: publish every Y.Doc update tagged with our instance id so
    // we can ignore our own echoes when they come back through subscribe.
    const onUpdate = (update, origin) => {
      // Updates that came IN from the backplane have origin === "backplane";
      // don't republish those (would cause infinite loop).
      if (origin === "backplane") return
      // Frame: [1-byte instance length][instance id][update bytes]
      const idBuf = Buffer.from(this.instanceId, "utf8")
      const buf = Buffer.concat([
        Buffer.from([idBuf.length]),
        idBuf,
        Buffer.from(update),
      ])
      this.publisher.publishBuffer(channel, buf).catch((e) => {
        console.warn(`backplane publish ${channel} failed:`, e.message)
      })
    }
    doc.on("update", onUpdate)
    // Tell ioredis to subscribe to this exact channel
    await this.subscriber.subscribe(channel)
    // Stash the unbinding so leaveRoom can clean up
    this.rooms.get(roomName)._onUpdate = onUpdate
  }

  /** Stop forwarding updates for a room (called when the room is GC'd). */
  async leaveRoom(roomName) {
    const entry = this.rooms.get(roomName)
    if (!entry) return
    entry.doc.off("update", entry._onUpdate)
    await this.subscriber.unsubscribe(entry.channel)
    this.rooms.delete(roomName)
  }

  _dispatchUpdate(channel, payload) {
    const entry = [...this.rooms.entries()].find(([_, v]) => v.channel === channel)
    if (!entry) return
    const [, { doc }] = entry
    // Decode framing
    const idLen = payload[0]
    const senderId = payload.slice(1, 1 + idLen).toString("utf8")
    const update = payload.slice(1 + idLen)
    if (senderId === this.instanceId) return  // ignore self-echo
    Y.applyUpdate(doc, new Uint8Array(update), "backplane")
  }

  async destroy() {
    if (!this.publisher) return
    for (const [name] of this.rooms) {
      await this.leaveRoom(name)
    }
    await this.publisher.quit().catch(() => {})
    await this.subscriber.quit().catch(() => {})
    console.log("backplane: disconnected")
  }
}

let _instance = null

/** Singleton accessor. Returns null if REDIS_URL is unset. */
export async function getBackplane() {
  if (!REDIS_URL) return null
  if (_instance) return _instance
  _instance = new Backplane(REDIS_URL)
  try {
    await _instance.connect()
  } catch (e) {
    console.warn(`backplane: connect failed (${e.message}); running single-instance`)
    _instance = null
  }
  return _instance
}
