"""Versioned canned prompts that exercise a Template Set end-to-end.

The job of these prompts is to force the LLM to pick a realistic mix of
slide types (data + storytelling), element types (footers, sources,
bottom notes), and accent colors WITHOUT naming any specific template id.
That's the test: can the agent + template-set combination, given just a
high-level brief, produce a sensible deck?

We use these for three things:

  1. **QA**: every change to Percy Standard or to the agent's planner
     should be vetted by running this prompt and eyeballing the deck.
  2. **Customer demo**: the "make my brand a deck" button on the
     Template Set editor runs this against the chosen set.
  3. **Marketing demo (future)**: the unauthenticated landing page can
     render this as a pre-recorded walkthrough.

Each prompt is versioned (`v1`, `v2`...) so we can A/B planner tweaks
without losing reproducibility.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True, frozen=True)
class DemoPrompt:
    """A canned demo brief.

    Two shapes:
      * Legacy free-form prompts use `prompt` (a single string).
      * Blueprint-driven demos use `blueprint` (a JSON dict with
        deck_summary + slides[]). The agent processes one slide at a
        time via deck_planner.apply_blueprint instead of trying to plan
        the whole deck in one LLM call. Always-7-slides decks (or any
        fixed shape) should use this.

    If both are set, `blueprint` wins. If only `prompt` is set, callers
    use the older /generate-deck path.
    """
    id: str
    version: str
    name: str
    description: str
    slide_count: int
    prompt: str = ""
    blueprint: dict = field(default_factory=dict)


# ── Canned demo: 10-slide quarterly business update ─────────────────────────


DEMO_QUARTERLY_UPDATE_V1 = DemoPrompt(
    id="demo.quarterly_update",
    version="v1",
    name="Quarterly business update (10 slides)",
    description=(
        "A realistic internal all-hands quarterly deck — opener, headline "
        "metric, what worked / what's broken / what's next. Forces the agent "
        "to mix data slides with storytelling slides and rotate accent colors "
        "by section mood. Slide 5 is the LIVE-DATA slide: the agent has to "
        "write Python that calls a public weather API and renders the result."
    ),
    slide_count=10,
    # Deliberately written without naming any specific template id. The
    # planner has to discover which available layouts fit each slot. For
    # slide 5, the agent should switch to the Coder skill (scripted_plan)
    # and produce real Python — we do NOT bake in a "weather adapter"; the
    # demonstration is that the agent can call any public HTTP API from
    # the script it generates.
    prompt="""\
Build a 10-slide internal quarterly business update deck for a B2B SaaS
company called Northwind. Audience: company-wide all-hands. Tone:
confident but honest — celebrate wins, name misses, be specific.

Use this story arc, picking the most appropriate layout for each slot
from the available templates. Don't repeat the same template back-to-
back. Vary accent colors by section mood (default cobalt; sage for
wins; ochre or brick for misses / urgent items).

  1. Cover slide — title "Q3 Northwind update", subtitle
     "Three quarters of compounding."
  2. Headline metric — the biggest win of the quarter. Pick a single
     dominant number. Use cobalt accent.
  3. Section divider — "What worked." Sage accent.
  4. KPI snapshot — 3 standout metrics with QoQ deltas (one win, one
     hold, one slight miss). Realistic numbers in the $1M-$5M / 80-99%
     / 30-60 range.
  5. LIVE DATA SLIDE — "Where our customers are today." Write a Python
     script (slide_script or live-group) that:
       a. Calls Open-Meteo's free public API to fetch current weather
          for these 5 cities (no API key required):
            New York      lat=40.7128 lon=-74.0060
            San Francisco lat=37.7749 lon=-122.4194
            London        lat=51.5072 lon=-0.1276
            Tokyo         lat=35.6762 lon=139.6503
            Singapore     lat=1.3521  lon=103.8198
          Use this URL pattern (one HTTP GET per city, urllib.request):
            https://api.open-meteo.com/v1/forecast?latitude=<LAT>
              &longitude=<LON>&current=temperature_2m
              &temperature_unit=fahrenheit
       b. Parses the JSON, builds a pandas DataFrame with city + temp_f.
       c. Renders the data as a chart or table on this slide using one of
          the available chart/table templates from the set, plus a
          headline that reads e.g. "Live: SIN 88°F · LON 44°F · NYC 50°F
          (Open-Meteo, fetched <ISO timestamp>)".
       d. Adds a small source-citation text element underneath.
     The script lives ON the slide (slide_script field) so it can be
     re-run whenever the data needs to refresh. Do NOT hardcode the
     temperatures — they must come from the live API call.
  6. Narrative slide — what we shipped this quarter (3-5 em-dash
     bullets).
  7. Section divider — "What we're fixing." Ochre or brick accent.
  8. Comparison slide — what was broken vs how we're fixing it.
     Two-column layout works here.
  9. Section divider — "What's next." Cobalt or sage.
 10. Closing — short thank-you headline + a contact / next-step line.

Use realistic but invented numbers EXCEPT slide 5 which uses live API
data. Where appropriate, add bottom notes (methodology caveats) or
source citations. Don't add a footer to every slide — only where it
adds value.

