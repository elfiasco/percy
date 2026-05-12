import { useEffect, useState } from "react"
import TemplatePreview from "./TemplatePreview"
import SlideSvg from "./SlideSvg"

/**
 * ShowcaseSection — toggle between two brand books on the splash.
 *
 * The proof: same 7-slide quarterly update prompt + same data, fed to
 * two different agents (one per template set). The user toggles between
 * brands and sees the deck output for each. Different template choices,
 * different visual results — driven entirely by which templates each
 * set makes available to the agent.
 */

interface Palette { hex: string; name?: string; role?: string }
interface Font { name: string; role?: string; fallbacks?: string[] }

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
  items: Array<{
    kind: "slide" | "element"
    template_id: string
    template?: {
      id: string
      name: string
      description?: string
      layout?: Array<Record<string, unknown>>
      sample_inputs?: Record<string, unknown>
      tags?: string[]
    }
  }>
  demo?: {
    doc_id: string
    project_id: string
    generated_at: number
    slides_applied: number
    demo_id?: string
    demo_name?: string
  } | null
}

interface ShowcaseResponse {
  brands: ShowcaseBrand[]
  prompt_summary: string
}


export default function ShowcaseSection() {
  const [data, setData] = useState<ShowcaseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSlug, setActiveSlug] = useState<string>("")
  // Track which brands we've already kicked a demo for in this session, so
  // a user toggling back and forth doesn't fire repeated requests.
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
  // Fire-and-forget; we refetch /api/showcase a few seconds later to pick
  // up the new doc_id. Idempotent on the server side via throttle.
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
      .then(() => {
        // Refetch to grab the newly-stamped demo block.
        return fetch("/api/showcase", { credentials: "include" })
      })
      .then((r) => r?.ok ? r.json() : null)
      .then((d) => { if (d) setData(d) })
      .catch(() => {})
  }, [data, activeSlug, demoTriggered])

  if (error) {
    return (
      <div className="px-8 py-16 text-center text-[12px] text-muted">
        Showcase unavailable ({error}).
      </div>
    )
  }
  if (!data) {
    return (
      <div className="px-8 py-32 text-center text-[12px] text-muted">
        Loading the brand showcase…
      </div>
    )
  }

  const active = data.brands.find((b) => b.slug === activeSlug) ?? data.brands[0]
  if (!active) return null

  return (
    <section className="border-t border-edge bg-ink/80 relative">
      {/* Eyebrow */}
      <div className="px-8 sm:px-12 lg:px-20 pt-20 pb-12 border-b border-edge">
        <div className="max-w-6xl mx-auto">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">
            — Showcase —
          </div>
          <h2 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.01em] text-paper leading-[1.05] mb-4 max-w-3xl">
            One prompt. Same data. <span className="text-muted">Different agents.</span>
            <br />
            Wildly different decks.
          </h2>
          <p className="text-[13px] text-muted leading-[1.7] max-w-2xl">
            {data.prompt_summary} Toggle between the two brand books below.
            Each agent saw the IDENTICAL 7-slide brief — same wording, same
            numbers, same data — and was told to pick the templates from
            its own set that best fulfilled each slot. The visual
            difference is entirely the agent's choice of templates, not
            a recolored palette.
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 pt-8 pb-2">
        <div className="flex items-center justify-center gap-2">
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

      {/* Active brand body */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 py-10">
        <BrandPanel brand={active} />
      </div>

      {/* Closing line */}
      <div className="border-t border-edge px-8 sm:px-12 lg:px-20 py-12 text-center">
        <div className="text-[14px] text-muted max-w-2xl mx-auto leading-[1.7]">
          Bring your own decks. Percy mines the brand in seconds and the
          agent uses it from then on.
        </div>
      </div>
    </section>
  )
}


function BrandPanel({ brand }: { brand: ShowcaseBrand }) {
  const bgColor = brand.palette[0]?.hex || "#F9F8F4"
  const demo = brand.demo

  return (
    <div>
      {/* Brand metadata header */}
      <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-1">{brand.source_kind}</div>
          <h3 className="text-[24px] font-semibold text-paper mb-1">{brand.name}</h3>
          <p className="text-[12px] text-muted leading-relaxed max-w-md">{brand.tagline}</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Palette · mined</div>
          <div className="flex items-center gap-1 justify-end mb-3">
            {brand.palette.slice(0, 10).map((c, i) => (
              <div
                key={i}
                className="w-7 h-7 border border-edge rounded-sm"
                style={{ backgroundColor: c.hex }}
                title={c.hex}
              />
            ))}
          </div>
          <div className="text-[10px] text-muted">
            {brand.fonts.slice(0, 2).map((f) => f.name).join(" · ")}
          </div>
        </div>
      </div>

      {/* Generated deck — the proof */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            Generated deck {demo ? `· ${demo.slides_applied} slides` : ""}
          </div>
          {demo && (
            <div className="text-[10px] text-muted">
              prompt: <code className="text-paper">demo.showcase v1</code>
            </div>
          )}
        </div>
        {demo && demo.slides_applied > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: Math.min(demo.slides_applied, 10) }).map((_, i) => (
              <div
                key={i}
                className="border border-edge bg-surface/30 overflow-hidden"
              >
                <SlideSvg
                  docId={demo.doc_id}
                  slideN={i + 1}
                  width={520}
                  background={bgColor}
                />
                <div className="px-3 py-1.5 text-[10px] text-muted font-mono">
                  Slide {i + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-edge p-10 text-center">
            <div className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <div className="text-[12px] text-paper mb-1">Generating demo deck…</div>
            <div className="text-[10px] text-muted">
              First load fires off generation. Refresh in 30-60 seconds.
            </div>
          </div>
        )}
      </div>

      {/* Templates inventory */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted mb-3">
          What the agent had to choose from · {brand.items.length} templates
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {brand.items.slice(0, 6).map((item) => {
            const layout = (item.template?.layout as Array<Record<string, unknown>>) ?? []
            const sampleInputs = (item.template?.sample_inputs as Record<string, unknown>) ?? {}
            return (
              <div
                key={item.template_id}
                className="border border-edge bg-surface/30 overflow-hidden"
              >
                {layout.length > 0 ? (
                  <TemplatePreview
                    layout={layout}
                    sampleInputs={sampleInputs}
                    palette={brand.palette}
                    width={320}
                    background={bgColor}
                  />
                ) : (
                  <div className="aspect-video bg-ink/40 flex items-center justify-center text-[10px] text-muted">
                    (no layout)
                  </div>
                )}
                <div className="px-2 py-1 text-[9px] text-muted truncate">
                  {item.kind} · {item.template?.name || "?"}
                </div>
              </div>
            )
          })}
        </div>
        {brand.items.length > 6 && (
          <div className="text-[10px] text-muted mt-2 text-center">
            + {brand.items.length - 6} more
          </div>
        )}
      </div>
    </div>
  )
}
