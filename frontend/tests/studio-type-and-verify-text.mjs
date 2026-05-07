/**
 * Studio Type And Verify Text — comprehensive text entry test that inserts
 * text boxes, types text, verifies persistence via the /text API, reloads
 * the studio, and confirms texts survived the round-trip.
 *
 * Steps:
 *   1.  signup + create project + blank deck via API
 *   2.  open studio
 *   3.  insert text box 1 → type "Hello World" → Escape
 *   4.  API GET /text → verify "Hello World"
 *   5.  insert text box 2 → type "Second element" → Escape
 *   6.  API GET /text → verify "Second element"
 *   7.  navigate away and back
 *   8.  API verify both texts persist
 *   9.  insert text box 3 → type "Delete Me" → Escape
 *  10.  click element 3 → press Delete
 *  11.  API confirms 2 elements remain
 *  12.  API verify texts 1+2 unchanged
 *
 * Usage:
 *   node tests/studio-type-and-verify-text.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/studio-type-and-verify-text"
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

async function apiElementText(docId, elId) {
  for (let i = 0; i < 4; i++) {
    const result = await page.evaluate(async ({ base, id, el }) => {
      const r = await fetch(`${base}/api/docs/${id}/slides/1/elements/${el}/text`)
      if (!r.ok) return { error: r.status }
      const b = await r.json()
      const txt = b.paragraphs?.[0]?.runs?.[0]?.text
        ?? b.paragraphs?.[0]?.text
        ?? b.text
        ?? ""
      return { txt }
    }, { base: BASE, id: docId, el: elId })
    if (result.error) { await page.waitForTimeout(1000); continue }
    if (result.txt) return result.txt
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
    // Use keyboard.type() so Tiptap's onUpdate fires (fill() bypasses ProseMirror input events).
    // Use Ctrl+Enter to save — Escape calls onCancel() which discards edits in headless Chrome.
    await editor.focus().catch(() => {})
    await page.waitForTimeout(200)
    await page.keyboard.type(text)
    await page.waitForTimeout(400)
    await page.keyboard.press("Control+Enter")
    await page.waitForTimeout(1000)
  } else {
    throw new Error("contenteditable not found after text box insert")
  }
}

// ── setup ──────────────────────────────────────────────────────────────────────
console.log("\n=== Percy Studio Type And Verify Text Test ===")
console.log(`Target: ${BASE}\n`)

const email = `type-verify-${TAG}@test.com`
const pw    = "testpass123"
let projId, docId
let elId1, elId2

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
    data: { email, password: pw, display_name: "TypeVerifyTester" },
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
    data: { name: "TypeVerifyTest", org_id: me.orgs?.[0]?.id ?? me.org_id },
    headers: { "Content-Type": "application/json" },
  })
  if (!pr.ok()) throw new Error(`create project HTTP ${pr.status()}`)
  projId = (await pr.json()).id
  if (!projId) throw new Error("no project id")

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { name: "Type Verify Deck", project_id: projId, width_in: 13.333, height_in: 7.5 },
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

// ── Phase 3: Insert text box 1 ────────────────────────────────────────────────
console.log("\n── Phase 3: Text Box 1 — 'Hello World'")

await step("Insert text box 1, type 'Hello World'", async () => {
  await insertTextBox("Hello World")
})

await step("API confirms 1 element, capture elId1", async () => {
  const els = await apiElements(docId)
  if (els.length < 1) throw new Error(`Expected ≥1 element, got ${els.length}`)
  elId1 = els[0].id
  console.log(`     elId1=${elId1}`)
})

await step("API text for element 1 = 'Hello World'", async () => {
  const txt = await apiElementText(docId, elId1)
  console.log(`     API text: "${txt}"`)
  if (!txt.includes("Hello World")) throw new Error(`Expected "Hello World", got "${txt}"`)
})
await snap("02-text-box-1-verified")

// ── Phase 4: Insert text box 2 ────────────────────────────────────────────────
console.log("\n── Phase 4: Text Box 2 — 'Second element'")

await step("Insert text box 2, type 'Second element'", async () => {
  await insertTextBox("Second element")
})

await step("API confirms 2 elements, capture elId2", async () => {
  const els = await apiElements(docId)
  if (els.length < 2) throw new Error(`Expected ≥2 elements, got ${els.length}`)
  elId2 = els[1].id
  console.log(`     elId2=${elId2}`)
})

await step("API text for element 2 = 'Second element'", async () => {
  const txt = await apiElementText(docId, elId2)
  console.log(`     API text: "${txt}"`)
  if (!txt.includes("Second element")) throw new Error(`Expected "Second element", got "${txt}"`)
})
await snap("03-text-box-2-verified")

// ── Phase 5: Navigate away + back ────────────────────────────────────────────
console.log("\n── Phase 5: Persistence after reload")

await step("Navigate away to /projects", async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" })
})

await step("Navigate back to studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000)
  if (!await page.locator('[data-slide-canvas="true"]').count())
    throw new Error("canvas not found after return")
})
await snap("04-after-reload")

await step("API confirms 2 elements persist after reload", async () => {
  const els = await apiElements(docId)
  if (els.length < 2) throw new Error(`Expected ≥2 elements after reload, got ${els.length}`)
})

await step("API text for element 1 still = 'Hello World' after reload", async () => {
  const txt = await apiElementText(docId, elId1)
  console.log(`     elId1 text after reload: "${txt}"`)
  if (!txt.includes("Hello World")) throw new Error(`Expected "Hello World", got "${txt}"`)
})

await step("API text for element 2 still = 'Second element' after reload", async () => {
  const txt = await apiElementText(docId, elId2)
  console.log(`     elId2 text after reload: "${txt}"`)
  if (!txt.includes("Second element")) throw new Error(`Expected "Second element", got "${txt}"`)
})

// ── Phase 6: Insert + delete 3rd text box ────────────────────────────────────
console.log("\n── Phase 6: Insert + delete 'Delete Me' text box")

await step("Insert text box 3, type 'Delete Me'", async () => {
  await insertTextBox("Delete Me")
})

await step("API confirms 3 elements", async () => {
  const els = await apiElements(docId)
  if (els.length < 3) throw new Error(`Expected ≥3 elements, got ${els.length}`)
})
await snap("05-three-elements")

await step("Click element 2 (Delete Me) to select it", async () => {
  const count = await page.locator('[data-element="true"]').count()
  console.log(`     Canvas element divs: ${count}`)
  if (count < 3) throw new Error(`Expected ≥3 element divs, got ${count}`)
  const found = await page.evaluate((idx) => {
    const els = document.querySelectorAll('[data-element="true"]')
    const el = els[idx]
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return true
  }, count - 1)
  if (!found) throw new Error("last element not found via dispatch")
  await page.waitForTimeout(400)
  const inEditMode = await page.evaluate(() => {
    const a = document.activeElement
    return !!(a?.isContentEditable || a?.closest?.('[contenteditable="true"]'))
  })
  if (inEditMode) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)
  }
})

await step("Press Delete to remove the 3rd text box", async () => {
  await page.keyboard.press("Delete")
  await page.waitForTimeout(1500)
})

await step("API confirms 2 elements after deleting 3rd", async () => {
  const els = await apiElements(docId)
  if (els.length !== 2) throw new Error(`Expected 2 elements, got ${els.length}`)
})

await step("API text for element 1 still = 'Hello World' after deletion of 3rd", async () => {
  const txt = await apiElementText(docId, elId1)
  if (!txt.includes("Hello World")) throw new Error(`Expected "Hello World", got "${txt}"`)
})

await step("API text for element 2 still = 'Second element' after deletion of 3rd", async () => {
  const txt = await apiElementText(docId, elId2)
  if (!txt.includes("Second element")) throw new Error(`Expected "Second element", got "${txt}"`)
})
await snap("06-final")

// ── results ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((a, s) => a + s.ms, 0)

const result = {
  kind:    "studio-type-and-verify-text",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}
await writeFile(`${RES}/studio-type-and-verify-text-${TAG}.json`, JSON.stringify(result, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed steps:")
  failed.forEach((s) => console.error(`  ✗ ${s.label} — ${s.error}`))
  console.log(`\nScreenshots: ${OUT}/`)
  process.exit(1)
}
console.log("\n✅ STUDIO TYPE AND VERIFY TEXT PASSED")
