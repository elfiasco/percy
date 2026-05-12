import { useEffect, useRef, useState } from "react"
import TemplatePreview from "./TemplatePreview"

/**
 * ShowcaseSection — the scroll-cycling demo on the splash page.
 *
 * Vision the user articulated:
 *   "Same prompt, same data → wildly different brand-faithful decks."
 *
 * Layout:
 *   - sticky LEFT (40%): the prompt + live data + active brand indicator
 *   - scrolling RIGHT (60%): per-brand slide grids stacked vertically;
 *     as the user scrolls, brand sections cycle past and the left side
 *     updates to reflect whichever section is in view.
 *
 * Data is fetched from /api/showcase on mount. Brand template previews
 * are rendered client-side via the existing TemplatePreview component
 * (no round trip per thumbnail).
 *
 * Live weather is server-side cached (5 min TTL) and refreshes on
 * remount. The point isn't real-time freshness — it's proof that the
 * numbers come from an API, not a frozen example. The legend on the
 * panel makes that explicit ("Open-Meteo · fetched 14:38 UTC").
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
}

interface WeatherRow { city: string; code: string; temp_f: number | null; wind_kph?: number | null }
interface WeatherSummary {
  hottest_city?: string; hottest_temp_f?: number
  coldest_city?: string; coldest_temp_f?: number
  avg_temp_f?: number; city_count?: number
  oneliner?: string
}

interface ShowcaseResponse {
  brands: ShowcaseBrand[]
  weather: {
    rows: WeatherRow[]
    summary: WeatherSummary
    source: string
    fetched_at: number
  }
  prompt_summary: string
}


export default function ShowcaseSection() {
  const [data, setData] = useState<ShowcaseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeBrandIdx, setActiveBrandIdx] = useState(0)
  const brandRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    fetch("/api/showcase", { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  // IntersectionObserver to update which brand is "active" as the user scrolls.
  useEffect(() => {
    if (!data) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) {
          const idx = Number(visible.target.getAttribute("data-brand-idx"))
          if (!Number.isNaN(idx)) setActiveBrandIdx(idx)
        }
      },
      { threshold: [0.3, 0.5, 0.7], rootMargin: "-20% 0px -30% 0px" },
    )
    brandRefs.current.forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [data])

  if (error) {
    return (
      <div className="px-8 py-16 text-center text-[12px] text-muted">
        Showcase unavailable ({error}). Demo brands seed at boot — check back in a moment.
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

  const activeBrand = data.brands[activeBrandIdx]

  return (
    <section className="border-t border-edge bg-ink/80 relative">
      {/* Eyebrow */}
      <div className="px-8 sm:px-12 lg:px-20 pt-20 pb-12 border-b border-edge">
        <div className="max-w-6xl mx-auto">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">
            — Showcase —
          </div>
          <h2 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.01em] text-paper leading-[1.05] mb-4 max-w-3xl">
            One prompt. <span className="text-muted">Four brand books.</span>
            <br />
            Wildly different decks.
          </h2>
          <p className="text-[13px] text-muted leading-[1.7] max-w-2xl">
            {data.prompt_summary} Every set below was mined from a real
            investor document — Snowflake's template deck, Salesforce and
            Caterpillar's earnings PDFs, BlackRock's research report. Same
            10-slide prompt for all of them. Look how different the agent's
            output is.
          </p>
        </div>
      </div>

      {/* Two-column split: sticky left + scrolling right */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-[42%_58%] gap-8">
        {/* ─── Sticky left — active brand context + live weather ───────── */}
        <aside className="lg:sticky lg:top-8 self-start py-12 lg:max-h-[100vh] lg:overflow-hidden">
          <ActiveBrandPanel brand={activeBrand} weather={data.weather} />
        </aside>

        {/* ─── Scrolling right — brand sections stacked ──────────────── */}
        <div className="py-12 space-y-32">
          {data.brands.map((brand, idx) => (
            <BrandSection
              key={brand.slug}
              ref={(el) => { brandRefs.current[idx] = el }}
              brand={brand}
              isActive={idx === activeBrandIdx}
              index={idx}
            />
          ))}
        </div>
      </div>

      {/* Closing line */}
      <div className="border-t border-edge px-8 sm:px-12 lg:px-20 py-12 text-center">
        <div className="text-[14px] text-muted max-w-2xl mx-auto leading-[1.7]">
          The agent didn't memorize these brands. It mined each one from a
          single document, in seconds. Bring your own decks and it'll do the
          same for you.
        </div>
      </div>
    </section>
  )
}


