import type { SlideElementsResponse, StudioElement, ElementTextContent, ElementStyleData, ElementStyleUpdate, ChartData, ChartDataUpdate, TableData, TableDataUpdate, ConnectorData, ConnectorDataUpdate } from "./studioTypes"
import { offlineFetch, OfflineQueuedError } from "./offlineQueue"

export interface TextSearchMatch {
  slide_n: number
  element_id: string
  element_type: string
  preview: string
  in_notes?: boolean
}

export interface ElementSearchResult {
  slide_n: number
  element_id: string
  element_type: string
  name: string
  label: string
  preview: string
}

export interface ReplaceTextResult {
  replaced: number
  affected_slides: number[]
}

const BASE = "/api"

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase()
  const fetchFn = method === "GET" ? fetch : offlineFetch
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch (err) {
    if (err instanceof OfflineQueuedError) throw err
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Slide management ──────────────────────────────────────────────────────────

export async function addSlide(docId: string, afterN = 0): Promise<{ slide_count: number; new_slide_n: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides?after_n=${afterN}`, { method: "POST" })
}

export async function deleteSlide(docId: string, n: number): Promise<{ slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}`, { method: "DELETE" })
}

export async function duplicateSlide(docId: string, n: number): Promise<{ slide_count: number; new_slide_n: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/duplicate`, { method: "POST" })
}

export async function moveSlide(docId: string, n: number, toN: number): Promise<{ slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/move?to_n=${toN}`, { method: "PATCH" })
}

export async function setSlideBackground(docId: string, n: number, color: string | null): Promise<{ background_color: string | null }> {
  const params = color ? `?color=${encodeURIComponent(color)}` : ""
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/background${params}`, { method: "PATCH" })
}

export async function setAllSlidesBackground(docId: string, color: string | null): Promise<{ background_color: string | null; slides_updated: number }> {
  const params = color ? `?color=${encodeURIComponent(color)}` : ""
  return apiFetch(`${BASE}/docs/${docId}/background-all${params}`, { method: "PATCH" })
}

export async function setGradientBackground(
  docId: string,
  slideN: number,
  stops: { color: string; position: number }[],
  angle: number,
): Promise<{ ok: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/gradient-background`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stops, angle }),
  })
}

export async function getSlideNotes(docId: string, n: number): Promise<{ notes_text: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/notes`)
}

export async function updateSlideNotes(docId: string, n: number, notesText: string): Promise<{ notes_text: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes_text: notesText }),
  })
}

export async function createNewElement(
  docId: string,
  slideN: number,
  opts: {
    shape_type?: string
    left_in?: number
    top_in?: number
    width_in?: number
    height_in?: number
    fill_color?: string
    label?: string
  },
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) },
  )
}

export interface FreeformPathCmd {
  cmd: "M" | "L" | "Z"
  pts: [number, number][]  // slide-space inches
}

export async function createFreeformPathElement(
  docId: string,
  slideN: number,
  commands: FreeformPathCmd[],
  opts: {
    fill_color?: string | null
    fill_type?: string
    line_visible?: boolean
    line_color?: string | null
    line_width?: number | null
    name?: string
  } = {},
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/freeform-path`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands, ...opts }) },
  )
}

// ── Slide elements ────────────────────────────────────────────────────────────

export async function fetchSlideElements(docId: string, slideN: number): Promise<SlideElementsResponse> {
  return apiFetch<SlideElementsResponse>(`${BASE}/docs/${docId}/slides/${slideN}/elements`)
}

export async function renderSingleSlide(docId: string, slideN: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `${BASE}/docs/${docId}/slides/${slideN}/render`,
    { method: "POST" },
  )
}

export function exportPptxUrl(docId: string): string {
  return `${BASE}/docs/${docId}/export`
}

export function exportPdfUrl(docId: string): string {
  return `${BASE}/docs/${docId}/export-pdf`
}

export function exportPngZipUrl(docId: string): string {
  return `${BASE}/docs/${docId}/export-png-zip`
}

export async function fetchElementText(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<ElementTextContent> {
  return apiFetch<ElementTextContent>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/text`,
  )
}

export async function updateElementText(
  docId: string,
  slideN: number,
  elementId: string,
  update: unknown,
): Promise<ElementTextContent> {
  return apiFetch<ElementTextContent>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/text`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

export async function fetchUndoState(docId: string): Promise<{ undo_depth: number; redo_depth: number }> {
  return apiFetch(`${BASE}/docs/${docId}/undo-state`)
}

export async function undoDoc(docId: string): Promise<{ ok: boolean; undo_depth: number; redo_depth: number }> {
  return apiFetch(`${BASE}/docs/${docId}/undo`, { method: "POST" })
}

export async function redoDoc(docId: string): Promise<{ ok: boolean; undo_depth: number; redo_depth: number }> {
  return apiFetch(`${BASE}/docs/${docId}/redo`, { method: "POST" })
}

export async function deleteElement(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<{ ok: boolean; deleted: string }> {
  return apiFetch<{ ok: boolean; deleted: string }>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}`,
    { method: "DELETE" },
  )
}

export async function bulkDeleteElements(
  docId: string,
  slideN: number,
  elementIds: string[],
): Promise<{ ok: boolean; deleted: number }> {
  return apiFetch<{ ok: boolean; deleted: number }>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/bulk-delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ element_ids: elementIds }),
    },
  )
}

export async function duplicateElement(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/duplicate`,
    { method: "POST" },
  )
}

export async function fetchElementStyle(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<ElementStyleData> {
  return apiFetch<ElementStyleData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/style`,
  )
}

export async function bulkUpdateStyle(
  docId: string,
  slideN: number,
  elementIds: string[],
  style: ElementStyleUpdate,
): Promise<{ updated: number; styles: ElementStyleData[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/bulk-style`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_ids: elementIds, style }),
  })
}

export async function updateElementStyle(
  docId: string,
  slideN: number,
  elementId: string,
  update: ElementStyleUpdate,
): Promise<ElementStyleData> {
  return apiFetch<ElementStyleData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/style`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

// ── Chart data (typed BridgeChart editor) ─────────────────────────────────────

export async function fetchChartData(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<ChartData> {
  return apiFetch<ChartData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/chart-data`,
  )
}

export async function updateChartData(
  docId: string,
  slideN: number,
  elementId: string,
  update: ChartDataUpdate,
): Promise<ChartData> {
  return apiFetch<ChartData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/chart-data`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

// ── Table data (typed BridgeTable editor) ─────────────────────────────────────

export async function fetchTableData(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<TableData> {
  return apiFetch<TableData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/table-data`,
  )
}

export async function updateTableData(
  docId: string,
  slideN: number,
  elementId: string,
  update: TableDataUpdate,
): Promise<TableData> {
  return apiFetch<TableData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/table-data`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

// ── Connector data (typed BridgeConnector editor) ─────────────────────────────

export async function fetchConnectorData(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<ConnectorData> {
  return apiFetch<ConnectorData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/connector-data`,
  )
}

export async function updateConnectorData(
  docId: string,
  slideN: number,
  elementId: string,
  update: ConnectorDataUpdate,
): Promise<ConnectorData> {
  return apiFetch<ConnectorData>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/connector-data`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

// ── Connects (per-element Python script) ─────────────────────────────────────

export interface ConnectScript {
  script:     string
  inputs:     Record<string, unknown>
  updated_at: number
  language:   "python"
}

export interface ConnectTestResult {
  ok:         boolean
  result:     unknown
  error:      string | null
  traceback:  string | null
  stdout:     string
  stderr:     string
}

export async function fetchElementConnect(docId: string, slideN: number, elementId: string): Promise<ConnectScript> {
  return apiFetch<ConnectScript>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/connect`,
  )
}

export async function updateElementConnect(
  docId: string, slideN: number, elementId: string,
  update: { script?: string; inputs?: Record<string, unknown> },
): Promise<ConnectScript> {
  return apiFetch<ConnectScript>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/connect`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) },
  )
}

export async function testElementConnect(
  docId: string, slideN: number, elementId: string,
  body: { script?: string; inputs?: Record<string, unknown> } = {},
): Promise<ConnectTestResult> {
  return apiFetch<ConnectTestResult>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/connect/test`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  )
}

export interface DocConnectRow {
  slide_n:      number
  element_id:   string
  element_type: string
  element_name: string
  updated_at:   number
  script_chars: number
}

export async function listDocConnects(docId: string): Promise<{ connects: DocConnectRow[] }> {
  return apiFetch(`${BASE}/docs/${docId}/connects`)
}

export async function alignElements(
  docId: string,
  slideN: number,
  elementIds: string[],
  alignment: string,
): Promise<StudioElement[]> {
  return apiFetch<StudioElement[]>(
    `${BASE}/docs/${docId}/slides/${slideN}/align-elements`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ element_ids: elementIds, alignment }) },
  )
}

export async function updateElementFlags(
  docId: string,
  slideN: number,
  elementId: string,
  flags: { locked?: boolean; hidden?: boolean },
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/flags`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(flags) },
  )
}

export async function setElementAnimation(
  docId: string,
  slideN: number,
  elementId: string,
  animation: string,
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/animation`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ animation }) },
  )
}

export async function updateElementPosition(
  docId: string,
  slideN: number,
  elementId: string,
  update: { left_in?: number; top_in?: number; width_in?: number; height_in?: number; z_index?: number; rotation?: number; flip_h?: boolean; flip_v?: boolean; name?: string },
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    },
  )
}

export async function copyElementToSlide(
  docId: string,
  srcSlideN: number,
  elementId: string,
  targetN: number,
  offsetX = 0.25,
  offsetY = 0.25,
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${srcSlideN}/elements/${encodeURIComponent(elementId)}/copy-to-slide?target_n=${targetN}&offset_x=${offsetX}&offset_y=${offsetY}`,
    { method: "POST" },
  )
}

export async function createChartElement(
  docId: string,
  slideN: number,
  opts: { chart_type?: string; left_in?: number; top_in?: number; width_in?: number; height_in?: number } = {},
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/chart`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) },
  )
}

export async function createTableElement(
  docId: string,
  slideN: number,
  opts: { rows?: number; cols?: number; left_in?: number; top_in?: number; width_in?: number; height_in?: number } = {},
): Promise<StudioElement> {
  const { rows, cols, left_in, top_in, width_in, height_in } = opts
  const body: Record<string, unknown> = { rows: rows ?? 4, cols: cols ?? 3 }
  if (left_in !== undefined || top_in !== undefined || width_in !== undefined || height_in !== undefined) {
    body.position = { left_in: left_in ?? 1.5, top_in: top_in ?? 2, width_in: width_in ?? 7, height_in: height_in ?? 3 }
  } else {
    body.position = { left_in: 1.5, top_in: 2, width_in: 7, height_in: 3 }
  }
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/table`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  )
}

export async function createImageElement(
  docId: string,
  slideN: number,
  file: File,
): Promise<StudioElement> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/image`,
    { method: "POST", body: form },
  )
}

export async function replaceImage(
  docId: string,
  slideN: number,
  elementId: string,
  file: File,
): Promise<{ ok: boolean; bytes: number; format: string }> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/replace-image`,
    { method: "POST", body: form },
  )
}

export async function broadcastElement(
  docId: string,
  slideN: number,
  elementId: string,
  opts: { skipSlides?: number[]; exactPosition?: boolean } = {},
): Promise<{ pushed_to: number; source_slide: number; element_id: string }> {
  return apiFetch(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/broadcast`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skip_slides: opts.skipSlides ?? [],
        exact_position: opts.exactPosition ?? true,
      }),
    },
  )
}

export async function fetchThemeColors(docId: string): Promise<{ theme_colors: Record<string, string> }> {
  return apiFetch(`${BASE}/docs/${docId}/theme-colors`)
}

export async function searchText(docId: string, q: string, includeNotes = false): Promise<TextSearchMatch[]> {
  const params = new URLSearchParams({ q })
  if (includeNotes) params.set("include_notes", "true")
  return apiFetch<TextSearchMatch[]>(`${BASE}/docs/${docId}/search-text?${params}`)
}

export async function searchElements(docId: string, q = ""): Promise<ElementSearchResult[]> {
  return apiFetch<ElementSearchResult[]>(`${BASE}/docs/${docId}/search-elements?q=${encodeURIComponent(q)}`)
}

export interface DocStats {
  slide_count: number
  total_elements: number
  type_counts: Record<string, number>
  word_count: number
  notes_word_count: number
  slides_with_notes?: number
  notes_coverage_pct?: number
  section_count?: number
  sections?: string[]
  sections_with_counts?: Record<string, number>
  timer_budget_minutes?: number | null
  ratings_distribution?: Record<number, number>
  rated_count?: number
  hidden_count?: number
  pinned_count?: number
  tagged_count?: number
}

export async function fetchDocStats(docId: string): Promise<DocStats> {
  return apiFetch<DocStats>(`${BASE}/docs/${docId}/stats`)
}

export function statsExportJsonUrl(docId: string): string {
  return `${BASE}/docs/${docId}/stats-export?fmt=json`
}

export function statsExportCsvUrl(docId: string): string {
  return `${BASE}/docs/${docId}/stats-export?fmt=csv`
}

export interface QuizQuestion {
  question: string
  options?: { A: string; B: string; C: string; D: string }
  answer?: string
}

export async function generateSlideQuestions(
  docId: string,
  slideN: number,
  questionType: "discussion" | "quiz" | "comprehension" | "critical" = "discussion",
  count = 5,
): Promise<{ questions: (string | QuizQuestion)[]; question_type: string; slide_n: number; count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/generate-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_type: questionType, count }),
  })
}

export interface CoachTip {
  category: "structure" | "clarity" | "engagement" | "pacing" | "content"
  severity: "high" | "medium" | "low"
  slide_n: number | null
  tip: string
}

export async function runPresentationCoach(
  docId: string,
): Promise<{ tips: CoachTip[]; total: number; slide_count: number; high_priority: number; category_counts: Record<string, number> }> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-coach`, { method: "POST" })
}

export interface TitleSuggestion {
  slide_n: number
  original: string
  suggested: string
  reason: string
}

export async function optimizeTitles(
  docId: string,
): Promise<{ suggestions: TitleSuggestion[]; improved_count: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/optimize-titles`, { method: "POST" })
}

export async function applyTitle(
  docId: string,
  slideN: number,
  newTitle: string,
): Promise<{ ok: boolean; slide_n: number; title: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/apply-title?new_title=${encodeURIComponent(newTitle)}`, { method: "POST" })
}

export interface LayoutIssue {
  slide_n: number
  element_id: string
  name: string
  issue: "out-of-bounds" | "overlap" | "zero-size"
  detail: string
}

export async function detectLayoutIssues(
  docId: string,
  fix = false,
): Promise<{ issues: LayoutIssue[]; total: number; fixed: number; slide_count: number; by_type: Record<string, number> }> {
  return apiFetch(`${BASE}/docs/${docId}/layout-issues?fix=${fix}`)
}

export async function polishSlideText(
  docId: string,
  slideN: number,
  tone: "professional" | "executive" | "casual" | "technical" = "professional",
  apply = false,
): Promise<{ polished: Array<{ element_id: string; original: string; polished: string }>; changed: number; applied: boolean; slide_n: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/polish-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tone, apply }),
  })
}

export interface AudienceAdaptChange {
  element_id: string
  original: string
  adapted: string
}

export interface AudienceAdaptSlide {
  slide_n: number
  elements: AudienceAdaptChange[]
}

export async function adaptForAudience(
  docId: string,
  audienceDescription: string,
  slides?: number[],
  apply = false,
): Promise<{ slides: AudienceAdaptSlide[]; total_changed: number; applied: boolean; audience: string; slides_processed: number }> {
  return apiFetch(`${BASE}/docs/${docId}/adapt-for-audience`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience_description: audienceDescription, slides, apply }),
  })
}

export async function insertToc(
  docId: string,
  title = "Table of Contents",
  afterN = 1,
  style: "dark" | "light" = "dark",
): Promise<{ new_slide_n: number; slide_count: number; entries: number }> {
  return apiFetch(`${BASE}/docs/${docId}/insert-toc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, after_n: afterN, style }),
  })
}

export function notesExportUrl(docId: string, fmt: "md" | "txt" = "md"): string {
  return `${BASE}/docs/${docId}/notes-export?fmt=${fmt}`
}

export interface SlideReadingMetrics {
  slide_n: number
  reading_ease: number | null
  grade_level: number | null
  label: string
  word_count: number
  sentence_count: number
  syllable_count: number
}

export async function fetchReadingLevel(
  docId: string,
): Promise<{ slides: SlideReadingMetrics[]; overall: SlideReadingMetrics | null; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/reading-level`)
}

export async function changeTextCase(
  docId: string,
  textCase: "upper" | "lower" | "title" | "sentence",
  slides?: number[],
): Promise<{ changed: number; affected_slides: number[]; case: string }> {
  return apiFetch(`${BASE}/docs/${docId}/change-text-case`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case: textCase, slides: slides ?? [] }),
  })
}

export interface ImpactScore {
  slide_n: number
  score: number
  label: string
  tip: string
}

export async function fetchImpactScores(
  docId: string,
): Promise<{ scores: ImpactScore[]; average: number; slide_count: number; high_count: number; low_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/impact-scores`)
}

export interface SlideAutoTag {
  slide_n: number
  tags: string[]
}

export async function autoTagSlides(
  docId: string,
): Promise<{ slides: SlideAutoTag[]; slide_count: number; tagged_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/auto-tag-slides`, { method: "POST" })
}

export interface SlideToneResult {
  slide_n: number
  tone: string
  confidence: "high" | "medium" | "low"
  note: string
}

export async function fetchEmotionalTone(
  docId: string,
): Promise<{ slides: SlideToneResult[]; tone_distribution: Record<string, number>; dominant_tone: string; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/emotional-tone`)
}

export interface DeckImage {
  slide_n: number
  element_id: string
  shape_type: string
  width_in: number
  height_in: number
  alt_text: string
  thumbnail_url: string
}

export async function fetchDeckImages(
  docId: string,
): Promise<{ images: DeckImage[]; total: number; slide_count: number; images_per_slide: number }> {
  return apiFetch(`${BASE}/docs/${docId}/images`)
}

export interface AccessibilityIssue {
  element_id: string | null
  type: string
  severity: "high" | "medium" | "low"
  detail: string
}

export interface SlideAccessibility {
  slide_n: number
  issues: AccessibilityIssue[]
}

export async function fetchAccessibilityReport(
  docId: string,
): Promise<{ slides: SlideAccessibility[]; total_issues: number; high_severity: number; score: number; slide_count: number; clean_slides: number }> {
  return apiFetch(`${BASE}/docs/${docId}/accessibility`)
}

export async function generateCoverSlide(
  docId: string,
  title: string,
  subtitle: string,
  author: string,
  date: string,
  style: "dark" | "light" | "accent",
): Promise<{ new_slide_n: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, subtitle, author, date, style }),
  })
}

