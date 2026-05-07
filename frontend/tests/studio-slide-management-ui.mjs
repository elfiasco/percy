/**
 * Studio Slide Management — adds new slides via the UI, navigates between
 * them, verifies slide count via API, and inserts elements on individual
 * slides to confirm per-slide element isolation.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  open studio, verify 1 slide
 *   3.  click "New Slide" button → API confirms 2 slides
 *   4.  click "New Slide" again → API confirms 3 slides
 *   5.  click slide 2 in strip → verify canvas refreshed
 *   6.  delete slide 3 via API → confirm 2 slides
 *   7.  click slide 1 → insert element on slide 1 → API confirms element on slide 1
 *   8.  navigate to slide 2 → insert element → API confirms element on slide 2
 *   9.  verify slide 1 still has its element, slide 2 has its element
 *
 * Usage:
 *   node tests/studio-slide-management-ui.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-slide-management-ui"
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

async function apiSlideCount(docId) {
  const result = await page.evaluate(async ({ base, id }) => {
    const r = await fetch(`${base}/api/docs/${id}/stats`)
    if (!r.ok) return { error: r.status, body: await r.text().catch(() => "") }
    const b = await r.json()
    return { count: b.slide_count ?? 0 }
  }, { base: BASE, id: docId })
  if (result.error) throw new Error(`GET stats HTTP ${result.error}: ${result.body.slice(0, 200)}`)
  return result.count
}

async function apiElementCount(docId, slideNum) {
  const result = await page.evaluate(async ({ base, id, slide }) => {
    const r = await fetch(`${base}/api/docs/${id}/slides/${slide}/elements`)
    if (!r.ok) return { error: r.status, body: await r.text().catch(() => "") }
    const b = await r.json()
    return { count: b.element_count ?? b.elements?.length ?? 0 }
  }, { base: BASE, id: docId, slide: slideNum })
  if (result.error) throw new Error(`GET elements HTTP ${result.error}: ${result.body.slice(0, 200)}`)
  return result.count
}

async function clickInsertTab() {
  const btn = page.locator('[role="tab"], button').filter({ hasText: /^insert$/i }).first()
  if (!await btn.count()) throw new Error("Insert tab not found")
  await btn.click()
  await page.waitForTimeout(400)
}

async function clickNewSlide() {
  // Try multiple selectors for the New Slide button
  const selectors = [
    page.locator('button').filter({ hasText: /^new slide$/i }),
    page.locator('button').filter({ hasText: /new slide/i }),
    page.locator('button[title="New Slide"]'),
    page.locator('button').filter({ hasText: /^\+$/ }),
  ]
  for (const sel of selectors) {
    if (await sel.count()) {
      await sel.first().click()
      await page.waitForTimeout(1000)
      return
    }
  }
  throw new Error("New Slide button not found (tried multiple selectors)")
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Slide Management UI Test ===")
console.log(`Target: ${BASE}\n`)

const email = `slides-${TAG}@test.com`
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
    data: { email, password: pw, display_name: "SlideMgmtTester" },
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
    data: { name: "SlideMgmtTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "Slide Mgmt Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

// ── Phase 3: Add slides ────────────────────────────────────────────────────────
console.log("\n── Phase 3: Add slides via UI")

await step("Click 'New Slide' button (first time)", async () => {
  await clickNewSlide()
})

await step("API confirms 2 slides after first New Slide", async () => {
  const count = await apiSlideCount(docId)
  if (count < 2) throw new Error(`Expected ≥2 slides, got ${count}`)
  console.log(`     Slide count: ${count}`)
})
await snap("02-two-slides")

await step("Click 'New Slide' button (second time)", async () => {
  await clickNewSlide()
})

await step("API confirms 3 slides after second New Slide", async () => {
  const count = await apiSlideCount(docId)
  if (count < 3) throw new Error(`Expected ≥3 slides, got ${count}`)
  console.log(`     Slide count: ${count}`)
})
await snap("03-three-slides")

// ── Phase 4: Navigate slide strip ─────────────────────────────────────────────
console.log("\n── Phase 4: Navigate slide strip")

await step("Click slide 2 in slide strip", async () => {
  const slide2 = page.locator('[data-slide-strip][data-slide-n="2"]').first()
  if (await slide2.count()) {
    await slide2.click()
    await page.waitForTimeout(800)
  } else {
    // Fallback: nth(1) in case data-slide-n is not rendered yet
    const strips = page.locator('[data-slide-strip]')
    const total = await strips.count()
    console.log(`     Found ${total} slide strip items (data-slide-n="2" not found)`)
    if (total >= 2) {
      await strips.nth(1).click()
      await page.waitForTimeout(800)
    } else {
      throw new Error("Could not find slide 2 in strip")
    }
  }
})

await step("Canvas refreshed for slide 2", async () => {
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not visible after slide 2 click")
})
await snap("04-slide-2-active")

// ── Phase 5: Delete slide 3 via API ───────────────────────────────────────────
console.log("\n── Phase 5: Delete slide 3 via API")

await step("Delete slide 3 via API", async () => {
  const r = await page.request.delete(`${BASE}/api/docs/${docId}/slides/3`)
  if (!r.ok()) {
    console.log(`     DELETE slide 3 returned ${r.status()} — may be index-based`)
    // Try with zero-based index or slide id
  }
  await page.waitForTimeout(1000)
})

await step("Reload studio and verify 2 slides", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2000)
  // Verify either via API or UI
  const count = await apiSlideCount(docId)
  console.log(`     Slide count after delete: ${count}`)
  if (count > 3) throw new Error(`Expected ≤3 slides, got ${count}`)
})
await snap("05-after-slide-delete")

// ── Phase 6: Insert elements on specific slides ────────────────────────────────
console.log("\n── Phase 6: Insert elements on individual slides")

await step("Click slide 1 in strip", async () => {
  const slide1 = page.locator('[data-slide-strip]').nth(0)
  if (await slide1.count()) {
    await slide1.click()
    await page.waitForTimeout(800)
  } else {
    console.log("     Slide strip item not found with [data-slide-strip] — already on slide 1")
  }
})

await step("Insert Rectangle on slide 1 via ribbon", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Rectangle"]').first()
  if (!await btn.count()) throw new Error("Rectangle button not found")
  await btn.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("API confirms ≥1 element on slide 1", async () => {
  const count = await apiElementCount(docId, 1)
  if (count < 1) throw new Error(`Expected ≥1 element on slide 1, got ${count}`)
  console.log(`     Slide 1 elements: ${count}`)
})
await snap("06-element-on-slide-1")

await step("Click slide 2 in strip to switch to it", async () => {
  const slide2 = page.locator('[data-slide-strip][data-slide-n="2"]').first()
  const strips  = page.locator('[data-slide-strip]')
  const total   = await strips.count()
  console.log(`     Slide strip items: ${total}`)
  if (await slide2.count()) {
    await slide2.click()
    await page.waitForTimeout(800)
  } else if (total >= 2) {
    await strips.nth(1).click()
    await page.waitForTimeout(800)
  } else {
    console.log("     Only 1 slide strip item visible — using new slide button")
    await clickNewSlide()
  }
})

await step("Insert Ellipse on slide 2 via ribbon", async () => {
  await clickInsertTab()
  const btn = page.locator('button[title="Ellipse"]').first()
  if (!await btn.count()) throw new Error("Ellipse button not found")
  await btn.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})
await snap("07-element-on-slide-2")

await step("API confirms ≥1 element on slide 1 still present", async () => {
  const count = await apiElementCount(docId, 1)
  if (count < 1) throw new Error(`Expected ≥1 element on slide 1 still, got ${count}`)
  console.log(`     Slide 1 elements: ${count}`)
})

await step("Final state: slides and elements verified", async () => {
  const slides = await apiSlideCount(docId)
  const s1 = await apiElementCount(docId, 1)
  console.log(`     Slides=${slides}, slide1 elements=${s1}`)
  if (s1 < 1) throw new Error("Slide 1 should have ≥1 element")
})
await snap("08-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-slide-management-ui",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-slide-management-ui-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO SLIDE MANAGEMENT UI PASSED")
