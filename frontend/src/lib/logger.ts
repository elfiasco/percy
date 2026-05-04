export type LogLevel = "info" | "success" | "warn" | "error"

export interface LogEntry {
  id: number
  ts: string
  level: LogLevel
  msg: string
  detail?: string
}

type Listener = (entries: LogEntry[]) => void

let _seq = 0
const _entries: LogEntry[] = []
const _listeners = new Set<Listener>()

function _ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
}

export function log(level: LogLevel, msg: string, detail?: unknown) {
  const entry: LogEntry = {
    id:     ++_seq,
    ts:     _ts(),
    level,
    msg,
    detail: detail !== undefined ? JSON.stringify(detail, null, 2) : undefined,
  }
  _entries.unshift(entry)          // newest first
  if (_entries.length > 200) _entries.pop()
  _listeners.forEach(fn => fn([..._entries]))
  // also mirror to browser console
  const fn = level === "error" ? console.error
           : level === "warn"  ? console.warn
           : console.log
  fn(`[percy] ${msg}`, detail ?? "")
}

export function subscribe(fn: Listener): () => void {
  _listeners.add(fn)
  fn([..._entries])
  return () => _listeners.delete(fn)
}
