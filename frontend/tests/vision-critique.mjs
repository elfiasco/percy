/**
 * Vision UI Critique — takes screenshots of every major Percy page and sends
 * each to the local Gemma 4 vision model via LM Studio, collecting structured
 * UX feedback. Results are written to tests/results/vision-critique.json.
 *
 * Usage:
 *   node tests/vision-critique.mjs [BASE_URL] [LM_STUDIO_URL]
 *
 * Defaults:
 *   BASE_URL       = https://36kuepamyi.us-east-1.awsapprunner.com
 *   LM_STUDIO_URL  = http://localhost:1234
 */
import { chromium } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync }                 from "node:fs"

const BASE    = process.argv[2] || "https://36kuepamyi.us-east-1.awsapprunner.com"
const LM_URL  = process.argv[3] || "http://localhost:1234"
const OUT_DIR = "tests/results"
const IMG_DIR = "tests/out/vision"
const TAG     = Date.now()
const EMAIL   = `vis-${TAG}@test.com`
const PW      = `Pw_${TAG}_Vv9!`

await mkdir(OUT_DIR, { recursive: true })
await mkdir(IMG_DIR, { recursive: true })

// ── LM Studio client ─────────────────────────────────────────────────────────

const VISION_MODEL = "google/gemma-4-e4b"

async function listModels() {
  const r = await fetch(`${LM_URL}/v1/models`)
  const d = await r.json()
  return (d.data ?? []).map((m) => m.id)
}

async function visionCritique(imageBase64, context) {
  const body = {
    model: VISION_MODEL,
    max_tokens: 1200,   // enough for full JSON response
    messages: [
      {
        role: "system",
        content:
          "You are a senior UX designer reviewing Percy, a modern AI-powered presentation editor. " +
          "Percy's design vision: feel like an extremely modern, visually striking design studio " +
          "(think Figma/Linear aesthetics — dark ink background, clean typography, neon accent colors) " +
          "BUT the actual slide editing canvas and toolbar layout must be immediately familiar to " +
          "PowerPoint/Keynote users — ribbon tabs at the top (Home, Insert, Design, Transitions, etc.), " +
          "slide strip on the left or bottom, properties panel on the right, canvas in the center. " +
          "Be critical and specific. Focus on: does the studio feel like PowerPoint's layout, " +
          "visual polish, hierarchy, accessibility, clarity of CTAs, anything that breaks the " +
          "'modern design studio + PowerPoint familiarity' promise. " +
          "Return ONLY a JSON object with keys: " +
          '"overall_score" (1-10), ' +
          '"powerpoint_familiarity_score" (1-10, only for studio screenshots — else null), ' +
          '"strengths" (array of strings, max 3), ' +
          '"issues" (array of objects with "severity": "high"|"medium"|"low" and "description"), ' +
          '"top_suggestion" (string). No markdown, no explanation outside the JSON.',
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this Percy screenshot. Context: ${context}`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
  }

  const r    = await fetch(`${LM_URL}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })
  const data = await r.json()
  const raw  = data.choices?.[0]?.message?.content ?? ""

  // Extract JSON — model may wrap in ```json...``` fences, or include extra text.
  // Try multiple patterns in order of specificity.
  let parsed
  const attempts = [
    raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)?.[1],   // fenced json block
    raw.match(/(\{[\s\S]*"overall_score"[\s\S]*\})/)?.[1],    // object containing our key
    raw.match(/\{[\s\S]*\}/)?.[0],                             // any JSON object
  ].filter(Boolean)

  for (const attempt of attempts) {
    try { parsed = JSON.parse(attempt); break } catch {}
  }
  if (!parsed) {
    // Last resort: ask the model to just return the score as plain text
    parsed = { raw: raw.slice(0, 300), parse_error: "could not extract JSON from model response" }
  }

  return { model: VISION_MODEL, critique: parsed }
}

// ── Browser setup ─────────────────────────────────────────────────────────────

console.log("\n=== Percy Vision UI Critique ===")
console.log(`Deployed app:  ${BASE}`)
console.log(`LM Studio:     ${LM_URL}`)
console.log(`Vision model:  ${VISION_MODEL}`)
console.log("")

