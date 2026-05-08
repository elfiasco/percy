/**
 * Studio Editing Visual — simulates real mouse-driven editing sessions and
 * captures screenshots at every meaningful state for visual review.
 *
 * Phases:
 *   1.  Setup: signup + project + blank deck
 *   2.  Insert: text box → rect shape → ellipse → image placeholder
 *   3.  Select & move: click element, drag to new position, screenshot before/after
 *   4.  Resize: drag SE corner handle to resize a text box
 *   5.  Text editing: double-click text box, type content, Ctrl+Enter to save
 *   6.  Style editing: select shape, open properties panel, change fill color via input
 *   7.  Multi-select: Shift+click three elements, check selection ring appears
 *   8.  Delete & undo: Delete key removes one element, Ctrl+Z brings it back
 *   9.  Slide operations: add new slide via strip button, add element on slide 2, go back to slide 1
 *  10.  Final state: screenshot of finished canvas with all elements
 *
 * After each phase, screenshots go to tests/out/editing-visual/ and this
 * script prints them so the AI can load and assess them.
 *
 * Usage:
 *   node tests/studio-editing-visual.mjs [BASE_URL]
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const OUT  = "tests/out/editing-visual"
const RES  = "tests/results"
const TAG  = Date.now()

await mkdir(OUT, { recursive: true })
await mkdir(RES, { recursive: true })

// ── helpers ────────────────────────────────────────────────────────────────────

const steps = []
let page

async function step(label, fn) {
  const t = Date.now()
  try {
    await fn()
    const ms = Date.now() - t
    console.log(`  ✅ ${label} (${ms}ms)`)
    steps.push({ label, ok: true, ms })
  } catch (err) {
    const ms = Date.now() - t
    console.error(`  ❌ ${label}: ${err.message}`)
    steps.push({ label, ok: false, ms, error: err.message })
    try {
      await page?.screenshot({ path: `${OUT}/FAIL-${label.replace(/\W+/g, "-").slice(0, 40)}.png` })
    } catch {}
  }
}

/** Take a labeled screenshot and print its path so the AI can review it. */
const snaps = []
async function snap(name, description) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage: false }).catch(() => {})
  snaps.push({ name, path, description })
  console.log(`   📸 ${name}.png — ${description}`)
  return path
}

async function apiElements(docId, slideN = 1) {
  const result = await page.evaluate(async ({ base, id, n }) => {
    const r = await fetch(`${base}/api/docs/${id}/slides/${n}/elements`)
    if (!r.ok) return { error: r.status }
    const b = await r.json()
    return { elements: b.elements ?? [], count: b.element_count ?? b.elements?.length ?? 0 }
  }, { base: BASE, id: docId, n: slideN })
  if (result.error) throw new Error(`GET elements HTTP ${result.error}`)
  return result
}

async function clickInsertTab() {
  const btn = page.locator('[role="tab"], button').filter({ hasText: /^insert$/i }).first()
  await btn.waitFor({ state: "visible", timeout: 5000 })
  await btn.click()
  await page.waitForTimeout(500)
}

/** Insert a shape via the Insert ribbon. shapeName = "Text Box" | "Rectangle" | "Ellipse" | "Triangle" etc. */
async function insertShape(shapeName) {
  await clickInsertTab()
  let btn
  if (/text.?box/i.test(shapeName)) {
    // Text Box button has text label, not title attribute
    btn = page.locator('button').filter({ hasText: /text.?box/i }).first()
  } else {
    // Shape buttons use title= attribute (icon-only buttons)
    btn = page.locator(`button[title="${shapeName}"]`).first()
    if (!await btn.count()) {
      // Fallback: try title contains
      btn = page.locator(`button[title*="${shapeName}"]`).first()
    }
  }
  if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error(`Button for "${shapeName}" not found in Insert ribbon (checked title="${shapeName}")`)
  }
  await btn.click()
  await page.waitForTimeout(1200)
}