Output: one slide plan per row. For slide 5, include the full Python
script in a `slide_script` field on that row.
""",
)


# ── Canned demo: 5-slide product launch ─────────────────────────────────────


DEMO_PRODUCT_LAUNCH_V1 = DemoPrompt(
    id="demo.product_launch",
    version="v1",
    name="Product launch (5 slides)",
    description=(
        "A tight 5-slide product announcement deck. Tests the agent's "
        "ability to make sharp template choices when slide budget is small."
    ),
    slide_count=5,
    prompt="""\
Build a 5-slide product launch deck for a hypothetical analytics product
called "Beacon". Audience: existing customers. Tone: confident,
specific, no marketing fluff.

  1. Title slide — "Introducing Beacon", subtitle "Real-time pipeline
     observability without a metrics agent."
  2. The problem we're solving — 2-3 paragraphs or em-dash bullets.
  3. The headline number that proves it works (single dominant metric,
     e.g. "94% reduction in time-to-detect").
  4. What's new — 3-column layout of three core capabilities.
  5. Closing — "Available today" + contact line.

Vary accent colors by slide mood. Default cobalt; sage for the
"available today" close.
""",
)


# ── Registry ────────────────────────────────────────────────────────────────


# ── Canned demo: 7-slide showcase brief ────────────────────────────────────


DEMO_SHOWCASE_V1 = DemoPrompt(
    id="demo.showcase",
    version="v1",
    name="Showcase brief (7 slides)",
    description=(
        "Northwind Q4 quarterly update — exactly 7 slides, fully scripted "
        "blueprint. The agent processes ONE slide at a time given only the "
        "deck summary + that slide's slot/intent/content. Each call picks "
        "the best template from the active set and fills it in. Different "
        "sets → different template picks per slot → completely different "
        "visual decks, but always the same story."
    ),
    slide_count=7,
    blueprint={
        "deck_summary": (
            "Q4 2025 quarterly business update for Northwind (a B2B SaaS "
            "company). Internal all-hands audience. Confident but honest — "
            "the headline is a record-quarter ARR win, but logos came in "
            "under plan and we own that."
        ),
        "slides": [
            {
                "slot": 1,
                "instruction": (
                    "Cover slide. Title: \"Q4 2025 Northwind Update\". "
                    "Subtitle: \"Three commitments shipped, one miss to "
                    "talk about.\" Presenter is the Operations team, "
                    "December 2025."
                ),
            },
            {
                "slot": 2,
                "instruction": (
                    "Headline win — make the single number the whole slide. "
                    "$2.4M net new ARR added in Q4. Largest single quarter "
                    "in our history, up 18% QoQ. Eyebrow \"Q4 ARR added.\""
                ),
            },
            {
                "slot": 3,
                "instruction": (
                    "Three KPIs side-by-side. Title \"Q4 at a glance.\" "
                    "ARR added $2.4M (▲ 18% QoQ). Gross retention 98.7% "
                    "(▲ 1.2 pts). Logos closed 47 (▼ 4 vs Q3 — that's the miss)."
                ),
            },
            {
                "slot": 4,
                "instruction": (
                    "Quarterly ARR progression — bar chart if you have one. "
                    "Q1 $1.6M, Q2 $1.9M, Q3 $2.0M, Q4 $2.4M. Title \"ARR "
                    "added by quarter.\" Takeaway: mid-market expansion led "
                    "the quarter for the second straight period. Source: "
                    "Salesforce snapshot, 2025-12-12."
                ),
            },
            {
                "slot": 5,
                "instruction": (
                    "Three things we shipped this quarter — bulleted list "
                    "or em-dash format. (1) Aurora migration finished Nov 12, "
                    "read latency down 38%. (2) Self-serve onboarding "
                    "launched, 14% of new logos used it. (3) Mobile app v2 "
                    "in public beta, 2,100 users, 4.6 stars."
                ),
            },
            {
                "slot": 6,
                "instruction": (
                    "Honest look at the miss. Short body. \"We closed 47 "
                    "logos vs the 51 plan. Mid-funnel held but enterprise "
                    "pipeline build slowed. Sales engineering capacity "
                    "expanded in November; effects show up in Q1.\""
                ),
            },
            {
                "slot": 7,
                "instruction": (
                    "Close warmly. \"Thank you.\" Contact ops@northwind.so. "
                    "Office hours Thursdays at 11am PT."
                ),
            },
        ],
    },
)


DEMO_PROMPTS: dict[str, DemoPrompt] = {
    DEMO_SHOWCASE_V1.id: DEMO_SHOWCASE_V1,
    DEMO_QUARTERLY_UPDATE_V1.id: DEMO_QUARTERLY_UPDATE_V1,
    DEMO_PRODUCT_LAUNCH_V1.id: DEMO_PRODUCT_LAUNCH_V1,
}


DEFAULT_DEMO_ID = DEMO_SHOWCASE_V1.id


def get_demo_prompt(demo_id: str | None = None) -> DemoPrompt:
    """Lookup or default. Unknown ids raise KeyError so callers see the
    typo rather than silently getting the default."""
    if demo_id is None:
        return DEMO_PROMPTS[DEFAULT_DEMO_ID]
    if demo_id not in DEMO_PROMPTS:
        raise KeyError(f"unknown demo prompt {demo_id!r}; available: {list(DEMO_PROMPTS)}")
    return DEMO_PROMPTS[demo_id]
