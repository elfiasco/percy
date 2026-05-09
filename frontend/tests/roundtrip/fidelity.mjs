/**
 * Roundtrip Fidelity Test
 * =======================
 * Uploads a PPTX to Percy, screenshots each slide in the Studio canvas, fetches
 * the Bridge-model reference render from the backend, then calls compare.py to
 * produce a per-slide RMS score and diff images.
 *
 * Usage:
 *   node tests/roundtrip/fidelity.mjs [options]
 *
 * Options:
 *   --pptx <path>        Path to a PPTX file to test (can be repeated)
 *   --doc-id <id>        Reuse an already-uploaded doc (skips upload; requires --project-id)
 *   --project-id <id>    Project ID for the doc (use with --doc-id)
 *   --slides <range>     e.g. "1-5" or "1,3,5" (default: all)
 *   --base <url>         Backend base URL (default: http://localhost:8000)
 *   --out <dir>          Output directory (default: tests/out/roundtrip/<slug>)
 *   --top <n>            Top-N worst slides to diff (default: 5)
 *   --all-decks          Run against all PPTX files in ../../outreach/dump_pptx/
 *   --no-browser         Skip browser screenshots (compare from cached)
 *   --dpi <n>            DPI for reference renders (default: 120)
 *
 * Auth: Set PERCY_SESSION env var with a valid session cookie, or let the
 * script sign up a fresh test account. To reuse an account, set
 * PERCY_EMAIL + PERCY_PASS env vars.
 *
 * Examples:
 *   node tests/roundtrip/fidelity.mjs \
 *     --pptx ../../outreach/dump_pptx/snowflake_20260502_Snowflake_Template_light-2019.pptx
 *
 *   node tests/roundtrip/fidelity.mjs --pptx deck.pptx --slides 1-10 --top 3
 *
 *   node tests/roundtrip/fidelity.mjs --all-decks \
 *     --base https://36kuepamyi.us-east-1.awsapprunner.com
 */

import { chromium }                   from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync, readdirSync }    from "node:fs"
import { join, basename, dirname }    from "node:path"
import { fileURLToPath }              from "node:url"
import { spawnSync }                  from "node:child_process"

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const getArg  = (f, d = null)  => { const i = argv.indexOf(f); return i >= 0 ? argv[i+1] : d }
const hasFlag = (f)            => argv.includes(f)
const allArgs = (f)            => { const v=[]; for(let i=0;i<argv.length-1;i++) if(argv[i]===f)v.push(argv[i+1]); return v }

const BASE       = getArg("--base", "http://localhost:8000")
const OUT_ROOT   = getArg("--out",  join(__dir, "../out/roundtrip"))
const TOP_N      = parseInt(getArg("--top", "5"), 10)
const SLIDES_ARG = getArg("--slides", "all")
const NO_BROWSER  = hasFlag("--no-browser")
const ALL_DECKS   = hasFlag("--all-decks")
const DPI         = parseInt(getArg("--dpi", "120"), 10)
const FORCE_REF   = hasFlag("--force-ref")   // re-fetch reference PNGs even if cached

let pptxPaths  = allArgs("--pptx")
const docIdArg = getArg("--doc-id")
const projArg  = getArg("--project-id")

if (ALL_DECKS) {
  const dumpDir = join(__dir, "../../outreach/dump_pptx")
  if (existsSync(dumpDir)) {
    pptxPaths = readdirSync(dumpDir, { withFileTypes: true })
      .filter(d => !d.isDirectory() && d.name.endsWith(".pptx"))
      .map(d => join(dumpDir, d.name))
    console.log(`Found ${pptxPaths.length} PPTX files in ${dumpDir}`)
  }
}

if (!pptxPaths.length && !docIdArg) {
  console.error("ERROR: provide --pptx <path> or --doc-id <id> (or --all-decks)")
  process.exit(1)
}

// ── Slide range ───────────────────────────────────────────────────────────────
function parseSlideRange(arg, total) {
  if (arg === "all") return Array.from({ length: total }, (_, i) => i + 1)
  const s = new Set()
  for (const part of arg.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/)
    if (m) {
      const lo = parseInt(m[1]), hi = parseInt(m[2] || m[1])
      for (let n = lo; n <= hi; n++) s.add(n)
    }
  }
  return [...s].sort((a, b) => a - b).filter(n => n >= 1 && n <= total)
}

