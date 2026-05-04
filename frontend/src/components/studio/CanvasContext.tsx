import { createContext, useContext, type RefObject } from "react"

export interface CanvasCtx {
  containerRef: RefObject<HTMLDivElement | null>
  slideWidthIn: number
  slideHeightIn: number
}

export const CanvasContext = createContext<CanvasCtx | null>(null)

export function useCanvas(): CanvasCtx {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error("useCanvas must be used inside CanvasContext.Provider")
  return ctx
}
