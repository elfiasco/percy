/**
 * Targeted pointer trace test — verifies pointer events actually reach the
 * canvas div and that awareness pointer field is being set on A's side.
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

const userA = await signup(ctxA, `cpt-A-${tag}@test.com`, `Pw_${tag}_Aa9!`, "CPT Alice")
const orgId = userA.orgs?.[0]?.id
const pA = await ctxA.newPage()
const cp = await pA.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "CPT" } })
const proj = await cp.json()
const cd = await pA.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "CPT" } })
const blank = await cd.json()
await pA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
await signup(ctxB, `cpt-B-${tag}@test.com`, `Pw_${tag}_Bb9!`, "CPT Bob")
const inv = await pA.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `cpt-B-${tag}@test.com`, role: "member" } })
const invd = await inv.json()
const pB = await ctxB.newPage()
await pB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

await Promise.all([
  pA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])
await pA.waitForTimeout(12000)

// Step 1: inject a pointer-event counter onto the canvas on A's page
await pA.evaluate(() => {
  const canvas = document.querySelector('[data-slide-canvas="true"]')
  if (!canvas) { window.__pointerCount = -1; return }
  window.__pointerCount = 0
  canvas.addEventListener('pointermove', () => { window.__pointerCount++ }, true)
})

const canvas = pA.locator('[data-slide-canvas="true"]').first()
const box = await canvas.boundingBox()
console.log("Canvas bbox:", box)

// Step 2: hover directly over the canvas element (Playwright ensures it lands on that element)
await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
await pA.waitForTimeout(500)

// Step 3: move mouse in small steps
for (const [dx, dy] of [[-100, -80], [-50, -40], [0, 0], [50, 40], [100, 80]]) {
  await pA.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 })
  await pA.waitForTimeout(200)
}
await pA.waitForTimeout(3000)

const traceA = await pA.evaluate(() => ({
  pointerCount: window.__pointerCount,
  // Check if window has any exposed Yjs/collab globals
  yjsKeys: Object.keys(window).filter(k => /yjs|collab|awareness|percy/i.test(k)),
}))
console.log("[A trace]", traceA)

// Step 4: check B for cursors
const bCheck = await pB.evaluate(() => {
  const svgCursors = document.querySelectorAll('svg[viewBox="0 0 20 22"]').length
  const hasAlice = !!document.querySelector('[title="CPT Alice"]')
  // Any absolute divs in the cursor layer area?
  const cursorDivs = document.querySelectorAll('.absolute[style*="left:"],.absolute[style*="left: "]').length
  return { svgCursors, hasAlice, cursorDivs }
})
console.log("[B check]", bCheck)

await import("node:fs/promises").then(({ mkdir }) => mkdir("tests/out/cpt", { recursive: true }))
await pA.screenshot({ path: "tests/out/cpt/A.png" })
await pB.screenshot({ path: "tests/out/cpt/B.png" })
console.log("→ tests/out/cpt/{A,B}.png")

await browser.close()

console.log(bCheck.svgCursors > 0
  ? "\n✅ Live cursors WORKING"
  : `\n❌ No cursor (pointerCount=${traceA.pointerCount}, hasAlice=${bCheck.hasAlice})`)
