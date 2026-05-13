/**
 * End-to-end: every chart-overlay click-to-edit affordance.
 * Title, X-axis title, Y-axis title, categories (Q1→"Quarter 1"), series rename.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/out/chart-full"
const TAG   = Date.now()
const EMAIL = `cf-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "CF" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `CF-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "CF" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })

await page.request.post(`${BASE}/api/docs/${doc.doc_id}/slides/1/elements/chart`, {
  data: {
    chart_type: "column_clustered",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "Revenue", values: [120, 145, 138, 172] },
      { name: "Profit",  values: [30, 42, 38, 55] },
    ],
    position: { left_in: 1.5, top_in: 1.5, width_in: 8, height_in: 4.5 },
  },
  headers: { "Content-Type": "application/json" },
})

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)

const chart = page.locator(`[data-element="true"]`).first()
const box = await chart.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/01-selected.png` })

// 1. Chart title
console.log("[1] chart title")
await page.locator('button:has-text("Add chart title")').first().click()
await page.waitForTimeout(400)
await page.keyboard.type("Q1-Q4 Performance", { delay: 20 })
await page.keyboard.press("Enter")
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/02-title-set.png` })

// 2. X-axis title
console.log("[2] X-axis title")
const xBtn = page.locator('button:has-text("Add X-axis title")').first()
if (await xBtn.count() > 0) {
  await xBtn.click()
  await page.waitForTimeout(400)
  await page.keyboard.type("Quarter", { delay: 20 })
  await page.keyboard.press("Enter")
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${OUT}/03-xaxis-set.png` })

// 3. Y-axis title
console.log("[3] Y-axis title")
const yBtn = page.locator('button:has-text("Add Y-axis title")').first()
if (await yBtn.count() > 0) {
  await yBtn.click()
  await page.waitForTimeout(400)
  await page.keyboard.type("USD (thousands)", { delay: 20 })
  await page.keyboard.press("Enter")
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${OUT}/04-yaxis-set.png` })

// 4. Categories rename — Q1 → Quarter 1
console.log("[4] categories")
const catBtn = page.locator('button:has-text("categories")').first()
if (await catBtn.count() > 0) {
  await catBtn.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/05-cat-flyout.png` })
  // Edit each input — they appear in DOM order Q1..Q4
  const inputs = page.locator('input[value="Q1"], input[value="Q2"], input[value="Q3"], input[value="Q4"]')
  const ic = await inputs.count()
  console.log(`  found ${ic} category inputs`)
  if (ic >= 4) {
    for (let i = 0; i < 4; i++) {
      await inputs.nth(i).fill(`Quarter ${i + 1}`)
      await inputs.nth(i).press("Enter")
      await page.waitForTimeout(400)
    }
  }
  // Close flyout by clicking outside
  await page.mouse.click(50, 800)
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${OUT}/06-cats-renamed.png` })

// 5. Re-select chart then rename series
console.log("[5] series")
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(600)
const seriesBtn = page.locator('button:has-text("series")').first()
if (await seriesBtn.count() > 0) {
  await seriesBtn.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/07-series-flyout.png` })
  const sInputs = page.locator('input[value="Revenue"], input[value="Profit"]')
  const sc = await sInputs.count()
  console.log(`  found ${sc} series inputs`)
  if (sc >= 2) {
    await sInputs.nth(0).fill("Net Revenue")
    await sInputs.nth(0).press("Enter")
    await page.waitForTimeout(400)
    await sInputs.nth(1).fill("Net Profit")
    await sInputs.nth(1).press("Enter")
    await page.waitForTimeout(400)
  }
  await page.mouse.click(50, 800)
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${OUT}/08-series-renamed.png` })

// Final — click outside to deselect
await page.mouse.click(50, 800)
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/09-final-deselected.png` })

await browser.close()
console.log("done")
