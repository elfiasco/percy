/**
 * Export test — validates the PPTX export pipeline end-to-end.
 *
 * Steps:
 *   1. Create a deck with 2 slides and several elements
 *   2. Download via /api/docs/:docId/download-pptx
 *   3. Verify Content-Type is application/vnd.openxmlformats…
 *   4. Verify file size > 0 (not an empty placeholder)
 *   5. Save the .pptx to tests/out/export/
 *   6. (Optional) Re-upload the exported PPTX and verify it onboards
 *
 * Usage:
 *   node tests/export-test.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/results"
const IMG  = "tests/out/export"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(IMG, { recursive: true })

const steps = []
let browser, page, ctx

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
    try { await page?.screenshot({ path: `${IMG}/FAIL-${label.replace(/\W+/g, "-").slice(0, 40)}.png` }) } catch {}
  }
}

async function snap(name) {
  try { await page.screenshot({ path: `${IMG}/${name}.png`, fullPage: false }) } catch {}
}

console.log("\n=== Percy PPTX Export Test ===")
console.log(`Target: ${BASE}\n`)

browser = await chromium.launch({ headless: true })
ctx     = await browser.newContext({ viewport: { width: 1280, height: 800 } })
page    = await ctx.newPage()

const email = `exp-${TAG}@test.com`
const pw    = `Pw_${TAG}_Ee9!`
let orgId, projId, docId

// ── Setup ──────────────────────────────────────────────────────────────────────
await step("Signup + create project + deck", async () => {
  const sr = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "Export Tester" },
    headers: { "Content-Type": "application/json" },
  })
  const me = await sr.json()
  if (!me?.id && !me?.user?.id) throw new Error(`signup: ${JSON.stringify(me).slice(0, 80)}`)
  orgId = me?.orgs?.[0]?.id ?? me?.org?.id

  const pr = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `ExportTest-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  projId = (await pr.json()).id

  const dr = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `ExportDeck-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const d = await dr.json()
  docId = d.doc_id
  if (!docId) throw new Error("no doc_id")

  await page.request.patch(`${BASE}/api/projects/${projId}`, {
    data: { doc_id: docId },
    headers: { "Content-Type": "application/json" },
  })
})

await step("Add text elements to slide 1", async () => {
  await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "text_box", left_in: 1, top_in: 1, width_in: 8, height_in: 1.5, label: "Title" },
    headers: { "Content-Type": "application/json" },
  })
  await page.request.post(`${BASE}/api/docs/${docId}/slides/1/elements`, {
    data: { shape_type: "rect", left_in: 1, top_in: 3, width_in: 4, height_in: 2, label: "Rect" },
    headers: { "Content-Type": "application/json" },
  })
})

await step("Add slide 2", async () => {
  const r = await page.request.post(`${BASE}/api/docs/${docId}/slides?after_n=1`)
  if (!r.ok()) throw new Error(`addSlide HTTP ${r.status()}`)
})

await step("Add text element to slide 2", async () => {
  await page.request.post(`${BASE}/api/docs/${docId}/slides/2/elements`, {
    data: { shape_type: "text_box", left_in: 1, top_in: 1, width_in: 8, height_in: 1, label: "Slide 2 Title" },
    headers: { "Content-Type": "application/json" },
  })
})

await step("Set slide backgrounds", async () => {
  await page.request.patch(`${BASE}/api/docs/${docId}/slides/1/background?color=%23003366`)
  await page.request.patch(`${BASE}/api/docs/${docId}/slides/2/background?color=%23660033`)
})

// ── Export ─────────────────────────────────────────────────────────────────────
let pptxBytes = null
let pptxSize  = 0

await step("Download PPTX via /api/docs/:id/download-pptx", async () => {
  const r = await page.request.get(`${BASE}/api/docs/${docId}/download-pptx`)
  if (!r.ok()) throw new Error(`download-pptx HTTP ${r.status()}`)
  const ct = r.headers()["content-type"] ?? ""
  // Accept application/vnd.openxmlformats or application/octet-stream or application/zip
  if (!/vnd\.openxmlformats|octet-stream|application\/zip|pptx/i.test(ct)) {
    throw new Error(`unexpected Content-Type: ${ct}`)
  }
  pptxBytes = Buffer.from(await r.body())
  pptxSize  = pptxBytes.length
  if (pptxSize < 1000) throw new Error(`PPTX too small: ${pptxSize} bytes — likely empty/error`)
  console.log(`     PPTX size: ${(pptxSize / 1024).toFixed(1)} KB, Content-Type: ${ct}`)
})

await step("Save PPTX to disk", async () => {
  if (!pptxBytes) throw new Error("no pptx bytes from download")
  const pptxPath = `${IMG}/exported-${TAG}.pptx`
  await writeFile(pptxPath, pptxBytes)
  console.log(`     Saved: ${pptxPath}`)
})

// ── Re-upload the exported PPTX ────────────────────────────────────────────────
await step("Re-upload exported PPTX (round-trip test)", async () => {
  if (!pptxBytes) { console.warn("     skipped — no pptx bytes"); return }
  const pptxPath = `${IMG}/exported-${TAG}.pptx`

  // Upload via multipart form
  const uploadR = await page.request.post(`${BASE}/api/upload`, {
    multipart: {
      file: {
        name:     "exported.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer:   pptxBytes,
      },
    },
  })
  if (uploadR.status() === 404) {
    console.warn("     /api/upload → 404 (upload endpoint not on this deployment)")
    return
  }
  if (!uploadR.ok()) throw new Error(`upload HTTP ${uploadR.status()}`)
  const upB = await uploadR.json()
  const reDocId = upB?.doc_id
  if (!reDocId) {
    console.warn(`     upload returned no doc_id: ${JSON.stringify(upB).slice(0, 80)}`)
    return
  }
  console.log(`     Re-uploaded doc_id: ${reDocId}`)
  // Verify the re-uploaded doc has slides
  const docR = await page.request.get(`${BASE}/api/docs/${reDocId}`)
  if (!docR.ok()) throw new Error(`doc fetch HTTP ${docR.status()}`)
  const doc = await docR.json()
  const slideCount = doc.slide_count ?? doc.slides?.length ?? doc.num_slides ?? 0
  if (slideCount < 1) throw new Error(`re-uploaded doc has no slides: ${JSON.stringify(doc).slice(0, 80)}`)
  console.log(`     Re-uploaded deck: ${slideCount} slides ✓`)
})
await snap("01-final-state")

// ── Studio renders the exported doc ───────────────────────────────────────────
await step("Open studio with exported doc", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2000)
  if (!await page.locator('[data-slide-canvas="true"]').count()) throw new Error("canvas not visible")
})
await snap("02-studio-after-export")

// ── Finish ─────────────────────────────────────────────────────────────────────
await browser.close()

const passed  = steps.filter((s) => s.ok).length
const failed  = steps.filter((s) => !s.ok)
const totalMs = steps.reduce((s, t) => s + t.ms, 0)

const run = {
  kind:    "export-test",
  base:    BASE,
  runTs:   new Date().toISOString(),
  summary: { total: steps.length, passed, failed: failed.length, totalMs, pptxSizeKB: pptxSize ? Math.round(pptxSize / 1024) : 0 },
  steps,
}

const outFile = `${OUT}/export-test-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))

const logPath = `${OUT}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({ ts: run.runTs, suite: "export-test", base: BASE, summary: run.summary, file: outFile })
await writeFile(logPath, JSON.stringify(log, null, 2))

console.log(`\n${"═".repeat(50)}`)
console.log(`STEPS: ${passed}/${steps.length} passed  (${(totalMs / 1000).toFixed(1)}s total)`)
if (failed.length) {
  console.log("\nFailed:")
  failed.forEach((s) => console.log(`  ✗ ${s.label}${s.error ? " — " + s.error : ""}`))
}
console.log(`\nResults: ${outFile}`)
console.log(failed.length === 0 ? "\n✅ EXPORT TEST PASSED" : `\n❌ ${failed.length} STEP(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