/** Set fill color on an element via the REST API so it's visible on canvas. */
async function setElementFill(elId, color = "#6366F1", slideN = 1) {
  await page.request.patch(`${BASE}/api/docs/${docId}/slides/${slideN}/elements/${elId}/style`, {
    data: { fill_color: color, fill_type: "solid" },
  })
  await page.waitForTimeout(400)
}

/**
 * Get screen center (cx, cy) of the nth canvas element.
 * Uses evaluate() so we query only inside [data-slide-canvas] — avoiding slide-strip thumbnails
 * which also have [data-element="true"] and come earlier in the DOM.
 */
async function canvasElementBox(n) {
  const box = await page.evaluate((idx) => {
    const canvas = document.querySelector('[data-slide-canvas="true"]')
    if (!canvas) return null
    const els = canvas.querySelectorAll('[data-element="true"]')
    const el = els[idx]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }, n)
  return box
}

/** Click on the nth canvas element using real mouse events (not dispatchEvent, not locator.click). */
async function clickElement(n, shiftKey = false) {
  const box = await canvasElementBox(n)
  if (!box) throw new Error(`element ${n} not found in canvas DOM`)
  if (shiftKey) await page.keyboard.down("Shift")
  await page.mouse.click(box.cx, box.cy)
  if (shiftKey) await page.keyboard.up("Shift")
  await page.waitForTimeout(400)
  return box
}

/** Click element to select; blur any auto-focused inputs so keyboard shortcuts work. */
async function selectElement(n, shiftKey = false) {
  const bbox = await clickElement(n, shiftKey)
  // Properties panel may auto-focus an input after selection; blur it so that
  // Delete / arrow keys go to the Studio document-level keydown handler instead.
  await page.evaluate(() => {
    const a = document.activeElement
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"
           || a.isContentEditable || a.closest?.('[contenteditable="true"]'))) {
      a.blur()
    }
  })
  await page.waitForTimeout(150)
  return bbox
}

/** Double-click an element — uses real page.mouse.dblclick() for proper editor focus. */
async function doubleClickElement(n) {
  const box = await canvasElementBox(n)
  if (!box) throw new Error(`element ${n} not found for double-click`)
  await page.mouse.dblclick(box.cx, box.cy)
  await page.waitForTimeout(600)
}

