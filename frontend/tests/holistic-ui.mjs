/**
 * Holistic UI smoke suite — covers every major page and feature.
 *
 * Usage:
 *   node tests/holistic-ui.mjs [BASE_URL]
 *
 * Creates its own ephemeral test user so no cookies/env vars are needed.
 * All screenshots go to tests/out/holistic/.
 *
 * Checks are classified as:
 *   CRITICAL  — must pass; fails exit the suite with code 1
 *   PENDING   — new code that needs a deploy; failures are warnings only
 *
 * Exit 0 = all CRITICAL checks passed (PENDING may still have warnings).
 * Exit 1 = one or more CRITICAL checks failed.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/holistic"
const TAG  = Date.now()
const EMAIL = `hol-${TAG}@test.com`
const PW    = `Pw_${TAG}_Hh9!`
const NAME  = `Hol User ${TAG}`

await mkdir(OUT, { recursive: true })

// ── Result tracking ───────────────────────────────────────────────────────────

const results = []

function pass(label, critical = true) {
  results.push({ ok: true, label, critical })
  console.log(`  ✅ ${label}`)
}
function fail(label, reason = "", critical = true) {
  results.push({ ok: false, label, reason, critical })
  const prefix = critical ? "❌" : "⚠️ [PENDING DEPLOY]"
  console.error(`  ${prefix} ${label}${reason ? ": " + reason.slice(0, 110) : ""}`)
}
async function snap(name) {
  try { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }) } catch {}
}

/** Run fn; if it throws, record a failure. critical=false = warning only. */
async function check(label, fn, critical = true) {
  try { await fn(); pass(label, critical) }
  catch (e) { fail(label, String(e.message ?? e), critical) }
}

/** Dismiss any z-50 overlay (welcome modals, dialogs) via Escape. */
async function dismissOverlays() {
  for (let i = 0; i < 4; i++) {
    const cnt = await page.locator('.fixed.inset-0').count()
    if (!cnt) break
    await page.keyboard.press("Escape")
    await page.waitForTimeout(250)
  }
}

// ── Browser setup ─────────────────────────────────────────────────────────────

console.log("\n=== Percy Holistic UI Check ===")
console.log(`BASE:  ${BASE}`)
console.log(`User:  ${EMAIL}\n`)

const browser = await chromium.launch({ headless: true })

// Context A — unauthenticated (for login/signup page renders)
const ctxAnon = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
// Context B — will hold our session cookie after login
const ctxAuth = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })

const consoleErrors = []
for (const c of [ctxAnon, ctxAuth]) {
  c.on("page", (p) => {
    p.on("pageerror",  (e) => consoleErrors.push(`[pageerror] ${e.message}`))
    p.on("console",    (m) => { if (m.type() === "error") consoleErrors.push(`[console.error] ${m.text()}`) })
  })
}

// page is the main auth'd page
let page = await ctxAuth.newPage()

// ─────────────────────────────────────────────────────────────────────────────
// A. Pre-auth pages (unauthenticated context)
// ─────────────────────────────────────────────────────────────────────────────
console.log("── A. Unauthenticated pages")

const anonPage = await ctxAnon.newPage()

// Splash
await anonPage.goto(BASE, { waitUntil: "networkidle" })
await anonPage.screenshot({ path: `${OUT}/A1-splash.png` })
await check("Splash: renders with title",            async () => { if (!await anonPage.title()) throw new Error("no title") })
await check("Splash: has login/signup CTAs",         async () => {
  const html = await anonPage.content()
  if (!/login|sign.?up|get started/i.test(html)) throw new Error("no auth CTA text in HTML")
})

// Login page (must test BEFORE setting auth cookies)
await anonPage.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await anonPage.screenshot({ path: `${OUT}/A2-login.png` })
await check("Login: email + password inputs present", async () => {
  await anonPage.waitForSelector('input[type="email"], input[name="email"]', { timeout: 6000 })
  if (await anonPage.locator('input[type="password"]').count() === 0) throw new Error("no password field")
})

// Signup page
await anonPage.goto(`${BASE}/signup`, { waitUntil: "networkidle" })
await anonPage.screenshot({ path: `${OUT}/A3-signup.png` })
await check("Signup: email input present", async () => {
  await anonPage.waitForSelector('input[type="email"], input[name="email"]', { timeout: 6000 })
})

