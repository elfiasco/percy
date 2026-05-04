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
  onSelectElement: (el: StudioElement | null) => void
}

export default function StudioCanvas({ docId, slideN, slideWidthIn, slideHeightIn, onSelectElement }: Props) {
  const containerRef             = useRef<HTMLDivElement>(null)
  const [elements, setElements]  = useState<StudioElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState<string | null>(null)
  const [imgKey, setImgKey]      = useState(0)

  // ── fetch elements when slide changes ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSlideElements(docId, slideN)
      .then((res) => {
        if (!cancelled) {
          setElements(res.elements)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [docId, slideN])

  // ── keyboard: Escape deselects ─────────────────────────────────────────────
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
    } catch (e) {
      console.error("element update failed:", e)
    }
  }, [docId, slideN, onSelectElement])

  const aspectRatio = slideWidthIn > 0 && slideHeightIn > 0
    ? slideWidthIn / slideHeightIn
    : 16 / 9

  const slideImgUrl = `/api/docs/${docId}/slides/${slideN}/bridge.png?v=${imgKey}`

  return (
    <CanvasContext.Provider value={{ containerRef, slideWidthIn, slideHeightIn }}>
      <div className="flex flex-col items-center justify-center w-full h-full p-6 bg-base select-none">
        {/* canvas wrapper — maintains slide aspect ratio */}
        <div
          className="relative w-full shadow-2xl"
          style={{
            aspectRatio: `${aspectRatio}`,
            maxHeight: "100%",
            maxWidth: `calc(100vh * ${aspectRatio})`,
          }}
          onClick={handleDeselect}
        >
          <div
            ref={containerRef}
            className="absolute inset-0"
          >
            {/* slide image background */}
            <img
              src={slideImgUrl}
              alt={`Slide ${slideN}`}
              className="w-full h-full block"
              style={{ userSelect: "none", pointerEvents: "none" }}
              onError={() => setImgKey((k) => k + 1)}
              draggable={false}
            />

            {/* element overlays */}
            {elements.map((el) => (
              <ElementOverlay
                key={el.id}
                element={el}
                selected={el.id === selectedId}
                onSelect={handleSelect}
                onCommit={handleCommit}
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

        {/* element count badge */}
        <div className="mt-3 text-xs text-muted">
          {loading ? "…" : `${elements.length} element${elements.length !== 1 ? "s" : ""}`}
          {selectedId && (
            <span className="ml-2 text-accent-light">
              · {elements.find((e) => e.id === selectedId)?.name ?? selectedId} selected
            </span>
          )}
        </div>
      </div>
    </CanvasContext.Provider>
  )
}