// ── Auth ──────────────────────────────────────────────────────────────────────
let _session = process.env.PERCY_SESSION || ""

async function ensureSession() {
  if (_session) return
  const email = process.env.PERCY_EMAIL || `rt-${Date.now()}@roundtrip.percy.ai`
  const pass  = process.env.PERCY_PASS  || "TestPass1!"

  // Try login first, fall back to signup
  for (const path of ["/api/auth/login", "/api/auth/signup"]) {
    const r = await fetch(`${BASE}${path}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password: pass, name: "Roundtrip Test" }),
    })
    const raw = await r.text()
    const cookie = r.headers.get("set-cookie") || ""
    const m = cookie.match(/percy_session=([^;]+)/)
    if (m) { _session = m[1]; console.log(`  Authenticated as ${email}`); return }
    try {
      const d = JSON.parse(raw)
      if (d.detail && path === "/api/auth/login") continue  // try signup
      if (d.id) { console.error("  Auth: got user ID but no cookie — unexpected"); return }
    } catch {}
  }
  if (!_session) console.error("  WARN: could not get session cookie; API calls may fail")
}

function authHeaders() {
  return _session ? { Cookie: `percy_session=${_session}` } : {}
}

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  })
  if (!r.ok) {
    const msg = await r.text().catch(() => "")
    throw new Error(`${opts.method || "GET"} ${path} → ${r.status}: ${msg}`)
  }
  return r
}
async function apiJson(path, opts = {}) { return (await apiFetch(path, opts)).json() }

// ── API: upload PPTX ──────────────────────────────────────────────────────────
async function uploadPptx(pptxPath) {
  const slug = basename(pptxPath, ".pptx").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40)

  // Find personal org
  const me = await apiJson("/api/auth/me")
  const orgId = me.orgs?.find(o => o.kind === "personal")?.id || me.orgs?.[0]?.id
  if (!orgId) throw new Error("No org found for user")

  // Create project
  const proj = await apiJson("/api/projects", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ org_id: orgId, name: `rt-${slug}` }),
  })
  const projId = proj.id
  if (!projId) throw new Error(`Create project failed: ${JSON.stringify(proj)}`)

  // Upload PPTX
  const buf  = await readFile(pptxPath)
  const form = new FormData()
  form.append("file", new Blob([buf]), basename(pptxPath))
  await apiFetch(`/api/projects/${projId}/upload`, { method: "POST", body: form })

  // Open → onboard → get doc_id
  const opened = await apiJson(`/api/projects/${projId}/open`, { method: "POST" })
  const docId  = opened.doc_id
  if (!docId) throw new Error(`Onboard failed: ${JSON.stringify(opened)}`)

  console.log(`  Uploaded → project ${projId} / doc ${docId}`)
  return { projId, docId, slug }
}

// ── API: slide count ──────────────────────────────────────────────────────────
async function getSlideCount(docId) {
  try {
    const info = await apiJson(`/api/docs/${docId}`)
    return info.slide_count ?? 1
  } catch { return 1 }
}

// ── API: reference render ─────────────────────────────────────────────────────
// Uses the pre-rendered bridge.png cached during onboarding (matplotlib render).
// Falls back to /render.png (on-demand fresh render) if bridge.png returns 404.
// When FORCE_REF is set, goes straight to render.png to pick up any render_png.py changes.
async function fetchReferencePng(docId, slideN, dpi = 120) {
  if (!FORCE_REF) {
    try {
      const r = await apiFetch(`/api/docs/${docId}/slides/${slideN}/bridge.png`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (!e.message.includes("404")) throw e
    }
  }
  const r = await apiFetch(`/api/docs/${docId}/slides/${slideN}/render.png?dpi=${dpi}`)
  return Buffer.from(await r.arrayBuffer())
}

// ── Browser: screenshot slides ────────────────────────────────────────────────
async function screenshotSlides(browser, projId, docId, slideNums, outDir) {
  // 2200×847: 85vh = 720px so canvas matches reference (120 DPI, 6" tall) exactly.
  // At 900px, 85vh = 765px (6.25% too large) causing text-wrap differences post-resize.
  const ctx  = await browser.newContext({ viewport: { width: 2200, height: 847 } })
  if (_session) {
    await ctx.addCookies([{
      name: "percy_session", value: _session,
      url:  BASE, httpOnly: true, secure: BASE.startsWith("https"),
    }])
  }
  const page = await ctx.newPage()

  // If no session cookie, do browser login
  if (!_session) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
    const email = process.env.PERCY_EMAIL || `rt-auto@roundtrip.percy.ai`
    const pass  = process.env.PERCY_PASS  || "TestPass1!"
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', pass)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/home|\/studio/, { timeout: 15000 })
  }

  const studioUrl = `${BASE}/studio/${projId}`
  console.log(`  Browser → ${studioUrl}`)
  await page.goto(studioUrl, { waitUntil: "networkidle", timeout: 40000 })
  await page.waitForTimeout(3000)

  const shots = {}
  for (const n of slideNums) {
    // Navigate to slide N via the strip
    const thumb = page.locator(`[data-slide-n="${n}"]`)
    if (await thumb.count() > 0) {
      await thumb.first().click()
      await page.waitForTimeout(2000)
    }

    // Wait for canvas
    const canvas = page.locator('[data-slide-canvas="true"]')
    try { await canvas.waitFor({ state: "visible", timeout: 10000 }) }
    catch { console.error(`    slide ${n}: canvas not found`); continue }

    // Let async renders (images, charts, freeforms) finish.
    // networkidle waits until <2 in-flight requests for 500ms — handles even
    // slides with 50+ freeform-data fetches. Extra 2s covers React re-paints.
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(2000)
    // If any chart is still in "Loading chart…" state, wait up to 6s for it to resolve.
    await page.waitForFunction(
      () => !document.querySelector('[data-slide-canvas="true"]')?.textContent?.includes("Loading chart"),
      { timeout: 6000 }
    ).catch(() => {})
    // Wait for text elements to finish loading their payload (data-percy-loading="text"
    // is set while content is null; cleared once the text payload arrives).
    await page.waitForFunction(
      () => !document.querySelector('[data-slide-canvas="true"] [data-percy-loading="text"]'),
      { timeout: 8000 }
    ).catch(() => {})
    // Extra settle time for Recharts to finish drawing SVG bars/paths after data loads.
    await page.waitForTimeout(2000)

    // Hide all Studio chrome so only the canvas remains, then screenshot.
    // Walk all the way up the DOM and at each level hide siblings that don't
    // contain the canvas — this catches the ribbon, top bar, slide strip, notes
    // bar, and any other chrome regardless of how many layout levels there are.
    await page.evaluate(() => {
      const canvas = document.querySelector("[data-slide-canvas='true']")
      if (!canvas) return
      let el = canvas.parentElement
      while (el && el !== document.body) {
        for (const child of el.children) {
          if (!child.contains(canvas) && child !== canvas) {
            child.style.setProperty("display", "none", "important")
            child.setAttribute("data-ss-hidden", "1")
          }
        }
        el = el.parentElement
      }
    })
    await page.waitForTimeout(300)

    const bb = await canvas.boundingBox()
    if (!bb) {
      // Restore chrome and skip
      await page.evaluate(() => document.querySelectorAll("[data-ss-hidden]").forEach(el => { el.style.removeProperty("display"); el.removeAttribute("data-ss-hidden") }))
      console.error(`    slide ${n}: canvas has no bounding box`); continue
    }
    const vp   = page.viewportSize()
    const clip = {
      x:      Math.max(0, bb.x),
      y:      Math.max(0, bb.y),
      width:  Math.min(bb.width,  vp.width  - Math.max(0, bb.x)),
      height: Math.min(bb.height, vp.height - Math.max(0, bb.y)),
    }
    const pngBuf = await page.screenshot({ clip })

    // Restore chrome for next slide navigation
    await page.evaluate(() => document.querySelectorAll("[data-ss-hidden]").forEach(el => { el.style.removeProperty("display"); el.removeAttribute("data-ss-hidden") }))
    const name   = `slide-${String(n).padStart(3, "0")}.png`
    const path   = join(outDir, name)
    await writeFile(path, pngBuf)
    shots[n] = path
    console.log(`    slide ${n}: ${pngBuf.length} bytes → ${name}`)
  }

  await ctx.close()
  return shots
}

// ── Compare ───────────────────────────────────────────────────────────────────
function runComparison(refDir, studioDir, outDir, topN) {
  const py = join(__dir, "compare.py")
  const r  = spawnSync("python", [py, refDir, studioDir,
    `--output-dir=${outDir}`, `--top=${topN}`],
    { stdio: "inherit" })
  return r.status === 0
}

// ── Per-deck runner ───────────────────────────────────────────────────────────
async function runDeck(browser, pptxPath, docIdOverride, projIdOverride) {
  const slug    = docIdOverride
    ? `doc-${docIdOverride.slice(0, 12)}`
    : basename(pptxPath, ".pptx").replace(/[^a-z0-9_-]/gi, "-").slice(0, 50)
  const outDir    = join(OUT_ROOT, slug)
  const refDir    = join(outDir, "reference")
  const studioDir = join(outDir, "studio")
  const cmpDir    = join(outDir, "comparison")
  await mkdir(refDir,    { recursive: true })
  await mkdir(studioDir, { recursive: true })
  await mkdir(cmpDir,    { recursive: true })

  console.log(`\n${"=".repeat(64)}`)
  console.log(`Deck: ${pptxPath || docIdOverride}`)
  console.log(`Out:  ${outDir}`)

  let docId  = docIdOverride
  let projId = projIdOverride

  if (!docId) {
    const up = await uploadPptx(pptxPath)
    docId  = up.docId
    projId = up.projId
  } else if (!projId) {
    // Try to find project from doc_id
    try {
      const me    = await apiJson("/api/auth/me")
      const orgId = me.orgs?.[0]?.id
      if (orgId) {
        const list = await apiJson(`/api/orgs/${orgId}/projects`)
        const match = (list.projects || list).find(p => p.doc_id === docId)
        if (match) projId = match.id
      }
    } catch { /* ignore */ }
    if (!projId) {
      console.error("  ERROR: --doc-id given but could not find matching project; pass --project-id too")
      return null
    }
  }

  // Slide count
  const total    = await getSlideCount(docId)
  const slideNums = parseSlideRange(SLIDES_ARG, total)
  console.log(`  ${slideNums.length} slides to test (total: ${total})`)

  // Reference renders
  console.log("\n  Fetching reference renders (Bridge model via matplotlib)…")
  for (const n of slideNums) {
    const name = `slide-${String(n).padStart(3, "0")}.png`
    const dest = join(refDir, name)
    if (!FORCE_REF && existsSync(dest)) { process.stdout.write("."); continue }
    try {
      const buf = await fetchReferencePng(docId, n, DPI)
      await writeFile(dest, buf)
      process.stdout.write("•")
    } catch (e) {
      process.stdout.write("✗")
      console.error(`\n    slide ${n}: ${e.message}`)
    }
  }
  console.log()

  // Browser screenshots
  if (!NO_BROWSER) {
    console.log("\n  Taking Studio canvas screenshots…")
    await screenshotSlides(browser, projId, docId, slideNums, studioDir)
  }

  // Pixel comparison
  console.log("\n  Pixel comparison…")
  runComparison(refDir, studioDir, cmpDir, TOP_N)

  // Return report
  try {
    const rep = JSON.parse(await readFile(join(cmpDir, "report.json"), "utf8"))
    return { slug, docId, pptxPath, report: rep }
  } catch { return { slug, docId, pptxPath, report: null } }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_ROOT, { recursive: true })
  await ensureSession()

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const results = []

  if (docIdArg) {
    const r = await runDeck(browser, null, docIdArg, projArg)
    if (r) results.push(r)
  } else {
    for (const p of pptxPaths) {
      try {
        const r = await runDeck(browser, p, null, null)
        if (r) results.push(r)
      } catch (e) {
        console.error(`\nERROR on ${basename(p)}: ${e.stack || e.message}`)
      }
    }
  }

  await browser.close()

  if (results.length > 1) {
    console.log("\n" + "=".repeat(64))
    console.log("MULTI-DECK SUMMARY  (sorted worst → best)")
    console.log("=".repeat(64))
    const rows = results
      .filter(r => r.report)
      .sort((a, b) => b.report.summary.mean_rms - a.report.summary.mean_rms)
    for (const r of rows) {
      const s   = r.report.summary
      const bar = "█".repeat(Math.min(40, Math.round(s.mean_rms / 4)))
      console.log(`  ${r.slug.padEnd(52)} mean=${String(s.mean_rms.toFixed(1)).padStart(6)}  ${bar}`)
    }
    const sp = join(OUT_ROOT, "summary.json")
    await writeFile(sp, JSON.stringify({ runs: rows.map(r => ({ deck: r.slug, ...r.report.summary })) }, null, 2))
    console.log(`\nSummary → ${sp}`)
  }
}

await main().catch(e => { console.error(e.stack || e); process.exit(1) })
