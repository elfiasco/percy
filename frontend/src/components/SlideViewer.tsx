/**
 * SlideViewer — view-mode mount of the studio renderers.
 *
 * The marketing splash, the template editor previews, and anywhere
 * else that needs to show a slide as-rendered should go through here
 * instead of forking a parallel SVG renderer. SlideViewer:
 *
 *   1. Creates a per-instance StudioStore (so the splash can mount
 *      7 slides at once, each with its own elements/payloads, without
 *      colliding with the editor's global singleton).
 *   2. Provides that store via StudioStoreContext so the studio
 *      renderers' hooks (useStudioStore + payload hooks) transparently
 *      read from it.
 *   3. Pre-primes the local store with the slide's elements and the
 *      per-element payloads (text content, style data, chart data,
 *      table data) derived from the SVG-shape data the showcase API
 *      emits. The renderers find these in cache and skip the network
 *      fetch that would 404 against a non-doc-backed splash.
 *   4. Mounts each element via the existing RendererRegistry without
 *      ElementOverlay, drag handles, the multi-select toolbar, or
 *      contenteditable.
 *
 * Why this exists: until today the splash had its own SVG renderer
 * (SlideSvg.tsx) that re-implemented text layout, chart drawing,
 * table rendering — and every bug-fix in the editor's Tiptap +
 * Recharts pipeline had to be ported separately (and usually
 * wasn't). SlideViewer lets one engine drive both surfaces.
 */

import { useMemo } from "react"
import { StudioStore, StudioStoreContext, useStudioStore } from "../lib/studio/store"
import type {
  StudioElement,
  SlideElementsResponse,
  ParagraphsTextContent,
  ElementStyleData,
  ChartData,
  TableData,
  RunData,
  ParagraphData,
} from "../lib/studioTypes"
import { getRenderer } from "./studio/renderers/RendererRegistry"

// Side-effect imports — registers each renderer with the registry.
// Without these the registry lookup in render() returns null and the
// slide draws nothing.
import "./studio/renderers/BridgeShapeRenderer"
import "./studio/renderers/BridgeFreeformRenderer"
import "./studio/renderers/BridgeImageRenderer"
import "./studio/renderers/ChartRenderer"
import "./studio/renderers/TiptapTableRenderer"
import "./studio/renderers/TiptapShapeRenderer"
import "./studio/renderers/TiptapTextRenderer"
import "./studio/renderers/ConnectorRenderer"
import "./studio/renderers/BridgeGroupRenderer"

// ── Wire shapes ────────────────────────────────────────────────────────────

/** The shape `/api/showcase` (and `/api/docs/.../svg-data`) returns for
 *  each element. Wider than `ElementJson` from the old SlideSvg because
 *  SlideViewer needs every field that contributes to a faithful render. */
export interface ViewerElementJson {
  type: string
  position?: { left_in: number; top_in: number; width_in: number; height_in: number }
  fill?: { type?: string | null; color?: string | null }
  text_runs?: Array<{
    text: string
    font_name?: string | null
    font_size?: number | null
    font_bold?: boolean | null
    font_italic?: boolean | null
    font_underline?: boolean | null
    color?: string | null
  }>
  text_align?: string | null
  line?: { visible?: boolean; color?: string | null; width?: number | null }
  // Chart
  chart_type?: string | null
  chart_categories?: string[]
  chart_series?: Array<{ name?: string; values: number[]; color?: string | null }>
  chart_series_count?: number
  chart_title?: string | null
  // Table
  table_dim?: [number, number]
  table_data?: string[][]
  first_row_header?: boolean
  banded_rows?: boolean
  // Geometry preset (BridgeShape)
  geometry_preset?: string | null
}

export interface ViewerSlideData {
  doc_id?: string
  slide_n: number
  width_in: number
  height_in: number
  background_color?: string | null
  elements: ViewerElementJson[]
}

