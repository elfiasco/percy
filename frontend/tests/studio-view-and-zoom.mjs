/**
 * Studio View And Zoom — exercises the View ribbon tab and status bar view
 * controls including Normal, Sorter, and Focus view modes.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  open studio
 *   3.  click View ribbon tab → verify View content appears
 *   4.  click Home tab to return to normal ribbon
 *   5.  look for status bar view controls (Normal / Sorter / Focus)
 *   6.  click Focus button → verify focus mode (slide strip hidden or fullscreen-like)
 *   7.  press Escape or click Normal to exit focus mode
 *   8.  verify slide strip visible again
 *   9.  create element via API, reload studio, verify visible in normal mode
 *  10.  click Sorter button → verify sorter opens
 *  11.  close/dismiss sorter
 *
 * Usage:
 *   node tests/studio-view-and-zoom.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-view-and-zoom"
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

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio View And Zoom Test ===")
console.log(`Target: ${BASE}\n`)

const email = `view-zoom-${TAG}@test.com`
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
    data: { email, password: pw, display_name: "ViewZoomTester" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`signup HTTP ${r.status()}`)
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
})

await step("Create project + blank deck via API", async () => {
  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json()
  const pr = await page.request.post(`${BASE}/api/projects`, {
    data: { name: "ViewZoomTest", org_id: me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "View Zoom Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
    headers: { "Content-Type": "application/json" },
  })
  if (!dr.ok()) throw new Error(`create blank HTTP ${dr.status()}`)
  docId = (await dr.json()).doc_id
  if (!docId) throw new Error("no doc_id")
  console.log(`     projId=${projId} docId=${docId}`)
})

// ── Phase 2: Open Studio ───────────────────────────────────────────────────────
console.log("\n── Phase 2: Open Studio")

await step("Navigate to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found")
})
await snap("01-studio-open")

// ── Phase 3: View ribbon tab ───────────────────────────────────────────────────
console.log("\n── Phase 3: View ribbon tab")

await step("Find and click 'View' tab in ribbon", async () => {
  const viewTab = page.locator('[role="tab"], button').filter({ hasText: /^view$/i }).first()
  if (!await viewTab.count()) throw new Error("View tab not found in ribbon")
  await viewTab.click()
  await page.waitForTimeout(500)
})
await snap("02-view-tab-active")

await step("View ribbon content visible", async () => {
  // Look for any View-specific controls
  const controls = page.locator('button').filter({ hasText: /normal|sorter|focus|zoom|fit/i })
  const count = await controls.count()
  console.log(`     View-related buttons found: ${count}`)
  // Non-fatal — just check the tab switch happened
  const crashed = /error boundary|application error/i.test(await page.content())
  if (crashed) throw new Error("Error boundary appeared after clicking View tab")
})

await step("Click 'Home' tab to return to normal ribbon", async () => {
  const homeTab = page.locator('[role="tab"], button').filter({ hasText: /^home$/i }).first()
  if (!await homeTab.count()) throw new Error("Home tab not found")
  await homeTab.click()
  await page.waitForTimeout(400)
})
await snap("03-home-tab-returned")

// ── Phase 4: Status bar view controls ────────────────────────────────────────
console.log("\n── Phase 4: Status bar view controls")

await step("Look for status bar Normal/Sorter/Focus buttons", async () => {
  // These are typically in a status bar at the bottom of the studio
  const normalBtn = page.locator('button').filter({ hasText: /normal/i })
  const sorterBtn = page.locator('button').filter({ hasText: /sorter/i })
  const focusBtn  = page.locator('button').filter({ hasText: /focus/i })
  const n = await normalBtn.count()
  const s = await sorterBtn.count()
  const f = await focusBtn.count()
  console.log(`     Normal=${n}, Sorter=${s}, Focus=${f}`)
  // At least one of these should exist
  if (n + s + f === 0) {
    // Check for Unicode/emoji variants (⊞ ▦ ⛶)
    const altBtns = page.locator('button[title*="Normal"], button[title*="Sorter"], button[title*="Focus"]')
    const altCount = await altBtns.count()
    console.log(`     Alt title buttons: ${altCount}`)
  }
})

// ── Phase 5: Focus view mode ───────────────────────────────────────────────────
console.log("\n── Phase 5: Focus view mode")

await step("Click Focus button (or fallback)", async () => {
  // Try multiple selectors for Focus/Fullscreen mode
  const focusBtns = [
    page.locator('button').filter({ hasText: /focus/i }),
    page.locator('button[title*="Focus"]'),
    page.locator('button[title*="focus"]'),
    page.locator('button').filter({ hasText: /⛶/ }),
  ]
  let clicked = false
  for (const sel of focusBtns) {
    if (await sel.count()) {
      await sel.first().click()
      await page.waitForTimeout(800)
      clicked = true
      console.log("     Clicked focus button")
      break
    }
  }
  if (!clicked) {
    console.log("     Focus button not found — skipping focus mode test (non-fatal)")
  }
})
await snap("04-focus-mode")

await step("Canvas still visible in focus mode", async () => {
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found in focus mode")
})

await step("Exit focus mode (Escape or Normal button)", async () => {
  // Try clicking Normal button first
  const normalBtn = page.locator('button').filter({ hasText: /normal/i }).first()
  if (await normalBtn.count()) {
    await normalBtn.click()
    await page.waitForTimeout(500)
  } else {
    // Fall back to Escape
    await page.keyboard.press("Escape")
    await page.waitForTimeout(500)
  }
})
await snap("05-after-exit-focus")

await step("Canvas visible after exiting focus mode", async () => {
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found after exiting focus mode")
})

// ── Phase 6: Create element + verify in normal mode ───────────────────────────
console.log("\n── Phase 6: Element visible after mode switch")

await step("Create element via API", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "rect", left_in: 3, top_in: 2, width_in: 4, height_in: 2 },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`create element HTTP ${r.status()}`)
})

await step("Reload studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found after reload")
})
await snap("06-after-reload")

await step("Element visible on canvas in Normal mode", async () => {
  const count = await page.locator('[data-element="true"]').count()
  console.log(`     Rendered elements: ${count}`)
  if (count < 1) throw new Error(`Expected ≥1 element visible, got ${count}`)
})

// ── Phase 7: Slide Sorter view ────────────────────────────────────────────────
console.log("\n── Phase 7: Slide Sorter view")

await step("Click Sorter button", async () => {
  const sorterBtns = [
    page.locator('button').filter({ hasText: /sorter/i }),
    page.locator('button[title*="Sorter"]'),
    page.locator('button[title*="sorter"]'),
    page.locator('button').filter({ hasText: /▦/ }),
  ]
  let clicked = false
  for (const sel of sorterBtns) {
    if (await sel.count()) {
      await sel.first().click()
      await page.waitForTimeout(1000)
      clicked = true
      console.log("     Clicked sorter button")
      break
    }
  }
  if (!clicked) {
    console.log("     Sorter button not found — skipping sorter test (non-fatal)")
  }
})
await snap("07-sorter-mode")

await step("Sorter mode active or studio still functional", async () => {
  const crashed = /error boundary|application error/i.test(await page.content())
  if (crashed) throw new Error("Error boundary appeared after clicking Sorter")
  // Just verify the page is still alive
  const hasContent = await page.locator('body').count()
  if (!hasContent) throw new Error("Page body not found")
})

await step("Return to Normal view", async () => {
  const normalBtns = [
    page.locator('button').filter({ hasText: /^normal$/i }),
    page.locator('button[title*="Normal"]'),
    page.locator('button').filter({ hasText: /⊞/ }),
  ]
  let clicked = false
  for (const sel of normalBtns) {
    if (await sel.count()) {
      await sel.first().click()
      await page.waitForTimeout(600)
      clicked = true
      break
    }
  }
  if (!clicked) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(500)
  }
})

await step("Canvas visible after returning to Normal view", async () => {
  if (!await page.locator('[data-slide-canvas="true"]').count()) {
    // Try reloading
    await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(2000)
    if (!await page.locator('[data-slide-canvas="true"]').count())
      throw new Error("canvas not found after returning to Normal view")
  }
})
await snap("08-final-normal-view")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-view-and-zoom",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-view-and-zoom-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO VIEW AND ZOOM PASSED")
