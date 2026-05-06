// API client for auth + workspace endpoints. All requests use credentials:'include'
// so the HttpOnly session cookie is sent.

export interface Org {
  id: string
  name: string
  slug: string
  kind: "personal" | "team"
  domain: string | null
  role?: "owner" | "admin" | "member"
  created_at?: number
}

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  is_admin: boolean
  orgs: Org[]
}

export interface Folder {
  id: string
  org_id: string
  parent_id: string | null
  name: string
  created_by: string
  created_at: number
}

export interface Project {
  id: string
  org_id: string
  folder_id: string | null
  name: string
  doc_source: string | null
  doc_id: string | null
  created_by: string
  created_at: number
  updated_at: number
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

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<User | null> {
  try {
    return await jfetch<User>("/api/auth/me")
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("401")) return null
    throw e
  }
}

export async function signup(email: string, password: string, displayName?: string): Promise<User> {
  return jfetch<User>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  })
}

export async function login(email: string, password: string): Promise<User> {
  return jfetch<User>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export async function logout(): Promise<void> {
  await jfetch("/api/auth/logout", { method: "POST" })
}

export async function updateMe(fields: { display_name?: string; avatar_url?: string | null }): Promise<User> {
  return jfetch<User>("/api/auth/me", { method: "PATCH", body: JSON.stringify(fields) })
}

export async function changePassword(currentPassword: string | null, newPassword: string): Promise<void> {
  await jfetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export function googleSigninUrl(redirect: string = "/home"): string {
  return `/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`
}

// ── Orgs ──────────────────────────────────────────────────────────────────────

export async function listMyOrgs(): Promise<{ orgs: Org[] }> {
  return jfetch("/api/orgs")
}

export async function getOrg(orgId: string): Promise<Org> {
  return jfetch(`/api/orgs/${orgId}`)
}

export async function listOrgMembers(orgId: string): Promise<{ members: Array<{ id: string; email: string; display_name: string; avatar_url: string | null; role: string; joined_at: number }> }> {
  return jfetch(`/api/orgs/${orgId}/members`)
}

export async function updateOrg(orgId: string, fields: { name?: string }): Promise<Org> {
  return jfetch(`/api/orgs/${orgId}`, { method: "PATCH", body: JSON.stringify(fields) })
}

export async function updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
  await jfetch(`/api/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) })
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  await jfetch(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" })
}

// ── Invites ──────────────────────────────────────────────────────────────────

export interface OrgInvite {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  invited_by: string
  created_at: number
  expires_at: number
}

export async function listInvites(orgId: string): Promise<{ invites: OrgInvite[] }> {
  return jfetch(`/api/orgs/${orgId}/invites`)
}

export async function createInvite(orgId: string, email: string, role: string = "member"): Promise<OrgInvite & { accept_url: string }> {
  return jfetch(`/api/orgs/${orgId}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  })
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await jfetch(`/api/invites/${inviteId}`, { method: "DELETE" })
}

export async function acceptInvite(token: string): Promise<{ ok: boolean; org_id: string }> {
  return jfetch(`/api/invites/accept?token=${encodeURIComponent(token)}`, { method: "POST" })
}

// ── Folders ──────────────────────────────────────────────────────────────────

export async function listFolders(orgId: string): Promise<{ folders: Folder[] }> {
  return jfetch(`/api/orgs/${orgId}/folders`)
}

export async function createFolder(orgId: string, name: string, parentId: string | null = null): Promise<Folder> {
  return jfetch(`/api/orgs/${orgId}/folders`, {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parentId }),
  })
}

export async function renameFolder(folderId: string, name: string): Promise<Folder> {
  return jfetch(`/api/folders/${folderId}`, { method: "PATCH", body: JSON.stringify({ name }) })
}

export async function deleteFolder(folderId: string): Promise<void> {
  await jfetch(`/api/folders/${folderId}`, { method: "DELETE" })
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(orgId: string, opts: { folderId?: string | null; root?: boolean } = {}): Promise<{ projects: Project[] }> {
  const params = new URLSearchParams()
  if (opts.root) params.set("root", "1")
  if (opts.folderId) params.set("folder_id", opts.folderId)
  const qs = params.toString() ? `?${params}` : ""
  return jfetch(`/api/orgs/${orgId}/projects${qs}`)
}

export async function createProject(orgId: string, name: string, folderId: string | null = null): Promise<Project> {
  return jfetch(`/api/projects`, {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, name, folder_id: folderId }),
  })
}

export async function updateProject(projectId: string, fields: { name?: string; folder_id?: string | null; doc_source?: string; doc_id?: string }): Promise<Project> {
  return jfetch(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(fields) })
}

