import { useState, useMemo } from "react"
import { elementPngUrl } from "../../../lib/studioApi"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { buildImageFilter, buildDropShadowFilter, hasImageEffects, type RecolorPreset } from "../../../lib/studio/imageFilters"
import { getMask } from "../../../lib/studio/maskShapes"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

const BASE = "/api"

function rawImageUrl(docId: string, slideN: number, elementId: string, v: number): string {
  return `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/raw-image?v=${v}`
}

/**
 * Native renderer for BridgeImage with Google Slides-parity effects:
 *   - CSS crop (fraction-based, OOXML semantics)
 *   - Recolor presets (grayscale, sepia, negative, BW, light/dark variants)
 *   - Brightness / Contrast / Transparency
 *   - Drop shadow (SVG feGaussianBlur + feOffset)
 *   - Reflection (mirrored copy with alpha gradient)
 *   - Crop-to-shape mask (clipPath via maskShapes registry)
 *
 * Effects are applied in this order:
 *   image -> [crop translate/scale] -> [filter recolor+adj+alpha]
 *         -> [clipPath mask shape] -> [shadow filter on outer wrapper]
 */
function BridgeImageRendererImpl({
  element, docId, slideN, renderKey,
}: NativeRendererProps) {
  const [rawFailed, setRawFailed] = useState(false)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)
  const style = payload.style

  const rawSrc = rawImageUrl(docId, slideN, element.id, renderKey)
  const pngSrc = `${elementPngUrl(docId, slideN, element.id)}?v=${renderKey}`
  const imgSrc = rawFailed ? pngSrc : rawSrc

  // CSS crop
  const cropL = (style?.crop_left   ?? 0) * 100
  const cropR = (style?.crop_right  ?? 0) * 100
  const cropT = (style?.crop_top    ?? 0) * 100
  const cropB = (style?.crop_bottom ?? 0) * 100
  const hasCrop = cropL + cropR + cropT + cropB > 0

  // Effects
  const effectParams = {
    brightness:   style?.brightness ?? 0,
    contrast:     style?.contrast ?? 0,
    transparency: style?.transparency ?? 0,
    recolor:      (style?.recolor_preset as RecolorPreset | undefined) ?? "none",
  }
  const effectsActive = hasImageEffects(effectParams)
  const filterId = `imgfx-${element.id}`
  const shadowId = `imgsh-${element.id}`

  // Mask
  const mask = getMask(style?.mask_shape)
  const maskId = `imgmask-${element.id}`

  // Shadow
  const shadowOn = style?.shadow_on === true
  const shadowParams = useMemo(() => ({
    color:    style?.shadow_color    ?? "#000000",
    blur:     style?.shadow_blur     ?? 4,
    offsetX:  style?.shadow_offset_x ?? 2,
    offsetY:  style?.shadow_offset_y ?? 2,
    opacity:  0.4,
  }), [style?.shadow_color, style?.shadow_blur, style?.shadow_offset_x, style?.shadow_offset_y])

  // Reflection
  const reflectionOn = style?.reflection_on === true
  const reflectionTransparency = style?.reflection_transparency ?? 0.5
  const reflectionDistance     = style?.reflection_distance ?? 4
  const reflectionSize         = style?.reflection_size ?? 0.3

  // Wrapper
  const wrapStyle: React.CSSProperties = {
    width:    "100%",
    height:   "100%",
    overflow: "visible",  // shadow/reflection extends beyond bounds
    opacity:  style?.opacity ?? 1,
    position: "relative",
  }

  // Crop scale: the image is scaled up so the visible area fills the box
  const scaleW = hasCrop ? 100 / (100 - cropL - cropR) : 1
  const scaleH = hasCrop ? 100 / (100 - cropT - cropB) : 1
  const imgStyle: React.CSSProperties = hasCrop
    ? {
        position:     "absolute",
        width:        `${scaleW * 100}%`,
        height:       `${scaleH * 100}%`,
        left:         `${-cropL * scaleW}%`,
        top:          `${-cropT * scaleH}%`,
        objectFit:    "fill",
        userSelect:   "none",
        pointerEvents: "none",
        filter:       effectsActive ? `url(#${filterId})` : undefined,
      }
    : {
        width:        "100%",
        height:       "100%",
        objectFit:    "fill",
        display:      "block",
        userSelect:   "none",
        pointerEvents: "none",
        filter:       effectsActive ? `url(#${filterId})` : undefined,
      }

  // Compose SVG defs (all inline filter defs go here)
  const defsSvg = (
    <svg width="0" height="0" style={{ position: "absolute", overflow: "hidden" }} aria-hidden="true">
      <defs dangerouslySetInnerHTML={{
        __html:
          (effectsActive ? buildImageFilter(filterId, effectParams) : "") +
          (shadowOn ? buildDropShadowFilter(shadowId, shadowParams) : "") +
          (mask ? `<clipPath id="${maskId}" clipPathUnits="objectBoundingBox"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><g transform="scale(0.01,0.01)">${mask.svg}</g></svg></clipPath>` : ""),
      }} />
    </svg>
  )

  // Inner content: the image + optional crop. Wrapped in a clipping div if mask is set.
  const imgContent = (
    <div style={{
      width:  "100%",
      height: "100%",
      position: "relative",
      overflow: hasCrop ? "hidden" : "visible",
      filter: shadowOn ? `url(#${shadowId})` : undefined,
      clipPath: mask ? `url(#${maskId})` : undefined,
    }}>
      <img src={imgSrc} alt="" draggable={false} style={imgStyle} onError={() => { if (!rawFailed) setRawFailed(true) }} />
    </div>
  )

  // Reflection: mirrored copy below, fading to transparent
  const reflectionContent = reflectionOn ? (
    <div style={{
      position:    "absolute",
      left:        0,
      top:         `calc(100% + ${reflectionDistance}px)`,
      width:       "100%",
      height:      `${reflectionSize * 100}%`,
      overflow:    "hidden",
      transform:   "scaleY(-1)",
      transformOrigin: "top",
      maskImage:   `linear-gradient(to top, rgba(0,0,0,${1 - reflectionTransparency}) 0%, rgba(0,0,0,0) 100%)`,
      WebkitMaskImage: `linear-gradient(to top, rgba(0,0,0,${1 - reflectionTransparency}) 0%, rgba(0,0,0,0) 100%)`,
      pointerEvents: "none",
    }}>
      <img src={imgSrc} alt="" draggable={false}
        style={{ ...imgStyle, filter: effectsActive ? `url(#${filterId})` : undefined }} />
    </div>
  ) : null

  return (
    <div style={wrapStyle}>
      {defsSvg}
      {imgContent}
      {reflectionContent}
    </div>
  )
}

export function registerBridgeImageRenderer(): void {
  registerRenderer("BridgeImage", BridgeImageRendererImpl)
}
