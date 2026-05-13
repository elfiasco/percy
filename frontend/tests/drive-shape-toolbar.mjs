/**
 * Verify the shape inline toolbar shows up on selected shapes.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/out/shape-toolbar"
const TAG   = Date.now()
const EMAIL = `st-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "ST" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `ST-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "ST" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })

// Insert a rectangle
await page.request.post(`${BASE}/api/docs/${doc.doc_id}/slides/1/elements`, {
  data: {
    shape_type: "rect",
    left_in: 3, top_in: 2, width_in: 5, height_in: 3,
    fill_color: "#3366CC",
    label: "Shape",
  },
  headers: { "Content-Type": "application/json" },
})

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)

// Select shape
const sh = page.locator(`[data-element="true"]`).first()
const box = await sh.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/01-selected.png` })

// Try clicking the Fill button
const fillBtn = page.locator('button:has-text("Fill")').first()
const fillCount = await fillBtn.count()
console.log(`Fill button visible: ${fillCount > 0}`)
if (fillCount > 0) {
  await fillBtn.click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/02-fill-open.png` })
}

await browser.close()
console.log("done")
