// API client for Template Sets — the new richer surface that bundles
// slide+element templates, brand palette/fonts, instructions, and reference
// docs into a single org- or team-scoped package. Backend lives in
// app/backend/template_sets_api.py.

export interface PaletteColor {
  hex: string
  name?: string
  role?: string         // 'primary' | 'accent' | 'neutral' | free-form
  count?: number        // when extracted from refs, frequency
}

export interface BrandFont {
  name: string
  role?: string         // 'heading' | 'body' | 'mono' | 'alt'
  fallbacks?: string[]
  count?: number
}

export interface StyleRules {
  max_title_length?: number
  capitalization?: "preserve" | "title" | "sentence" | "upper"
  number_format?: string
  forbidden_colors?: string[]
  forbidden_fonts?: string[]
  palette_tolerance?: number       // 0..1 — distance allowed from palette
  lock_to_palette?: boolean
  [key: string]: unknown
}

export interface TemplateSet {
  id: string
  org_id: string
  scope: "user" | "team" | "org"
  owner_id: string
  name: string
  description: string | null
  // Auto-extracted stats (proposed_palette, proposed_fonts, etc.)
  brand: Record<string, unknown>
  source_project_ids: string[]
  last_extracted_at: number | null
  // Curated fields edited via the Brand tab.
  instructions_md: string
  palette: PaletteColor[]
  fonts: BrandFont[]
  style_rules: StyleRules
  folder_id: string | null
  is_default: boolean
  // Convenience counts populated by the list endpoint.
  items_count?: number
  slide_items_count?: number
  element_items_count?: number
  refs_count?: number
  created_at: number
  updated_at: number
}

export interface TemplateSetItem {
  set_id: string
  template_id: string
  kind: "slide" | "element"
  order_index: number
  provenance: Record<string, unknown>
  added_by: string | null
  added_at: number
  // Hydrated by the items list endpoint.
  template?: {
    id: string
    name: string
    description?: string
    category?: string
    tags?: string[]
    inputs_schema?: Record<string, unknown>
    layout?: Array<Record<string, unknown>>
    is_builtin?: boolean
  }
}

export interface TemplateSetRef {
  id: string
  set_id: string
  filename: string
  mime_type: string | null
  size_bytes: number
  storage_key: string
  doc_id: string | null
  slide_count: number
  element_count: number
  status: "uploaded" | "onboarding" | "ready" | "failed"
  error: string | null
  uploaded_by: string
  uploaded_at: number
  onboarded_at: number | null
}

export interface MinedCandidate {
  kind: "slide" | "element"
  name: string
  description: string
  tags: string[]
  layout: Array<Record<string, unknown>>
  inputs_schema: Record<string, { type: string; required: boolean; default: unknown; description: string }>
  sample_inputs: Record<string, unknown>
  provenance: {
    fingerprint?: string
    member_count?: number
    members?: Array<Record<string, unknown>>
  }
  confidence: number
}

export interface ActiveSetResponse {
  set: TemplateSet | null
  inherited_from: "project_folder" | "org_default" | "none" | string  // 'parent_folder:<id>'
  org_id: string
}

async function jfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Set CRUD ────────────────────────────────────────────────────────────────

export async function listOrgTemplateSets(orgId: string): Promise<{ template_sets: TemplateSet[] }> {
  return jfetch(`/api/orgs/${orgId}/template-sets`)
}

