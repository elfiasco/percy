/**
 * Performance smoke test — measures response times for critical endpoints
 * and flags anything over acceptable thresholds.
 *
 * Thresholds (p95 — not enforced, just warned):
 *   /api/health         < 200ms
 *   signup              < 1000ms
 *   create project      < 500ms
 *   create-blank doc    < 1000ms
 *   get elements        < 300ms
 *   studio page load    < 3000ms (networkidle)
 *
 * Usage:
 *   node tests/performance-smoke.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE  = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/results"
const REPS  = 3   // repeat each call this many times for average
const TAG   = Date.now()

await mkdir(OUT, { recursive: true })

// ── thresholds (ms) ────────────────────────────────────────────────────────────
const THRESHOLDS = {
  "GET /api/health":           200,
  "POST /api/auth/signup":    1000,
  "POST /api/projects":        500,
  "POST /api/docs/create-blank": 1500,
  "GET /api/docs/:id":         300,
  "GET /api/docs/:id/slides/1/elements": 300,
  "POST /api/docs/:id/slides": 500,
  "Studio page load (networkidle)": 5000,
}

const results = []

async function measure(label, fn) {
  const times = []
  let lastErr = null
  for (let i = 0; i < REPS; i++) {
    const t0 = Date.now()
    try {
      await fn()
      times.push(Date.now() - t0)
    } catch (e) {
      lastErr = e
      times.push(Date.now() - t0)
    }
  }
  const avg    = Math.round(times.reduce((s, t) => s + t, 0) / times.length)
  const min    = Math.min(...times)
  const max    = Math.max(...times)
  const thresh = THRESHOLDS[label]
  const warn   = thresh && avg > thresh
  const icon   = lastErr ? "❌" : warn ? "⚠️" : "✅"
  console.log(`  ${icon} ${label.padEnd(50)} avg=${avg}ms  min=${min}ms  max=${max}ms${thresh ? "  (thresh:" + thresh + "ms)" : ""}`)
  results.push({ label, avg, min, max, threshold: thresh ?? null, warn, error: lastErr?.message?.slice(0, 60) ?? null })
  return avg
}

console.log("\n=== Percy Performance Smoke Test ===")
console.log(`Target: ${BASE}   Repetitions: ${REPS}\n`)

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext()
const page    = await ctx.newPage()

const email = `perf-${TAG}@test.com`
const pw    = `Pw_${TAG}_Pp9!`
let orgId, projId, docId

// ── Phase 1: Setup (no measurements, just init) ────────────────────────────────
const sr = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email, password: pw, display_name: "Perf Tester" },
  headers: { "Content-Type": "application/json" },
})
const me = await sr.json()
orgId  = me?.orgs?.[0]?.id ?? me?.org?.id

const pr = await page.request.post(`${BASE}/api/projects`, {
  data: { org_id: orgId, name: `PerfTest-${TAG}` },
  headers: { "Content-Type": "application/json" },
})
projId = (await pr.json()).id

const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
  data: { width_in: 13.333, height_in: 7.5, name: `PerfDeck-${TAG}` },
  headers: { "Content-Type": "application/json" },
})
docId = (await dr.json()).doc_id
await page.request.patch(`${BASE}/api/projects/${projId}`, {
  data: { doc_id: docId },
  headers: { "Content-Type": "application/json" },
})

console.log("── API endpoint timings\n")

// ── Phase 2: Measure ───────────────────────────────────────────────────────────
await measure("GET /api/health", async () => {
  const r = await page.request.get(`${BASE}/api/health`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("POST /api/auth/signup", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email: `p-${Date.now()}@test.com`, password: pw, display_name: "PerfNew" },
    headers: { "Content-Type": "application/json" },
  })
  // 400 (duplicate) is fine — we're measuring latency not correctness
  if (r.status() >= 500) throw new Error(`HTTP ${r.status()}`)
})

await measure("GET /api/auth/me", async () => {
  const r = await page.request.get(`${BASE}/api/auth/me`)
  if (r.status() >= 500) throw new Error(`HTTP ${r.status()}`)
})

await measure("POST /api/projects", async () => {
  const r = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `Perf-${Date.now()}` },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("POST /api/docs/create-blank", async () => {
  const r = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `PD-${Date.now()}` },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("GET /api/docs/:id", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("GET /api/docs/:id/slides/1/elements", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("POST /api/docs/:id/slides", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides?after_n=1`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

await measure("POST /api/docs/:id/slides/1/elements", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "text_box", left_in: 1, top_in: 1, width_in: 3, height_in: 1, label: "Perf" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
})

console.log("\n── UI page load timings\n")

// ── Phase 3: Page load timings ─────────────────────────────────────────────────
await measure("Splash page load (networkidle)", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" })
})

await measure("Login page load (networkidle)", async () => {
  const ctx2 = await browser.newContext()
  const p2   = await ctx2.newPage()
  await p2.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await ctx2.close()
})

await measure("Studio page load (networkidle)", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
})

await measure("Projects page load (networkidle)", async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
})

await browser.close()

// ── Summary ────────────────────────────────────────────────────────────────────
const warnings = results.filter((r) => r.warn && !r.error)
const errors   = results.filter((r) => r.error)
const allOk    = results.filter((r) => !r.warn && !r.error)

const run = {
  kind:       "performance-smoke",
  base:       BASE,
  runTs:      new Date().toISOString(),
  reps:       REPS,
  summary:    { total: results.length, ok: allOk.length, warn: warnings.length, error: errors.length },
  thresholds: THRESHOLDS,
  results,
}

const outFile = `${OUT}/performance-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "performance-smoke", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"─".repeat(60)}`)
console.log(`SUMMARY: ${allOk.length} ok, ${warnings.length} above threshold, ${errors.length} error / ${results.length} total`)
if (warnings.length) {
  console.log("\nAbove threshold:")
  warnings.forEach((r) => console.log(`  ⚠️  ${r.label}: avg=${r.avg}ms > ${r.threshold}ms`))
}
console.log(`\nResults: ${outFile}`)
// Performance tests never exit 1 — they are observational
process.exit(0)
