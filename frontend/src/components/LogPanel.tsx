import { useState, useEffect, useRef } from "react"
import type { LogEntry } from "../lib/logger"
import { subscribe } from "../lib/logger"
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react"

const LEVEL_CLS: Record<string, string> = {
  info:    "text-slate-400",
  success: "text-good",
  warn:    "text-partial",
  error:   "text-bad",
}
const LEVEL_PREFIX: Record<string, string> = {
  info:    "·",
  success: "✓",
  warn:    "⚠",
  error:   "✗",
}

export default function LogPanel() {
  const [entries, setEntries]   = useState<LogEntry[]>([])
  const [open, setOpen]         = useState(true)
  const [selected, setSelected] = useState<LogEntry | null>(null)
  const [cleared, setCleared]   = useState(0)   // used to reset display
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribe(setEntries), [])

  const visible = entries.slice(0, entries.length - cleared)

  return (
    <div className={`shrink-0 border-t border-edge bg-surface flex flex-col
                     transition-all ${open ? "h-40" : "h-8"}`}>
      {/* header bar */}
      <div
        className="flex items-center gap-2 px-3 h-8 cursor-pointer select-none shrink-0
                   hover:bg-white/5 border-b border-edge"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          Activity Log
        </span>
        <span className="text-xs text-muted bg-base rounded px-1">{visible.length}</span>
        <div className="ml-auto flex items-center gap-2">
          {open && (
            <button
              className="p-0.5 rounded hover:bg-white/10 text-muted"
              onClick={e => { e.stopPropagation(); setCleared(entries.length); setSelected(null) }}
              title="Clear log"
            >
              <Trash2 size={11} />
            </button>
          )}
          {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronUp size={12} className="text-muted" />}
        </div>
      </div>

      {/* log list + detail pane */}
      {open && (
        <div className="flex flex-1 min-h-0">
          {/* entries */}
          <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin font-mono text-xs">
            {visible.length === 0 && (
              <span className="text-muted px-3 py-1 block">No activity yet</span>
            )}
            {visible.map(e => (
              <div
                key={e.id}
                className={`flex gap-2 px-3 py-0.5 cursor-pointer hover:bg-white/5
                            ${selected?.id === e.id ? "bg-white/10" : ""}`}
                onClick={() => setSelected(s => s?.id === e.id ? null : e)}
              >
                <span className="text-slate-600 shrink-0">{e.ts}</span>
                <span className={`shrink-0 ${LEVEL_CLS[e.level]}`}>
                  {LEVEL_PREFIX[e.level]}
                </span>
                <span className={`truncate ${LEVEL_CLS[e.level]}`}>{e.msg}</span>
              </div>
            ))}
          </div>

          {/* detail pane */}
          {selected?.detail && (
            <div className="w-80 border-l border-edge overflow-y-auto scrollbar-thin
                            font-mono text-xs text-slate-400 px-2 py-1 bg-base/50">
              <pre className="whitespace-pre-wrap break-all">{selected.detail}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