export interface SlideViewerProps {
  slideData: ViewerSlideData
  /** Final pixel width; height auto-scales to slide aspect ratio. */
  width?: number
  className?: string
  /** Background color override. Defaults to white if not set on slide. */
  background?: string
}


// ── Sentinels for non-chart / non-table elements ──────────────────────────


const EMPTY_CHART: ChartData = {
  chart_type: "column_clustered",
  categories: [],
  categories_are_numeric: false,
  series: [],
  title: { text: null, font_size: null, font_name: null, font_bold: null, font_italic: null, font_color: null },
  legend: { visible: false, position: null, overlay: false, font_size: null, font_name: null, font_color: null },
  category_axis: emptyAxisDefault(),
  value_axis: emptyAxisDefault(),
  plot_properties: { grouping: null, bar_width_ratio: null, overlap: null, is_horizontal: false, first_slice_ang: null, hole_size: null, vary_colors: null },
}

const EMPTY_TABLE: TableData = {
  rows: 0, cols: 0, cells: [],
  column_widths: [], row_heights: [],
  properties: { first_row_header: false, first_col_header: false, last_row_total: false, last_col_total: false, banded_rows: false, banded_cols: false },
  defaults: { font_name: null, font_size: null },
} as TableData

function emptyAxisDefault() {
  return {
    visible: false, axis_type: null, min: null, max: null,
    major_unit: null, minor_unit: null,
    gridlines_major: false, gridlines_minor: false,
    number_format: null, reverse_order: false,
    title: { text: null, font_size: null, font_name: null, font_bold: null },
    tick_label_font_size: null, tick_label_font_color: null,
    tick_label_rotation: null, tick_label_position: null,
    log_scale: false, display_units: null,
  } as never
}


// ── Adapters: SVG-shape → studio-renderer-shape ────────────────────────────


/** Generate a deterministic ID for a viewer element. Studio renderers
 *  key payloads by element id so the id must be stable for the slide's
 *  lifetime (re-renders, cache lookups). */
function elementId(slug: string, slideN: number, idx: number, el: ViewerElementJson): string {
  // Include the type so swaps between BridgeShape ↔ BridgeText at the
  // same idx don't accidentally share cached payloads.
  return `${slug}-s${slideN}-e${idx}-${el.type}`
}


/** Convert ViewerElementJson → StudioElement (the editor's element row
 *  shape). The editor uses left_in/top_in/width_in/height_in flat on
 *  the element; the showcase API nests them under .position. Also sets
 *  reasonable defaults for fields the splash doesn't carry. */
function toStudioElement(
  el: ViewerElementJson,
  slug: string,
  slideN: number,
  idx: number,
  slideW: number,
  slideH: number,
): StudioElement {
  const pos = el.position || { left_in: 0, top_in: 0, width_in: 0, height_in: 0 }
  const id = elementId(slug, slideN, idx, el)
  return {
    id,
    index: idx,
    type: el.type,
    label: el.type,
    name: id,
    text_preview: el.text_runs?.[0]?.text ?? null,
    left_in:   pos.left_in,
    top_in:    pos.top_in,
    width_in:  pos.width_in,
    height_in: pos.height_in,
    left_pct:   slideW > 0 ? (pos.left_in   / slideW) * 100 : 0,
    top_pct:    slideH > 0 ? (pos.top_in    / slideH) * 100 : 0,
    width_pct:  slideW > 0 ? (pos.width_in  / slideW) * 100 : 0,
    height_pct: slideH > 0 ? (pos.height_in / slideH) * 100 : 0,
    rotation: 0,
    flip_h: false,
    flip_v: false,
    z_index: idx,
    locked: false,
    hidden: false,
    animation: "none",
    geometry_preset: el.geometry_preset ?? null,
  }
}


/** Build a ParagraphsTextContent payload from text_runs. The Tiptap
 *  renderers expect runs grouped into paragraphs; we map each \n inside
 *  a run.text to a paragraph break. Styling is preserved per run. */
