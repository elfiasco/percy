/**
 * Percy Cloud control-plane API client.
 * Connects to /api/cloud/* — served by the FastAPI cloud backend.
 */

const BASE = "/api/cloud"

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export interface CloudOrg {
  id: string
  name: string
  slug: string
}

export interface CloudProject {
  id: string
  org_id: string
  name: string
}

export interface CloudDocument {
  id: string
  project_id: string
  name: string
  status: "pending_upload" | "uploaded" | "processing" | "ready" | "error"
  source_format: string
  size_bytes: number | null
  bundle_uri: string | null
  created_at: string
}

export interface CloudJob {
  id: string
  document_id: string
  job_type: string
  status: "queued" | "running" | "completed" | "failed"
  error: string | null
  result: Record<string, unknown>
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export async function listOrgs(): Promise<CloudOrg[]> {
  return req<CloudOrg[]>("/orgs")
}

export async function listProjects(orgId: string): Promise<CloudProject[]> {
  const summary = await req<{ projects: CloudProject[] }>(`/orgs/${orgId}`)
  return summary.projects
}

export async function listDocuments(projectId: string): Promise<CloudDocument[]> {
  return req<CloudDocument[]>(`/projects/${projectId}/documents`)
}

export async function listJobs(projectId: string): Promise<CloudJob[]> {
  return req<CloudJob[]>(`/projects/${projectId}/jobs`)
}

export async function getJob(jobId: string): Promise<CloudJob> {
  return req<CloudJob>(`/jobs/${jobId}`)
}

export async function createOrg(name: string, slug: string): Promise<CloudOrg> {
  return req<CloudOrg>("/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug, owner_user_id: "studio-user" }),
  })
}

export async function createProject(orgId: string, name: string): Promise<CloudProject> {
  return req<CloudProject>(`/orgs/${orgId}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export interface PrepareUploadResponse {
  document: CloudDocument
  upload_url: string
}

export async function prepareUpload(
  projectId: string,
  name: string,
  sizeBytes: number,
): Promise<PrepareUploadResponse> {
  return req<PrepareUploadResponse>(`/projects/${projectId}/documents/prepare-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      source_format: name.toLowerCase().endsWith(".pdf") ? "pdf" : "pptx",
      content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size_bytes: sizeBytes,
      created_by_id: "studio-user",
    }),
  })
}

export async function createOnboardJob(documentId: string): Promise<CloudJob> {
  return req<CloudJob>(`/documents/${documentId}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_type: "onboard_document",
      requested_by_id: "studio-user",
      parameters: {},
    }),
  })
}

export async function triggerRefresh(): Promise<{ ok: boolean; dispatched: number; errors: string[] }> {
  return req<{ ok: boolean; dispatched: number; errors: string[] }>("/trigger-refresh", { method: "POST" })
}

export async function listRecentJobs(limit = 50): Promise<CloudJob[]> {
  return req<CloudJob[]>(`/jobs/recent?limit=${limit}`)
}

export async function searchDocuments(query: string, limit = 50): Promise<CloudDocument[]> {
  return req<CloudDocument[]>(`/documents/search?q=${encodeURIComponent(query)}&limit=${limit}`)
}
