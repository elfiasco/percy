/**
 * Drive a real Percy session via Playwright and capture screenshots at every
 * step of CHART editing and TABLE editing flows. Used by Claude to inspect
 * the UX visually and identify rough edges.
 *
 * Usage: node tests/drive-chart-table-ux.mjs [BASE_URL]
 *
 * Output: tests/out/ux/<flow>-<NN>-<slug>.png
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE   = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT    = "tests/out/ux"
const TAG    = Date.now()
const EMAIL  = `ux-${TAG}@test.com`
const PW     = `Pw_${TAG}_Vv9!`
const VIEW   = { width: 1440, height: 900 }

await mkdir(OUT, { recursive: true })

const log = (...args) => console.log("[ux]", ...args)
let counter = 0

async function snap(page, flow, slug) {
  counter++
  const fn = `${OUT}/${flow}-${String(counter).padStart(2, "0")}-${slug}.png`
  await page.screenshot({ path: fn, fullPage: false })
  log(`  📸 ${fn}`)
  return fn
}

// ── Bootstrap (signup + blank deck) ─────────────────────────────────────────
log(`base: ${BASE}`)
const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext({ viewport: VIEW, ignoreHTTPSErrors: true })
const page    = await ctx.newPage()

const su = await page.request.post(`${BASE}/api/auth/signup`, {
  data: { email: EMAIL, password: PW, display_name: "UX Tester" },
  headers: { "Content-Type": "application/json" },
})
const me = await su.json()
const orgId = me?.orgs?.[0]?.id ?? me?.org?.id
log(`signed up; org ${orgId}`)

const cp = await page.request.post(`${BASE}/api/projects`, {
  data: { org_id: orgId, name: `UX-${TAG}` },
  headers: { "Content-Type": "application/json" },
})
const projId = (await cp.json()).id
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, {
  data: { width_in: 13.333, height_in: 7.5, name: "UXDoc" },
  headers: { "Content-Type": "application/json" },
})
const doc = await cd.json()
await page.request.patch(`${BASE}/api/projects/${projId}`, {
  data: { doc_id: doc.doc_id }, headers: { "Content-Type": "application/json" },
})
log(`project ${projId} doc ${doc.doc_id}`)

// Navigate to studio
await page.goto(`${BASE}/studio/${projId}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForTimeout(2500)
log("studio loaded")

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: CHART EDITING UX
// ─────────────────────────────────────────────────────────────────────────────
log("\n── CHART FLOW ──")

await snap(page, "chart", "00-fresh-studio")

// Insert chart via API (more reliable than driving the UI for setup)
const chart = await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/chart`,
  {
    data: {
      chart_type: "column_clustered",
      categories: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { name: "Revenue", values: [120, 145, 138, 172] },
        { name: "Profit",  values: [30,  42,  38,  55] },
      ],
      position: { left_in: 1.5, top_in: 1.5, width_in: 8, height_in: 4.5 },
    },
    headers: { "Content-Type": "application/json" },
  },
)
const chartEl = await chart.json()
log(`chart element: ${chartEl.id}`)
await page.reload()
await page.waitForTimeout(2500)
await snap(page, "chart", "01-after-insert")

// Click the chart element to select it
const chartLoc = page.locator(`[data-element="true"]`).first()
const chartBox = await chartLoc.boundingBox()
if (chartBox) {
  await page.mouse.click(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2)
  await page.waitForTimeout(700)
  await snap(page, "chart", "02-selected")
} else {
  log("  ✗ could not find chart element")
}

// Click Format Options panel button or the chart again to see editing options
// In Percy the right panel shows up automatically; double-click should open
// the chart editor for native rendering
await page.mouse.dblclick(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2)
await page.waitForTimeout(1200)
await snap(page, "chart", "03-doubleclick")

// Inspect the right side panel — what's there?
const rightPanelText = await page.evaluate(() => {
  const panel = document.querySelector('[class*="properties"], [data-properties-panel]')
  return panel ? (panel.innerText || "").slice(0, 400) : "(no panel found)"
})
log(`right panel text: ${rightPanelText.slice(0, 200)}…`)

// Try to find a "Chart Editor" panel via any button labelled "Edit"
const editBtn = page.locator('button:has-text("Edit data"), button:has-text("Edit")').first()
if (await editBtn.count() > 0) {
  await editBtn.scrollIntoViewIfNeeded().catch(() => {})
  await snap(page, "chart", "04-before-edit-click")
  await editBtn.click().catch((e) => log(`  edit click failed: ${e.message}`))
  await page.waitForTimeout(1000)
  await snap(page, "chart", "05-edit-clicked")
} else {
  log("  ✗ no 'Edit' button found in chart editor panel")
}

// Look for tab buttons (Data / Series / Axes / Title) that ChartEditorPanel
// is supposed to expose
const tabs = await page.locator('button[role="tab"], button:has-text("Data"), button:has-text("Series"), button:has-text("Axes"), button:has-text("Title")').all()
log(`  found ${tabs.length} potential tab buttons in panel`)
for (let i = 0; i < Math.min(tabs.length, 8); i++) {
  const t = tabs[i]
  const txt = await t.innerText().catch(() => "")
  log(`    tab[${i}]: "${txt.slice(0, 30)}"`)
}

// Try clicking each tab in turn (if they exist) and snap
for (const label of ["Data", "Series", "Axes", "Title"]) {
  const btn = page.locator(`button:has-text("${label}")`).first()
  if (await btn.count() > 0) {
    await btn.click().catch(() => {})
    await page.waitForTimeout(500)
    await snap(page, "chart", `06-tab-${label.toLowerCase()}`)
  }
}

// Try a chart-type change (we expect it to be in Series or Data tab)
// Search for any select/dropdown containing chart_type-like options
const chartTypeSelect = page.locator('select').first()
if (await chartTypeSelect.count() > 0) {
  const options = await chartTypeSelect.locator("option").allTextContents()
  log(`  first <select> options: [${options.slice(0, 6).join(", ")}…]`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: TABLE EDITING UX
// ─────────────────────────────────────────────────────────────────────────────
log("\n── TABLE FLOW ──")
counter = 0  // restart for table flow

// Delete the chart so we have a clean slide
await page.request.delete(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/${chartEl.id}`,
).catch(() => {})

// Insert a 3×3 table via API
const tableRes = await page.request.post(
  `${BASE}/api/docs/${doc.doc_id}/slides/1/elements/table`,
  {
    data: {
      rows: 3, cols: 3,
      position: { left_in: 1.5, top_in: 2, width_in: 8, height_in: 3 },
    },
    headers: { "Content-Type": "application/json" },
  },
)
const tableEl = await tableRes.json()
log(`table element: ${tableEl.id}`)
await page.reload()
await page.waitForTimeout(2500)
await snap(page, "table", "00-after-insert")

// Click table to select
const tblLoc = page.locator(`[data-element="true"]`).first()
const tblBox = await tblLoc.boundingBox()
if (tblBox) {
  await page.mouse.click(tblBox.x + tblBox.width / 2, tblBox.y + tblBox.height / 2)
  await page.waitForTimeout(500)
  await snap(page, "table", "01-selected")
} else {
  log("  ✗ could not find table element")
}

// Double-click to enter edit mode
await page.mouse.dblclick(tblBox.x + tblBox.width / 2, tblBox.y + tblBox.height / 2)
await page.waitForTimeout(1200)
await snap(page, "table", "02-edit-mode")

// Type into the focused cell
await page.keyboard.type("Hello", { delay: 30 })
await page.waitForTimeout(400)
await snap(page, "table", "03-typed-hello")

// Tab to next cell
await page.keyboard.press("Tab")
await page.waitForTimeout(300)
await page.keyboard.type("World", { delay: 30 })
await page.waitForTimeout(400)
await snap(page, "table", "04-tab-and-typed")

// Tab through more cells
await page.keyboard.press("Tab")
await page.keyboard.type("Foo", { delay: 30 })
await page.keyboard.press("Tab")
await page.keyboard.type("Bar", { delay: 30 })
await page.keyboard.press("Tab")
await page.keyboard.type("Baz", { delay: 30 })
await page.waitForTimeout(400)
await snap(page, "table", "05-tabbed-multiple")

// Try arrow keys to move
await page.keyboard.press("ArrowDown")
await page.waitForTimeout(200)
await snap(page, "table", "06-arrow-down")

// Try Ctrl+M to merge cells (Tiptap shortcut)
await page.keyboard.press("ArrowUp")
await page.keyboard.press("ArrowUp")
// Select left-most cell, then shift+right to extend
await page.keyboard.down("Shift")
await page.keyboard.press("ArrowRight")
await page.keyboard.up("Shift")
await page.waitForTimeout(300)
await snap(page, "table", "07-shift-right-selected-cells")

await page.keyboard.press("Control+m")
await page.waitForTimeout(500)
await snap(page, "table", "08-after-ctrl-m-merge")

// Test TSV paste — copy TSV to system clipboard then paste
const tsv = "Name\tAge\tCity\nAlice\t30\tNYC\nBob\t25\tSF"
// Use Playwright's clipboard API
await ctx.grantPermissions(["clipboard-read", "clipboard-write"])
await page.evaluate(async (text) => {
  await navigator.clipboard.writeText(text)
}, tsv)
await page.waitForTimeout(300)
// Click into the table again to ensure focus
await page.mouse.dblclick(tblBox.x + tblBox.width / 2, tblBox.y + tblBox.height / 2)
await page.waitForTimeout(500)
await page.keyboard.press("Control+a")
await page.keyboard.press("Control+v")
await page.waitForTimeout(800)
await snap(page, "table", "09-after-tsv-paste")

// Click outside to commit
await page.mouse.click(50, 500)
await page.waitForTimeout(800)
await snap(page, "table", "10-deselected-final")

// ─────────────────────────────────────────────────────────────────────────────

await browser.close()

// Write a manifest of all screenshots so Claude knows what to look at
const { readdirSync } = await import("node:fs")
const files = readdirSync(OUT).filter((f) => f.endsWith(".png")).sort()
await writeFile(`${OUT}/manifest.json`, JSON.stringify({ run_id: TAG, files }, null, 2))
log(`\n✓ done. ${files.length} screenshots in ${OUT}/`)
log("manifest:", `${OUT}/manifest.json`)