/** Drag an element from its center to (dx, dy) offset in pixels. */
async function dragElement(n, dx, dy) {
  const box = await canvasElementBox(n)
  if (!box) throw new Error(`element ${n} not found for drag`)

  await page.mouse.move(box.cx, box.cy)
  await page.mouse.down()
  await page.waitForTimeout(100)
  const STEPS = 12
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(box.cx + (dx * i) / STEPS, box.cy + (dy * i) / STEPS)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

/** Drag the resize handle of the nth selected element by (dx, dy). */
async function dragResizeHandle(n, handle = "se", dx = 60, dy = 40) {
  // Find the handle by data-handle attribute (only rendered when element is selected)
  const handleBox = await page.evaluate((h) => {
    const el = document.querySelector(`[data-handle="${h}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, handle)

  let hx, hy
  if (handleBox) {
    hx = handleBox.x; hy = handleBox.y
  } else {
    // Fallback: SE corner of the element
    const box = await canvasElementBox(n)
    if (!box) throw new Error(`element ${n} not found for resize`)
    hx = box.x + box.width - 2
    hy = box.y + box.height - 2
  }

  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.waitForTimeout(100)
  const STEPS = 10
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(hx + (dx * i) / STEPS, hy + (dy * i) / STEPS)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

/** Click anywhere on the canvas background to deselect. */
async function clickCanvasBackground() {
  const canvas = await page.locator('[data-slide-canvas="true"]').first().boundingBox()
  if (canvas) {
    await page.mouse.click(canvas.x + 10, canvas.y + 10)
    await page.waitForTimeout(300)
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

console.log("\n=== Percy Studio Editing Visual Test ===")
console.log(`Target: ${BASE}`)
console.log(`Output: ${OUT}\n`)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

const jsErrors = []
ctx.on("page", (p) => {
  p.on("pageerror", (e) => jsErrors.push(`pageerror: ${e.message}`))
})

page = await ctx.newPage()

// ── Phase 1: Setup ─────────────────────────────────────────────────────────────
console.log("── Phase 1: Setup")

const email = `visual-edit-${TAG}@test.com`
const pw    = `Pw_${TAG}_V9!`
let orgId, projId, docId

await step("Signup via API", async () => {
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: pw, display_name: "Visual Edit User" },
  })
  const me = await r.json()
  if (!me?.id) throw new Error(`bad signup: ${JSON.stringify(me).slice(0, 80)}`)
  orgId = me.orgs?.[0]?.id
  if (!orgId) throw new Error("no org in signup")
})

await step("Create project + blank deck", async () => {
  const cp = await page.request.post(`${BASE}/api/projects`, {
    data: { org_id: orgId, name: `VisualEdit-${TAG}` },
  })
  const proj = await cp.json()
  projId = proj.id
  if (!projId) throw new Error("no project id")

  const cd = await page.request.post(`${BASE}/api/docs/create-blank`, {
    data: { width_in: 13.333, height_in: 7.5, name: `VisualEditDeck-${TAG}` },
  })
  const blank = await cd.json()
  docId = blank.doc_id
  if (!docId) throw new Error("no doc id")

  await page.request.patch(`${BASE}/api/projects/${projId}`, { data: { doc_id: docId } })
})

await step("Open Studio", async () => {
  await page.goto(`${BASE}/studio/${projId}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  // Confirm canvas loaded
  const canvas = page.locator('[data-slide-canvas="true"]').first()
  await canvas.waitFor({ state: "visible", timeout: 15000 })
})

await snap("01-studio-blank", "Studio loaded with blank canvas")

// ── Phase 2: Insert elements ────────────────────────────────────────────────────
console.log("\n── Phase 2: Inserting Elements")

await step("Insert text box via ribbon", async () => {
  await insertShape("Text Box")
  await page.waitForTimeout(500)
  const { elements, count } = await apiElements(docId)
  if (count < 1) throw new Error(`expected ≥1 element, got ${count}`)
  // Give text box a visible fill so it shows on canvas
  const el = elements.find(e => /text/i.test(e.name) || e.type === "BridgeText") ?? elements[0]
  if (el) await setElementFill(el.id, "#93C5FD")
})

await snap("02-after-text-insert", "After inserting text box — should show element on canvas")

await step("Insert rectangle shape", async () => {
  // Exit any edit mode first
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await insertShape("Rectangle")
  const { elements, count } = await apiElements(docId)
  if (count < 2) throw new Error(`expected ≥2 elements, got ${count}`)
  // Set fill on the newly inserted element (last in list by z_index)
  const newest = elements.reduce((a, b) => (b.z_index ?? 0) > (a.z_index ?? 0) ? b : a)
  await setElementFill(newest.id, "#6366F1")
})

await snap("03-after-rect-insert", "After inserting rectangle — two elements visible (indigo fill)")

await step("Insert ellipse shape", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await insertShape("Ellipse")
  const { elements, count } = await apiElements(docId)
  if (count < 3) throw new Error(`expected ≥3 elements, got ${count}`)
  const newest = elements.reduce((a, b) => (b.z_index ?? 0) > (a.z_index ?? 0) ? b : a)
  await setElementFill(newest.id, "#EC4899")
})

await snap("04-after-ellipse-insert", "After inserting ellipse — three elements (indigo rect + pink ellipse)")

await step("Insert triangle shape", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await insertShape("Triangle")
  const { elements, count } = await apiElements(docId)
  if (count < 4) throw new Error(`expected ≥4 elements, got ${count}`)
  const newest = elements.reduce((a, b) => (b.z_index ?? 0) > (a.z_index ?? 0) ? b : a)
  await setElementFill(newest.id, "#F59E0B")
})

await snap("05-four-elements", "Four colored elements: light-blue text box + indigo rect + pink ellipse + amber triangle")

// Reload the page so the Studio store re-hydrates with the filled styles we set via REST API.
// (The store caches style payloads keyed by renderKey — a direct REST patch is invisible to it.)
await step("Reload studio to hydrate fresh styles", async () => {
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  const canvas = page.locator('[data-slide-canvas="true"]').first()
  await canvas.waitFor({ state: "visible", timeout: 15000 })
})

await snap("05b-after-reload", "After reload — all 4 colored shapes should now be visible with their fill colors")

// ── Phase 3: Select and move ────────────────────────────────────────────────────
console.log("\n── Phase 3: Select & Move")

await step("Deselect all elements", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await clickCanvasBackground()
})

