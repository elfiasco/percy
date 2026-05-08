import { useEffect, useState } from "react"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

interface PathCommand {
  command: string
  points:  [number, number][]
}

interface FreeformPath {
  width:     number
  height:    number
  stroke:    boolean
  fill_mode: string | null
  commands:  PathCommand[]
}

interface FreeformData {
  paths:        FreeformPath[]
  fill_type:    string | null
  fill_color:   string | null
  line_visible: boolean
  line_color:   string | null
  line_width:   number | null
  opacity:      number
}

function commandsToSvgD(commands: PathCommand[], pw: number, ph: number): string {
  const parts: string[] = []
  for (const cmd of commands) {
    const norm = ([x, y]: [number, number]) =>
      `${((x / pw) * 100).toFixed(4)} ${((y / ph) * 100).toFixed(4)}`
    switch (cmd.command) {
      case "moveTo":
        if (cmd.points[0]) parts.push(`M ${norm(cmd.points[0])}`)
        break
      case "lnTo":
        if (cmd.points[0]) parts.push(`L ${norm(cmd.points[0])}`)
        break
      case "cubicBezTo":
        if (cmd.points.length >= 3)
          parts.push(`C ${norm(cmd.points[0])} ${norm(cmd.points[1])} ${norm(cmd.points[2])}`)
        break
      case "quadBezTo":
        if (cmd.points.length >= 2)
          parts.push(`Q ${norm(cmd.points[0])} ${norm(cmd.points[1])}`)
        break
      case "close":
        parts.push("Z")
        break
    }
  }
  return parts.join(" ")
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

  if (!data) return <div style={{ width: "100%", height: "100%" }} />

  const fill = data.fill_type === "solid" && data.fill_color
    ? data.fill_color
    : "none"
  const stroke = data.line_visible && data.line_color ? data.line_color : "none"
  const strokeW = data.line_width != null
    ? (data.line_width / 72 * 100 / 13.333).toFixed(3)
    : "0"

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      opacity={data.opacity}
    >
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
          />
        )
      })}
    </svg>
  )
}

export function registerBridgeFreeformRenderer(): void {
  registerRenderer("BridgeFreeform", BridgeFreeformRendererImpl)
}
