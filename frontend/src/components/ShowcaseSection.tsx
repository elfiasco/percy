import { useEffect, useState } from "react"
import SlideSvg from "./SlideSvg"

/**
 * ShowcaseSection — toggle between brand demos on the splash.
 *
 * The proof: same 7-slide brief + same data fed to two agents (one per
 * template set). The visitor clicks a brand button at the top, sees:
 *   LEFT  — brand metadata (palette + fonts + the actual prompt text)
 *   RIGHT — the generated demo deck (7 slides, SVG-rendered)
 *
 * Demo decks are PRE-GENERATED and persisted in the database
 * (studio_templates.demo_slides_json). The splash renders entirely
 * from the showcase API payload — no per-slide HTTP fetches.
 */

interface Palette { hex: string; name?: string; role?: string }
interface Font { name: string; role?: string; fallbacks?: string[] }

interface SlideData {
  slide_n: number
  width_in: number
  height_in: number
  elements: Array<Record<string, unknown>>
}

interface ShowcaseBrand {
  slug: string
  set_id: string
  name: string
  tagline: string
  source_kind: string
  description: string
  palette: Palette[]
  fonts: Font[]
  instructions_md: string
  demo?: {
    doc_id: string | null
    project_id: string | null
    generated_at: number | null
    slides_applied: number
    demo_id?: string
    demo_name?: string
    slides?: SlideData[]
  } | null
}

interface ShowcaseResponse {
  brands: ShowcaseBrand[]
  prompt_summary: string
  prompt_text: string
  prompt_name: string
  prompt_slide_count: number
}


export default function ShowcaseSection() {
  const [data, setData] = useState<ShowcaseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSlug, setActiveSlug] = useState<string>("")
  const [demoTriggered, setDemoTriggered] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("/api/showcase", { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d) => {
        setData(d)
        if (d.brands.length > 0) setActiveSlug(d.brands[0].slug)
      })
      .catch((e) => setError(String(e)))
  }, [])

  // Lazy-trigger demo generation when the active brand has no demo yet.
  // (Once we pre-bake demos at deploy time this will be a no-op for
  // production traffic — kept as a safety net.)
  useEffect(() => {
    if (!data || !activeSlug) return
    const brand = data.brands.find((b) => b.slug === activeSlug)
    if (!brand) return
    if (brand.demo && brand.demo.slides_applied > 0) return
    if (demoTriggered.has(activeSlug)) return

    setDemoTriggered((prev) => { const n = new Set(prev); n.add(activeSlug); return n })

    fetch("/api/demo-decks", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_set_id: brand.set_id }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then(() => fetch("/api/showcase", { credentials: "include" }))
      .then((r) => r?.ok ? r.json() : null)
      .then((d) => { if (d) setData(d) })
      .catch(() => {})
  }, [data, activeSlug, demoTriggered])

  if (error) {
    return <div className="px-8 py-16 text-center text-[12px] text-muted">Showcase unavailable ({error}).</div>
  }
  if (!data) {
    return <div className="px-8 py-32 text-center text-[12px] text-muted">Loading the brand showcase…</div>
  }

  const active = data.brands.find((b) => b.slug === activeSlug) ?? data.brands[0]
  if (!active) return null

  return (
    <section className="border-t border-edge bg-ink/80 relative">
      {/* ─── Eyebrow + headline ──────────────────────────────────── */}
      <div className="px-8 sm:px-12 lg:px-20 pt-20 pb-10 border-b border-edge">
        <div className="max-w-6xl mx-auto">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">
            — Showcase —
          </div>
          <h2 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.01em] text-paper leading-[1.05] mb-4 max-w-3xl">
            One brief. <span className="text-muted">Two agents.</span>
            <br />
            Completely different decks.
          </h2>
          <p className="text-[13px] text-muted leading-[1.7] max-w-2xl">
            {data.prompt_summary} The visual difference is entirely the
            agent's choice of templates — no recolored palette, no
            handcrafted theming.
          </p>
        </div>
      </div>

      {/* ─── Brand button strip ──────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 pt-8 pb-4">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {data.brands.map((b) => {
            const isActive = b.slug === activeSlug
            return (
              <button
                key={b.slug}
                onClick={() => setActiveSlug(b.slug)}
                className={`px-5 py-2.5 text-[12px] tracking-[0.12em] uppercase font-medium transition-all border ${
                  isActive
                    ? "border-paper bg-paper text-ink"
                    : "border-edge text-muted hover:text-paper hover:border-paper/40"
                }`}
              >
                {b.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Active brand panel — LEFT metadata + prompt | RIGHT deck ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-10">
        <BrandPanel brand={active} promptText={data.prompt_text} promptName={data.prompt_name} />
      </div>

      {/* Closing */}
      <div className="border-t border-edge px-8 sm:px-12 lg:px-20 py-12 text-center">
        <div className="text-[14px] text-muted max-w-2xl mx-auto leading-[1.7]">
          Bring your own decks. Percy mines the brand in seconds and the
          agent uses it from then on.
        </div>
      </div>
    </section>
  )
}


