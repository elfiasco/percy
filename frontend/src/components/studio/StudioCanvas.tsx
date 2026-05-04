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
  onElementRotated?: (el: StudioElement) => void
}

export default function StudioCanvas({ docId, slideN, slideWidthIn, slideHeightIn, refreshKey, onSelectElement, onElementRotated }: Props) {
  const containerRef               = useRef<HTMLDivElement>(null)
  const [elements, setElements]     = useState<StudioElement[]>([])
  const [bgColor, setBgColor]       = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [renderKeys, setRenderKeys] = useState<Record<string, number>>({})

  // ── fetch elements when slide changes or parent refreshes ─────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSlideElements(docId, slideN)
      .then((res) => {
        if (!cancelled) {
          setElements(res.elements)
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

  // ── keyboard: Escape deselects ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null)
        onSelectElement(null)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onSelectElement])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    const el = elements.find((e) => e.id === id) ?? null
    onSelectElement(el)
  }, [elements, onSelectElement])

  const handleDeselect = useCallback(() => {
    setSelectedId(null)
    onSelectElement(null)
  }, [onSelectElement])

  const handleCommit = useCallback(async (
    id: string,
    leftIn: number, topIn: number, widthIn: number, heightIn: number,
  ) => {
    try {
      const updated = await updateElementPosition(docId, slideN, id, {
        left_in: leftIn, top_in: topIn, width_in: widthIn, height_in: heightIn,
      })
      setElements((prev) => prev.map((el) => el.id === id ? updated : el))
      onSelectElement(updated)
      setRenderKeys((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    } catch (e) {
      console.error("element update failed:", e)
    }
  }, [docId, slideN, onSelectElement])

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

  const [zoom, setZoom] = useState(1.0)

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
          >
            {/* slide background — use document background color or white */}
            <div className="absolute inset-0" style={{ background: bgColor ?? "#FFFFFF" }} />

            {/* element overlays — each carries its own render PNG */}
            {[...elements].sort((a, b) => a.z_index - b.z_index).map((el) => (
              <ElementOverlay
                key={el.id}
                element={el}
                selected={el.id === selectedId}
                docId={docId}
                slideN={slideN}
                renderKey={renderKeys[el.id] ?? 0}
                onSelect={handleSelect}
                onCommit={handleCommit}
                onRotate={handleRotate}
              />
            ))}

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
          {selectedId && (
            <span className="text-accent-light">
              · {elements.find((e) => e.id === selectedId)?.name ?? selectedId} selected
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            >−</button>
            <span
              className="font-mono w-10 text-center cursor-pointer"
              onClick={() => setZoom(1)}
              title="Click to reset zoom"
            >{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            >+</button>
          </span>
        </div>
      </div>
    </CanvasContext.Provider>
  )
}
