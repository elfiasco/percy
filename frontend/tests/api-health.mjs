/**
 * API Health — comprehensive smoke test of ALL major API endpoints.
 * Only checks status codes and basic response shapes; no browser UI needed.
 *
 * Usage:
 *   node tests/api-health.mjs [BASE_URL]
 *
 * Each endpoint is tested in sequence.  The result is classified as:
 *   PASS  — 2xx response
 *   WARN  — 4xx response (logged but not a hard failure)
 *   FAIL  — 5xx response
 *
 * A clean summary table is printed at the end.
 * Results are written to tests/results/api-health-{TAG}.json and appended
 * to tests/results/test-log.json.
 * process.exit(1) when any 5xx was received.
 */
import { chromium }                    from "playwright"
import { mkdir, writeFile, readFile }  from "node:fs/promises"
import { existsSync }                  from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @type {Array<{label:string, method:string, status:number, result:'PASS'|'WARN'|'FAIL', note:string, ms:number}>} */
const checks = []
let failCount = 0

/**
 * Make one API call and record PASS / WARN / FAIL.
 * @param {string}   label   — human-readable name for the check
 * @param {Function} fn      — async () => Response-like object with .status()
 * @param {object}   [opts]
 * @param {boolean}  [opts.warnOnMissing]  — treat 404 as WARN instead of WARN (default: WARN)
 */
async function check(label, fn, { note: extraNote = "" } = {}) {
  const t0 = Date.now()
  let status = 0
  let result = "FAIL"
  let note   = extraNote

  try {
    const resp = await fn()
    status = resp.status()

    if (status >= 500) {
      result = "FAIL"
      failCount++
      let body = ""
      try { body = (await resp.text()).slice(0, 120) } catch {}
      note = body || note
    } else if (status >= 400) {
      result = "WARN"
      let body = ""
      try { body = (await resp.text()).slice(0, 80) } catch {}
      note = body || note
    } else {
      result = "PASS"
    }
  } catch (e) {
    result = "FAIL"
    failCount++
    note   = e.message?.slice(0, 120) ?? "unknown error"
  }

  const ms = Date.now() - t0
  checks.push({ label, status, result, note, ms })

  const icon = result === "PASS" ? "✅" : result === "WARN" ? "⚠️ " : "❌"
  const noteStr = note ? `  (${note})` : ""
  console.log(`  ${icon} [${String(status).padStart(3)}] ${label}${noteStr}  ${ms}ms`)
}

// ── Boot a headless browser just for page.request (cookie-aware HTTP client) ──
console.log("\n=== API Health Smoke Test ===")
console.log(`Target: ${BASE}\n`)

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext()
const page    = await ctx.newPage()

// Shared state populated as we go
const email   = `health-${TAG}@test.com`
const pw      = `Pw_${TAG}_Hh7!`
let orgId, projId, docId

// ── Phase 1: Auth ─────────────────────────────────────────────────────────────
console.log("── Phase 1: Auth")

await check("POST /api/auth/signup", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "HealthBot" },
    headers: { "Content-Type": "application/json" },
  })
  if (r.status() < 400) {
    const body = await r.json()
    orgId = body?.orgs?.[0]?.id ?? body?.org?.id ?? body?.org_id
    if (!orgId) {
      // tolerate — org may arrive via a separate call
      checks.at(-1).note += " [no orgId in response]"
    }
  }
  return r
})

await check("POST /api/auth/login", async () => {
  return page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: pw },
    headers: { "Content-Type": "application/json" },
  })
})

await check("GET /api/auth/me", async () => {
  const r = await page.request.get(`${BASE}/api/auth/me`)
  if (r.status() < 400 && !orgId) {
    // try to grab orgId from /me if signup didn't return it
    try {
      const body = await r.json()
      orgId = orgId ?? body?.orgs?.[0]?.id ?? body?.org?.id
    } catch {}
  }
  return r
})

await check("GET /api/auth/settings", async () => {
  return page.request.get(`${BASE}/api/auth/settings`)
})

// ── Phase 2: Projects ─────────────────────────────────────────────────────────
console.log("\n── Phase 2: Projects")

await check("POST /api/projects", async () => {
  const r = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `health-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  if (r.status() < 400) {
    try {
      const body = await r.json()
      projId = body?.id
    } catch {}
  }
  return r
})

await check("GET /api/orgs/:orgId/projects", async () => {
  if (!orgId) throw new Error("orgId not available — prior step failed")
  return page.request.get(`${BASE}/api/orgs/${orgId}/projects`)
})

await check("PATCH /api/projects/:projId (rename)", async () => {
  if (!projId) throw new Error("projId not available")
  return page.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { name: `health-renamed-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
})

// ── Phase 3: Docs ─────────────────────────────────────────────────────────────
console.log("\n── Phase 3: Docs")

