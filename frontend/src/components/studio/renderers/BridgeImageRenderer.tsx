import { useState } from "react"
import { elementPngUrl } from "../../../lib/studioApi"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

const BASE = "/api"

function rawImageUrl(docId: string, slideN: number, elementId: string, v: number): string {
  return `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/raw-image?v=${v}`
}

/**
 * Native renderer for BridgeImage.
 *
 * Uses the raw image bytes endpoint (/raw-image) so the image displays without
 * going through the matplotlib rendering pipeline. Applies CSS crop and
 * object-fit based on the element's style payload.
 *
 * Falls back to the element-png endpoint if the raw image is unavailable
 * (e.g., non-raster formats like EMF/WMF).
 */
function BridgeImageRendererImpl({
  element, docId, slideN, renderKey,
}: NativeRendererProps) {
  const [rawFailed, setRawFailed] = useState(false)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)
  const style = payload.style

  const rawSrc  = rawImageUrl(docId, slideN, element.id, renderKey)
  const pngSrc  = `${elementPngUrl(docId, slideN, element.id)}?v=${renderKey}`

  // CSS crop: OOXML crop is fraction of image size from each edge.
  const cropL = (style?.crop_left  ?? 0) * 100
  const cropR = (style?.crop_right ?? 0) * 100
  const cropT = (style?.crop_top   ?? 0) * 100
  const cropB = (style?.crop_bottom ?? 0) * 100
  const hasCrop = cropL + cropR + cropT + cropB > 0

  const wrapStyle: React.CSSProperties = {
    width:    "100%",
    height:   "100%",
    overflow: "hidden",
    opacity:  style?.opacity ?? 1,
    position: "relative",
  }

  // When cropped: the image is scaled up so the visible area fills the box.
  const scaleW = hasCrop ? 100 / (100 - cropL - cropR) : 1
  const scaleH = hasCrop ? 100 / (100 - cropT - cropB) : 1
  const imgStyle: React.CSSProperties = hasCrop
    ? {
        position:   "absolute",
        width:      `${scaleW * 100}%`,
        height:     `${scaleH * 100}%`,
        left:       `${-cropL * scaleW}%`,
        top:        `${-cropT * scaleH}%`,
        objectFit:  "fill",
        userSelect: "none",
        pointerEvents: "none",
      }
    : {
        width:      "100%",
        height:     "100%",
        objectFit:  "fill",
        display:    "block",
        userSelect: "none",
        pointerEvents: "none",
      }

  return (
    <div style={wrapStyle}>
      <img
        src={rawFailed ? pngSrc : rawSrc}
        alt=""
        draggable={false}
        style={imgStyle}
        onError={() => { if (!rawFailed) setRawFailed(true) }}
      />
    </div>
  )
}

export function registerBridgeImageRenderer(): void {
  registerRenderer("BridgeImage", BridgeImageRendererImpl)
}
