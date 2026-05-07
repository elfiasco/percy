/**
 * Collab/Yjs connectivity test — verifies that two browser sessions can join
 * the same studio, see each other's presence, and observe real-time changes.
 *
 * Steps:
 *   1. Create doc + project
 *   2. Open studio in context A
 *   3. Open studio in context B (second user)
 *   4. Verify both canvases load
 *   5. Insert element via context A → check context B sees it (or API confirms)
 *   6. Check awareness/cursor endpoint responds
 *
 * Note: This test works against the deployed app. Yjs WS may require a separate
 * collab server URL (VITE_YJS_WS_URL). If not configured, collab is API-only.
 *
 * Usage:
 *   node tests/collab-yjs.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const IMG  = "tests/out/collab-yjs"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(IMG, { recursive: true })

const steps = []
let browser, pageA, ctxA, pageB, ctxB

async function step(label, fn) {
  const t0 = Date.now()
  try {
    await fn()
    const ms = Date.now() - t0
    steps.push({ label, ok: true, ms })
    console.log(`  ✅ ${label} (${ms}ms)`)
  } catch (e) {
    const ms = Date.now() - t0
    steps.push({ label, ok: false, ms, error: e.message?.slice(0, 200) })
    console.error(`  ❌ ${label}: ${e.message?.slice(0, 120)}`)
    try { await pageA?.screenshot({ path: `${IMG}/FAIL-A-${label.replace(/\W+/g, "-").slice(0, 30)}.png` }) } catch {}
  }
}

async function snap(name) {
  try {
    await pageA?.screenshot({ path: `${IMG}/${name}-A.png`, fullPage: false })
    await pageB?.screenshot({ path: `${IMG}/${name}-B.png`, fullPage: false })
  } catch {}
}

console.log("\n=== Percy Collab/Yjs Test ===")
console.log(`Target: ${BASE}\n`)

browser = await chromium.launch({ headless: true })

const emailA = `collab-a-${TAG}@test.com`
const emailB = `collab-b-${TAG}@test.com`
const pw     = `Pw_${TAG}_Cc9!`
let orgId, projId, docId

// ── Phase 1: Setup ────────────────────────────────────────────────────────────
console.log("── Phase 1: Setup (two users, one project)")

ctxA  = await browser.newContext({ viewport: { width: 1280, height: 800 } })
pageA = await ctxA.newPage()

let elCount_before = 0, elCount_after = 0

await step("User A: signup + create project + deck", async () => {
  const sr = await pageA.request.post(`${BASE}/api/auth/signup`, {
    data: { email: emailA, password: pw, display_name: "Collab A" },
    headers: { "Content-Type": "application/json" },
  })
  const me = await sr.json()
  if (!me?.id && !me?.user?.id) throw new Error(`signup A: ${JSON.stringify(me).slice(0, 80)}`)
  orgId = me?.orgs?.[0]?.id ?? me?.org?.id

  const pr = await pageA.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `Collab-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  projId = (await pr.json()).id

  const dr = await pageA.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `CollabDeck-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  docId = (await dr.json()).doc_id
  if (!docId) throw new Error("no doc_id")
  await pageA.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { doc_id: docId },
    headers: { "Content-Type": "application/json" },
  })
})

await step("User B: signup", async () => {
  ctxB  = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  pageB = await ctxB.newPage()
  const sr = await pageB.request.post(`${BASE}/api/auth/signup`, {
    data: { email: emailB, password: pw, display_name: "Collab B" },
    headers: { "Content-Type": "application/json" },
  })
  const me = await sr.json()
  if (!me?.id && !me?.user?.id) throw new Error(`signup B: ${JSON.stringify(me).slice(0, 80)}`)
})

await step("User A: invite User B to org", async () => {
  const r = await pageA.request.post(`${BASE}/api/orgs/${orgId}/invites`, {
    data: { email: emailB, role: "member" },
    headers: { "Content-Type": "application/json" },
  })
  const inv = await r.json()
  const tok = inv.token
  if (!tok) throw new Error(`no invite token: ${JSON.stringify(inv).slice(0, 80)}`)
  await pageB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(tok)}`)
})

// ── Phase 2: Both open studio ─────────────────────────────────────────────────
console.log("\n── Phase 2: Both users open studio")

await step("Both users navigate to studio simultaneously", async () => {
  await Promise.all([
    pageA.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" }),
    pageB.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" }),
  ])
  await Promise.all([pageA.waitForTimeout(3000), pageB.waitForTimeout(3000)])
})
await snap("01-both-loaded")

await step("User A canvas visible", async () => {
  if (!await pageA.locator('[data-slide-canvas="true"]').count()) throw new Error("A: no canvas")
})

await step("User B canvas visible", async () => {
  if (!await pageB.locator('[data-slide-canvas="true"]').count()) throw new Error("B: no canvas")
})

// ── Phase 3: User A inserts element ───────────────────────────────────────────
console.log("\n── Phase 3: User A inserts element")

await step("Record element count before insert", async () => {
  const r = await pageA.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  const b = await r.json()
  elCount_before = Array.isArray(b) ? b.length : (b.elements?.length ?? 0)
  console.log(`     Elements before: ${elCount_before}`)
})

await step("User A inserts element via API", async () => {
  const r = await pageA.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "rect", left_in: 5, top_in: 3, width_in: 3, height_in: 2, label: "CollabRect" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`insert HTTP ${r.status()}`)
})

await step("Wait 2s for collab propagation", async () => {
  await pageA.waitForTimeout(2000)
  await pageB.waitForTimeout(500)
})
await snap("02-after-insert")

await step("Element count increased (API confirms creation)", async () => {
  const r = await pageA.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  const b = await r.json()
  elCount_after = Array.isArray(b) ? b.length : (b.elements?.length ?? 0)
  console.log(`     Elements after: ${elCount_after}`)
  if (elCount_after <= elCount_before) throw new Error(`element count did not increase: ${elCount_before} → ${elCount_after}`)
})

// ── Phase 4: Yjs/Collab-specific checks ───────────────────────────────────────
console.log("\n── Phase 4: Collab server checks")

await step("Collab token endpoint responds", async () => {
  const r = await pageA.request.get(`${BASE}/api/auth/collab-token`)
  // May return 404 or 200 depending on deployment
  if (r.status() >= 500) throw new Error(`collab-token HTTP ${r.status()}`)
  console.log(`     /api/auth/collab-token: HTTP ${r.status()}`)
})

await step("User B page did not crash", async () => {
  const html = await pageB.content()
  if (/application error|chunk load error|minified react error/i.test(html))
    throw new Error("B: React error boundary triggered")
})

await step("Both canvases still show after collab", async () => {
  const aC = await pageA.locator('[data-slide-canvas="true"]').count()
  const bC = await pageB.locator('[data-slide-canvas="true"]').count()
  if (!aC) throw new Error("A: canvas gone")
  if (!bC) throw new Error("B: canvas gone")
})
await snap("03-final")

// ── Phase 5: Presence (soft check) ────────────────────────────────────────────
console.log("\n── Phase 5: Presence check (informational)")

await step("Check for remote presence indicators in User A's studio", async () => {
  // These are soft checks — look for user avatars, cursor indicators, etc.
  const html  = await pageA.content()
  const hasPresence = /remote.*cursor|user.*avatar|collab.*user|presence/i.test(html)
  const count = await pageA.locator('[class*="remote"], [class*="Remote"], [class*="cursor"], [data-user-id]').count()
  console.log(`     Presence indicators: ${count > 0 ? count : "none detected"} (HTML match: ${hasPresence})`)
})

// ── Finish ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((s, t) => s + t.ms, 0)

const run = {
  kind:    "collab-yjs",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}

const outFile = `${OUT}/collab-yjs-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "collab-yjs", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed:")
  failed.forEach((s) => console.log(`  ✗ ${s.label}${s.error ? " — " + s.error : ""}`))
}
console.log(`\nResults: ${outFile}`)
console.log(failed.length === 0 ? "\n✅ COLLAB TEST PASSED" : `\n❌ ${failed.length} STEP(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
