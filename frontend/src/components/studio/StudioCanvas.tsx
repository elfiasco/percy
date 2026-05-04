import { useEffect, useRef, useState, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchSlideElements, updateElementPosition } from "../../lib/studioApi"
import { CanvasContext } from "./CanvasContext"
import ElementOverlay from "./ElementOverlay"

interface Props {
  docId: string
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
  refreshKey?: number
  onSelectElement: (el: StudioElement | null) => void
  onMultiSelect?: (ids: Set<string>) => void
  onElementRotated?: (el: StudioElement) => void
}

export default function StudioCanvas({ docId, slideN, slideWidthIn, slideHeightIn, refreshKey, onSelectElement, onMultiSelect, onElementRotated }: Props) {
  const containerRef               = useRef<HTMLDivElement>(null)
  const [elements, setElements]     = useState<StudioElement[]>([])
  const [bgColor, setBgColor]       = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [renderKeys, setRenderKeys] = useState<Record<string, number>>({})
  const elementsRef                 = useRef<StudioElement[]>([])
  const [zoom, setZoom]             = useState(1.0)
  const [rubberBand, setRubberBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const rbStart                     = useRef<{ x: number; y: number } | null>(null)
  const [gridOn, setGridOn]         = useState(false)
  const [snapOn, setSnapOn]         = useState(false)
  const GRID_IN                     = 0.25

  // ── fetch elements when slide changes or parent refreshes ─────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSlideElements(docId, slideN)
      .then((res) => {
        if (!cancelled) {
          setElements(res.elements)
          elementsRef.current = res.elements
          setBgColor(res.background_color)
          setLoading(false)
          // bump all render keys so every element PNG reloads
          setRenderKeys((prev) => {
            const next: Record<string, number> = {}
            for (const el of res.elements) {
              next[el.id] = (prev[el.id] ?? 0) + 1
            }
            return next
          })
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [docId, slideN, refreshKey])

  // ── keyboard: Escape deselects, G=grid, S=snap ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return
      if (e.key === "Escape") { setSelectedIds(new Set()); onSelectElement(null); onMultiSelect?.(new Set()) }
      if (e.key === "g" || e.key === "G") { if (!e.ctrlKey && !e.metaKey) setGridOn((v) => !v) }
      if (e.key === "s" || e.key === "S") { if (!e.ctrlKey && !e.metaKey) setSnapOn((v) => !v) }
      // Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0 reset
      if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom((z) => Math.min(4, z + 0.25))
      }
      if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom((z) => Math.max(0.25, z - 0.25))
      }
      if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setZoom(1)
      }
      // Ctrl+A — select all
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const all = new Set(elementsRef.current.map((el) => el.id))
        onSelectElement(null)
        onMultiSelect?.(all)
        setSelectedIds(all)
      }
      // Tab / Shift+Tab — cycle through elements
      if (e.key === "Tab") {
        e.preventDefault()
        const sorted = [...elementsRef.current].sort((a, b) => a.z_index - b.z_index)
        if (!sorted.length) return
        setSelectedIds((prev) => {
          const prevId = prev.size === 1 ? [...prev][0] : null
          const idx = prevId ? sorted.findIndex((el) => el.id === prevId) : -1
          const next = e.shiftKey
            ? sorted[(idx - 1 + sorted.length) % sorted.length]
            : sorted[(idx + 1) % sorted.length]
          const next_set = new Set([next.id])
          onSelectElement(next)
          onMultiSelect?.(next_set)
          return next_set
        })
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onSelectElement])

  const handleSelect = useCallback((id: string, shiftKey = false) => {
    setSelectedIds((prev) => {
      const next = shiftKey ? new Set(prev) : new Set<string>()
      if (shiftKey && prev.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      // notify parent
      if (next.size === 1) {
        const el = elements.find((e) => e.id === [...next][0]) ?? null
        onSelectElement(el)
      } else {
        onSelectElement(null)
      }
      onMultiSelect?.(next)
      return next
    })
  }, [elements, onSelectElement, onMultiSelect])

  const handleDeselect = useCallback(() => {
    setSelectedIds(new Set())
    onSelectElement(null)
    onMultiSelect?.(new Set())
  }, [onSelectElement, onMultiSelect])

  const snap = useCallback((v: number) => snapOn ? Math.round(v / GRID_IN) * GRID_IN : v, [snapOn, GRID_IN])

  const handleCommit = useCallback(async (
    id: string,
    leftIn: number, topIn: number, widthIn: number, heightIn: number,
  ) => {
    try {
      const updated = await updateElementPosition(docId, slideN, id, {
        left_in:   snap(leftIn),
        top_in:    snap(topIn),
        width_in:  snap(widthIn),
        height_in: snap(heightIn),
      })
      setElements((prev) => prev.map((el) => el.id === id ? updated : el))
      if (selectedIds.size <= 1) onSelectElement(updated)
      setRenderKeys((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    } catch (e) {
      console.error("element update failed:", e)
    }
  }, [docId, slideN, onSelectElement, snap, selectedIds])

  const handleMultiMove = useCallback(async (deltaLeftIn: number, deltaTopIn: number) => {
    const ids = [...selectedIds]
    const currentElements = elementsRef.current
    try {
      const updates = await Promise.all(
        ids.map((id) => {
          const el = currentElements.find((e) => e.id === id)
          if (!el) return Promise.resolve(null)
          return updateElementPosition(docId, slideN, id, {
            left_in: snap(el.left_in + deltaLeftIn),
            top_in:  snap(el.top_in  + deltaTopIn),
          })
        })
      )
      const valid = updates.filter((u): u is NonNullable<typeof u> => u !== null)
      setElements((prev) => {
        const map = new Map(valid.map((u) => [u.id, u]))
        return prev.map((el) => map.get(el.id) ?? el)
      })
      setRenderKeys((prev) => {
        const next = { ...prev }
        for (const u of valid) next[u.id] = (prev[u.id] ?? 0) + 1
        return next
      })
    } catch (e) {
      console.error("multi-move failed:", e)
    }
  }, [docId, slideN, selectedIds, snap])

  const handleRotate = useCallback(async (id: string, rotation: number) => {
    try {
      const updated = await updateElementPosition(docId, slideN, id, { rotation })
      setElements((prev) => prev.map((el) => el.id === id ? updated : el))
      onSelectElement(updated)
      onElementRotated?.(updated)
      setRenderKeys((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    } catch (e) {
      console.error("rotation update failed:", e)
    }
  }, [docId, slideN, onSelectElement, onElementRotated])

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top)  / rect.height) * 100
    rbStart.current = { x, y }
    setRubberBand(null)
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    e.stopPropagation()
  }, [])

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rbStart.current) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * 100
    const cy = ((e.clientY - rect.top)  / rect.height) * 100
    const { x, y } = rbStart.current
    setRubberBand({
      x: Math.min(x, cx), y: Math.min(y, cy),
      w: Math.abs(cx - x), h: Math.abs(cy - y),
    })
  }, [])

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = rbStart.current
    if (!start) return
    rbStart.current = null

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * 100
    const cy = ((e.clientY - rect.top)  / rect.height) * 100

    const rx = Math.min(start.x, cx)
    const ry = Math.min(start.y, cy)
    const rw = Math.abs(cx - start.x)
    const rh = Math.abs(cy - start.y)

    setRubberBand(null)

    if (rw < 0.5 && rh < 0.5) {
      handleDeselect()
      return
    }

    const inside = elementsRef.current.filter((el) => {
      const el_r = el.left_pct + el.width_pct
      const el_b = el.top_pct  + el.height_pct
      return el.left_pct < rx + rw && el_r > rx && el.top_pct < ry + rh && el_b > ry
    })

    if (inside.length === 0) {
      handleDeselect()
    } else {
      const ids = new Set(inside.map((el) => el.id))
      setSelectedIds(ids)
      if (inside.length === 1) {
        onSelectElement(inside[0])
      } else {
        onSelectElement(null)
      }
      onMultiSelect?.(ids)
    }
  }, [handleDeselect, onSelectElement, onMultiSelect])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom((z) => Math.min(4, Math.max(0.25, z - e.deltaY * 0.001)))
  }, [])

  const aspectRatio = slideWidthIn > 0 && slideHeightIn > 0
    ? slideWidthIn / slideHeightIn
    : 16 / 9

  return (
    <CanvasContext.Provider value={{ containerRef, slideWidthIn, slideHeightIn }}>
      <div
        className="flex flex-col items-center justify-center w-full h-full p-6 bg-base select-none overflow-auto"
        onWheel={handleWheel}
      >
        {/* canvas wrapper — maintains slide aspect ratio */}
        <div
          className="relative shadow-2xl shrink-0"
          style={{
            aspectRatio: `${aspectRatio}`,
            height: `${zoom * 85}vh`,
            minWidth: 0,
          }}
          onClick={handleDeselect}
        >
          <div
            ref={containerRef}
            className="absolute inset-0"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
          >
            {/* slide background — use document background color or white */}
            <div className="absolute inset-0" style={{ background: bgColor ?? "#FFFFFF" }} />

            {/* grid overlay */}
            {gridOn && slideWidthIn > 0 && slideHeightIn > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%", zIndex: 5000 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {Array.from({ length: Math.floor(slideWidthIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={`${(i * GRID_IN / slideWidthIn) * 100}%`}
                    y1="0%" x2={`${(i * GRID_IN / slideWidthIn) * 100}%`} y2="100%"
                    stroke="rgba(99,102,241,0.25)" strokeWidth={0.5}
                  />
                ))}
                {Array.from({ length: Math.floor(slideHeightIn / GRID_IN) + 1 }, (_, i) => (
                  <line
                    key={`h${i}`}
                    y1={`${(i * GRID_IN / slideHeightIn) * 100}%`}
                    x1="0%" y2={`${(i * GRID_IN / slideHeightIn) * 100}%`} x2="100%"
                    stroke="rgba(99,102,241,0.25)" strokeWidth={0.5}
                  />
                ))}
              </svg>
            )}

            {/* element overlays — each carries its own render PNG */}
            {[...elements].sort((a, b) => a.z_index - b.z_index).map((el) => (
              <ElementOverlay
                key={el.id}
                element={el}
                selected={selectedIds.has(el.id)}
                isMultiSelected={selectedIds.size > 1 && selectedIds.has(el.id)}
                snapEnabled={snapOn}
                otherElements={elements.filter((e) => e.id !== el.id)}
                docId={docId}
                slideN={slideN}
                renderKey={renderKeys[el.id] ?? 0}
                onSelect={handleSelect}
                onCommit={handleCommit}
                onMultiMove={handleMultiMove}
                onRotate={handleRotate}
              />
            ))}
            {/* multi-select bounding box */}
            {selectedIds.size > 1 && (() => {
              const sel = elements.filter((e) => selectedIds.has(e.id))
              if (!sel.length) return null
              const minL = Math.min(...sel.map((e) => e.left_pct))
              const minT = Math.min(...sel.map((e) => e.top_pct))
              const maxR = Math.max(...sel.map((e) => e.left_pct + e.width_pct))
              const maxB = Math.max(...sel.map((e) => e.top_pct + e.height_pct))
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${minL}%`, top: `${minT}%`,
                    width: `${maxR - minL}%`, height: `${maxB - minT}%`,
                    border: "2px dashed rgba(99,102,241,0.8)",
                    zIndex: 10000,
                    boxSizing: "border-box",
                  }}
                />
              )
            })()}

            {/* rubber-band selection rect */}
            {rubberBand && rubberBand.w > 0.2 && rubberBand.h > 0.2 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${rubberBand.x}%`, top: `${rubberBand.y}%`,
                  width: `${rubberBand.w}%`, height: `${rubberBand.h}%`,
                  border: "1.5px dashed rgba(99,102,241,0.9)",
                  background: "rgba(99,102,241,0.08)",
                  zIndex: 20000,
                  boxSizing: "border-box",
                }}
              />
            )}

            {/* loading shimmer */}
            {loading && (
              <div className="absolute inset-0 bg-base/60 flex items-center justify-center">
                <span className="text-xs text-muted animate-pulse">Loading elements…</span>
              </div>
            )}

            {/* error */}
            {error && !loading && (
              <div className="absolute bottom-2 left-2 text-xs text-bad bg-surface/90 px-2 py-1 rounded">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* status bar */}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted shrink-0">
          <span>{loading ? "…" : `${elements.length} element${elements.length !== 1 ? "s" : ""}`}</span>
          {selectedIds.size === 1 && (
            <span className="text-accent-light">
              · {elements.find((e) => e.id === [...selectedIds][0])?.name ?? [...selectedIds][0]} selected
            </span>
          )}
          {selectedIds.size > 1 && (
            <span className="text-indigo-300">
              · {selectedIds.size} elements selected
            </span>
          )}
          <button
            onClick={() => setGridOn((g) => !g)}
            title="Toggle grid overlay (0.25 in)"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              gridOn
                ? "bg-indigo-500/30 text-indigo-300 border-indigo-500/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setSnapOn((s) => !s)}
            title="Toggle snap to grid"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
              snapOn
                ? "bg-indigo-500/30 text-indigo-300 border-indigo-500/40"
                : "bg-white/5 border-edge hover:bg-white/10"
            }`}
          >
            Snap
          </button>
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              title="Zoom out (Ctrl+scroll)"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            >−</button>
            <span
              className="font-mono w-10 text-center cursor-pointer"
              onClick={() => setZoom(1)}
              title="Click to reset to 100%"
            >{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              title="Zoom in (Ctrl+scroll)"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            >+</button>
            <button
              onClick={() => setZoom(1)}
              title="Fit slide (100%)"
              className="text-[10px] px-1.5 rounded hover:bg-white/10 transition-colors text-muted"
            >Fit</button>
          </span>
        </div>
      </div>
    </CanvasContext.Provider>
  )
}
