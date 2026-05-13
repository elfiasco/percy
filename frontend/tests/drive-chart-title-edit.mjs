/**
 * Drives Percy's chart title click-to-edit flow and captures screenshots.
 * Verifies: selected chart with no title shows "+ Add chart title" button →
 * clicking opens inline input → typing fills it → blur saves → title appears
 * persistent.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/out/chart-title"
const TAG   = Date.now()
const EMAIL = `ct-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "CT" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `CT-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "CT" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })

// Insert chart WITHOUT a title
await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/chart`,
  {
    data: {
      chart_type: "column_clustered",
      categories: ["Q1", "Q2", "Q3", "Q4"],
      series: [{ name: "Revenue", values: [120, 145, 138, 172] }],
      position: { left_in: 1.5, top_in: 1.5, width_in: 8, height_in: 4.5 },
    },
    headers: { "Content-Type": "application/json" },
  },
)

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/01-loaded.png` })

const chart = page.locator(`[data-element="true"]`).first()
const box = await chart.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/02-selected-no-title.png` })

// Click the "+ Add chart title" button
const addBtn = page.locator('button:has-text("Add chart title")')
const addCount = await addBtn.count()
console.log(`+ Add chart title button visible: ${addCount > 0}`)
if (addCount > 0) {
  await addBtn.first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/03-edit-mode.png` })
  await page.keyboard.type("Q1-Q4 Revenue", { delay: 30 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/04-typed.png` })
  await page.keyboard.press("Enter")     // blur input
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/05-saved.png` })
}

// Now click on the rendered title to edit it
const titleEl = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-element="true"] div'))
  for (const el of els) {
    if (el.textContent === "Q1-Q4 Revenue") {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, found: true }
    }
  }
  return { found: false }
})
console.log("title element location:", titleEl)
if (titleEl.found) {
  await page.mouse.click(titleEl.x, titleEl.y)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/06-clicked-existing-title.png` })
  await page.keyboard.press("Control+a")
  await page.keyboard.type("Q4 was strong!", { delay: 30 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/07-edited-title.png` })
  await page.mouse.click(50, 800)        // click outside to blur
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/08-final.png` })
}

await browser.close()
console.log("done")
