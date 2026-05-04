export interface StudioElement {
  id: string
  index: number
  type: string
  label: string
  name: string
  left_in: number
  top_in: number
  width_in: number
  height_in: number
  left_pct: number
  top_pct: number
  width_pct: number
  height_pct: number
  rotation: number
  z_index: number
  locked: boolean
  hidden: boolean
}

export interface SlideElementsResponse {
  slide_number: number
  slide_width_in: number
  slide_height_in: number
  element_count: number
  elements: StudioElement[]
  background_color: string | null
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

export interface ElementBounds {
  left_pct: number
  top_pct: number
  width_pct: number
  height_pct: number
}

// ── Text content types ─────────────────────────────────────────────────────────

export interface RunData {
  idx: number
  text: string
  is_line_break: boolean
  font_name: string | null
  font_size: number | null
  font_bold: boolean | null
  font_italic: boolean | null
  font_underline: boolean | null
  font_color: string | null
  strikethrough: string | null  // "sng" | "dbl" | null
  font_caps: string | null      // "all" | "small" | null
}

export interface ParagraphData {
  idx: number
  alignment: string | null
  space_before: number | null
  space_after: number | null
  runs: RunData[]
}

export interface ParagraphsTextContent {
  kind: "paragraphs"
  paragraphs: ParagraphData[]
}

export interface ChartTitleData {
  text: string | null
  font_size: number | null
  font_bold: boolean | null
  font_italic: boolean | null
  font_name: string | null
  font_color: string | null
}

export interface ChartAxisTitleData {
  text: string | null
  font_size: number | null
  font_bold: boolean | null
  font_name: string | null
}

export interface ChartTextContent {
  kind: "chart"
  title: ChartTitleData
  cat_axis_title: ChartAxisTitleData | null
  val_axis_title: ChartAxisTitleData | null
  legend: { font_size: number | null; font_bold: boolean | null; font_name: string | null; font_color: string | null } | null
  series: Array<{
    idx: number
    name: string | null
    data_labels: { show: boolean; font_size: number | null; font_bold: boolean | null; font_name: string | null; font_color: string | null }
  }>
}

export interface TableCellData {
  row: number
  col: number
  text: string
  paragraphs: ParagraphData[]
  font_name: string | null
  font_size: number | null
  font_bold: boolean | null
  font_italic: boolean | null
}

export interface TableTextContent {
  kind: "table"
  rows: number
  cols: number
  cells: TableCellData[][]
}

export type ElementTextContent =
  | ParagraphsTextContent
  | ChartTextContent
  | TableTextContent
  | { kind: "none" }

// ── Style types ────────────────────────────────────────────────────────────────

export interface ElementStyleData {
  fill_type: string | null     // "solid" | "gradient" | "pattern" | "none" | null
  fill_color: string | null    // hex "#RRGGBB"
  line_color: string | null
  line_width: number | null    // pt
  line_dash: string | null     // "solid" | "dash" | "dot" | "dash_dot" etc.
  opacity: number | null       // 0.0 – 1.0
  shadow_on: boolean | null
  shadow_color: string | null
  shadow_blur: number | null   // pt
  shadow_offset_x: number | null
  shadow_offset_y: number | null
  crop_left: number | null     // 0.0 – 1.0 fraction
  crop_right: number | null
  crop_top: number | null
  crop_bottom: number | null
}

export interface ElementStyleUpdate {
  fill_color?: string | null
  fill_type?: string | null
  line_color?: string | null
  line_width?: number | null
  line_dash?: string | null
  opacity?: number | null
  shadow_on?: boolean | null
  shadow_color?: string | null
  shadow_blur?: number | null
  shadow_offset_x?: number | null
  shadow_offset_y?: number | null
  crop_left?: number | null
  crop_right?: number | null
  crop_top?: number | null
  crop_bottom?: number | null
}