const browser = await chromium.launch({ headless: true })
const ctx     = await browser.newContext({
  viewport:          { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

// Signup so we can reach authenticated pages
let orgId, projId
const signupR = await page.request.post(`${BASE}/api/auth/signup`, {
  data:    { email: EMAIL, password: PW, display_name: "Vision Tester" },
  headers: { "Content-Type": "application/json" },
})
const me = await signupR.json()
orgId = me?.orgs?.[0]?.id ?? me?.org?.id

if (orgId) {
  const cp = await page.request.post(`${BASE}/api/projects`, {
    data:    { org_id: orgId, name: `VisionTest-${TAG}` },
    headers: { "Content-Type": "application/json" },
  })
  const project = await cp.json()
  projId = project.id
  if (projId) {
    const cd = await page.request.post(`${BASE}/api/docs/create-blank`, {
      data:    { width_in: 13.333, height_in: 7.5, name: "VisionDoc" },
      headers: { "Content-Type": "application/json" },
    })
    const doc = await cd.json()
    if (doc.doc_id) {
      await page.request.patch(`${BASE}/api/projects/${projId}`, {
        data:    { doc_id: doc.doc_id },
        headers: { "Content-Type": "application/json" },
      })
    }
  }
}

// ── Pages to screenshot ───────────────────────────────────────────────────────

const DESIGN_BRIEF =
  "Percy aims to look like a super-modern, visually-popping design studio (dark ink background, " +
  "clean typography, neon/vivid accents) but feel instantly familiar to any PowerPoint/Keynote user."

const shots = [
  { name: "splash",
    path: "/",
    context: `Public landing/splash page. ${DESIGN_BRIEF} Is the first impression striking enough to convert a PowerPoint user?` },
  { name: "login",
    path: "/login",
    context: `Login form. ${DESIGN_BRIEF} Should feel clean and premium, not generic SaaS.` },
  { name: "signup",
    path: "/signup",
    context: `Signup/registration. ${DESIGN_BRIEF} Is onboarding friction clear and minimal?` },
  { name: "forgot-password",
    path: "/forgot-password",
    context: `Password recovery. ${DESIGN_BRIEF} Does it maintain the brand aesthetic even on a utility page?` },
  { name: "dashboard",
    path: "/home",
    context: `Main dashboard. ${DESIGN_BRIEF} Does it feel like a modern design tool's home screen (Figma, Canva) while surfacing projects clearly?` },
  { name: "projects",
    path: "/projects",
    context: `Projects listing. ${DESIGN_BRIEF} Does the grid/list of presentations feel PowerPoint-file-manager-like?` },
  { name: "settings",
    path: "/settings",
    context: `User settings. ${DESIGN_BRIEF} Settings pages should still have the brand polish.` },
]
if (projId) shots.push(
  { name: "studio",
    path: `/studio/${projId}`,
    context: `The main slide editor — THE core UI. ${DESIGN_BRIEF} CRITICAL: the canvas area and toolbar layout MUST mirror PowerPoint exactly (ribbon tabs top, slide strip left/bottom, properties panel right, white canvas center). Evaluate PowerPoint familiarity rigorously.` },
)
if (orgId) shots.push(
  { name: "org-settings",
    path: `/org/${orgId}/settings`,
    context: `Org settings — billing, SSO, audit tabs. ${DESIGN_BRIEF}` },
)

// ── Capture + critique each page ─────────────────────────────────────────────

const critiques = []

for (const { name, path, context } of shots) {
  console.log(`📸 ${name} (${path})`)
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(name === "studio" ? 3500 : 600)

    const imgPath  = `${IMG_DIR}/${name}.png`
    await page.screenshot({ path: imgPath, fullPage: false })
    const imgB64   = (await readFile(imgPath)).toString("base64")

    console.log(`   → querying vision model…`)
    const { model, critique } = await visionCritique(imgB64, context)
    const score = critique?.overall_score ?? "n/a"
    console.log(`   Score: ${score}/10`)
    if (critique?.top_suggestion) console.log(`   Top suggestion: ${critique.top_suggestion}`)
    if (critique?.issues?.length) {
      const highs = critique.issues.filter((i) => i.severity === "high")
      if (highs.length) console.log(`   High-severity issues: ${highs.map((i) => i.description).join("; ")}`)
    }

    critiques.push({ page: name, path, context, model, score, critique, ts: new Date().toISOString() })
  } catch (e) {
    console.error(`   ❌ error: ${e.message}`)
    critiques.push({ page: name, path, context, model: null, score: null, error: e.message, ts: new Date().toISOString() })
  }
}

await browser.close()

// ── Write results ─────────────────────────────────────────────────────────────

const run = {
  kind:    "vision-critique",
  base:    BASE,
  lmUrl:   LM_URL,
  runTs:   new Date().toISOString(),
  pageCount: critiques.length,
  avgScore: (() => {
    const scored = critiques.filter((c) => typeof c.score === "number")
    return scored.length ? (scored.reduce((s, c) => s + c.score, 0) / scored.length).toFixed(1) : null
  })(),
  critiques,
}

const outFile = `${OUT_DIR}/vision-critique-${TAG}.json`
await writeFile(outFile, JSON.stringify(run, null, 2))
console.log(`\n✅ Done — results written to ${outFile}`)
console.log(`   Pages scored: ${critiques.filter((c) => typeof c.score === "number").length}/${critiques.length}`)
if (run.avgScore) console.log(`   Average UX score: ${run.avgScore}/10`)

// Append a summary entry to the persistent test log
const logPath = `${OUT_DIR}/test-log.json`
let log = []
if (existsSync(logPath)) {
  try { log = JSON.parse(await readFile(logPath, "utf8")) } catch {}
}
log.push({
  ts:      run.runTs,
  suite:   "vision-critique",
  base:    BASE,
  summary: { pagesScored: critiques.filter((c) => typeof c.score === "number").length, avgScore: run.avgScore },
  file:    outFile,
})
await writeFile(logPath, JSON.stringify(log, null, 2))
