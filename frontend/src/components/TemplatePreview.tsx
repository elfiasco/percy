/**
 * TemplatePreview — thin shim that turns a template's pre-substitution
 * layout (the `{kind, alias, body}` entries that templates store) into
 * the realized-element shape SlideViewer expects.
 *
 * Public API unchanged: callers (TemplateSetEditor) pass `layout` +
 * `sampleInputs` + `palette` + `width`. The conversion:
 *
 *   1. Substitute `{{var}}` references in body fields with values from
 *      sampleInputs (or empty string when missing). Numeric/list inputs
 *      pass through as-is when the WHOLE field is a single ref.
 *   2. Resolve named palette tokens (e.g. `cobalt`, `accent1`) to hex.
 *   3. Reshape each entry into a ViewerElementJson with the same
 *      position/text/fill/chart/table fields the showcase API emits.
 *
 * Then SlideViewer renders via the studio renderer registry — same
 * Tiptap text, same Recharts charts, same TiptapTable tables that
 * the editor uses. No more parallel SVG renderer to keep in sync.
 */

import { useMemo } from "react"
import SlideViewer, { type ViewerElementJson, type ViewerSlideData } from "./SlideViewer"

interface LayoutEntry {
  kind?: string
  alias?: string
  body?: Record<string, unknown>
}

interface PaletteEntry {
  name?: string
  hex?: string
  role?: string
}

export interface TemplatePreviewProps {
  layout: LayoutEntry[]
  sampleInputs?: Record<string, unknown>
  /** Final pixel width of the thumbnail. Height auto-scales to 16:9. */
  width?: number
  className?: string
  /** Used to resolve named palette tokens (e.g. "cobalt") to hex. */
  palette?: PaletteEntry[]
  /** Background color override. Defaults to a warm cream. */
  background?: string
}

const CANVAS_W = 13.333
const CANVAS_H = 7.5
const DEFAULT_BG = "#F9F8F4"


// ── {{var}} substitution ───────────────────────────────────────────────────


const LONE_VAR_RE = /^\s*\{\{\s*([A-Za-z_][\w]*)\s*\}\}\s*$/
const VAR_RE      = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g

/** Substitute references in a value. If the value is a string that's
 *  entirely a single `{{var}}` reference, returns the input's native
 *  type (number, list, dict). Otherwise interpolates string. Recurses
 *  into dicts and lists. */
function substitute(value: unknown, inputs: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const m = value.match(LONE_VAR_RE)
    if (m) {
      const key = m[1]
      return key in inputs ? inputs[key] : ""
    }
    return value.replace(VAR_RE, (_, k) => {
      const v = inputs[k]
      return v == null ? "" : String(v)
    })
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, inputs))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, inputs)
    }
    return out
  }
  return value
}


function resolveColor(
  raw: unknown,
  palette: PaletteEntry[] = [],
  fallback: string | null = null,
): string | null {
  if (raw == null || raw === "") return fallback
  const v = String(raw)
  if (v.startsWith("#")) return v
  const hit = palette.find((c) => c.name === v || c.role === v)
  if (hit?.hex) return hit.hex
  const named: Record<string, string> = {
    ink: "#1A1F28", paper: "#F9F8F4", muted: "#6A6F7A",
    cobalt: "#7DA1CC", sage: "#6FA17A", cream: "#F0E6D8",
    ochre: "#C5994A", brick: "#B8634F",
    accent1: "#7DA1CC", accent2: "#6FA17A",
    white: "#FFFFFF", black: "#000000", text: "#2A2F3A",
  }
  return named[v.toLowerCase()] ?? fallback
}


// ── Layout entry → ViewerElementJson ───────────────────────────────────────


