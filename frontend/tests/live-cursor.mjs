// Verify live cursors: two browser contexts open the same slide, A moves
// mouse around the canvas, B sees A's pointer overlay, and vice-versa.

import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/cursor"
const log = (...a) => console.log("[cur]", ...a)
const ts = () => Date.now()

async function snap(p, name) {
  await mkdir(OUT, { recursive: true })
  const f = `${OUT}/${name}.png`
  await p.screenshot({ path: f })
  log("→", f)
}

async function signup(ctx, email, password, name) {
  const page = await ctx.newPage()
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: name },
  })
  if (!r.ok()) throw new Error(`signup ${email}: ${r.status()} ${await r.text()}`)
  const me = await r.json()
  await page.close()
  return me
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const a = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const b = await browser.newContext({ viewport: { width: 1280, height: 800 } })

  // Capture all websocket frames + console logs from both
  for (const [label, ctx] of [["A", a], ["B", b]]) {
    ctx.on("page", (p) => {
      p.on("console", (m) => {
        if (m.type() === "warn" || m.type() === "error" || m.text().includes("yjs"))
          log(`${label} console.${m.type()}:`, m.text())
      })
      p.on("websocket", (ws) => {
        log(`${label} WS open: ${ws.url()}`)
        ws.on("close", () => log(`${label} WS close: ${ws.url()}`))
        ws.on("socketerror", (e) => log(`${label} WS error: ${e}`))
      })
      p.on("requestfailed", (req) => {
        if (req.url().includes("collab") || req.url().includes("ws"))
          log(`${label} request failed: ${req.url()} ${req.failure()?.errorText}`)
      })
    })
  }

  const tag = ts()
  const userA = await signup(a, `cur-A-${tag}@example.com`, `Pw_${tag}_!Aa9`, "Cursor Alice")
  const orgId = userA.orgs?.[0]?.id

  const pageA = await a.newPage()
  const cp = await pageA.request.post(`${BASE}/api/projects`, { data: { org_id: orgId, name: "CursorTest" } })
  const proj = await cp.json()
  const cd = await pageA.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: proj.name },
  })
  const blank = await cd.json()
  await pageA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })
  // One element so something is on the canvas to look at
  await pageA.request.post(`${BASE}/api/docs/${blank.doc_id}/slides/1/elements/text`, {
    data: { position: { left_in: 4, top_in: 3, width_in: 5, height_in: 1.5 }, text: "Watch the cursors" },
  })

  const userB = await signup(b, `cur-B-${tag}@example.com`, `Pw_${tag}_!Bb9`, "Cursor Bob")
  const inv = await pageA.request.post(`${BASE}/api/orgs/${orgId}/invites`, {
    data: { email: `cur-B-${tag}@example.com`, role: "member" },
  })
  const invite = await inv.json()
  const pageB = await b.newPage()
  await pageB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invite.token)}`)

  log("both → studio")
  await Promise.all([
    pageA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
    pageB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" }),
  ])
  await pageA.waitForTimeout(2500)
  await pageB.waitForTimeout(2500)

  // A moves mouse to a few positions on the canvas
  const overlay = pageA.locator('[data-element="true"]').first()
  const obox = await overlay.boundingBox()
  if (!obox) throw new Error("no canvas element bbox")
  log("A canvas region:", obox)

  // Move along an arc
  const positions = [
    { x: obox.x + 50,  y: obox.y + 50 },
    { x: obox.x + 200, y: obox.y + 80 },
    { x: obox.x + 400, y: obox.y + 200 },
    { x: obox.x + 600, y: obox.y + 80 },
    { x: obox.x + 800, y: obox.y + 50 },
  ]
  for (const p of positions) {
    await pageA.mouse.move(p.x, p.y, { steps: 8 })
    await pageA.waitForTimeout(150)
  }
  await pageA.waitForTimeout(800)
  await snap(pageA, "01-A-moved")
  await pageB.waitForTimeout(800)
  await snap(pageB, "01-B-sees-A")

  // Now B moves
  const obox2 = await pageB.locator('[data-element="true"]').first().boundingBox()
  if (obox2) {
    const positions2 = [
      { x: obox2.x + 700, y: obox2.y + 200 },
      { x: obox2.x + 500, y: obox2.y + 300 },
      { x: obox2.x + 200, y: obox2.y + 350 },
    ]
    for (const p of positions2) {
      await pageB.mouse.move(p.x, p.y, { steps: 8 })
      await pageB.waitForTimeout(150)
    }
  }
  await pageB.waitForTimeout(800)
  await snap(pageB, "02-B-moved")
  await pageA.waitForTimeout(800)
  await snap(pageA, "02-A-sees-B")

  // Both move — concurrent
  await Promise.all([
    (async () => {
      for (let i = 0; i < 5; i++) {
        await pageA.mouse.move(obox.x + 100 + i * 80, obox.y + 100, { steps: 4 })
        await pageA.waitForTimeout(120)
      }
    })(),
    (async () => {
      for (let i = 0; i < 5; i++) {
        await pageB.mouse.move(obox.x + 800 - i * 80, obox.y + 300, { steps: 4 })
        await pageB.waitForTimeout(120)
      }
    })(),
  ])
  await pageA.waitForTimeout(500)
  await pageB.waitForTimeout(500)
  await snap(pageA, "03-A-concurrent")
  await snap(pageB, "03-B-concurrent")

  // Verify cursor SVG exists in B's DOM
  const cursorOnB = await pageB.locator('svg[viewBox="0 0 20 22"]').count()
  log("B sees", cursorOnB, "remote cursor SVGs")
  const cursorOnA = await pageA.locator('svg[viewBox="0 0 20 22"]').count()
  log("A sees", cursorOnA, "remote cursor SVGs")

  await browser.close()
  log("done; expected at least 1 cursor on each side")
}

await main().catch((e) => { console.error(e); process.exit(1) })