function BrandPanel({
  brand, promptText, promptName,
}: {
  brand: ShowcaseBrand
  promptText: string
  promptName: string
}) {
  const bgColor = brand.palette[0]?.hex || "#F9F8F4"
  const demo = brand.demo
  const slides = demo?.slides || []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[34%_66%] gap-8">
      {/* ─── LEFT: brand metadata + prompt (sticky) ───────────── */}
      <aside className="lg:sticky lg:top-8 self-start space-y-6">
        {/* Brand header */}
        <div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-1">
            {brand.source_kind}
          </div>
          <h3 className="text-[26px] font-semibold text-paper mb-1 leading-tight">
            {brand.name}
          </h3>
          <p className="text-[12px] text-muted leading-relaxed">
            {brand.tagline}
          </p>
        </div>

        {/* Palette */}
        <div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">
            Palette · mined
          </div>
          <div className="flex flex-wrap gap-1">
            {brand.palette.slice(0, 12).map((c, i) => (
              <div
                key={i}
                className="w-8 h-8 border border-edge"
                style={{ backgroundColor: c.hex }}
                title={c.hex}
              />
            ))}
          </div>
        </div>

        {/* Fonts */}
        <div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">
            Fonts
          </div>
          <div className="space-y-0.5">
            {brand.fonts.slice(0, 4).map((f, i) => (
              <div key={i} className="text-[12px] text-paper">
                {f.name}
                {f.role && <span className="text-muted text-[10px] ml-2 uppercase tracking-wider">{f.role}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* The prompt */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] tracking-[0.18em] uppercase text-muted">
              The brief
            </div>
            <div className="text-[9px] text-muted font-mono">{promptName}</div>
          </div>
          <pre className="border border-edge bg-surface/30 p-3 text-[10px] text-paper leading-[1.5] font-mono whitespace-pre-wrap max-h-[420px] overflow-auto">
            {promptText || "(prompt unavailable)"}
          </pre>
        </div>
      </aside>

      {/* ─── RIGHT: the generated demo deck ───────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted">
            Generated deck {demo?.slides_applied ? `· ${demo.slides_applied} slides` : ""}
          </div>
          {demo?.generated_at && (
            <div className="text-[10px] text-muted font-mono">
              {new Date(demo.generated_at * 1000).toLocaleDateString(undefined, {
                month: "short", day: "numeric",
              })}
            </div>
          )}
        </div>

        {slides.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {slides.map((s, i) => (
              <div
                key={i}
                className="border border-edge bg-surface/30 overflow-hidden"
              >
                <SlideSvg
                  slideData={s as never}
                  width={520}
                  background={bgColor}
                />
                <div className="px-3 py-1.5 text-[10px] text-muted font-mono">
                  Slide {s.slide_n || i + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-edge p-12 text-center">
            <div className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <div className="text-[12px] text-paper mb-1">Generating demo deck…</div>
            <div className="text-[10px] text-muted">
              First load fires off generation. Refresh in 30-60 seconds.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
