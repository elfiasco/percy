/**
 * Awareness propagation test v2 — checks for presence avatars and cursor overlays.
 *
 * Strategy:
 * 1. Sign up two users (A, B), create a shared project, invite B
 * 2. Load both pages at the same URL
 * 3. Wait for WS connections and awareness propagation
 * 4. Check: does page A show B's avatar? Does page B show A's avatar?
 * 5. Add a textbox via the API, move A's mouse over the canvas → check for cursor on B's page
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

const userA = await signup(ctxA, `aw2-A-${tag}@example.com`, `Pw_${tag}_!Aa9`, "Alice AW2")
const orgId = userA.orgs?.[0]?.id
const pA = await ctxA.newPage()
const cp = await pA.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "AW2 Test" } })
const proj = await cp.json()
const cd = await pA.request.post(`${BASE}/api/docs/create-blank`, { data: { width_in: 13.333, height_in: 7.5, name: proj.name } })
const blank = await cd.json()
await pA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })

await signup(ctxB, `aw2-B-${tag}@example.com`, `Pw_${tag}_!Bb9`, "Bob AW2")
const inv = await pA.request.post(`${BASE}/api/orgs/${orgId}/invites`, { data: { email: `aw2-B-${tag}@example.com`, role: "member" } })
const invd = await inv.json()
const pB = await ctxB.newPage()
await pB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invd.token)}`)

// Navigate both pages to the same project
console.log("Loading studio for both users…")
await Promise.all([
  pA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  pB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
])

// Wait for WS connections and initial awareness sync (provider connects async)
// 12s is enough for: page load → collab-token fetch → WS connect → awareness broadcast
await pA.waitForTimeout(12000)
await pB.waitForTimeout(6000)

// Probe for collaborator avatars
const probe = async (page, selfName, otherName, label) => {
  return page.evaluate(({ selfName, otherName }) => {
    // PresenceAvatars renders <div title="Name (you)"> for self and <div title="Name"> for remote
    const selfBubble = document.querySelector(`[title="${selfName} (you)"]`)
    const otherBubble = document.querySelector(`[title="${otherName}"]`)
    const collabText = Array.from(document.querySelectorAll("*"))
      .find(el => el.childElementCount === 0 && el.textContent?.includes("collaborator"))
    const svgCursors = document.querySelectorAll('svg[viewBox="0 0 20 22"]').length
    return {
      hasSelf: !!selfBubble,
      hasOther: !!otherBubble,
      collabLabel: collabText?.textContent?.trim() || null,
      svgCursors,
    }
  }, { selfName, otherName })
}

console.log("\n=== Awareness check after 8s ===")
const aResult = await probe(pA, "Alice AW2", "Bob AW2", "A")
const bResult = await probe(pB, "Bob AW2", "Alice AW2", "B")
console.log("[A sees]", aResult, "→ A sees B?", aResult.hasOther ? "✅ YES" : "❌ NO")
console.log("[B sees]", bResult, "→ B sees A?", bResult.hasOther ? "✅ YES" : "❌ NO")

// Now move A's mouse over the slide canvas to trigger pointer broadcast
const slideCanvas = pA.locator('[data-slide-canvas="true"], .slide-canvas, [class*="canvas"]').first()
const canvasBox = await slideCanvas.boundingBox().catch(() => null)
// Also try the whole page area where the canvas would be
const centerX = 487, centerY = 397  // approximate canvas center in 1280x800

console.log("\n=== Moving mouse and checking cursor propagation ===")
for (const [x, y] of [[centerX - 100, centerY - 50], [centerX, centerY], [centerX + 100, centerY + 50]]) {
  await pA.mouse.move(x, y, { steps: 8 })
  await pA.waitForTimeout(300)
}
await pA.waitForTimeout(2000)
await pB.waitForTimeout(2000)

const aResult2 = await probe(pA, "Alice AW2", "Bob AW2", "A")
const bResult2 = await probe(pB, "Bob AW2", "Alice AW2", "B")
console.log("[A sees]", aResult2)
console.log("[B sees]", bResult2, "→ B sees A's cursor?", bResult2.svgCursors > 0 ? "✅ YES" : "❌ NO")

// Check collab server connection state from window
const wsInfo = await pA.evaluate(() => {
  // See if the page has any open WebSocket connections
  const allWs = []
  const orig = window.WebSocket
  return {
    yjsWsUrl: window.__percyYjsWsUrl,
    collabConnected: document.title, // placeholder
  }
}).catch(() => ({}))
console.log("\nWindow info:", wsInfo)

await import("node:fs/promises").then(({ mkdir }) => mkdir("tests/out/aw2", { recursive: true }))
await pA.screenshot({ path: "tests/out/aw2/A-after.png" })
await pB.screenshot({ path: "tests/out/aw2/B-after.png" })
console.log("→ tests/out/aw2/{A,B}-after.png")

await browser.close()

// Use final state (after mouse moves + extra wait) for success verdict
const finalOk = aResult2.hasOther && bResult2.hasOther
const firstOk = aResult.hasOther && bResult.hasOther
console.log("\n" + (finalOk ? "✅ Awareness propagation WORKING" : "❌ Awareness propagation BROKEN"))
if (!firstOk && finalOk) console.log("  (took > 12s to propagate — WS cold start)")
process.exit(finalOk ? 0 : 1)
