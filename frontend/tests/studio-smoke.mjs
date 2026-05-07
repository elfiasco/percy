// Smoke test for the deployed studio. Run with:
//   node tests/studio-smoke.mjs https://36kuepamyi.us-east-1.awsapprunner.com
//
// Without auth cookies, we can only verify the splash + signup pages render.
// If a PERCY_SESSION cookie is set in env, we attempt to navigate to a
// project and exercise the click → cursor flow.

import { chromium } from "playwright"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const PROJECT_ID = process.argv[3] || "prj_KjGDV6Opr1zbrjkk"
const SESSION    = process.env.PERCY_SESSION || ""
const OUT_DIR    = "tests/out"

const log = (...a) => console.log("[studio-smoke]", ...a)

async function snap(page, name) {
  await mkdir(OUT_DIR, { recursive: true })
  const path = `${OUT_DIR}/${name}.png`
  await page.screenshot({ path, fullPage: false })
  log("→", path)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  // Capture browser console errors so we know if any client-side bug fires.
  const consoleErrors = []
  ctx.on("page", (p) => {
    p.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`))
    p.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`)
    })
  })

  if (SESSION) {
    await ctx.addCookies([{
      name: "percy_session", value: SESSION, url: BASE, httpOnly: true, secure: BASE.startsWith("https"),
    }])
    log("loaded session cookie")
  }

  const page = await ctx.newPage()

  log("→ /")
  await page.goto(BASE, { waitUntil: "networkidle" })
  await snap(page, "01-splash")
  log("title:", await page.title())

  // Find what bundle hash the page references — confirms new deploy.
  const html = await page.content()
  const m = html.match(/index-([A-Za-z0-9_-]+)\.js/)
  log("bundle:", m ? m[0] : "not found")

  if (SESSION) {
    log(`→ /studio/${PROJECT_ID}`)
    await page.goto(`${BASE}/studio/${PROJECT_ID}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(2000)
    await snap(page, "02-studio-loaded")

    // Look for any rendered element overlay
    const overlays = await page.locator('[data-element="true"]').count()
    log("element overlays on canvas:", overlays)

    if (overlays > 0) {
      // Try the click → edit flow on the first overlay.
      const first = page.locator('[data-element="true"]').first()
      const box = await first.boundingBox()
      log("first overlay bbox:", box)

      // Click once at the centre
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(700)
        await snap(page, "03-after-1click")

        // Look for editor presence: ProseMirror puts contenteditable=true on
        // its view root. If our fix worked, this exists after one click.
        const ce = await page.locator('[contenteditable="true"]').count()
        log("contenteditable elements after 1 click:", ce)

        // Double-click to be thorough
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(700)
        await snap(page, "04-after-dblclick")
        const ce2 = await page.locator('[contenteditable="true"]').count()
        log("contenteditable elements after dblclick:", ce2)

        // Type a character
        await page.keyboard.type("A")
        await page.waitForTimeout(500)
        await snap(page, "05-after-type")

        // Click outside to save
        await page.mouse.click(40, 200)
        await page.waitForTimeout(700)
        await snap(page, "06-after-blur")
      }
    }
  }

  await browser.close()
  if (consoleErrors.length) {
    log("⚠ console errors:")
    consoleErrors.forEach((e) => log("  ", e))
  } else {
    log("✓ no console errors")
  }
}

await main().catch((e) => { console.error(e); process.exit(1) })
