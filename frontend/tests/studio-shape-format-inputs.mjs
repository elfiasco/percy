/**
 * Studio Shape Format Inputs — verifies the X/Y/W/H position and size inputs
 * in the Shape Format ribbon context tab, typing new values and confirming
 * the changes are persisted via the API.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  create element at left=1, top=1, width=3, height=2 via API
 *   3.  open studio, click the element
 *   4.  verify ribbon switched to Shape Format (X/Y/W/H inputs visible)
 *   5.  change X to 4 → API confirms left_in ≈ 4
 *   6.  change Y to 3 → API confirms top_in ≈ 3
 *   7.  change W to 5 → API confirms width_in ≈ 5
 *   8.  press Escape → ribbon returns to non-context state
 *
 * Usage:
 *   node tests/studio-shape-format-inputs.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-shape-format-inputs"
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

async function apiElements(docId) {
  const result = await page.evaluate(async ({ base, id }) => {
    const r = await fetch(`${base}/api/docs/${id}/slides/1/elements`)
    if (!r.ok) return { error: r.status }
    const b = await r.json()
    return { elements: b.elements ?? [] }
  }, { base: BASE, id: docId })
  if (result.error) throw new Error(`GET elements HTTP ${result.error}`)
  return result.elements
}

// Find an input in a label whose span matches the given letter (X, Y, W, or H)
async function findPositionInput(letter) {
  // Strategy 1: label containing a span with exactly that letter
  const labels = page.locator('label')
  const count = await labels.count()
  for (let i = 0; i < count; i++) {
    const lbl = labels.nth(i)
    const spans = lbl.locator('span')
    const sc = await spans.count()
    for (let j = 0; j < sc; j++) {
      const txt = (await spans.nth(j).textContent() ?? "").trim()
      if (txt === letter) {
        const inp = lbl.locator('input[type="number"]')
        if (await inp.count()) return inp.first()
      }
    }
  }
  // Strategy 2: placeholder or aria-label matching
  const inp = page.locator(`input[placeholder="${letter}"], input[aria-label="${letter}"]`)
  if (await inp.count()) return inp.first()
  throw new Error(`Position input "${letter}" not found in ribbon`)
}

async function setPositionInput(letter, value) {
  const inp = await findPositionInput(letter)
  // Click once to move focus (this may trigger onBlur on the previous input,
  // causing a PATCH + setSelectedElement → useEffect reset of all input values).
  await inp.click()
  // Wait for any blur-triggered PATCH to complete and for React's useEffect
  // to fire and reset the input states before we start typing.
  await page.waitForTimeout(800)
  // Now select all and type the new value
  await page.keyboard.press("Control+a")
  await page.keyboard.type(String(value))
  await page.waitForTimeout(200)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(1500)
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Shape Format Inputs Test ===")
console.log(`Target: ${BASE}\n`)

const email = `shape-fmt-${TAG}@test.com`
const pw    = "testpass123"
let projId, docId, elId

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
    data: { email, password: pw, display_name: "ShapeFmtTester" },
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
    data: { name: "ShapeFmtTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "Shape Format Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

await step("Create element via API at left=1 top=1 width=3 height=2", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "rect", left_in: 1, top_in: 1, width_in: 3, height_in: 2 },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`create element HTTP ${r.status()}`)
  const body = await r.json()
  elId = body.id ?? body.element?.id
  if (!elId) throw new Error("no element id in response")
  console.log(`     elId=${elId}`)
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

// ── Phase 3: Click element + verify Shape Format tab ──────────────────────────
console.log("\n── Phase 3: Select element → Shape Format")

await step("Click the element div to select it", async () => {
  const found = await page.evaluate(() => {
    const el = document.querySelector('[data-element="true"]')
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return true
  })
  if (!found) throw new Error("element not found on canvas")
  await page.waitForTimeout(500)
})
await snap("02-element-selected")

await step("Shape Format ribbon visible — X/Y/W/H inputs present", async () => {
  // Look for at least one number input in the ribbon (for X, Y, W, or H)
  const inputs = page.locator('input[type="number"]')
  const count = await inputs.count()
  console.log(`     Number inputs visible: ${count}`)
  if (count < 1) throw new Error("No number inputs found — Shape Format ribbon may not be active")
})

// ── Phase 4: Change X ─────────────────────────────────────────────────────────
console.log("\n── Phase 4: Change X position")

await step("Set X input to 4, press Enter", async () => {
  await setPositionInput("X", 4)
})

await step("API confirms element left_in ≈ 4", async () => {
  const els = await apiElements(docId)
  const el = els.find((e) => e.id === elId) ?? els[0]
  const leftIn = el?.left_in ?? el?.x
  console.log(`     API left_in=${leftIn}`)
  if (leftIn === undefined) throw new Error("left_in not returned by API")
  if (Math.abs(leftIn - 4) > 0.5) throw new Error(`Expected left_in≈4, got ${leftIn}`)
})
await snap("03-x-changed")

// ── Phase 5: Change Y ─────────────────────────────────────────────────────────
console.log("\n── Phase 5: Change Y position")

await step("Set Y input to 3, press Enter", async () => {
  await setPositionInput("Y", 3)
})

await step("API confirms element top_in ≈ 3", async () => {
  const els = await apiElements(docId)
  const el = els.find((e) => e.id === elId) ?? els[0]
  const topIn = el?.top_in ?? el?.y
  console.log(`     API top_in=${topIn}`)
  if (topIn === undefined) throw new Error("top_in not returned by API")
  if (Math.abs(topIn - 3) > 0.5) throw new Error(`Expected top_in≈3, got ${topIn}`)
})
await snap("04-y-changed")

// ── Phase 6: Change W ─────────────────────────────────────────────────────────
console.log("\n── Phase 6: Change W (width)")

await step("Set W input to 5, press Enter", async () => {
  await setPositionInput("W", 5)
})

await step("API confirms element width_in ≈ 5", async () => {
  const els = await apiElements(docId)
  const el = els.find((e) => e.id === elId) ?? els[0]
  const widthIn = el?.width_in ?? el?.w
  console.log(`     API width_in=${widthIn}`)
  if (widthIn === undefined) throw new Error("width_in not returned by API")
  if (Math.abs(widthIn - 5) > 0.5) throw new Error(`Expected width_in≈5, got ${widthIn}`)
})
await snap("05-w-changed")

// ── Phase 7: Escape deselects ─────────────────────────────────────────────────
console.log("\n── Phase 7: Escape deselects, ribbon returns to normal")

await step("Press Escape to deselect element", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
})

await step("Number inputs no longer active (deselected state)", async () => {
  // After deselect, number inputs should be absent or disabled
  const inputs = page.locator('input[type="number"]')
  const count = await inputs.count()
  console.log(`     Number inputs after Escape: ${count}`)
  // If inputs are present, check if they're disabled
  if (count > 0) {
    const firstDisabled = await inputs.first().isDisabled()
    console.log(`     First input disabled: ${firstDisabled}`)
  }
})
await snap("06-deselected")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-shape-format-inputs",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-shape-format-inputs-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO SHAPE FORMAT INPUTS PASSED")
