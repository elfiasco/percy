/**
 * Verify the table cell right-click context menu shows up and works.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT   = "tests/out/table-ctx"
const TAG   = Date.now()
const EMAIL = `tc-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "TC" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `TC-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "TC" }, headers: { "Content-Type": "application/json" } })
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

// Right-click in the middle cell
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/01-ctx-open.png` })

const items = await page.evaluate(() => {
  const menu = document.querySelector('[data-table-ctx="true"]')
  if (!menu) return null
  return Array.from(menu.querySelectorAll("button")).map((b) => b.textContent?.trim())
})
console.log("Menu items:", items)

// Click "Insert row below"
const insertBelow = page.locator('button:has-text("Insert row below")')
if (await insertBelow.count() > 0) {
  await insertBelow.first().click()
  await page.waitForTimeout(2500)  // wait longer for debounce + resize
  await page.screenshot({ path: `${OUT}/02-row-inserted.png` })
}

// Debug — inspect DOM
const dbg = await page.evaluate(() => {
  const el = document.querySelector('[data-element="true"]')
  const elRect = el?.getBoundingClientRect()
  const wrapper = el?.querySelector('div[style*="width: 100%"]')
  const tbl = el?.querySelector("table")
  const trs = Array.from(el?.querySelectorAll("tr") || [])
  const editor = el?.querySelector('.tiptap-bridge-table-editor')
  return {
    elementH: elRect?.height,
    wrapperH: wrapper?.clientHeight,
    editorH: editor?.clientHeight,
    editorClass: editor?.className,
    editorInlineStyle: editor?.getAttribute("style") || "(none)",
    editorComputedHeight: window.getComputedStyle(editor)?.height,
    editorParent: editor?.parentElement?.tagName + " " + editor?.parentElement?.className,
    editorParentH: editor?.parentElement?.clientHeight,
    tableH:   tbl?.clientHeight,
    tableStyleH: tbl ? window.getComputedStyle(tbl).height : null,
    trCount:  trs.length,
    trHeights: trs.map((t) => ({ inline: t.style.height, actual: t.clientHeight })),
  }
})
console.log("DOM state after insert:", JSON.stringify(dbg, null, 2))

// Right-click again, click "Delete table" to test danger style
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3, { button: "right" })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/03-ctx-second.png` })

await browser.close()
console.log("done")