export function outlineExportUrl(docId: string, fmt: "md" | "txt" = "md", includeNotes = false): string {
  return `${BASE}/docs/${docId}/outline-export?fmt=${fmt}&include_notes=${includeNotes}`
}

export async function manageProgressBars(
  docId: string,
  position: "bottom" | "top" = "bottom",
  color = "#6366F1",
  heightPt = 4,
  remove = false,
): Promise<{ affected_slides: number[]; removed: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/progress-bars`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position, color, height_pt: heightPt, remove }),
  })
}

export async function writeSlideHook(
  docId: string,
  slideN: number,
  hookType: "question" | "statistic" | "story" | "statement" | "quote" = "question",
  apply = false,
): Promise<{ hook: string; hook_type: string; slide_n: number; applied: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/write-hook?hook_type=${hookType}&apply=${apply}`, {
    method: "POST",
  })
}

export interface PreflightCheck {
  id: string
  label: string
  status: "pass" | "warn" | "fail"
  detail: string
  value: number
}

export async function fetchPreflight(
  docId: string,
): Promise<{ checks: PreflightCheck[]; passed: number; warned: number; failed: number; overall: string; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/preflight`)
}

export async function generateConclusionSlide(
  docId: string,
  style: "dark" | "light" = "dark",
  includeCta = true,
): Promise<{ new_slide_n: number; slide_count: number; bullets: string[]; cta: string }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-conclusion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style, include_cta: includeCta }),
  })
}

export async function insertSectionSeparator(
  docId: string,
  title: string,
  afterN: number,
  subtitle = "",
  style: "gradient" | "solid" | "minimal" = "gradient",
  color = "#6366F1",
): Promise<{ new_slide_n: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/insert-section-separator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, subtitle, after_n: afterN, style, color }),
  })
}

export async function applyFormatPreset(
  docId: string,
  preset: string,
  slides?: number[],
): Promise<{ preset: string; affected_slides: number[] }> {
  const slidesParam = slides && slides.length > 0 ? `&slides=${slides.join(",")}` : ""
  return apiFetch(`${BASE}/docs/${docId}/apply-format-preset?preset=${encodeURIComponent(preset)}${slidesParam}`, {
    method: "POST",
  })
}

export interface DuplicateGroup {
  slides: number[]
  similarity: number
  shared_words: number
  previews: string[]
}

export async function findDuplicateText(
  docId: string,
  threshold = 0.85,
): Promise<{ duplicates: DuplicateGroup[]; total_groups: number; slide_count: number; threshold: number }> {
  return apiFetch(`${BASE}/docs/${docId}/duplicate-text?threshold=${threshold}`)
}

export async function mergeSlidesApi(
  docId: string,
  slideN: number,
  slideM: number,
): Promise<{ merged_into: number; removed: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/merge-with/${slideM}`, { method: "POST" })
}

export interface TimerBudgetSlide {
  slide_n: number
  seconds: number
  minutes: number
  score: number
}

export async function fetchTimerBudgetPlan(
  docId: string,
  minutes: number,
): Promise<{ slides: TimerBudgetSlide[]; total_minutes: number; total_slides: number; avg_seconds: number }> {
  return apiFetch(`${BASE}/docs/${docId}/timer-budget-plan?minutes=${minutes}`)
}

export interface StyleAuditEntry { name?: string; size?: number; color?: string; count: number }

export interface StyleAuditResult {
  font_names: Array<{ name: string; count: number }>
  font_sizes: Array<{ size: number; count: number }>
  fill_colors: Array<{ color: string; count: number }>
  text_colors: Array<{ color: string; count: number }>
  unique_fonts: number
  unique_sizes: number
  unique_fill_colors: number
  unique_text_colors: number
}

export async function fetchStyleAudit(docId: string): Promise<StyleAuditResult> {
  return apiFetch(`${BASE}/docs/${docId}/style-audit`)
}

export async function replaceText(
  docId: string,
  find: string,
  replace: string,
  caseSensitive = false,
  useRegex = false,
  includeNotes = false,
): Promise<ReplaceTextResult> {
  return apiFetch<ReplaceTextResult>(`${BASE}/docs/${docId}/replace-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ find, replace, case_sensitive: caseSensitive, use_regex: useRegex, include_notes: includeNotes }),
  })
}

export async function applyLayoutPreset(
  docId: string,
  slideN: number,
  layout: string,
): Promise<{ elements: StudioElement[]; layout: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/apply-layout?layout=${encodeURIComponent(layout)}`, {
    method: "POST",
  })
}

export async function listSlideLayouts(docId: string): Promise<{ layouts: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-layouts`)
}

export async function groupElements(
  docId: string,
  slideN: number,
  elementIds: string[],
  groupName = "Group",
): Promise<StudioElement> {
  return apiFetch<StudioElement>(`${BASE}/docs/${docId}/slides/${slideN}/group-elements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_ids: elementIds, group_name: groupName }),
  })
}

export async function ungroupElement(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<{ elements: StudioElement[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/ungroup`, {
    method: "POST",
  })
}

export interface SlideOutlineEntry {
  slide_n: number
  title: string
  body_preview: string
  title_el_id: string | null
  section?: string
  has_notes?: boolean
  notes_words?: number
}

export async function fetchDocumentOutline(docId: string): Promise<{ slides: SlideOutlineEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/outline`)
}

export async function generateSlideContent(
  docId: string,
  slideN: number,
  prompt: string,
): Promise<{ elements: StudioElement[]; prompt: string }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-slide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, slide_n: slideN }),
  })
}

export async function generateFromOutline(
  docId: string,
  outline: string,
  append = true,
): Promise<{ created: number; slide_count: number; topics: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-from-outline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outline, append }),
  })
}

export interface CommentReplyData {
  id: string
  text: string
  author: string
  created_at: string
}

export interface SlideCommentData {
  id: string
  slide_n: number
  text: string
  author: string
  resolved: boolean
  created_at: string
  replies?: CommentReplyData[]
}

export async function fetchComments(docId: string, slideN?: number): Promise<{ comments: SlideCommentData[] }> {
  const url = slideN !== undefined
    ? `${BASE}/docs/${docId}/comments?slide_n=${slideN}`
    : `${BASE}/docs/${docId}/comments`
  return apiFetch(url)
}

export async function addComment(docId: string, slideN: number, text: string, author = "User"): Promise<SlideCommentData> {
  return apiFetch(`${BASE}/docs/${docId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_n: slideN, text, author }),
  })
}

export async function updateComment(docId: string, commentId: string, update: { text?: string; resolved?: boolean }): Promise<SlideCommentData> {
  return apiFetch(`${BASE}/docs/${docId}/comments/${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_n: 0, text: update.text ?? "", resolved: update.resolved ?? false }),
  })
}

export async function deleteComment(docId: string, commentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" })
}

export function exportHtmlUrl(docId: string): string {
  return `${BASE}/docs/${docId}/export-html`
}

export function notesHtmlExportUrl(docId: string): string {
  return `${BASE}/docs/${docId}/notes-html-export`
}

export function notesPagesPdfUrl(docId: string): string {
  return `${BASE}/docs/${docId}/notes-pages-pdf`
}

export function exportMarkdownUrl(docId: string): string {
  return `${BASE}/docs/${docId}/export-markdown`
}

export async function rerenderAllSlides(docId: string): Promise<{ ok: boolean; rendered: number; errors: { slide: number; error: string }[] }> {
  return apiFetch(`${BASE}/docs/${docId}/rerender-all`, { method: "POST" })
}

export async function replaceColor(
  docId: string,
  oldColor: string,
  newColor: string,
  tolerance = 10,
): Promise<{ replaced: number; affected_slides: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/replace-color`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_color: oldColor, new_color: newColor, tolerance }),
  })
}

export async function fetchNotesSummary(docId: string): Promise<{ slides_with_notes: number[]; word_counts?: Record<string, number> }> {
  return apiFetch(`${BASE}/docs/${docId}/notes-summary`)
}

export async function fetchSlideLabels(docId: string): Promise<{ labels: Record<string, string>; tags: Record<string, string> }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-labels`)
}

export async function setSlideLabelLegacy(docId: string, n: number, label: string): Promise<{ slide_n: number; label: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/label`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  })
}

export async function setSlideTag(docId: string, n: number, color: string | null): Promise<{ slide_n: number; tag_color: string | null }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/tag`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color }),
  })
}

export async function setSlideTransition(
  docId: string,
  n: number,
  transition: string,
  durationMs = 500,
): Promise<{ slide_n: number; transition: string; duration_ms: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${n}/transition`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transition, duration_ms: durationMs }),
  })
}

export async function fetchSlideTransitions(docId: string): Promise<{ transitions: Record<string, { transition: string; duration_ms: number }> }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-transitions`)
}

export async function setBulkTransitions(
  docId: string,
  transition: string,
  durationMs = 500,
  slideNumbers?: number[],
): Promise<{ updated: number; transition: string; duration_ms: number }> {
  return apiFetch(`${BASE}/docs/${docId}/transitions-bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transition, duration_ms: durationMs, slide_numbers: slideNumbers ?? null }),
  })
}

export interface GrammarIssue {
  slide_n: number
  element_id: string
  element_name: string
  original_text: string
  issue_type: "spelling" | "grammar" | "clarity" | "style"
  message: string
  suggestion: string
}

export async function runGrammarCheck(docId: string): Promise<{ issues: GrammarIssue[]; checked: number }> {
  return apiFetch(`${BASE}/docs/${docId}/grammar-check`, { method: "POST" })
}

export interface ThemePalette {
  name: string
  description: string
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
    muted: string
  }
}

export async function generateThemePalette(
  docId: string,
  seedColor?: string,
  style: "professional" | "vibrant" | "pastel" | "dark" | "monochrome" = "professional",
): Promise<ThemePalette> {
  return apiFetch(`${BASE}/docs/${docId}/generate-theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed_color: seedColor ?? null, style }),
  })
}

export async function insertSummarySlide(
  docId: string,
  opts: { position?: "start" | "end" | "after_n"; after_n?: number; title?: string },
): Promise<{ new_slide_n: number; slide_count: number; summary_text: string }> {
  return apiFetch(`${BASE}/docs/${docId}/insert-summary-slide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      position: opts.position ?? "end",
      after_n: opts.after_n ?? 0,
      title: opts.title ?? "Executive Summary",
    }),
  })
}

export async function splitElementToSlides(
  docId: string,
  slideN: number,
  elementId: string,
  keepTitle = true,
): Promise<{ new_slide_count: number; new_slide_ns: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/split-to-slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_id: elementId, keep_title: keepTitle }),
  })
}

export interface LayoutChange {
  id: string
  left_in: number
  top_in: number
  width_in: number
  height_in: number
}

export async function optimizeSlideLayout(
  docId: string,
  slideN: number,
  goal: "balanced" | "emphasis-title" | "compact" | "spacious" = "balanced",
  apply = true,
): Promise<{ changes: LayoutChange[]; applied: boolean; goal: string; element_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/optimize-layout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, apply }),
  })
}

export async function importSlides(
  docId: string,
  file: File,
): Promise<{ imported: number; slide_count: number }> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch(`${BASE}/docs/${docId}/import-slides`, { method: "POST", body: form })
}

export async function setSlideBackgroundImage(
  docId: string,
  slideN: number,
  file: File,
): Promise<StudioElement> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch<StudioElement>(`${BASE}/docs/${docId}/slides/${slideN}/background-image`, {
    method: "POST",
    body: form,
  })
}

export async function setSlideSection(
  docId: string,
  slideN: number,
  sectionName: string | null,
): Promise<{ slide_n: number; section_name: string | null }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/section`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section_name: sectionName }),
  })
}

export async function fetchSlideSections(
  docId: string,
): Promise<{ sections: Record<string, string> }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-sections`)
}

export async function fetchSlideRatings(docId: string): Promise<{ ratings: Record<number, number> }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-ratings`)
}

export async function fetchHiddenSlides(docId: string): Promise<{ hidden: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-hidden`)
}

export async function setSlideHidden(docId: string, slideN: number, hidden: boolean): Promise<{ slide_n: number; hidden: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/hidden?hidden=${hidden}`, { method: "PATCH" })
}

export async function fetchSlidePins(docId: string): Promise<{ pinned: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-pins`)
}

export async function pinSlide(docId: string, slideN: number, pinned: boolean): Promise<{ slide_n: number; pinned: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/pin?pinned=${pinned}`, { method: "PATCH" })
}

export async function setSlideRating(docId: string, slideN: number, rating: number | null): Promise<{ slide_n: number; rating: number | null }> {
  const params = new URLSearchParams()
  if (rating !== null) params.set("rating", String(rating))
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/rating?${params}`, { method: "PATCH" })
}

export interface PresentationIssue {
  slide_n: number
  type: string
  severity: "info" | "warning" | "error"
  message: string
}

export async function fetchPresentationCheck(docId: string): Promise<{ issues: PresentationIssue[]; slide_count: number; issue_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-check`)
}

export function exportSlideUrl(docId: string, slideN: number): string {
  return `${BASE}/docs/${docId}/slides/${slideN}/export-slide`
}

export async function setSlidesBackground(
  docId: string,
  slideNumbers: number[],
  color: string | null,
): Promise<{ background_color: string | null; slides_updated: number }> {
  return apiFetch(`${BASE}/docs/${docId}/background-slides`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_numbers: slideNumbers, color }),
  })
}

export async function generateAltText(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<{ alt_text: string; element_id: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/generate-alt-text`, {
    method: "POST",
  })
}

export async function generateSlideNotes(
  docId: string,
  slideN: number,
  tone: "presenter" | "casual" | "formal" = "presenter",
  length: "brief" | "medium" | "detailed" = "medium",
): Promise<{ notes_text: string; had_existing: boolean }> {
  const params = new URLSearchParams({ tone, length })
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/generate-notes?${params}`, { method: "POST" })
}

export async function transformSlideNotes(
  docId: string,
  slideN: number,
  operation: "expand" | "shorten" | "formal" | "casual" | "bullets" | "translate",
  language = "",
): Promise<{ notes_text: string }> {
  const params = new URLSearchParams({ operation })
  if (language) params.set("language", language)
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/notes-transform?${params}`, { method: "POST" })
}

export async function generateNotesBulk(
  docId: string,
  overwrite = false,
  tone: "presenter" | "casual" | "formal" = "presenter",
  length: "brief" | "medium" | "detailed" = "medium",
): Promise<{ generated: number; skipped: number }> {
  const params = new URLSearchParams({ overwrite: String(overwrite), tone, length })
  return apiFetch(`${BASE}/docs/${docId}/generate-notes-bulk?${params}`, { method: "POST" })
}

export async function getTimerBudget(docId: string): Promise<{ total_minutes: number | null }> {
  return apiFetch(`${BASE}/docs/${docId}/timer-budget`)
}

export async function setTimerBudget(docId: string, totalMinutes: number | null): Promise<{ total_minutes: number | null }> {
  const params = totalMinutes !== null ? `?total_minutes=${totalMinutes}` : ""
  return apiFetch(`${BASE}/docs/${docId}/timer-budget${params}`, { method: "PATCH" })
}


export async function bulkDeleteSlides(docId: string, slideNumbers: number[]): Promise<{ slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_numbers: slideNumbers }),
  })
}

export async function bulkDuplicateSlides(docId: string, slideNumbers: number[]): Promise<{ slide_count: number; new_slide_numbers: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/bulk-duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_numbers: slideNumbers }),
  })
}

export function exportSubsetUrl(docId: string, slideNumbers: number[]): string {
  return `${BASE}/docs/${docId}/export-subset?slides=${slideNumbers.join(",")}`
}

export async function reorderSlides(docId: string, order: number[]): Promise<{ slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  })
}

export function exportScriptUrl(docId: string, wpm = 120): string {
  return `${BASE}/docs/${docId}/export-script?wpm=${wpm}`
}

export async function addCommentReply(docId: string, commentId: string, text: string, author = "User"): Promise<CommentReplyData> {
  return apiFetch(`${BASE}/docs/${docId}/comments/${encodeURIComponent(commentId)}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, author }),
  })
}

export async function deleteCommentReply(docId: string, commentId: string, replyId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`, { method: "DELETE" })
}

export async function fetchFontPalette(docId: string): Promise<{ fonts: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/font-palette`)
}

export async function replaceFont(docId: string, oldFont: string, newFont: string): Promise<{ replaced: number; affected_slides: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/replace-font`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_font: oldFont, new_font: newFont }),
  })
}

export function elementPngUrl(docId: string, slideN: number, elementId: string): string {
  return `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/element-png`
}

export interface TemplateVariable {
  name: string
  count: number
  occurrences: Array<{ slide_n: number; element_id: string; context: string; in_notes?: boolean }>
}

export async function fetchTemplateVariables(docId: string, includeNotes = true): Promise<{ variables: TemplateVariable[] }> {
  return apiFetch(`${BASE}/docs/${docId}/template-variables?include_notes=${includeNotes}`)
}

export interface AgendaSlideResult {
  slide_count: number
  new_slide_n: number
  item_count: number
}

export interface PresentationScoreCategory {
  score: number
  feedback: string
}

export interface PresentationScore {
  overall_score: number
  categories: {
    structure:          PresentationScoreCategory
    clarity:            PresentationScoreCategory
    pacing:             PresentationScoreCategory
    visual_consistency: PresentationScoreCategory
    engagement:         PresentationScoreCategory
  }
  strengths:        string[]
  top_issues:       string[]
  one_line_summary: string
}

export async function aiScorePresentation(docId: string): Promise<PresentationScore> {
  return apiFetch(`${BASE}/docs/${docId}/ai-score`, { method: "POST" })
}

export interface AddSlideNumbersOpts {
  position?: "bottom-right" | "bottom-center" | "bottom-left"
  style?: "plain" | "total" | "slide"
  font_size?: number
  color?: string
  skip_first?: boolean
  start_number?: number
}

export interface AddWatermarkOpts {
  text?: string
  color?: string
  opacity?: number
  font_size?: number
  angle?: number
  position?: "center" | "tiled"
}

export async function rewriteElementText(
  docId: string,
  slideN: number,
  elementId: string,
  instruction: string,
  apply = true,
): Promise<{ original: string; rewritten: string; applied: boolean }> {
  return apiFetch(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/rewrite-text`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, apply }),
    },
  )
}

export async function bulkDeleteElementsByName(
  docId: string,
  nameContains: string,
): Promise<{ removed: number; pattern: string }> {
  return apiFetch(`${BASE}/docs/${docId}/elements/by-name`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name_contains: nameContains }),
  })
}

export async function addWatermark(
  docId: string,
  opts: AddWatermarkOpts = {},
): Promise<{ added: number; text: string; color: string }> {
  return apiFetch(`${BASE}/docs/${docId}/add-watermark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  })
}

export async function addSlideNumbers(
  docId: string,
  opts: AddSlideNumbersOpts = {},
): Promise<{ added: number; slide_count: number; position: string; style: string }> {
  return apiFetch(`${BASE}/docs/${docId}/add-slide-numbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  })
}

