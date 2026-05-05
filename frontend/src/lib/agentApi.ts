// Agent API client — talks to the new /api/agent/* endpoints.
// See app/backend/agent_chat.py, agent_find.py, agent_templates.py,
// agent_scripts.py for the server side.

export interface AgentChatContext {
  viewing_slide_n?: number | null
  selected_element_id?: string | null
  user_confirmed?: boolean
  model?: string | null
}

export interface AgentToolCall {
  endpoint_id: string
  path_args: Record<string, unknown>
  body: Record<string, unknown>
  reason?: string | null
  confirm?: boolean
}

export interface AgentPlan {
  mode: string
  calls: AgentToolCall[]
  clarify?: string | null
  rationale?: string | null
  script?: string | null
  script_kind?: string | null
  script_args?: Record<string, unknown>
}

export interface AgentExecutionStep {
  endpoint_id: string
  path_args: Record<string, unknown>
  ok: boolean
  error?: string | null
  elapsed_ms: number
}

export interface AgentChatResponse {
  reply: string
  mode: string
  mode_method?: string
  mode_confidence?: number
  actions_taken: number
  plan: AgentPlan
  execution: {
    ok: boolean
    error?: string | null
    steps: AgentExecutionStep[]
    elapsed_ms: number
  }
  action_id: string
  snapshot_index?: number
  needs_clarification?: boolean
}

export interface AgentAction {
  id: string
  doc_id: string
  slide_n?: number
  element_id?: string
  kind: string
  mode?: string
  prompt: string
  status: string
  error?: string | null
  affected_count: number
  elapsed_ms?: number
  snapshot_index?: number
  created_at: number
  plan?: AgentPlan
  response?: { steps?: AgentExecutionStep[] }
}

export interface AgentTemplate {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  inputs_schema: Record<string, {
    type: string
    required?: boolean
    default?: unknown
    description?: string
  }>
  sample_inputs: Record<string, unknown>
  layout: Array<{ kind: string; alias?: string; body: Record<string, unknown> }>
  slide_script?: string | null
  connects: Record<string, string>
  preview_image?: string | null
  is_builtin: boolean
}

export interface AgentMaterial {
  id: string
  doc_id: string
  filename: string
  file_size: number
  file_kind: string
  storage_path: string
  secret_findings: Array<{ kind: string; line: number; excerpt: string }>
  dangerous_imports: string[]
  syntax_ok: boolean
  syntax_error?: string | null
  usable_as_reference: boolean
  usable_as_starter: boolean
  chunk_count: number
  created_at: number
  updated_at: number
}

/** Fetch with `X-Percy-Actor: agent` automatically set on every agent-side
 *  call so the backend audit log distinguishes agent-driven mutations from
 *  human-driven ones. */
