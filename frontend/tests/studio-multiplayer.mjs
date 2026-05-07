// Multiplayer + edit-stress test on the live studio.
//
//   - User A signs up, creates a deck, opens studio, inserts text.
//   - User A is invited to share with User B (we shortcut by making User B
//     a member of the same org).
//   - Both browsers open the same studio. They each select a different
//     element. We screenshot both — each should see the other's selection ring.
//   - User A types into a text box, backspaces a lot, types again. We
//     screenshot at every step and verify the text is not wiped + no
//     console errors.

import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/mp"
const log = (...a) => console.log("[mp]", ...a)
const ts = () => Date.now()

async function snap(page, name) {
  await mkdir(OUT, { recursive: true })
  const p = `${OUT}/${name}.png`
  await page.screenshot({ path: p })
  log("→", p)
  return p
}

async function makeContext(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const errors = []
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`))
    p.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console.error: ${m.text()}`) })
  })
  return { ctx, errors }
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
  const a = await makeContext(browser, "A")
  const b = await makeContext(browser, "B")

  // 1. user A signup + deck
  const tag = ts()
  const userA = await signup(a.ctx, `userA-${tag}@example.com`, `Pw_${tag}_!Aa9`, "Alice A")
  const orgId = userA.orgs?.[0]?.id
  log("user A:", userA.id, "org:", orgId)

  const pageA = await a.ctx.newPage()
  const cp = await pageA.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: "MP Stress Test" },
  })
  const proj = await cp.json()
  const cd = await pageA.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: proj.name },
  })
  const blank = await cd.json()
  await pageA.request.patch(`${BASE}/api/projects/${proj.id}`, { data: { doc_id: blank.doc_id } })

  // Insert two text elements so we have something to share-select
  for (const [pos, text] of [
    [{ left_in: 1, top_in: 1, width_in: 5, height_in: 1.2 }, "Title text"],
    [{ left_in: 1, top_in: 3, width_in: 8, height_in: 2.5 }, "Body text — type here"],
  ]) {
    await pageA.request.post(`${BASE}/api/docs/${blank.doc_id}/slides/1/elements/text`, {
      data: { position: pos, text },
    })
  }

  // 2. User B signup, then add to A's org so they can open the same project
  const userB = await signup(b.ctx, `userB-${tag}@example.com`, `Pw_${tag}_!Bb9`, "Bob B")
  log("user B:", userB.id)
  // Use the invite flow (fastest non-admin path that doesn't require backend changes):
  // user A creates an invite for B's email, then B accepts.
  const inv = await pageA.request.post(`${BASE}/api/orgs/${orgId}/invites`, {
    data: { email: `userB-${tag}@example.com`, role: "member" },
  })
  const invite = await inv.json()
  // B accepts via API
  const pageB = await b.ctx.newPage()
  const acc = await pageB.request.post(`${BASE}/api/invites/accept?token=${encodeURIComponent(invite.token)}`)
  log("invite accept:", acc.status())

  // 3. Both open the studio
  log("A → studio")
  await pageA.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })
  await pageA.waitForTimeout(2500)
  await snap(pageA, "01-A-studio")

  log("B → studio")
  await pageB.goto(`${BASE}/studio/${proj.id}`, { waitUntil: "networkidle" })
  await pageB.waitForTimeout(2500)
  await snap(pageB, "01-B-studio")

  // 4. Each user selects a different element
  const overlaysA = pageA.locator('[data-element="true"]')
  const countA = await overlaysA.count()
  log("A overlays:", countA)
  if (countA >= 2) {
    const box1 = await overlaysA.nth(0).boundingBox()
    if (box1) {
      await pageA.mouse.click(box1.x + 30, box1.y + 30)  // click the EDGE so it selects without entering edit
      await pageA.waitForTimeout(700)
    }
  }
  const overlaysB = pageB.locator('[data-element="true"]')
  if ((await overlaysB.count()) >= 2) {
    const box2 = await overlaysB.nth(1).boundingBox()
    if (box2) {
      await pageB.mouse.click(box2.x + 30, box2.y + 30)
      await pageB.waitForTimeout(1200)
    }
  }

  await snap(pageA, "02-A-after-select")
  await snap(pageB, "02-B-after-select")

  // 5. Stress test: A types into the body text element + many backspaces
  log("A: stress text editing")
  if (countA >= 2) {
    const body = await overlaysA.nth(1).boundingBox()
    if (body) {
      // Click into edit mode (single click should work now)
      await pageA.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
      await pageA.waitForTimeout(800)
      await snap(pageA, "03-A-clicked-body")

      const ce = await pageA.locator('[contenteditable="true"]').count()
      log("contenteditable after click:", ce)

      // Type some text
      await pageA.keyboard.type(" plus added stuff")
      await pageA.waitForTimeout(300)
      await snap(pageA, "04-A-after-type")

      // Many backspaces
      for (let i = 0; i < 8; i++) {
        await pageA.keyboard.press("Backspace")
        await pageA.waitForTimeout(80)
      }
      await snap(pageA, "05-A-after-backspaces")

      // Add more
      await pageA.keyboard.type("!!!")
      await pageA.waitForTimeout(300)
      await snap(pageA, "06-A-typed-more")

      // Click outside (commit)
      await pageA.mouse.click(40, 40)
      await pageA.waitForTimeout(800)
      await snap(pageA, "07-A-after-blur")
    }
  }

  // 6. B should see A's edits arrive (multiplayer sync)
  await pageB.waitForTimeout(1500)
  await snap(pageB, "08-B-after-A-edits")

  // 7. Drag an element on A; B should see it move
  log("A: drag element")
  const overlayA0 = pageA.locator('[data-element="true"]').first()
  const dragBox = await overlayA0.boundingBox()
  if (dragBox) {
    await pageA.mouse.move(dragBox.x + 30, dragBox.y + 30)
    await pageA.mouse.down()
    await pageA.mouse.move(dragBox.x + 200, dragBox.y + 100, { steps: 10 })
    await pageA.mouse.up()
    await pageA.waitForTimeout(1000)
    await snap(pageA, "09-A-after-drag")
    await pageB.waitForTimeout(1500)
    await snap(pageB, "09-B-after-A-drag")
  }

  await browser.close()

  log("--- result ---")
  const errs = [...a.errors, ...b.errors]
  if (errs.length) {
    log("⚠", errs.length, "console errors:")
    errs.forEach((e) => log("  ", e))
    process.exit(1)
  } else {
    log("✓ no console errors")
  }
  log("screenshots in", OUT)
}

await main().catch((e) => { console.error(e); process.exit(1) })