export async function insertAgendaSlide(
  docId: string,
  opts: { title?: string; after_n?: number; slide_numbers?: number[] | null },
): Promise<AgendaSlideResult> {
  return apiFetch(`${BASE}/docs/${docId}/insert-agenda-slide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: opts.title ?? "Agenda",
      after_n: opts.after_n ?? 0,
      slide_numbers: opts.slide_numbers ?? null,
    }),
  })
}

export interface SlideVariationRewrite {
  element_id: string
  original: string
  rewritten: string
}

export interface SlideVariation {
  style: string
  label: string
  rewrites: SlideVariationRewrite[]
}

export async function generateSlideVariations(
  docId: string,
  slideN: number,
  styles: string[] = ["persuasive", "concise", "executive", "casual"],
): Promise<{ variations: SlideVariation[]; original_elements: Array<{ element_id: string; text: string }> }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/generate-variations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ styles }),
  })
}

export async function insertSlideVariation(
  docId: string,
  slideN: number,
  rewrites: Array<{ element_id: string; text: string }>,
  label = "Variant",
): Promise<{ new_slide_n: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/insert-variation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rewrites, label }),
  })
}

export interface SlideReadability {
  slide_n: number
  score: number | null
  label: string
  word_count: number
}

export async function fetchReadabilityScores(
  docId: string,
): Promise<{ slides: SlideReadability[]; overall_score: number | null; overall_label: string }> {
  return apiFetch(`${BASE}/docs/${docId}/readability`)
}

export async function mergeElements(
  docId: string,
  slideN: number,
  elementIds: string[],
  separator = "\n",
): Promise<{ merged_text: string; removed_count: number; slide_n: number }> {
  const params = new URLSearchParams({ separator })
  elementIds.forEach((id) => params.append("element_ids", id))
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/merge-elements?${params}`, { method: "POST" })
}

export async function expandSlide(
  docId: string,
  slideN: number,
): Promise<{ new_slide_n: number; slide_count: number; title: string; bullet_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/expand-slide`, { method: "POST" })
}

export async function generateTalkingPoints(
  docId: string,
  slideN: number,
  elementId: string,
): Promise<{ points: string[]; element_id: string; source_text: string }> {
  return apiFetch(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/talking-points`,
    { method: "POST" },
  )
}

export async function optimizeImages(
  docId: string,
  maxWidthPx = 1280,
  quality = 82,
): Promise<{ optimized: Array<{ slide_n: number; element_id: string; before_kb: number; after_kb: number; savings_pct: number }>; total_optimized: number; saved_kb: number; saved_pct: number; total_before_kb: number; total_after_kb: number }> {
  return apiFetch(`${BASE}/docs/${docId}/optimize-images?max_width_px=${maxWidthPx}&quality=${quality}`, { method: "POST" })
}

export interface SlideDensity {
  slide_n: number
  word_count: number
  char_count: number
  el_count: number
  text_count: number
  img_count: number
  density_score: number
  label: "sparse" | "ideal" | "dense" | "crowded"
}

export async function fetchContentDensity(
  docId: string,
): Promise<{ slides: SlideDensity[]; deck_total_words: number; avg_words_per_slide: number; crowded_slides: number[]; sparse_slides: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/content-density`)
}

export interface BrandViolation {
  slide_n: number
  element_id: string
  type: "off-brand-fill" | "off-brand-font" | "off-brand-text-color"
  detail: string
  value: string
}

export async function runBrandCheck(
  docId: string,
  allowedFonts?: string[],
  allowedColors?: string[],
): Promise<{ violations: BrandViolation[]; total: number; checked_slides: number }> {
  return apiFetch(`${BASE}/docs/${docId}/brand-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_fonts: allowedFonts ?? null,
      allowed_colors: allowedColors ?? null,
    }),
  })
}

// ── Named snapshots ────────────────────────────────────────────────────────

export interface DocSnapshot {
  id: string
  name: string
  created_at: number
  slide_count: number
}

export async function listSnapshots(docId: string): Promise<{ snapshots: DocSnapshot[] }> {
  return apiFetch(`${BASE}/docs/${docId}/snapshots`)
}

export async function createSnapshot(
  docId: string,
  name: string,
): Promise<{ ok: boolean; id: string; total: number }> {
  return apiFetch(`${BASE}/docs/${docId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export async function restoreSnapshot(
  docId: string,
  snapId: string,
): Promise<{ ok: boolean; name: string; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/snapshots/${encodeURIComponent(snapId)}/restore`, { method: "POST" })
}

export async function deleteSnapshot(
  docId: string,
  snapId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/snapshots/${encodeURIComponent(snapId)}`, { method: "DELETE" })
}

// ── Voiceover script ───────────────────────────────────────────────────────

export async function generateVoiceoverScript(
  docId: string,
  style = "professional",
  wordsPerMinute = 130,
  includeNotes = true,
): Promise<{ script: string; slide_count: number; word_count: number; estimated_minutes: number; style: string }> {
  return apiFetch(`${BASE}/docs/${docId}/voiceover-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style, words_per_minute: wordsPerMinute, include_notes: includeNotes }),
  })
}

export async function generateAltTextBulk(
  docId: string,
): Promise<{ updated: number; skipped: number; results: Array<{ slide_n: number; element_id: string; alt_text: string }> }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-alt-text`, { method: "POST" })
}

export interface SlideDiffOp {
  type: "equal" | "added" | "removed"
  text: string
}

export async function diffSlides(
  docId: string,
  slideN: number,
  compareN: number,
): Promise<{
  slide_a: number
  slide_b: number
  diff: SlideDiffOp[]
  added_words: number
  removed_words: number
  similarity_pct: number
  word_count_a: number
  word_count_b: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/diff?compare_n=${compareN}`)
}

export interface DeckSummaryStructured {
  title?: string
  core_message?: string
  key_points?: string[]
  action_items?: string[]
  open_questions?: string[]
  sentiment?: "positive" | "neutral" | "negative"
}

export async function generateDeckSummary(
  docId: string,
  audience: "executive" | "technical" | "general" = "executive",
  format: "structured" | "narrative" | "bullets" = "structured",
): Promise<{ format: string; audience: string; slide_count: number; data: DeckSummaryStructured | null; raw: string }> {
  return apiFetch(`${BASE}/docs/${docId}/deck-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience, format }),
  })
}

export interface ActionItem {
  slide_n: number
  action: string
  owner: string | null
  deadline: string | null
  priority: "high" | "medium" | "low"
}

export async function extractActionItems(
  docId: string,
): Promise<{ items: ActionItem[]; total: number; slide_count: number; high_priority: number }> {
  return apiFetch(`${BASE}/docs/${docId}/extract-action-items`, { method: "POST" })
}

export interface DeckKeyword {
  word: string
  score: number
  count: number
  slide_count: number
  slides: number[]
}

export async function fetchKeywords(
  docId: string,
  topN = 30,
): Promise<{ keywords: DeckKeyword[]; slide_count: number; total_words: number }> {
  return apiFetch(`${BASE}/docs/${docId}/keywords?top_n=${topN}`)
}

export interface SimilarSlidesPair {
  slide_a: number
  slide_b: number
  similarity: number
  shared_words: string[]
}

export async function findSimilarSlides(
  docId: string,
  threshold = 0.55,
): Promise<{ pairs: SimilarSlidesPair[]; total_slides: number }> {
  return apiFetch(`${BASE}/docs/${docId}/similar-slides?threshold=${threshold}`)
}

export async function fitTextToElements(
  docId: string,
  slideN: number,
): Promise<{ fitted: Array<{ element_id: string; old_size: number; new_size: number }>; slide_n: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/fit-text`, { method: "POST" })
}

export async function autoDetectSections(
  docId: string,
): Promise<{ sections: Record<string, string>; total_slides: number }> {
  return apiFetch(`${BASE}/docs/${docId}/auto-sections`, { method: "POST" })
}

export interface ReorderSuggestion {
  suggested_order: number[]
  original_order: number[]
  rationale: string
  key_moves: Array<{ from: number; to: number; reason: string }>
  changes: number
}

export async function suggestSlideReorder(docId: string): Promise<ReorderSuggestion> {
  return apiFetch(`${BASE}/docs/${docId}/suggest-reorder`, { method: "POST" })
}

export async function translateSlides(
  docId: string,
  targetLanguage: string,
  slideNumbers?: number[] | null,
  includeNotes = false,
): Promise<{ translated: number; affected_slides: number[]; target_language: string }> {
  return apiFetch(`${BASE}/docs/${docId}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_language: targetLanguage,
      slide_numbers: slideNumbers ?? null,
      include_notes: includeNotes,
    }),
  })
}

// ── Notes Auto-Expand ─────────────────────────────────────────────────────────

export async function expandNotes(
  docId: string,
  slideN: number,
  apply = true,
): Promise<{ slide_n: number; expanded: string; original: string; applied: boolean; message?: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/expand-notes?apply=${apply}`, { method: "POST" })
}

// ── Slide Complexity Score ─────────────────────────────────────────────────────

export interface SlideComplexity {
  slide_n: number
  score: number
  level: "simple" | "moderate" | "complex"
  word_count: number
  el_count: number
  text_els: number
  image_els: number
}

export async function fetchComplexity(
  docId: string,
): Promise<{ slides: SlideComplexity[]; avg_score: number; complex_count: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/complexity`)
}

// ── Content Gap Detector ───────────────────────────────────────────────────────

export interface ContentGap {
  topic: string
  importance: "high" | "medium" | "low"
  suggestion: string
  insert_after_slide: number
}

export async function detectContentGaps(
  docId: string,
  deckType = "general",
): Promise<{ gaps: ContentGap[]; overall_coverage: string; summary: string; slide_count: number; deck_type: string }> {
  return apiFetch(`${BASE}/docs/${docId}/content-gaps?deck_type=${encodeURIComponent(deckType)}`, { method: "POST" })
}

// ── Glossary Extractor ─────────────────────────────────────────────────────────

export interface GlossaryTerm {
  term: string
  definition: string
  slide_first_seen: number
}

export async function extractGlossary(
  docId: string,
  insertSlide = false,
): Promise<{ terms: GlossaryTerm[]; total_terms: number; slide_count: number; inserted_slide: number | null }> {
  return apiFetch(`${BASE}/docs/${docId}/extract-glossary?insert_slide=${insertSlide}`, { method: "POST" })
}

// ── Slide Thumbnails ZIP ──────────────────────────────────────────────────────

export function thumbnailsZipUrl(docId: string): string {
  return `${BASE}/docs/${docId}/thumbnails-zip`
}

// ── AI Title Generator ─────────────────────────────────────────────────────────

export interface TitleGenerationResult {
  slide_n: number
  original: string
  new_title: string
  has_title_el: boolean
}

export async function generateTitles(
  docId: string,
  slideNumbers?: number[],
  tone = "professional",
  apply = true,
): Promise<{ results: TitleGenerationResult[]; applied: boolean; affected_slides: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-titles?tone=${encodeURIComponent(tone)}&apply=${apply}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slideNumbers ?? null),
  })
}

// ── Layout Analyzer ────────────────────────────────────────────────────────────

export interface LayoutIssue {
  element_id: string
  issue: "out_of_bounds" | "zero_size" | "overlap"
  detail: string
  label: string
}

export interface SlideLayoutIssues {
  slide_n: number
  issues: LayoutIssue[]
}

export async function fetchLayoutIssues(
  docId: string,
): Promise<{ slides_with_issues: SlideLayoutIssues[]; total_issues: number; slide_count: number; clean: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/layout-issues`)
}

// ── Speaking Pace Estimator ────────────────────────────────────────────────────

export interface SpeakingPaceSlide {
  slide_n: number
  words: number
  notes_words: number
  body_seconds: number
  notes_seconds: number
  total_seconds: number
}

export async function fetchSpeakingPace(
  docId: string,
  wpm = 130,
): Promise<{ slides: SpeakingPaceSlide[]; wpm: number; total_seconds: number; total_minutes: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/speaking-pace?wpm=${wpm}`)
}

// ── Citation Tracker ──────────────────────────────────────────────────────────

export interface Citation {
  slide_n: number
  claim: string
  type: "stat" | "study" | "quote" | "fact"
  suggested_source: string
}

export async function extractCitations(
  docId: string,
): Promise<{ citations: Citation[]; total: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/extract-citations`, { method: "POST" })
}

// ── Contrast Checker ──────────────────────────────────────────────────────────

export interface ContrastResult {
  slide_n: number
  element_id: string
  text_color: string
  bg_color: string
  ratio: number
  level: string
  pass: boolean
  preview: string
}

export async function fetchContrastCheck(
  docId: string,
): Promise<{ results: ContrastResult[]; total: number; passing: number; failing: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/contrast-check`)
}

// ── Q&A Prep ──────────────────────────────────────────────────────────────────

export interface QAQuestion {
  question: string
  suggested_answer: string
  difficulty: "easy" | "medium" | "hard"
}

export async function generateQAPrep(
  docId: string,
  slideN: number,
  count = 5,
): Promise<{ slide_n: number; questions: QAQuestion[]; count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/qa-prep?count=${count}`, { method: "POST" })
}

// ── Clone Slides to New Doc ────────────────────────────────────────────────────

export async function cloneSlidesToNewDoc(
  docId: string,
  slideNumbers: number[],
  newDocName = "Cloned Slides",
): Promise<{ new_doc_id: string; new_doc_name: string; cloned_slides: number; slide_numbers: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/clone-slides?new_doc_name=${encodeURIComponent(newDocName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slideNumbers),
  })
}

// ── AI Slide Summarizer ────────────────────────────────────────────────────────

export interface SlideSummary {
  slide_n: number
  summary: string
}

export async function summarizeSlides(
  docId: string,
  applyToNotes = false,
): Promise<{ summaries: SlideSummary[]; total: number; applied: boolean; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/summarize-slides?apply_to_notes=${applyToNotes}`, { method: "POST" })
}

// ── Note Templates ─────────────────────────────────────────────────────────────

export async function insertNoteTemplate(
  docId: string,
  slideN: number,
  template: "intro" | "main" | "transition" | "cta" | "data",
  overwrite = false,
): Promise<{ slide_n: number; template: string; notes: string; overwrote: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/note-template?template=${template}&overwrite=${overwrite}`, { method: "POST" })
}

// ── Keyword Spotlight ──────────────────────────────────────────────────────────

export interface KeywordMatch {
  slide_n: number
  elements: Array<{ element_id: string; role: string; count: number; preview: string }>
  total_hits: number
}

export async function keywordSpotlight(
  docId: string,
  keyword: string,
  caseSensitive = false,
): Promise<{ keyword: string; matches: KeywordMatch[]; total_slides: number; total_hits: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/keyword-spotlight?keyword=${encodeURIComponent(keyword)}&case_sensitive=${caseSensitive}`)
}

// ── Emoji Remover ─────────────────────────────────────────────────────────────

export async function removeEmoji(
  docId: string,
  slideNumbers?: number[],
): Promise<{ changed_slides: number[]; total_chars_removed: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/remove-emoji`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slideNumbers ?? null),
  })
}

// ── Text Statistics ────────────────────────────────────────────────────────────

export interface SlideTextStats {
  slide_n: number
  word_count: number
  unique_words: number
  sentence_count: number
  avg_word_length: number
  avg_sentence_length: number
  long_sentences: number
  char_count: number
}

export async function fetchTextStats(
  docId: string,
): Promise<{ slides: SlideTextStats[]; deck_word_count: number; deck_unique_words: number; slide_count: number; avg_words_per_slide: number }> {
  return apiFetch(`${BASE}/docs/${docId}/text-stats`)
}

// ── Auto-Capitalize ────────────────────────────────────────────────────────────

export async function capitalizeTitles(
  docId: string,
  style: "title" | "sentence" | "upper",
  slideNumbers?: number[],
): Promise<{ changed: number; results: Array<{ slide_n: number; original: string; new: string }>; style: string; affected_slides: number[] }> {
  return apiFetch(`${BASE}/docs/${docId}/capitalize-titles?style=${style}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slideNumbers ?? null),
  })
}

// ── Pull Quote Highlighter ────────────────────────────────────────────────────

export interface PullQuote {
  slide_n: number
  quote: string | null
  reason: string
}

export async function fetchPullQuotes(
  docId: string,
): Promise<{ quotes: PullQuote[]; total: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/pull-quotes`, { method: "POST" })
}

// ── Slide Flow Feedback ────────────────────────────────────────────────────────

export interface FlowSection {
  score: number
  feedback: string
}

export interface FlowFeedback {
  opening: FlowSection
  middle: FlowSection
  closing: FlowSection
  transitions: FlowSection
  overall_score: number
  strengths: string[]
  improvements: string[]
  summary: string
  slide_count: number
}

export async function fetchFlowFeedback(docId: string): Promise<FlowFeedback> {
  return apiFetch(`${BASE}/docs/${docId}/flow-feedback`, { method: "POST" })
}

// ── Footnote Inserter ─────────────────────────────────────────────────────────

export async function addFootnote(
  docId: string,
  slideN: number,
  text: string,
  fontSize = 8,
): Promise<{ slide_n: number; element_id: string; text: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/add-footnote?text=${encodeURIComponent(text)}&font_size=${fontSize}`, { method: "POST" })
}

// ── Bulk Notes Copy ────────────────────────────────────────────────────────────

export async function copyNotesTo(
  docId: string,
  sourceSlide: number,
  targetSlides: number[],
  overwrite = false,
): Promise<{ source_slide: number; copied_to: number[]; skipped: number; notes_length: number; message?: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${sourceSlide}/copy-notes-to?overwrite=${overwrite}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(targetSlides),
  })
}

// ── Word Cloud Data ────────────────────────────────────────────────────────────

export interface WordCloudWord {
  word: string
  count: number
  weight: number
}

export async function fetchWordCloud(
  docId: string,
  slideN: number,
  topN = 40,
): Promise<{ slide_n: number; words: WordCloudWord[]; total_words: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/word-cloud?top_n=${topN}`)
}

// ── Deck Text Export ──────────────────────────────────────────────────────────

export function textExportUrl(docId: string, includeNotes = false, fmt: "txt" | "md" = "txt"): string {
  return `${BASE}/docs/${docId}/text-export?include_notes=${includeNotes}&fmt=${fmt}`
}

// ── Color Palette ─────────────────────────────────────────────────────────────

export interface PaletteColor {
  hex: string
  count: number
  roles: string[]
}

export async function fetchColorPalette(
  docId: string,
): Promise<{ colors: PaletteColor[]; total_unique: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/color-palette`)
}

// ── Slide Labels ──────────────────────────────────────────────────────────────

export async function setSlideLabel(
  docId: string,
  slideN: number,
  label: string,
  color = "#6366f1",
): Promise<{ slide_n: number; label: string; color: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/label?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`, { method: "POST" })
}