function toTextContent(el: ViewerElementJson): ParagraphsTextContent | null {
  const runs = el.text_runs
  if (!runs || runs.length === 0) return null
  const align = el.text_align || null

  const paragraphs: ParagraphData[] = []
  let curRuns: RunData[] = []
  let runIdx = 0

  const flush = () => {
    paragraphs.push({
      idx: paragraphs.length,
      alignment: align,
      space_before: null,
      space_after: null,
      line_spacing: null,
      indent_level: null,
      left_indent: null,
      bullet_type: null,
      bullet_char: null,
      runs: curRuns,
    } as ParagraphData)
    curRuns = []
  }

  for (const r of runs) {
    const text = r.text ?? ""
    const segs = text.split(/\r?\n/)
    segs.forEach((seg, i) => {
      if (i > 0) flush()
      if (seg) {
        curRuns.push({
          idx: runIdx++,
          text: seg,
          is_line_break: false,
          font_name:   r.font_name   ?? null,
          font_size:   r.font_size   ?? null,
          font_bold:   r.font_bold   ?? null,
          font_italic: r.font_italic ?? null,
          font_underline: r.font_underline ?? null,
          font_color:  r.color       ?? null,
          strikethrough: null,
          font_caps: null,
          baseline_shift: null,
          char_spacing: null,
        } as RunData)
      }
    })
  }
  if (curRuns.length || paragraphs.length === 0) flush()

  return { kind: "paragraphs", paragraphs }
}


/** Build an ElementStyleData payload from the splash element's fill +
 *  line fields. Renderers tolerate nulls everywhere we don't know. */
function toStyleData(el: ViewerElementJson): ElementStyleData {
  const fill = el.fill || {}
  const line = el.line || {}
  return {
    fill_type:  fill.type  ?? (fill.color ? "solid" : null),
    fill_color: fill.color ?? null,
    gradient_stops: null,
    gradient_angle: null,
    line_visible: line.visible ?? null,
    line_color:   line.color   ?? null,
    line_width:   line.width   ?? null,
    line_dash: null,
    head_end: null,
    tail_end: null,
    head_size: null,
    tail_size: null,
    opacity: null,
    shadow_on: null,
    shadow_color: null,
    shadow_blur: null,
    shadow_offset_x: null,
    shadow_offset_y: null,
    vertical_anchor: null,
    text_insets: null,
    autofit_type: null,
    font_scale: null,
    ln_spc_reduction: null,
    word_wrap: null,
    crop_left: null,
    crop_right: null,
    crop_top: null,
    crop_bottom: null,
  }
}


/** Build a minimal ChartData payload from the splash element's
 *  chart_* fields. Studio's Recharts-based ChartRenderer needs
 *  series[].values + categories + title; everything else can default. */
function toChartData(el: ViewerElementJson): ChartData | null {
  if (el.type !== "BridgeChart") return null
  const series = el.chart_series || []
  return {
    chart_type: el.chart_type || "column_clustered",
    categories: el.chart_categories || [],
    categories_are_numeric: false,
    series: series.map((s, i) => ({
      idx: i,
      name: s.name || `Series ${i + 1}`,
      values: s.values.map((v) => (typeof v === "number" ? v : null)),
      x_values: [],
      color: s.color ?? null,
      point_colors: [],
      plot_type: null,
      smooth: false,
      invert_if_negative: false,
      line: { color: null, width: null, dash: null, smooth: false, visible: true } as never,
      marker: { color: null, size: null, style: null, visible: false } as never,
      data_labels: {
        show: false, show_val: false, show_cat_name: false, show_ser_name: false,
        show_percent: false, position: null, format: null, font_size: null,
        font_color: null, separator: null,
      },
    })),
    title: {
      text: el.chart_title ?? null,
      font_size: null, font_name: null, font_bold: null,
      font_italic: null, font_color: null,
    },
    legend: {
      visible: true, position: "bottom", overlay: false,
      font_size: null, font_name: null, font_color: null,
    },
    category_axis: emptyAxis(),
    value_axis:    emptyAxis(),
    plot_properties: {
      grouping: null, bar_width_ratio: null, overlap: null,
      is_horizontal: false, first_slice_ang: null, hole_size: null,
      vary_colors: null,
    },
  }
}

