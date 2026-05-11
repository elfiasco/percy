import { useEffect, useState } from "react"
import type { ConnectorData } from "../../../lib/studioTypes"
import { fetchConnectorData, updateConnectorData } from "../../../lib/studioApi"
import { studioStore } from "../../../lib/studio/store"
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

function ConnectorRendererImpl({ element, docId, slideN, renderKey, selected }: NativeRendererProps) {
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
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
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
      {selected && (
        <ConnectorInlineToolbar
          elementId={element.id}
          docId={docId}
          slideN={slideN}
          data={data}
          onUpdated={() => studioStore.bumpRenderKeys([element.id])}
        />
      )}
    </div>
  )
}

// ── Connector inline toolbar (Google Slides parity) ────────────────────────
// Floating bar above the selected connector with:
//   [■ Color ▾] [Width ▾] [Style ▾] [Start ▾] [End ▾]

function ConnectorInlineToolbar({
  elementId, docId, slideN, data, onUpdated,
}: {
  elementId: string; docId: string; slideN: number
  data: ConnectorData
  onUpdated: () => void
}) {
  const patch = async (line: Partial<ConnectorData["line"]>) => {
    try {
      await updateConnectorData(docId, slideN, elementId, { line: { ...data.line, ...line } })
      onUpdated()
    } catch (e) {
      console.error("[Percy] connector patch failed:", e)
    }
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: -34, left: 0,
        zIndex: 6,
        display: "flex", gap: 4,
        background: "#fff",
        border: "1px solid #dadce0", borderRadius: 6,
        padding: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        fontSize: 11, whiteSpace: "nowrap",
      }}
    >
      <CnColorPicker currentColor={data.line.color} onChange={(c) => patch({ color: c })} />
      <CnSelect
        label="Width" value={String(data.line.width ?? 1.5)}
        options={[
          { value: "0.5", label: "0.5 pt" },
          { value: "1",   label: "1 pt"   },
          { value: "1.5", label: "1.5 pt" },
          { value: "2",   label: "2 pt"   },
          { value: "3",   label: "3 pt"   },
          { value: "4.5", label: "4.5 pt" },
          { value: "6",   label: "6 pt"   },
        ]}
        onChange={(v) => patch({ width: parseFloat(v) })}
      />
      <CnSelect
        label="Style" value={(data.line.dash_style || "solid").toLowerCase()}
        options={[
          { value: "solid",   label: "Solid"      },
          { value: "dash",    label: "Dashed"     },
          { value: "dot",     label: "Dotted"     },
          { value: "dashdot", label: "Dash-dot"   },
          { value: "longdash",label: "Long dash"  },
        ]}
        onChange={(v) => patch({ dash_style: v })}
      />
      <CnSelect
        label="Start" value={data.line.tail_end || "none"}
        options={[
          { value: "none",    label: "None"    },
          { value: "arrow",   label: "Arrow"   },
          { value: "stealth", label: "Stealth" },
          { value: "diamond", label: "Diamond" },
          { value: "oval",    label: "Circle"  },
          { value: "triangle",label: "Triangle"},
        ]}
        onChange={(v) => patch({ tail_end: v === "none" ? null : v })}
      />
      <CnSelect
        label="End" value={data.line.head_end || "none"}
        options={[
          { value: "none",    label: "None"    },
          { value: "arrow",   label: "Arrow"   },
          { value: "stealth", label: "Stealth" },
          { value: "diamond", label: "Diamond" },
          { value: "oval",    label: "Circle"  },
          { value: "triangle",label: "Triangle"},
        ]}
        onChange={(v) => patch({ head_end: v === "none" ? null : v })}
      />
    </div>
  )
}

function CnColorPicker({ currentColor, onChange }: { currentColor: string | null; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  const swatch = currentColor && /^#[0-9a-fA-F]{6}$/.test(currentColor) ? currentColor : "#444"
  const PALETTE = ["#3366CC", "#DC3912", "#FF9900", "#109618", "#990099", "#0099C6", "#000000", "#80868b", "#444444"]
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          padding: "2px 8px", display: "flex", alignItems: "center", gap: 4,
          background: open ? "#e8f0fe" : "transparent",
          border: "1px solid transparent", borderRadius: 3,
          color: "#3c4043", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
        }}
        title="Line color"
      >
        <span style={{ width: 14, height: 14, background: swatch, border: "1px solid rgba(0,0,0,0.2)", borderRadius: 2 }} />
        <span>Color</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={() => setOpen(false)} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 6, fontFamily: "inherit",
              display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3,
            }}
          >
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); setOpen(false) }}
                style={{
                  width: 20, height: 20, padding: 0,
                  background: c,
                  border: currentColor?.toLowerCase() === c.toLowerCase() ? "2px solid #1a73e8" : "1px solid #dadce0",
                  borderRadius: 3, cursor: "pointer",
                }}
              />
            ))}
            <input
              type="color"
              value={swatch}
              onChange={(e) => onChange(e.target.value)}
              style={{ gridColumn: "span 5", width: "100%", height: 22, border: "1px solid #dadce0", borderRadius: 3, marginTop: 3 }}
            />
          </div>
        </>
      )}
    </div>
  )
}

function CnSelect({
  label, value, options, onChange,
}: {
  label: string; value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)?.label ?? value
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          padding: "2px 8px", display: "flex", alignItems: "center", gap: 4,
          background: open ? "#e8f0fe" : "transparent",
          border: "1px solid transparent", borderRadius: 3,
          color: "#3c4043", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
        }}
        title={label}
      >
        <span style={{ color: "#5f6368", fontSize: 10 }}>{label}:</span>
        <span>{current}</span>
        <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 8 }} onClick={() => setOpen(false)} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 30, left: 0, zIndex: 10,
              background: "#fff", border: "1px solid #dadce0", borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
              padding: 4, minWidth: 120, fontFamily: "inherit",
            }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "4px 10px", fontSize: 12,
                  background: o.value === value ? "#e8f0fe" : "transparent",
                  color: o.value === value ? "#1a73e8" : "#3c4043",
                  border: "none", borderRadius: 3, cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
                onMouseLeave={(e) => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function registerConnectorRenderer(): void {
  registerRenderer("BridgeConnector", ConnectorRendererImpl)
}

export default ConnectorRendererImpl