export async function removeSlideLabel(
  docId: string,
  slideN: number,
  label: string,
): Promise<{ slide_n: number; removed: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/label/${encodeURIComponent(label)}`, { method: "DELETE" })
}

export async function fetchAllLabels(
  docId: string,
): Promise<{ labels: Array<{ label: string; slides: number[] }>; total_labels: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/labels`)
}

// ── AI Deck Title Suggester ───────────────────────────────────────────────────

export interface DeckTitleSuggestion {
  title: string
  rationale: string
}

export async function suggestDeckTitles(
  docId: string,
  count = 5,
  style = "professional",
): Promise<{ titles: DeckTitleSuggestion[]; style: string; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/suggest-titles?count=${count}&style=${encodeURIComponent(style)}`, { method: "POST" })
}

// ── Blank Slide Detector ───────────────────────────────────────────────────────

export interface BlankSlideInfo {
  slide_n: number
  words: number
  elements: number
  type: "empty" | "no_text" | "sparse"
}

export async function findBlankSlides(
  docId: string,
  minWords = 3,
): Promise<{ blank: BlankSlideInfo[]; sparse: BlankSlideInfo[]; total_empty: number; total_sparse: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/blank-slides?min_words=${minWords}`)
}

// ── Slide Description Generator ───────────────────────────────────────────────

export async function describeSlide(
  docId: string,
  slideN: number,
  applyToNotes = false,
): Promise<{ slide_n: number; description: string; applied: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/describe?apply_to_notes=${applyToNotes}`, { method: "POST" })
}

// ── Numbered List Fixer ────────────────────────────────────────────────────────

export async function fixNumberedLists(
  docId: string,
  slideNumbers?: number[],
): Promise<{ fixed: number; affected_slides: number[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/fix-numbered-lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slideNumbers ?? null),
  })
}

// ── Slide Progress Tracker ─────────────────────────────────────────────────────

export type SlideWorkflowStatus = "todo" | "in-progress" | "done" | "needs-review"

export async function setSlideStatus(
  docId: string,
  slideN: number,
  status: SlideWorkflowStatus,
): Promise<{ slide_n: number; status: string }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/status?status=${status}`, { method: "POST" })
}

export async function fetchSlideStatuses(
  docId: string,
): Promise<{ statuses: Array<{ slide_n: number; status: string }>; counts: Record<string, number>; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-statuses`)
}

// ── Highlight Reel ─────────────────────────────────────────────────────────────

export interface HighlightSlide {
  slide_n: number
  reason: string
}

export async function fetchHighlightReel(
  docId: string,
  count = 5,
): Promise<{ highlights: HighlightSlide[]; count: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/highlight-reel?count=${count}`, { method: "POST" })
}

// ── Font Audit ─────────────────────────────────────────────────────────────────

export interface FontUsage {
  font: string
  count: number
  slides: number[]
}

export async function fetchFontAudit(
  docId: string,
): Promise<{ fonts: FontUsage[]; total_fonts: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/font-audit`)
}

// ── Executive Briefing ─────────────────────────────────────────────────────────

export function executiveBriefingUrl(docId: string, fmt: "md" | "txt" = "md"): string {
  return `${BASE}/docs/${docId}/executive-briefing?fmt=${fmt}`
}

// ── Margin Check ───────────────────────────────────────────────────────────────

export interface MarginViolation {
  slide_n: number
  element_id: string
  element_name: string
  side: string
  distance_in: number
  margin_in: number
}

export async function fetchMarginCheck(
  docId: string,
  marginIn = 0.3,
): Promise<{ violations: MarginViolation[]; total: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/margin-check?margin_in=${marginIn}`)
}

// ── Clone Slide To Position ────────────────────────────────────────────────────

export async function cloneSlideTo(
  docId: string,
  slideN: number,
  position: number,
): Promise<{ new_slide_n: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/clone-to?position=${position}`, { method: "POST" })
}

// ── Deck Tagline ───────────────────────────────────────────────────────────────

export async function generateDeckTagline(
  docId: string,
  apply = false,
): Promise<{ tagline: string; applied: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/deck-tagline?apply=${apply}`, { method: "POST" })
}

// ── Section Word Counts ────────────────────────────────────────────────────────

export interface SectionWordCount {
  name: string
  slides: number[]
  word_count: number
}

export async function fetchSectionWordCounts(
  docId: string,
): Promise<{ sections: SectionWordCount[]; total_words: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/section-word-counts`)
}

// ── Complexity Heatmap ─────────────────────────────────────────────────────────

export interface SlideComplexityPoint {
  slide_n: number
  score: number
  label: string
  elements: number
  words: number
  images: number
  tables: number
}

export async function fetchComplexityHeatmap(
  docId: string,
): Promise<{ slides: SlideComplexityPoint[]; avg_score: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/complexity-heatmap`)
}

// ── Duplicate Deck ─────────────────────────────────────────────────────────────

export async function duplicateDeck(
  docId: string,
  newName = "",
): Promise<{ new_doc_id: string; name: string; slide_count: number }> {
  const qs = newName ? `?new_name=${encodeURIComponent(newName)}` : ""
  return apiFetch(`${BASE}/docs/${docId}/duplicate-deck${qs}`, { method: "POST" })
}

// ── Reorder Rationale ──────────────────────────────────────────────────────────

export interface ReorderRationaleSlide {
  slide_n: number
  rationale: string
  suggestion: string
}

export async function fetchReorderRationale(
  docId: string,
): Promise<{ slides: ReorderRationaleSlide[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/reorder-rationale`, { method: "POST" })
}

// ── Reading Order Check ────────────────────────────────────────────────────────

export interface ReadingOrderViolation {
  slide_n: number
  out_of_order: Array<{ id: string; label: string; left: number; top: number }>
  count: number
}

export async function fetchReadingOrder(
  docId: string,
): Promise<{ violations: ReadingOrderViolation[]; total_slides_affected: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/reading-order`)
}

// ── Title Slide Critique ───────────────────────────────────────────────────────

export interface TitleSlideCritique {
  score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  overall: string
}

export async function fetchTitleSlideCritique(docId: string): Promise<TitleSlideCritique> {
  return apiFetch(`${BASE}/docs/${docId}/title-slide-critique`, { method: "POST" })
}

// ── Bulk Font Replace ──────────────────────────────────────────────────────────

export async function bulkFontReplace(
  docId: string,
  fromFont: string,
  toFont: string,
): Promise<{ replaced: number; affected_slides: number[]; from_font: string; to_font: string }> {
  return apiFetch(
    `${BASE}/docs/${docId}/bulk-font-replace?from_font=${encodeURIComponent(fromFont)}&to_font=${encodeURIComponent(toFont)}`,
    { method: "POST" },
  )
}

// ── Clutter Scores ─────────────────────────────────────────────────────────────

export interface SlideClutterPoint {
  slide_n: number
  clutter_score: number
  label: string
  elements: number
  overlap_in2: number
  total_area: number
}

export async function fetchClutterScores(
  docId: string,
  threshold = 5.0,
): Promise<{ slides: SlideClutterPoint[]; avg_clutter: number; cluttered_count: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/clutter-scores?threshold=${threshold}`)
}

// ── AI Call-to-Action Slide ────────────────────────────────────────────────────

export interface CTAData {
  title: string
  body: string
  cta: string
  subtext: string
}

export async function generateCTA(
  docId: string,
  insert = false,
): Promise<{ cta: CTAData; inserted: boolean; new_slide_n: number | null; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/generate-cta?insert=${insert}`, { method: "POST" })
}

// ── Opening Hook ───────────────────────────────────────────────────────────────

export interface OpeningHookResult {
  original: string
  hook: string
  subhook: string
}

export async function fetchOpeningHook(
  docId: string,
  apply = false,
): Promise<{ result: OpeningHookResult; applied: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/opening-hook?apply=${apply}`, { method: "POST" })
}

// ── TOC Check ──────────────────────────────────────────────────────────────────

export interface TOCMatch {
  toc_item: string
  slide_n: number
  slide_title: string
}

export interface TOCMismatch {
  toc_item: string
  note: string
}

export async function fetchTOCCheck(
  docId: string,
): Promise<{ toc_found: boolean; toc_slide: number | null; matches: TOCMatch[]; mismatches: TOCMismatch[]; missing: Array<{ slide_n: number; title: string }> }> {
  return apiFetch(`${BASE}/docs/${docId}/toc-check`)
}

// ── Link Check ─────────────────────────────────────────────────────────────────

export interface LinkResult {
  slide_n: number
  url: string
  valid_format: boolean
  note: string
}

export async function fetchLinkCheck(
  docId: string,
): Promise<{ links: LinkResult[]; total: number; invalid: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/link-check`)
}

// ── Metaphor Finder ────────────────────────────────────────────────────────────

export interface MetaphorSuggestion {
  slide_n: number
  original_text: string
  metaphor: string
  reason: string
}

export async function fetchMetaphorFinder(
  docId: string,
): Promise<{ suggestions: MetaphorSuggestion[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/metaphor-finder`, { method: "POST" })
}

// ── Speaker Confidence ─────────────────────────────────────────────────────────

export interface SpeakerConfidenceScore {
  slide_n: number
  score: number
  feedback: string
}

export async function fetchSpeakerConfidence(
  docId: string,
): Promise<{ scores: SpeakerConfidenceScore[]; avg_score: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/speaker-confidence`, { method: "POST" })
}

// ── Style Guide ────────────────────────────────────────────────────────────────

export interface StyleGuideFont  { font: string;  count: number }
export interface StyleGuideColor { color: string; count: number }
export interface StyleGuideFontSize { size: number; count: number; role: string }

export async function fetchStyleGuide(
  docId: string,
): Promise<{ fonts: StyleGuideFont[]; colors: StyleGuideColor[]; font_sizes: StyleGuideFontSize[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/style-guide`)
}

// ── Agenda Sync ────────────────────────────────────────────────────────────────

export async function fetchAgendaSync(
  docId: string,
  apply = false,
): Promise<{ agenda_found: boolean; agenda_slide: number | null; new_items: string[]; applied: boolean }> {
  return apiFetch(`${BASE}/docs/${docId}/agenda-sync?apply=${apply}`, { method: "POST" })
}

// ── Pace Check ─────────────────────────────────────────────────────────────────

export interface PaceViolation {
  slide_n: number
  word_count: number
  body_words: number
  notes_words: number
  over_by: number
}

export async function fetchPaceCheck(
  docId: string,
  maxWords = 75,
): Promise<{ violations: PaceViolation[]; total: number; max_words: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/pace-check?max_words=${maxWords}`)
}

// ── Counterarguments ───────────────────────────────────────────────────────────

export interface CounterArgument {
  claim: string
  counterargument: string
  suggested_response: string
}

export async function fetchCounterArguments(
  docId: string,
  count = 5,
): Promise<{ counterarguments: CounterArgument[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/counterarguments?count=${count}`, { method: "POST" })
}

// ── Data Table Candidates ──────────────────────────────────────────────────────

export interface DataTableCandidate {
  slide_n: number
  preview: string
  lines: number
  delimiter: string
}

export async function fetchDataTableCandidates(
  docId: string,
): Promise<{ candidates: DataTableCandidate[]; total: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/data-table-candidates`)
}

// ── Humor Suggestions ──────────────────────────────────────────────────────────

export interface HumorSuggestion {
  slide_n: number
  context: string
  suggestion: string
  example: string
}

export async function fetchHumorSuggestions(
  docId: string,
): Promise<{ suggestions: HumorSuggestion[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/humor-suggestions`, { method: "POST" })
}

// ── Alignment Audit ────────────────────────────────────────────────────────────

export interface AlignmentSlide {
  slide_n: number
  dominant: string
  mixed: boolean
  alignments: string[]
}

export async function fetchAlignmentAudit(
  docId: string,
): Promise<{ dominant_alignment: string; inconsistent_slides: AlignmentSlide[]; total_inconsistent: number; alignment_counts: Record<string, number>; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/alignment-audit`)
}

// ── Notes Length Check ─────────────────────────────────────────────────────────

export interface NotesLengthViolation {
  slide_n: number
  word_count: number
  over_by: number
  preview: string
}

export async function fetchNotesLengthCheck(
  docId: string,
  maxWords = 150,
): Promise<{ violations: NotesLengthViolation[]; total: number; max_words: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/notes-length-check?max_words=${maxWords}`)
}

// ── Deck Quiz ──────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  question: string
  options: string[]
  answer: string
  explanation: string
}

export async function fetchDeckQuiz(
  docId: string,
  questionCount = 5,
): Promise<{ questions: QuizQuestion[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/deck-quiz?question_count=${questionCount}`, { method: "POST" })
}

// ── Background Audit ───────────────────────────────────────────────────────────

export interface BackgroundSlide {
  slide_n: number
  background: string
}

export async function fetchBackgroundAudit(
  docId: string,
): Promise<{ dominant_background: string; inconsistent_slides: BackgroundSlide[]; total_inconsistent: number; background_counts: Record<string, number>; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/background-audit`)
}

// ── Placeholder Finder ─────────────────────────────────────────────────────────

export interface PlaceholderSlide {
  slide_n: number
  matches: Array<{ match: string; context: string }>
  count: number
}

export async function fetchPlaceholderFinder(
  docId: string,
): Promise<{ slides: PlaceholderSlide[]; total_slides: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/placeholder-finder`)
}

// ── Section Title Suggestions ──────────────────────────────────────────────────

export interface SectionTitleSuggestion {
  slide_n: number
  current: string
  suggested: string
  reason: string
}

export async function fetchSectionTitleSuggestions(
  docId: string,
): Promise<{ suggestions: SectionTitleSuggestion[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/suggest-section-titles`, { method: "POST" })
}

// ── Action Plan ────────────────────────────────────────────────────────────────

export interface ActionItem {
  action: string
  owner: string
  deadline: string
  priority: string
}

export async function fetchActionPlan(
  docId: string,
): Promise<{ actions: ActionItem[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/action-plan`, { method: "POST" })
}

// ── Bookmarks ──────────────────────────────────────────────────────────────────

export interface Bookmark {
  slide_n: number
  label: string
}

export async function addBookmark(docId: string, slideN: number, label = ""): Promise<{ bookmarks: Bookmark[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/bookmark?label=${encodeURIComponent(label)}`, { method: "POST" })
}

export async function removeBookmark(docId: string, slideN: number): Promise<{ bookmarks: Bookmark[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/bookmark`, { method: "DELETE" })
}

export async function fetchBookmarks(docId: string): Promise<{ bookmarks: Bookmark[]; total: number }> {
  return apiFetch(`${BASE}/docs/${docId}/bookmarks`)
}

// ── Data Insights ──────────────────────────────────────────────────────────────

export interface DataInsight {
  metric: string
  value: string
  context: string
  sentiment: string
  slide_hint: string
}

export async function fetchDataInsights(
  docId: string,
): Promise<{ insights: DataInsight[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/data-insights`, { method: "POST" })
}

// ── Narrative Arc ──────────────────────────────────────────────────────────────

export interface NarrativePhase {
  name: string
  slides: number[]
  assessment: string
}

export interface NarrativeArc {
  arc_type: string
  score: number
  phases: NarrativePhase[]
  strengths: string[]
  gaps: string[]
  recommendation: string
}

export async function fetchNarrativeArc(docId: string): Promise<NarrativeArc> {
  return apiFetch(`${BASE}/docs/${docId}/narrative-arc`, { method: "POST" })
}

// ── Clear Notes ────────────────────────────────────────────────────────────────

export async function clearNotes(
  docId: string,
  slideNumbers: string | number[] = "all",
): Promise<{ cleared: number; slides: number[] }> {
  const param = Array.isArray(slideNumbers) ? slideNumbers.join(",") : slideNumbers
  return apiFetch(`${BASE}/docs/${docId}/clear-notes?slide_numbers=${encodeURIComponent(param)}`, { method: "POST" })
}

// ── Grid Check ─────────────────────────────────────────────────────────────────

export interface GridOffElement {
  label: string
  left: number
  top: number
  snap_left: number
  snap_top: number
}

export interface GridSlide {
  slide_n: number
  off_grid: GridOffElement[]
  count: number
}

export async function fetchGridCheck(
  docId: string,
  gridSize = 0.25,
): Promise<{ slides: GridSlide[]; total: number; grid_size: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/grid-check?grid_size=${gridSize}`)
}

// ── Persuasion Scores ──────────────────────────────────────────────────────────

export interface PersuasionScore {
  slide_n: number
  score: number
  reason: string
  tip: string
}

export async function fetchPersuasionScores(
  docId: string,
): Promise<{ scores: PersuasionScore[]; avg_score: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/persuasion-scores`, { method: "POST" })
}

// ── Social Media Snippets ──────────────────────────────────────────────────────

export interface SocialPost {
  platform: string
  post: string
  hashtags: string[]
  character_count: number
}

export async function fetchSocialSnippets(
  docId: string,
  platforms = "linkedin,twitter",
): Promise<{ posts: SocialPost[]; platforms: string[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/social-snippets?platforms=${encodeURIComponent(platforms)}`, { method: "POST" })
}

// ── Text Overflow Check ────────────────────────────────────────────────────────

export interface TextOverflowViolation {
  slide_n: number
  element_id: string
  line_count: number
  long_lines: number
  width_in: number
  height_in: number
  preview: string
}

export async function fetchTextOverflow(
  docId: string,
): Promise<{ violations: TextOverflowViolation[]; total: number; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/text-overflow`)
}

// ── Per-Slide Audience Questions ───────────────────────────────────────────────

export async function fetchAudienceQuestions(
  docId: string,
  slideN: number,
  count = 3,
): Promise<{ slide_n: number; questions: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slides/${slideN}/audience-questions?count=${count}`, { method: "POST" })
}

// ── Tone Consistency Check ────────────────────────────────────────────────────

export interface ToneIssue {
  slide_n: number
  detected_tone: string
  issue: string
}

export async function fetchToneConsistency(docId: string): Promise<{
  overall_tone: string
  consistent: boolean
  summary: string
  issues: ToneIssue[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/tone-consistency`)
}

// ── Sentence Variety Check ────────────────────────────────────────────────────

export interface SentenceFlag {
  slide_n: number
  text: string
  words: number
  type: "long" | "short"
}

export async function fetchSentenceVariety(docId: string): Promise<{
  avg_words: number
  short_pct: number
  long_pct: number
  total: number
  flags: SentenceFlag[]
  verdict: string
}> {
  return apiFetch(`${BASE}/docs/${docId}/sentence-variety`)
}

// ── Deck Export Checklist ─────────────────────────────────────────────────────

export interface ChecklistItem {
  check: string
  status: "pass" | "warn" | "fail"
  detail: string
}

export async function fetchExportChecklist(docId: string): Promise<{
  overall: string
  fails: number
  warns: number
  items: ChecklistItem[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/export-checklist`)
}

// ── Slide Image Descriptions ──────────────────────────────────────────────────

