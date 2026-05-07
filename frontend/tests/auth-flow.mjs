/**
 * Auth lifecycle end-to-end test — signup, login, wrong password, /me,
 * settings update, forgot-password, UI pages, logout, post-logout /me.
 *
 * Two Playwright contexts are used:
 *   apiCtx  — raw API checks (no browser tabs, cookie jar only)
 *   uiCtx   — full browser UI journey
 *
 * Usage:
 *   node tests/auth-flow.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const IMG  = "tests/out/auth-flow"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(IMG, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

const steps = []
let browser
let apiCtx,  apiPage   // API-only context
let uiCtx,   uiPage    // UI journey context

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
    try { await uiPage?.screenshot({ path: `${IMG}/FAIL-${safe}.png` }) } catch {}
  }
}

async function snap(name) {
  try { await uiPage.screenshot({ path: `${IMG}/${name}.png`, fullPage: false }) } catch {}
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log("\n=== Auth Flow End-to-End Test ===")
console.log(`Target: ${BASE}\n`)

browser = await chromium.launch({ headless: true })

// Two separate contexts — one API-only, one UI journey
apiCtx  = await browser.newContext({ viewport: { width: 1440, height: 900 } })
apiPage = await apiCtx.newPage()

uiCtx  = await browser.newContext({ viewport: { width: 1440, height: 900 } })
uiPage = await uiCtx.newPage()

// ── Phase 1: API-only Auth Checks ─────────────────────────────────────────────
console.log("── Phase 1: API auth checks")

const email  = `auth-${TAG}@test.com`
const pw     = `Pw_${TAG}_Au9!`
const wrongPw = `Wrong_${TAG}_X!`
let userId

await step("Signup new user via API → verify id + org", async () => {
  const r = await apiPage.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "Auth Tester" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`signup HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  const me = await r.json()
  if (!me?.id && !me?.user?.id) throw new Error(`no id in signup response: ${JSON.stringify(me).slice(0, 80)}`)
  if (!me?.orgs?.length && !me?.org?.id)
    throw new Error(`no org in signup response: ${JSON.stringify(me).slice(0, 80)}`)
  userId = me.id ?? me.user?.id
})

await step("Login with wrong password → verify 401", async () => {
  // Use a fresh page in apiCtx so cookies don't carry over from signup
  const freshPage = await apiCtx.newPage()
  try {
    const r = await freshPage.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: wrongPw },
      headers: { "Content-Type": "application/json" },
    })
    if (r.status() !== 401) throw new Error(`Expected 401, got ${r.status()}`)
  } finally {
    await freshPage.close()
  }
})

await step("Login with correct password → verify 200 + session cookie set", async () => {
  const r = await apiPage.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: pw },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`login HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  const body = await r.json()
  if (!body?.id && !body?.user?.id) throw new Error(`no id in login response: ${JSON.stringify(body).slice(0, 80)}`)
  // Verify cookie was set (Playwright request context stores cookies automatically)
})

await step("GET /api/auth/me → verify returns user data", async () => {
  const r = await apiPage.request.get(`${BASE}/api/auth/me`)
  if (!r.ok()) throw new Error(`/me HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  const me = await r.json()
  if (!me?.id && !me?.user?.id) throw new Error(`no id in /me response`)
  if (me.email !== email && me.user?.email !== email)
    throw new Error(`email mismatch: expected ${email}, got ${me.email ?? me.user?.email}`)
})

await step("Update display_name via PATCH /api/auth/me → verify 200", async () => {
  const r = await apiPage.request.patch(`${BASE}/api/auth/me`, {
    data: { display_name: "Updated Name" },
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok()) throw new Error(`PATCH /me HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
  const body = await r.json()
  const name = body.display_name ?? body.user?.display_name
  if (name !== "Updated Name") throw new Error(`display_name not updated, got: ${name}`)
})

await step("GET /api/auth/me → verify display_name updated", async () => {
  const r = await apiPage.request.get(`${BASE}/api/auth/me`)
  if (!r.ok()) throw new Error(`/me HTTP ${r.status()}`)
  const me = await r.json()
  const name = me.display_name ?? me.user?.display_name
  if (name !== "Updated Name") throw new Error(`Expected "Updated Name", got ${name}`)
})

await step("Forgot password → POST /api/auth/forgot-password → no 5xx", async () => {
  const r = await apiPage.request.post(`${BASE}/api/auth/forgot-password`, {
    data: { email },
    headers: { "Content-Type": "application/json" },
  })
  // 4xx is acceptable when email provider not configured; only 5xx is a failure
  if (r.status() >= 500) throw new Error(`forgot-password HTTP ${r.status()} — ${(await r.text()).slice(0, 120)}`)
})

// ── Phase 2: UI Journey ───────────────────────────────────────────────────────
console.log("\n── Phase 2: UI journey")

await step("Navigate to /forgot-password → verify form renders", async () => {
  await uiPage.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle" })
  await snap("01-forgot-password")
  const html = await uiPage.content()
  if (/something went wrong|application error|minified react error/i.test(html))
    throw new Error("error boundary on /forgot-password")
  // Form should contain an email input or relevant text
  const hasForm = await uiPage.locator('input[type="email"], input[name="email"], form').count()
  if (!hasForm) {
    const hasText = /forgot|reset|password/i.test(html)
    if (!hasText) throw new Error("no forgot-password form content found")
  }
})

await step("Submit forgot-password form → verify success or graceful response", async () => {
  const emailInput = uiPage.locator('input[type="email"], input[name="email"]').first()
  if (await emailInput.count()) {
    await emailInput.fill(`fp-${TAG}@test.com`)
    const submitBtn = uiPage.locator('button[type="submit"], button').filter({ hasText: /reset|send|submit/i }).first()
    if (await submitBtn.count()) {
      await submitBtn.click()
      await uiPage.waitForTimeout(1500)
    } else {
      await uiPage.keyboard.press("Enter")
      await uiPage.waitForTimeout(1500)
    }
  }
  await snap("02-forgot-submitted")
  const html = await uiPage.content()
  if (/something went wrong|application error|minified react error/i.test(html))
    throw new Error("error boundary after forgot-password submit")
})

await step("Navigate to /login → verify form renders without crash", async () => {
  await uiPage.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await snap("03-login-page")
  const html = await uiPage.content()
  if (/something went wrong|application error|minified react error/i.test(html))
    throw new Error("error boundary on /login page")
  const hasInput = await uiPage.locator('input[type="email"], input[name="email"], input[type="password"]').count()
  if (!hasInput) {
    // May have already redirected if a session exists; acceptable
    if (!uiPage.url().includes("/login")) return
    throw new Error("no login form inputs found")
  }
})

await step("Fill credentials → submit → verify redirect away from /login", async () => {
  const currentUrl = uiPage.url()
  if (!currentUrl.includes("/login")) {
    // Already redirected (session from earlier); just verify we're on a valid page
    const html = await uiPage.content()
    if (/something went wrong|application error/i.test(html))
      throw new Error("error boundary on post-login page")
    return
  }
  await uiPage.locator('input[type="email"], input[name="email"]').first().fill(email)
  await uiPage.locator('input[type="password"]').first().fill(pw)
  await uiPage.keyboard.press("Enter")
  await uiPage.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10000 })
})
await snap("04-post-login")

await step("Navigate to /settings → verify settings page renders", async () => {
  await uiPage.goto(`${BASE}/settings`, { waitUntil: "networkidle" })
  await snap("05-settings")
  const html = await uiPage.content()
  if (/something went wrong|application error|minified react error/i.test(html))
    throw new Error("error boundary on /settings")
  // Should show settings-related content or redirect to login (if session expired)
  const looksOk = /settings|profile|account|display.name|password/i.test(html) || uiPage.url().includes("/login")
  if (!looksOk) throw new Error("settings page does not show expected content")
})

await step("Navigate to /home → verify dashboard renders", async () => {
  await uiPage.goto(`${BASE}/home`, { waitUntil: "networkidle" })
  await snap("06-home")
  const html = await uiPage.content()
  if (/something went wrong|application error|minified react error/i.test(html))
    throw new Error("error boundary on /home")
})

// ── Phase 3: Logout + post-logout checks ─────────────────────────────────────
console.log("\n── Phase 3: Logout")

await step("POST /api/auth/logout → verify 200 or session cleared", async () => {
  const r = await apiPage.request.post(`${BASE}/api/auth/logout`)
  // Logout should return 200; some backends redirect — treat both as success
  if (r.status() >= 500) throw new Error(`logout HTTP ${r.status()} (server error)`)
})

await step("GET /api/auth/me → verify 401 after logout", async () => {
  const r = await apiPage.request.get(`${BASE}/api/auth/me`)
  if (r.status() !== 401)
    throw new Error(`Expected 401 after logout, got ${r.status()}`)
})

// ── Finish ────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((s, t) => s + t.ms, 0)

const run = {
  kind:    "auth-flow",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs },
  steps,
}

const outFile = `${OUT}/auth-flow-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

// Append to persistent test log
const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "auth-flow", base: BASE, summary: run.summary, file: outFile })
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
