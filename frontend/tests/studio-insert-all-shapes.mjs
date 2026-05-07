/**
 * Studio Insert All Shapes — inserts all 6 shape types via the Insert ribbon,
 * verifies via API, then undoes all 6 and redoes all 6 to confirm undo/redo
 * works for the full shape palette.
 *
 * Shape types tested: Text Box, Rectangle, Ellipse, Triangle, Diamond, Star
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  open studio
 *   3.  for each of 6 shapes: click Insert tab → click button → Escape
 *   4.  API + canvas both confirm 6 elements
 *   5.  Ctrl+Z × 6 → API confirms 0 elements
 *   6.  Ctrl+Y × 6 → API confirms 6 elements again
 *
 * Usage:
 *   node tests/studio-insert-all-shapes.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-insert-all-shapes"
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

async function focusCanvas() {
  await page.locator('[data-slide-canvas="true"]').first()
    .click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Insert All Shapes Test ===")
console.log(`Target: ${BASE}\n`)

const email = `all-shapes-${TAG}@test.com`
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
    data: { email, password: pw, display_name: "AllShapesTester" },
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
    data: { name: "AllShapesTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "All Shapes Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

await step("Verify 0 elements initially", async () => {
  const count = await apiElementCount(docId)
  if (count !== 0) throw new Error(`Expected 0 elements, got ${count}`)
})

// ── Phase 3: Insert all 6 shapes ──────────────────────────────────────────────
console.log("\n── Phase 3: Insert all 6 shapes via ribbon")

await step("Insert Text Box", async () => {
  await clickInsertTab()
  const btn = page.locator('button').filter({ hasText: /text.?box/i }).first()
  if (!await btn.count()) throw new Error("Text Box button not found")
  await btn.click()
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Rectangle", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Rectangle"]').first()
  if (!await btn.count()) throw new Error("Rectangle button not found")
  await btn.click()
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Ellipse", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Ellipse"]').first()
  if (!await btn.count()) throw new Error("Ellipse button not found")
  await btn.click()
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Triangle", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Triangle"]').first()
  if (!await btn.count()) throw new Error("Triangle button not found")
  await btn.click()
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Diamond", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Diamond"]').first()
  if (!await btn.count()) throw new Error("Diamond button not found")
  await btn.click()
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Insert Star", async () => {
  await clickInsertTab()
  // Star may be titled "Star", "5-Point Star", or "star5"
  const starBtn = page.locator('button[title="Star"], button[title="Star5"], button[title="5-Point Star"]').first()
  if (!await starBtn.count()) {
    // Fallback: look by text
    const starByText = page.locator('button').filter({ hasText: /^star/i }).first()
    if (!await starByText.count()) throw new Error("Star button not found")
    await starByText.click()
  } else {
    await starBtn.click()
  }
  await page.waitForTimeout(1500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})
await snap("02-all-six-inserted")

// ── Phase 4: Verify 6 elements ────────────────────────────────────────────────
console.log("\n── Phase 4: Verify 6 elements")

await step("API confirms 6 elements after inserting all shapes", async () => {
  let count = 0
  for (let i = 0; i < 6; i++) {
    count = await apiElementCount(docId)
    if (count >= 6) break
    await page.waitForTimeout(1200)
  }
  if (count < 6) throw new Error(`Expected ≥6 elements, got ${count}`)
  console.log(`     Elements: ${count}`)
})

await step("Canvas renders 6 element divs", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${rendered}`)
  if (rendered < 6) throw new Error(`Expected ≥6 rendered elements, got ${rendered}`)
})

// ── Phase 5: Undo all 6 via Ctrl+Z ────────────────────────────────────────────
console.log("\n── Phase 5: Undo all 6 via Ctrl+Z × 6")

await step("Focus canvas before Ctrl+Z chain", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await focusCanvas()
})

for (let i = 0; i < 6; i++) {
  await step(`Ctrl+Z #${i + 1}`, async () => {
    await page.keyboard.press("Control+z")
    await page.waitForTimeout(800)
  })
}
await snap("03-after-six-undos")

await step("API confirms 0 elements after 6× Ctrl+Z", async () => {
  let count = await apiElementCount(docId)
  if (count !== 0) {
    // One more retry
    await page.waitForTimeout(1500)
    count = await apiElementCount(docId)
  }
  if (count !== 0) throw new Error(`Expected 0 elements after 6× undo, got ${count}`)
})

// ── Phase 6: Redo all 6 via Ctrl+Y ────────────────────────────────────────────
console.log("\n── Phase 6: Redo all 6 via Ctrl+Y × 6")

for (let i = 0; i < 6; i++) {
  await step(`Ctrl+Y #${i + 1}`, async () => {
    await page.keyboard.press("Control+y")
    await page.waitForTimeout(800)
  })
}
await snap("04-after-six-redos")

await step("API confirms 6 elements again after 6× Ctrl+Y", async () => {
  let count = 0
  for (let i = 0; i < 5; i++) {
    count = await apiElementCount(docId)
    if (count >= 6) break
    await page.waitForTimeout(1200)
  }
  if (count < 6) throw new Error(`Expected ≥6 elements after 6× redo, got ${count}`)
  console.log(`     Final element count: ${count}`)
})

await step("Canvas renders 6 element divs after full redo", async () => {
  const rendered = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${rendered}`)
  if (rendered < 6) throw new Error(`Expected ≥6 rendered elements, got ${rendered}`)
})
await snap("05-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-insert-all-shapes",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-insert-all-shapes-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO INSERT ALL SHAPES PASSED")
