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
 *   10. studio-ui-flow           — UI-driven deck creation, shape inserts, text edit, delete
 *   11. studio-undo-redo         — QAT buttons + Ctrl+Z/Y keyboard undo chain with API verify
 *   12. studio-text-editing      — 3 text boxes typed from UI, API /text verification, reload persist
 *   13. studio-keyboard-shortcuts— Delete, Ctrl+Z/Y chain, Escape deselect, complex key sequences
 *   14. studio-slide-management-ui — New Slide, strip navigation, per-slide element isolation
 *   15. studio-element-marathon  — 7-phase: build 5 → delete → undo → redo → multi-select delete
 *   16. studio-shape-format-inputs — Click element → ShapeFormat X/Y/W inputs → API verify position
 *   17. studio-multiselect       — 5 elements, shift-click 4, bulk Delete, undo
 *   18. studio-context-tab       — Auto-switch to ShapeFormat, return on deselect, View tab
 *   19. studio-insert-all-shapes — 6 shapes, 6× Ctrl+Z = 0, 6× Ctrl+Y = 6
 *   20. studio-type-and-verify-text — Two text boxes, full /text API verify, reload, delete
 * Suites run (optional):
 *   21. studio-view-and-zoom     — View tab, status bar Normal/Sorter/Focus, sorter modal
 *   22. export-test              — PPTX download + re-upload round-trip
 *   23. collab-yjs               — Yjs real-time collab (2 browser sessions)
 *   24. performance-smoke        — Response time measurements (no hard fail)
 *   25. agent-mode               — AI agent panel UI + API checks (needs API key)
 *   26. adversarial-users        — LM Studio generates edge cases
 *   27. vision-critique          — Gemma 4 vision reviews every major page
 *   28. vision-click-agent       — Vision model agent attempts PowerPoint editing tasks
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
  { name: "studio-ui-flow",             file: "tests/studio-ui-flow.mjs",             args: [BASE], critical: true  },
  { name: "studio-undo-redo",           file: "tests/studio-undo-redo.mjs",           args: [BASE], critical: true  },
  { name: "studio-text-editing",        file: "tests/studio-text-editing.mjs",        args: [BASE], critical: true  },
  { name: "studio-keyboard-shortcuts",  file: "tests/studio-keyboard-shortcuts.mjs",  args: [BASE], critical: true  },
  { name: "studio-slide-management-ui", file: "tests/studio-slide-management-ui.mjs", args: [BASE], critical: true  },
  { name: "studio-element-marathon",    file: "tests/studio-element-marathon.mjs",    args: [BASE], critical: true  },
  { name: "studio-shape-format-inputs", file: "tests/studio-shape-format-inputs.mjs", args: [BASE], critical: true  },
  { name: "studio-multiselect",         file: "tests/studio-multiselect.mjs",         args: [BASE], critical: true  },
  { name: "studio-context-tab",         file: "tests/studio-context-tab.mjs",         args: [BASE], critical: true  },
  { name: "studio-insert-all-shapes",   file: "tests/studio-insert-all-shapes.mjs",   args: [BASE], critical: true  },
  { name: "studio-type-and-verify-text",file: "tests/studio-type-and-verify-text.mjs",args: [BASE], critical: true  },
  { name: "studio-editing-visual",       file: "tests/studio-editing-visual.mjs",       args: [BASE], critical: false },
  { name: "studio-view-and-zoom",       file: "tests/studio-view-and-zoom.mjs",       args: [BASE], critical: false },
  { name: "export-test",              file: "tests/export-test.mjs",              args: [BASE],           critical: false },
  { name: "collab-yjs",               file: "tests/collab-yjs.mjs",               args: [BASE],           critical: false },
  { name: "performance-smoke",        file: "tests/performance-smoke.mjs",        args: [BASE],           critical: false },
  // Optional: require LM Studio or external services
  { name: "agent-mode",               file: "tests/agent-mode.mjs",               args: [BASE],           critical: false },
  { name: "adversarial-users",        file: "tests/adversarial-users.mjs",        args: [BASE, LM_URL],   critical: false },
  { name: "vision-critique",          file: "tests/vision-critique.mjs",          args: [BASE, LM_URL],   critical: false },
  { name: "vision-click-agent",       file: "tests/vision-click-agent.mjs",       args: [BASE, LM_URL],   critical: false },
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
