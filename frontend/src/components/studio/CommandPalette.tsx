import { useState, useEffect, useRef, useCallback, useMemo } from "react"
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

interface StudioAction {
  id: string
  label: string
  icon: string
  keywords: string[]
  run: () => void
}

interface Props {
  docId: string
  onClose: () => void
  onJump: (slideN: number, elementId: string) => void
  actions?: StudioAction[]
}

export default function CommandPalette({ docId, onClose, onJump, actions = [] }: Props) {
  const [query, setQuery]         = useState("")
  const [results, setResults]     = useState<ElementSearchResult[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading]     = useState(false)
  const inputRef                  = useRef<HTMLInputElement>(null)
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const isActionMode = query.startsWith(">")
  const actionQuery = isActionMode ? query.slice(1).trim().toLowerCase() : ""

  const filteredActions = useMemo(() => {
    if (!isActionMode) return []
    if (!actionQuery) return actions
    return actions.filter(a =>
      a.label.toLowerCase().includes(actionQuery) ||
      a.keywords.some(k => k.toLowerCase().includes(actionQuery))
    )
  }, [isActionMode, actionQuery, actions])

  const fetchElements = useCallback((q: string) => {
    setLoading(true)
    searchElements(docId, q)
      .then((r) => { setResults(r); setActiveIdx(0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId])

  useEffect(() => { if (!isActionMode) fetchElements("") }, [fetchElements, isActionMode])

  const handleChange = useCallback((val: string) => {
    setQuery(val)
    setActiveIdx(0)
    if (val.startsWith(">")) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetchElements(val), 200)
  }, [fetchElements])

  const commitElement = useCallback((r: ElementSearchResult) => {
    onJump(r.slide_n, r.element_id)
    onClose()
  }, [onJump, onClose])

  const commitAction = useCallback((a: StudioAction) => {
    a.run()
    onClose()
  }, [onClose])

  const listLength = isActionMode ? filteredActions.length : results.length

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, listLength - 1)) }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === "Enter") {
        e.preventDefault()
        if (isActionMode) {
          if (filteredActions[activeIdx]) commitAction(filteredActions[activeIdx])
        } else {
          if (results[activeIdx]) commitElement(results[activeIdx])
        }
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [results, filteredActions, activeIdx, isActionMode, commitElement, commitAction, onClose, listLength])

  return (
    <div
      className="fixed inset-0 z-[99998] flex items-start justify-center pt-24 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[540px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge">
          <span className="text-muted text-sm">{isActionMode ? "⚡" : "🔍"}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={isActionMode ? "Run action…" : "Jump to element… (type > for actions)"}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-muted/50 focus:outline-none"
          />
          {loading && <span className="text-[10px] text-muted animate-pulse">…</span>}
          <kbd className="text-[10px] text-muted/50 border border-edge rounded px-1">Esc</kbd>
        </div>

        <div className="overflow-y-auto max-h-80 scrollbar-thin">
          {isActionMode ? (
            filteredActions.length === 0 ? (
              <div className="text-[11px] text-muted/50 text-center py-6">No actions found</div>
            ) : (
              filteredActions.map((a, idx) => (
                <button
                  key={a.id}
                  onClick={() => commitAction(a)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === activeIdx ? "bg-accent/15" : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-base w-5 shrink-0 text-center">{a.icon}</span>
                  <span className="text-[12px] text-slate-200">{a.label}</span>
                </button>
              ))
            )
          ) : (
            results.length === 0 && !loading ? (
              <div className="text-[11px] text-muted/50 text-center py-6">No elements found</div>
            ) : (
              results.map((r, idx) => (
                <button
                  key={`${r.slide_n}-${r.element_id}`}
                  onClick={() => commitElement(r)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === activeIdx ? "bg-accent/15" : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-[10px] font-mono text-paper w-4 shrink-0 mt-0.5 text-center">
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
              ))
            )
          )}
        </div>

        <div className="px-4 py-1.5 border-t border-edge flex items-center gap-3 text-[9px] text-muted/40">
          <span>↑↓ navigate</span>
          <span>↵ {isActionMode ? "run" : "jump"}</span>
          <span>Esc close</span>
          {!isActionMode && <span className="ml-auto">{results.length} elements</span>}
          {isActionMode && <span className="ml-auto">{filteredActions.length} actions</span>}
        </div>
      </div>
    </div>
  )
}
