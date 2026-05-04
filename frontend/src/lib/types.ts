export type SourceFormat = "pptx" | "pdf" | "tableau"

export interface WorkspaceFile {
  name: string
  path: string
  size_kb: number
  format?: SourceFormat
}

export interface DocInfo {
  doc_id: string
  name: string
  slide_count: number
  source_path: string
  source_format?: SourceFormat
  has_rebuild: boolean
  has_originals: boolean
  has_rebuilt_renders?: boolean
  grade_summary?: GradeSummary
  diagnostic_summary?: DiagnosticSummary
  grades?: Record<number, Grade>
  tableau?: TableauOverview | null
  cloud_bundle_uri?: string | null
}

export type Grade = "good" | "partial" | "bad"

export interface GradeSummary {
  good: number
  partial: number
  bad: number
  graded: number
  ungraded: number
}

export interface DiagnosticCodeCount {
  code: string
  count: number
}

export interface DiagnosticSlideCount {
  slide: number
  count: number
}

export interface DiagnosticSummary {
  total: number
  top_codes: DiagnosticCodeCount[]
  top_slides: DiagnosticSlideCount[]
}

export interface RenderStatus {
  has_originals: boolean
  has_bridge: boolean
  has_rebuild: boolean
  has_rebuilt_renders: boolean
  pixel_scores?: Record<string, number>
}

export interface HistoryEvent {
  id: string
  ts: string
  type: string
  status: "ok" | "warn" | "error" | string
  message: string
  details?: Record<string, unknown>
}

export interface VisionGradeResult {
  doc_id: string
  slide_n: number
  target: "bridge" | "rebuilt"
  model: string
  lmstudio_url: string
  rms: number
  diff_path: string
  vision: {
    status: "ok" | "error" | string
    raw?: string
    parsed?: unknown
    error?: string
  }
}

export interface HistoryDoc {
  source_path: string
  name: string
  source_format: SourceFormat
  slide_count: number
  created_at?: string
  updated_at?: string
  grades?: Record<string, Grade>
  grade_summary?: GradeSummary
  diagnostic_summary?: DiagnosticSummary
  render_status?: RenderStatus
  rebuilt_path?: string | null
  events: HistoryEvent[]
  run_count: number
  last_event?: HistoryEvent
  tableau?: TableauOverview | null
}

export interface DocSummary {
  doc_id: string
  name: string
  source_path: string
  source_format: SourceFormat
  slide_count: number
  grade_summary: GradeSummary
  diagnostic_summary: DiagnosticSummary
  render_status: RenderStatus
  rebuilt_path: string | null
  events: HistoryEvent[]
  run_count: number
  updated_at?: string
  tableau?: TableauOverview | null
}

export interface Diagnostic {
  slide_number?: number | null
  element_type: string
  source_shape_id: number | null
  source_shape_name: string | null
  code: string
  message: string
}

export interface OnboardResult {
  doc_id: string
  name: string
  slide_count: number
  has_originals: boolean
  source_format?: SourceFormat
  tableau?: TableauOverview | null
}

export interface RebuildResult {
  rebuilt_path: string
  has_rebuilt_renders: boolean
  diagnostic_count: number
  diagnostic_summary?: DiagnosticSummary
}

export interface TableauOverview {
  workbook_name?: string
  version?: string
  source_build?: string
  source_platform?: string
  worksheet_count: number
  dashboard_count: number
  datasource_count: number
  datasources: TableauDatasource[]
  packaged_files: string[]
  packaged_extracts?: TableauPackagedExtract[]
  packaged_images?: TableauPackagedImage[]
  color_palettes?: TableauColorPalette[]
}

export interface TableauDatasource {
  name?: string
  caption?: string
  version?: string
  columns?: TableauColumn[]
  connections?: Array<Record<string, unknown>>
  metadata_records?: Array<Record<string, unknown>>
}

export interface TableauColumn {
  name?: string
  caption?: string
  datatype?: string
  role?: string
  type?: string
  formula?: string | null
  calculation_class?: string | null
  datasource?: string
  aliases?: Array<Record<string, string | null>>
}

export interface TableauArtifact {
  number: number
  kind: "worksheet" | "dashboard" | string
  name: string
  title?: string
  mark_types?: string[]
  primary_mark_type?: string
  datasources?: Array<{ name?: string; caption?: string }>
  columns?: TableauColumn[]
  filters?: Array<Record<string, unknown>>
  rows?: string[]
  cols?: string[]
  shelves?: {
    rows?: string[]
    cols?: string[]
    row_fields?: string[]
    col_fields?: string[]
    marks?: Array<{
      pane_id?: string
      class?: string
      encodings?: Array<Record<string, string | null | Record<string, string>>>
      customized_label?: string
      customized_tooltip?: string
      style_formats?: Array<Record<string, string | null>>
    }>
  }
  used_fields?: string[]
  visual_items?: TableauVisualItem[]
  pythonic_model?: TableauPythonicModel
  style_model?: Record<string, unknown>
  style_summary?: Record<string, unknown>
  layout?: TableauLayoutInfo
  reconstruction?: TableauReconstruction
  size?: Record<string, string>
  zones?: TableauZone[]
  element_counts: Record<string, number>
  elements: TableauBridgeElement[]
}