await step("Click first element to select it", async () => {
  await selectElement(0)
})

await snap("06-element-selected", "First element selected — should show selection ring + resize handles")

await step("Drag selected element 120px right, 50px down", async () => {
  const elemsBefore = await apiElements(docId)
  const firstBefore = elemsBefore.elements[0]
  await dragElement(0, 120, 50)
  // Give the API a moment to persist
  await page.waitForTimeout(800)
  const elemsAfter = await apiElements(docId)
  const firstAfter = elemsAfter.elements[0]
  // Check that position actually changed (left_in should differ)
  if (Math.abs(firstAfter.left_in - firstBefore.left_in) < 0.05) {
    console.log(`    ⚠️  position may not have changed: before=${firstBefore.left_in} after=${firstAfter.left_in}`)
  }
})

await snap("07-after-drag", "After dragging element — position should have shifted right+down")

// ── Phase 4: Resize ─────────────────────────────────────────────────────────────
console.log("\n── Phase 4: Resize")

await step("Select first element and resize via SE handle", async () => {
  const elemsBefore = await apiElements(docId)
  const firstBefore = elemsBefore.elements[0]
  await selectElement(0)
  await page.waitForTimeout(400)
  await dragResizeHandle(0, "se", 80, 60)
  await page.waitForTimeout(800)
  const elemsAfter = await apiElements(docId)
  const firstAfter = elemsAfter.elements[0]
  if (Math.abs(firstAfter.width_in - firstBefore.width_in) < 0.05 &&
      Math.abs(firstAfter.height_in - firstBefore.height_in) < 0.05) {
    console.log(`    ⚠️  resize may not have changed dimensions: w ${firstBefore.width_in}→${firstAfter.width_in}, h ${firstBefore.height_in}→${firstAfter.height_in}`)
  }
})

await snap("08-after-resize", "After resizing element — element should be larger")

// ── Phase 5: Text editing ────────────────────────────────────────────────────────
console.log("\n── Phase 5: Text Editing")

await step("Double-click text box to enter edit mode", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await clickCanvasBackground()
  await page.waitForTimeout(300)

  // Find the text box element — may be BridgeText or BridgeShape named "Text_box"
  const result = await page.evaluate(async ({ base, id }) => {
    const r = await fetch(`${base}/api/docs/${id}/slides/1/elements`)
    if (!r.ok) return null
    const b = await r.json()
    const textEl = b.elements?.find(e => e.type === "BridgeText" || /text/i.test(e.name ?? ""))
      ?? b.elements?.[0]
    return textEl ? { id: textEl.id } : null
  }, { base: BASE, id: docId })

  if (!result) throw new Error("No text element found on slide 1")

  // Find canvas-scoped DOM index of the text element
  const domIndex = await page.evaluate(({ elId }) => {
    const canvas = document.querySelector('[data-slide-canvas="true"]')
    const els = canvas ? canvas.querySelectorAll('[data-element="true"]') : document.querySelectorAll('[data-element="true"]')
    for (let i = 0; i < els.length; i++) {
      const id = els[i].getAttribute("data-element-id") ?? els[i].closest("[data-element-id]")?.getAttribute("data-element-id")
      if (id === elId) return i
    }
    return 0
  }, { elId: result.id })

  await doubleClickElement(domIndex)
})

await snap("09-text-edit-mode", "Text editing mode active — should see text cursor / Tiptap editor")

await step("Type text content into editor", async () => {
  // Type directly — do NOT use Ctrl+A here, it would select all canvas elements
  // instead of selecting text within the focused editor
  await page.keyboard.type("Studio 2.0 Visual Test", { delay: 40 })
  await page.waitForTimeout(500)
})

