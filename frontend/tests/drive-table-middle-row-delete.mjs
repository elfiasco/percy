/**
 * Verify deleting a MIDDLE row drops the correct slot in row_heights
 * (not the last one, which is what naive truncate would do).
 *
 * Steps:
 *  - Create a 4-row table with custom row_heights = [0.5, 2.0, 0.5, 0.5]
 *    (one tall middle row — this is the marker we'll watch)
 *  - Select the table, place cursor in row 2 (the tall one), Delete row
 *  - Verify the remaining row_heights are [0.5, 0.5, 0.5] (tall slot gone),
 *    NOT [0.5, 2.0, 0.5] (which is what truncate-from-end would do)
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const API   = "https://api-dev.percydeck.com"   // placeholder — overridden by env if needed
const OUT   = "tests/out/table-middle-delete"
const TAG   = Date.now()
const EMAIL = `tmd-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "TMD" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `TMD-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "TMD" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })

const insertResp = await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/table`,
  { data: { rows: 4, cols: 2, position: { left_in: 1.5, top_in: 2, width_in: 8, height_in: 3.5 } }, headers: { "Content-Type": "application/json" } },
)
const elem = await insertResp.json()
const elementId = elem.id ?? elem.element_id ?? elem?.element?.id
console.log("element id:", elementId)

// Patch in custom row_heights via the text payload endpoint
// (Tall middle row at index 1 — the marker)
const customText = {
  kind: "table",
  rows: 4, cols: 2,
  properties: null,
  row_heights: [0.5, 2.0, 0.5, 0.5],
  cells: [
    [{ row: 0, col: 0, text: "A1", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null },
     { row: 0, col: 1, text: "B1", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null }],
    [{ row: 1, col: 0, text: "TALL", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null },
     { row: 1, col: 1, text: "ROW",  paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null }],
    [{ row: 2, col: 0, text: "A3", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null },
     { row: 2, col: 1, text: "B3", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null }],
    [{ row: 3, col: 0, text: "A4", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null },
     { row: 3, col: 1, text: "B4", paragraphs: [], font_name: null, font_size: null, font_bold: null, font_italic: null, font_color: null, fill_color: null, fill_type: null, h_align: null, v_align: null, word_wrap: null, merge: null, borders: null }],
  ],
}
const patchResp = await page.request.patch(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/${elementId}/text`,
  { data: { text: customText }, headers: { "Content-Type": "application/json" } },
)
console.log("patch status:", patchResp.status())

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)

// Select & screenshot — should show the tall middle row
const tbl = page.locator(`[data-element="true"]`).first()
const box = await tbl.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/01-selected.png` })

const heightsBefore = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('[data-element="true"] tr'))
  return trs.map((tr) => Math.round(tr.getBoundingClientRect().height))
})
console.log("Row heights before delete:", heightsBefore)

// Right-click in the middle (TALL) row to open ctx menu, then Delete row
// The tall row sits at roughly: rowTops grow as: 0.5, 0.5+2.0=2.5, ... so its center is at top + 1.5/3.5 of element height
const tallCenterY = box.y + (1.5 / 3.5) * box.height
await page.mouse.click(box.x + box.width / 2, tallCenterY, { button: "right" })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/02-ctx-open.png` })

const del = page.locator('button:has-text("Delete row")')
if (await del.count() > 0) {
  await del.first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/03-after-delete.png` })
}

// Heights should be 3 rows now, all roughly equal (the 2.0 slot is gone)
const heightsAfter = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('[data-element="true"] tr'))
  return trs.map((tr) => Math.round(tr.getBoundingClientRect().height))
})
console.log("Row heights after delete:", heightsAfter)

// Reload to read persisted row_heights from server
await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)
const heightsAfterReload = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('[data-element="true"] tr'))
  return trs.map((tr) => Math.round(tr.getBoundingClientRect().height))
})
console.log("Row heights after reload:", heightsAfterReload)
await page.screenshot({ path: `${OUT}/04-after-reload.png` })

// Verdict — all three reloaded heights should be roughly equal (no tall row left).
// If reconciliation went wrong and dropped the LAST slot, we'd see one row ~3x taller.
const max = Math.max(...heightsAfterReload), min = Math.min(...heightsAfterReload)
console.log(`reload range: min=${min} max=${max} ratio=${(max / min).toFixed(2)}`)
if (heightsAfterReload.length === 3 && max / min < 1.5) {
  console.log("PASS — tall middle row was correctly dropped")
} else {
  console.log("FAIL — wrong slot was dropped, or row count unexpected")
}

await browser.close()
console.log("done")