const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers)
  if (!headers.has("X-Percy-Actor")) headers.set("X-Percy-Actor", "agent")
  const res = await fetch(url, { credentials: "include", ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Chat ────────────────────────────────────────────────────────────────────

export const agentChat = (
  docId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  context: AgentChatContext = {},
): Promise<AgentChatResponse> =>
  fetchJson<AgentChatResponse>("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, messages, context }),
  })

// ── Activity / actions ──────────────────────────────────────────────────────

export const listActions = (
  docId: string,
  limit = 50,
): Promise<{ actions: AgentAction[] }> =>
  fetchJson(`/api/agent/actions?doc_id=${encodeURIComponent(docId)}&limit=${limit}`)

export const rollbackAction = (
  actionId: string,
): Promise<{ ok: boolean; rolled_back_to?: number }> =>
  fetchJson(`/api/agent/actions/${encodeURIComponent(actionId)}/rollback`, {
    method: "POST",
  })

// ── Templates ───────────────────────────────────────────────────────────────

export const listTemplates = (
  category?: string,
): Promise<{ templates: AgentTemplate[] }> =>
  fetchJson(`/api/agent/templates${category ? `?category=${encodeURIComponent(category)}` : ""}`)

export const searchTemplates = (
  q: string,
  limit = 5,
): Promise<{ templates: AgentTemplate[] }> =>
  fetchJson(`/api/agent/templates/search?q=${encodeURIComponent(q)}&limit=${limit}`)

export const getTemplate = (id: string): Promise<AgentTemplate> =>
  fetchJson(`/api/agent/templates/${encodeURIComponent(id)}`)

export interface ApplyTemplateResult {
  ok: boolean
  errors?: string[]
  elements?: Array<{ alias?: string; element_id: string; kind: string; name?: string }>
  alias_to_id?: Record<string, string>
  slide_script_result?: Record<string, unknown>
  error?: string
}

export const applyTemplate = (
  templateId: string,
  docId: string,
  slideN: number,
  inputs: Record<string, unknown>,
): Promise<ApplyTemplateResult> =>
  fetchJson(`/api/agent/templates/${encodeURIComponent(templateId)}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, slide_n: slideN, inputs }),
  })

// ── Materials ───────────────────────────────────────────────────────────────

export const listMaterials = (
  docId: string,
): Promise<{ materials: AgentMaterial[] }> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/materials`)

export const uploadMaterial = async (
  docId: string,
  file: File,
): Promise<{
  ok: boolean
  hard_rejected?: boolean
  material_id?: string
  filename?: string
  security?: { findings: Array<{ kind: string; line: number; excerpt: string }>; dangerous_imports: string[] }
  chunk_count?: number
  message?: string
}> => {
  const fd = new FormData()
  fd.append("file", file)
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/materials`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Percy-Actor": "human" },  // user uploaded, not the agent
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

export const setStarterFlag = (
  docId: string,
  materialId: string,
  value: boolean,
): Promise<{ ok: boolean }> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/materials/${encodeURIComponent(materialId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usable_as_starter: value }),
  })

export const deleteMaterial = (
  docId: string,
  materialId: string,
): Promise<{ ok: boolean }> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/materials/${encodeURIComponent(materialId)}`, {
    method: "DELETE",
  })

// ── Insights / Phase 5 ──────────────────────────────────────────────────────

export interface BrandViolation {
  slide_n: number
  element_id: string | null
  element_type: string | null
  kind: string
  severity: string
  detail: string
  found?: string | null
  expected: string[]
  suggested_fix?: { endpoint_id: string; path_args: Record<string, unknown>; body: Record<string, unknown> } | null
}

export interface BrandReport {
  profile: string
  summary: {
    violation_count: number
    by_severity: Record<string, number>
    by_kind: Record<string, number>
    palette_seen: string[]
    fonts_seen: string[]
  }
  violations: BrandViolation[]
}

export const runBrandCheck = (
  docId: string,
  profile?: { palette_hex?: string[]; fonts?: string[]; forbidden_colors?: string[]; forbidden_fonts?: string[] },
): Promise<BrandReport> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/brand-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile ? { profile } : {}),
  })

export interface AgentSuggestion {
  kind: string
  severity: string
  title: string
  detail: string
  slide_n: number | null
  element_id: string | null
  auto_fix: { endpoint_id: string; path_args: Record<string, unknown>; body: Record<string, unknown> } | null
}

export const getSuggestions = (
  docId: string,
): Promise<{ count: number; by_severity: Record<string, number>; suggestions: AgentSuggestion[] }> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/suggestions`)

export interface RefreshOutcome {
  kind: string
  slide_n: number
  element_id: string | null
  name: string
  ok: boolean
  elapsed_s: number
  error?: string | null
  applied: boolean
  apply_reason?: string | null
  output_summary?: string | null
}

export interface RefreshReport {
  doc_id: string
  n_scripts: number
  n_ok: number
  n_failed: number
  n_applied: number
  total_elapsed_s: number
  diff_summary: string
  diff_long: string
  outcomes: RefreshOutcome[]
}

export const runRefresh = (
  docId: string,
  applyOutputs = true,
): Promise<RefreshReport> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apply_outputs: applyOutputs }),
  })

export const generateDeck = (
  docId: string,
  prompt: string,
): Promise<{ ok: boolean; plan: { title: string; rationale: string; slides: Array<{ slide_n: number; template_name: string; template_id: string }> }; applied: Array<{ slide_n: number; template_name: string; ok: boolean; elements: number }>; errors: string[] }> =>
  fetchJson(`/api/agent/generate-deck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, prompt }),
  })


// ── Save-as-template ────────────────────────────────────────────────────────

export const saveSlideAsTemplate = (
  docId: string,
  slideN: number,
  body: { name: string; description?: string; tags?: string[]; category?: string },
): Promise<{ ok: boolean; id: string; name: string; elements: number; connects: number }> =>
  fetchJson(`/api/docs/${encodeURIComponent(docId)}/slides/${slideN}/save-as-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
