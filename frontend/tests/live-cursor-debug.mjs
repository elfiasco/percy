/**
 * Deep awareness debug — inspect what B actually sees in awareness states
 * and check whether A's pointer field is propagating.
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

const userA = await signup(ctxA, `lcd-A-${tag}@test.com`, `Pw_${tag}_Aa9!`, "LCD Alice")
const orgId = userA.orgs?.[0]?.id
const pA = await ctxA.newPage()
const cp = await pA.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "LCD" } })
const proj = await cp.json()
const cd = await pA.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: "LCD" } })
const blank = await cd.json()
await pA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
await signup(ctxB, `lcd-B-${tag}@test.com`, `Pw_${tag}_Bb9!`, "LCD Bob")
const inv = await pA.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `lcd-B-${tag}@test.com`, role: "member" } })
const invd = await inv.json()
const pB = await ctxB.newPage()
await pB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

// Capture console logs from both pages
pA.on("console", m => console.log(`[A console] ${m.type()}: ${m.text()}`))
pB.on("console", m => console.log(`[B console] ${m.type()}: ${m.text()}`))

await Promise.all([
  pA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])
await pA.waitForTimeout(12000)

const slideArea = pA.locator('[data-slide-canvas="true"]').first()
const canvasBox = await slideArea.boundingBox().catch(() => null)
console.log("Slide area bbox:", canvasBox)
const cx = canvasBox ? canvasBox.x + canvasBox.width / 2 : 487
const cy = canvasBox ? canvasBox.y + canvasBox.height / 2 : 400

console.log("Moving A's cursor across canvas at:", cx, cy)
for (const [dx, dy] of [[-100, -80], [-50, -40], [0, 0], [50, 40], [100, 80]]) {
  await pA.mouse.move(cx + dx, cy + dy, { steps: 5 })
  await pA.waitForTimeout(200)
}
await pA.waitForTimeout(3000)

// Deep probe: inspect Yjs awareness internals on both pages
const deepProbe = async (page, label) => {
  return page.evaluate(() => {
    // Check if window.__percyYjsRoom was exposed (it may not be)
    const roomInfo = window.__percyYjsRoom ? "present" : "absent"

    // Count awareness-related DOM markers
    const svgCursors = document.querySelectorAll('svg[viewBox="0 0 20 22"]').length
    const hasAlice = !!document.querySelector('[title="LCD Alice"]')
    const hasBob = !!document.querySelector('[title="LCD Bob"]')
    const hasSelf = !!document.querySelector('[title*="(you)"]')

    // Check if LiveCursorLayer rendered anything (look for the pointer-events-none overlay)
    const cursorOverlay = document.querySelectorAll('.absolute.inset-0.pointer-events-none').length

    // Check for any absolute-positioned divs inside the canvas wrapper (cursor divs)
    const canvas = document.querySelector('[data-slide-canvas="true"]')
    const absoluteKids = canvas ? canvas.querySelectorAll('.absolute:not(.inset-0)').length : -1

    return {
      svgCursors,
      hasAlice,
      hasBob,
      hasSelf,
      cursorOverlay,
      absoluteKidsInCanvas: absoluteKids,
      roomInfo,
    }
  })
}

// Also check if A is actually sending pointer updates by looking for awareness
// state via the yjs provider (if exposed on window)
const yjsStateA = await pA.evaluate(() => {
  // Try to find the Yjs awareness via any exposed globals
  const wKeys = Object.keys(window).filter(k =>
    k.includes("yjs") || k.includes("collab") || k.includes("percy") || k.includes("awareness")
  )
  return {
    exposedKeys: wKeys,
    wsUrl: window.__percyYjsWsUrl,
    // Check if the pointer move handler actually triggers (indirect: look for pointer updates in DOM)
    pointerEvents: typeof window.PointerEvent !== "undefined",
  }
}).catch(() => ({}))
console.log("\n[A window globals]", yjsStateA)

console.log("\n=== Deep probe ===")
const aProbe = await deepProbe(pA, "A")
const bProbe = await deepProbe(pB, "B")
console.log("[A sees]", aProbe)
console.log("[B sees]", bProbe)

await import("node:fs/promises").then(({ mkdir }) => mkdir("tests/out/lcd", { recursive: true }))
await pA.screenshot({ path: "tests/out/lcd/A.png" })
await pB.screenshot({ path: "tests/out/lcd/B.png" })
console.log("→ tests/out/lcd/{A,B}.png")

await browser.close()
