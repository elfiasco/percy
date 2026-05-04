/**
 * LayersPanel — lists all elements on the current slide in z-order (top to bottom).
 * Click row to select. Eye/lock toggles inline. Drag to reorder z-index.
 */

import { useState, useRef, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { updateElementPosition } from "../../lib/studioApi"

const TYPE_ICON: Record<string, string> = {
  BridgeShape:     "◻",
  BridgeText:      "T",
  BridgeChart:     "📊",
  BridgeTable:     "⊞",
  BridgeImage:     "🖼",
  BridgeFreeform:  "✏",
  BridgeConnector: "↗",
  BridgeGroup:     "⊡",
}

interface Props {
  docId: string
  slideN: number
  elements: StudioElement[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onToggleLock?: (id: string, locked: boolean) => void
  onToggleHidden?: (id: string, hidden: boolean) => void
  onReorder?: () => void
}

export default function LayersPanel({
  docId, slideN, elements, selectedIds, onSelect, onToggleLock, onToggleHidden, onReorder,
}: Props) {
  // Sort descending by z_index so highest z is at top
  const sorted = [...elements].sort((a, b) => b.z_index - a.z_index)

  const [dragId, setDragId]         = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragIdxRef                  = useRef<number>(-1)

  const handleDragStart = useCallback((e: React.DragEvent, id: string, idx: number) => {
    setDragId(id)
    dragIdxRef.current = idx
    e.dataTransfer.effectAllowed = "move"
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget(id)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string, targetIdx: number) => {
    e.preventDefault()
    const srcId  = dragId
    const srcIdx = dragIdxRef.current
    setDragId(null)
    setDropTarget(null)
    if (!srcId || srcId === targetId) return

    // Reassign z-indices: swap the two elements' z values
    const srcEl  = elements.find((el) => el.id === srcId)
    const tgtEl  = elements.find((el) => el.id === targetId)
    if (!srcEl || !tgtEl) return

    // Move src to target's z_index, shift everything in between
    const srcZ = srcEl.z_index
    const tgtZ = tgtEl.z_index
    if (srcZ === tgtZ) return

    // Simple swap for now — just swap the two z values
    try {
      await Promise.all([
        updateElementPosition(docId, slideN, srcId, { z_index: tgtZ }),
        updateElementPosition(docId, slideN, targetId, { z_index: srcZ }),
      ])
      onReorder?.()
    } catch (err) {
      console.error("z-reorder failed:", err)
    }
    void srcIdx; void targetIdx
  }, [dragId, elements, docId, slideN, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDropTarget(null)
  }, [])

  return (
    <div className="w-52 shrink-0 border-l border-edge bg-surface flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-edge shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-muted uppercase tracking-widest font-semibold">Layers</span>
        <span className="text-[10px] text-muted/50 ml-auto">{elements.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {sorted.map((el, idx) => {
          const isSelected = selectedIds.has(el.id)
          const isDragging = dragId === el.id
          const isTarget   = dropTarget === el.id
          return (
            <div
              key={el.id}
              draggable
              onDragStart={(e) => handleDragStart(e, el.id, idx)}
              onDragOver={(e) => handleDragOver(e, el.id)}
              onDrop={(e) => handleDrop(e, el.id, idx)}
              onDragEnd={handleDragEnd}
              onClick={(e) => onSelect(el.id, e.shiftKey || e.ctrlKey || e.metaKey)}
              className={[
                "px-2 py-1.5 border-b border-edge/30 last:border-b-0 cursor-pointer flex items-center gap-1.5 group",
                isSelected ? "bg-accent/15" : "hover:bg-white/5",
                isDragging ? "opacity-40" : "",
                isTarget   ? "border-t-2 border-t-accent" : "",
              ].join(" ")}
            >
              {/* drag grip */}
              <span className="text-muted/30 group-hover:text-muted/60 text-[10px] cursor-grab shrink-0 select-none">
                ⠿
              </span>

              {/* type icon */}
              <span className={`text-[11px] shrink-0 w-4 text-center ${isSelected ? "text-accent-light" : "text-muted/50"}`}>
                {TYPE_ICON[el.type] ?? "□"}
              </span>

              {/* name */}
              <span
                className={`text-[11px] truncate flex-1 min-w-0 ${isSelected ? "text-slate-200 font-medium" : "text-slate-400"} ${el.hidden ? "line-through opacity-50" : ""}`}
                title={el.name}
              >
                {el.name !== el.id ? el.name : el.label}
              </span>

              {/* visibility toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleHidden?.(el.id, !el.hidden) }}
                title={el.hidden ? "Show element" : "Hide element"}
                className={`shrink-0 text-[11px] w-4 text-center transition-colors ${el.hidden ? "text-muted/30" : "text-muted/50 group-hover:text-slate-300"}`}
              >
                {el.hidden ? "○" : "●"}
              </button>

              {/* lock toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleLock?.(el.id, !el.locked) }}
                title={el.locked ? "Unlock element" : "Lock element"}
                className={`shrink-0 text-[10px] w-4 text-center transition-colors ${el.locked ? "text-amber-400/70" : "text-muted/30 group-hover:text-muted/60"}`}
              >
                {el.locked ? "🔒" : "○"}
              </button>
            </div>
          )
        })}
        {sorted.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted/40 italic text-center">No elements</div>
        )}
      </div>
    </div>
  )
}
