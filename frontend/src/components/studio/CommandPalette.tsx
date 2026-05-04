import { useState, useEffect, useRef, useCallback } from "react"
import type { ElementSearchResult } from "../../lib/studioApi"
import { searchElements } from "../../lib/studioApi"

const TYPE_ICON: Record<string, string> = {
  BridgeText:      "T",
  BridgeShape:     "■",
  BridgeImage:     "🖼",
  BridgeChart:     "📊",
  BridgeTable:     "▦",
  BridgeConnector: "⟶",
  BridgeFreeform:  "✏",
  BridgeGroup:     "⊞",
}

interface Props {
  docId: string
  onClose: () => void
  onJump: (slideN: number, elementId: string) => void
}

export default function CommandPalette({ docId, onClose, onJump }: Props) {
  const [query, setQuery]         = useState("")
  const [results, setResults]     = useState<ElementSearchResult[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading]     = useState(false)
  const inputRef                  = useRef<HTMLInputElement>(null)
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const fetch = useCallback((q: string) => {
    setLoading(true)
    searchElements(docId, q)
      .then((r) => { setResults(r); setActiveIdx(0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  // initial load
  useEffect(() => { fetch("") }, [fetch])

  const handleChange = useCallback((val: string) => {
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetch(val), 200)
  }, [fetch])

  const commit = useCallback((r: ElementSearchResult) => {
    onJump(r.slide_n, r.element_id)
    onClose()
  }, [onJump, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)) }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === "Enter" && results[activeIdx]) { e.preventDefault(); commit(results[activeIdx]) }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [results, activeIdx, commit, onClose])

  return (
    <div
      className="fixed inset-0 z-[99998] flex items-start justify-center pt-24 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[540px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge">
          <span className="text-muted text-sm">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Jump to element…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-muted/50 focus:outline-none"
          />
          {loading && <span className="text-[10px] text-muted animate-pulse">…</span>}
          <kbd className="text-[10px] text-muted/50 border border-edge rounded px-1">Esc</kbd>
        </div>

        {/* results */}
        <div className="overflow-y-auto max-h-80 scrollbar-thin">
          {results.length === 0 && !loading && (
            <div className="text-[11px] text-muted/50 text-center py-6">No elements found</div>
          )}
          {results.map((r, idx) => (
            <button
              key={`${r.slide_n}-${r.element_id}`}
              onClick={() => commit(r)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                idx === activeIdx ? "bg-accent/15" : "hover:bg-white/5"
              }`}
            >
              <span className="text-[10px] font-mono text-indigo-300 w-4 shrink-0 mt-0.5 text-center">
                {TYPE_ICON[r.element_type] ?? "?"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-200 truncate">{r.name || r.label || r.element_id}</span>
                  <span className="text-[9px] text-muted/50 shrink-0">slide {r.slide_n}</span>
                </div>
                {r.preview && (
                  <div className="text-[10px] text-muted/60 truncate mt-0.5">{r.preview}</div>
                )}
              </div>
              <span className="text-[9px] text-muted/30 shrink-0 self-center">{r.element_type.replace("Bridge", "")}</span>
            </button>
          ))}
        </div>

        <div className="px-4 py-1.5 border-t border-edge flex items-center gap-3 text-[9px] text-muted/40">
          <span>↑↓ navigate</span>
          <span>↵ jump</span>
          <span>Esc close</span>
          <span className="ml-auto">{results.length} elements</span>
        </div>
      </div>
    </div>
  )
}