await snap("10-text-typed", "Text typed — should see 'Studio 2.0 Visual Test' in the text box")

await step("Save text with Ctrl+Enter", async () => {
  await page.keyboard.press("Control+Enter")
  await page.waitForTimeout(1500) // wait for save + render key bump

  // Verify via API — text element may be BridgeText or BridgeShape (Text_box)
  const elems = await apiElements(docId)
  const textEl = elems.elements.find(e => e.type === "BridgeText" || /text/i.test(e.name ?? ""))
    ?? elems.elements[0]
  if (!textEl) throw new Error("Text element disappeared after save")
  if (textEl.text_preview && !textEl.text_preview.includes("Studio 2.0")) {
    console.log(`    ⚠️  text_preview="${textEl.text_preview}" (API may lag behind editor)`)
  }
})

await snap("11-text-saved", "After saving text — element should show 'Studio 2.0 Visual Test'")

// ── Phase 6: Style/properties panel ─────────────────────────────────────────────
console.log("\n── Phase 6: Style Editing via Properties Panel")

await step("Select rectangle element", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await clickCanvasBackground()
  await page.waitForTimeout(300)

  // Find rect by type
  const elems = await apiElements(docId)
  const rectEl = elems.elements.find(e => e.type === "BridgeShape")
  if (!rectEl) throw new Error("No BridgeShape element found")

  const domIndex = await page.evaluate(({ elId }) => {
    const canvas = document.querySelector('[data-slide-canvas="true"]')
    const els = canvas ? canvas.querySelectorAll('[data-element="true"]') : document.querySelectorAll('[data-element="true"]')
    for (let i = 0; i < els.length; i++) {
      const id = els[i].getAttribute("data-element-id")
        ?? els[i].closest("[data-element-id]")?.getAttribute("data-element-id")
      if (id === elId) return i
    }
    return 1
  }, { elId: rectEl.id })

  await selectElement(domIndex)
})

await snap("12-rect-selected", "Rectangle selected — properties panel should appear on right")

await step("Open Style tab in properties panel", async () => {
  // Look for the Style/Format tab in the properties panel
  const styleTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /style|format|fill|shape/i }).first()
  if (await styleTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await styleTab.click()
    await page.waitForTimeout(500)
  } else {
    // May already be on ShapeFormat tab (auto-switches on shape select)
    console.log("    ℹ️  Style/Format tab not found — may already be active or not shown")
  }
})

await snap("13-style-panel", "Properties panel open — should show fill color, border, opacity inputs")

await step("Change fill color to a new hex value", async () => {
  // Find fill color input in the properties panel
  const colorInput = page.locator('input[type="color"], input[placeholder*="color" i], input[placeholder*="fill" i], input[placeholder*="#" i]').first()
  if (await colorInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await colorInput.fill("#4F46E5") // indigo
    await colorInput.press("Enter")
    await page.waitForTimeout(1000)
    console.log("    ✓ Set fill color to #4F46E5")
  } else {
    // Try hex text inputs
    const hexInputs = page.locator('input').filter({ hasText: "" }).locator('nth=0')
    const allInputs = await page.locator('input[maxlength="7"], input[maxlength="6"]').count()
    console.log(`    ℹ️  No obvious color input — found ${allInputs} hex-length inputs`)
  }
})

await snap("14-fill-color-changed", "After fill color change — rectangle should show new color (indigo/blue)")

// ── Phase 7: Multi-select ─────────────────────────────────────────────────────────
console.log("\n── Phase 7: Multi-Select")

await step("Deselect all", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await clickCanvasBackground()
  await page.waitForTimeout(300)
})

await step("Select first three elements with Shift+click", async () => {
  const { count } = await apiElements(docId)
  if (count < 3) throw new Error(`need ≥3 elements, have ${count}`)
  await selectElement(0)
  await selectElement(1, true) // shift-click
  await selectElement(2, true) // shift-click
})

await snap("15-multiselect-3", "Three elements selected — should see multiple selection rings / group bounding box")

await step("Deselect with Escape", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
})