export async function deleteProject(projectId: string): Promise<void> {
  await jfetch(`/api/projects/${projectId}`, { method: "DELETE" })
}

export async function uploadProjectFile(projectId: string, file: File): Promise<{ ok: boolean; doc_source: string }> {
  const fd = new FormData()
  fd.append("file", file)
  const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: fd, credentials: "include" })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

export async function openProject(projectId: string): Promise<{ doc_id: string; project: Project }> {
  return jfetch(`/api/projects/${projectId}/open`, { method: "POST" })
}

// ── Blank document creation (for "scratch" projects) ─────────────────────────

export interface CanvasSize {
  width_in:  number
  height_in: number
}

export const CANVAS_PRESETS: { id: string; label: string; subtitle: string; size: CanvasSize }[] = [
  { id: "widescreen",  label: "Widescreen 16:9", subtitle: "13.33″ × 7.5″ — modern default",   size: { width_in: 13.333, height_in: 7.5  } },
  { id: "standard",    label: "Standard 4:3",    subtitle: "10″ × 7.5″ — legacy projector",     size: { width_in: 10,     height_in: 7.5  } },
  { id: "letter",      label: "US Letter",       subtitle: "11″ × 8.5″ — print-ready",          size: { width_in: 11,     height_in: 8.5  } },
  { id: "a4",          label: "A4 landscape",    subtitle: "11.69″ × 8.27″ — international",    size: { width_in: 11.69,  height_in: 8.27 } },
  { id: "square",      label: "Square 1:1",      subtitle: "10″ × 10″ — social",                size: { width_in: 10,     height_in: 10   } },
  { id: "portrait",    label: "Portrait",        subtitle: "7.5″ × 13.33″ — vertical decks",    size: { width_in: 7.5,    height_in: 13.333 } },
]

export async function createBlankDoc(size: CanvasSize, name?: string): Promise<{ doc_id: string; name: string; slide_count: number; width_in: number; height_in: number }> {
  return jfetch("/api/docs/create-blank", {
    method: "POST",
    body:   JSON.stringify({ width_in: size.width_in, height_in: size.height_in, name }),
  })
}

// ── Builds ────────────────────────────────────────────────────────────────────

export type BuildFormat = "pptx" | "pdf" | "png_zip" | "html" | "markdown" | "percy"
export type BuildStatus = "queued" | "running" | "success" | "failed"

export interface Build {
  id:            string
  project_id:    string
  triggered_by:  string | null
  trigger:       string
  status:        BuildStatus
  formats:       BuildFormat[]
  outputs:       Partial<Record<BuildFormat, string>>
  summary:       string | null
  error:         string | null
  started_at:    number
  finished_at:   number | null
  elapsed_ms:    number | null
}

export async function listBuilds(projectId: string): Promise<{ builds: Build[] }> {
  return jfetch(`/api/projects/${projectId}/builds`)
}

export async function getBuild(buildId: string): Promise<Build> {
  return jfetch(`/api/builds/${buildId}`)
}

export async function triggerBuild(
  projectId: string,
  formats: BuildFormat[] = ["pptx"],
  trigger: "manual" | "scheduled" = "manual",
): Promise<Build> {
  return jfetch(`/api/projects/${projectId}/builds`, {
    method: "POST",
    body: JSON.stringify({ formats, trigger }),
  })
}

export function buildFileUrl(buildId: string, format: BuildFormat): string {
  return `/api/builds/${buildId}/files/${format}`
}