function emptyAxis() {
  return {
    visible: true, axis_type: null, min: null, max: null,
    major_unit: null, minor_unit: null,
    gridlines_major: false, gridlines_minor: false,
    number_format: null, reverse_order: false,
    title: { text: null, font_size: null, font_name: null, font_bold: null },
    tick_label_font_size: null, tick_label_font_color: null,
    tick_label_rotation: null, tick_label_position: null,
    log_scale: false, display_units: null,
  } as never
}


/** Build a minimal TableData payload from the splash element's
 *  table_data 2-D string array. The studio TableRenderer expects
 *  per-cell objects; we wrap each string as a one-paragraph,
 *  one-run cell. */
function toTableData(el: ViewerElementJson): TableData | null {
  if (el.type !== "BridgeTable" || !el.table_data) return null
  const data = el.table_data
  const rows = data.length
  const cols = data[0]?.length ?? 0
  const cells = data.map((row, ri) =>
    row.map((text, ci) => ({
      row: ri, col: ci, text,
      paragraphs: [{
        idx: 0, alignment: null, space_before: null, space_after: null,
        line_spacing: null, indent_level: null, left_indent: null,
        bullet_type: null, bullet_char: null,
        runs: [{
          idx: 0, text, is_line_break: false,
          font_name: null, font_size: null, font_bold: null,
          font_italic: null, font_underline: null, font_color: null,
          strikethrough: null, font_caps: null,
          baseline_shift: null, char_spacing: null,
        } as RunData],
      } as ParagraphData],
      font_name: null, font_size: null, font_bold: null,
      font_italic: null, font_color: null,
      fill_color: null, fill_type: null,
      h_align: null, v_align: null, word_wrap: null,
      merge: { is_origin: true, is_spanned: false, row_span: 1, col_span: 1 },
      borders: null,
    })),
  )
  return {
    rows, cols, cells,
    column_widths: Array(cols).fill(1),
    row_heights:   Array(rows).fill(0.5),
    properties: {
      first_row_header: !!el.first_row_header,
      first_col_header: false,
      last_row_total: false,
      last_col_total: false,
      banded_rows: !!el.banded_rows,
      banded_cols: false,
    },
    defaults: { font_name: null, font_size: null },
  } as TableData
}


// ── Main component ────────────────────────────────────────────────────────


