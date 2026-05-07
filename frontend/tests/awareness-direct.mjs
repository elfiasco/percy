// Direct awareness test — set custom awareness on A, read on B.
import { chromium } from "playwright"
const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const browser = await chromium.launch({ headless: true })
const a = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const b = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const tag = Date.now()

async function signup(ctx, em, pw, nm) {
  const p = await ctx.newPage()
  const r = await p.request.post(`${BASE}/api/auth/signup`, { data: { email: em, password: pw, display_name: nm } })
  const me = await r.json()
  await p.close()
  return me
}

const userA = await signup(a, `awd-A-${tag}@example.com`, `Pw_${tag}_!Aa9`, "AWD A")
const orgId = userA.orgs?.[0]?.id
const pa = await a.newPage()
const cp = await pa.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "AWD" } })
const proj = await cp.json()
const cd = await pa.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: proj.name } })
const blank = await cd.json()
await pa.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })

await signup(b, `awd-B-${tag}@example.com`, `Pw_${tag}_!Bb9`, "AWD B")
const inv = await pa.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `awd-B-${tag}@example.com`, role: "member" } })
const invd = await inv.json()
const pb = await b.newPage()
await pb.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

await Promise.all([
  pa.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pb.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])
await pa.waitForTimeout(6000)
await pb.waitForTimeout(2000)

// Probe: how many distinct awareness states does each side see?
const aw = async (page, label) => {
  const probe = await page.evaluate(() => {
    // Walk all WebSocket instances; can't directly access modules.
    // Best signal: count remote-cursor renderings.
    const cursors = document.querySelectorAll('svg[viewBox="0 0 20 22"]').length
    const rings = document.querySelectorAll('[style*="percy-remote-ring-pulse"]').length
    const avatars = document.querySelectorAll('[title]').length
    return { cursors, rings, avatars }
  })
  console.log(`[${label}]`, probe)
}

// Move A's mouse around
const ovA = pa.locator('[data-element="true"]').first()
const box = await ovA.boundingBox().catch(() => null)
console.log("A canvas bbox:", box)

if (box) {
  for (const [x, y] of [[100, 80], [300, 150], [500, 80]]) {
    await pa.mouse.move(box.x + x, box.y + y, { steps: 10 })
    await pa.waitForTimeout(400)
  }
}
await pa.waitForTimeout(1500)
await pb.waitForTimeout(1500)
await aw(pa, "A")
await aw(pb, "B")

// Force a SELECTION on A by clicking an element edge
if (box) {
  await pa.mouse.click(box.x + 30, box.y + 30)
  await pa.waitForTimeout(2000)
}
await pb.waitForTimeout(1500)
await aw(pa, "A")
await aw(pb, "B")

// snap
await import("node:fs/promises").then(({ mkdir }) => mkdir("tests/out/awd", { recursive: true }))
await pa.screenshot({ path: "tests/out/awd/A.png" })
await pb.screenshot({ path: "tests/out/awd/B.png" })
console.log("→ tests/out/awd/{A,B}.png")
await browser.close()
