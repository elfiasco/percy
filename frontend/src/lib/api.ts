import type {
  WorkspaceFile, DocInfo, Diagnostic, OnboardResult, RebuildResult, Grade,
  DocSummary, HistoryDoc, VisionGradeResult, TableauDoc,
} from "./types"
import { log } from "./logger"

const BASE = "/api"

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const label = typeof input === "string" ? input : String(input)
  log("info", `→ ${init?.method ?? "GET"} ${label}`)
  const t0 = performance.now()
  const res = await fetch(input, init)
  const ms  = Math.round(performance.now() - t0)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    log("error", `✗ ${label}  ${res.status} (${ms}ms)`, text)
    throw new Error(`${res.status} ${text}`)
  }
  const data = await res.json() as T
  log("success", `✓ ${label}  (${ms}ms)`, data)
  return data
}

export async function fetchWorkspace(): Promise<WorkspaceFile[]> {
  const data = await json<{ files: WorkspaceFile[] }>(`${BASE}/workspace`)
  return data.files
}

export async function onboardDoc(path: string): Promise<OnboardResult> {
  log("info", `onboard: ${path.split(/[\\/]/).pop()}`)
  return json<OnboardResult>(`${BASE}/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })
}

export async function fetchDocs(): Promise<DocInfo[]> {
  return json<DocInfo[]>(`${BASE}/docs`)
}

export async function fetchDoc(docId: string): Promise<DocInfo> {
  return json<DocInfo>(`${BASE}/docs/${docId}`)
}

export async function rebuildDoc(docId: string): Promise<RebuildResult> {
  log("info", `rebuild: doc_id=${docId}`)
  return json<RebuildResult>(`${BASE}/docs/${docId}/rebuild`, { method: "POST" })
}

export async function fetchRenderStatus(docId: string): Promise<{
  has_originals: boolean; has_bridge: boolean; has_rebuild: boolean; has_rebuilt_renders: boolean
  pixel_scores?: Record<string, number>
}> {
  const res = await fetch(`${BASE}/docs/${docId}/render-status`)
  if (res.status === 404) {
    const err = new Error("404") as Error & { is404: boolean }
    err.is404 = true
    throw err
  }
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function fetchHistory(): Promise<HistoryDoc[]> {
  const data = await json<{ docs: HistoryDoc[] }>(`${BASE}/history`)
  return data.docs
}

export async function fetchSummary(docId: string): Promise<DocSummary> {
  return json<DocSummary>(`${BASE}/docs/${docId}/summary`)
}

export async function fetchTableauDoc(docId: string): Promise<TableauDoc> {
  return json<TableauDoc>(`${BASE}/docs/${docId}/tableau`)
}

export async function captureTableauNativeScreenshot(docId: string): Promise<Record<string, unknown>> {
  log("info", `capture native Tableau screenshot: doc_id=${docId}`)
  return json<Record<string, unknown>>(`${BASE}/docs/${docId}/tableau/native-screenshot`, { method: "POST" })
}

export async function captureTableauArtifact(docId: string, artifactN: number): Promise<Record<string, unknown>> {
  log("info", `capture Tableau artifact ${artifactN}: doc_id=${docId}`)
  return json<Record<string, unknown>>(
    `${BASE}/docs/${docId}/tableau/artifacts/${artifactN}/capture`,
    { method: "POST" },
  )
}

export async function captureAllTableauSheets(
  docId: string, renderWait?: number,
): Promise<{ captured: number; total: number; results: Array<Record<string, unknown>> }> {
  log("info", `capture all Tableau sheets: doc_id=${docId}`)
  const params = renderWait != null ? `?render_wait=${renderWait}` : ""
  return json(`${BASE}/docs/${docId}/tableau/capture-all${params}`, { method: "POST" })
}

export async function smartCaptureAllTableauSheets(
  docId: string,
  opts?: { maxRenderWait?: number; useVision?: boolean; maxRetries?: number },
): Promise<{ captured: number; total: number; results: Array<Record<string, unknown>> }> {
  log("info", `smart capture all Tableau sheets: doc_id=${docId}`)
  const p = new URLSearchParams()
  if (opts?.maxRenderWait != null) p.set("max_render_wait", String(opts.maxRenderWait))
  if (opts?.useVision != null)     p.set("use_vision", String(opts.useVision))
  if (opts?.maxRetries != null)    p.set("max_retries", String(opts.maxRetries))
  const qs = p.toString() ? `?${p}` : ""
  return json(`${BASE}/docs/${docId}/tableau/smart-capture-all${qs}`, { method: "POST" })
}

export async function rerenderBridge(docId: string): Promise<{ bridge_slides: number }> {
  log("info", `rerender bridge: doc_id=${docId}`)
  return json<{ bridge_slides: number }>(`${BASE}/docs/${docId}/rerender`, { method: "POST" })
}

export async function fetchDiagnostics(docId: string): Promise<Diagnostic[]> {
  const data = await json<{ diagnostics: Diagnostic[] }>(
    `${BASE}/docs/${docId}/diagnostics`,
  )
  return data.diagnostics
}

export async function setGrade(docId: string, slideN: number, grade: Grade): Promise<void> {
  log("info", `grade: slide ${slideN} → ${grade}`)
  await json(`${BASE}/docs/${docId}/grades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_n: slideN, grade }),
  })
}

export async function fetchGrades(docId: string): Promise<Record<number, Grade>> {
  const data = await json<{ grades: Record<number, Grade> }>(
    `${BASE}/docs/${docId}/grades`,
  )
  return data.grades
}

export async function visionGradeSlide(
  docId: string, slideN: number, target: "bridge" | "rebuilt",
): Promise<VisionGradeResult> {
  return json<VisionGradeResult>(`${BASE}/docs/${docId}/slides/${slideN}/vision-grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  })
}

export const slideUrl = {
  bridge:   (docId: string, n: number) => `${BASE}/docs/${docId}/slides/${n}/bridge.png`,
  original: (docId: string, n: number) => `${BASE}/docs/${docId}/slides/${n}/original.png`,
  rebuilt:  (docId: string, n: number) => `${BASE}/docs/${docId}/slides/${n}/rebuilt.png`,
  tableauImage: (docId: string, imageIndex: number) => `${BASE}/docs/${docId}/tableau/images/${imageIndex}`,
  tableauNative: (docId: string) => `${BASE}/docs/${docId}/tableau/native-screenshot.png`,
  tableauArtifactCapture: (docId: string, artifactN: number) => `${BASE}/docs/${docId}/tableau/artifacts/${artifactN}/capture.png`,
}
