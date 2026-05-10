// Quick smoke test: verifies LM Studio is reachable and the vision model can
// receive a screenshot + return parseable JSON. Use this to validate the
// vision-click-agent pipeline before running the full task suite.
//
// Usage: node tests/vision-click-smoke.mjs [LM_STUDIO_URL]

import { chromium } from "playwright"

const LM_URL = process.argv[2] || "http://localhost:1234"

console.log(`Smoke test: ${LM_URL}`)

const r = await fetch(`${LM_URL}/v1/models`)
if (!r.ok) {
  console.error(`LM Studio returned ${r.status}`); process.exit(1)
}
const ids = (await r.json()).data.map((m) => m.id).filter((id) => !/embed/i.test(id))
const model = ids.find((id) => /gemma-4/i.test(id)) || ids[0]
console.log(`Picked model: ${model}`)
console.log(`Available:    ${ids.join(", ")}`)

// Take a quick local screenshot — google.com is reliable enough
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1000)
const png = await page.screenshot({ type: "png" })
await browser.close()

// Send a single vision query
const t0 = Date.now()
const resp = await fetch(`${LM_URL}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    max_tokens: 200,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: 'You see a screenshot. Return ONLY a JSON object: {"action": "click", "target_description": "...", "target_coords": [x, y], "reasoning": "..."} — no prose, no markdown.',
      },
      {
        role: "user",
        content: [
          { type: "text", text: "GOAL: search for the word 'cats'. What is your next action?" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
        ],
      },
    ],
  }),
})
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
if (!resp.ok) {
  console.error(`Vision request failed: ${resp.status} ${await resp.text()}`); process.exit(1)
}
const out = await resp.json()
const content = out.choices?.[0]?.message?.content ?? "(empty)"
console.log(`\nResponse (${elapsed}s):\n${content}\n`)

// Try to parse JSON
const m = content.match(/\{[\s\S]*\}/)
if (m) {
  try {
    const parsed = JSON.parse(m[0])
    console.log("Parsed JSON:", parsed)
    console.log("\n✓ Smoke test passed — vision pipeline works")
    process.exit(0)
  } catch {}
}
console.log("\n⚠ Could not parse JSON from model — agent may fail on this model")
process.exit(0)
