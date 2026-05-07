/**
 * Studio Element Marathon — a complex multi-phase edit sequence that builds
 * up elements, deletes them, undoes/redoes, multi-selects, and verifies state
 * via API at every checkpoint.
 *
 * Phases:
 *   1.  Build 5 elements: text, rect, ellipse, triangle, diamond
 *   2.  Delete 2 via keyboard (elements 0 + 0)
 *   3.  Undo both deletes (QAT Undo × 2)
 *   4.  Redo one delete (Ctrl+Y)
 *   5.  Insert one more ellipse
 *   6.  Multi-select delete: shift+click 2 elements, Delete
 *   7.  Navigate away and back; verify 3 elements persist
 *
 * Usage:
 *   node tests/studio-element-marathon.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-element-marathon"
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

async function clickInsertTab() {
  const btn = page.locator('[role="tab"], button').filter({ hasText: /^insert$/i }).first()
  if (!await btn.count()) throw new Error("Insert tab not found")
  await btn.click()
  await page.waitForTimeout(400)
}

async function clickElementByIndex(n) {
  const el = page.locator('[data-element="true"]').nth(n)
  if (!await el.count()) throw new Error(`element ${n} not found`)
  await el.click()
  await page.waitForTimeout(300)
}

async function focusCanvas() {
  await page.locator('[data-slide-canvas="true"]').first()
    .click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Element Marathon Test ===")
console.log(`Target: ${BASE}\n`)

const email = `marathon-${TAG}@test.com`
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
    data: { email, password: pw, display_name: "MarathonTester" },
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
    data: { name: "MarathonTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "Marathon Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

// ── Phase 3: Build 5 elements ──────────────────────────────────────────────────
console.log("\n── Phase 3: Build 5 elements")

await step("Insert Text Box → type 'Alpha'", async () => {
  await clickInsertTab()
  const btn = page.locator('button').filter({ hasText: /text.?box/i }).first()
  if (!await btn.count()) throw new Error("Text Box button not found")
  await btn.click()
  await page.waitForTimeout(1000)
  const editor = page.locator('[contenteditable="true"]').first()
  if (await editor.count()) {
    await editor.fill("Alpha")
    await page.waitForTimeout(300)
  }
  await page.keyboard.press("Escape")
  await page.waitForTimeout(800)
})

await step("Insert Rectangle", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Rectangle"]').first()
  if (!await btn.count()) throw new Error("Rectangle button not found")
  await btn.click()
  await page.waitForTimeout(1000)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Ellipse", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Ellipse"]').first()
  if (!await btn.count()) throw new Error("Ellipse button not found")
  await btn.click()
  await page.waitForTimeout(1000)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Triangle", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Triangle"]').first()
  if (!await btn.count()) throw new Error("Triangle button not found")
  await btn.click()
  await page.waitForTimeout(1000)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Diamond", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Diamond"]').first()
  if (!await btn.count()) throw new Error("Diamond button not found")
  await btn.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("API confirms 5 elements after phase 3", async () => {
  const count = await apiElementCount(docId)
  if (count < 5) throw new Error(`Expected ≥5 elements, got ${count}`)
  console.log(`     Elements: ${count}`)
})
await snap("02-five-elements")

// ── Phase 4: Delete 2 via keyboard ────────────────────────────────────────────
console.log("\n── Phase 4: Delete 2 elements via keyboard")

await step("Click element 0, press Delete", async () => {
  await clickElementByIndex(0)
  await page.keyboard.press("Delete")
  await page.waitForTimeout(1500)
})

await step("API confirms 4 elements", async () => {
  const count = await apiElementCount(docId)
  if (count !== 4) throw new Error(`Expected 4 elements, got ${count}`)
})

await step("Click element 0 (now former element 1), press Delete", async () => {
  await clickElementByIndex(0)
  await page.keyboard.press("Delete")
  await page.waitForTimeout(1500)
})

await step("API confirms 3 elements", async () => {
  const count = await apiElementCount(docId)
  if (count !== 3) throw new Error(`Expected 3 elements, got ${count}`)
})
await snap("03-after-two-deletes")

// ── Phase 5: Undo both deletes via QAT ────────────────────────────────────────
console.log("\n── Phase 5: Undo both deletes via QAT")

await step("Click QAT Undo button (first undo)", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  const undoBtn = page.locator('button[title^="Undo"]').first()
  if (!await undoBtn.count()) throw new Error("Undo button not found")
  await undoBtn.click()
  await page.waitForTimeout(1500)
})

await step("API confirms 4 elements after first QAT undo", async () => {
  const count = await apiElementCount(docId)
  if (count !== 4) throw new Error(`Expected 4 elements, got ${count}`)
})

await step("Click QAT Undo button (second undo)", async () => {
  const undoBtn = page.locator('button[title^="Undo"]').first()
  if (!await undoBtn.count()) throw new Error("Undo button not found")
  await undoBtn.click()
  await page.waitForTimeout(1500)
})

await step("API confirms 5 elements after second QAT undo", async () => {
  const count = await apiElementCount(docId)
  if (count !== 5) throw new Error(`Expected 5 elements, got ${count}`)
})
await snap("04-back-to-five")

// ── Phase 6: Redo one delete ───────────────────────────────────────────────────
console.log("\n── Phase 6: Redo one delete")

await step("Ctrl+Y → redo one delete", async () => {
  await focusCanvas()
  await page.keyboard.press("Control+y")
  await page.waitForTimeout(1500)
})

await step("API confirms 4 elements after redo", async () => {
  const count = await apiElementCount(docId)
  if (count !== 4) throw new Error(`Expected 4 elements, got ${count}`)
})
await snap("05-four-after-redo")

// ── Phase 7: Insert one more ellipse ──────────────────────────────────────────
console.log("\n── Phase 7: Insert one more ellipse")

await step("Re-click Insert tab, insert Ellipse", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Ellipse"]').first()
  if (!await btn.count()) throw new Error("Ellipse button not found")
  await btn.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("API confirms 5 elements after extra ellipse", async () => {
  const count = await apiElementCount(docId)
  if (count < 5) throw new Error(`Expected ≥5 elements, got ${count}`)
})
await snap("06-five-with-extra-ellipse")

// ── Phase 8: Multi-select delete ──────────────────────────────────────────────
console.log("\n── Phase 8: Multi-select and delete 2 elements")

await step("Click element 0, then shift+click element 1", async () => {
  await clickElementByIndex(0)
  const el1 = page.locator('[data-element="true"]').nth(1)
  if (!await el1.count()) throw new Error("element 1 not found")
  await el1.click({ modifiers: ["Shift"] })
  await page.waitForTimeout(500)
})

await step("Press Delete to remove selected elements", async () => {
  await page.keyboard.press("Delete")
  await page.waitForTimeout(1500)
})

await step("API confirms 3 elements after multi-select delete", async () => {
  const count = await apiElementCount(docId)
  if (count !== 3) throw new Error(`Expected 3 elements, got ${count}`)
})
await snap("07-after-multiselect-delete")

// ── Phase 9: Persistence check ────────────────────────────────────────────────
console.log("\n── Phase 9: Persistence after reload")

await step("Navigate away to /projects", async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
})

await step("Navigate back to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found after return")
})
await snap("08-after-reload")

await step("API confirms 3 elements persist after reload", async () => {
  const count = await apiElementCount(docId)
  if (count !== 3) throw new Error(`Expected 3 elements after reload, got ${count}`)
  console.log(`     Final element count: ${count}`)
})

await step("Canvas renders 3 element divs after reload", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${rendered}`)
  if (rendered < 3) throw new Error(`Expected ≥3 rendered elements, got ${rendered}`)
})
await snap("09-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-element-marathon",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-element-marathon-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO ELEMENT MARATHON PASSED")
