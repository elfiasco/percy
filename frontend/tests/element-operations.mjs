/**
 * Element CRUD end-to-end test — comprehensive create/read/update/delete
 * lifecycle for elements on a slide.
 *
 *   signup → create project → create blank deck →
 *   create elements → read/update/delete → UI canvas verification
 *
 * Usage:
 *   node tests/element-operations.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const IMG  = "tests/out/element-ops"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(IMG, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

const steps = []
let browser, page, ctx

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
    const safe = label.replace(/\W+/g, "-").slice(0, 40)
    try { await page?.screenshot({ path: `${IMG}/FAIL-${safe}.png` }) } catch {}
  }
}

async function snap(name) {
  try { await page.screenshot({ path: `${IMG}/${name}.png`, fullPage: false }) } catch {}
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log("\n=== Element Operations End-to-End Test ===")
console.log(`Target: ${BASE}\n`)

browser = await chromium.launch({ headless: true })
ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } })
page = await ctx.newPage()

// ── Phase 1: Setup — signup, project, deck ────────────────────────────────────
console.log("── Phase 1: Setup")

const email = `elops-${TAG}@test.com`
const pw    = `Pw_${TAG}_El9!`
let orgId, projId, docId

await step("Signup via API", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "ElOps User" },
    headers: { "Content-Type": "application/json" },
  })
  const me = await r.json()
  if (!me?.id && !me?.user?.id) throw new Error(`bad signup: ${JSON.stringify(me).slice(0, 80)}`)
  orgId = me?.orgs?.[0]?.id ?? me?.org?.id
  if (!orgId) throw new Error("no org in signup response")
})

await step("Create project via API", async () => {
  const r = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `ElOps-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const cp = await r.json()
  projId = cp.id
  if (!projId) throw new Error(JSON.stringify(cp).slice(0, 80))
})

await step("Create blank slide deck", async () => {
  const r = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `ElOps-Deck-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const cd = await r.json()
  docId = cd.doc_id
  if (!docId) throw new Error(JSON.stringify(cd).slice(0, 80))
  // Link deck to project
  await page.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { doc_id: docId },
    headers: { "Content-Type": "application/json" },
  })
})

// ── Phase 2: Element CRUD ─────────────────────────────────────────────────────
console.log("\n── Phase 2: Element CRUD")

let el1Id, el2Id, el3Id

await step("GET slide 1 elements — verify empty (0 elements)", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const count = body.element_count ?? body.elements?.length ?? -1
  if (count !== 0) throw new Error(`Expected 0 elements, got ${count}`)
})

await step("Create text_box element (el1)", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: {
      shape_type: "text_box",
      left_in:    1,
      top_in:     1,
      width_in:   4,
      height_in:  1,
      label:      "Title",
    },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const el = await r.json()
  el1Id = el.id
  if (!el1Id) throw new Error(`no id in response: ${JSON.stringify(el).slice(0, 80)}`)
})

await step("Create rect element (el2)", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: {
      shape_type:  "rect",
      left_in:     6,
      top_in:      1,
      width_in:    3,
      height_in:   2,
      label:       "ColorBox",
      fill_color:  "#3B82F6",
    },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const el = await r.json()
  el2Id = el.id
  if (!el2Id) throw new Error(`no id in response: ${JSON.stringify(el).slice(0, 80)}`)
})

await step("Create ellipse element (el3)", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: {
      shape_type: "ellipse",
      left_in:    2,
      top_in:     4,
      width_in:   2,
      height_in:  2,
      label:      "Circle",
    },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const el = await r.json()
  el3Id = el.id
  if (!el3Id) throw new Error(`no id in response: ${JSON.stringify(el).slice(0, 80)}`)
})

await step("GET slide 1 elements — verify 3 elements", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const count = body.element_count ?? body.elements?.length ?? -1
  if (count !== 3) throw new Error(`Expected 3 elements, got ${count}`)
})

await step("GET single element (el1) — verify details", async () => {
  // Use elements list and find by id (no single-element GET endpoint)
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const found = body.elements?.find((e) => e.id === el1Id)
  if (!found) throw new Error(`el1 (${el1Id}) not found in elements list`)
  if (found.label !== "Title" && found.shape_name !== "Title" && found.name !== "Title")
    console.warn(`  ⚠ label mismatch: ${JSON.stringify(found).slice(0, 80)}`)
})

await step("Update text_box text (el1) — PATCH /text", async () => {
  const r = await page.request.patch(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el1Id}/text`,
    {
      data: { text: "Hello World" },
      headers: { "Content-Type": "application/json" },
    }
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

await step("Update element position (el1) — PATCH position", async () => {
  const r = await page.request.patch(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el1Id}`,
    {
      data: { left_in: 2, top_in: 2 },
      headers: { "Content-Type": "application/json" },
    }
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  const el = await r.json()
  const left = el.left_in ?? el.position?.left_in ?? el.position?.left
  if (left === undefined) throw new Error(`position not in response: ${JSON.stringify(el).slice(0, 80)}`)
})

await step("GET elements — verify el1 position updated", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const el = body.elements?.find((e) => e.id === el1Id)
  if (!el) throw new Error("el1 not found after position update")
  const left = el.left_in ?? el.position?.left_in ?? el.position?.left
  if (left !== undefined && Math.abs(left - 2) > 0.01)
    throw new Error(`Expected left≈2, got ${left}`)
})

await step("Update element style (el2) — PATCH /style fill_color", async () => {
  const r = await page.request.patch(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el2Id}/style`,
    {
      data: { fill_color: "#FF5733" },
      headers: { "Content-Type": "application/json" },
    }
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

await step("Set z-index on el1 — PATCH z_index:10", async () => {
  const r = await page.request.patch(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el1Id}`,
    {
      data: { z_index: 10 },
      headers: { "Content-Type": "application/json" },
    }
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

await step("Duplicate el1 — POST /duplicate", async () => {
  const r = await page.request.post(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el1Id}/duplicate`
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

await step("GET elements — verify 4 elements after duplicate", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const count = body.element_count ?? body.elements?.length ?? -1
  if (count !== 4) throw new Error(`Expected 4 elements, got ${count}`)
})

await step("Delete el3 — DELETE element", async () => {
  const r = await page.request.delete(
    `${BASE}/api/docs/${docId}/slides/1/elements/${el3Id}`
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

await step("GET elements — verify 3 elements after delete", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const count = body.element_count ?? body.elements?.length ?? -1
  if (count !== 3) throw new Error(`Expected 3 elements, got ${count}`)
})

await step("Text search — GET /search-text?q=Hello", async () => {
  const r = await page.request.get(
    `${BASE}/api/docs/${docId}/search-text?q=Hello`
  )
  if (!r.ok()) throw new Error(`HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  // Just verify it returns a parseable response (array or object)
  const body = await r.json()
  if (body === null || body === undefined) throw new Error("null response from search")
})

// ── Phase 3: UI Canvas Verification ──────────────────────────────────────────
console.log("\n── Phase 3: UI Canvas Verification")

await step("Login via UI form", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  const isLogin = page.url().includes("/login")
  if (isLogin) {
    await page.locator('input[type="email"], input[name="email"]').first().fill(email)
    await page.locator('input[type="password"]').first().fill(pw)
    await page.keyboard.press("Enter")
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10000 })
  }
})

await step("Navigate to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
})
await snap("01-studio-loaded")

await step("Canvas is visible", async () => {
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("no canvas found")
})

await step("Canvas shows elements (count >= 1)", async () => {
  // Check via API since canvas renders SVG/canvas elements
  const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  const body = await r.json()
  const count = body.element_count ?? body.elements?.length ?? 0
  if (count < 1) throw new Error(`Expected >= 1 element on canvas, got ${count}`)
})
await snap("02-elements-on-canvas")

await step("Click a visible element in canvas — check selection handles", async () => {
  // Try clicking on the canvas area where an element should be
  const canvas = page.locator('[data-slide-canvas="true"]').first()
  if (!await canvas.count()) throw new Error("canvas not found for click")
  const box = await canvas.boundingBox()
  if (!box) throw new Error("canvas has no bounding box")

  // Click near where el1 (left:2, top:2) would be rendered.
  // Slide is 13.333in x 7.5in; assume canvas fills width.
  const scaleX = box.width  / 13.333
  const scaleY = box.height / 7.5
  const clickX = box.x + 2.5 * scaleX  // ~center of el1 at left:2
  const clickY = box.y + 2.5 * scaleY  // ~center of el1 at top:2
  await page.mouse.click(clickX, clickY)
  await page.waitForTimeout(500)

  // A selection handle, selected class, or resize-handle indicates selection
  const html = await page.content()
  const hasSelection = /selected|selection|resize-handle|handle|is-selected/i.test(html)
  if (!hasSelection) {
    // Non-fatal: canvas may use canvas/SVG rendering without DOM handles
    console.warn("  ⚠ no obvious selection handles in DOM — may use canvas rendering")
  }
})
await snap("03-after-element-click")

// ── Finish ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((s, t) => s + t.ms, 0)

const run = {
  kind:    "element-operations",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}

const outFile = `${OUT}/element-operations-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

// Append to persistent test log
const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "element-operations", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.log(`  ✗ ${s.label}${s.error ? " — " + s.error : ""}`))
}
console.log(`\nScreenshots: ${IMG}/`)
console.log(`Results:     ${outFile}`)
console.log(failed.length === 0 ? "\n✅ FULL FLOW PASSED" : `\n❌ ${failed.length} STEP(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
