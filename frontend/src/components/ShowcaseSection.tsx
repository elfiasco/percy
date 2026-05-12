import { useEffect, useState } from "react"
import SlideViewer from "./SlideViewer"

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

  useEffect(() => {
    fetch("/api/showcase", { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d) => {
        setData(d)
        if (d.brands.length > 0) setActiveSlug(d.brands[0].slug)
      })
      .catch((e) => setError(String(e)))
  }, [])

  // Demo decks are pre-generated offline via scripts/generate_showcase_demos.py
  // and persisted to studio_templates.demo_slides_json. The app never
  // generates at runtime — we just render what's in the DB. Brands
  // without a persisted demo show an empty state.

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


/** Parse the showcase API's `prompt_text` (a JSON-serialized blueprint
 *  with deck_summary + slides[].instruction) and render it as a human
 *  paragraph + numbered list. Falls back to the raw text if parse fails
 *  (older brands or back-compat with prose-only prompts). */
function BlueprintBrief({ raw }: { raw: string }) {
  if (!raw) {
    return (
      <div className="border-l-2 border-accent pl-4 text-[11px] text-muted leading-[1.6]">
        (prompt unavailable)
      </div>
    )
  }
  let parsed: { deck_summary?: string; slides?: { slot?: number; instruction?: string }[] } | null = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Not JSON — render as plain text (legacy prose prompt path).
    return (
      <pre className="border-l-2 border-accent pl-4 text-[11px] text-paper leading-[1.6] whitespace-pre-wrap max-h-[420px] overflow-auto"
            style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        {raw}
      </pre>
    )
  }
  const summary = parsed?.deck_summary || ""
  const slides = parsed?.slides || []
  return (
    <div className="border-l-2 border-accent pl-4 max-h-[480px] overflow-auto space-y-4">
      {summary && (
        <p className="text-[12px] text-paper leading-[1.65]">{summary}</p>
      )}
      {slides.length > 0 && (
        <ol className="space-y-2.5 text-[11px] text-paper leading-[1.55]">
          {slides.map((s, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-3 items-start">
              <span className="text-muted tabular-nums">{String(s.slot ?? i + 1).padStart(2, "0")}</span>
              <span>{s.instruction || ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}


function BrandPanel({
  brand, promptText,
}: {
  brand: ShowcaseBrand
  promptText: string
  promptName: string
}) {
  const bgColor = brand.palette[0]?.hex || "#F9F8F4"
  const demo = brand.demo
  const slides = demo?.slides || []

  return (
    <div
      key={brand.slug}                   // remount on switch → CSS transitions re-fire, sells the wow
      className="grid grid-cols-1 lg:grid-cols-[34%_66%] gap-8 splash-brand-enter"
    >
      {/* ─── LEFT: brand context + brief (sticky) ─────────────── */}
      <aside className="lg:sticky lg:top-8 self-start space-y-7">
        {/* Brand name only — no source-kind label */}
        <div>
          <h3 className="text-[34px] font-semibold text-paper leading-[1.05] tracking-[-0.01em]">
            {brand.name}
          </h3>
          <p className="text-[12px] text-muted leading-[1.6] mt-2">
            {brand.tagline}
          </p>
        </div>

        {/* Big swatch strip — no label, just the colors */}
        <div className="flex gap-0">
          {brand.palette.slice(0, 8).map((c, i) => (
            <div
              key={i}
              className="h-12 flex-1 border-r border-edge last:border-r-0"
              style={{ backgroundColor: c.hex }}
              title={c.hex}
            />
          ))}
        </div>

        {/* Font specimens — let the typeface itself be the proof */}
        <div className="space-y-1">
          {brand.fonts.slice(0, 2).map((f, i) => (
            <div
              key={i}
              className="text-[20px] text-paper leading-tight"
              style={{ fontFamily: `"${f.name}", ${(f.fallbacks || []).join(", ") || "system-ui"}, sans-serif` }}
            >
              {f.name}
            </div>
          ))}
        </div>

        {/* The brief — humanized blueprint (summary + numbered slots) */}
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">
            — The brief —
          </div>
          <BlueprintBrief raw={promptText} />
        </div>
      </aside>

      {/* ─── RIGHT: just the deck ─────────────────────────────── */}
      <div>
        {slides.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {slides.map((s, i) => (
              <div
                key={i}
                className="border border-edge bg-surface/30 overflow-hidden splash-slide-enter"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <SlideViewer
                  slideData={s as never}
                  width={560}
                  background={bgColor}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-edge p-12 text-center">
            <div className="text-[12px] text-muted">
              Demo for <span className="text-paper">{brand.name}</span> hasn't been generated yet.
            </div>
          </div>
        )}
      </div>

      {/* Page-scoped CSS for the wow-factor transitions */}
      <style>{`
        @keyframes splash-brand-enter {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .splash-brand-enter {
          animation: splash-brand-enter 380ms ease-out both;
        }
        @keyframes splash-slide-enter {
          0%   { opacity: 0; transform: scale(0.985) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .splash-slide-enter {
          animation: splash-slide-enter 520ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .splash-brand-enter, .splash-slide-enter { animation: none; }
        }
      `}</style>
    </div>
  )
}