export async function createTemplateSet(req: {
  org_id: string
  name: string
  description?: string
  scope?: "user" | "team" | "org"
  folder_id?: string | null
  is_default?: boolean
  instructions_md?: string
  palette?: PaletteColor[]
  fonts?: BrandFont[]
  style_rules?: StyleRules
}): Promise<TemplateSet> {
  return jfetch("/api/template-sets", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function getTemplateSet(setId: string): Promise<TemplateSet> {
  return jfetch(`/api/template-sets/${setId}`)
}

export async function updateTemplateSet(
  setId: string,
  patch: Partial<{
    name: string
    description: string
    instructions_md: string
    palette: PaletteColor[]
    fonts: BrandFont[]
    style_rules: StyleRules
  }>,
): Promise<TemplateSet> {
  return jfetch(`/api/template-sets/${setId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteTemplateSet(setId: string): Promise<{ ok: boolean; id: string }> {
  return jfetch(`/api/template-sets/${setId}`, { method: "DELETE" })
}

// ── Defaults / inheritance ──────────────────────────────────────────────────

export async function setAsDefault(
  setId: string,
  folderId?: string | null,
): Promise<TemplateSet> {
  return jfetch(`/api/template-sets/${setId}/set-default`, {
    method: "POST",
    body: JSON.stringify({ folder_id: folderId ?? null }),
  })
}

export async function clearOrgDefault(orgId: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/orgs/${orgId}/clear-default-template-set`, { method: "POST" })
}

export async function clearFolderOverride(folderId: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/folders/${folderId}/clear-template-set`, { method: "POST" })
}

export async function getActiveSetForProject(projectId: string): Promise<ActiveSetResponse> {
  return jfetch(`/api/projects/${projectId}/active-template-set`)
}

// ── Items ───────────────────────────────────────────────────────────────────

export async function listSetItems(setId: string, kind?: "slide" | "element"): Promise<{ items: TemplateSetItem[] }> {
  const qs = kind ? `?kind=${kind}` : ""
  return jfetch(`/api/template-sets/${setId}/items${qs}`)
}

export async function addSetItem(setId: string, req: {
  template_id: string
  kind: "slide" | "element"
  order_index?: number
  provenance?: Record<string, unknown>
}): Promise<TemplateSetItem> {
  return jfetch(`/api/template-sets/${setId}/items`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function removeSetItem(setId: string, templateId: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/template-sets/${setId}/items/${templateId}`, { method: "DELETE" })
}

export async function reorderSetItems(setId: string, templateIds: string[]): Promise<{ ok: boolean }> {
  return jfetch(`/api/template-sets/${setId}/items/reorder`, {
    method: "POST",
    body: JSON.stringify({ template_ids: templateIds }),
  })
}

// ── Reference documents ─────────────────────────────────────────────────────

export async function uploadRef(setId: string, file: File): Promise<TemplateSetRef> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`/api/template-sets/${setId}/refs`, {
    method: "POST",
    credentials: "include",
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

export async function listRefs(setId: string): Promise<{ refs: TemplateSetRef[] }> {
  return jfetch(`/api/template-sets/${setId}/refs`)
}

export async function deleteRef(setId: string, refId: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/template-sets/${setId}/refs/${refId}`, { method: "DELETE" })
}

export async function onboardRef(setId: string, refId: string): Promise<TemplateSetRef> {
  return jfetch(`/api/template-sets/${setId}/refs/${refId}/onboard`, { method: "POST" })
}

// ── Brand extraction + curation ─────────────────────────────────────────────

export async function extractBrandFromRefs(setId: string): Promise<{ ok: boolean; brand: Record<string, unknown> }> {
  return jfetch(`/api/template-sets/${setId}/extract-brand-from-refs`, { method: "POST" })
}

export async function confirmBrand(
  setId: string,
  patch: { palette?: PaletteColor[]; fonts?: BrandFont[] },
): Promise<TemplateSet> {
  return jfetch(`/api/template-sets/${setId}/confirm-brand`, {
    method: "POST",
    body: JSON.stringify(patch),
  })
}

// ── LLM induction ───────────────────────────────────────────────────────────

export async function mineTemplates(setId: string, opts: {
  ref_ids?: string[]
  include_slides?: boolean
  include_elements?: boolean
  max_candidates?: number
  use_llm?: boolean
} = {}): Promise<{
  candidates: MinedCandidate[]
  refs_used: string[]
  refs_missing: string[]
  llm_used: boolean
}> {
  return jfetch(`/api/template-sets/${setId}/mine`, {
    method: "POST",
    body: JSON.stringify({
      include_slides: opts.include_slides ?? true,
      include_elements: opts.include_elements ?? true,
      max_candidates: opts.max_candidates ?? 25,
      use_llm: opts.use_llm ?? true,
      ref_ids: opts.ref_ids ?? null,
    }),
  })
}

// ── Style profile + Python codegen ──────────────────────────────────────────

export async function extractStyles(setId: string): Promise<{ ok: boolean; style_profile: Record<string, unknown> }> {
  return jfetch(`/api/template-sets/${setId}/extract-styles`, { method: "POST" })
}

export async function getStyleProfile(setId: string): Promise<{ style_profile: Record<string, unknown> }> {
  return jfetch(`/api/template-sets/${setId}/style-profile`)
}

export async function getPythonModule(setId: string, opts: { polish?: boolean } = {}): Promise<{
  module_text: string
  polished: boolean
  item_count: number
}> {
  const qs = opts.polish ? "?polish=true" : ""
  return jfetch(`/api/template-sets/${setId}/python-module${qs}`)
}

export function pythonModuleDownloadUrl(setId: string, opts: { polish?: boolean } = {}): string {
  const qs = opts.polish ? "?polish=true" : ""
  return `/api/template-sets/${setId}/python-module/download${qs}`
}

export async function acceptCandidate(
  setId: string,
  candidate: MinedCandidate,
  opts: { category?: string; order_index?: number } = {},
): Promise<{ ok: boolean; template_id: string; set_id: string; kind: "slide" | "element" }> {
  return jfetch(`/api/template-sets/${setId}/accept-candidate`, {
    method: "POST",
    body: JSON.stringify({
      candidate,
      category: opts.category ?? "Induced",
      order_index: opts.order_index ?? 0,
    }),
  })
}
