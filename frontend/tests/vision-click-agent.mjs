/**
 * Vision Click Agent — drives Percy with a local vision model that decides
 * what to click as if it were a human trying to edit a PowerPoint.
 *
 * For each editing TASK we:
 *   1. Open the studio fresh
 *   2. Loop up to MAX_STEPS times:
 *      a. Screenshot the current state
 *      b. Send screenshot + task + step history → LM Studio vision model
 *      c. Model returns JSON: { action, target_description, target_coords,
 *         text?, key?, reasoning, done }
 *      d. Resolve target to a Playwright element (coords first, then
 *         description-based selector fallback) and execute the action
 *      e. If model says done = true, ask vision model to VERIFY the goal was
 *         accomplished (independent verification)
 *
 * Usage:
 *   node tests/vision-click-agent.mjs [BASE_URL] [LM_STUDIO_URL]
 *
 * Defaults:
 *   BASE_URL      = https://36kuepamyi.us-east-1.awsapprunner.com
 *   LM_STUDIO_URL = http://localhost:1234
 *
 * Output:
 *   tests/results/vision-click-agent.json    full transcripts + scores
 *   tests/out/vision-click/<task>-step<N>.png  screenshots from every step
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"

const BASE   = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const LM_URL = process.argv[3] || "http://localhost:1234"
const OUT_DIR = "tests/results"
const IMG_DIR = "tests/out/vision-click"
const TAG     = Date.now()
const EMAIL   = `vca-${TAG}@test.com`
const PW      = `Pw_${TAG}_Vv9!`
const MAX_STEPS = 6              // hard cap per task to prevent run-aways
const VIEWPORT  = { width: 1440, height: 900 }

await mkdir(OUT_DIR, { recursive: true })
await mkdir(IMG_DIR, { recursive: true })

// ── Vision model client ──────────────────────────────────────────────────────

let VISION_MODEL = process.env.VISION_MODEL || ""

async function pickVisionModel() {
  if (VISION_MODEL) return VISION_MODEL
  // Auto-pick the smallest available vision-capable model (prefer Gemma multimodal)
  try {
    const r = await fetch(`${LM_URL}/v1/models`)
    const d = await r.json()
    const ids = (d.data ?? []).map((m) => m.id)
    // Skip embedding models — they don't support chat/vision
    const chatIds = ids.filter((id) => !/embed|embedding/i.test(id))
    // Prefer Gemma 4 (vision-capable), then Gemma 3, then anything with vision/vl/llava
    const preferred =
      chatIds.find((id) => /gemma-4.*-?e4b|gemma-4-it/i.test(id)) ||   // Gemma 4 e4b (4B, vision)
      chatIds.find((id) => /gemma-4/i.test(id)) ||
      chatIds.find((id) => /gemma-3.*vision|gemma-3.*vl|gemma-3.*-it/i.test(id)) ||
      chatIds.find((id) => /vision|vl|-mm|llava/i.test(id)) ||
      chatIds.find((id) => /gemma/i.test(id)) ||
      chatIds[0]
    VISION_MODEL = preferred || "google/gemma-4-e4b"
    console.log(`Using vision model: ${VISION_MODEL}`)
    return VISION_MODEL
  } catch {
    VISION_MODEL = "google/gemma-4-e4b"
    return VISION_MODEL
  }
}

async function chatVision(systemPrompt, userText, imageBase64, opts = {}) {
  const model = await pickVisionModel()
  const body = {
    model,
    max_tokens: opts.maxTokens ?? 600,
    temperature: opts.temperature ?? 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
  }
  const r = await fetch(`${LM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`LM Studio returned ${r.status}: ${text.slice(0, 200)}`)
  }
  const data = await r.json()
  return data.choices?.[0]?.message?.content ?? ""
}

function extractJSON(raw) {
  if (!raw) return null
  // Try fenced block, then any object with our action key, then any object
  const candidates = [
    raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)?.[1],
    raw.match(/(\{[\s\S]*?"action"[\s\S]*?\})/)?.[1],
    raw.match(/\{[\s\S]*\}/)?.[0],
  ].filter(Boolean)
  for (const c of candidates) {
    try { return JSON.parse(c) } catch {}
  }
  return null
}

// ── Click resolution: coords first, then description fallback ────────────────

async function clickAtCoordsOrDescription(page, decision) {
  const [x, y] = Array.isArray(decision.target_coords) ? decision.target_coords : []
  const desc = (decision.target_description ?? "").toLowerCase().trim()

  // 1) Try precise pixel click if coords look reasonable
  if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && x < VIEWPORT.width && y < VIEWPORT.height) {
    const elem = await page.evaluateHandle(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el
    }, { x, y })
    const tag = await elem.evaluate((el) => el ? el.tagName : null).catch(() => null)
    if (tag) {
      await page.mouse.click(x, y)
      return { resolved: "coords", x, y, tag }
    }
  }

  // 2) Fallback: search by description across visible interactive elements
  // We score every <button>, <a>, role="button", input[type=button] by how well
  // its visible text/aria-label/title matches the description.
  const match = await page.evaluate((desc) => {
    if (!desc) return null
    const tokens = desc.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    const cands = Array.from(document.querySelectorAll(
      'button, a, [role="button"], [role="menuitem"], [role="tab"], input[type="button"], input[type="submit"], [data-element="true"]'
    ))
    const scored = cands.map((el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return null
      const text = (el.innerText || "").toLowerCase()
      const aria = (el.getAttribute("aria-label") || "").toLowerCase()
      const title = (el.getAttribute("title") || "").toLowerCase()
      const role = (el.getAttribute("role") || el.tagName).toLowerCase()
      const haystack = [text, aria, title, role].join(" ")
      let score = 0
      for (const t of tokens) if (haystack.includes(t)) score++
      // Prefer visible elements not behind a modal
      if (score === 0) return null
      return { score, x: r.left + r.width / 2, y: r.top + r.height / 2, text: text.slice(0, 50), aria }
    }).filter(Boolean)
    scored.sort((a, b) => b.score - a.score)
    return scored[0] || null
  }, desc)

  if (match) {
    await page.mouse.click(match.x, match.y)
    return { resolved: "description", ...match }
  }
  return { resolved: "miss" }
}

async function executeAction(page, decision) {
  const action = decision.action
  if (action === "click") {
    return await clickAtCoordsOrDescription(page, decision)
  }
  if (action === "double_click") {
    const [x, y] = decision.target_coords ?? []
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await page.mouse.dblclick(x, y)
      return { resolved: "coords", x, y, tag: "dblclick" }
    }
    return { resolved: "miss" }
  }
  if (action === "type") {
    if (decision.text) {
      await page.keyboard.type(decision.text, { delay: 30 })
      return { resolved: "type", text: decision.text }
    }
    return { resolved: "miss" }
  }
  if (action === "key") {
    if (decision.key) {
      await page.keyboard.press(decision.key)
      return { resolved: "key", key: decision.key }
    }
    return { resolved: "miss" }
  }
  return { resolved: "noop", action }
}

// ── Vision prompts ───────────────────────────────────────────────────────────

const PROMPT_DECIDE = `You are operating Percy, a presentation editor that mirrors PowerPoint/Google Slides.
You see ONE screenshot. You must decide the next action a human would take to complete the goal.

Return ONLY a JSON object (no prose, no markdown fences) with these fields:
  "action": one of "click" | "double_click" | "type" | "key" | "done" | "fail"
  "target_description": short phrase describing the UI element (e.g., "Insert tab in toolbar", "Text box icon", "OK button in dialog")
  "target_coords": [x, y] integer pixel coords of the element's center (viewport is 1440x900)
  "text": only when action = "type" — the text to type
  "key": only when action = "key" — the key to press (e.g., "Escape", "Enter", "Control+B", "Delete")
  "reasoning": one sentence explaining why this action moves toward the goal
  "done": true if you believe the goal is now accomplished, else false

Rules:
- If you cannot identify a relevant target, use "fail" with reasoning.
- For "click": prefer real clickable controls (buttons, menu items, toolbar icons). Inspect the screenshot carefully.
- For "type": ensure focus is in a text field first (use a prior click).
- Use exact pixel coordinates from the screenshot, not guesses.
- One action per response. Do not chain.`

const PROMPT_VERIFY = `You are inspecting a Percy editor screenshot to verify whether a goal was accomplished.

Return ONLY a JSON object (no prose, no fences) with these fields:
  "accomplished": true/false
  "evidence": one sentence describing what in the screenshot proves it (or what is missing)
  "confidence": number between 0 and 1`

// ── Tasks: PowerPoint-like editing scenarios ────────────────────────────────

const TASKS = [
  {
    name: "insert-text-box",
    goal: "Insert a new text box on the current slide. The text box element should appear on the slide canvas after this is done.",
  },
  {
    name: "insert-shape",
    goal: "Insert a rectangle shape on the slide. A blue/colored rectangle element should be visible on the canvas.",
  },
  {
    name: "open-format-options",
    goal: "Open the right-side Format Options panel (sometimes called Properties panel). The panel should show editable element properties on the right side of the screen.",
  },
  {
    name: "duplicate-slide",
    goal: "Duplicate the current slide so the deck now has 2 slides instead of 1. The slide strip on the left should show two slide thumbnails.",
  },
  {
    name: "open-help-shortcuts",
    goal: "Open the keyboard shortcuts help dialog. A modal listing keyboard shortcuts should appear.",
  },
]

// ── Browser bootstrap ────────────────────────────────────────────────────────

console.log("\n=== Percy Vision Click Agent ===")
console.log(`App:    ${BASE}`)
console.log(`LM:     ${LM_URL}`)
console.log(`Model:  ${await pickVisionModel()}`)

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true })
const page    = await ctx.newPage()

// Signup + create blank doc + assign to project (matching vision-critique pattern)
let orgId, projId
try {
  const su = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email: EMAIL, password: PW, display_name: "Click Agent" },
    headers: { "Content-Type": "application/json" },
  })
  const me = await su.json()
  orgId = me?.orgs?.[0]?.id ?? me?.org?.id

  if (orgId) {
    const cp = await page.request.post(`${BASE}/api/projects`, {
      data: { org_id: orgId, name: `ClickAgent-${TAG}` },
      headers: { "Content-Type": "application/json" },
    })
    projId = (await cp.json()).id

    if (projId) {
      const cd = await page.request.post(`${BASE}/api/docs/create-blank`, {
        data: { width_in: 13.333, height_in: 7.5, name: "ClickAgentDoc" },
        headers: { "Content-Type": "application/json" },
      })
      const doc = await cd.json()
      if (doc.doc_id) {
        await page.request.patch(`${BASE}/api/projects/${projId}`, {
          data: { doc_id: doc.doc_id },
          headers: { "Content-Type": "application/json" },
        })
      }
    }
  }
} catch (e) {
  console.error("Bootstrap failed:", e.message)
  await browser.close()
  process.exit(1)
}

if (!projId) {
  console.error("Could not create test project — aborting")
  await browser.close()
  process.exit(1)
}

// ── Run tasks ────────────────────────────────────────────────────────────────

const results = []

for (const task of TASKS) {
  console.log(`\n▶ Task: ${task.name}`)
  console.log(`  Goal: ${task.goal}`)

  // Reset to a fresh studio view for each task
  await page.goto(`${BASE}/studio/${projId}`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(2000)   // wait for Tiptap, layout settle

  const transcript = []
  let done = false
  let stepN = 0

  for (stepN = 1; stepN <= MAX_STEPS; stepN++) {
    const screenshot = await page.screenshot({ type: "png", fullPage: false })
    await writeFile(`${IMG_DIR}/${task.name}-step${stepN}.png`, screenshot)
    const b64 = screenshot.toString("base64")

    const historyText = transcript.length === 0
      ? "(no actions taken yet)"
      : transcript.map((t, i) =>
          `Step ${i + 1}: action=${t.decision?.action ?? "?"} target=${t.decision?.target_description ?? "?"} ` +
          `→ resolved=${t.exec?.resolved ?? "?"}`
        ).join("\n")

    const userText = `GOAL: ${task.goal}\n\nVIEWPORT: 1440x900\n\nPRIOR ACTIONS:\n${historyText}\n\nWhat is your next action?`

    let raw = ""
    let decision = null
    try {
      raw = await chatVision(PROMPT_DECIDE, userText, b64)
      decision = extractJSON(raw)
    } catch (e) {
      console.log(`  Step ${stepN}: model error: ${e.message}`)
      transcript.push({ step: stepN, error: e.message })
      break
    }

    if (!decision) {
      console.log(`  Step ${stepN}: could not parse model response`)
      transcript.push({ step: stepN, error: "no JSON in response", raw: raw.slice(0, 200) })
      break
    }

    console.log(`  Step ${stepN}: ${decision.action} → "${decision.target_description ?? ""}" ` +
                `${decision.target_coords ? `[${decision.target_coords.join(",")}]` : ""} ` +
                `(${decision.reasoning ?? ""})`)

    // Special actions
    if (decision.action === "done") {
      done = true
      transcript.push({ step: stepN, decision })
      break
    }
    if (decision.action === "fail") {
      transcript.push({ step: stepN, decision })
      break
    }

    // Execute
    let exec
    try {
      exec = await executeAction(page, decision)
      console.log(`           → resolved: ${exec.resolved}${exec.tag ? ` (${exec.tag})` : ""}`)
    } catch (e) {
      exec = { resolved: "error", error: e.message }
      console.log(`           → execution error: ${e.message}`)
    }

    transcript.push({ step: stepN, decision, exec })

    if (decision.done) { done = true; break }

    await page.waitForTimeout(1000)   // let UI react before the next screenshot
  }

  // Independent verification — fresh screenshot, separate prompt
  await page.waitForTimeout(800)
  const finalShot = await page.screenshot({ type: "png", fullPage: false })
  await writeFile(`${IMG_DIR}/${task.name}-final.png`, finalShot)

  let verdict = null
  try {
    const verifyRaw = await chatVision(
      PROMPT_VERIFY,
      `GOAL: ${task.goal}\n\nDid the editor reach this state?`,
      finalShot.toString("base64"),
      { maxTokens: 200 },
    )
    verdict = extractJSON(verifyRaw) || { accomplished: false, evidence: "could not parse verifier", confidence: 0 }
  } catch (e) {
    verdict = { accomplished: false, evidence: `verifier error: ${e.message}`, confidence: 0 }
  }

  console.log(`  Verdict: ${verdict.accomplished ? "✓ pass" : "✗ fail"} (${verdict.confidence ?? 0}) — ${verdict.evidence}`)

  results.push({
    task: task.name,
    goal: task.goal,
    steps_taken: stepN - (done ? 0 : 0),
    transcript,
    verdict,
    pass: verdict.accomplished === true,
  })
}

await browser.close()

// ── Write results ────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.pass).length
const total  = results.length

const summary = {
  base: BASE,
  lm_url: LM_URL,
  vision_model: VISION_MODEL,
  run_id: TAG,
  passed,
  total,
  pass_rate: total ? +((passed / total) * 100).toFixed(1) : 0,
  results,
}

await writeFile(`${OUT_DIR}/vision-click-agent.json`, JSON.stringify(summary, null, 2))

console.log("\n" + "═".repeat(48))
console.log(`Vision Click Agent: ${passed}/${total} tasks passed (${summary.pass_rate}%)`)
console.log(`Results: ${OUT_DIR}/vision-click-agent.json`)
console.log(`Screenshots: ${IMG_DIR}/`)
console.log("═".repeat(48))

// Exit non-zero only if zero tasks passed (hard fail). The model is fuzzy,
// so partial pass is fine for non-critical builds.
process.exit(passed === 0 ? 1 : 0)
