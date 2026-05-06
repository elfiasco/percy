/**
 * Rate limits for the collab server. Three policies, all configurable via env:
 *
 *   1. Per-connection message rate     (PERCY_RATELIMIT_MSG_PER_SEC, default 200)
 *   2. Per-user concurrent connections (PERCY_RATELIMIT_USER_CONNS,  default 8)
 *   3. Server-wide concurrent rooms    (PERCY_RATELIMIT_MAX_ROOMS,    default 10000)
 *
 * The defaults give plenty of headroom for normal use (a fast typist sends
 * ~5-15 Yjs updates per second; 8 concurrent connections covers a user with
 * multiple tabs and a phone). Tune down if abuse shows up.
 *
 * Per-connection rate limiting uses a simple token bucket. When the bucket
 * empties, further messages from that connection are dropped (logged + the
 * connection is closed if the limit is exceeded sustainedly — 5x in a 30s window).
 */

const MSG_PER_SEC   = parseInt(process.env.PERCY_RATELIMIT_MSG_PER_SEC || "200", 10)
const USER_CONNS    = parseInt(process.env.PERCY_RATELIMIT_USER_CONNS  || "8",   10)
const MAX_ROOMS     = parseInt(process.env.PERCY_RATELIMIT_MAX_ROOMS   || "10000", 10)
const VIOLATION_WINDOW_MS    = 30_000
const VIOLATION_TERMINATE_AT = 5

// ── Token bucket per connection ─────────────────────────────────────────────

export class TokenBucket {
  constructor(rate, capacity = rate) {
    this.rate     = rate         // tokens added per second
    this.capacity = capacity     // max tokens held at once
    this.tokens   = capacity
    this.last     = Date.now()
    this.violations = []         // timestamps of overflow events
  }

  consume(n = 1) {
    const now = Date.now()
    const elapsed = (now - this.last) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate)
    this.last = now
    if (this.tokens < n) {
      this.violations.push(now)
      // Drop violations older than the window
      const cutoff = now - VIOLATION_WINDOW_MS
      while (this.violations.length > 0 && this.violations[0] < cutoff) {
        this.violations.shift()
      }
      return false
    }
    this.tokens -= n
    return true
  }

  /** True when this connection has overflowed enough to merit termination. */
  shouldTerminate() {
    return this.violations.length >= VIOLATION_TERMINATE_AT
  }
}

// ── Per-user concurrent-connection counter ─────────────────────────────────

const userConnections = new Map()  // userId → number

export function trackUserConnection(userId) {
  if (!userId || userId === "anonymous") return { ok: true, release: () => {} }
  const current = userConnections.get(userId) ?? 0
  if (current >= USER_CONNS) {
    return { ok: false, reason: `too many concurrent connections (${current}/${USER_CONNS})`, release: () => {} }
  }
  userConnections.set(userId, current + 1)
  return {
    ok: true,
    release: () => {
      const n = (userConnections.get(userId) ?? 1) - 1
      if (n <= 0) userConnections.delete(userId)
      else        userConnections.set(userId, n)
    },
  }
}

// ── Server-wide room budget ────────────────────────────────────────────────

export function checkRoomBudget(roomCount) {
  if (roomCount >= MAX_ROOMS) {
    return { ok: false, reason: `room budget exceeded (${roomCount}/${MAX_ROOMS})` }
  }
  return { ok: true }
}

// ── Factory: token bucket sized to MSG_PER_SEC, with burst headroom ────────

export function newConnectionBucket() {
  // Capacity = 2x rate so a brief flurry (e.g. paste-large-text) doesn't drop.
  return new TokenBucket(MSG_PER_SEC, MSG_PER_SEC * 2)
}

export function rateLimitConfig() {
  return {
    msgPerSec:           MSG_PER_SEC,
    userConcurrentConns: USER_CONNS,
    maxRooms:            MAX_ROOMS,
  }
}
