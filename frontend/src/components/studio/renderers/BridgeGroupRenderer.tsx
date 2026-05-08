import { registerRenderer, getRenderer, type NativeRendererProps } from "./RendererRegistry"
import ElementErrorBoundary from "../ElementErrorBoundary"
import type { StudioElement } from "../../../lib/studioTypes"

function BridgeGroupRendererImpl({ element, docId, slideN, renderKey }: NativeRendererProps) {
  const children = (element.children ?? []) as StudioElement[]

  if (!children.length) {
    return (
      <div style={{
        width: "100%", height: "100%",
        border: "1px dashed rgba(99,102,241,0.3)",
        background: "rgba(99,102,241,0.04)",
      }} />
    )
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {[...children].sort((a, b) => a.z_index - b.z_index).map((child) => {
        const NativeR = getRenderer(child.type)
        if (!NativeR) return null
        const transform = child.rotation
          ? `rotate(${child.rotation}deg)`
          : undefined
        return (
          <div
            key={child.id}
            style={{
              position:  "absolute",
              left:      `${child.left_pct}%`,
              top:       `${child.top_pct}%`,
              width:     `${child.width_pct}%`,
              height:    `${child.height_pct}%`,
              transform,
              transformOrigin: "center center",
            }}
          >
            <ElementErrorBoundary elementId={child.id} label={child.label || child.name}>
              <NativeR
                element={child}
                docId={docId}
                slideN={slideN}
                renderKey={renderKey}
                selected={false}
              />
            </ElementErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}

export function registerBridgeGroupRenderer(): void {
  registerRenderer("BridgeGroup", BridgeGroupRendererImpl)
}
