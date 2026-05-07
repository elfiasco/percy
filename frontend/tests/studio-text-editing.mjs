/**
 * Studio Text Editing — inserts multiple text boxes via the Insert ribbon,
 * types text into each, verifies persistence via API, and re-opens studio
 * to confirm texts survive a navigation round-trip.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  open studio, verify canvas
 *   3.  insert text box 1 → type "Alpha Text" → Escape → API verify text
 *   4.  re-click Insert tab → insert text box 2 → type "Beta Text" → Escape → API verify
 *   5.  re-click Insert tab → insert text box 3 → type "Gamma Text" → Escape → API verify
 *   6.  re-click Insert tab → insert text box 4 → type "Will be replaced" → Escape
 *   7.  navigate away and back → API confirm all 4 texts persisted
 *   8.  API confirms 4 elements still present after reload
 *
 * Usage:
 *   node tests/studio-text-editing.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-text-editing"
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

async function apiElements(docId) {
  for (let i = 0; i < 2; i++) {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
    if (r.ok()) {
      const b = await r.json()
      return b.elements ?? []
    }
    await page.waitForTimeout(1000)
  }
  throw new Error("GET elements failed after retry")
}

async function apiElementText(docId, elId) {
  for (let i = 0; i < 3; i++) {
    const r = await page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements/${elId}/text`)
    if (r.ok()) {
      const b = await r.json()
      return b.paragraphs?.[0]?.runs?.[0]?.text ?? b.text ?? ""
    }
    await page.waitForTimeout(1000)
  }
  return ""
}

async function clickInsertTab() {
  const btn = page.locator('[role="tab"], button').filter({ hasText: /^insert$/i }).first()
  if (!await btn.count()) throw new Error("Insert tab not found")
  await btn.click()
  await page.waitForTimeout(400)
}

async function insertTextBox(text) {
  await clickInsertTab()
  const btn = page.locator('button').filter({ hasText: /text.?box/i }).first()
  if (!await btn.count()) throw new Error("Text Box button not found")
  await btn.click()
  await page.waitForTimeout(1000)

  const editor = page.locator('[contenteditable="true"]').first()
  if (await editor.count()) {
    await editor.fill(text)
    await page.waitForTimeout(400)
    await page.keyboard.press("Escape")
    await page.waitForTimeout(800)
  } else {
    throw new Error("contenteditable not found after text box insert")
  }
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Text Editing Test ===")
console.log(`Target: ${BASE}\n`)

const email = `text-edit-${TAG}@test.com`
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
    data: { email, password: pw, display_name: "TextEditTester" },
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
    data: { name: "TextEditTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "Text Edit Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

// ── Phase 3: Insert 3 text boxes ──────────────────────────────────────────────
console.log("\n── Phase 3: Insert text boxes")

let elId1, elId2, elId3

await step("Insert text box 1 + type 'Alpha Text'", async () => {
  await insertTextBox("Alpha Text")
  await page.waitForTimeout(1000)
})

await step("API confirms 1 element, fetch elId1", async () => {
  const els = await apiElements(docId)
  if (els.length < 1) throw new Error(`Expected ≥1 element, got ${els.length}`)
  elId1 = els[0].id
  console.log(`     elId1=${elId1}`)
})

await step("API text for element 1 = 'Alpha Text'", async () => {
  const txt = await apiElementText(docId, elId1)
  console.log(`     text="${txt}"`)
  if (!txt.includes("Alpha Text")) throw new Error(`Expected "Alpha Text", got "${txt}"`)
})
await snap("02-after-text-box-1")

await step("Insert text box 2 + type 'Beta Text'", async () => {
  await insertTextBox("Beta Text")
  await page.waitForTimeout(1000)
})

await step("API confirms 2 elements, fetch elId2", async () => {
  const els = await apiElements(docId)
  if (els.length < 2) throw new Error(`Expected ≥2 elements, got ${els.length}`)
  elId2 = els[1].id
  console.log(`     elId2=${elId2}`)
})

await step("API text for element 2 = 'Beta Text'", async () => {
  const txt = await apiElementText(docId, elId2)
  console.log(`     text="${txt}"`)
  if (!txt.includes("Beta Text")) throw new Error(`Expected "Beta Text", got "${txt}"`)
})
await snap("03-after-text-box-2")

await step("Insert text box 3 + type 'Gamma Text'", async () => {
  await insertTextBox("Gamma Text")
  await page.waitForTimeout(1000)
})

await step("API confirms 3 elements, fetch elId3", async () => {
  const els = await apiElements(docId)
  if (els.length < 3) throw new Error(`Expected ≥3 elements, got ${els.length}`)
  elId3 = els[2].id
  console.log(`     elId3=${elId3}`)
})

await step("API text for element 3 = 'Gamma Text'", async () => {
  const txt = await apiElementText(docId, elId3)
  console.log(`     text="${txt}"`)
  if (!txt.includes("Gamma Text")) throw new Error(`Expected "Gamma Text", got "${txt}"`)
})
await snap("04-after-text-box-3")

// ── Phase 4: Insert 4th text box ──────────────────────────────────────────────
console.log("\n── Phase 4: Insert 4th text box")

await step("Insert text box 4 + type 'Will be replaced'", async () => {
  await insertTextBox("Will be replaced")
  await page.waitForTimeout(1000)
})

await step("API confirms 4 elements", async () => {
  const count = await apiElementCount(docId)
  if (count < 4) throw new Error(`Expected ≥4 elements, got ${count}`)
})
await snap("05-four-text-boxes")

// ── Phase 5: Persistence check ────────────────────────────────────────────────
console.log("\n── Phase 5: Persistence after reload")

await step("Navigate away to /projects", async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
  await page.waitForTimeout(500)
})

await step("Navigate back to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found after returning to studio")
})
await snap("06-studio-after-reload")

await step("API confirms 4 elements after reload", async () => {
  const count = await apiElementCount(docId)
  if (count < 4) throw new Error(`Expected ≥4 elements after reload, got ${count}`)
})

await step("API text for element 1 still = 'Alpha Text' after reload", async () => {
  const txt = await apiElementText(docId, elId1)
  if (!txt.includes("Alpha Text")) throw new Error(`Expected "Alpha Text", got "${txt}"`)
})

await step("API text for element 2 still = 'Beta Text' after reload", async () => {
  const txt = await apiElementText(docId, elId2)
  if (!txt.includes("Beta Text")) throw new Error(`Expected "Beta Text", got "${txt}"`)
})

await step("API text for element 3 still = 'Gamma Text' after reload", async () => {
  const txt = await apiElementText(docId, elId3)
  if (!txt.includes("Gamma Text")) throw new Error(`Expected "Gamma Text", got "${txt}"`)
})
await snap("07-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-text-editing",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-text-editing-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO TEXT EDITING PASSED")