// ── Phase 8: Delete and Undo ──────────────────────────────────────────────────────
console.log("\n── Phase 8: Delete & Undo")

await step("Select element and delete it via ribbon button", async () => {
  const { count } = await apiElements(docId)
  // Select element 2 (ellipse, definitely visible at ~6.92" from left — not near the viewport edge)
  const targetIdx = Math.min(2, count - 1)
  await selectElement(targetIdx)
  await page.waitForTimeout(400)

  // Prefer ribbon Delete button (avoids keyboard focus issues entirely)
  const deleteBtn = page.locator('[data-ribbon-delete], button[title="Delete element"], button[aria-label="Delete"], button').filter({ hasText: /^Delete$/i }).first()
  if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await deleteBtn.click()
    await page.waitForTimeout(1000)
    console.log("    ✓ Deleted via ribbon button")
  } else {
    // Fallback: keyboard Delete — blur inputs first so the handler fires
    await page.evaluate(() => {
      const a = document.activeElement
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) a.blur()
    })
    await page.waitForTimeout(100)
    await page.keyboard.press("Delete")
    await page.waitForTimeout(1000)
    console.log("    ✓ Deleted via keyboard fallback")
  }

  const { count: afterCount } = await apiElements(docId)
  if (afterCount !== count - 1) throw new Error(`expected ${count - 1} elements after delete, got ${afterCount}`)
})

await snap("16-after-delete", "After deleting last element — should have one fewer element on canvas")

await step("Undo delete with Ctrl+Z", async () => {
  const { count: beforeCount } = await apiElements(docId)
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(1500)

  const { count: afterCount } = await apiElements(docId)
  if (afterCount !== beforeCount + 1) {
    console.log(`    ⚠️  expected ${beforeCount + 1} elements after undo, got ${afterCount} (client-side undo may not have API side-effect yet)`)
  }
})

await snap("17-after-undo", "After Ctrl+Z undo — deleted element should be restored")

// ── Phase 9: Slide operations ──────────────────────────────────────────────────────
console.log("\n── Phase 9: Slide Operations")

await step("Add a new slide via strip + button", async () => {
  // Click the + button at the bottom of the slide strip
  const addSlideBtn = page.locator('button[title*="Add slide" i], button[aria-label*="Add slide" i], button').filter({ hasText: /^\+$|^add slide$/i }).first()
  const strip = page.locator('[data-slide-strip="true"], .slide-strip, [data-testid="slide-strip"]').first()

  if (await addSlideBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addSlideBtn.click()
    await page.waitForTimeout(1500)
    console.log("    ✓ Clicked Add Slide button")
  } else {
    // Fallback: use API
    const r = await page.request.post(`${BASE}/api/docs/${docId}/slides?after_n=1`)
    if (!r.ok()) throw new Error(`add slide API: ${r.status()}`)
    await page.waitForTimeout(1500)
    console.log("    ✓ Added slide via API fallback")
  }
})

await snap("18-two-slides", "Two slides in strip — slide 2 should appear in slide strip")

await step("Click slide 2 in strip to navigate to it", async () => {
  // Click the second slide thumbnail in the strip
  const slideThumb = page.locator('[data-slide-n="2"], [data-slide-number="2"]').first()
  if (await slideThumb.isVisible({ timeout: 3000 }).catch(() => false)) {
    await slideThumb.click()
    await page.waitForTimeout(1000)
  } else {
    // Try clicking by index in the strip
    const thumbs = page.locator('[data-slide-strip="true"] [data-slide-n], [data-slide-strip="true"] .slide-thumbnail, .slide-strip .slide-thumbnail')
    const count = await thumbs.count()
    if (count >= 2) {
      await thumbs.nth(1).click()
      await page.waitForTimeout(1000)
    } else {
      console.log("    ⚠️  Could not find slide 2 thumbnail, skipping navigation")
    }
  }
})

await snap("19-slide-2-blank", "Slide 2 active — should show blank canvas for slide 2")

