import { chromium } from "playwright"

const BASE  = "https://36kuepamyi.us-east-1.awsapprunner.com"
const TAG   = Date.now()
const EMAIL = `dbg-${TAG}@test.com`
const PW    = `Pw_${TAG}_Vv9!`
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "Dbg" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: `Dbg-${TAG}` }, headers: { "Content-Type": "application/json" } })
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "DbgDoc" }, headers: { "Content-Type": "application/json" } })
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" } })
await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/table`,
  { data: { rows: 3, cols: 3, position: { left_in: 1.5, top_in: 2, width_in: 8, height_in: 3 } }, headers: { "Content-Type": "application/json" } },
)

await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)

// Capture ALL console output to debug
page.on("console", (msg) => {
  console.log(`  [b/${msg.type()}]`, msg.text().slice(0, 300))
})
page.on("pageerror", (err) => console.log(`  [b/ERROR]`, err.message))

// Inject diagnostics: hook into the studio store
await page.evaluate(() => {
  const tries = setInterval(() => {
    const s = (window).__percy_store_debug
    if (s) { clearInterval(tries); console.log("[dbg] store debug attached") }
  }, 100)
})

// Check initial DOM
const before = await page.evaluate(() => ({
  hasTable: !!document.querySelector(".bridge-table, table"),
  hasTiptapTableEditor: !!document.querySelector(".tiptap-bridge-table-editor"),
  elements: Array.from(document.querySelectorAll('[data-element="true"]')).length,
  overlayLoaded: !!(window).__percy_overlay_loaded,
  storeAvailable: typeof (window).__percy_store !== "undefined",
}))
console.log("before:", before)

// Try a direct dispatch of native dblclick + manually call store
const directProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-element="true"]')
  if (!el) return { error: "no element" }
  const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
  el.dispatchEvent(evt)
  return { dispatched: true, classes: el.className }
})
console.log("direct dispatch:", directProbe)
await page.waitForTimeout(500)
const afterDirect = await page.evaluate(() => ({
  hasTiptapTableEditor: !!document.querySelector(".tiptap-bridge-table-editor"),
  hasProseMirror: !!document.querySelector(".ProseMirror"),
}))
console.log("after direct dispatch:", afterDirect)

// Click table to select
const tbl = page.locator(`[data-element="true"]`).first()
const box = await tbl.boundingBox()
console.log("table box:", box)
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(600)

const afterClick = await page.evaluate(() => ({
  hasTiptapTableEditor: !!document.querySelector(".tiptap-bridge-table-editor"),
  selectedHandles: document.querySelectorAll('[style*="cursor: nw-resize"], [style*="cursor: se-resize"]').length,
}))
console.log("after click1:", afterClick)

// DOUBLE CLICK
console.log("dispatching dblclick…")
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(1500)

const afterDblclick = await page.evaluate(() => ({
  hasTiptapTableEditor: !!document.querySelector(".tiptap-bridge-table-editor"),
  hasProseMirror: !!document.querySelector(".ProseMirror"),
  contentEditableCount: document.querySelectorAll('[contenteditable="true"]').length,
  // Also probe the studio store via the global sync hook (if accessible)
}))
console.log("after dblclick:", afterDblclick)

// Try typing
await page.keyboard.type("HELLO", { delay: 50 })
await page.waitForTimeout(800)

const afterType = await page.evaluate(() => {
  const editor = document.querySelector(".tiptap-bridge-table-editor")
  return {
    hasTiptapTableEditor: !!editor,
    editorHtml: editor ? editor.innerHTML.slice(0, 200) : null,
    activeElement: document.activeElement?.tagName + "." + (document.activeElement?.className || ""),
    bodyHtml: document.body.innerText.includes("HELLO"),
  }
})
console.log("after type:", afterType)

await page.screenshot({ path: "tests/out/debug-table-final.png" })
await browser.close()
console.log("done")
