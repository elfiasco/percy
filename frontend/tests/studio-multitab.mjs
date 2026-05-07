// Multi-tab same-browser test — two pages in one context, same studio URL.
// Verify BroadcastChannel transport (the WS-fallback) keeps them in sync.

import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/multitab"
const log  = (...a) => console.log("[multitab]", ...a)

async function snap(p, name) {
  await mkdir(OUT, { recursive: true })
  await p.screenshot({ path: `${OUT}/${name}.png` })
  log("→", `${OUT}/${name}.png`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const errors = []
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
    p.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`) })
  })

  const tag = Date.now()
  const tab1 = await ctx.newPage()
  const sr = await tab1.request.post(`${BASE}/api/auth/signup`, {
    data: { email: `mt-${tag}@example.com`, password: `Pw_${tag}_!Aa9`, display_name: "MTabber" },
  })
  if (!sr.ok()) throw new Error(`signup ${sr.status()} ${await sr.text()}`)
  const me = await sr.json()
  const orgId = me.orgs?.[0]?.id

  const cp = await tab1.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "MTab Test" } })
  const proj = await cp.json()
  const cd = await tab1.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: proj.name },
  })
  const blank = await cd.json()
  await tab1.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
  await tab1.request.post(`${BASE}/api/docs/${blank.doc_id}/slides/1/elements/text`, {
    data: { position: { left_in: 2, top_in: 3, width_in: 8, height_in: 1.5 }, text: "Multi-tab subject" },
  })

  // Both tabs to studio
  await tab1.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })
  const tab2 = await ctx.newPage()
  await tab2.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })

  await tab1.waitForTimeout(2500)
  await tab2.waitForTimeout(2500)
  await snap(tab1, "01-tab1-loaded")
  await snap(tab2, "01-tab2-loaded")

  // Tab 1: click into edit, type, blur
  const ov1 = tab1.locator('[data-element="true"]').first()
  const box1 = await ov1.boundingBox()
  if (box1) {
    await tab1.mouse.click(box1.x + box1.width / 2, box1.y + box1.height / 2)
    await tab1.waitForTimeout(500)
    await tab1.keyboard.type(" + tab-1 wrote this")
    await tab1.waitForTimeout(500)
    // blur
    await tab1.mouse.click(40, 40)
    await tab1.waitForTimeout(800)
    await snap(tab1, "02-tab1-after-edit")
  }

  // Tab 2 should see the change via broadcast channel sync
  await tab2.waitForTimeout(1500)
  await snap(tab2, "02-tab2-sees-edit")

  // Tab 2: drag the element
  const ov2 = tab2.locator('[data-element="true"]').first()
  const box2 = await ov2.boundingBox()
  if (box2) {
    await tab2.mouse.move(box2.x + 30, box2.y + 30)
    await tab2.mouse.down()
    await tab2.mouse.move(box2.x + 200, box2.y + 100, { steps: 12 })
    await tab2.mouse.up()
    await tab2.waitForTimeout(1000)
    await snap(tab2, "03-tab2-after-drag")
  }
  await tab1.waitForTimeout(1500)
  await snap(tab1, "03-tab1-sees-drag")

  await browser.close()
  log("--- result ---")
  if (errors.length) {
    log("⚠", errors.length, "errors")
    errors.forEach((e) => log("  ", e))
  } else {
    log("✓ no console errors")
  }
}

await main().catch((e) => { console.error(e); process.exit(1) })