export interface SlideImageDesc {
  slide_n: number
  image_count: number
  descriptions: string[]
}

export async function fetchImageDescriptions(
  docId: string,
  slideNs: number[] = [],
): Promise<{ slides: SlideImageDesc[]; total_images: number }> {
  return apiFetch(`${BASE}/docs/${docId}/image-descriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_ns: slideNs }),
  })
}

// ── Redundancy Finder ─────────────────────────────────────────────────────────

export interface RedundancyMatch {
  phrase: string
  slides: number[]
  count: number
}

export async function fetchRedundancyFinder(docId: string): Promise<{
  duplicates: RedundancyMatch[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/redundancy-finder`)
}

// ── Passive Voice Detector ────────────────────────────────────────────────────

export interface PassiveVoiceHit {
  slide_n: number
  text: string
  match: string
}

export async function fetchPassiveVoice(docId: string): Promise<{
  findings: PassiveVoiceHit[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/passive-voice`)
}

// ── Emotional Keywords Highlighter ───────────────────────────────────────────

export interface EmotionalHit {
  slide_n: number
  category: string
  text: string
  matched_words: string[]
}

export async function fetchEmotionalKeywords(docId: string): Promise<{
  hits: EmotionalHit[]
  total: number
  by_category: Record<string, number>
}> {
  return apiFetch(`${BASE}/docs/${docId}/emotional-keywords`)
}

// ── Deck Comparison ───────────────────────────────────────────────────────────

export interface DeckCompareResult {
  deck_a: { slide_count: number; name: string }
  deck_b: { slide_count: number; name: string }
  shared_keywords: string[]
  unique_to_a: string[]
  unique_to_b: string[]
  shared_titles: string[]
  overlap_score: number
}

export async function compareDecks(docIdA: string, docIdB: string): Promise<DeckCompareResult> {
  return apiFetch(`${BASE}/docs/${docIdA}/compare-decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id_b: docIdB }),
  })
}

// ── Jargon Detector ───────────────────────────────────────────────────────────

export interface JargonHit {
  slide_n: number
  text: string
  word: string
}

export async function fetchJargonDetector(docId: string): Promise<{
  hits: JargonHit[]
  total: number
  top_jargon: { word: string; count: number }[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/jargon-detector`)
}

// ── Story Arc Visualizer ──────────────────────────────────────────────────────

export interface StoryArcSlide {
  slide_n: number
  stage: string
  label: string
}

export async function fetchStoryArc(docId: string): Promise<{ arc: StoryArcSlide[] }> {
  return apiFetch(`${BASE}/docs/${docId}/story-arc`, { method: "POST" })
}

// ── Filler Word Counter ───────────────────────────────────────────────────────

export interface FillerHit {
  slide_n: number
  text: string
  word: string
}

export async function fetchFillerWords(docId: string): Promise<{
  hits: FillerHit[]
  total: number
  top_fillers: { word: string; count: number }[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/filler-words`)
}

// ── Acronym Explainer ─────────────────────────────────────────────────────────

export interface AcronymEntry {
  acronym: string
  meaning: string
  category: string
  slides: number[]
}

export async function fetchAcronymExplainer(docId: string): Promise<{ acronyms: AcronymEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/acronym-explainer`, { method: "POST" })
}

// ── Weak Verb Highlighter ─────────────────────────────────────────────────────

export interface WeakVerbHit {
  slide_n: number
  text: string
  weak_verb: string
}

export async function fetchWeakVerbs(docId: string): Promise<{ hits: WeakVerbHit[]; total: number }> {
  return apiFetch(`${BASE}/docs/${docId}/weak-verbs`)
}

// ── Bullet Point Analyzer ─────────────────────────────────────────────────────

export interface LongBullet {
  slide_n: number
  text: string
  words: number
  level: number
}

export async function fetchBulletAnalysis(docId: string): Promise<{
  total_bullets: number
  avg_words: number
  max_depth: number
  depth_distribution: Record<string, number>
  long_bullets: LongBullet[]
  verdicts: string[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/bullet-analysis`)
}

// ── Timer Estimate ────────────────────────────────────────────────────────────

export interface SlideTimerEntry {
  slide_n: number
  body_words: number
  notes_words: number
  seconds: number
  mm_ss: string
}

export async function fetchTimerEstimate(docId: string, wpm = 130): Promise<{
  slides: SlideTimerEntry[]
  total_seconds: number
  total_mm_ss: string
  total_words: number
  wpm: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/timer-estimate?wpm=${wpm}`)
}

// ── Color Usage Report ────────────────────────────────────────────────────────

export interface ColorUsage {
  hex: string
  count: number
}

export async function fetchColorReport(docId: string): Promise<{
  colors: ColorUsage[]
  unique_count: number
  total_uses: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/color-report`)
}

// ── Whitespace Analyzer ───────────────────────────────────────────────────────

export interface WhitespaceSlide {
  slide_n: number
  whitespace_pct: number
  occupied_pct: number
}

export async function fetchWhitespaceAnalysis(docId: string): Promise<{
  slides: WhitespaceSlide[]
  avg_whitespace_pct: number
  crowded: WhitespaceSlide[]
  empty_heavy: WhitespaceSlide[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/whitespace-analysis`)
}

// ── Font Pairing Suggester ────────────────────────────────────────────────────

export interface FontPairing {
  heading: string
  body: string
  reason: string
}

export async function fetchFontPairing(docId: string): Promise<{
  current_fonts: string[]
  pairings: FontPairing[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/font-pairing`, { method: "POST" })
}

// ── Section Summary Generator ─────────────────────────────────────────────────

export async function fetchSectionSummary(
  docId: string,
  slideRange: number[] = [],
): Promise<{ summary: string; bullets: string[]; slide_count: number }> {
  return apiFetch(`${BASE}/docs/${docId}/section-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_range: slideRange }),
  })
}

// ── First Impression Score ────────────────────────────────────────────────────

export async function fetchFirstImpression(docId: string): Promise<{
  score: number
  verdict: string
  strengths: string[]
  improvements: string[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/first-impression`, { method: "POST" })
}

// ── CTA Strength Analyzer ─────────────────────────────────────────────────────

export interface CTAEntry {
  slide_n: number
  strength: number
  cta_text: string
  feedback: string
}

export async function fetchCTAStrength(docId: string): Promise<{
  ctas: CTAEntry[]
  overall_strength: number
  recommendation: string
}> {
  return apiFetch(`${BASE}/docs/${docId}/cta-strength`, { method: "POST" })
}

// ── Keyword Density Map ───────────────────────────────────────────────────────

export interface KeywordDensitySlide {
  slide_n: number
  top: { word: string; count: number }[]
}

export async function fetchKeywordDensity(docId: string, topN = 15): Promise<{
  global_top: { word: string; count: number }[]
  per_slide: KeywordDensitySlide[]
  total_unique: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/keyword-density?top_n=${topN}`)
}

// ── Repetition Heatmap ────────────────────────────────────────────────────────

export interface RepetitionSlide {
  slide_n: number
  repetition_score: number
  repeated_words: string[]
}

export async function fetchRepetitionHeatmap(docId: string): Promise<{
  slides: RepetitionSlide[]
  avg_repetition: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/repetition-heatmap`)
}

// ── Claim Checker ─────────────────────────────────────────────────────────────

export interface ClaimEntry {
  slide_n: number
  claim: string
  concern: string
  severity: "low" | "medium" | "high"
}

export async function fetchClaimChecker(docId: string): Promise<{
  claims: ClaimEntry[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/claim-checker`, { method: "POST" })
}

// ── Discussion Questions Generator ────────────────────────────────────────────

export async function fetchDiscussionQuestions(
  docId: string,
  count = 5,
): Promise<{ questions: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/discussion-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  })
}

// ── Vocabulary Level Checker ──────────────────────────────────────────────────

export async function fetchVocabularyLevel(docId: string): Promise<{
  fk_grade: number
  level: string
  avg_syllables_per_word: number
  complex_words_pct: number
  total_words: number
  total_sentences: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/vocabulary-level`)
}

// ── Deck Completeness Report ──────────────────────────────────────────────────

export interface CompletenessDimension {
  name: string
  score: number
  detail: string
}

export async function fetchCompletenessReport(docId: string): Promise<{
  overall: number
  label: string
  dimensions: CompletenessDimension[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/completeness-report`)
}

// ── Visual Hierarchy Checker ──────────────────────────────────────────────────

export interface VisualHierarchyIssue {
  slide_n: number
  issues: string[]
}

export async function fetchVisualHierarchy(docId: string): Promise<{
  issues: VisualHierarchyIssue[]
  total: number
  slides_checked: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/visual-hierarchy`)
}

// ── Sentiment Arc ─────────────────────────────────────────────────────────────

export interface SentimentSlide {
  slide_n: number
  sentiment: number
  label: string
}

export async function fetchSentimentArc(docId: string): Promise<{
  arc: SentimentSlide[]
  avg_sentiment: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/sentiment-arc`, { method: "POST" })
}

// ── AI Tagline Variations ─────────────────────────────────────────────────────

export interface TaglineVariation {
  tone: string
  title: string
  tagline: string
}

export async function fetchTaglineVariations(docId: string): Promise<{ variations: TaglineVariation[] }> {
  return apiFetch(`${BASE}/docs/${docId}/tagline-variations`, { method: "POST" })
}

// ── Slide Length Check ────────────────────────────────────────────────────────

export interface SlideLengthEntry {
  slide_n: number
  word_count: number
  z_score: number
  status: "normal" | "long" | "short"
}

export async function fetchSlideLengthCheck(docId: string): Promise<{
  slides: SlideLengthEntry[]
  avg_words: number
  std_words: number
  outliers: SlideLengthEntry[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-length-check`)
}

// ── Transition Pacing ─────────────────────────────────────────────────────────

export interface TransitionEntry {
  from_slide: number
  to_slide: number
  jaccard: number
  label: "smooth" | "moderate" | "abrupt"
  shared_words: string[]
}

export async function fetchTransitionPacing(docId: string): Promise<{
  transitions: TransitionEntry[]
  avg_continuity: number
  abrupt_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/transition-pacing`)
}

// ── Hook Strength ─────────────────────────────────────────────────────────────

export interface HookStrengthResult {
  score: number
  grade: string
  summary: string
  strengths: string[]
  improvements: string[]
}

export async function fetchHookStrength(docId: string): Promise<HookStrengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/hook-strength`, { method: "POST" })
}

// ── Data Density ──────────────────────────────────────────────────────────────

export interface DataDensitySlide {
  slide_n: number
  numbers: number
  percentages: number
  bullets: number
  total_words: number
  density_pct: number
  label: "low" | "medium" | "high"
}

export async function fetchDataDensity(docId: string): Promise<{
  slides: DataDensitySlide[]
  avg_density: number
  high_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/data-density`)
}

// ── Closing Impact ────────────────────────────────────────────────────────────

export interface ClosingImpactResult {
  score: number
  grade: string
  summary: string
  strengths: string[]
  improvements: string[]
}

export async function fetchClosingImpact(docId: string): Promise<ClosingImpactResult> {
  return apiFetch(`${BASE}/docs/${docId}/closing-impact`, { method: "POST" })
}

// ── Redundant Slide Detector ──────────────────────────────────────────────────

export interface RedundantPair {
  slide_a: number
  slide_b: number
  similarity: number
  shared_words: string[]
  severity: "medium" | "high"
}

export async function fetchRedundantSlides(docId: string): Promise<{
  pairs: RedundantPair[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/redundant-slides`)
}

// ── Tone Shift Alert ──────────────────────────────────────────────────────────

export interface ToneShift {
  before_slide: number
  after_slide: number
  from_tone: string
  to_tone: string
  description: string
}

export async function fetchToneShift(docId: string): Promise<{ shifts: ToneShift[] }> {
  return apiFetch(`${BASE}/docs/${docId}/tone-shift`, { method: "POST" })
}

// ── Persuasion Framework ──────────────────────────────────────────────────────

export interface PersuasionFrameworkSlide {
  slide_n: number
  mode: "ethos" | "pathos" | "logos" | "mixed"
  note: string
}

export async function fetchPersuasionFramework(docId: string): Promise<{
  slides: PersuasionFrameworkSlide[]
  ethos_pct: number
  pathos_pct: number
  logos_pct: number
  recommendation: string
}> {
  return apiFetch(`${BASE}/docs/${docId}/persuasion-framework`, { method: "POST" })
}

// ── Slide Confidence Score ────────────────────────────────────────────────────

export interface ConfidenceSlide {
  slide_n: number
  score: number
  grade: string
  has_title: boolean
  body_words: number
  bullets: number
}

export async function fetchConfidenceScores(docId: string): Promise<{
  slides: ConfidenceSlide[]
  avg_score: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/confidence-scores`)
}

// ── Slide Complexity Index ────────────────────────────────────────────────────

export interface ComplexityIndexSlide {
  slide_n: number
  score: number
  label: "low" | "medium" | "high"
  words: number
  shapes: number
  nesting: number
  fonts: number
}

export async function fetchComplexityIndex(docId: string): Promise<{
  slides: ComplexityIndexSlide[]
  avg_complexity: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/complexity-index`)
}

// ── Quote Extractor ───────────────────────────────────────────────────────────

export interface QuoteEntry {
  slide_n: number
  text: string
  attributed: boolean
}

export async function fetchQuoteExtractor(docId: string): Promise<{
  quotes: QuoteEntry[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/quote-extractor`)
}

// ── Presentation Risks ────────────────────────────────────────────────────────

export interface RiskEntry {
  slide_n: number
  category: string
  description: string
  severity: "low" | "medium" | "high"
}

export async function fetchPresentationRisks(docId: string): Promise<{ risks: RiskEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-risks`, { method: "POST" })
}

// ── Audience Fit Score ────────────────────────────────────────────────────────

export interface AudienceFitResult {
  score: number
  grade: string
  summary: string
  strong_points: string[]
  gaps: string[]
}

export async function fetchAudienceFit(docId: string, audience: string): Promise<AudienceFitResult> {
  return apiFetch(`${BASE}/docs/${docId}/audience-fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience }),
  })
}

// ── Analogy Finder ────────────────────────────────────────────────────────────

export interface AnalogyHit {
  text: string
  pattern: string
}

export interface AnalogySlide {
  slide_n: number
  hits: AnalogyHit[]
}

export async function fetchAnalogyFinder(docId: string): Promise<{
  slides: AnalogySlide[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/analogy-finder`)
}

// ── Action Verbs Audit ────────────────────────────────────────────────────────

export interface ActionVerbsSlide {
  slide_n: number
  strong_verbs: string[]
  weak_words: string[]
  rating: "strong" | "weak" | "mixed"
}

export async function fetchActionVerbs(docId: string): Promise<{ slides: ActionVerbsSlide[] }> {
  return apiFetch(`${BASE}/docs/${docId}/action-verbs`)
}

// ── Emotional Payoff ──────────────────────────────────────────────────────────

export interface EmotionalPayoffSlide {
  slide_n: number
  score: number
  emotion: string
  reason: string
}

export async function fetchEmotionalPayoff(docId: string): Promise<{
  slides: EmotionalPayoffSlide[]
  top_slides: EmotionalPayoffSlide[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/emotional-payoff`, { method: "POST" })
}

// ── Clarity Score ─────────────────────────────────────────────────────────────

export interface ClaritySlide {
  slide_n: number
  score: number
  label: "clear" | "moderate" | "unclear"
  avg_sent_len: number
  jargon: string[]
}

export async function fetchClarityScore(docId: string): Promise<{
  slides: ClaritySlide[]
  avg_clarity: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/clarity-score`)
}

// ── Buzzword Density ──────────────────────────────────────────────────────────

export interface BuzzwordSlide {
  slide_n: number
  buzzwords: string[]
  count: number
  density: number
  label: "low" | "medium" | "high"
}

export async function fetchBuzzwordDensity(docId: string): Promise<{
  slides: BuzzwordSlide[]
  total_buzzwords: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/buzzword-density`)
}

// ── Slide Intent Map ──────────────────────────────────────────────────────────

export interface SlideIntentEntry {
  slide_n: number
  intent: string
  confidence: "high" | "medium" | "low"
}

export async function fetchSlideIntent(docId: string): Promise<{
  slides: SlideIntentEntry[]
  intent_distribution: Record<string, number>
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-intent`, { method: "POST" })
}

// ── Narrative Gaps ────────────────────────────────────────────────────────────

export interface NarrativeGap {
  location: string
  description: string
  suggestion: string
}

export async function fetchNarrativeGaps(docId: string): Promise<{ gaps: NarrativeGap[] }> {
  return apiFetch(`${BASE}/docs/${docId}/narrative-gaps`, { method: "POST" })
}

// ── Evidence Audit ────────────────────────────────────────────────────────────

export interface EvidenceSlide {
  slide_n: number
  has_evidence: boolean
  unsupported_claims: string[]
}

export async function fetchEvidenceAudit(docId: string): Promise<{
  slides: EvidenceSlide[]
  total_unsupported: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/evidence-audit`)
}

// ── Competitive Language ──────────────────────────────────────────────────────

export interface CompetitiveHit {
  text: string
  category: string
}

export interface CompetitiveSlide {
  slide_n: number
  hits: CompetitiveHit[]
}

export async function fetchCompetitiveLanguage(docId: string): Promise<{
  slides: CompetitiveSlide[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/competitive-language`)
}

// ── Metaphor Density ──────────────────────────────────────────────────────────

export interface MetaphorEntry {
  slide_n: number
  phrase: string
  type: string
}

export async function fetchMetaphorDensity(docId: string): Promise<{
  metaphors: MetaphorEntry[]
  total: number
  slides_with_metaphors: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/metaphor-density`, { method: "POST" })
}

// ── Slide Impact Ranking ──────────────────────────────────────────────────────

export interface ImpactRankEntry {
  slide_n: number
  rank: number
  impact_score: number
  reason: string
}

export async function fetchImpactRanking(docId: string): Promise<{ rankings: ImpactRankEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/impact-ranking`, { method: "POST" })
}

// ── Content Balance Report ────────────────────────────────────────────────────

export interface ContentBalanceSlide {
  slide_n: number
  text_pct: number
  image_pct: number
  chart_pct: number
  total_words: number
  balance: "balanced" | "text-heavy" | "visual-heavy"
}

export async function fetchContentBalance(docId: string): Promise<{
  slides: ContentBalanceSlide[]
  avg_text_pct: number
  avg_image_pct: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/content-balance`)
}

// ── Speaker Density Score ─────────────────────────────────────────────────────

export interface SpeakerDensitySlide {
  slide_n: number
  slide_words: number
  notes_words: number
  notes_ratio: number
  label: "speaker-heavy" | "slide-heavy" | "balanced"
}

export async function fetchSpeakerDensity(docId: string): Promise<{
  slides: SpeakerDensitySlide[]
  avg_notes_ratio: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/speaker-density`)
}

// ── Acronym Map ───────────────────────────────────────────────────────────────