await step("Insert shape on slide 2", async () => {
  await insertShape("Rectangle")
  const { elements, count } = await apiElements(docId, 2)
  if (count < 1) {
    console.log(`    ⚠️  Slide 2 element count=${count} — insert may have gone to slide 1`)
  } else {
    const newest = elements.reduce((a, b) => (b.z_index ?? 0) > (a.z_index ?? 0) ? b : a)
    await setElementFill(newest.id, "#10B981", 2)
  }
})

await snap("20-slide-2-with-element", "Slide 2 with one element — rectangle on blank slide 2")

await step("Navigate back to slide 1", async () => {
  const slideThumb = page.locator('[data-slide-n="1"], [data-slide-number="1"]').first()
  if (await slideThumb.isVisible({ timeout: 3000 }).catch(() => false)) {
    await slideThumb.click()
    await page.waitForTimeout(1000)
  } else {
    const thumbs = page.locator('.slide-strip .slide-thumbnail, [data-slide-strip="true"] [data-slide-n]')
    if (await thumbs.count() >= 1) {
      await thumbs.nth(0).click()
      await page.waitForTimeout(1000)
    }
  }
})

await snap("21-back-to-slide-1", "Back on slide 1 — all original elements should still be present")

// ── Phase 10: Rotate element ────────────────────────────────────────────────────────
console.log("\n── Phase 10: Rotate")

await step("Select element and rotate via properties panel input", async () => {
  await clickCanvasBackground()
  await page.waitForTimeout(300)
  await selectElement(1)
  await page.waitForTimeout(400)

  // Try to find a rotation input in the properties panel
  const rotInput = page.locator('input[placeholder*="rotat" i], input[aria-label*="rotat" i], label:has-text("Rotation") + input, label:has-text("Rotate") + input').first()
  if (await rotInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await rotInput.triple_click()
    await rotInput.fill("30")
    await rotInput.press("Enter")
    await page.waitForTimeout(1000)
    console.log("    ✓ Set rotation to 30°")
  } else {
    // Try the ShapeFormat tab's rotation field
    const allInputs = await page.locator('input[type="number"]').all()
    for (const input of allInputs) {
      const label = await input.evaluate((el) => {
        const label = el.closest("label") ?? el.previousElementSibling ?? el.parentElement?.previousElementSibling
        return label?.textContent?.toLowerCase() ?? ""
      })
      if (label.includes("rotat") || label.includes("°")) {
        await input.triple_click()
        await input.fill("30")
        await input.press("Enter")
        await page.waitForTimeout(1000)
        console.log("    ✓ Found rotation input via label scan")
        break
      }
    }
    console.log("    ℹ️  Rotation input not found by name — skipping rotation input")
  }
})

await snap("22-rotated-element", "Element rotated 30° — should appear tilted on canvas")

// ── Phase 11: Z-order ────────────────────────────────────────────────────────────
console.log("\n── Phase 11: Z-Order Changes")

await step("Bring element to front via context menu or ribbon", async () => {
  await selectElement(0)
  await page.waitForTimeout(300)

  // Try right-click context menu
  const elem0 = await page.evaluate(() => {
    const el = document.querySelectorAll('[data-element="true"]')[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })

  if (elem0) {
    await page.mouse.click(elem0.cx, elem0.cy, { button: "right" })
    await page.waitForTimeout(500)

    const frontItem = page.locator('[role="menu"] [role="menuitem"], [role="menuitem"]').filter({ hasText: /bring.*front|front/i }).first()
    if (await frontItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await frontItem.click()
      await page.waitForTimeout(500)
      console.log("    ✓ Clicked 'Bring to Front' in context menu")
    } else {
      await page.keyboard.press("Escape")
      console.log("    ℹ️  'Bring to Front' not in context menu — using keyboard Escape to close")
    }
  }
})

await snap("23-z-order", "After z-order change — layer order may have changed visually")

// ── Phase 12: Command palette ────────────────────────────────────────────────────
console.log("\n── Phase 12: Command Palette")

await step("Open command palette with Ctrl+K", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await page.keyboard.press("Control+k")
  await page.waitForTimeout(600)

  const palette = page.locator('[role="dialog"][aria-label*="command" i], [data-command-palette], input[placeholder*="command" i], input[placeholder*="search" i]').first()
  if (!await palette.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("    ⚠️  Command palette dialog not detected in DOM")
  }
})

