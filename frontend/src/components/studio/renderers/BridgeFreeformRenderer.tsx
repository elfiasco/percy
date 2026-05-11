import { useEffect, useState } from "react"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"
import type { GradientStop } from "../../../lib/studioTypes"

interface PathCommand {
  command:    string
  points:     [number, number][]
  arc_params?: { wR?: number; hR?: number; stAng?: number; swAng?: number }
}

interface FreeformPath {
  width:     number
  height:    number
  stroke:    boolean
  fill_mode: string | null
  commands:  PathCommand[]
}

interface FreeformData {
  paths:           FreeformPath[]
  fill_type:       string | null
  fill_color:      string | null
  gradient_stops:  GradientStop[] | null
  gradient_angle:  number | null
  line_visible:    boolean
  line_color:      string | null
  line_width:      number | null
  line_dash:       string | null
  opacity:         number
}

function commandsToSvgD(commands: PathCommand[], pw: number, ph: number): string {
  const parts: string[] = []
  let cx = 0, cy = 0  // current position (in path-space coords)
  const nx = (x: number) => ((x / pw) * 100).toFixed(4)
  const ny = (y: number) => ((y / ph) * 100).toFixed(4)
  const norm = ([x, y]: [number, number]) => `${nx(x)} ${ny(y)}`

  for (const cmd of commands) {
    switch (cmd.command) {
      case "moveTo":
        if (cmd.points[0]) {
          [cx, cy] = cmd.points[0]
          parts.push(`M ${norm(cmd.points[0])}`)
        }
        break
      case "lnTo":
        if (cmd.points[0]) {
          [cx, cy] = cmd.points[0]
          parts.push(`L ${norm(cmd.points[0])}`)
        }
        break
      case "cubicBezTo":
        if (cmd.points.length >= 3) {
          parts.push(`C ${norm(cmd.points[0])} ${norm(cmd.points[1])} ${norm(cmd.points[2])}`)
          ;[cx, cy] = cmd.points[2]
        }
        break
      case "quadBezTo":
        if (cmd.points.length >= 2) {
          parts.push(`Q ${norm(cmd.points[0])} ${norm(cmd.points[1])}`)
          ;[cx, cy] = cmd.points[1]
        }
        break
      case "arcTo": {
        // OOXML arcTo: angles in 60000ths of a degree.
        // The current point lies on the ellipse at stAng.
        // Center of ellipse = (cx - wR*cos(stAng), cy - hR*sin(stAng)).
        // End point = center + (wR*cos(stAng+swAng), hR*sin(stAng+swAng)).
        const ap = cmd.arc_params ?? {}
        const wR  = ap.wR  ?? 0
        const hR  = ap.hR  ?? 0
        const stAngRad  = (ap.stAng  ?? 0) / 60000 * Math.PI / 180
        const swAngRad  = (ap.swAng  ?? 0) / 60000 * Math.PI / 180
        const ecx = cx - wR * Math.cos(stAngRad)
        const ecy = cy - hR * Math.sin(stAngRad)
        const endX = ecx + wR * Math.cos(stAngRad + swAngRad)
        const endY = ecy + hR * Math.sin(stAngRad + swAngRad)
        const large = Math.abs(swAngRad) > Math.PI ? 1 : 0
        const sweep = swAngRad > 0 ? 1 : 0
        const wrN = ((wR / pw) * 100).toFixed(4)
        const hrN = ((hR / ph) * 100).toFixed(4)
        parts.push(`A ${wrN} ${hrN} 0 ${large} ${sweep} ${nx(endX)} ${ny(endY)}`)
        cx = endX; cy = endY
        break
      }
      case "close":
        parts.push("Z")
        break
    }
  }
  return parts.join(" ")
}

function dashArray(dash: string | null | undefined, strokeW: string): string | undefined {
  const w = parseFloat(strokeW) || 1
  switch (dash) {
    case "dash":           return `${w * 4} ${w * 2}`
    case "dot":            return `${w} ${w * 2}`
    case "dash_dot":       return `${w * 4} ${w * 2} ${w} ${w * 2}`
    case "lg_dash":        return `${w * 8} ${w * 3}`
    case "lg_dash_dot":    return `${w * 8} ${w * 2} ${w} ${w * 2}`
    case "lg_dash_dot_dot":return `${w * 8} ${w * 2} ${w} ${w * 2} ${w} ${w * 2}`
    case "sys_dash":       return `${w * 3} ${w * 2}`
    case "sys_dot":        return `${w * 2} ${w * 2}`
    default:               return undefined
  }
}

function BridgeFreeformRendererImpl({ element, docId, slideN, renderKey }: NativeRendererProps) {
  const [data, setData] = useState<FreeformData | null>(null)

  useEffect(() => {
    const url = `/api/docs/${encodeURIComponent(docId)}/slides/${slideN}/elements/${encodeURIComponent(element.id)}/freeform-data`
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, slideN, element.id, renderKey])

  if (!data) return <div style={{ width: "100%", height: "100%" }} data-percy-loading="freeform" />

  const fillTypeLower = data.fill_type?.toLowerCase()
  const isGradient = (fillTypeLower === "gradient" || fillTypeLower === "gradfill") && data.gradient_stops && data.gradient_stops.length >= 2
  const isSolid = fillTypeLower === "solid" || fillTypeLower === "solidfill"
    || (!fillTypeLower && !!data.fill_color)
    || (fillTypeLower === "background" && !!data.fill_color)
  const gradId = `freeform-grad-${element.id}`

  const fill = isGradient
    ? `url(#${gradId})`
    : isSolid && data.fill_color
    ? data.fill_color
    : "none"

  const stroke = data.line_visible && data.line_color ? data.line_color : "none"
  const strokeW = data.line_width != null
    ? (data.line_width / 72 * 40 / (element.width_in > 0 ? element.width_in : 1)).toFixed(3)
    : "0"
  const strokeDash = dashArray(data.line_dash, strokeW)

  const gradDef = isGradient && data.gradient_stops ? (() => {
    const angle = data.gradient_angle ?? 0
    const rad = (angle * Math.PI) / 180
    const x1 = (50 - 50 * Math.cos(rad)).toFixed(2)
    const y1 = (50 - 50 * Math.sin(rad)).toFixed(2)
    const x2 = (50 + 50 * Math.cos(rad)).toFixed(2)
    const y2 = (50 + 50 * Math.sin(rad)).toFixed(2)
    return (
      <defs>
        <linearGradient id={gradId} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} gradientUnits="userSpaceOnUse">
          {data.gradient_stops!.map((s, i) => (
            s.color ? <stop key={i} offset={`${(s.position * 100).toFixed(1)}%`} stopColor={s.color} /> : null
          ))}
        </linearGradient>
      </defs>
    )
  })() : null

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      opacity={data.opacity}
    >
      {gradDef}
      {data.paths.map((p, i) => {
        const d = commandsToSvgD(p.commands, p.width, p.height)
        if (!d) return null
        return (
          <path
            key={i}
            d={d}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
            {...(strokeDash ? { strokeDasharray: strokeDash } : {})}
          />
        )
      })}
    </svg>
  )
}

export function registerBridgeFreeformRenderer(): void {
  registerRenderer("BridgeFreeform", BridgeFreeformRendererImpl)
}
