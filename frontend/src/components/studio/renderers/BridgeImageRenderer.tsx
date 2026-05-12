import { useState, useMemo, useRef } from "react"
import { elementPngUrl, replaceImage } from "../../../lib/studioApi"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { buildImageFilter, buildDropShadowFilter, hasImageEffects, type RecolorPreset } from "../../../lib/studio/imageFilters"
import { getMask, MASKS } from "../../../lib/studio/maskShapes"
import { studioStore } from "../../../lib/studio/store"
import { commitElementStyle } from "../../../lib/studio/commands"
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
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [rawFailed, setRawFailed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // PPTX `<a:xfrm flipH/flipV>` mirrors picture content around the box center.
  // Without applying these, layout-template photos that PowerPoint deliberately
  // mirrors (e.g. LPA family photos) render in the wrong orientation, blowing
  // up RMS on every slide that re-uses that template.
  const flipH = !!element.flip_h
  const flipV = !!element.flip_v
  const wrapTransform = (flipH || flipV)
    ? `scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`
    : undefined

  // Wrapper
  const wrapStyle: React.CSSProperties = {
    width:    "100%",
    height:   "100%",
    overflow: "visible",  // shadow/reflection extends beyond bounds
    opacity:  style?.opacity ?? 1,
    position: "relative",
    transform: wrapTransform,
    transformOrigin: "center center",
  }

  // Crop scale: the image is scaled up so the visible area fills the box
  const scaleW = hasCrop ? 100 / (100 - cropL - cropR) : 1
  const scaleH = hasCrop ? 100 / (100 - cropT - cropB) : 1
  const imgStyle: React.CSSProperties = hasCrop
    ? {
        position:     "absolute",
        // Tailwind preflight injects `img, video { max-width:100%; height:auto }`
        // globally, which silently clamps inline width:>100% (used for srcRect
        // crop scaling). Override explicitly so cropped images can extend past
        // the wrapper bounds and have their left-offset reveal the right band.
        maxWidth:     "none",
        maxHeight:    "none",
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
        maxWidth:     "none",
        maxHeight:    "none",
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

  // Replace image via file picker
  const onReplace = async (file: File) => {
    try {
      await replaceImage(docId, slideN, element.id, file)
      studioStore.bumpRenderKeys([element.id])
    } catch (e) {
      console.error("[Percy] replace image failed:", e)
    }
  }

  // Reset all image effects
  const onResetEffects = () => {
    commitElementStyle(element.id, {
      brightness: 0, contrast: 0, transparency: 0,
      recolor_preset: null, mask_shape: null,
      reflection_on: false,
    }).catch((e) => console.error("[Percy] reset image effects failed:", e))
  }

  return (
    <div style={wrapStyle}>
      {defsSvg}
      {imgContent}
      {reflectionContent}
      {selected && (
        <ImageToolbar
          onReplace={() => fileInputRef.current?.click()}
          onResetEffects={onResetEffects}
          onCycleMask={() => {
            const cycle = ["rectangle", "circle", "rounded_rect", "triangle", "diamond", "hexagon"]
            const cur  = style?.mask_shape ?? "rectangle"
            const idx  = cycle.indexOf(cur)
            const next = cycle[(idx + 1) % cycle.length]
            commitElementStyle(element.id, { mask_shape: next === "rectangle" ? null : next })
              .catch((e) => console.error("[Percy] mask cycle failed:", e))
          }}
          masks={MASKS}
          currentMask={style?.mask_shape ?? null}
          elementId={element.id}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onReplace(f)
          e.target.value = ""
        }}
      />
    </div>
  )
}

// ── Floating toolbar above selected image ──────────────────────────────────

function ImageToolbar({
  onReplace, onResetEffects, onCycleMask, masks, currentMask, elementId,
}: {
  onReplace:      () => void
  onResetEffects: () => void
  onCycleMask:    () => void
  masks:          typeof MASKS
  currentMask:    string | null
  elementId:      string
}) {
  const [maskOpen, setMaskOpen] = useState(false)
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: 4, left: 4, zIndex: 6,
        display: "flex", gap: 4,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #dadce0", borderRadius: 6,
        padding: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        backdropFilter: "blur(6px)",
        fontSize: 11, color: "#3c4043",
      }}
    >
      <button onClick={onReplace} style={IMG_TBN_BTN} title="Replace image file">Replace</button>
      <div style={{ position: "relative" }}>
        <button onClick={() => setMaskOpen((v) => !v)} style={IMG_TBN_BTN} title="Mask to shape">
          Mask ▾
        </button>
        {maskOpen && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={() => setMaskOpen(false)} />
            <div style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 6, width: 220,
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3,
              maxHeight: 240, overflow: "auto",
            }}>
              {[{ value: "rectangle", label: "None" }, ...masks].map((m) => (
                <button
                  key={m.value}
                  onClick={() => {
                    commitElementStyle(elementId, { mask_shape: m.value === "rectangle" ? null : m.value })
                      .catch((e) => console.error(e))
                    setMaskOpen(false)
                  }}
                  title={"label" in m ? m.label : m.value}
                  style={{
                    padding: 4, fontSize: 9, cursor: "pointer",
                    border: (currentMask ?? "rectangle") === m.value ? "1.5px solid #1a73e8" : "1px solid #dadce0",
                    background: (currentMask ?? "rectangle") === m.value ? "#e8f0fe" : "#fff",
                    borderRadius: 3, fontFamily: "inherit",
                  }}
                >
                  {"label" in m ? m.label.slice(0, 8) : m.value.slice(0, 8)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button onClick={onCycleMask} style={IMG_TBN_BTN} title="Cycle through common mask shapes">⟳ Shape</button>
      <button onClick={onResetEffects} style={IMG_TBN_BTN} title="Clear all image effects">Reset</button>
    </div>
  )
}

const IMG_TBN_BTN: React.CSSProperties = {
  padding: "2px 8px",
  background: "transparent",
  border: "1px solid transparent",
  color: "#3c4043",
  borderRadius: 3,
  fontSize: 11,
  fontFamily: "'Google Sans', system-ui, sans-serif",
  cursor: "pointer",
}

export function registerBridgeImageRenderer(): void {
  registerRenderer("BridgeImage", BridgeImageRendererImpl)
}