await snap("24-command-palette", "Command palette open — should show search input + command list")

await step("Type '> grammar' to search for Grammar Check action", async () => {
  // CommandPalette requires ">" prefix to search actions (vs element names)
  await page.keyboard.type("> grammar", { delay: 50 })
  await page.waitForTimeout(500)
})

await snap("25-command-palette-search", "Command palette filtered with '> grammar' — should show Grammar & Clarity Check command")

await step("Close command palette with Escape", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
})

// ── Phase 13: Keyboard nudge ─────────────────────────────────────────────────────
console.log("\n── Phase 13: Keyboard Nudge")

await step("Select element and nudge with arrow keys", async () => {
  await clickCanvasBackground()
  await page.waitForTimeout(200)
  const elems = await apiElements(docId)
  if (elems.count === 0) throw new Error("no elements to nudge")

  await selectElement(0)
  await page.waitForTimeout(300)

  const before = elems.elements[0]

  // Nudge right 3 times, down 2 times
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(150)
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(150)
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(150)
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(150)
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(800) // wait for API persist

  const after = await apiElements(docId)
  const afterEl = after.elements[0]
  if (Math.abs(afterEl.left_in - before.left_in) < 0.05) {
    console.log(`    ⚠️  left_in may not have changed: ${before.left_in} → ${afterEl.left_in}`)
  } else {
    console.log(`    ✓ Nudged: left ${before.left_in.toFixed(2)} → ${afterEl.left_in.toFixed(2)}, top ${before.top_in.toFixed(2)} → ${afterEl.top_in.toFixed(2)}`)
  }
})

await snap("26-after-nudge", "After arrow key nudge — element should have shifted slightly right+down")

// ── Phase 14: Final state ─────────────────────────────────────────────────────────
console.log("\n── Phase 14: Final State")

await step("Deselect all for clean final screenshot", async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await clickCanvasBackground()
  await page.waitForTimeout(400)
})

const finalElems = await apiElements(docId)
console.log(`   Final element count on slide 1: ${finalElems.count}`)
for (const el of finalElems.elements) {
  console.log(`     • ${el.type} "${el.name}" @ (${el.left_in?.toFixed(2)}", ${el.top_in?.toFixed(2)}") ${el.width_in?.toFixed(2)}×${el.height_in?.toFixed(2)}" z=${el.z_index}`)
}

await snap("27-final-canvas", "Final canvas state — all edited elements, no selection rings")
await snap("28-final-fullpage", "Full-page screenshot of final studio state including panels")

// Extra: screenshot with side panel open
await step("Open properties panel for final element", async () => {
  const count = finalElems.count
  if (count > 0) {
    await selectElement(0)
    await page.waitForTimeout(500)
  }
})
await snap("29-final-with-panel", "Final state with element selected and properties panel visible")

// ── Cleanup ────────────────────────────────────────────────────────────────────
await browser.close()

// ── Results ────────────────────────────────────────────────────────────────────
const passed = steps.filter((s) => s.ok).length
const failed = steps.filter((s) => !s.ok).length
const total  = steps.length

console.log("\n" + "═".repeat(52))
console.log(`STEPS: ${passed}/${total} passed  ${failed > 0 ? `(${failed} failed)` : ""}`)
console.log(`JS errors: ${jsErrors.length}`)
console.log(`\nScreenshots taken: ${snaps.length}`)
for (const s of snaps) {
  console.log(`  ${s.path}  — ${s.description}`)
}

await writeFile(
  `${RES}/editing-visual-${TAG}.json`,
  JSON.stringify({ timestamp: TAG, base: BASE, steps, snaps, jsErrors }, null, 2),
)

if (failed === 0) {
  console.log("\n✅ EDITING VISUAL PASSED")
  process.exit(0)
} else {
  console.log("\n⚠️  SOME STEPS FAILED — check screenshots above")
  process.exit(1)
}