export async function setProjectSchedule(
  projectId: string,
  schedule: "on_demand" | "daily" | "weekly" | "monthly" | null,
): Promise<Project> {
  return jfetch(`/api/projects/${projectId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ schedule }),
  })
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface TemplateBrand {
  colors?:        Array<{ hex: string; count: number }>
  fonts?:         Array<{ name: string; count: number }>
  chart_types?:   Array<{ type: string; count: number }>
  table_summary?: { count: number; banded_rows_pct: number; first_row_header_pct: number }
  typography?:    { avg_title_size: number | null; avg_body_size: number | null }
  docs_scanned?:  number
}

export interface Template {
  id:                 string
  org_id:             string
  scope:              "user" | "team" | "org"
  owner_id:           string
  name:               string
  description:        string | null
  brand:              TemplateBrand
  source_project_ids: string[]
  last_extracted_at:  number | null
  created_at:         number
  updated_at:         number
}

export async function listTemplates(orgId: string): Promise<{ templates: Template[] }> {
  return jfetch(`/api/orgs/${orgId}/templates`)
}

export async function createTemplate(orgId: string, body: { name: string; description?: string; scope: "user" | "team" | "org" }): Promise<Template> {
  return jfetch(`/api/orgs/${orgId}/templates`, { method: "POST", body: JSON.stringify(body) })
}

export async function getTemplate(templateId: string): Promise<Template> {
  return jfetch(`/api/templates/${templateId}`)
}

export async function updateTemplate(templateId: string, fields: { name?: string; description?: string }): Promise<Template> {
  return jfetch(`/api/templates/${templateId}`, { method: "PATCH", body: JSON.stringify(fields) })
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await jfetch(`/api/templates/${templateId}`, { method: "DELETE" })
}

export async function attachProjectToTemplate(templateId: string, projectId: string): Promise<Template> {
  return jfetch(`/api/templates/${templateId}/attach-project`, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  })
}

export async function detachProjectFromTemplate(templateId: string, projectId: string): Promise<Template> {
  return jfetch(`/api/templates/${templateId}/detach-project`, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  })
}

export async function extractTemplateBrand(templateId: string): Promise<Template> {
  return jfetch(`/api/templates/${templateId}/extract`, { method: "POST" })
}


// ── Team environments + refresh jobs ────────────────────────────────────────

export type TeamEnvStatus = "unbuilt" | "building" | "ready" | "failed"

export interface TeamEnv {
  id: string
  org_id: string
  name: string
  requirements: string
  env_vars: Record<string, string>
  package_index_url?: string | null
  package_index_user?: string | null
  package_index_token_set?: boolean
  venv_path?: string | null
  status: TeamEnvStatus
  last_build_log?: string | null
  last_built_at?: number | null
  created_at: number
  updated_at: number
}

export async function listTeamEnvs(orgId: string): Promise<{ envs: TeamEnv[] }> {
  return jfetch(`/api/orgs/${orgId}/team-envs`)
}

export async function createTeamEnv(orgId: string, name: string): Promise<TeamEnv> {
  return jfetch(`/api/team-envs`, { method: "POST", body: JSON.stringify({ org_id: orgId, name }) })
}

export async function getTeamEnv(envId: string): Promise<TeamEnv> {
  return jfetch(`/api/team-envs/${envId}`)
}

export async function updateTeamEnv(envId: string, fields: Partial<TeamEnv> & { package_index_token?: string }): Promise<TeamEnv> {
  return jfetch(`/api/team-envs/${envId}`, { method: "PATCH", body: JSON.stringify(fields) })
}

export async function deleteTeamEnv(envId: string): Promise<void> {
  await jfetch(`/api/team-envs/${envId}`, { method: "DELETE" })
}

export async function buildTeamEnv(envId: string): Promise<TeamEnv> {
  return jfetch(`/api/team-envs/${envId}/build`, { method: "POST" })
}


export type RefreshSchedule = "on_demand" | "hourly" | "daily" | "weekly" | "monthly"

export interface RefreshJob {
  id: string
  project_id: string
  env_id: string | null
  schedule: RefreshSchedule
  entry_point: string
  script_source: string
  extra_env: Record<string, string>
  enabled: boolean
  last_run_at: number | null
  next_run_at: number | null
  last_status: "success" | "failed" | null
  last_error: string | null
  created_at: number
  updated_at: number
}

export interface RefreshRun {
  id: string
  job_id: string
  project_id: string
  started_at: number
  finished_at: number | null
  status: "running" | "success" | "failed"
  log: string | null
  build_id: string | null
}

export async function getProjectRefreshJob(projectId: string): Promise<{ job: RefreshJob | null }> {
  return jfetch(`/api/projects/${projectId}/refresh-job`)
}

export async function createRefreshJob(opts: {
  project_id: string
  schedule: RefreshSchedule
  env_id?: string | null
  entry_point?: string
  script_source?: string
  extra_env?: Record<string, string>
}): Promise<RefreshJob> {
  return jfetch(`/api/refresh-jobs`, { method: "POST", body: JSON.stringify(opts) })
}

export async function updateRefreshJob(jobId: string, fields: Partial<RefreshJob>): Promise<RefreshJob> {
  return jfetch(`/api/refresh-jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(fields) })
}

export async function deleteRefreshJob(jobId: string): Promise<void> {
  await jfetch(`/api/refresh-jobs/${jobId}`, { method: "DELETE" })
}

export async function runRefreshJobNow(jobId: string): Promise<{ status: string; run_id?: string; error?: string }> {
  return jfetch(`/api/refresh-jobs/${jobId}/run`, { method: "POST" })
}

export async function listProjectRefreshRuns(projectId: string): Promise<{ runs: RefreshRun[] }> {
  return jfetch(`/api/projects/${projectId}/refresh-runs`)
}
