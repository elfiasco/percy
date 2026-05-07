// Pull awareness state directly from the page via window globals.
import { chromium } from "playwright"
const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const browser = await chromium.launch({ headless: true })
const a = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const b = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const tag = Date.now()

async function signup(ctx, email, password, name) {
  const p = await ctx.newPage()
  const r = await p.request.post(`${BASE}/api/auth/signup`, { data: { email, password, display_name: name } })
  const me = await r.json()
  await p.close()
  return me
}

const userA = await signup(a, `aw-A-${tag}@example.com`, `Pw_${tag}_!Aa9`, "AW Alice")
const orgId = userA.orgs?.[0]?.id

const pa = await a.newPage()
const cp = await pa.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "AW Test" } })
const proj = await cp.json()
const cd = await pa.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: proj.name } })
const blank = await cd.json()
await pa.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
await pa.request.post(`${BASE}/api/docs/${blank.doc_id}/slides/1/elements/text`, { data: { position: { left_in: 4, top_in: 3, width_in: 5, height_in: 1.5 }, text: "AW" } })

const userB = await signup(b, `aw-B-${tag}@example.com`, `Pw_${tag}_!Bb9`, "AW Bob")
const inv = await pa.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `aw-B-${tag}@example.com`, role: "member" } })
const invd = await inv.json()
const pb = await b.newPage()
await pb.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

await Promise.all([
  pa.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pb.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])

// Wait long
await pa.waitForTimeout(5000)
await pb.waitForTimeout(5000)

// Move mouse on A
const ovA = pa.locator('[data-element="true"]').first()
const box = await ovA.boundingBox()
if (box) {
  await pa.mouse.move(box.x + 200, box.y + 60, { steps: 10 })
  await pa.waitForTimeout(800)
}

// Inspect the page's BroadcastChannel + WebSocket state via console
const inspect = async (page, label) => {
  const r = await page.evaluate(() => {
    // @ts-ignore
    const stores = (globalThis._percyDiag = globalThis._percyDiag || {})
    return stores
  })
  console.log(`[${label}]`, JSON.stringify(r))
}
await inspect(pa, "A")
await inspect(pb, "B")

// Check DOM cursor SVGs again
const cA = await pa.locator('svg[viewBox="0 0 20 22"]').count()
const cB = await pb.locator('svg[viewBox="0 0 20 22"]').count()
console.log(`A: ${cA} cursors visible | B: ${cB} cursors visible`)

// Check presence avatars
const avA = await pa.locator('[title]').filter({ hasText: /^[A-Z]{2}$/ }).count().catch(() => 0)
const avB = await pb.locator('[title]').filter({ hasText: /^[A-Z]{2}$/ }).count().catch(() => 0)
console.log(`A: ${avA} avatars | B: ${avB} avatars`)

await browser.close()
