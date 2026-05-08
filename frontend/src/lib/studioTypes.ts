export interface StudioElement {
  id: string
  index: number
  type: string
  label: string
  name: string
  text_preview: string | null
  left_in: number
  top_in: number
  width_in: number
  height_in: number
  left_pct: number
  top_pct: number
  width_pct: number
  height_pct: number
  rotation: number
  flip_h: boolean
  flip_v: boolean
  z_index: number
  locked: boolean
  hidden: boolean
  animation: string
  geometry_preset: string | null
  children?: StudioElement[] | null
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
  line_visible: boolean | null
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

// ── Chart types (typed editor for BridgeChart) ────────────────────────────────

export type ChartType =
  | "COLUMN_CLUSTERED" | "COLUMN_STACKED" | "COLUMN_100_PERCENT_STACKED"
  | "BAR_CLUSTERED"    | "BAR_STACKED"    | "BAR_100_PERCENT_STACKED"
  | "LINE"             | "LINE_MARKERS"
  | "AREA"             | "AREA_STACKED"
  | "PIE"              | "PIE_EXPLODED"
  | "DOUGHNUT"         | "DOUGHNUT_EXPLODED"
  | "XY_SCATTER"       | "XY_SCATTER_LINES" | "XY_SCATTER_LINES_NO_MARKERS" | "XY_SCATTER_SMOOTH"
  | "BUBBLE"

export interface ChartLineFormat {
  visible: boolean
  width: number | null
  color: string | null
  dash: string | null
}

export interface ChartMarkerFormat {
  style: string | null
  size: number | null
  color: string | null
  line_visible: boolean
}

export interface ChartDataLabels {
  show: boolean
  show_val: boolean
  show_cat_name: boolean
  show_ser_name: boolean
  show_percent: boolean
  position: string | null
  format: string | null
  font_size: number | null
  font_color: string | null
  separator: string | null
}

export interface ChartSeriesData {
  idx: number
  name: string
  values: (number | null)[]
  x_values: (number | null)[]
  color: string | null
  plot_type: string | null
  smooth: boolean
  invert_if_negative: boolean
  line: ChartLineFormat
  marker: ChartMarkerFormat
  data_labels: ChartDataLabels
}

export interface ChartTitleFull {
  text: string | null
  font_size: number | null
  font_name: string | null
  font_bold: boolean | null
  font_italic: boolean | null
  font_color: string | null
}

export interface ChartLegendData {
  visible: boolean
  position: string | null    // "TOP" | "BOTTOM" | "LEFT" | "RIGHT" | "CORNER" | null
  overlay: boolean
  font_size: number | null
  font_name: string | null
  font_color: string | null
}

export interface ChartAxisData {
  visible: boolean
  axis_type: string | null
  min: number | null
  max: number | null
  major_unit: number | null
  minor_unit: number | null
  gridlines_major: boolean
  gridlines_minor: boolean
  number_format: string | null
  reverse_order: boolean
  title: { text: string | null; font_size: number | null; font_name: string | null; font_bold: boolean | null }
  tick_label_font_size: number | null
  tick_label_font_color: string | null
  tick_label_rotation: number | null
}

export interface ChartPlotProperties {
  grouping: string | null
  bar_width_ratio: number | null
  overlap: number | null
  is_horizontal: boolean
  first_slice_ang: number | null
  hole_size: number | null
  vary_colors: boolean | null
}

export interface ChartData {
  chart_type: ChartType | string
  categories: string[]
  categories_are_numeric: boolean
  series: ChartSeriesData[]
  title: ChartTitleFull
  legend: ChartLegendData
  category_axis: ChartAxisData
  value_axis: ChartAxisData
  plot_properties: ChartPlotProperties
}

// PATCH body — every field optional, partial dicts allowed for nested objects
export type ChartDataUpdate = Partial<{
  chart_type: string
  categories: string[]
  categories_are_numeric: boolean
  series: Array<Partial<ChartSeriesData>>
  title: Partial<ChartTitleFull>
  legend: Partial<ChartLegendData>
  category_axis: Partial<ChartAxisData>
  value_axis: Partial<ChartAxisData>
  plot_properties: Partial<ChartPlotProperties>
}>

// ── Table types (typed editor for BridgeTable) ────────────────────────────────

export interface CellBorderSide {
  visible: boolean
  style:   string | null  // "solid" | "dash" | "dot" | etc.
  width:   number | null
  color:   string | null
}

export interface CellBorders {
  top:    CellBorderSide | null
  bottom: CellBorderSide | null
  left:   CellBorderSide | null
  right:  CellBorderSide | null
}

export interface CellMergeData {
  is_origin:  boolean
  is_spanned: boolean
  row_span:   number
  col_span:   number
}

export interface TableCellEditor {
  row:         number
  col:         number
  text:        string
  font_name:   string | null
  font_size:   number | null
  font_bold:   boolean | null
  font_italic: boolean | null
  font_color:  string | null
  h_align:     string  // "left" | "center" | "right" | "justify"
  v_align:     string  // "top" | "middle" | "bottom"
  fill_color:  string | null
  fill_type:   string | null
  word_wrap:   boolean | null
  merge:       CellMergeData
  borders:     CellBorders
}

export interface TableProperties {
  first_row_header: boolean
  first_col_header: boolean
  last_row_total:   boolean
  last_col_total:   boolean
  banded_rows:      boolean
  banded_cols:      boolean
}

export interface TableData {
  rows: number
  cols: number
  cells: TableCellEditor[][]
  column_widths: number[]
  row_heights:   number[]
  properties:    TableProperties
  defaults:      { font_name: string | null; font_size: number | null }
}

export type TableDataUpdate = Partial<{
  cells:        Array<Partial<TableCellEditor> & { row: number; col: number }>
  column_widths: number[]
  row_heights:   number[]
  properties:    Partial<TableProperties>
  op:    "insert_row" | "delete_row" | "insert_col" | "delete_col"
  index: number
}>

// ── Connector types (typed editor for BridgeConnector) ────────────────────────

export interface ConnectorLine {
  visible:    boolean
  color:      string | null
  width:      number | null
  dash_style: string
  head_end:   string | null   // "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle"
  tail_end:   string | null
  head_size:  string | null   // "sm" | "med" | "lg"
  tail_size:  string | null
}

export interface ConnectorEndpoints {
  start_x: number
  start_y: number
  end_x:   number
  end_y:   number
}

export interface ConnectorData {
  connector_type: string  // "straight" | "elbow" | "curved"
  endpoints:      ConnectorEndpoints
  line:           ConnectorLine
}

export type ConnectorDataUpdate = Partial<{
  connector_type: string
  endpoints:      Partial<ConnectorEndpoints>
  line:           Partial<ConnectorLine>
}>
