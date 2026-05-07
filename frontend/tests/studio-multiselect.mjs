/**
 * Studio Multi-Select — creates 5 elements via API, then exercises multi-element
 * selection with shift+click, bulk delete, undo, and verifies API state at each
 * checkpoint.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  create 5 elements via API (rect, ellipse, triangle, diamond, star5)
 *   3.  open studio, click element 0
 *   4.  shift+click elements 1, 2, 3 to build multi-selection of 4
 *   5.  press Delete → API confirms 1 element remains
 *   6.  Ctrl+Z to undo bulk delete → API confirms 5 elements
 *   7.  select all 5 via shift+click
 *   8.  press Escape to deselect all
 *   9.  verify canvas still renders all 5 elements
 *
 * Usage:
 *   node tests/studio-multiselect.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-multiselect"
const RES  = "tests/results"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(RES, { recursive: true })

// ── helpers ────────────────────────────────────────────────────────────────────
const steps = []
let page

async function step(label, fn) {
  const t = Date.now()
  try {
    await fn()
    const ms = Date.now() - t
    console.log(`  ✅ ${label} (${ms}ms)`)
    steps.push({ label, ok: true, ms })
  } catch (err) {
    const ms = Date.now() - t
    console.error(`  ❌ ${label}: ${err.message}`)
    steps.push({ label, ok: false, ms, error: err.message })
    try { await page?.screenshot({ path: `${OUT}/FAIL-${label.replace(/\W+/g, "-").slice(0, 40)}.png` }) } catch {}
  }
}

async function snap(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {})
}

async function apiElementCount(docId) {
  for (let i = 0; i < 2; i++) {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
    if (r.ok()) {
      const b = await r.json()
      return b.element_count ?? b.elements?.length ?? 0
    }
    await page.waitForTimeout(1000)
  }
  throw new Error("GET elements failed after retry")
}

async function clickElementByIndex(n) {
  const el = page.locator('[data-element="true"]').nth(n)
  if (!await el.count()) throw new Error(`element ${n} not found`)
  await el.click()
  await page.waitForTimeout(300)
}

async function shiftClickElementByIndex(n) {
  const el = page.locator('[data-element="true"]').nth(n)
  if (!await el.count()) throw new Error(`element ${n} not found`)
  await el.click({ modifiers: ["Shift"] })
  await page.waitForTimeout(300)
}

async function focusCanvas() {
  await page.locator('[data-slide-canvas="true"]').first()
    .click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Multi-Select Test ===")
console.log(`Target: ${BASE}\n`)

const email = `multisel-${TAG}@test.com`
const pw    = "testpass123"
let projId, docId

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } })
page = await ctx.newPage()

page.on("console", (msg) => {
  if (msg.type() === "error") console.warn(`     [browser] ${msg.text().slice(0, 100)}`)
})

// ── Phase 1: Auth + project setup ─────────────────────────────────────────────
console.log("── Phase 1: Setup")

await step("Sign up via API", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "MultiSelTester" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`signup HTTP ${r.status()}`)
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
})

await step("Login via form (establishes session affinity)", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await page.waitForTimeout(500)
  if (page.url().includes("/login")) {
    const emailInput = page.locator('input[type="email"]').first()
    const visible = await emailInput.isVisible().catch(() => false)
    if (visible) {
      await emailInput.fill(email)
      await page.locator('input[type="password"]').first().fill(pw)
      await page.keyboard.press("Enter")
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10000 }).catch(() => {})
    }
  }
})

await step("Create project + blank deck via API", async () => {
  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json()
  const pr = await page.request.post(`${BASE}/api/projects`, {
    data: { name: "MultiSelTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "MultiSel Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
    headers: { "Content-Type": "application/json" },
  })
  if (!dr.ok()) throw new Error(`create blank HTTP ${dr.status()}`)
  docId = (await dr.json()).doc_id
  if (!docId) throw new Error("no doc_id")
  await page.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { doc_id: docId },
    headers: { "Content-Type": "application/json" },
  })
  console.log(`     projId=${projId} docId=${docId}`)
})

await step("Create 5 elements via API at spread positions", async () => {
  const shapes = [
    { shape_type: "rect",     left_in: 0.5, top_in: 0.5, width_in: 2, height_in: 1.5 },
    { shape_type: "ellipse",  left_in: 3,   top_in: 0.5, width_in: 2, height_in: 1.5 },
    { shape_type: "triangle", left_in: 5.5, top_in: 0.5, width_in: 2, height_in: 1.5 },
    { shape_type: "diamond",  left_in: 8,   top_in: 0.5, width_in: 2, height_in: 1.5 },
    { shape_type: "star5",    left_in: 10.5, top_in: 0.5, width_in: 2, height_in: 1.5 },
  ]
  for (const shape of shapes) {
    const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
      data: shape,
      headers: { "Content-Type": "application/json" },
    })
    if (!r.ok()) throw new Error(`create element HTTP ${r.status()} for ${shape.shape_type}`)
    await page.waitForTimeout(200)
  }
})

// ── Phase 2: Open Studio ───────────────────────────────────────────────────────
console.log("\n── Phase 2: Open Studio")

await step("Navigate to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  const errorEl = page.locator('text=/Could not open/i, text=/Project not found/i, text=/Error/i').first()
  if (await errorEl.count()) throw new Error(`Studio error: ${await errorEl.textContent()}`)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found")
})
await snap("01-studio-open")

await step("API confirms 5 elements after opening", async () => {
  const count = await apiElementCount(docId)
  if (count < 5) throw new Error(`Expected ≥5 elements, got ${count}`)
})

await step("Canvas renders 5 element divs", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${rendered}`)
  if (rendered < 5) throw new Error(`Expected ≥5 rendered elements, got ${rendered}`)
})
await snap("02-five-elements-visible")

// ── Phase 3: Multi-select 4 elements ──────────────────────────────────────────
console.log("\n── Phase 3: Multi-select 4 elements")

await step("Click element 0 to start selection", async () => {
  await clickElementByIndex(0)
})

await step("Shift+click element 1", async () => {
  await shiftClickElementByIndex(1)
})

await step("Shift+click element 2", async () => {
  await shiftClickElementByIndex(2)
})

await step("Shift+click element 3 (4 elements selected)", async () => {
  await shiftClickElementByIndex(3)
})
await snap("03-four-selected")

// ── Phase 4: Delete multi-selection ───────────────────────────────────────────
console.log("\n── Phase 4: Delete multi-selection")

await step("Press Delete — removes 4 selected elements", async () => {
  await page.keyboard.press("Delete")
  await page.waitForTimeout(1500)
})

await step("API confirms 1 element remains after bulk delete", async () => {
  const count = await apiElementCount(docId)
  if (count !== 1) throw new Error(`Expected 1 element after bulk delete, got ${count}`)
})

await step("Canvas renders 1 element div", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${rendered}`)
  if (rendered !== 1) throw new Error(`Expected 1 rendered element, got ${rendered}`)
})
await snap("04-after-bulk-delete")

// ── Phase 5: Undo bulk delete ─────────────────────────────────────────────────
console.log("\n── Phase 5: Undo bulk delete")

await step("Ctrl+Z to undo bulk delete", async () => {
  await focusCanvas()
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(1500)
})

await step("API confirms 5 elements after undo", async () => {
  const count = await apiElementCount(docId)
  if (count !== 5) throw new Error(`Expected 5 elements after undo, got ${count}`)
})
await snap("05-after-undo")

// ── Phase 6: Select all 5 via shift+click ────────────────────────────────────
console.log("\n── Phase 6: Select all 5 elements")

await step("Click element 0 to start fresh selection", async () => {
  await clickElementByIndex(0)
})

await step("Shift+click elements 1, 2, 3, 4 (all 5 selected)", async () => {
  for (let i = 1; i <= 4; i++) {
    await shiftClickElementByIndex(i)
  }
})
await snap("06-all-five-selected")

await step("QAT Undo button visible (verifying ribbon state)", async () => {
  const undoBtn = page.locator('button[title^="Undo"]').first()
  if (!await undoBtn.count()) throw new Error("Undo button not found in QAT")
  console.log("     QAT undo button is visible")
})

// ── Phase 7: Escape to deselect ───────────────────────────────────────────────
console.log("\n── Phase 7: Escape to deselect all")

await step("Press Escape to deselect all elements", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Canvas still renders 5 element divs after Escape", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements after Escape: ${rendered}`)
  if (rendered < 5) throw new Error(`Expected ≥5 rendered elements, got ${rendered}`)
})
await snap("07-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-multiselect",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-multiselect-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO MULTI-SELECT PASSED")
