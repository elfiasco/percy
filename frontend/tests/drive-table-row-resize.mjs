/**
 * Verify row-resize drag handle works on tables.
 *  - Insert a 3x3 table
 *  - Select it
 *  - Drag the first row/second row boundary down to make row 1 taller
 *  - Verify row heights persisted via reload
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/out/table-row-resize"
const TAG   = Date.now()
const EMAIL = `tr-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()
page.on("console", (m) => {
  const t = m.text()
  if (t.includes("[Percy]")) console.log("BROWSER:", t)
})

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "TR" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `TR-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "TR" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })

await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/table`,
  { data: { rows: 3, cols: 3, position: { left_in: 1.5, top_in: 2, width_in: 8, height_in: 3 } }, headers: { "Content-Type": "application/json" } },
)

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)

// Select the table
const tbl = page.locator(`[data-element="true"]`).first()
const box = await tbl.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/01-selected.png` })

// Find the actual handles in the DOM and pick the first one
const handles = await page.evaluate(() => {
  // Row resize handles have cursor: ns-resize and zIndex: 7. Find them.
  const all = Array.from(document.querySelectorAll('[data-element="true"] div'))
  return all
    .filter((d) => (d).style?.cursor === "ns-resize")
    .map((d) => {
      const r = (d).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, w: r.width, top: r.top }
    })
})
console.log("Resize handles found:", handles)
const firstHandle = handles[0]
const handleX = firstHandle ? firstHandle.x : box.x + box.width / 2
const handleY = firstHandle ? firstHandle.y : box.y + 102
console.log(`First row boundary at ~y=${handleY}`)

// First try direct DOM dispatch — bypasses Playwright mouse simulation so
// we can confirm the handler wiring works independently of input simulation.
const dispatchResult = await page.evaluate(({ hx, hy, dy }) => {
  const all = Array.from(document.querySelectorAll('[data-element="true"] div'))
  const handle = all.find((d) => (d).style?.cursor === "ns-resize")
  if (!handle) return { ok: false, reason: "no handle" }
  const r = handle.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top  + r.height / 2
  handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: cx, clientY: cy, button: 0 }))
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cx, clientY: cy + dy }))
  document.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, clientX: cx, clientY: cy + dy }))
  return { ok: true, cx, cy, hx, hy }
}, { hx: handleX, hy: handleY, dy: 40 })
console.log("Direct dispatch result:", dispatchResult)
await page.waitForTimeout(1800)  // let save complete
await page.screenshot({ path: `${OUT}/02-after-resize.png` })

// Measure new row heights
const heights = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('[data-element="true"] tr'))
  return trs.map((tr) => Math.round(tr.getBoundingClientRect().height))
})
console.log("Row heights after resize:", heights)

// Reload the page to verify persistence
await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)
const heightsAfterReload = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('[data-element="true"] tr'))
  return trs.map((tr) => Math.round(tr.getBoundingClientRect().height))
})
console.log("Row heights after reload:", heightsAfterReload)
await page.screenshot({ path: `${OUT}/03-after-reload.png` })

await browser.close()
console.log("done")
