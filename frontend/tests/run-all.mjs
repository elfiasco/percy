/**
 * Master test runner — runs all Percy test suites in sequence and writes a
 * consolidated entry to tests/results/test-log.json.
 *
 * Usage:
 *   node tests/run-all.mjs [BASE_URL] [LM_STUDIO_URL]
 *
 * Suites run (critical):
 *   1.  holistic-ui              — smoke test (28 checks, 2 browser contexts)
 *   2.  new-project-flow         — full new-user golden path (20 steps)
 *   3.  create-deck-from-scratch — UI-driven deck creation (11 steps)
 *   4.  database-health          — API smoke test covering every major endpoint
 *   5.  api-health               — deep API endpoint health check (21 checks)
 *   6.  slide-operations         — slide CRUD (add/delete/bg/notes/elements)
 *   7.  element-operations       — element CRUD (create/edit/style/duplicate/delete)
 *   8.  element-gallery          — all 12 shape types + image upload, style/text/position
 *   9.  auth-flow                — full auth lifecycle (signup/login/settings/logout)
 * Suites run (optional):
 *   10. export-test              — PPTX download + re-upload round-trip
 *   11. collab-yjs               — Yjs real-time collab (2 browser sessions)
 *   12. performance-smoke        — Response time measurements (no hard fail)
 *   13. agent-mode               — AI agent panel UI + API checks (needs API key)
 *   14. adversarial-users        — LM Studio generates edge cases
 *   15. vision-critique          — Gemma 4 vision reviews every major page
 *
 * Each suite writes its own timestamped JSON to tests/results/.
 * This file appends a summary row to test-log.json after every run.
 */
import { execFile }                  from "node:child_process"
import { promisify }                 from "node:util"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                from "node:fs"

const exec    = promisify(execFile)
const BASE    = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const LM_URL  = process.argv[3] || "http://localhost:1234"
const OUT     = "tests/results"
const TAG     = Date.now()

await mkdir(OUT, { recursive: true })

const SUITES = [
  // Critical: these must pass on every deploy
  { name: "holistic-ui",              file: "tests/holistic-ui.mjs",              args: [BASE],           critical: true  },
  { name: "new-project-flow",         file: "tests/new-project-flow.mjs",         args: [BASE],           critical: true  },
  { name: "create-deck-from-scratch", file: "tests/create-deck-from-scratch.mjs", args: [BASE],           critical: true  },
  { name: "database-health",          file: "tests/database-health.mjs",          args: [BASE],           critical: true  },
  { name: "api-health",               file: "tests/api-health.mjs",               args: [BASE],           critical: true  },
  { name: "slide-operations",         file: "tests/slide-operations.mjs",         args: [BASE],           critical: true  },
  { name: "element-operations",       file: "tests/element-operations.mjs",       args: [BASE],           critical: true  },
  { name: "element-gallery",          file: "tests/element-gallery.mjs",          args: [BASE],           critical: true  },
  { name: "auth-flow",                file: "tests/auth-flow.mjs",                args: [BASE],           critical: true  },
  { name: "export-test",              file: "tests/export-test.mjs",              args: [BASE],           critical: false },
  { name: "collab-yjs",               file: "tests/collab-yjs.mjs",               args: [BASE],           critical: false },
  { name: "performance-smoke",        file: "tests/performance-smoke.mjs",        args: [BASE],           critical: false },
  // Optional: require LM Studio or external services
  { name: "agent-mode",               file: "tests/agent-mode.mjs",               args: [BASE],           critical: false },
  { name: "adversarial-users",        file: "tests/adversarial-users.mjs",        args: [BASE, LM_URL],   critical: false },
  { name: "vision-critique",          file: "tests/vision-critique.mjs",          args: [BASE, LM_URL],   critical: false },
]

console.log("╔══════════════════════════════════════╗")
console.log("║    Percy Full Test Suite Runner       ║")
console.log("╚══════════════════════════════════════╝")
console.log(`App:      ${BASE}`)
console.log(`LM:       ${LM_URL}`)
console.log(`Run ID:   ${TAG}`)
console.log(`Suites:   ${SUITES.map((s) => s.name).join(", ")}\n`)

const runResults = []

for (const suite of SUITES) {
  console.log(`\n${"▶".repeat(1)} Running ${suite.name}…`)
  console.log("─".repeat(50))
  const t0 = Date.now()
  let exitCode = 0
  let output   = ""

  try {
    const result = await exec("node", [suite.file, ...suite.args], {
      timeout: 360_000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: process.cwd(),
    })
    output = result.stdout + result.stderr
    process.stdout.write(output)
  } catch (err) {
    exitCode = err.code ?? 1
    output   = (err.stdout ?? "") + (err.stderr ?? "")
    process.stdout.write(output)
    if (!suite.critical) {
      console.log(`  (non-critical suite exited ${exitCode})`)
    }
  }

  const ms = Date.now() - t0
  runResults.push({
    suite:    suite.name,
    critical: suite.critical,
    ok:       exitCode === 0,
    exitCode,
    ms,
  })

  console.log(`\n${"─".repeat(50)}`)
  console.log(`${suite.name}: ${exitCode === 0 ? "✅ PASS" : "❌ FAIL"} (${(ms / 1000).toFixed(1)}s)`)
}

// ── Final summary ─────────────────────────────────────────────────────────────
const critFails = runResults.filter((r) => r.critical && !r.ok)
const allPassed = runResults.every((r) => r.ok)
const totalMs   = runResults.reduce((s, r) => s + r.ms, 0)

console.log("\n╔══════════════════════════════════════╗")
console.log("║           SUITE SUMMARY               ║")
console.log("╚══════════════════════════════════════╝")
for (const r of runResults) {
  const tag = r.critical ? "[CRITICAL]" : "[OPTIONAL]"
  console.log(`  ${r.ok ? "✅" : "❌"} ${tag} ${r.suite} (${(r.ms / 1000).toFixed(1)}s)`)
}
console.log(`\nTotal time: ${(totalMs / 1000).toFixed(0)}s`)
console.log(
  critFails.length === 0
    ? "\n✅ ALL CRITICAL SUITES PASSED"
    : `\n❌ ${critFails.length} CRITICAL SUITE(S) FAILED: ${critFails.map((r) => r.suite).join(", ")}`
)

// ── Persist to test log ───────────────────────────────────────────────────────
const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}

const entry = {
  ts:       new Date().toISOString(),
  runId:    TAG,
  suite:    "full-run",
  base:     BASE,
  lmUrl:    LM_URL,
  suites:   runResults,
  allPassed,
  critFailed: critFails.map((r) => r.suite),
  totalMs,
}
log.push(entry)
await writeFile(logPath, JSON.stringify(log, null, 2))
console.log(`\nTest log: ${logPath}`)

process.exit(critFails.length === 0 ? 0 : 1)