function entryToElement(
  entry: LayoutEntry,
  inputs: Record<string, unknown>,
  palette: PaletteEntry[],
): ViewerElementJson | null {
  const kind = entry.kind || ""
  const body = (substitute(entry.body || {}, inputs) || {}) as Record<string, unknown>

  // Map layout kind → Bridge element type.
  const typeMap: Record<string, string> = {
    shape: "BridgeShape",
    text: "BridgeText",
    chart: "BridgeChart",
    table: "BridgeTable",
    connector: "BridgeConnector",
    "image-typed": "BridgeImage",
    freeform: "BridgeFreeform",
    "live-group": "BridgeGroup",
  }
  const type = typeMap[kind] || "BridgeShape"

  const pos = (body.position ?? {}) as Record<string, unknown>
  const left_in   = Number(pos.left_in   ?? 0)
  const top_in    = Number(pos.top_in    ?? 0)
  const width_in  = Number(pos.width_in  ?? 0)
  const height_in = Number(pos.height_in ?? 0)
  if (!Number.isFinite(width_in) || !Number.isFinite(height_in) ||
      width_in <= 0 || height_in <= 0) return null

  const fillColor = resolveColor(body.fill_color, palette)
  const fill = fillColor ? { type: "solid", color: fillColor } : undefined

  // Text — either body.text (flat string) or body.text_runs (list of runs).
  // Both forms exist in induced templates.
  let text_runs: ViewerElementJson["text_runs"] | undefined
  const runs = body.text_runs
  const text = body.text
  if (Array.isArray(runs) && runs.length > 0) {
    text_runs = runs.map((r) => {
      const rr = r as Record<string, unknown>
      return {
        text: String(rr.text ?? ""),
        font_name:   (rr.font_name as string | null) ?? null,
        font_size:   (rr.font_size as number | null) ?? null,
        font_bold:   (rr.font_bold as boolean | null) ?? null,
        font_italic: (rr.font_italic as boolean | null) ?? null,
        color:       resolveColor(rr.font_color ?? rr.color, palette) ?? null,
      }
    }).filter((r) => r.text !== "")
  } else if (typeof text === "string" && text.trim()) {
    text_runs = [{ text }]
  }

  const out: ViewerElementJson = {
    type,
    position: { left_in, top_in, width_in, height_in },
  }
  if (fill) out.fill = fill
  if (text_runs && text_runs.length > 0) out.text_runs = text_runs
  if (body.geometry_preset) out.geometry_preset = String(body.geometry_preset)

  // Chart fields
  if (type === "BridgeChart") {
    out.chart_type = (body.chart_type as string | null) ?? null
    const cats = body.categories
    if (Array.isArray(cats)) out.chart_categories = cats.map(String)
    const series = body.series
    if (Array.isArray(series)) {
      out.chart_series = series.map((s) => {
        const ss = s as Record<string, unknown>
        return {
          name: String(ss.name ?? ""),
          values: Array.isArray(ss.values) ? (ss.values as unknown[]).map((v) => Number(v) || 0) : [],
          color: resolveColor(ss.color, palette),
        }
      })
      out.chart_series_count = series.length
    }
    const title = body.title
    if (typeof title === "string") out.chart_title = title
    else if (title && typeof title === "object") {
      const tt = title as Record<string, unknown>
      if (typeof tt.text === "string") out.chart_title = tt.text
    }
  }

  // Table fields
  if (type === "BridgeTable") {
    const data = body.data
    if (Array.isArray(data)) {
      out.table_data = (data as unknown[]).map((row) =>
        Array.isArray(row) ? (row as unknown[]).map((c) => String(c ?? "")) : [],
      )
      out.table_dim = [
        out.table_data.length,
        out.table_data[0]?.length ?? 0,
      ]
    }
    if (typeof body.first_row_header === "boolean") out.first_row_header = body.first_row_header
    if (typeof body.banded_rows === "boolean") out.banded_rows = body.banded_rows
  }

  // Line (connectors / borders)
  const lineColor = resolveColor(body.line_color ?? body.border_color, palette)
  const lineWidth = body.line_width ?? body.border_width
  if (lineColor || typeof lineWidth === "number") {
    out.line = {
      visible: true,
      color: lineColor,
      width: typeof lineWidth === "number" ? lineWidth : null,
    }
  }

  return out
}


// ── Public component ──────────────────────────────────────────────────────


export default function TemplatePreview({
  layout,
  sampleInputs = {},
  width = 320,
  className,
  palette = [],
  background = DEFAULT_BG,
}: TemplatePreviewProps) {
  const slideData = useMemo<ViewerSlideData>(() => {
    const elements: ViewerElementJson[] = []
    for (const entry of (layout || [])) {
      const el = entryToElement(entry, sampleInputs, palette)
      if (el) elements.push(el)
    }
    return {
      slide_n: 1,
      width_in: CANVAS_W,
      height_in: CANVAS_H,
      background_color: background,
      elements,
    }
  }, [layout, sampleInputs, palette, background])

  return (
    <SlideViewer
      slideData={slideData}
      width={width}
      className={className}
      background={background}
    />
  )
}
