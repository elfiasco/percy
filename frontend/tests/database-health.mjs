/**
 * Database health check — pings every major API endpoint and verifies
 * the database layer is responding correctly. No browser UI needed.
 *
 * Covers:
 *   - Auth (signup, login, me, settings, logout)
 *   - Projects CRUD
 *   - Docs CRUD (create, read, update)
 *   - Slides CRUD (add, background, notes, delete)
 *   - Elements CRUD (create, read, update, delete)
 *   - Agent API manifest
 *   - Admin/audit endpoint
 *   - Sharing API
 *   - Health endpoint
 *
 * Usage:
 *   node tests/database-health.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })

// ── helpers ────────────────────────────────────────────────────────────────────

const checks = []

function chk(label, status, body, expected2xx = true) {
  const ok = expected2xx ? status >= 200 && status < 300 : status < 500
  const icon = status >= 500 ? "❌" : status >= 400 ? "⚠️" : "✅"
  console.log(`  ${icon} [${String(status).padEnd(3)}] ${label}`)
  checks.push({ label, status, ok, bodyPreview: JSON.stringify(body).slice(0, 80) })
  return ok
}

// ── run ────────────────────────────────────────────────────────────────────────

console.log("\n=== Percy Database Health Check ===")
console.log(`Target: ${BASE}\n`)

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext()
const page    = await ctx.newPage()

const email = `dbh-${TAG}@test.com`
const pw    = `Pw_${TAG}_Hh9!`
let userId, orgId, projId, docId, elId

// ── 1. Health ──────────────────────────────────────────────────────────────────
console.log("── 1. Health")
{
  const r = await page.request.get(`${BASE}/api/health`)
  const b = r.ok() ? await r.json().catch(() => ({})) : {}
  chk("GET /api/health", r.status(), b)
}

// ── 2. Auth — Signup ──────────────────────────────────────────────────────────
console.log("\n── 2. Auth")
{
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "DB Health Tester" },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  const ok = chk("POST /api/auth/signup", r.status(), b)
  if (ok) {
    userId = b?.id ?? b?.user?.id
    orgId  = b?.orgs?.[0]?.id ?? b?.org?.id
  }
}

{
  const r = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: pw },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  chk("POST /api/auth/login", r.status(), b)
}

{
  const r = await page.request.get(`${BASE}/api/auth/me`)
  const b = await r.json().catch(() => ({}))
  chk("GET /api/auth/me", r.status(), b)
}

{
  const r = await page.request.patch(`${BASE}/api/auth/settings`, {
    data: { display_name: "DB Health Tester v2" },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  chk("PATCH /api/auth/settings", r.status(), b)
}

{
  const r = await page.request.post(`${BASE}/api/auth/forgot-password`, {
    data: { email },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  chk("POST /api/auth/forgot-password (graceful)", r.status(), b, false) // 4xx OK (email not configured)
}

// ── 3. Projects ───────────────────────────────────────────────────────────────
console.log("\n── 3. Projects")

if (orgId) {
  {
    const r = await page.request.post(`${BASE}/api/projects`, {
      data: { org_id: orgId, name: `DBH-${TAG}` },
      headers: { "Content-Type": "application/json" },
    })
    const b = await r.json().catch(() => ({}))
    const ok = chk("POST /api/projects", r.status(), b)
    if (ok) projId = b?.id
  }

  {
    const r = await page.request.get(`${BASE}/api/projects`)
    const b = await r.json().catch(() => ({}))
    chk("GET /api/projects", r.status(), b)
  }

  if (projId) {
    {
      const r = await page.request.get(`${BASE}/api/projects/${projId}`)
      const b = await r.json().catch(() => ({}))
      chk(`GET /api/projects/:id`, r.status(), b)
    }
    {
      const r = await page.request.patch(`${BASE}/api/projects/${projId}`, {
        data: { name: `DBH-Renamed-${TAG}` },
        headers: { "Content-Type": "application/json" },
      })
      const b = await r.json().catch(() => ({}))
      chk("PATCH /api/projects/:id (rename)", r.status(), b)
    }
  }
}

// ── 4. Docs ───────────────────────────────────────────────────────────────────
console.log("\n── 4. Docs")

{
  const r = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `DBH-Doc-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  const ok = chk("POST /api/docs/create-blank", r.status(), b)
  if (ok) {
    docId = b?.doc_id
    if (projId && docId) {
      await page.request.patch(`${BASE}/api/projects/${projId}`, {
        data: { doc_id: docId },
        headers: { "Content-Type": "application/json" },
      })
    }
  }
}

if (docId) {
  {
    const r = await page.request.get(`${BASE}/api/docs/${docId}`)
    const b = await r.json().catch(() => ({}))
    chk("GET /api/docs/:id", r.status(), b)
  }
  {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
    const b = await r.json().catch(() => ({}))
    chk("GET /api/docs/:id/slides/1/elements", r.status(), b)
  }

  // ── 5. Slides ──────────────────────────────────────────────────────────────
  console.log("\n── 5. Slides")

  {
    const r = await page.request.post(`${BASE}/api/docs/${docId}/slides?after_n=1`)
    const b = await r.json().catch(() => ({}))
    chk("POST /api/docs/:id/slides (add slide 2)", r.status(), b)
  }
  {
    const r = await page.request.patch(`${BASE}/api/docs/${docId}/slides/1/background?color=%23FF5733`)
    const b = await r.json().catch(() => ({}))
    chk("PATCH /api/docs/:id/slides/1/background", r.status(), b)
  }
  {
    const r = await page.request.patch(`${BASE}/api/docs/${docId}/slides/1/notes`, {
      data: { notes_text: "DB health check notes" },
      headers: { "Content-Type": "application/json" },
    })
    const b = await r.json().catch(() => ({}))
    chk("PATCH /api/docs/:id/slides/1/notes", r.status(), b)
  }
  {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/search-text?q=health`)
    const b = await r.json().catch(() => ({}))
    chk("GET /api/docs/:id/search-text", r.status(), b)
  }
  {
    const r = await page.request.delete(`${BASE}/api/docs/${docId}/slides/2`)
    const b = await r.json().catch(() => ({}))
    chk("DELETE /api/docs/:id/slides/2", r.status(), b)
  }

  // ── 6. Elements ────────────────────────────────────────────────────────────
  console.log("\n── 6. Elements")

  {
    const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
      data: { shape_type: "text_box", left_in: 1, top_in: 1, width_in: 4, height_in: 1, label: "DBH Title" },
      headers: { "Content-Type": "application/json" },
    })
    const b = await r.json().catch(() => ({}))
    const ok = chk("POST /api/docs/:id/slides/1/elements", r.status(), b)
    if (ok) elId = b?.id ?? b?.element?.id
  }

  if (elId) {
    {
      const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}`)
      const b = await r.json().catch(() => ({}))
      chk("GET /api/docs/:id/slides/1/elements/:elId", r.status(), b)
    }
    {
      const r = await page.request.patch(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}/position`, {
        data: { left_in: 2, top_in: 2 },
        headers: { "Content-Type": "application/json" },
      })
      const b = await r.json().catch(() => ({}))
      chk("PATCH /api/docs/:id/slides/1/elements/:elId/position", r.status(), b)
    }
    {
      const r = await page.request.patch(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}/style`, {
        data: { fill_color: "#4472C4" },
        headers: { "Content-Type": "application/json" },
      })
      const b = await r.json().catch(() => ({}))
      chk("PATCH /api/docs/:id/slides/1/elements/:elId/style", r.status(), b)
    }
    {
      const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}/duplicate`)
      const b = await r.json().catch(() => ({}))
      chk("POST /api/docs/:id/slides/1/elements/:elId/duplicate", r.status(), b)
    }
    {
      const r = await page.request.delete(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}`)
      const b = await r.json().catch(() => ({}))
      chk("DELETE /api/docs/:id/slides/1/elements/:elId", r.status(), b)
    }
  }

  // ── 7. PPTX export ─────────────────────────────────────────────────────────
  console.log("\n── 7. Export")
  {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/download-pptx`)
    chk("GET /api/docs/:id/download-pptx", r.status(), { contentType: r.headers()["content-type"] }, false)
  }
}

// ── 8. Agent ──────────────────────────────────────────────────────────────────
console.log("\n── 8. Agent")

{
  const r = await page.request.get(`${BASE}/api/agent/api-manifest`)
  const b = await r.json().catch(() => ({}))
  chk("GET /api/agent/api-manifest", r.status(), b)
}

if (docId) {
  // Test agent chat with a minimal read-only query (no LLM key needed for manifest)
  const r = await page.request.post(`${BASE}/api/agent/chat`, {
    data: { doc_id: docId, messages: [{ role: "user", content: "How many slides are in this deck?" }] },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  chk("POST /api/agent/chat (requires API key — 4xx OK)", r.status(), b, false)
}

// ── 9. Admin/audit ────────────────────────────────────────────────────────────
console.log("\n── 9. Admin & audit")

{
  const r = await page.request.get(`${BASE}/api/admin/audit-events?limit=5`)
  const b = await r.json().catch(() => ({}))
  chk("GET /api/admin/audit-events (admin-only — 4xx OK)", r.status(), b, false)
}

{
  const r = await page.request.get(`${BASE}/api/admin/users`)
  const b = await r.json().catch(() => ({}))
  chk("GET /api/admin/users (may be admin-only)", r.status(), b, false)
}

// ── 10. Sharing & orgs ────────────────────────────────────────────────────────
console.log("\n── 10. Sharing & orgs")

if (orgId) {
  const r = await page.request.post(`${BASE}/api/orgs/${orgId}/invites`, {
    data: { email: `invite-${TAG}@test.com`, role: "member" },
    headers: { "Content-Type": "application/json" },
  })
  const b = await r.json().catch(() => ({}))
  chk("POST /api/orgs/:id/invites", r.status(), b)
}

if (projId) {
  const r = await page.request.get(`${BASE}/api/projects/${projId}/shares`)
  const b = await r.json().catch(() => ({}))
  chk("GET /api/projects/:id/shares (may 404)", r.status(), b, false)
}

// ── Finish ─────────────────────────────────────────────────────────────────────
await browser.close()

const failChecks = checks.filter((c) => !c.ok)
const warnChecks = checks.filter((c) => c.ok && c.status >= 400)
const passChecks = checks.filter((c) => c.ok && c.status < 400)

const run = {
  kind:    "database-health",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: checks.length, pass: passChecks.length, warn: warnChecks.length, fail: failChecks.length },
  checks,
}

const outFile = `${OUT}/database-health-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "database-health", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"─".repeat(50)}`)
console.log(`RESULTS: ${passChecks.length} pass, ${warnChecks.length} warn, ${failChecks.length} fail / ${checks.length} total`)
if (failChecks.length > 0) {
  console.log("\nFailed:")
  failChecks.forEach((c) => console.log(`  ✗ [${c.status}] ${c.label}`))
}
console.log(`\nFull results: ${outFile}`)
process.exit(failChecks.length > 0 ? 1 : 0)
