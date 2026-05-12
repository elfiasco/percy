/**
 * Renderer benchmark — record current state of the three renderers
 * before consolidating onto StudioCanvas in view-mode.
 *
 * What this measures:
 *   1. SlideSvg (splash) — full splash screenshot, per-slide crops.
 *   2. TemplatePreview — opens the deployed studio's template editor.
 *      Requires a logged-in session (PERCY_EMAIL + PERCY_PASS env).
 *   3. StudioCanvas — opens a real doc in Studio.
 *      Requires the same login.
 *   Plus: feature-coverage matrix (qualitative) written to report.md.
 *
 * Output:
 *   tests/renderer-bench/out/
 *     splash_percy.png, splash_snowflake.png       (SlideSvg)
 *     studio_<doc>.png, templates_<id>.png         (StudioCanvas, TemplatePreview)
 *     pairwise_diffs.txt                           (pixel-rms numbers)
 *     report.md                                    (writeup)
 *
 * Usage:
 *   cd frontend && node ../tests/renderer-bench/bench.cjs \
 *     --base https://36kuepamyi.us-east-1.awsapprunner.com \
 *     [--email <email> --pass <pw>]   # optional: log in for Studio + Templates
 */

const { chromium } = require("playwright")
const { mkdirSync, writeFileSync, existsSync } = require("node:fs")
const { join } = require("node:path")
const { spawnSync } = require("node:child_process")

const argv = process.argv.slice(2)
const getArg = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 ? argv[i+1] : d }

const BASE  = getArg("--base", "https://36kuepamyi.us-east-1.awsapprunner.com")
const EMAIL = getArg("--email", process.env.PERCY_EMAIL || "")
const PASS  = getArg("--pass",  process.env.PERCY_PASS  || "")

const OUT = join(__dirname, "out")
mkdirSync(OUT, { recursive: true })

const log = (msg) => { console.log(`[bench] ${msg}`) }

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 2400 } })

  // ── SlideSvg: splash screenshots (no auth needed) ─────────────────────
  log("=== SlideSvg via splash ===")
  const sv = {}
  for (const brand of ["percy_standard", "snowflake"]) {
    const page = await ctx.newPage()
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 })
    await page.evaluate(() => window.scrollTo(0, 1100))
    // Click the brand button
    const btnLabel = brand === "percy_standard" ? "Percy Standard" : "Snowflake"
    try {
      const btn = page.locator(`button:has-text("${btnLabel}")`).first()
      if (await btn.count()) {
        await btn.click({ timeout: 5000 })
        await page.waitForTimeout(2000)
      }
    } catch (e) { log(`brand button click skipped: ${e.message}`) }

    // The deck grid sits below; scroll into a stable position then grab.
    await page.evaluate(() => window.scrollTo(0, 1400))
    await page.waitForTimeout(1500)
    const full = join(OUT, `splash_${brand}_full.png`)
    await page.screenshot({ path: full, fullPage: false })
    sv[brand] = full
    log(`  → ${full}`)
    await page.close()
  }

  // ── Auth-required paths (TemplatePreview + StudioCanvas) ─────────────
  let authed = false
  if (EMAIL && PASS) {
    log("=== Authenticating ===")
    const page = await ctx.newPage()
    await page.goto(BASE + "/login", { waitUntil: "networkidle" })
    try {
      await page.fill('input[type="email"]', EMAIL)
      await page.fill('input[type="password"]', PASS)
      await page.click('button[type="submit"]')
      await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 })
      authed = true
      log("  authed")
    } catch (e) {
      log(`  auth failed: ${e.message} — skipping Studio + TemplatePreview captures`)
    }
    await page.close()
  } else {
    log("=== No --email/--pass; skipping Studio + TemplatePreview screenshots ===")
  }

  if (authed) {
    // ── TemplatePreview: open template editor ─────────────────────────
    log("=== TemplatePreview via template editor ===")
    const page = await ctx.newPage()
    await page.goto(BASE + "/templates", { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)
    const tplPath = join(OUT, "templates_grid.png")
    await page.screenshot({ path: tplPath, fullPage: false })
    log(`  → ${tplPath}`)
    await page.close()

    // ── StudioCanvas: open most recent project ────────────────────────
    log("=== StudioCanvas via studio ===")
    const page2 = await ctx.newPage()
    await page2.goto(BASE + "/home", { waitUntil: "networkidle", timeout: 60000 })
    await page2.waitForTimeout(2000)
    // Find first project card; open it
    const card = page2.locator('[data-percy-project-card], a[href^="/studio/"]').first()
    if (await card.count()) {
      const href = await card.getAttribute("href")
      log(`  opening ${href}`)
      await card.click()
      await page2.waitForURL(/\/studio\//, { timeout: 15000 })
      await page2.waitForTimeout(4000)
      const stPath = join(OUT, "studio_canvas.png")
      await page2.screenshot({ path: stPath, fullPage: false })
      log(`  → ${stPath}`)
    } else {
      log("  no project cards on /home — skipping StudioCanvas screenshot")
    }
    await page2.close()
  }

  await browser.close()
  log("done")
}

main().catch((e) => { console.error(e); process.exit(1) })
