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

from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class DemoPrompt:
    id: str
    version: str
    name: str
    description: str
    slide_count: int
    prompt: str


# ── Canned demo: 10-slide quarterly business update ─────────────────────────


DEMO_QUARTERLY_UPDATE_V1 = DemoPrompt(
    id="demo.quarterly_update",
    version="v1",
    name="Quarterly business update (10 slides)",
    description=(
        "A realistic internal all-hands quarterly deck — opener, headline "
        "metric, what worked / what's broken / what's next. Forces the agent "
        "to mix data slides with storytelling slides and rotate accent colors "
        "by section mood."
    ),
    slide_count=10,
    # Deliberately written without naming any specific template id. The
    # planner has to discover which Percy Standard layouts fit each slot.
    prompt="""\
Build a 10-slide internal quarterly business update deck for a B2B SaaS
company called Northwind. Audience: company-wide all-hands. Tone:
confident but honest — celebrate wins, name misses, be specific.

Use this story arc, picking the most appropriate layout for each slot
from the available templates. Don't repeat the same template back-to-
back. Vary accent colors by section mood (default cobalt; sage for
wins; ochre or brick for misses / urgent items).

  1. Cover slide — title "Q3 2025 Northwind Update", subtitle
     "Three quarters of compounding."
  2. Headline metric — the biggest win of the quarter. Pick a single
     dominant number. Use cobalt accent.
  3. Section divider — "What worked." Sage accent.
  4. KPI snapshot — 3 standout metrics with QoQ deltas (one win, one
     hold, one slight miss). Realistic numbers in the $1M-$5M / 80-99%
     / 30-60 range.
  5. Chart slide — net retention or ARR growth, with a one-sentence
     takeaway. Add a source citation at the bottom.
  6. Narrative slide — what we shipped this quarter (3-5 em-dash
     bullets).
  7. Section divider — "What we're fixing." Ochre or brick accent.
  8. Comparison slide — what was broken vs how we're fixing it.
     Two-column layout works here.
  9. Section divider — "What's next." Cobalt or sage.
 10. Closing — short thank-you headline + a contact / next-step line.

Use realistic but invented numbers. Where appropriate, add bottom notes
(methodology caveats) or source citations. Don't add a footer to every
slide — only where it adds value.

Output: one slide plan per row with template_id + inputs.
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


DEMO_PROMPTS: dict[str, DemoPrompt] = {
    DEMO_QUARTERLY_UPDATE_V1.id: DEMO_QUARTERLY_UPDATE_V1,
    DEMO_PRODUCT_LAUNCH_V1.id: DEMO_PRODUCT_LAUNCH_V1,
}


DEFAULT_DEMO_ID = DEMO_QUARTERLY_UPDATE_V1.id


def get_demo_prompt(demo_id: str | None = None) -> DemoPrompt:
    """Lookup or default. Unknown ids raise KeyError so callers see the
    typo rather than silently getting the default."""
    if demo_id is None:
        return DEMO_PROMPTS[DEFAULT_DEMO_ID]
    if demo_id not in DEMO_PROMPTS:
        raise KeyError(f"unknown demo prompt {demo_id!r}; available: {list(DEMO_PROMPTS)}")
    return DEMO_PROMPTS[demo_id]
