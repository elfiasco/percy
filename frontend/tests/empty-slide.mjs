import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT = "tests/out/empty"
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const tag = Date.now()
const page = await ctx.newPage()
const sr = await page.request.post(`${BASE}/api/auth/signup`, { data: { email: `es-${tag}@example.com`, password: `Pw_${tag}_!Aa9`, display_name: "ES" } })
const me = await sr.json()
const orgId = me.orgs?.[0]?.id
const cp = await page.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "Empty Slide" } })
const proj = await cp.json()
const cd = await page.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: proj.name } })
const blank = await cd.json()
await page.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
await page.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })
await page.waitForTimeout(2500)
await mkdir(OUT, { recursive: true })
await page.screenshot({ path: `${OUT}/empty.png` })
console.log("→ empty.png")
await browser.close()