export interface TableauZone {
  id?: string
  type?: string
  name?: string
  param?: string
  x?: number
  y?: number
  w?: number
  h?: number
  children?: TableauZone[]
}

export interface TableauBridgeElement {
  type: string
  tableau_kind?: string
  name?: string
  position?: Record<string, number>
  tableau?: Record<string, unknown>
  tableau_zone?: TableauZone
}

export interface TableauDoc {
  overview: TableauOverview | null
  artifacts: TableauArtifact[]
}

export interface TableauPackagedExtract {
  path: string
  name: string
  format: "hyper" | "tde" | string
  size_bytes: number
  status: "ok" | "error" | "missing_dependency" | "unsupported_legacy_tde" | string
  error?: string
  message?: string
  header_preview?: string
  tables?: Array<{
    schema?: string
    name?: string
    row_count?: number
    columns?: Array<Record<string, unknown>>
    sample_rows?: Array<Record<string, unknown>>
  }>
}

export interface TableauPackagedImage {
  index: number
  path: string
  name: string
  format?: string
  size_bytes?: number
  kind?: string
  width_px?: number
  height_px?: number
}

export interface TableauColorPalette {
  name?: string
  type?: string
  custom?: string
  colors: string[]
}

export interface TableauVisualItem {
  id?: string
  name?: string
  kind?: "chart" | "table" | "map" | string
  bridge_target?: string
  mark_type?: string
  pane_id?: string
  can_recreate_structure?: boolean
  can_recreate_values?: boolean
  role_mappings?: {
    rows?: Array<Record<string, unknown>>
    cols?: Array<Record<string, unknown>>
    marks?: Record<string, Array<Record<string, unknown>>>
    filters?: Array<Record<string, unknown>>
  }
  field_dependencies?: Array<Record<string, unknown>>
  style?: Record<string, unknown>
  data_requirements?: Record<string, unknown>
  render_plan?: Record<string, unknown>
  query_plan?: TableauQueryPlan
  pythonic_model?: TableauPythonicModel
  layout?: TableauLayoutInfo
  limitations?: string[]
}

export interface TableauPythonicModel {
  status?: string
  target?: string
  formulas?: Array<Record<string, unknown>>
  filters?: Array<Record<string, unknown>>
  sorts?: Array<Record<string, unknown>>
  style?: Record<string, unknown>
  layout?: Record<string, unknown>
  field_instances?: Record<string, unknown>
  blocked_by?: string[]
  execution_order?: string[]
}

export interface TableauLayoutInfo {
  worksheet_canvas?: Record<string, unknown>
  dashboard_placements?: TableauDashboardPlacement[]
  element_positions?: TableauElementPosition[]
}

export interface TableauDashboardPlacement {
  dashboard?: string
  zone_id?: string
  zone_type?: string
  worksheet?: string
  dashboard_size_px?: { width?: number; height?: number }
  tableau_units?: { x?: number; y?: number; w?: number; h?: number }
  normalized?: { x?: number; y?: number; w?: number; h?: number }
  pixels?: { x?: number; y?: number; w?: number; h?: number }
  raw_properties?: Record<string, unknown>
}

export interface TableauElementPosition {
  id?: string
  kind?: string
  bridge_target?: string
  position_confidence?: string
  order?: number
  field?: Record<string, unknown>
  source?: string
  dashboard?: string
  normalized?: { x?: number; y?: number; w?: number; h?: number }
  pixels?: { x?: number; y?: number; w?: number; h?: number }
  style?: Record<string, unknown>
  dashboard_placements?: TableauDashboardPlacement[]
  raw_properties?: Record<string, unknown>
}

export interface TableauQueryPlan {
  status?: string
  pythonic_source?: string
  candidate_tables?: Array<Record<string, unknown>>
  group_by?: Array<Record<string, unknown>>
  measures?: Array<Record<string, unknown>>
  filters?: Array<Record<string, unknown>>
  direct_column_matches?: Array<Record<string, unknown>>
  formula_dependencies?: Array<Record<string, unknown>>
  unresolved_fields?: Array<Record<string, unknown>>
  sql_sketch?: string | null
  python_code_sketch?: string | null
  python_execution?: {
    reader?: string
    steps?: string[]
    blocked_by?: string[]
  }
}

export interface TableauReconstruction {
  visual_kind?: "chart" | "table" | "map" | string
  bridge_target?: string
  can_recreate_structure?: boolean
  can_recreate_values?: boolean
  confidence?: "low" | "medium" | "high" | string
  available?: Record<string, boolean>
  counts?: Record<string, number>
  items?: TableauVisualItem[]
  limitations?: string[]
  next_step?: string
}
