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

// ── Reference render ──────────────────────────────────────────────────────────
// PRIMARY: PowerPoint-rendered PNGs at `<pptxDir>/<pptxStem>__powerpoint/slide-NNN.png`.
// These are produced once per deck via scripts/render_pptx_powerpoint.py using
// COM automation against the real PowerPoint app on Windows — the authoritative
// PPTX renderer.
// FALLBACK 1: /api/docs/.../original.png (LibreOffice render — has known
// chart/rotation/font bugs but covers decks that haven't been pre-rendered).
// FALLBACK 2: matplotlib bridge.png / on-demand render.png.
import { readFile as fsReadFile } from "node:fs/promises"
async function fetchReferencePng(docId, slideN, dpi = 120, pptxPath = null) {
  // PowerPoint-rendered local PNG, if available
  if (pptxPath) {
    const pptDir = dirname(pptxPath)
    const stem   = basename(pptxPath, ".pptx")
    const local  = join(pptDir, `${stem}__powerpoint`, `slide-${String(slideN).padStart(3, "0")}.png`)
    if (existsSync(local)) {
      return await fsReadFile(local)
    }
  }
  // /original.png — LibreOffice render
  try {
    const r = await apiFetch(`/api/docs/${docId}/slides/${slideN}/original.png`)
    return Buffer.from(await r.arrayBuffer())
  } catch (e) {
    if (!e.message.includes("404")) throw e
  }
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
    // Navigate to slide N via the strip. Scroll the thumbnail into view first
    // so slides past the initial visible window (e.g. 11+ in a 50-slide deck)
    // can be clicked — without scrollIntoViewIfNeeded the click would target
    // an off-screen element and silently do nothing, leaving the canvas on
    // the previous slide.
    const thumb = page.locator(`[data-slide-n="${n}"]`)
    if (await thumb.count() > 0) {
      try { await thumb.first().scrollIntoViewIfNeeded({ timeout: 2000 }) }
      catch { /* tolerate */ }
      await thumb.first().click()
      // Wait for the canvas's data-slide-n to update — proves the React store
      // committed the slide change AND the new canvas is mounted. Fall back to
      // a fixed 2s wait if the attribute never matches (older deploy / bug).
      try {
        // Wait for BOTH:
        //  - data-slide-n     (click-target proxy, updates instantly)
        //  - data-hydrated-slide-n  (set only after the API response arrives
        //    and the store's elements list reflects the new slide)
        // Without the hydrated wait, slideN updates immediately on click but
        // the rendered elements still belong to the previous slide for up to
        // ~1s, so screenshots capture stale content.
        await page.waitForFunction(
          (target) => {
            const c = document.querySelector("[data-slide-canvas='true']")
            return c
              && c.getAttribute("data-slide-n") === String(target)
              && c.getAttribute("data-hydrated-slide-n") === String(target)
          },
          n,
          { timeout: 12000 }
        )
      } catch {
        // Report which attribute didn't update — helps debug navigation flakes
        const state = await page.evaluate(() => {
          const c = document.querySelector("[data-slide-canvas='true']")
          return {
            slideN: c?.getAttribute("data-slide-n"),
            hydratedSlideN: c?.getAttribute("data-hydrated-slide-n"),
          }
        })
        console.warn(`    slide ${n}: nav/hydrate timeout — data-slide-n=${state.slideN} data-hydrated-slide-n=${state.hydratedSlideN}`)
      }
      await page.waitForTimeout(800)
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
    // Wait for all renderers to finish loading their payloads. Renderers set
    // [data-percy-loading="<kind>"] on a placeholder while their payload is
    // null (text/freeform/chart/connector/table) and remove it once loaded.
    // Without this wait, the screenshot can fire mid-load and miss rich
    // content (charts, freeforms, tables), inflating RMS.
    await page.waitForFunction(
      () => !document.querySelector('[data-slide-canvas="true"] [data-percy-loading]'),
      { timeout: 10000 }
    ).catch(() => {})
    // Extra settle time for Recharts to finish drawing SVG bars/paths after data loads.
    await page.waitForTimeout(2000)
    // Also wait until all text-bearing elements (BridgeText/BridgeShape) actually
    // have text content visible. Without this, async payload fetches can mean the
    // screenshot captures empty containers at correct positions — same visual as
    // "missing element," but root cause is timing.
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-slide-canvas="true"] [data-element="true"]')
      let nonempty = 0
      for (const e of els) {
        const t = (e.textContent || "").trim()
        if (t.length > 0) nonempty++
      }
      // If there are NO text elements at all, accept immediately. Otherwise
      // wait for at least one of them to have rendered (not literally all —
      // BridgeImage/Freeform have no text, only Text/Shape contribute).
      return els.length === 0 || nonempty > 0
    }, { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(800)

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

    // Diagnostic: count what's rendered in DOM. Helps identify when bridge
    // data has more elements than studio rendered (silent render failures).
    const renderedCount = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-slide-canvas="true"] [data-element="true"]')
      return Array.from(els).map((e) => {
        const r = e.getBoundingClientRect()
        const txt = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
        const hasImg = !!e.querySelector("img")
        const hasSvg = !!e.querySelector("svg")
        return {
          rect: { x:r.x|0, y:r.y|0, w:r.width|0, h:r.height|0 },
          text: txt,
          hasImg, hasSvg,
        }
      })
    })
    if (true || n <= 3 || renderedCount.length < 5) {
      console.log(`    slide ${n}: rendered ${renderedCount.length} elements`)
      for (const re of renderedCount) {
        console.log(`      rect=${JSON.stringify(re.rect)} img=${re.hasImg?"Y":"-"} svg=${re.hasSvg?"Y":"-"} text="${re.text}"`)
      }
      // Diagnostic: for text-bearing elements check if they're VISIBLE
      // (CSS visibility, opacity, z-index, color vs background).
      const visibility = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('[data-slide-canvas="true"] [data-element="true"]').forEach((e) => {
          const t = (e.textContent || "").trim().slice(0, 30)
          if (!t) return
          // Find a text-bearing descendant <p> or shape
          const p = e.querySelector("p")
          const target = p || e
          const cs = getComputedStyle(target)
          const er = e.getBoundingClientRect()
          out.push({
            text:    t,
            color:   cs.color,
            opacity: cs.opacity,
            visibility: cs.visibility,
            fontSize:   cs.fontSize,
            lineHeight: cs.lineHeight,
            tag:        target.tagName,
            pos:        { x:er.x|0, y:er.y|0 },
            elementVis: getComputedStyle(e).visibility,
            elementZ:   getComputedStyle(e).zIndex,
          })
        })
        return out
      })
      for (const v of visibility) {
        console.log(`      VIS "${v.text}" color=${v.color} fs=${v.fontSize} lh=${v.lineHeight} op=${v.opacity} z=${v.elementZ}`)
      }
      // Element CSS positions — to debug percentages drift
      const elPos = await page.evaluate(() => {
        const c = document.querySelector('[data-slide-canvas="true"]')
        const cRect = c?.getBoundingClientRect()
        return Array.from(document.querySelectorAll('[data-slide-canvas="true"] [data-element="true"]')).map((e) => {
          const s = e.style
          const r = e.getBoundingClientRect()
          return {
            css: { left: s.left, top: s.top, width: s.width, height: s.height },
            pct: cRect ? {
              left: ((r.x - cRect.x) / cRect.width * 100).toFixed(1),
              w:    (r.width / cRect.width * 100).toFixed(1),
            } : null,
          }
        })
      })
      console.log(`      slide ${n} element CSS positions:`)
      for (let i = 0; i < Math.min(5, elPos.length); i++) {
        const p = elPos[i]
        console.log(`        [${i}] css={${p.css.left} ${p.css.top} ${p.css.width} ${p.css.height}} → ${p.pct.left}%/${p.pct.w}%`)
      }
      // Dump actual inline HTML for first text element so we can see what styles are present
      const html = await page.evaluate(() => {
        const el = document.querySelector('[data-slide-canvas="true"] [data-element="true"] p')
        return el?.outerHTML?.slice(0, 500) || ""
      })
      console.log(`      HTML sample: ${html}`)
      // Check the --pt-scale CSS variable
      const ptScale = await page.evaluate(() => {
        const c = document.querySelector('[data-slide-canvas="true"]')
        return c ? getComputedStyle(c).getPropertyValue("--pt-scale") : "?"
      })
      console.log(`      --pt-scale = ${ptScale}`)
    }
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

  // Reference renders + per-slide element dump (diagnostic)
  console.log("\n  Fetching reference renders (Bridge model via matplotlib)…")
  const elementsDir = join(outDir, "elements")
  await mkdir(elementsDir, { recursive: true })
  for (const n of slideNums) {
    const name = `slide-${String(n).padStart(3, "0")}.png`
    const dest = join(refDir, name)
    const needFetch = FORCE_REF || !existsSync(dest)
    if (!needFetch) { process.stdout.write(".") }
    else {
      try {
        const buf = await fetchReferencePng(docId, n, DPI, pptxPath)
        await writeFile(dest, buf)
        process.stdout.write("•")
      } catch (e) {
        process.stdout.write("✗")
        console.error(`\n    slide ${n}: ${e.message}`)
      }
    }
    // Element dump — bridge model snapshot for this slide. Used to root-cause
    // RMS diffs by inspecting what data Studio/matplotlib are working from.
    try {
      const slide = await apiJson(`/api/docs/${docId}/slides/${n}/elements`)
      const elems = Array.isArray(slide) ? slide : (slide.elements || [])
      const slideBg = slide?.background_color ?? null
      const enriched = []
      for (const el of elems) {
        const e = {
          id: el.id,
          type: el.element_type || el.type || "?",
          left: el.left_in ?? el.left,
          top:  el.top_in  ?? el.top,
          w:    el.width_in ?? el.w,
          h:    el.height_in ?? el.h,
          left_pct: el.left_pct,
          width_pct: el.width_pct,
          preset: el.geometry_preset,
          z:      el.z_index ?? null,
        }
        // BridgeFreeform: dump fill/stroke + path count so we can see when a
        // freeform has no visual (empty fill_color + invisible line) — common
        // root cause for "missing arrow / decorative shape" diffs.
        if (e.type === "BridgeFreeform") {
          try {
            const ff = await apiJson(`/api/docs/${docId}/slides/${n}/elements/${el.id}/freeform-data`)
            e.freeform = {
              fill_type:    ff.fill_type,
              fill_color:   ff.fill_color,
              has_gradient: !!ff.gradient_stops?.length,
              line_visible: ff.line_visible,
              opacity:      ff.opacity,
              paths_count:  (ff.paths || []).length,
            }
          } catch { /* tolerate */ }
        }
        // BridgeImage: dump src so we know if it's a referenced asset
        if (e.type === "BridgeImage") {
          e.image = { src_present: !!(el.image_src || el.src) }
        }
        // BridgeShape: dump fill, preset
        if (e.type === "BridgeShape") {
          try {
            const sty = await apiJson(`/api/docs/${docId}/slides/${n}/elements/${el.id}/style`)
            e.shape = { fill_color: sty?.fill_color, fill_type: sty?.fill_type, gradient_stops: sty?.gradient_stops }
          } catch { /* tolerate */ }
        }
        // BridgeChart: dump chart data (series + colors + type) for parity debugging
        if (e.type === "BridgeChart") {
          try {
            const cd = await apiJson(`/api/docs/${docId}/slides/${n}/elements/${el.id}/chart-data`)
            e.chart = {
              chart_type: cd?.chart_type,
              num_series: (cd?.series || []).length,
              series_summary: (cd?.series || []).map((s) => ({
                name: s.name,
                color: s.color,
                num_points: (s.values || []).length,
                points: (s.values || []).slice(0, 3),
                point_colors: s.point_colors,
              })),
              category_axis: cd?.category_axis,
              value_axis: cd?.value_axis,
            }
          } catch { /* tolerate */ }
        }
        try {
          const t = await apiJson(`/api/docs/${docId}/slides/${n}/elements/${el.id}/text`)
          if (t.kind === "paragraphs") {
            e.paragraphs = (t.paragraphs || []).map((p) => ({
              align: p.alignment,
              line_spacing: p.line_spacing,
              text:  (p.runs || []).map((r) => r.text).join("").slice(0, 120),
              runs:  (p.runs || []).map((r) => ({
                size: r.font_size,
                bold: r.font_bold || undefined,
                name: r.font_name,
                color: r.font_color,
              })),
            }))
          } else if (t.kind === "table") {
            e.table = { rows: t.rows, cols: t.cols, row_heights: t.row_heights, column_widths: t.column_widths }
          }
        } catch { /* not all elements have text */ }
        enriched.push(e)
      }
      // Prepend background_color as a virtual first entry for backward compat
      const withBg = [{ id: "__slide__", type: "SlideMeta", background_color: slideBg }, ...enriched]
      await writeFile(join(elementsDir, `slide-${String(n).padStart(3, "0")}.json`), JSON.stringify(withBg, null, 2))
    } catch { /* tolerate */ }
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