export default function SlideViewer({
  slideData, width = 480, className, background = "#FFFFFF",
}: SlideViewerProps) {
  const docId  = slideData.doc_id || `viewer-static`
  const slideN = slideData.slide_n
  const W      = slideData.width_in  || 13.333
  const H      = slideData.height_in || 7.5
  const bgColor = background || slideData.background_color || "#FFFFFF"

  // Create + prime the local store SYNCHRONOUSLY in useMemo so it's
  // populated before any child renderer mounts. Doing this in useEffect
  // is too late — the renderers' own useEffect fires first (deeper
  // children run first in React's effect order), they call
  // loadChartPayload/etc on an empty store, the cache miss triggers a
  // network fetch to /api/docs/<viewer-doc>/... which returns 401
  // (no auth + no real doc), and the slide renders empty with errors.
  //
  // Priming in useMemo runs BEFORE child mount, so by the time the
  // renderers' effects fire, the store already has the payloads cached.
  const store = useMemo(() => {
    const s = new StudioStore()
    const studioElements: StudioElement[] = slideData.elements.map((el, i) =>
      toStudioElement(el, docId, slideN, i, W, H),
    )
    const response: SlideElementsResponse = {
      slide_number:    slideN,
      slide_width_in:  W,
      slide_height_in: H,
      element_count:   studioElements.length,
      elements:        studioElements,
      background_color: bgColor,
    }
    s.hydrateSlide(docId, response)
    // Prime ALL FOUR payload kinds for EVERY element. The renderers
    // dispatch a loadX fetch when its kind is `undefined` in the
    // cached payload — so a text-less shape that's missing a `text`
    // payload will still fire loadTextPayload (and 401, since the
    // splash has no real doc). Setting an empty "none" / null
    // placeholder for unused kinds makes the cache check pass on
    // every kind and suppresses every network call.
    slideData.elements.forEach((raw, i) => {
      const eid = studioElements[i].id

      const text = toTextContent(raw) ?? { kind: "none" as const }
      s.primePayload(docId, slideN, eid, "text", text)
      s.primePayload(docId, slideN, eid, "style", toStyleData(raw))

      const chart = raw.type === "BridgeChart" ? toChartData(raw) : null
      // Even non-chart elements get a sentinel so ChartRenderer's
      // hook (when accidentally consulted) doesn't fire a fetch.
      if (chart) s.primePayload(docId, slideN, eid, "chart", chart)
      else       s.primePayload(docId, slideN, eid, "chart", EMPTY_CHART)

      const table = raw.type === "BridgeTable" ? toTableData(raw) : null
      if (table) s.primePayload(docId, slideN, eid, "table", table)
      else       s.primePayload(docId, slideN, eid, "table", EMPTY_TABLE)
    })
    return s
  }, [slideData, docId, slideN, W, H, bgColor])

  const height = Math.round((width * H) / W)

  return (
    <StudioStoreContext.Provider value={store}>
      <ViewportShell
        docId={docId}
        slideN={slideN}
        W={W} H={H}
        pxWidth={width} pxHeight={height}
        bgColor={bgColor}
        className={className}
      />
    </StudioStoreContext.Provider>
  )
}


/** Inner shell — inside the Provider so its children can use the hooks.
 *  Renders the slide canvas at the requested pixel size, scales the
 *  inch-based renderers via a single transform on the inner div. */
function ViewportShell({
  docId, slideN, W, H, pxWidth, pxHeight, bgColor, className,
}: {
  docId: string; slideN: number
  W: number; H: number
  pxWidth: number; pxHeight: number
  bgColor: string
  className?: string
}) {
  const scale = pxWidth / W

  return (
    <div
      className={className}
      style={{
        width: pxWidth, height: pxHeight,
        overflow: "hidden",
        background: bgColor,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width:  `${W}in`,
          height: `${H}in`,
          // Inch units are the studio canvas's coordinate system. Scale
          // the whole thing down to fit pxWidth × pxHeight.
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <SlideElementsLayer docId={docId} slideN={slideN} />
      </div>
    </div>
  )
}


/** Mount each element via the renderer registry. No ElementOverlay,
 *  no selection, no drag — just the native renderer at the right
 *  pixel position. Runs inside StudioStoreContext.Provider so hooks
 *  resolve to the local per-viewer store. */
function SlideElementsLayer({ docId, slideN }: { docId: string; slideN: number }) {
  const state = useStudioStore()
  const elements = useMemo(
    () => [...state.elements].sort((a, b) => a.z_index - b.z_index),
    [state.elements],
  )

  return (
    <>
      {elements.map((el) => {
        const Renderer = getRenderer(el.type)
        if (!Renderer) return null
        return (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left:   `${el.left_in}in`,
              top:    `${el.top_in}in`,
              width:  `${el.width_in}in`,
              height: `${el.height_in}in`,
              pointerEvents: "none",   // view-mode: no interaction
            }}
          >
            <Renderer
              element={el}
              docId={docId}
              slideN={slideN}
              renderKey={0}
              selected={false}
            />
          </div>
        )
      })}
    </>
  )
}