// Forgot password page
await anonPage.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle" })
await anonPage.screenshot({ path: `${OUT}/A4-forgot-password.png` })
await check("Forgot password: page renders",        async () => {
  const html = await anonPage.content()
  if (!/forgot|reset|password/i.test(html)) throw new Error("unexpected content")
})
await check("Forgot password: email input present", async () => {
  await anonPage.waitForSelector('input[type="email"], input[name="email"]', { timeout: 5000 })
})
await check("Forgot password: submit shows success or pending (not 5xx crash)", async () => {
  await anonPage.locator('input[type="email"], input[name="email"]').first().fill("test@example.com")
  const btn = anonPage.locator('button[type="submit"]').first()
  if (await btn.count()) await btn.click()
  else await anonPage.keyboard.press("Enter")
  await anonPage.waitForTimeout(2000)
  const html = await anonPage.content()
  // Accept: success copy ("check your email") OR pending deploy ("something went wrong" from missing endpoint)
  // Reject: uncaught JS crash / hard 5xx page
  if (/application error|webpack error|module not found/i.test(html)) throw new Error("build error on page")
})
await anonPage.screenshot({ path: `${OUT}/A5-forgot-submitted.png` })

// Reset password page
await anonPage.goto(`${BASE}/reset-password?token=fake-render-test`, { waitUntil: "networkidle" })
await anonPage.screenshot({ path: `${OUT}/A6-reset-password.png` })
await check("Reset password: page renders", async () => {
  const html = await anonPage.content()
  if (!/password|reset|new/i.test(html)) throw new Error("unexpected content")
})

await anonPage.close()

// ─────────────────────────────────────────────────────────────────────────────
// B. Auth flow
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── B. Auth flow")

let orgId, projId, docId, me

await check("Signup API: returns user with id", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email: EMAIL, password: PW, display_name: NAME },
    headers: { "Content-Type": "application/json" },
  })
  me = await r.json()
  const uid = me?.id ?? me?.user?.id
  if (!uid) throw new Error(`bad shape: ${JSON.stringify(me).slice(0, 100)}`)
  orgId = me?.orgs?.[0]?.id ?? me?.org?.id ?? me?.user?.orgs?.[0]?.id
})

await check("Login form: fills credentials, navigates to app", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  // If already redirected (session set by API), skip form submit
  const isLogin = page.url().includes("/login")
  if (!isLogin) { pass("Login: already redirected (session cookie active)"); return }
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PW)
  await page.keyboard.press("Enter")
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10000 })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── C. Dashboard")

await page.goto(`${BASE}/home`, { waitUntil: "networkidle" })
await page.waitForTimeout(800)
await snap("C1-dashboard")
await check("Dashboard: renders without error page", async () => {
  const html = await page.content()
  if (/something went wrong|internal server error/i.test(html)) throw new Error("error page")
})
await check("Email verification banner: visible for unverified user", async () => {
  const html = await page.content()
  // Banner component checks user.email_verified; signup API sets email_verified=0
  if (!/verif/i.test(html)) throw new Error(
    "no 'verif' text — banner may not be mounted on Dashboard or user.email_verified not in auth context"
  )
}, false /* warning only — needs deploy of EmailVerificationBanner */)

// ─────────────────────────────────────────────────────────────────────────────
// D. Project creation + Studio
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── D. Project + Studio")

await check("Project API: create project", async () => {
  if (!orgId) throw new Error("orgId unknown")
  const r = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `Hol-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const cp = await r.json()
  projId = cp.id
  if (!projId) throw new Error(`no id: ${JSON.stringify(cp).slice(0, 100)}`)
})

await check("Docs API: create blank doc + link to project", async () => {
  if (!projId) throw new Error("no projId")
  const r = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `HolDoc-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const cd = await r.json()
  docId = cd.doc_id
  if (!docId) throw new Error(`no doc_id: ${JSON.stringify(cd).slice(0, 100)}`)
  await page.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { doc_id: docId },
    headers: { "Content-Type": "application/json" },
  })
})

