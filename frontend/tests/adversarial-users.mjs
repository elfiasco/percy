/**
 * Adversarial user simulation — uses LM Studio to generate hard/edge-case
 * inputs, then runs them through the Percy UI to verify the app handles them
 * gracefully (no crash, no 500, no XSS reflection, no data leakage).
 *
 * Usage:
 *   node tests/adversarial-users.mjs [BASE_URL] [LM_STUDIO_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE   = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const LM_URL = process.argv[3] || "http://localhost:1234"
const OUT    = "tests/results"
const TAG    = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir("tests/out/adversarial", { recursive: true })

// ── LM Studio — generate adversarial test cases ───────────────────────────────

const LM_MODEL = "google/gemma-4-e4b"

async function generateTestCases() {
  console.log(`Generating adversarial cases via ${LM_MODEL}…`)
  const r = await fetch(`${LM_URL}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      LM_MODEL,
      max_tokens: 800,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are a security and QA engineer. Generate 10 adversarial test cases for a SaaS web app " +
            "signup/login/project-name form. Return ONLY a JSON array of objects, each with: " +
            '"category" (string), "input" (the test string), "expect" (what should happen — "graceful_error"|"reject"|"accept"). ' +
            "Categories to cover: SQL injection, XSS, unicode/emoji, very long strings, null bytes, " +
            "path traversal, CRLF injection, homoglyph email, blank input, special HTML chars. " +
            "No markdown wrapping, just the raw JSON array.",
        },
        { role: "user", content: "Generate adversarial signup/project-name test cases for Percy." },
      ],
    }),
  })
  const data  = await r.json()
  const raw   = data.choices?.[0]?.message?.content ?? "[]"
  const match = raw.match(/\[[\s\S]*\]/)
  try {
    const cases = JSON.parse(match?.[0] ?? "[]")
    if (Array.isArray(cases) && cases.length) return cases
  } catch {}
  return staticCases()
}

function staticCases() {
  return [
    { category: "sql-injection",     input: "'; DROP TABLE users; --",                  expect: "graceful_error" },
    { category: "xss-basic",         input: '<script>alert("xss")</script>',             expect: "graceful_error" },
    { category: "xss-attr",          input: '" onmouseover="alert(1)"',                  expect: "graceful_error" },
    { category: "very-long",         input: "A".repeat(512),                             expect: "graceful_error" },
    { category: "unicode-rtl",       input: "‮test‬@evil.com",                 expect: "graceful_error" },
    { category: "emoji",             input: "user🔥💀@test.com",                        expect: "graceful_error" },
    { category: "null-byte",         input: "test\x00@example.com",                      expect: "graceful_error" },
    { category: "crlf-injection",    input: "test\r\nX-Injected: header",               expect: "graceful_error" },
    { category: "path-traversal",    input: "../../../etc/passwd",                       expect: "graceful_error" },
    { category: "html-entities",     input: "&lt;img src=x onerror=alert(1)&gt;",        expect: "accept" },
    { category: "blank-display-name",input: "   ",                                       expect: "graceful_error" },
    { category: "homoglyph-email",   input: "аdmin@example.com",                        expect: "graceful_error" }, // Cyrillic 'а'
  ]
}

// ── Browser setup ─────────────────────────────────────────────────────────────

console.log("\n=== Percy Adversarial User Simulation ===")
console.log(`Target: ${BASE}`)
console.log(`LM:     ${LM_URL}\n`)

const cases   = await generateTestCases()
console.log(`Got ${cases.length} test cases\n`)

const browser = await chromium.launch({ headless: true })
const results = []

// ── 1. Signup form adversarial inputs ─────────────────────────────────────────
console.log("── Signup form adversarial inputs")

for (const tc of cases) {
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const jsErrors = []
  page.on("pageerror", (e) => jsErrors.push(e.message))

  let outcome = "unknown"
  let detail  = ""

  try {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" })
    const emailIn = page.locator('input[type="email"], input[name="email"]').first()
    const pwIn    = page.locator('input[type="password"]').first()

    if (await emailIn.count() === 0) { outcome = "skip"; detail = "no email input"; }
    else {
      await emailIn.fill(tc.input.slice(0, 300))
      await pwIn.fill("Pw_adv_Aa9!")
      const nameIn = page.locator('input[name="display_name"], input[placeholder*="name" i]').first()
      if (await nameIn.count()) await nameIn.fill("Adv Tester")
      await page.keyboard.press("Enter")
      await page.waitForTimeout(1500)

      const html = await page.content()
      // Only flag truly unescaped script injection — NOT HTML-entity-encoded strings
      // which are harmless (&lt;img&gt; etc. cannot execute).
      const reflected = /<script[^>]*>.*alert/i.test(html) ||
        /<img[^>]+onerror\s*=\s*["']?alert/i.test(html)
      const crashed   = /application error|webpack.*error|chunk load error|unexpected error.*boundaries/i.test(html)
      const serverErr = /500 internal server error/i.test(html)

      if (reflected)  { outcome = "FAIL_XSS_REFLECTED";  detail = "input reflected unescaped" }
      else if (crashed) { outcome = "FAIL_CRASH";         detail = "app error boundary triggered" }
      else if (serverErr) { outcome = "FAIL_500";         detail = "500 server error page" }
      else if (jsErrors.filter((e) => !/ResizeObserver|favicon/.test(e)).length > 0)
                        { outcome = "WARN_JS_ERROR";       detail = jsErrors[0]?.slice(0, 100) }
      else              { outcome = "PASS_GRACEFUL";       detail = "handled without crash" }
    }
  } catch (e) {
    outcome = "FAIL_EXCEPTION"
    detail  = e.message?.slice(0, 100)
  }

  const icon = outcome.startsWith("PASS") ? "✅" : outcome.startsWith("WARN") ? "⚠️" : outcome.startsWith("skip") ? "⏭" : "❌"
  console.log(`  ${icon} [${tc.category.padEnd(20)}] ${outcome}`)
  results.push({ ...tc, outcome, detail, jsErrors: jsErrors.slice(0, 3) })

  await ctx.close()
}

// ── 2. API-level adversarial inputs (direct POST) ─────────────────────────────
console.log("\n── API-level adversarial inputs")

const apiCtx  = await browser.newContext()
const apiPage = await apiCtx.newPage()

const apiCases = [
  { label: "signup with SQL injection display_name", path: "/api/auth/signup",
    body: { email: `api-adv-${TAG}@test.com`, password: "Pw_Aa9!_api", display_name: "'; DROP TABLE studio_users; --" } },
  { label: "signup with oversized email (1000 chars)", path: "/api/auth/signup",
    body: { email: `${"a".repeat(950)}@x.com`, password: "Pw_Aa9!_x", display_name: "X" } },
  { label: "login with null password", path: "/api/auth/login",
    body: { email: `api-adv-${TAG}@test.com`, password: null } },
  { label: "create project with XSS name", path: "/api/projects",
    body: { org_id: "fake", name: '<img src=x onerror=alert(1)>' } },
  { label: "doc create with negative dimensions", path: "/api/docs/create-blank",
    body: { width_in: -999, height_in: -999, name: "BadDims" } },
]

for (const tc of apiCases) {
  let outcome = "unknown"
  let status  = 0
  try {
    const r = await apiPage.request.post(`${BASE}${tc.path}`, {
      data:    tc.body,
      headers: { "Content-Type": "application/json" },
    })
    status = r.status()
    // 5xx = bug; 4xx = expected rejection; 2xx = may be OK (check for reflected XSS in body)
    if (status >= 500) {
      outcome = `FAIL_5xx (${status})`
    } else if (status >= 400) {
      outcome = `PASS_REJECTED (${status})`
    } else {
      const body = await r.text()
      if (body.includes("<script>") || body.includes("onerror=alert")) {
        outcome = "FAIL_XSS_IN_RESPONSE"
      } else {
        outcome = `PASS_OK (${status})`
      }
    }
  } catch (e) {
    outcome = `ERROR: ${e.message?.slice(0, 80)}`
  }
  const icon = outcome.startsWith("PASS") ? "✅" : "❌"
  console.log(`  ${icon} ${tc.label}: ${outcome}`)
  results.push({ category: "api-direct", input: tc.label, expect: "graceful_error", outcome, detail: `HTTP ${status}` })
}

await apiCtx.close()
await browser.close()

// ── Write results ─────────────────────────────────────────────────────────────

const passCount = results.filter((r) => r.outcome?.startsWith("PASS")).length
const failCount = results.filter((r) => r.outcome?.startsWith("FAIL")).length
const warnCount = results.filter((r) => r.outcome?.startsWith("WARN")).length

const run = {
  kind:    "adversarial-users",
  base:    BASE,
  lmUrl:   LM_URL,
  runTs:   new Date().toISOString(),
  summary: { total: results.length, pass: passCount, warn: warnCount, fail: failCount },
  results,
}

const outFile = `${OUT}/adversarial-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

// Append to test log
const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "adversarial-users", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"─".repeat(50)}`)
console.log(`RESULTS: ${passCount} pass, ${warnCount} warn, ${failCount} fail / ${results.length} total`)
if (failCount > 0) {
  console.log("Failures:")
  results.filter((r) => r.outcome?.startsWith("FAIL")).forEach((r) =>
    console.log(`  ✗ [${r.category}] ${r.outcome} — ${r.detail}`)
  )
}
console.log(`\nFull results: ${outFile}`)
process.exit(failCount > 0 ? 1 : 0)
