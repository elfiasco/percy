import { useEffect, useState } from "react"
import type { ConnectorData } from "../../../lib/studioTypes"
import { fetchConnectorData } from "../../../lib/studioApi"
import type { NativeRendererProps } from "./RendererRegistry"
import { registerRenderer } from "./RendererRegistry"

function dashFor(dash: string): string | undefined {
  switch ((dash || "").toLowerCase()) {
    case "dash":    case "lgdash":  return "8 4"
    case "dot":     case "sysdot":  return "2 3"
    case "dashdot": case "dashDot": return "8 4 2 4"
    case "longdash":                return "12 4"
    default:                        return undefined
  }
}

function arrowMarker(end: string | null, size: string | null, color: string, kind: "head" | "tail"): string | undefined {
  if (!end || end === "none") return undefined
  return `url(#arrow-${kind}-${end}-${size || "med"}-${encodeURIComponent(color)})`
}

function ArrowDef({ id, end, size, color }: { id: string; end: string; size: string | null; color: string }) {
  // size-based scale
  const sizeFactor = size === "lg" ? 1.4 : size === "sm" ? 0.7 : 1.0
  const w = 8 * sizeFactor
  const h = 8 * sizeFactor

  // shape paths in viewBox 0 0 10 10
  let path = "M 0 0 L 10 5 L 0 10 z"  // arrow
  if (end === "diamond")  path = "M 0 5 L 5 0 L 10 5 L 5 10 z"
  if (end === "oval")     path = ""   // use circle
  if (end === "stealth")  path = "M 0 0 L 10 5 L 0 10 L 4 5 z"
  if (end === "triangle") path = "M 0 0 L 10 5 L 0 10 z"

  return (
    <marker id={id} markerWidth={w} markerHeight={h} refX="9" refY="5" orient="auto">
      {end === "oval"
        ? <circle cx="5" cy="5" r="4" fill={color} />
        : <path d={path} fill={color} />
      }
    </marker>
  )
}

function ConnectorRendererImpl({ element, docId, slideN, renderKey }: NativeRendererProps) {
  const [data, setData]   = useState<ConnectorData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchConnectorData(docId, slideN, element.id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id, renderKey])

  if (error) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#fff5f5", color: "#b91c1c", fontSize: 9 }}>
        ! {error.slice(0, 30)}
      </div>
    )
  }
  if (!data) {
    return <div style={{ width: "100%", height: "100%" }} />
  }

  // Endpoints are absolute slide inches. Map into 0..100% of the element's
  // own bounding box (left_in/top_in/width_in/height_in from StudioElement).
  const ep = data.endpoints
  const w = element.width_in  || 1
  const h = element.height_in || 1
  const x1 = ((ep.start_x - element.left_in) / w) * 100
  const y1 = ((ep.start_y - element.top_in)  / h) * 100
  const x2 = ((ep.end_x   - element.left_in) / w) * 100
  const y2 = ((ep.end_y   - element.top_in)  / h) * 100

  const color = data.line.color || "#444"
  const width = data.line.width ?? 1.5
  const dash  = dashFor(data.line.dash_style)
  const headId = `arrow-head-${data.line.head_end || "none"}-${data.line.head_size || "med"}-${color}`
  const tailId = `arrow-tail-${data.line.tail_end || "none"}-${data.line.tail_size || "med"}-${color}`

  // build a path for elbow / curved
  let pathD: string | null = null
  const ct = (data.connector_type || "straight").toLowerCase()
  if (ct.includes("elbow") || ct.includes("bent")) {
    const midX = (x1 + x2) / 2
    pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
  } else if (ct.includes("curve")) {
    pathD = `M ${x1} ${y1} C ${x2} ${y1}, ${x1} ${y2}, ${x2} ${y2}`
  }

  return (
    <svg
      width="100%" height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ pointerEvents: "none", overflow: "visible" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {data.line.head_end && data.line.head_end !== "none" && (
          <ArrowDef id={headId} end={data.line.head_end} size={data.line.head_size} color={color} />
        )}
        {data.line.tail_end && data.line.tail_end !== "none" && (
          <ArrowDef id={tailId} end={data.line.tail_end} size={data.line.tail_size} color={color} />
        )}
      </defs>
      {pathD ? (
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dash}
          markerStart={arrowMarker(data.line.tail_end, data.line.tail_size, color, "tail")}
          markerEnd={arrowMarker(data.line.head_end, data.line.head_size, color, "head")}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dash}
          markerStart={arrowMarker(data.line.tail_end, data.line.tail_size, color, "tail")}
          markerEnd={arrowMarker(data.line.head_end, data.line.head_size, color, "head")}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

export function registerConnectorRenderer(): void {
  registerRenderer("BridgeConnector", ConnectorRendererImpl)
}

export default ConnectorRendererImpl