export interface AcronymMapEntry {
  acronym: string
  slides: number[]
  count: number
}

export async function fetchAcronymMap(docId: string): Promise<{
  acronyms: AcronymMapEntry[]
  total_unique: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/acronym-map`)
}

// ── Promise Tracker ───────────────────────────────────────────────────────────

export interface PromiseSlide {
  slide_n: number
  promises: string[]
}

export async function fetchPromiseTracker(docId: string): Promise<{
  slides: PromiseSlide[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/promise-tracker`)
}

// ── Slide Repetition Score ────────────────────────────────────────────────────

export interface RepetitionScoreSlide {
  slide_n: number
  repetition_pct: number
  label: "low" | "medium" | "high"
  repeated_words: string[]
}

export async function fetchSlideRepetition(docId: string): Promise<{
  slides: RepetitionScoreSlide[]
  avg_repetition_pct: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-repetition`)
}

// ── Numeric Consistency Check ─────────────────────────────────────────────────

export interface NumericConflict {
  value: string
  slides: number[]
  contexts: string[]
  appearances: number
}

export async function fetchNumericConsistency(docId: string): Promise<{
  numbers: NumericConflict[]
  total_flagged: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/numeric-consistency`)
}

// ── Title Uniqueness ──────────────────────────────────────────────────────────

export interface TitleDuplicate {
  title: string
  slides: number[]
}

export async function fetchTitleUniqueness(docId: string): Promise<{
  duplicates: TitleDuplicate[]
  unique: number
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/title-uniqueness`)
}

// ── Deck Punchline ────────────────────────────────────────────────────────────

export interface DeckPunchlineResult {
  punchline: string
  takeaway: string
  proof_points: string[]
}

export async function fetchDeckPunchline(docId: string): Promise<DeckPunchlineResult> {
  return apiFetch(`${BASE}/docs/${docId}/deck-punchline`, { method: "POST" })
}

// ── Opening Statistics ────────────────────────────────────────────────────────

export interface OpeningStat {
  slide_n: number
  text: string
  numbers: string[]
  is_stat: boolean
}

export async function fetchOpeningStats(docId: string): Promise<{
  stats: OpeningStat[]
  total: number
  has_hook_stat: boolean
}> {
  return apiFetch(`${BASE}/docs/${docId}/opening-stats`)
}

// ── Urgency Detector ──────────────────────────────────────────────────────────

export interface UrgencyHit {
  text: string
  category: string
}

export interface UrgencySlide {
  slide_n: number
  hits: UrgencyHit[]
}

export async function fetchUrgencyDetector(docId: string): Promise<{
  slides: UrgencySlide[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/urgency-detector`)
}

// ── Question Count ────────────────────────────────────────────────────────────

export interface QuestionSlide {
  slide_n: number
  questions: string[]
}

export async function fetchQuestionCount(docId: string): Promise<{
  slides: QuestionSlide[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/question-count`)
}

// ── Value Proposition Finder ──────────────────────────────────────────────────

export interface ValuePropEntry {
  slide_n: number
  statement: string
  strength: number
  suggestion: string
}

export async function fetchValueProposition(docId: string): Promise<{
  propositions: ValuePropEntry[]
  avg_strength: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/value-proposition`, { method: "POST" })
}

// ── Topic Coverage Map ────────────────────────────────────────────────────────

export interface CoveredTopic {
  topic: string
  slides: number[]
}

export async function fetchTopicCoverage(docId: string): Promise<{
  covered: CoveredTopic[]
  over_covered: string[]
  missing: string[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/topic-coverage`, { method: "POST" })
}

// ── Slide Density Heatmap ─────────────────────────────────────────────────────

export interface DensityHeatmapSlide {
  slide_n: number
  words: number
  shapes: number
  images: number
  bullets: number
  density: number
  pct: number
}

export async function fetchDensityHeatmap(docId: string): Promise<{
  slides: DensityHeatmapSlide[]
  avg_density: number
  max_density: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/density-heatmap`)
}

// ── Presentation DNA ──────────────────────────────────────────────────────────

export interface PresentationDNA {
  style: string
  personality: string
  signature_phrases: string[]
  strengths: string[]
  blind_spots: string[]
  archetype: string
}

export async function fetchPresentationDNA(docId: string): Promise<PresentationDNA> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-dna`, { method: "POST" })
}

// ── Speaker Confidence Tips ───────────────────────────────────────────────────

export interface SpeakerTip {
  slide_n: number
  tip: string
  technique: string
}

export async function fetchSpeakerTips(docId: string): Promise<{ tips: SpeakerTip[] }> {
  return apiFetch(`${BASE}/docs/${docId}/speaker-tips`, { method: "POST" })
}

// ── Objection Handler ─────────────────────────────────────────────────────────

export interface ObjectionEntry {
  slide_n: number
  objection: string
  rebuttal: string
  severity: "easy" | "medium" | "tough"
}

export async function fetchObjectionHandler(docId: string): Promise<{ objections: ObjectionEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/objection-handler`, { method: "POST" })
}

// ── Slide Questions ───────────────────────────────────────────────────────────

export interface SlideQuestion {
  slide_n: number
  questions: string[]
}

export async function fetchSlideQuestions(docId: string): Promise<{ slides: SlideQuestion[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-questions`)
}

// ── Deck Manifesto ────────────────────────────────────────────────────────────

export interface DeckManifesto {
  title: string
  declarations: string[]
  closing_line: string
}

export async function fetchDeckManifesto(docId: string): Promise<DeckManifesto> {
  return apiFetch(`${BASE}/docs/${docId}/deck-manifesto`, { method: "POST" })
}

// ── Bullet Brevity ────────────────────────────────────────────────────────────

export interface BulletBrevityEntry {
  slide_n: number
  text: string
  word_count: number
  excess: number
}

export async function fetchBulletBrevity(docId: string): Promise<{
  flagged: BulletBrevityEntry[]
  total_bullets: number
  total_flagged: number
  threshold: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/bullet-brevity`)
}

// ── Insight Extractor ─────────────────────────────────────────────────────────

export interface InsightEntry {
  slide_n: number
  quote: string
  category: "stat" | "claim" | "action" | "metaphor" | "quote"
  impact: number
}

export async function fetchInsightExtractor(docId: string): Promise<{ insights: InsightEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/insight-extractor`, { method: "POST" })
}

// ── Slide Transitions Info ────────────────────────────────────────────────────

export interface SlideTransitionInfo {
  slide_n: number
  has_transition: boolean
  type: string
}

export async function fetchSlideTransitionsInfo(docId: string): Promise<{
  slides: SlideTransitionInfo[]
  with_transition: number
  without_transition: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-transitions`)
}

// ── Story Gap Filler ──────────────────────────────────────────────────────────

export interface StoryGap {
  between: [number, number]
  description: string
  suggestion: string
}

export async function fetchStoryGapFiller(docId: string): Promise<{ gaps: StoryGap[] }> {
  return apiFetch(`${BASE}/docs/${docId}/story-gap-filler`, { method: "POST" })
}

// ── Image-Text Ratio ──────────────────────────────────────────────────────────

export interface ImageTextRatioSlide {
  slide_n: number
  image_pct: number
  text_pct: number
  total_words: number
  balance: "image-heavy" | "text-heavy" | "balanced"
}

export async function fetchImageTextRatio(docId: string): Promise<{ slides: ImageTextRatioSlide[] }> {
  return apiFetch(`${BASE}/docs/${docId}/image-text-ratio`)
}

// ── Metaphor Suggester ────────────────────────────────────────────────────────

export interface MetaphorSuggestion {
  slide_n: number
  point: string
  metaphor: string
  domain: string
}

export async function fetchMetaphorSuggester(docId: string): Promise<{ suggestions: MetaphorSuggestion[] }> {
  return apiFetch(`${BASE}/docs/${docId}/metaphor-suggester`, { method: "POST" })
}

// ── Emoji Usage ───────────────────────────────────────────────────────────────

export interface EmojiUsageEntry {
  emoji: string
  slides: number[]
  count: number
}

export async function fetchEmojiUsage(docId: string): Promise<{ emojis: EmojiUsageEntry[]; total_unique: number }> {
  return apiFetch(`${BASE}/docs/${docId}/emoji-usage`)
}

// ── Slide Mood Board ──────────────────────────────────────────────────────────

export interface SlideMoodEntry {
  slide_n: number
  mood: string
  palette: string
  imagery: string
  feel: string
}

export async function fetchSlideMoodBoard(docId: string): Promise<{ slides: SlideMoodEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-mood-board`, { method: "POST" })
}

// ── Long Sentences ────────────────────────────────────────────────────────────

export interface LongSentenceEntry {
  slide_n: number
  sentence: string
  word_count: number
  excess: number
}

export async function fetchLongSentences(docId: string): Promise<{
  flagged: LongSentenceEntry[]
  total_flagged: number
  threshold: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/long-sentences`)
}

// ── Deck Elevator Pitch ───────────────────────────────────────────────────────

export interface DeckElevatorPitch {
  main: string
  formal: string
  casual: string
  bold: string
}

export async function fetchDeckElevatorPitch(docId: string): Promise<DeckElevatorPitch> {
  return apiFetch(`${BASE}/docs/${docId}/deck-elevator-pitch`, { method: "POST" })
}

// ── Header/Footer Check ───────────────────────────────────────────────────────

export interface HeaderFooterEntry {
  text: string
  slides: number[]
}

export async function fetchHeaderFooterCheck(docId: string): Promise<{
  headers: HeaderFooterEntry[]
  footers: HeaderFooterEntry[]
  header_count: number
  footer_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/header-footer-check`)
}

// ── Section Intros ────────────────────────────────────────────────────────────

export interface SectionIntroEntry {
  slide_n: number
  title: string
  intro: string
}

export async function fetchSectionIntros(docId: string): Promise<{ sections: SectionIntroEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/section-intros`, { method: "POST" })
}

// ── Text Alignment Audit ──────────────────────────────────────────────────────

export interface AlignmentSlide {
  slide_n: number
  dominant: string
  left?: number
  center?: number
  right?: number
  justify?: number
  default?: number
}

export async function fetchTextAlignmentAudit(docId: string): Promise<{
  global_tally: Record<string, number>
  per_slide: AlignmentSlide[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/text-alignment-audit`)
}

// ── Reframe Suggestions ───────────────────────────────────────────────────────

export interface ReframeSuggestion {
  slide_n: number
  original: string
  reframe: string
  reason: string
}

export async function fetchReframeSuggestions(docId: string): Promise<{ suggestions: ReframeSuggestion[] }> {
  return apiFetch(`${BASE}/docs/${docId}/reframe-suggestions`, { method: "POST" })
}

// ── Passive Constructions ─────────────────────────────────────────────────────

export interface PassiveConstructionEntry {
  slide_n: number
  text: string
  matches: string[]
  match_count: number
}

export async function fetchPassiveConstructions(docId: string): Promise<{
  flagged: PassiveConstructionEntry[]
  total_flagged: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/passive-constructions`)
}

// ── Slide Taglines ────────────────────────────────────────────────────────────

export interface SlideTaglineEntry {
  slide_n: number
  tagline: string
}

export async function fetchSlideTaglines(docId: string): Promise<{ taglines: SlideTaglineEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-tagline`, { method: "POST" })
}

// ── Punctuation Audit ─────────────────────────────────────────────────────────

export interface PunctuationAuditResult {
  with_period: number
  without_period: number
  total: number
  dominant_style: string
  mixed_slides: number[]
  consistency_pct: number
}

export async function fetchPunctuationAudit(docId: string): Promise<PunctuationAuditResult> {
  return apiFetch(`${BASE}/docs/${docId}/punctuation-audit`)
}

// ── Authority Signals ─────────────────────────────────────────────────────────

export interface AuthoritySignal {
  slide_n: number
  signal: string
  type: string
  strength: number
}

export async function fetchAuthoritySignals(docId: string): Promise<{ signals: AuthoritySignal[] }> {
  return apiFetch(`${BASE}/docs/${docId}/authority-signals`, { method: "POST" })
}

// ── Shape Inventory ───────────────────────────────────────────────────────────

export interface ShapeInventorySlide {
  slide_n: number
  count: number
  [key: string]: number
}

export async function fetchShapeInventory(docId: string): Promise<{
  tally: Record<string, number>
  per_slide: ShapeInventorySlide[]
  total_shapes: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/shape-inventory`)
}

// ── Assumption Checker ────────────────────────────────────────────────────────

export interface AssumptionEntry {
  slide_n: number
  assumption: string
  risk: "low" | "medium" | "high"
  suggestion: string
}

export async function fetchAssumptionChecker(docId: string): Promise<{ assumptions: AssumptionEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/assumption-checker`, { method: "POST" })
}

// ── Font Size Distribution ────────────────────────────────────────────────────

export interface FontSizeBucket {
  pt: number
  count: number
  pct: number
}

export async function fetchFontSizeDistribution(docId: string): Promise<{
  distribution: FontSizeBucket[]
  most_common_pt: number
  unique_sizes: number
  total_runs: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/font-size-distribution`)
}

// ── Key Message Extractor ─────────────────────────────────────────────────────

export interface KeyMessage {
  rank: number
  message: string
  evidence_slides: number[]
  confidence: number
}

export async function fetchKeyMessageExtractor(docId: string): Promise<{ messages: KeyMessage[] }> {
  return apiFetch(`${BASE}/docs/${docId}/key-message-extractor`, { method: "POST" })
}

// ── Text Color Audit ──────────────────────────────────────────────────────────

export interface TextColorEntry {
  hex: string
  slides: number[]
  count: number
}

export async function fetchTextColorAudit(docId: string): Promise<{ colors: TextColorEntry[]; total_unique: number }> {
  return apiFetch(`${BASE}/docs/${docId}/text-color-audit`)
}

// ── Competitive Positioning ───────────────────────────────────────────────────

export interface CompetitivePositioning {
  positioning_strategy: string
  differentiators: string[]
  competitors_mentioned: string[]
  gaps: string[]
  strength_score: number
}

export async function fetchCompetitivePositioning(docId: string): Promise<CompetitivePositioning> {
  return apiFetch(`${BASE}/docs/${docId}/competitive-positioning`, { method: "POST" })
}

// ── Empty Notes Finder ────────────────────────────────────────────────────────

export async function fetchEmptyNotesFinder(docId: string): Promise<{
  no_notes: number[]
  has_notes: number[]
  total: number
  coverage_pct: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/empty-notes-finder`)
}

// ── Deck Quiz Generator ───────────────────────────────────────────────────────

export interface QuizQuestion {
  q: number
  question: string
  choices: string[]
  answer: number
  explanation: string
}

export async function fetchDeckQuizGenerator(docId: string): Promise<{ questions: QuizQuestion[] }> {
  return apiFetch(`${BASE}/docs/${docId}/deck-quiz-generator`, { method: "POST" })
}

// ── Slide Symmetry ────────────────────────────────────────────────────────────

export interface SlideSymmetryEntry {
  slide_n: number
  left_pct: number
  right_pct: number
  balance: "balanced" | "left-heavy" | "right-heavy"
  diff: number
}

export async function fetchSlideSymmetry(docId: string): Promise<{
  slides: SlideSymmetryEntry[]
  imbalanced_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-symmetry`)
}

// ── Objection Map ─────────────────────────────────────────────────────────────

export interface ObjectionTheme {
  name: string
  objections: string[]
  severity: "low" | "medium" | "high"
  suggested_response: string
}

export async function fetchObjectionMap(docId: string): Promise<{ themes: ObjectionTheme[] }> {
  return apiFetch(`${BASE}/docs/${docId}/objection-map`, { method: "POST" })
}

// ── Text Density Per Word ─────────────────────────────────────────────────────

export interface TextDensitySlide {
  slide_n: number
  total_words: number
  text_shapes: number
  avg_per_shape: number
  dense: boolean
}

export async function fetchTextDensityPerWord(docId: string): Promise<{
  per_slide: TextDensitySlide[]
  global_avg: number
  total_words: number
  dense_slides: number[]
  threshold: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/text-density-per-word`)
}

// ── Slide Story Beats ─────────────────────────────────────────────────────────

export interface StoryBeatEntry {
  slide_n: number
  beat: string
  description: string
}

export async function fetchSlideStoryBeats(docId: string): Promise<{ beats: StoryBeatEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-story-beats`, { method: "POST" })
}

// ── Placeholder Text Finder ───────────────────────────────────────────────────

export interface PlaceholderHit {
  slide_n: number
  text: string
  pattern: string
}

export async function fetchPlaceholderTextFinder(docId: string): Promise<{
  hits: PlaceholderHit[]
  total: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/placeholder-text-finder`)
}

// ── Audience Journey Map ──────────────────────────────────────────────────────

export interface JourneySlide {
  slide_n: number
  emotion: string
  intensity: number
  description: string
}

export async function fetchAudienceJourneyMap(docId: string): Promise<{ journey: JourneySlide[] }> {
  return apiFetch(`${BASE}/docs/${docId}/audience-journey-map`, { method: "POST" })
}

// ── Link Density ──────────────────────────────────────────────────────────────

export interface LinkDensitySlide {
  slide_n: number
  link_count: number
}

export async function fetchLinkDensity(docId: string): Promise<{
  per_slide: LinkDensitySlide[]
  total_links: number
  max_on_slide: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/link-density`)
}

// ── Presentation Summary Bullets ──────────────────────────────────────────────

export async function fetchPresentationSummaryBullets(docId: string): Promise<{ bullets: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-summary-bullets`, { method: "POST" })
}

// ── Color Contrast Audit ──────────────────────────────────────────────────────

export interface ContrastSlide {
  slide_n: number
  low_contrast_runs: number
}

export async function fetchColorContrastAudit(docId: string): Promise<{
  per_slide: ContrastSlide[]
  flagged_slides: number[]
  flagged_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/color-contrast-audit`)
}

// ── Deck Personality ──────────────────────────────────────────────────────────

export interface DeckPersonality {
  archetype: string
  tone_words: string[]
  strengths: string[]
  risks: string[]
  recommendation: string
}

export async function fetchDeckPersonality(docId: string): Promise<DeckPersonality> {
  return apiFetch(`${BASE}/docs/${docId}/deck-personality`, { method: "POST" })
}

// ── Title Length Audit ────────────────────────────────────────────────────────

export interface TitleLengthSlide {
  slide_n: number
  title: string
  char_count: number
  status: "ok" | "long" | "missing"
}

export async function fetchTitleLengthAudit(docId: string): Promise<{
  slides: TitleLengthSlide[]
  flagged_count: number
  ideal_max: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/title-length-audit`)
}

// ── Call-to-Action Finder ─────────────────────────────────────────────────────

export interface CtaEntry {
  slide_n: number
  text: string
  clarity: "clear" | "vague" | "missing"
  strength: "strong" | "moderate" | "weak"
  suggestion: string
}

export async function fetchCallToActionFinder(docId: string): Promise<{
  ctas: CtaEntry[]
  overall_cta_score: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/call-to-action-finder`, { method: "POST" })
}