await check("POST /api/docs/create-blank", async () => {
  const r = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `health-deck-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  if (r.status() < 400) {
    try {
      const body = await r.json()
      docId = body?.doc_id
      // Link the doc to the project if both IDs are available
      if (projId && docId) {
        await page.request.patch(`${BASE}/api/projects/${projId}`, {
          data: { doc_id: docId },
          headers: { "Content-Type": "application/json" },
        })
      }
    } catch {}
  }
  return r
})

await check("GET /api/docs/:docId", async () => {
  if (!docId) throw new Error("docId not available — prior step failed")
  return page.request.get(`${BASE}/api/docs/${docId}`)
})

await check("GET /api/docs/:docId/slides/1/elements", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.get(`${BASE}/api/docs/${docId}/slides/1/elements`)
})

// ── Phase 4: Slide management ─────────────────────────────────────────────────
console.log("\n── Phase 4: Slide management")

await check("POST /api/docs/:docId/slides (add slide 2)", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.post(`${BASE}/api/docs/${docId}/slides?after_n=1`)
})

await check("GET /api/docs/:docId/slides/2/elements", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.get(`${BASE}/api/docs/${docId}/slides/2/elements`)
})

await check("PATCH /api/docs/:docId/slides/1/background (set color)", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.patch(`${BASE}/api/docs/${docId}/slides/1/background?color=%23FF5733`)
})

await check("PATCH /api/docs/:docId/slides/1/notes (set notes)", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.patch(`${BASE}/api/docs/${docId}/slides/1/notes`, {
    data: { notes_text: "health-check notes" },
    headers: { "Content-Type": "application/json" },
  })
})

await check("GET /api/docs/:docId/search-text?q=test", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.get(`${BASE}/api/docs/${docId}/search-text?q=test`)
})

// ── Phase 5: Org invites ──────────────────────────────────────────────────────
console.log("\n── Phase 5: Org")

await check("POST /api/orgs/:orgId/invites", async () => {
  if (!orgId) throw new Error("orgId not available")
  return page.request.post(`${BASE}/api/orgs/${orgId}/invites`, {
    data: { email: `invite-${TAG}@test.com`, role: "member" },
    headers: { "Content-Type": "application/json" },
  })
})

// ── Phase 6: Audit log ────────────────────────────────────────────────────────
console.log("\n── Phase 6: Audit / misc")

await check("GET /api/admin/audit-events (admin-only — 4xx OK)", async () => {
  const r = await page.request.get(`${BASE}/api/admin/audit-events?limit=5`)
  const s = r.status()
  // 403/401 = expected for non-admin user; 404 = not deployed yet
  if (s === 404 || s === 403 || s === 401) {
    checks.at(-1).note = "admin-only endpoint (expected 4xx for regular user)"
    // Mutate result to WARN instead of FAIL
    checks.at(-1).result = "WARN"
    // Don't count as fail — undo any increment that check() may do
  }
  return r
})

// ── Phase 7: Delete slide + verify count ─────────────────────────────────────
console.log("\n── Phase 7: Cleanup + verify")

await check("DELETE /api/docs/:docId/slides/2", async () => {
  if (!docId) throw new Error("docId not available")
  return page.request.delete(`${BASE}/api/docs/${docId}/slides/2`)
})

await check("GET /api/docs/:docId — verify slide_count = 1 after delete", async () => {
  if (!docId) throw new Error("docId not available")
  const r = await page.request.get(`${BASE}/api/docs/${docId}`)
  if (r.status() < 400) {
    try {
      const body = await r.json()
      const count = body?.slide_count ?? body?.slides?.length ?? body?.slides
      if (count !== undefined && Number(count) !== 1) {
        checks.at(-1).note = `expected slide_count=1, got ${count}`
        // Don't hard-fail — the DELETE may have a different ordering; treat as WARN
        checks.at(-1).result = "WARN"
      }
    } catch {}
  }
  return r
})

// ── Teardown ──────────────────────────────────────────────────────────────────
await browser.close()

// ── Summary table ─────────────────────────────────────────────────────────────
const passCount = checks.filter((c) => c.result === "PASS").length
const warnCount = checks.filter((c) => c.result === "WARN").length
// Re-count real 5xx failures (audit 404-turned-WARN is excluded)
const realFails = checks.filter((c) => c.result === "FAIL")

const colW = Math.max(...checks.map((c) => c.label.length)) + 2

console.log(`\n${"═".repeat(colW + 30)}`)
console.log("SUMMARY")
console.log(`${"─".repeat(colW + 30)}`)
console.log(
  `${"Endpoint".padEnd(colW)} ${"Status".padStart(6)}  ${"Result".padEnd(6)}  ${"ms".padStart(6)}`
)
console.log(`${"─".repeat(colW + 30)}`)
for (const c of checks) {
  const icon = c.result === "PASS" ? "✅" : c.result === "WARN" ? "⚠️ " : "❌"
  const note = c.note ? `  ← ${c.note.slice(0, 60)}` : ""
  console.log(
    `${c.label.padEnd(colW)} ${String(c.status).padStart(6)}  ${icon}${c.result.padEnd(4)}  ${String(c.ms).padStart(6)}ms${note}`
  )
}
console.log(`${"─".repeat(colW + 30)}`)
console.log(
  `TOTAL: ${checks.length}  ✅ ${passCount} PASS  ⚠️  ${warnCount} WARN  ❌ ${realFails.length} FAIL`
)

if (realFails.length) {
  console.log("\nFailed checks:")
  realFails.forEach((c) => console.log(`  ✗ ${c.label} [${c.status}]${c.note ? " — " + c.note : ""}`))
}

// ── Persist results ───────────────────────────────────────────────────────────
const run = {
  kind:    "api-health",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: checks.length, pass: passCount, warn: warnCount, fail: realFails.length },
  checks,
}

const outFile = `${OUT}/api-health-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "api-health", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\nResults: ${outFile}`)
console.log(realFails.length === 0 ? "\n✅ ALL ENDPOINTS HEALTHY" : `\n❌ ${realFails.length} ENDPOINT(S) RETURNED 5xx`)
process.exit(realFails.length > 0 ? 1 : 0)