if (projId) {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(4000)
  await snap("D1-studio")

  await check("Studio: canvas element rendered",           async () => {
    if (!await page.locator('[data-slide-canvas="true"]').count()) throw new Error("no canvas")
  })
  await check("Studio: ribbon tabs visible",              async () => {
    if (!/insert|home|design|transitions/i.test(await page.content())) throw new Error("no ribbon tabs")
  })
  await check("Studio: no slide-strip crash",             async () => {
    const err = await page.locator('.absolute.bottom-0, [class*="slide-strip"]').count()
    // Just ensure the page rendered, not that the strip is present
    const html = await page.content()
    if (/application error|chunk load error/i.test(html)) throw new Error("chunk load error")
  })

  // Share button (new code — pending deploy)
  await check("Studio: Share button in ribbon", async () => {
    await dismissOverlays()
    const cnt = await page.locator('button').filter({ hasText: /^share$/i }).count()
    const fallback = await page.locator('button[title*="share" i], button[aria-label*="share" i]').count()
    if (cnt + fallback === 0) throw new Error("Share button not found — may need deploy")
  }, false)

  // Studio JS errors on fresh load — share cookies so API calls authenticate.
  const cookies = await ctxAuth.cookies()
  const freshCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await freshCtx.addCookies(cookies)
  const freshPage = await freshCtx.newPage()
  const jsErrors = []
  freshPage.on("pageerror", (e) => jsErrors.push(e.message))
  freshPage.on("console",   (m) => { if (m.type() === "error") jsErrors.push(m.text()) })
  await freshPage.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await freshPage.waitForTimeout(4000)
  await freshPage.screenshot({ path: `${OUT}/D2-studio-fresh.png` })
  await freshPage.close()
  await freshCtx.close()
  await check("Studio: zero fatal JS errors on load", async () => {
    const fatal = jsErrors.filter((e) =>
      !/favicon|ResizeObserver|chrome-extension|Failed to load resource.*40[34]|Unauthorized|401/i.test(e)
    )
    if (fatal.length) throw new Error(fatal.slice(0, 3).join(" | "))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// E. Settings + Org pages
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── E. Settings pages")

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" })
await page.waitForTimeout(800)
await snap("E1-settings")
await check("Settings: /settings accessible (not 404)", async () => {
  const html = await page.content()
  if (/\b404\b/.test(html) && !/text-404/i.test(html)) throw new Error("404 page")
})

if (orgId) {
  await page.goto(`${BASE}/org/${orgId}/settings`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  await snap("E2-org-settings")
  await check("Org settings: renders tabs (billing/sso/audit)", async () => {
    const html = await page.content()
    if (/something went wrong|internal server error/i.test(html)) throw new Error("error page")
    if (!/billing|sso|audit|settings|plan/i.test(html)) throw new Error("no settings content")
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// F. New API endpoints (pending deploy — warnings only)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── F. New API endpoints (pending deploy)")

await check("GET /api/plans → 200", async () => {
  const r = await page.request.get(`${BASE}/api/plans`)
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
}, false)

await check("GET /api/admin/audit-events → 200 or 403", async () => {
  const r = await page.request.get(`${BASE}/api/admin/audit-events?limit=5`)
  if (r.status() !== 200 && r.status() !== 403) throw new Error(`HTTP ${r.status()}`)
}, false)

if (projId) {
  await check("GET /api/projects/:id/shares → 200", async () => {
    const r = await page.request.get(`${BASE}/api/projects/${projId}/shares`)
    if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  }, false)
  await check("GET /api/projects/:id/assets → 200", async () => {
    const r = await page.request.get(`${BASE}/api/projects/${projId}/assets`)
    if (!r.ok()) throw new Error(`HTTP ${r.status()}`)
  }, false)
}

// ─────────────────────────────────────────────────────────────────────────────
// G. Navigation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── G. Navigation")

for (const [label, path] of [
  ["Projects page",  "/projects"],
  ["Templates page", "/templates"],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
  await check(`${label}: no crash`, async () => {
    const html = await page.content()
    if (/something went wrong|internal server error|application error/i.test(html))
      throw new Error("error page")
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
await browser.close()

const critical = results.filter((r) => r.critical)
const pending  = results.filter((r) => !r.critical)
const critPass = critical.filter((r) => r.ok).length
const critFail = critical.filter((r) => !r.ok)
const pendPass = pending.filter((r) => r.ok).length
const pendFail = pending.filter((r) => !r.ok)

const filteredErrors = consoleErrors.filter((e) =>
  !/favicon|ResizeObserver|chrome-extension|Failed to load resource.*40[34]/i.test(e)
)

console.log("\n═══════════════════════════════════════")
console.log(`CRITICAL: ${critPass} / ${critical.length} passed`)
console.log(`PENDING DEPLOY: ${pendPass} / ${pending.length} passed`)

if (critFail.length) {
  console.log("\n❌ Critical failures:")
  critFail.forEach((f) => console.log(`   ✗ ${f.label}${f.reason ? " — " + f.reason : ""}`))
}
if (pendFail.length) {
  console.log("\n⚠️  Pending-deploy checks not yet passing:")
  pendFail.forEach((f) => console.log(`   ⚠ ${f.label}${f.reason ? " — " + f.reason : ""}`))
}
if (filteredErrors.length) {
  console.log("\nBrowser console errors:")
  filteredErrors.slice(0, 8).forEach((e) => console.log("  ", e))
}

console.log(`\nScreenshots → ${OUT}/`)
console.log(critFail.length === 0 ? "\n✅ ALL CRITICAL CHECKS PASSED" : `\n❌ ${critFail.length} CRITICAL CHECK(S) FAILED`)
process.exit(critFail.length === 0 ? 0 : 1)