// ── Slide Word Count Histogram ────────────────────────────────────────────────

export interface WordCountSlide {
  slide_n: number
  word_count: number
}

export interface WordCountBucket {
  label: string
  count: number
}

export async function fetchSlideWordCountHistogram(docId: string): Promise<{
  per_slide: WordCountSlide[]
  histogram: WordCountBucket[]
  total_words: number
  avg_words: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-word-count-histogram`)
}

// ── Rhetorical Device Finder ──────────────────────────────────────────────────

export interface RhetoricalDevice {
  device: string
  example: string
  slide_hint: string
  effect: string
}

export async function fetchRhetoricalDeviceFinder(docId: string): Promise<{
  devices: RhetoricalDevice[]
  missing_devices: string[]
  overall_rhetoric_score: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/rhetorical-device-finder`, { method: "POST" })
}

// ── Shape Z-Order Audit ────────────────────────────────────────────────────────

export interface ZOrderSlide {
  slide_n: number
  shape_count: number
  overlap_pairs: number
}

export async function fetchShapeZOrderAudit(docId: string): Promise<{
  slides: ZOrderSlide[]
  flagged_slides: number[]
  flagged_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/shape-z-order-audit`)
}

// ── Competitive Gap Analyzer ──────────────────────────────────────────────────

export interface CompetitiveGap {
  area: string
  severity: "high" | "medium" | "low"
  what_competitor_does: string
  recommendation: string
}

export async function fetchCompetitiveGapAnalyzer(docId: string): Promise<{
  gaps: CompetitiveGap[]
  competitive_score: number
  summary: string
}> {
  return apiFetch(`${BASE}/docs/${docId}/competitive-gap-analyzer`, { method: "POST" })
}

// ── Bullet Count Per Slide ────────────────────────────────────────────────────

export interface BulletCountSlide {
  slide_n: number
  bullet_count: number
  over_limit: boolean
}

export async function fetchBulletCountPerSlide(docId: string): Promise<{
  slides: BulletCountSlide[]
  flagged_slides: number[]
  total_bullets: number
  ideal_max: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/bullet-count-per-slide`)
}

// ── Slide Hook Analyzer ────────────────────────────────────────────────────────

export interface SlideHook {
  slide_n: number
  hook_type: string
  strength: number
  improvement: string
}

export async function fetchSlideHookAnalyzer(docId: string): Promise<{ hooks: SlideHook[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-hook-analyzer`, { method: "POST" })
}

// ── Image Caption Checker ─────────────────────────────────────────────────────

export interface ImageCaptionSlide {
  slide_n: number
  image_count: number
  has_caption: boolean
  caption_text: string
}

export async function fetchImageCaptionChecker(docId: string): Promise<{
  slides_with_images: ImageCaptionSlide[]
  missing_captions: number[]
  total_image_slides: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/image-caption-checker`)
}

// ── Data Story Checker ────────────────────────────────────────────────────────

export interface DataStoryEval {
  slide_n: number
  story_clarity: number
  data_type: string
  tells_story: boolean
  suggestion: string
}

export async function fetchDataStoryChecker(docId: string): Promise<{
  evaluations: DataStoryEval[]
  summary: string
}> {
  return apiFetch(`${BASE}/docs/${docId}/data-story-checker`, { method: "POST" })
}

// ── Slide Pacing Score ────────────────────────────────────────────────────────

export interface PacingSlide {
  slide_n: number
  word_count: number
  reading_secs: number
  pacing: "fast" | "good" | "slow"
  density_ratio: number
}

export async function fetchSlidePacingScore(docId: string): Promise<{
  per_slide: PacingSlide[]
  est_duration_mins: number
  fast_slides: number
  slow_slides: number
  slide_count: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-pacing-score`)
}

// ── Trust Signal Finder ───────────────────────────────────────────────────────

export interface TrustSignal {
  type: string
  quote: string
  strength: "strong" | "moderate" | "weak"
  slide_hint: string
}

export async function fetchTrustSignalFinder(docId: string): Promise<{
  signals: TrustSignal[]
  missing_types: string[]
  trust_score: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/trust-signal-finder`, { method: "POST" })
}

// ── Repeated Words Audit ──────────────────────────────────────────────────────

export interface RepeatedWord {
  word: string
  count: number
}

export async function fetchRepeatedWordsAudit(docId: string): Promise<{
  repeated_words: RepeatedWord[]
  total_unique: number
  min_threshold: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/repeated-words-audit`)
}

// ── Slide Transitions Advisor ─────────────────────────────────────────────────

export interface TransitionAdvice {
  from_slide: number
  to_slide: number
  type: string
  rationale: string
}

export async function fetchSlideTransitionsAdvisor(docId: string): Promise<{ transitions: TransitionAdvice[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-transitions-advisor`, { method: "POST" })
}

// ── Slide Layout Type Audit ───────────────────────────────────────────────────

export interface LayoutSlide {
  slide_n: number
  layout: string
}

export async function fetchSlideLayoutTypeAudit(docId: string): Promise<{
  slides: LayoutSlide[]
  distribution: Record<string, number>
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-layout-type-audit`)
}

// ── Opening & Closer Evaluator ────────────────────────────────────────────────

export interface SlideEval {
  impact: number
  clarity: number
  strength: string
  improvement: string
  verdict: string
}

export async function fetchOpeningCloserEvaluator(docId: string): Promise<{
  opening: SlideEval
  closing: SlideEval
}> {
  return apiFetch(`${BASE}/docs/${docId}/opening-closer-evaluator`, { method: "POST" })
}

// ── Acronym Finder ────────────────────────────────────────────────────────────

export interface AcronymEntry {
  acronym: string
  slides: number[]
  count: number
}

export async function fetchAcronymFinder(docId: string): Promise<{
  acronyms: AcronymEntry[]
  total_unique: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/acronym-finder`)
}

// ── Slide Complexity Ranker ───────────────────────────────────────────────────

export interface ComplexityEntry {
  slide_n: number
  complexity_score: number
  simplification: string | null
}

export async function fetchSlideComplexityRanker(docId: string): Promise<{ ranked: ComplexityEntry[] }> {
  return apiFetch(`${BASE}/docs/${docId}/slide-complexity-ranker`, { method: "POST" })
}

// ── Numbered List Consistency ─────────────────────────────────────────────────

export interface NumberedListIssue {
  slide_n: number
  found: number[]
  issue: string
}

export async function fetchNumberedListConsistency(docId: string): Promise<{
  issues: NumberedListIssue[]
  total_issues: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/numbered-list-consistency`)
}

// ── Persuasion Framework Detector ─────────────────────────────────────────────

export interface PersuasionFramework {
  framework: string
  confidence: "high" | "medium" | "low"
  evidence: string
  completeness: number
}

export async function fetchPersuasionFrameworkDetector(docId: string): Promise<{
  detected: PersuasionFramework[]
  dominant_framework: string
  missing_elements: string[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/persuasion-framework-detector`, { method: "POST" })
}

// ── Slide Aspect Ratio Check ──────────────────────────────────────────────────

export interface BoundsIssue {
  slide_n: number
  shape_name: string
  issue: string
}

export async function fetchSlideAspectRatioCheck(docId: string): Promise<{
  issues: BoundsIssue[]
  flagged_slides: number[]
  total_issues: number
  slide_width_emu: number
  slide_height_emu: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/slide-aspect-ratio-check`)
}

// ── Value Proposition Extractor ───────────────────────────────────────────────

export interface ValueProposition {
  value_proposition: string
  target_audience: string
  primary_benefit: string
  differentiator: string
  clarity_score: number
  strength_score: number
  improvement: string
}

export async function fetchValuePropositionExtractor(docId: string): Promise<ValueProposition> {
  return apiFetch(`${BASE}/docs/${docId}/value-proposition-extractor`, { method: "POST" })
}

// ── Chart Count Per Slide ─────────────────────────────────────────────────────

export interface ChartCountSlide {
  slide_n: number
  chart_count: number
}

export async function fetchChartCountPerSlide(docId: string): Promise<{
  per_slide: ChartCountSlide[]
  total_charts: number
  slides_with_charts: number[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/chart-count-per-slide`)
}

// ── Narrative Arc Scorer ──────────────────────────────────────────────────────

export interface NarrativeArcResult {
  scores: {
    setup: number
    conflict: number
    development: number
    resolution: number
    call_to_action: number
  }
  overall: number
  summary: string
  weakest_area: string
  suggestion: string
}

export async function fetchNarrativeArcScorer(docId: string): Promise<NarrativeArcResult> {
  return apiFetch(`${BASE}/docs/${docId}/narrative-arc-scorer`, { method: "POST" })
}

// ── Duplicate Slide Detector ──────────────────────────────────────────────────

export interface DuplicateGroup {
  slides: number[]
  similarity: string
}

export async function fetchDuplicateSlideDetector(docId: string): Promise<{
  groups: DuplicateGroup[]
  total_duplicate_groups: number
}> {
  return apiFetch(`${BASE}/docs/${docId}/duplicate-slide-detector`)
}

// ── Slide Reorder Advisor ─────────────────────────────────────────────────────

export interface ReorderChange {
  from: number
  to: number
  reason: string
}

export interface ReorderResult {
  suggested_order: number[]
  changes: ReorderChange[]
  flow_score_before: number
  flow_score_after: number
  summary: string
}

export async function fetchSlideReorderAdvisor(docId: string): Promise<ReorderResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-reorder-advisor`, { method: "POST" })
}

// ── Table Count Audit ─────────────────────────────────────────────────────────

export interface TableInfo {
  rows: number
  cols: number
  empty: boolean
  complex: boolean
}

export interface TableCountSlide {
  slide_n: number
  table_count: number
  tables: TableInfo[]
}

export async function fetchTableCountAudit(docId: string): Promise<{
  per_slide: TableCountSlide[]
  total_tables: number
  flagged_slides: number[]
}> {
  return apiFetch(`${BASE}/docs/${docId}/table-count-audit`)
}

// ── Emotional Tone Profiler ───────────────────────────────────────────────────

export interface ToneProfile {
  slide_n: number
  tone: string
  intensity: number
  key_words: string[]
}

export interface EmotionalToneResult {
  profiles: ToneProfile[]
  dominant_tone: string
  tone_consistency: number
  recommendation: string
}

export async function fetchEmotionalToneProfiler(docId: string): Promise<EmotionalToneResult> {
  return apiFetch(`${BASE}/docs/${docId}/emotional-tone-profiler`, { method: "POST" })
}

// ── Heading Hierarchy Check ───────────────────────────────────────────────────

export interface HeadingIssue {
  slide_n: number
  max_font_pt: number
  avg_pt: number
  delta: number
}

export async function fetchHeadingHierarchyCheck(docId: string): Promise<{
  issues: HeadingIssue[]
  avg_heading_pt: number
  consistent: boolean
}> {
  return apiFetch(`${BASE}/docs/${docId}/heading-hierarchy-check`)
}

// ── Pitch Readiness Score ─────────────────────────────────────────────────────

export interface PitchReadinessResult {
  overall_score: number
  dimensions: {
    clarity: number
    storytelling: number
    credibility: number
    urgency: number
    visual_quality_estimate: number
  }
  strengths: string[]
  gaps: string[]
  verdict: string
}

export async function fetchPitchReadinessScore(docId: string): Promise<PitchReadinessResult> {
  return apiFetch(`${BASE}/docs/${docId}/pitch-readiness-score`, { method: "POST" })
}

// ── Batch 55 ──────────────────────────────────────────────────────────────────

export interface FontSlide {
  slide_n: number
  fonts: string[]
  font_count: number
  flagged: boolean
}

export interface FontVarietyResult {
  per_slide: FontSlide[]
  unique_fonts: string[]
  total_unique: number
  flagged_slides: number[]
}

export async function fetchFontVarietyAudit(docId: string): Promise<FontVarietyResult> {
  return apiFetch(`${BASE}/docs/${docId}/font-variety-audit`)
}

export interface MetaphorEntry {
  slide_n: number
  text: string
  type: "metaphor" | "simile" | "analogy"
  what_it_compares: string
}

export interface MetaphorResult {
  metaphors: MetaphorEntry[]
  strategy_summary: string
  total: number
}

export async function fetchSlideMetaphorFinder(docId: string): Promise<MetaphorResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-metaphor-finder`, { method: "POST" })
}

export interface EmptySlide {
  slide_n: number
  text_count: number
  shape_count: number
  has_image: boolean
  has_chart: boolean
  empty: boolean
  sparse: boolean
}

export interface EmptySlideResult {
  per_slide: EmptySlide[]
  empty_slides: number[]
  sparse_slides: number[]
  total_empty: number
  total_sparse: number
}

export async function fetchEmptySlideDetector(docId: string): Promise<EmptySlideResult> {
  return apiFetch(`${BASE}/docs/${docId}/empty-slide-detector`)
}

export interface ClosingStrengthResult {
  closing_score: number
  memorability: number
  cta_clarity: number
  emotional_resonance: number
  next_steps_clarity: number
  verdict: string
  suggestions: string[]
}

export async function fetchClosingStrengthEvaluator(docId: string): Promise<ClosingStrengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/closing-strength-evaluator`, { method: "POST" })
}

// ── Batch 56 ──────────────────────────────────────────────────────────────────

export interface TitleUniquenessSlide {
  slide_n: number
  title: string
  duplicate: boolean
}

export interface DuplicateTitleGroup {
  title: string
  slides: number[]
}

export interface TitleUniquenessResult {
  per_slide: TitleUniquenessSlide[]
  duplicate_titles: DuplicateTitleGroup[]
  flagged_slides: number[]
  total_duplicates: number
}

export async function fetchSlideTitleUniqueness(docId: string): Promise<TitleUniquenessResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-title-uniqueness`)
}

export interface OpeningHookResult {
  hook_score: number
  curiosity_spark: number
  clarity_of_promise: number
  audience_relevance: number
  energy_level: number
  verdict: string
  improvements: string[]
}

export async function fetchOpeningHookRater(docId: string): Promise<OpeningHookResult> {
  return apiFetch(`${BASE}/docs/${docId}/opening-hook-rater`, { method: "POST" })
}

export interface SpeakerNoteLengthSlide {
  slide_n: number
  word_count: number
  too_short: boolean
  too_long: boolean
  preview: string
}

export interface SpeakerNoteLengthResult {
  per_slide: SpeakerNoteLengthSlide[]
  no_notes: number[]
  too_short: number[]
  too_long: number[]
  avg_words: number
}

export async function fetchSpeakerNoteLengthChecker(docId: string): Promise<SpeakerNoteLengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/speaker-note-length-checker`)
}

export interface CompetitorMention {
  slide_n: number
  competitor: string
  context: string
  framing: "positive" | "negative" | "neutral" | "comparative"
}

export interface CompetitorMentionResult {
  mentions: CompetitorMention[]
  total: number
  summary: string
}

export async function fetchCompetitorMentionFinder(docId: string): Promise<CompetitorMentionResult> {
  return apiFetch(`${BASE}/docs/${docId}/competitor-mention-finder`, { method: "POST" })
}

// ── Batch 57 ──────────────────────────────────────────────────────────────────

export interface ImageCountSlide {
  slide_n: number
  image_count: number
  none: boolean
  many: boolean
}

export interface SlideImageCountResult {
  per_slide: ImageCountSlide[]
  total_images: number
  no_image_slides: number[]
  many_image_slides: number[]
}

export async function fetchSlideImageCount(docId: string): Promise<SlideImageCountResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-image-count`)
}

export interface TaglineOption {
  text: string
  style: "punchy" | "benefit" | "action"
  rationale: string
}

export interface TaglineResult {
  taglines: TaglineOption[]
  core_message: string
}

export async function fetchPresentationTaglineGenerator(docId: string): Promise<TaglineResult> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-tagline-generator`, { method: "POST" })
}

export interface LongSentenceEntry {
  text: string
  word_count: number
}

export interface LongSentenceSlide {
  slide_n: number
  long_sentences: LongSentenceEntry[]
  count: number
}

export interface LongSentenceResult {
  per_slide: LongSentenceSlide[]
  flagged_slides: number[]
  total_long: number
}

export async function fetchLongSentenceDetector(docId: string): Promise<LongSentenceResult> {
  return apiFetch(`${BASE}/docs/${docId}/long-sentence-detector`)
}

export interface StakeholderConcern {
  slide_n: number
  concern: string
  severity: "low" | "medium" | "high"
}

export interface StakeholderConcernResult {
  per_slide: StakeholderConcern[]
  top_concerns: string[]
  overall_risk: "low" | "medium" | "high"
}

export async function fetchStakeholderConcernMapper(docId: string): Promise<StakeholderConcernResult> {
  return apiFetch(`${BASE}/docs/${docId}/stakeholder-concern-mapper`, { method: "POST" })
}

// ── Batch 58 ──────────────────────────────────────────────────────────────────

export interface SlideColorEntry {
  slide_n: number
  colors: string[]
}

export interface TopColor {
  hex: string
  count: number
}

export interface ColorPaletteResult {
  per_slide: SlideColorEntry[]
  top_colors: TopColor[]
  total_unique: number
}

export async function fetchSlideColorPalette(docId: string): Promise<ColorPaletteResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-color-palette`)
}

export interface DensitySlide {
  slide_n: number
  density_score: number
  label: "sparse" | "ideal" | "dense" | "overcrowded"
}

export interface ContentDensityResult {
  per_slide: DensitySlide[]
  avg_density: number
  recommendation: string
}

export async function fetchContentDensityScorer(docId: string): Promise<ContentDensityResult> {
  return apiFetch(`${BASE}/docs/${docId}/content-density-scorer`, { method: "POST" })
}

export interface LongBullet {
  text: string
  word_count: number
}

export interface BulletLengthSlide {
  slide_n: number
  long_bullets: LongBullet[]
  count: number
}

export interface BulletLengthResult {
  per_slide: BulletLengthSlide[]
  flagged_slides: number[]
  total_long: number
}

export async function fetchBulletLengthAudit(docId: string): Promise<BulletLengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/bullet-length-audit`)
}

export interface MissingSlide {
  title: string
  purpose: string
  suggested_position: string
  priority: "high" | "medium" | "low"
}

export interface GapFillerResult {
  missing_slides: MissingSlide[]
  summary: string
}

export async function fetchPresentationGapFiller(docId: string): Promise<GapFillerResult> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-gap-filler`, { method: "POST" })
}

// ── Batch 59 ──────────────────────────────────────────────────────────────────

export interface ShapeCountSlide {
  slide_n: number
  shape_count: number
  flagged: boolean
}

export interface ShapeCountResult {
  per_slide: ShapeCountSlide[]
  avg_shapes: number
  total_shapes: number
  complex_slides: number[]
}

export async function fetchShapeCountPerSlide(docId: string): Promise<ShapeCountResult> {
  return apiFetch(`${BASE}/docs/${docId}/shape-count-per-slide`)
}

