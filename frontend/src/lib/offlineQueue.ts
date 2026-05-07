/**
 * IndexedDB-backed write-ahead log for studio API mutations.
 *
 * When the browser is offline (or the fetch fails with a network error),
 * PATCH/POST/DELETE calls are stored here and replayed in order once
 * connectivity is restored. The Yjs Y.Doc already provides the optimistic
 * in-memory view, so callers don't need a synthetic response — they just
 * need confidence that the server will eventually receive the mutation.
 *
 * Usage:
 *   import { offlineFetch, initOfflineSync } from "./offlineQueue"
 *
 *   // Call once at app startup to wire the `online` listener:
 *   initOfflineSync()
 *
 *   // In studioApi.ts, replace fetch() write calls with offlineFetch():
 *   const res = await offlineFetch(url, { method: "PATCH", body: ... })
 */

const DB_NAME    = "percy-offline-queue"
const STORE_NAME = "writes"
const DB_VERSION = 1

interface PendingWrite {
  id?:      number
  url:      string
  method:   string
  body:     string | null
  headers:  Record<string, string>
  queuedAt: number
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function enqueue(entry: Omit<PendingWrite, "id">): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite")
    const st  = tx.objectStore(STORE_NAME)
    const req = st.add(entry)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

async function dequeue(id: number): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite")
    const st  = tx.objectStore(STORE_NAME)
    const req = st.delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

async function getAllPending(): Promise<PendingWrite[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readonly")
    const st  = tx.objectStore(STORE_NAME)
    const req = st.getAll()
    req.onsuccess = () => resolve(req.result as PendingWrite[])
    req.onerror   = () => reject(req.error)
  })
}

// ── Queue drainer ─────────────────────────────────────────────────────────────

let draining = false

export async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const pending = await getAllPending()
    for (const entry of pending) {
      try {
        const res = await fetch(entry.url, {
          method:  entry.method,
          headers: entry.headers,
          body:    entry.body,
        })
        if (res.ok || res.status < 500) {
          // 4xx means the request itself was bad (stale id, validation error) —
          // discard rather than retrying forever.
          await dequeue(entry.id!)
        }
        // 5xx: server error — leave in queue, will retry next time online.
      } catch {
        // Still offline or transient error — stop draining, leave queue intact.
        break
      }
    }
  } finally {
    draining = false
  }
}

// ── `online` listener ─────────────────────────────────────────────────────────

let initialized = false

export function initOfflineSync(): () => void {
  if (initialized) return () => {}
  initialized = true
  const handler = () => { drainQueue().catch(() => {}) }
  window.addEventListener("online", handler)
  // Also drain once at init in case the page was loaded while offline
  // and then came back before the listener was registered.
  if (navigator.onLine) drainQueue().catch(() => {})
  return () => window.removeEventListener("online", handler)
}

// ── Public fetch wrapper ──────────────────────────────────────────────────────

/**
 * Drop-in replacement for fetch() for write mutations.
 *
 * - GET requests pass through unchanged.
 * - Non-GET requests: if the fetch throws a network error (TypeError),
 *   the request is stored in IndexedDB to be replayed on reconnect and
 *   an `OfflineQueuedError` is thrown so callers can distinguish it from
 *   a real server error.
 */

export class OfflineQueuedError extends Error {
  constructor() { super("Request queued for offline replay") }
}

export async function offlineFetch(
  url:  string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase()

  // Pass reads through directly — never queue GET.
  if (method === "GET") return fetch(url, init)

  // Capture headers as a plain object so they're serialisable.
  const headers: Record<string, string> = {}
  if (init.headers) {
    new Headers(init.headers).forEach((v, k) => { headers[k] = v })
  }

  try {
    const res = await fetch(url, init)
    return res
  } catch (err) {
    // TypeError = network error (DNS, TCP, offline). Not a fetch-level HTTP error.
    if (err instanceof TypeError) {
      const entry: Omit<PendingWrite, "id"> = {
        url,
        method,
        body:     typeof init.body === "string" ? init.body : null,
        headers,
        queuedAt: Date.now(),
      }
      await enqueue(entry).catch(() => {})
      throw new OfflineQueuedError()
    }
    throw err
  }
}