// ── Active brand panel (sticky left) ────────────────────────────────────────


function ActiveBrandPanel({
  brand, weather,
}: {
  brand: ShowcaseBrand | undefined
  weather: ShowcaseResponse["weather"]
}) {
  if (!brand) return null

  return (
    <div>
      {/* Active brand */}
      <div className="text-[9px] tracking-[0.22em] uppercase text-muted mb-2">
        — Active brand —
      </div>
      <div className="text-[28px] font-semibold text-paper leading-tight mb-1 transition-all">
        {brand.name}
      </div>
      <div className="text-[11px] text-muted mb-5">{brand.tagline}</div>

      {/* Palette swatches */}
      <div className="text-[9px] tracking-[0.18em] uppercase text-muted mb-2">
        Palette · mined from source
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {brand.palette.slice(0, 10).map((c, i) => (
          <div
            key={i}
            className="w-8 h-8 border border-edge rounded-sm"
            style={{ backgroundColor: c.hex }}
            title={c.hex}
          />
        ))}
      </div>

      {/* Fonts */}
      <div className="text-[9px] tracking-[0.18em] uppercase text-muted mb-2">Fonts</div>
      <div className="space-y-1 mb-6">
        {brand.fonts.slice(0, 3).map((f, i) => (
          <div key={i} className="text-[12px] text-paper">
            <span className="text-paper">{f.name}</span>
            {f.role && <span className="text-muted ml-2">· {f.role}</span>}
          </div>
        ))}
      </div>

      {/* Prompt */}
      <div className="border border-edge bg-surface/30 p-3 mb-4 text-[11px] text-muted font-mono leading-[1.6] max-h-[140px] overflow-hidden">
        <span className="text-paper">$</span> generate-deck --set "{brand.slug}"
        <br />
        <span className="text-paper">prompt</span>: "10-slide quarterly update.
        Mix data and storytelling. Slide 5 fetches live weather."
      </div>

      {/* Live weather */}
      <div className="border border-edge bg-surface/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] tracking-[0.18em] uppercase text-muted">
            Live data · slide 5
          </div>
          <span className="text-[9px] text-accent tracking-wider uppercase animate-pulse">● LIVE</span>
        </div>
        <div className="space-y-1 font-mono">
          {weather.rows.map((r) => (
            <div key={r.code} className="flex items-center justify-between text-[11px]">
              <span className="text-muted w-12">{r.code}</span>
              <span className="flex-1 text-paper">{r.city}</span>
              <span className="text-paper tabular-nums">
                {r.temp_f != null ? `${r.temp_f}°F` : "—"}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-muted mt-2 leading-relaxed">
          {weather.source}
        </div>
      </div>
    </div>
  )
}


// ── Brand section (scrolling right) ─────────────────────────────────────────


const BrandSection = ({
  brand, isActive, index, ref,
}: {
  brand: ShowcaseBrand
  isActive: boolean
  index: number
  ref: (el: HTMLDivElement | null) => void
}) => {
  // Cap previews — we want a tight visual hit, not all 8 templates.
  const itemsToShow = brand.items.slice(0, 6)

  return (
    <div
      ref={ref}
      data-brand-idx={index}
      className={`transition-opacity duration-500 ${
        isActive ? "opacity-100" : "opacity-50"
      }`}
    >
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[10px] tracking-[0.22em] uppercase text-muted font-mono">
          0{index + 1}
        </span>
        <h3 className="text-[22px] font-semibold text-paper">{brand.name}</h3>
      </div>
      <p className="text-[12px] text-muted mb-6 max-w-md leading-relaxed">
        {brand.description}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {itemsToShow.map((item) => {
          const layout = (item.template?.layout as Array<Record<string, unknown>>) ?? []
          const sampleInputs = (item.template?.sample_inputs as Record<string, unknown>) ?? {}
          // Honor the brand's palette by passing it through; TemplatePreview
          // resolves named tokens against it.
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
                  width={460}
                  background={brand.palette[0]?.hex || "#F9F8F4"}
                />
              ) : (
                <div className="aspect-video bg-ink/40 flex items-center justify-center text-[10px] text-muted">
                  (no layout)
                </div>
              )}
              <div className="px-3 py-2 text-[10px] text-muted">
                <span className="uppercase tracking-wider">{item.kind}</span>
                {" · "}
                <span className="text-paper">{item.template?.name || "?"}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