export interface TitleImprovement {
  slide_n: number
  current: string
  improved: string
  reason: string
}

export interface TitleImproverResult {
  slides: TitleImprovement[]
}

export async function fetchSlideTitleImprover(docId: string): Promise<TitleImproverResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-title-improver`, { method: "POST" })
}

export interface NumericSlide {
  slide_n: number
  numbers: string[]
  count: number
  has_data: boolean
}

export interface NumericDataResult {
  per_slide: NumericSlide[]
  data_slides: number[]
  total_numbers: number
}

export async function fetchNumericDataSpotter(docId: string): Promise<NumericDataResult> {
  return apiFetch(`${BASE}/docs/${docId}/numeric-data-spotter`)
}

export interface QAPair {
  objection: string
  response: string
  confidence: "high" | "medium" | "low"
}

export interface ObjectionHandlerResult {
  qa_pairs: QAPair[]
}

export async function fetchObjectionHandlerGenerator(docId: string): Promise<ObjectionHandlerResult> {
  return apiFetch(`${BASE}/docs/${docId}/objection-handler-generator`, { method: "POST" })
}

// ── Batch 60 ──────────────────────────────────────────────────────────────────

export interface TextCaseSlide {
  slide_n: number
  cases: Record<string, number>
  dominant: string
  inconsistent: boolean
}

export interface TextCaseAuditResult {
  per_slide: TextCaseSlide[]
  inconsistent_slides: number[]
  total_inconsistent: number
}

export async function fetchTextCaseAudit(docId: string): Promise<TextCaseAuditResult> {
  return apiFetch(`${BASE}/docs/${docId}/text-case-audit`)
}

export interface AudiencePersona {
  persona_name: string
  role: string
  industry: string
  seniority: string
  main_concerns: string[]
  knowledge_level: string
  key_motivations: string[]
  communication_style: string
}

export async function fetchAudiencePersonaBuilder(docId: string): Promise<AudiencePersona> {
  return apiFetch(`${BASE}/docs/${docId}/audience-persona-builder`, { method: "POST" })
}

export interface FootnoteEntry {
  text: string
  pt: number
}

export interface FootnoteSlide {
  slide_n: number
  footnotes: FootnoteEntry[]
  count: number
}

export interface FootnoteResult {
  per_slide: FootnoteSlide[]
  flagged_slides: number[]
  total_footnotes: number
}

export async function fetchSlideFootnoteFinder(docId: string): Promise<FootnoteResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-footnote-finder`)
}

export interface ExecSummaryResult {
  tldr: string
  key_takeaways: string[]
  call_to_action: string
  estimated_read_time: string
}

export async function fetchDeckExecutiveSummary(docId: string): Promise<ExecSummaryResult> {
  return apiFetch(`${BASE}/docs/${docId}/deck-executive-summary`, { method: "POST" })
}

// ── Batch 61 ──────────────────────────────────────────────────────────────────

export interface HyperlinkEntry {
  url: string
  label: string
}

export interface HyperlinkSlide {
  slide_n: number
  links: HyperlinkEntry[]
  count: number
}

export interface HyperlinkAuditResult {
  per_slide: HyperlinkSlide[]
  total_links: number
  slide_count: number
}

export async function fetchSlideHyperlinkAudit(docId: string): Promise<HyperlinkAuditResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-hyperlink-audit`)
}

export interface PersuasionSlide {
  slide_n: number
  intensity: number
  drivers: string[]
}

export interface PersuasionIntensityResult {
  per_slide: PersuasionSlide[]
  avg_intensity: number
  peak_slide: number
}

export async function fetchPersuasionIntensityRater(docId: string): Promise<PersuasionIntensityResult> {
  return apiFetch(`${BASE}/docs/${docId}/persuasion-intensity-rater`, { method: "POST" })
}

export interface IconSize {
  w: number
  h: number
}

export interface IconSlide {
  slide_n: number
  image_sizes: IconSize[]
  count: number
}

export interface IconographyResult {
  per_slide: IconSlide[]
  avg_size_pt: number
  stddev_pt: number
  inconsistent: boolean
  total_images: number
}

export async function fetchConsistentIconographyCheck(docId: string): Promise<IconographyResult> {
  return apiFetch(`${BASE}/docs/${docId}/consistent-iconography-check`)
}

export interface OnePageSummaryResult {
  background: string
  main_argument: string
  supporting_points: string[]
  evidence_highlights: string[]
  conclusion: string
  next_steps: string[]
}

export async function fetchOnePageSummaryGenerator(docId: string): Promise<OnePageSummaryResult> {
  return apiFetch(`${BASE}/docs/${docId}/one-page-summary-generator`, { method: "POST" })
}

// ── Batch 62 ──────────────────────────────────────────────────────────────────

export interface OffCanvasShape {
  name: string
  shape_type: number
}

export interface ShapeVisibilitySlide {
  slide_n: number
  off_canvas: OffCanvasShape[]
  count: number
}

export interface ShapeVisibilityResult {
  per_slide: ShapeVisibilitySlide[]
  flagged_slides: number[]
  total_hidden: number
}

export async function fetchShapeVisibilityAudit(docId: string): Promise<ShapeVisibilityResult> {
  return apiFetch(`${BASE}/docs/${docId}/shape-visibility-audit`)
}

export interface IcebreakerIdea {
  title: string
  description: string
  format: "poll" | "question" | "activity" | "fact"
  duration_min: number
}

export interface IcebreakerResult {
  icebreakers: IcebreakerIdea[]
}

export async function fetchIcebreakerSlideGenerator(docId: string): Promise<IcebreakerResult> {
  return apiFetch(`${BASE}/docs/${docId}/icebreaker-slide-generator`, { method: "POST" })
}

export interface BgColorSlide {
  slide_n: number
  bg_color: string
  has_custom_bg: boolean
}

export interface BgColorResult {
  per_slide: BgColorSlide[]
  dominant_bg: string
  inconsistent: boolean
  color_summary: Record<string, number>
}

export async function fetchSlideBackgroundColorChecker(docId: string): Promise<BgColorResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-background-color-checker`)
}

export interface NarrativeIssue {
  slide_n: number
  issue: string
  type: "tone_shift" | "contradiction" | "topic_drift" | "gap"
}

export interface NarrativeConsistencyResult {
  overall_consistency: number
  issues: NarrativeIssue[]
  verdict: string
  recommendation: string
}

export async function fetchNarrativeConsistencyChecker(docId: string): Promise<NarrativeConsistencyResult> {
  return apiFetch(`${BASE}/docs/${docId}/narrative-consistency-checker`, { method: "POST" })
}

// ── Batch 63 ──────────────────────────────────────────────────────────────────

export interface LayerEntry {
  z_index: number
  name: string
  type: number
  has_text: boolean
}

export interface LayerSlide {
  slide_n: number
  layers: LayerEntry[]
  shape_count: number
}

export interface LayerOrderResult {
  per_slide: LayerSlide[]
}

export async function fetchSlideLayerOrderAudit(docId: string): Promise<LayerOrderResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-layer-order-audit`)
}

export interface BrandVoiceResult {
  overall_score: number
  confidence: number
  clarity: number
  consistency: number
  professionalism: number
  distinctiveness: number
  voice_archetype: string
  improvements: string[]
}

export async function fetchBrandVoiceScorer(docId: string): Promise<BrandVoiceResult> {
  return apiFetch(`${BASE}/docs/${docId}/brand-voice-scorer`, { method: "POST" })
}

export interface PunctSlide {
  slide_n: number
  bullet_count: number
  with_period: number
  without_punct: number
  inconsistent: boolean
}

export interface PunctConsistencyResult {
  per_slide: PunctSlide[]
  inconsistent_slides: number[]
  total_inconsistent: number
}

export async function fetchPunctuationConsistencyCheck(docId: string): Promise<PunctConsistencyResult> {
  return apiFetch(`${BASE}/docs/${docId}/punctuation-consistency-check`)
}

export interface SplitRecommendation {
  slide_n: number
  reason: string
  slide_a_content: string
  slide_b_content: string
  priority: "high" | "medium" | "low"
}

export interface SplitRecommenderResult {
  splits: SplitRecommendation[]
}

export async function fetchSlideSplitRecommender(docId: string): Promise<SplitRecommenderResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-split-recommender`, { method: "POST" })
}

// ── batch 64 ──────────────────────────────────────────────────────────────────

export interface TextDensitySlide {
  slide_n: number
  word_count: number
  char_count: number
  bullet_count: number
}

export interface TextDensityResult {
  per_slide: TextDensitySlide[]
  total_words: number
  avg_words_per_slide: number
}

export async function fetchSlideTextDensity(docId: string): Promise<TextDensityResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-text-density`)
}

export interface TransitionSuggestion {
  from_slide: number
  to_slide: number
  style: string
  rationale: string
}

export interface TransitionSuggesterResult {
  transitions: TransitionSuggestion[]
}

export async function fetchSlideTransitionSuggester(docId: string): Promise<TransitionSuggesterResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-transition-suggester`, { method: "POST" })
}

export interface DuplicatePair {
  slide_a: number
  slide_b: number
  overlap_pct: number
}

export interface DuplicateSlideContentResult {
  duplicates: DuplicatePair[]
  total_pairs: number
}

export async function fetchDuplicateSlideContent(docId: string): Promise<DuplicateSlideContentResult> {
  return apiFetch(`${BASE}/docs/${docId}/duplicate-slide-content`)
}

export interface CtaStrengthResult {
  overall_score: number
  clarity: number
  urgency: number
  specificity: number
  placement: number
  cta_text: string | null
  improvements: string[]
  verdict: string
}

export async function fetchCtaStrengthRater(docId: string): Promise<CtaStrengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/cta-strength-rater`, { method: "POST" })
}

// ── batch 65 ──────────────────────────────────────────────────────────────────

export interface AgendaSlide {
  slide_n: number
  title: string
}

export interface AgendaSlideResult {
  agenda_slides: AgendaSlide[]
  count: number
}

export async function fetchAgendaSlideDetector(docId: string): Promise<AgendaSlideResult> {
  return apiFetch(`${BASE}/docs/${docId}/agenda-slide-detector`)
}

export interface PassiveVoiceSlide {
  slide_n: number
  instances: string[]
}

export interface PassiveVoiceResult {
  per_slide: PassiveVoiceSlide[]
  total_instances: number
}

export async function fetchPassiveVoiceDetector(docId: string): Promise<PassiveVoiceResult> {
  return apiFetch(`${BASE}/docs/${docId}/passive-voice-detector`)
}

export interface SlideLengthEntry {
  slide_n: number
  word_count: number
  est_seconds: number
  est_label: string
}

export interface SlideLengthResult {
  per_slide: SlideLengthEntry[]
  total_seconds: number
  total_label: string
  wpm_assumption: number
}

export async function fetchSlideLengthEstimator(docId: string): Promise<SlideLengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-length-estimator`)
}

export interface DataClaim {
  slide_n: number
  claim: string
  reason: string
  severity: "high" | "medium" | "low"
}

export interface DataClaimResult {
  claims: DataClaim[]
}

export async function fetchDataClaimChecker(docId: string): Promise<DataClaimResult> {
  return apiFetch(`${BASE}/docs/${docId}/data-claim-checker`, { method: "POST" })
}

// ── batch 66 ──────────────────────────────────────────────────────────────────

export interface SlideQuote {
  slide_n: number
  quote: string
}

export interface SlideQuoteResult {
  quotes: SlideQuote[]
  total: number
}

export async function fetchSlideQuoteFinder(docId: string): Promise<SlideQuoteResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-quote-finder`)
}

export interface AbbreviationEntry {
  abbr: string
  slides: number[]
}

export interface AbbreviationResult {
  abbreviations: AbbreviationEntry[]
  total: number
}

export async function fetchAbbreviationFinder(docId: string): Promise<AbbreviationResult> {
  return apiFetch(`${BASE}/docs/${docId}/abbreviation-finder`)
}

export interface MoodAnalyzerResult {
  dominant_mood: string
  mood_score: number
  secondary_tones: string[]
  mood_summary: string
  recommendations: string[]
}

export async function fetchPresentationMoodAnalyzer(docId: string): Promise<MoodAnalyzerResult> {
  return apiFetch(`${BASE}/docs/${docId}/presentation-mood-analyzer`, { method: "POST" })
}

export interface JargonEntry {
  slide_n: number
  term: string
  suggestion: string
  audience_risk: "high" | "medium" | "low"
}

export interface JargonFinderResult {
  jargon: JargonEntry[]
}

export async function fetchJargonFinder(docId: string): Promise<JargonFinderResult> {
  return apiFetch(`${BASE}/docs/${docId}/jargon-finder`, { method: "POST" })
}

// ── batch 67 ──────────────────────────────────────────────────────────────────

export interface TitleSlideEntry {
  slide_n: number
  reason: string
}

export interface TitleSlideResult {
  title_slides: TitleSlideEntry[]
  count: number
}

export async function fetchTitleSlideDetector(docId: string): Promise<TitleSlideResult> {
  return apiFetch(`${BASE}/docs/${docId}/title-slide-detector`)
}

export interface QuestionSlide {
  slide_n: number
  questions: string[]
}

export interface QuestionSlideResult {
  per_slide: QuestionSlide[]
  total_questions: number
}

export async function fetchQuestionSlideFinder(docId: string): Promise<QuestionSlideResult> {
  return apiFetch(`${BASE}/docs/${docId}/question-slide-finder`)
}

export interface ThemeEntry {
  theme: string
  description: string
  relevance: number
  keywords: string[]
}

export interface ThemeExtractorResult {
  themes: ThemeEntry[]
}

export async function fetchSlideThemeExtractor(docId: string): Promise<ThemeExtractorResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-theme-extractor`, { method: "POST" })
}

export interface ComplexitySlide {
  slide_n: number
  complexity_score: number
  shape_count: number
  word_count: number
  has_chart: boolean
  has_image: boolean
}

export interface ComplexityScorerResult {
  per_slide: ComplexitySlide[]
  avg_complexity: number
}

export async function fetchSlideComplexityScorer(docId: string): Promise<ComplexityScorerResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-complexity-scorer`)
}

// ── batch 68 ──────────────────────────────────────────────────────────────────

export interface TitleLengthSlide {
  slide_n: number
  title: string
  word_count: number
  too_long: boolean
}

export interface TitleLengthResult {
  per_slide: TitleLengthSlide[]
  too_long_count: number
  max_words: number
}

export async function fetchSlideTitleLengthChecker(docId: string): Promise<TitleLengthResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-title-length-checker`)
}

export interface TestimonialSlide {
  slide_n: number
  excerpt: string
}

export interface TestimonialResult {
  testimonials: TestimonialSlide[]
  count: number
}

export async function fetchTestimonialSlideFinder(docId: string): Promise<TestimonialResult> {
  return apiFetch(`${BASE}/docs/${docId}/testimonial-slide-finder`)
}

export interface SentimentSlide {
  slide_n: number
  sentiment: "positive" | "neutral" | "negative"
  score: number
}

export interface SentimentTrendResult {
  per_slide: SentimentSlide[]
  arc_summary: string
  trend: "rising" | "falling" | "flat" | "mixed"
}

export async function fetchSlideSentimentTrend(docId: string): Promise<SentimentTrendResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-sentiment-trend`, { method: "POST" })
}

export interface ColorCountSlide {
  slide_n: number
  color_count: number
  colors: string[]
}

export interface ColorCountResult {
  per_slide: ColorCountSlide[]
}

export async function fetchColorCountPerSlide(docId: string): Promise<ColorCountResult> {
  return apiFetch(`${BASE}/docs/${docId}/color-count-per-slide`)
}

// ── batch 69 ──────────────────────────────────────────────────────────────────

export interface FontSizeSlide {
  slide_n: number
  min_pt: number | null
  max_pt: number | null
  unique_sizes: number[]
  too_small: boolean
  too_varied: boolean
}

export interface FontSizeAuditResult {
  per_slide: FontSizeSlide[]
  flagged_count: number
}

export async function fetchSlideFontSizeAudit(docId: string): Promise<FontSizeAuditResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-font-size-audit`)
}

export interface PresenterNotesSummaryResult {
  summary: string
  key_points: string[]
  total_slides_with_notes: number
}

export async function fetchPresenterNotesSummarizer(docId: string): Promise<PresenterNotesSummaryResult> {
  return apiFetch(`${BASE}/docs/${docId}/presenter-notes-summarizer`, { method: "POST" })
}

export interface ImageQualityEntry {
  slide_n: number
  width_px: number
  height_px: number
  size_kb: number
  est_dpi: number
  quality: "high" | "medium" | "low"
}

export interface ImageQualityResult {
  images: ImageQualityEntry[]
  total: number
  low_quality_count: number
}

export async function fetchSlideImageQualityChecker(docId: string): Promise<ImageQualityResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-image-quality-checker`)
}

export interface FreshnessIssue {
  slide_n: number
  content: string
  concern: string
  urgency: "high" | "medium" | "low"
}

export interface ContentFreshnessResult {
  issues: FreshnessIssue[]
  overall_freshness: "fresh" | "mixed" | "stale"
}

export async function fetchContentFreshnessChecker(docId: string): Promise<ContentFreshnessResult> {
  return apiFetch(`${BASE}/docs/${docId}/content-freshness-checker`, { method: "POST" })
}

// ── batch 70 ──────────────────────────────────────────────────────────────────

export interface TocSlideEntry {
  slide_n: number
  title: string
}

export interface TocSection {
  section_title: string
  slides: TocSlideEntry[]
}

export interface TocGeneratorResult {
  sections: TocSection[]
  formatted_toc: string
}

export async function fetchSlideTocGenerator(docId: string): Promise<TocGeneratorResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-table-of-contents-generator`, { method: "POST" })
}

export interface RiskSlide {
  slide_n: number
  statements: string[]
}

export interface RiskStatementResult {
  per_slide: RiskSlide[]
  total_statements: number
}

export async function fetchRiskStatementFinder(docId: string): Promise<RiskStatementResult> {
  return apiFetch(`${BASE}/docs/${docId}/risk-statement-finder`)
}

export interface VisualMetaphorEntry {
  slide_n: number
  metaphor: string
  represents: string
  effectiveness: "strong" | "moderate" | "weak"
}

export interface VisualMetaphorResult {
  metaphors: VisualMetaphorEntry[]
}

export async function fetchVisualMetaphorChecker(docId: string): Promise<VisualMetaphorResult> {
  return apiFetch(`${BASE}/docs/${docId}/visual-metaphor-checker`, { method: "POST" })
}

export interface ActionItem {
  slide_n: number
  action: string
}

export interface ActionPlanResult {
  actions: ActionItem[]
  total: number
}

export async function fetchSlideActionPlanExtractor(docId: string): Promise<ActionPlanResult> {
  return apiFetch(`${BASE}/docs/${docId}/slide-action-plan-extractor`)
}
