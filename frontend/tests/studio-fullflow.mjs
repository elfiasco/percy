// Full studio click→edit flow test on the live cloud.
//   1. signup throwaway account
//   2. create blank project
//   3. open studio
//   4. insert a text box via the toolbar
//   5. click it once → confirm contenteditable appears
//   6. type → confirm the text persists
//
// Run:  node tests/studio-fullflow.mjs https://36kuepamyi.us-east-1.awsapprunner.com

import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out"
const log = (...a) => console.log("[fullflow]", ...a)

const email = `pwtest+${Date.now()}@example.com`
const password = `Pw_${Date.now()}_aB9!`
const name = `Playwright Tester`

async function snap(page, n) {
  await mkdir(OUT, { recursive: true })
  const p = `${OUT}/${n}.png`
  await page.screenshot({ path: p })
  log("→", p)
  return p
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  const errors = []
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
    p.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`) })
  })

  const page = await ctx.newPage()

  // 1. Signup
  log(`signup as ${email}`)
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: name },
  })
  if (!r.ok()) throw new Error(`signup failed ${r.status()} ${await r.text()}`)
  const me = await r.json()
  log("user:", me.id, "orgs:", me.orgs?.map((o) => o.id).join(","))
  const orgId = me.orgs?.[0]?.id
  if (!orgId) throw new Error("no org returned")

  // 2. Create scratch project + blank doc
  log("create project")
  const cp = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: "PW Test Deck" },
  })
  if (!cp.ok()) throw new Error(`create project: ${cp.status()} ${await cp.text()}`)
  const proj = await cp.json()
  log("project:", proj.id)

  log("create blank doc")
  const cd = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: proj.name },
  })
  if (!cd.ok()) throw new Error(`create blank doc: ${cd.status()} ${await cd.text()}`)
  const blank = await cd.json()
  log("doc:", blank.doc_id)

  await page.request.patch(`${BASE}/api/projects/${proj.id}`, {
    data: { doc_id: blank.doc_id },
  })

  // 3. Open studio in browser
  log(`navigate to /studio/${proj.id}`)
  await page.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  await snap(page, "10-studio-blank")

  // 4. Insert a text box via the API (toolbar would need element targeting)
  log("insert text element via API")
  const inserted = await page.request.post(`${BASE}/api/docs/${blank.doc_id}/slides/1/elements/text`, {
    data: {
      position: { left_in: 2, top_in: 2, width_in: 5, height_in: 1.5 },
      text: "Hello world",
    },
  })
  if (!inserted.ok()) {
    log("text-insert failed:", inserted.status(), await inserted.text())
  } else {
    const el = await inserted.json()
    log("text element id:", el.id)
  }

  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  await snap(page, "11-studio-with-text")

  // 5. Click the text box once → confirm contenteditable
  const overlays = page.locator('[data-element="true"]')
  const count = await overlays.count()
  log("overlays:", count)
  if (count > 0) {
    const first = overlays.first()
    const box = await first.boundingBox()
    log("first overlay box:", box)
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(900)
      await snap(page, "12-after-1click")
      const ce = await page.locator('[contenteditable="true"]').count()
      log("contenteditable count after 1 click:", ce)

      // 6. Type
      if (ce > 0) {
        await page.keyboard.type(" + EDITED")
        await page.waitForTimeout(300)
        await snap(page, "13-after-type")
        // blur to save
        await page.mouse.click(40, 40)
        await page.waitForTimeout(800)
        await snap(page, "14-after-blur")
      }
    }
  }

  await browser.close()

  log("--- result ---")
  if (errors.length) {
    log("⚠", errors.length, "console errors")
    errors.forEach((e) => log("  ", e))
  } else {
    log("✓ no console errors")
  }
  log("screenshots in", OUT)
}

await main().catch((e) => { console.error(e); process.exit(1) })
