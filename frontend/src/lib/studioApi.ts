import type { SlideElementsResponse, StudioElement, ElementTextContent, ElementStyleData, ElementStyleUpdate } from "./studioTypes"

export interface TextSearchMatch {
  slide_n: number
  element_id: string
  element_type: string
  preview: string
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
  const res = await fetch(url, init)
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

export async function updateElementPosition(
  docId: string,
  slideN: number,
  elementId: string,
  update: { left_in?: number; top_in?: number; width_in?: number; height_in?: number; z_index?: number; rotation?: number; name?: string },
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

export async function fetchThemeColors(docId: string): Promise<{ theme_colors: Record<string, string> }> {
  return apiFetch(`${BASE}/docs/${docId}/theme-colors`)
}

export async function searchText(docId: string, q: string): Promise<TextSearchMatch[]> {
  return apiFetch<TextSearchMatch[]>(`${BASE}/docs/${docId}/search-text?q=${encodeURIComponent(q)}`)
}

export async function searchElements(docId: string, q = ""): Promise<ElementSearchResult[]> {
  return apiFetch<ElementSearchResult[]>(`${BASE}/docs/${docId}/search-elements?q=${encodeURIComponent(q)}`)
}

export interface DocStats {
  slide_count: number
  total_elements: number
  type_counts: Record<string, number>
  word_count: number
}

export async function fetchDocStats(docId: string): Promise<DocStats> {
  return apiFetch<DocStats>(`${BASE}/docs/${docId}/stats`)
}

export async function replaceText(
  docId: string,
  find: string,
  replace: string,
  caseSensitive = false,
  useRegex = false,
): Promise<ReplaceTextResult> {
  return apiFetch<ReplaceTextResult>(`${BASE}/docs/${docId}/replace-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ find, replace, case_sensitive: caseSensitive, use_regex: useRegex }),
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

export async function fetchColorPalette(docId: string): Promise<{ colors: string[] }> {
  return apiFetch(`${BASE}/docs/${docId}/color-palette`)
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
