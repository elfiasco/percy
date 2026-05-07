/**
 * Live cursor test — verifies remote cursor SVG appears when user moves over canvas.
 */
import { chromium } from "playwright"
const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const browser = await chromium.launch({ headless: true })
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const tag = Date.now()

async function signup(ctx, em, pw, nm) {
  const p = await ctx.newPage()
  const r = await p.request.post(`${BASE}/api/auth/signup`, { data: { email: em, password: pw, display_name: nm } })
  const me = await r.json()
  await p.close()
  return me
}

const userA = await signup(ctxA, `lc2-A-${tag}@test.com`, `Pw_${tag}_Aa9!`, "LC2 Alice")
const orgId = userA.orgs?.[0]?.id
const pA = await ctxA.newPage()
const cp = await pA.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "LC2" } })
const proj = await cp.json()
const cd = await pA.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "LC2" } })
const blank = await cd.json()
await pA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
await signup(ctxB, `lc2-B-${tag}@test.com`, `Pw_${tag}_Bb9!`, "LC2 Bob")
const inv = await pA.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `lc2-B-${tag}@test.com`, role: "member" } })
const invd = await inv.json()
const pB = await ctxB.newPage()
await pB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

await Promise.all([
  pA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])
await pA.waitForTimeout(12000)

// Find the slide canvas by its surrounding box
// The canvas is the white area in the center (roughly x:115-870, y:100-770 at 1280x800)
const slideArea = pA.locator('[data-slide-canvas="true"], [class*="slide-wrapper"], [class*="canvas-wrapper"]').first()
const canvasBox = await slideArea.boundingBox().catch(() => null)
console.log("Slide area bbox:", canvasBox)

// Fallback: use the center of the blank slide area
const cx = canvasBox ? canvasBox.x + canvasBox.width / 2 : 487
const cy = canvasBox ? canvasBox.y + canvasBox.height / 2 : 400

// Hover first to ensure the pointer lands on the canvas element (bbox x can be negative)
if (canvasBox) await slideArea.hover({ position: { x: canvasBox.width / 2, y: canvasBox.height / 2 } })

// Move A's mouse slowly across the canvas
console.log("Moving A's cursor across canvas at:", cx, cy)
for (const [dx, dy] of [[-100, -80], [-50, -40], [0, 0], [50, 40], [100, 80]]) {
  await pA.mouse.move(cx + dx, cy + dy, { steps: 5 })
  await pA.waitForTimeout(200)
}
await pA.waitForTimeout(3000)

const cursorsOnB = await pB.evaluate(() => {
  return {
    svgCursors: document.querySelectorAll('svg[viewBox="0 0 20 22"]').length,
    cursorPills: document.querySelectorAll('[class*="cursor-pill"], [class*="LiveCursor"]').length,
    hasOther: !!document.querySelector('[title="LC2 Alice"]'),
  }
})
console.log("[B sees]", cursorsOnB)

await import("node:fs/promises").then(({ mkdir }) => mkdir("tests/out/lc2", { recursive: true }))
await pA.screenshot({ path: "tests/out/lc2/A-cursor.png" })
await pB.screenshot({ path: "tests/out/lc2/B-cursor.png" })
console.log("→ tests/out/lc2/{A,B}-cursor.png")

await browser.close()
console.log(cursorsOnB.hasOther ? "\n✅ Awareness OK" : "\n❌ No remote user visible")
