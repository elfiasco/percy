# Template Induction v3 — Maximally Decomposed Pipeline

A redesign of how Percy converts a customer's source deck(s) into a
reusable Template Set. Where v1 collapsed 6+ judgments into a single
LLM call and lost most chart/table styling, v3 makes every judgment
a single-purpose call and treats **style as a first-class artifact
that can be ported across element types**.

Design principles:

1. **One LLM call = one clear question.** A call that has to decide
   keep/reject + name + tags + schema produces compromised output on
   all four. Split.
2. **Programmatic where possible.** Geometry, colors, fingerprinting,
   render+diff — no LLM. The LLM handles semantic intent, naming,
   role assignment, variable identification, dedup judgment, vision
   critique.
3. **Cross-pollination of style.** A brand's chart gridline/legend/
   palette choices apply to chart types the source deck never had.
   Same for tables. Style fragments live separately from data.
4. **Validation loop.** Every candidate template is rendered (with
   default + edge-case inputs) and vision-critiqued before joining
   the set. If it fails, a "surgeon" call proposes specific fixes
   and the loop continues.
5. **Provenance.** Every output carries which call produced it,
   what inputs it saw, and a confidence score.

Estimated cost per brand: **$5-10 on Sonnet 4.6**, **~$30 on Opus 4.5**
for the harder calls. Versus v1's ~$0.10/brand. Acceptable — this
runs once per brand at onboard time.

---

## Standard inputs schema

Every v3-induced template exposes inputs following a **fixed naming
convention**. Same names across every template means: the slide
agent has a stable surface to reason about, cross-template copy/paste
works without translation, and template authoring tools offer the
same inspector everywhere.

### Per-element common inputs (every element gets these)

| Input | Type | Default | Notes |
|---|---|---|---|
| `<alias>_left` | number | from prototype | inches OR percent based on `position_mode` |
| `<alias>_top` | number | from prototype | |
| `<alias>_width` | number | from prototype | |
| `<alias>_height` | number | from prototype | |
| `<alias>_rotation` | number | 0 | degrees |
| `<alias>_anchor` | string | `top_left` | `top_left` or `center` |

### Text-element extras (role ∈ {title, subtitle, kicker, hero_number, body, caption, footer, source_citation})

| Input | Type | Default |
|---|---|---|
| `<alias>_text` | string | prototype content (or genericized) |
| `<alias>_font_size` | number (pt) | from prototype |
| `<alias>_font_color` | string (hex) | from prototype |
| `<alias>_font_bold` | bool | from prototype |
| `<alias>_font_italic` | bool | from prototype |
| `<alias>_text_align` | string | `left` |

### Shape-element extras

| Input | Type | Default |
|---|---|---|
| `<alias>_fill_color` | string (hex) | from prototype |
| `<alias>_border_color` | string (hex) | from prototype |
| `<alias>_border_width` | number (pt) | from prototype |

### Chart-element inputs (ALL chart-kind templates expose these)

| Input | Type | Notes |
|---|---|---|
| `<alias>_categories` | list[str] | x-axis labels |
| `<alias>_series` | list[{name, values, color?}] | series data |
| `<alias>_title` | string | |
| `<alias>_subtitle` | string | optional |
| `<alias>_y_axis_min` | number\|null | |
| `<alias>_y_axis_max` | number\|null | |
| `<alias>_data_label_format` | string | e.g. `$#,##0`, `#%`, `0.0` |
| `<alias>_legend_visible` | bool | |
| `<alias>_legend_position` | string | `top`/`bottom`/`left`/`right` |

**Type-specific extras** (handled by base templates, not common):
`hole_size` (donut), `bar_width_ratio` (bar/column),
`is_horizontal` (bar), `vary_colors` (pie).

### Table-element inputs (ALL table-kind templates expose these)

| Input | Type | Notes |
|---|---|---|
| `<alias>_data` | list[list[str]] | row-major cells |
| `<alias>_first_row_header` | bool | |
| `<alias>_first_col_header` | bool | |
| `<alias>_banded_rows` | bool | zebra striping |
| `<alias>_column_widths` | list[float]\|null | inches per col |
| `<alias>_row_heights` | list[float]\|null | inches per row |

---

## Slide-dimension contract

Every template carries a `SlideDimensionsContract` so the apply
pipeline can adapt to slides of different aspect ratios:

```python
@dataclass
class SlideDimensionsContract:
    intended_width_in:  float                # what the template was authored for
    intended_height_in: float
    intended_aspect:    str                  # e.g. "landscape_16_9"
    compatible_aspects: list[str]            # which targets this template handles
    transform_strategy: str                  # how to adapt to off-aspect targets
    flow_groups: dict[str, str]              # for reflow_vertical
```

### Five canonical aspects

```
landscape_16_9   13.333 × 7.5 in    (default, Percy + most PowerPoint)
landscape_4_3    10    × 7.5 in    (older PowerPoint, Keynote default)
portrait_9_16    7.5   × 13.333 in (mobile)
portrait_4_5     6     × 7.5 in   (Instagram portrait)
square           7.5   × 7.5 in   (social)
```

### Four transform strategies

| Strategy | Behavior | Best for |
|---|---|---|
| `proportional_scale` | Multiply positions + sizes by (target_w/src_w, target_h/src_h) | Most layouts. Stretches type slightly on extreme aspect changes. |
| `preserve_aspect_fit` | Uniform scale to fit smaller dim, center result | Hero/cover slides. Leaves background bands on the off-axis. |
| `reflow_vertical` | Re-stack horizontally-arranged regions vertically | Landscape → portrait. Requires `flow_groups` on the template. |
| `manual_only` | Refuse to adapt | Single-dim templates; caller must use a portrait variant. |

All four are pure-Python and live in `template_induction_v3.py`:
`classify_aspect()`, `transform_position()`, `compute_position_percentages()`.

### How this lands at induction time

- Phase A's element fingerprints capture position in inches (faithful
  to source).
- Phase B-D never use absolute inches when reasoning about layouts —
  they think in roles + relative positions + percentages.
- Phase E asks the LLM **"which compatible aspects should this
  template declare?"** based on the layout's structure (a 3-column
  KPI grid is incompatible with portrait without reflow; a hero
  metric works in every aspect).
- The saved template's `provenance.dimensions` carries the contract;
  `apply_template` reads it + computes the right transform when
  applying to a slide whose dims differ from `intended_*`.

---

## Pipeline overview

```
Source deck(s)
   │
   ▼
Phase A — Programmatic extraction  (no LLM)
   │   bridge slides, fingerprints, palette,
   │   raw style fragments, brand metadata
   ▼
Phase B — Per-cluster semantic enrichment  (LLM, ~7 calls per cluster)
   │   intent, audience, variables, element roles,
   │   names, descriptions, tags
   ▼
Phase C — Style fragment extraction  (LLM, ~2 calls per fragment)
   │   ChartStyle and TableStyle objects, separate from data,
   │   characterized + validated
   ▼
Phase D — Per-template validation  (LLM, with vision, ~3 calls per template)
   │   render with default + edge-case inputs,
   │   vision-critique, surgical refinement loop
   ▼
Phase E — Cross-template consolidation  (LLM, 1 call + per-merge call)
   │   dedup near-duplicates into parametric versions,
   │   naming distinctiveness, taxonomy assignment
   ▼
Phase F — Coverage synthesis  (LLM, ~1 call per gap)
   │   identify missing slot types, synthesize stubs
   │   using the brand's StyleProfile + style fragments,
   │   validate via Phase D
   ▼
Phase G — Cross-brand consistency QC  (LLM, ~2 calls)
   │   final sanity check + test-deck render
   ▼
Saved Template Set
```

---

## Phase A — Programmatic extraction (no LLM)

| Step | Function | Output |
|---|---|---|
| A1 | `parse_source_decks(refs)` | `dict[ref_id, PercyDocument]` |
| A2 | `fingerprint_element(el)` | `tuple` — `(type, quadrant, size_band, has_text, has_image, has_chart, has_table, fill_kind)` |
| A3 | `fingerprint_slide(slide)` | frozen-set of element fingerprints + position bucket |
| A4 | `cluster_slides_initial(docs)` | `dict[fingerprint, list[(ref_id, slide_n, slide_obj)]]` |
| A5 | `extract_brand_palette(docs)` | `BrandPalette` — color → role + usage count |
| A6 | `extract_chart_style_fragments(docs)` | `list[RawChartStyle]` — one per *unique* chart styling observed |
| A7 | `extract_table_style_fragments(docs)` | `list[RawTableStyle]` |
| A8 | `extract_layout_grammar(docs)` | `LayoutGrammar` — KPI grid spacing, gutter widths, anchor patterns |

This phase is fast (<1s on a 50-slide deck) and deterministic. Output
shapes are typed dataclasses defined in `template_induction_v3.py`.

### A6 in detail — chart style fragment extraction

For each `BridgeChart` in the source:

```python
@dataclass
class RawChartStyle:
    # ── Type-agnostic (PORTABLE) ──
    series_palette: list[str]          # e.g. ["#29B5E8", "#7CCCE8", "#148BC0"]
    gridlines: GridlinesStyle           # show, color, weight, dash
    legend: LegendStyle                 # visible, position, font, color
    title_typography: TitleTypography   # font, size, bold, color
    axis_typography: AxisTypography
    data_labels: DataLabelStyle
    plot_area: PlotAreaStyle            # fill, border
    # ── Type-specific (NOT portable) ──
    chart_type: str                     # e.g. "column_clustered"
    hole_size: int | None               # donut only
    bar_width_ratio: float | None       # bar/column only
    is_horizontal: bool | None
    vary_colors: bool | None
    # ── Provenance ──
    source_slide: int
    source_chart_id: str
```

The **portable** fields are what cross-pollinates. The
**type-specific** fields stay with the originating chart type.

A "fragment" is unique by its portable-field hash. Multiple bar
charts with the same gridline+legend+palette collapse to one
fragment. Distinct fragments get their own LLM characterization
in Phase C.

### A7 — table style fragment extraction

Same idea for tables:

```python
@dataclass
class RawTableStyle:
    # ── Type-agnostic (PORTABLE) ──
    header_row_style: CellStyle         # fill, font_color, font_weight
    banded_rows: bool
    band_a: str | None                  # zebra color A
    band_b: str | None                  # zebra color B
    border_style: BorderStyle           # weight, color, pattern per side
    cell_padding: float                 # inches
    default_font: FontSpec
    header_text_align: str              # "left" | "center" | "right"
    body_text_align: str
    first_col_header: bool              # whether brand uses left-header tables
    # ── Provenance ──
    source_slide: int
    source_table_id: str
```

Table style fragments port across table USES (data, agenda, KPI,
comparison) — not just chart types.

---

## Phase B — Per-cluster semantic enrichment (LLM)

For each surviving cluster from Phase A4, run these calls **in
order** (each one's output feeds the next):

### B1. Intent — one sentence
**System:** "You see a slide layout that appears N times across M
source decks. What is this slide DOING in the deck? Answer in one
sentence, using the verb of the action (showcase / introduce /
compare / close / divide / etc.)."

**Input:** prototype slide's text + element layout (compact).

**Output:**
```json
{"intent": "Showcases a single hero metric with supporting context.", "confidence": 0.9}
```

### B2. Slot taxonomy
**System:** "Given that intent, pick the canonical slot type from
this fixed vocabulary: `cover`, `divider`, `hero_metric`, `kpi_grid`,
`chart`, `table`, `narrative`, `comparison`, `bulleted_list`,
`quote`, `image_lead`, `agenda`, `close`. One choice."

Input: intent string from B1.

Output:
```json
{"slot": "hero_metric", "rationale": "single-number focus."}
```

This is a closed-vocabulary classification — easy LLM task, very
high accuracy.

### B3. Element role assignment
**System:** "For each numbered element on this slide, assign one
role from: `title`, `subtitle`, `kicker`, `hero_number`, `body`,
`bullet_item`, `caption`, `footer`, `source_citation`,
`logo`, `decorative`, `background`, `chart`, `table`, `image`."

Input: list of elements with (idx, type, position, text_sample,
size_band).

Output:
```json
{"roles": {"0": "background", "1": "kicker", "2": "title", ...}}
```

One call per cluster, returns mapping. Used downstream to:
- Decide which `_text` inputs are content vs brand-fixed
- Auto-generate human-readable input names (`kicker_text` instead
  of `text_placeholder_7_text`)

### B4. Variable identification
For each element flagged "content" (not brand-fixed) in B3:
**System:** "Across the cluster's N members, does this element's
text vary or stay constant? If varying, what's the underlying
input it represents (deck title, KPI number, source citation)?"

Input: that element's text across all cluster members.

Output:
```json
{"varies": true, "input_name": "hero_number", "input_type": "string",
 "samples": ["$2.4M", "94%", "12,300 users"]}
```

One call PER candidate variable. Parallelizable across elements of
one cluster.

### B5. Naming — three candidates
**System:** "Suggest three short names for this template, each ≤5
words, action-oriented (verbs / what-you-do-with-it), distinct."

Input: intent + slot taxonomy + element roles.

Output:
```json
{"candidates": ["Hero metric callout", "Big number focus", "Single-metric headline"]}
```

### B6. Description
**System:** "Write a one-sentence description for a designer
browsing template cards. ≤140 chars. Plain language."

Input: chosen name + intent + variable list.

Output:
```json
{"description": "Frames a single dominant number with a kicker label and a one-line supporting note."}
```

### B7. Tags from controlled vocab
**System:** "Pick 3-6 tags from this list: [data, narrative, hero,
divider, opener, closer, kpi, chart, table, quote, comparison,
bulleted, image, dense, sparse, cover]."

Input: intent + slot taxonomy.

Output:
```json
{"tags": ["hero", "kpi", "sparse", "opener"]}
```

**Per-cluster LLM cost (B1-B7): ~7 calls × $0.005 = $0.035 per cluster**

---

## Phase C — Style fragment extraction (LLM)

For each unique `RawChartStyle` from A6:

### C1. Characterization
**System:** "Describe this chart's visual style in one sentence, as
a designer would describe it. Mention gridline treatment, legend
position, and palette character if notable."

Input: serialized RawChartStyle (compact).

Output:
```json
{
  "summary": "Light-gridline column chart with cyan-family series, no chart title, legend at bottom.",
  "design_signals": ["minimal", "data-forward", "cool palette"]
}
```

### C2. Type-agnostic style validation
Render a SYNTHETIC chart using this style applied to:
- a column chart (the source type — sanity check)
- a line chart
- a pie chart

For each render, vision-critique:
**System:** "This chart should look on-brand for a deck that's
[summary from C1]. Does it? Issues to flag: gridlines too heavy,
legend in wrong place, palette mismatch, axis fonts inconsistent."

Input: rendered PNG + design_signals from C1.

Output: per-render quality + targeted fix suggestions.

If C2 flags issues that the data isn't responsible for (e.g.
"legend overlaps title even with empty data"), the style fragment
gets a refinement call:
**System:** "The style produced this issue when applied to a [type]
chart: [issue]. Suggest a specific style adjustment that fixes
this without breaking the column-chart fidelity."

This loop terminates when all three renders score "good" or we hit
3 refinement iterations.

### C3. Cross-chart-type base templates
After validation, the ChartStyle gets paired with **base templates**
for each chart type the brand might need:

```
base_templates = {
  "column_clustered":  ColumnBase + ChartStyle  →  ColumnChartTemplate
  "bar_clustered":     BarBase    + ChartStyle  →  BarChartTemplate
  "line":              LineBase   + ChartStyle  →  LineChartTemplate
  "area_stacked":      AreaBase   + ChartStyle  →  AreaStackedTemplate
  "pie":               PieBase    + ChartStyle  →  PieTemplate
  "doughnut":          DonutBase  + ChartStyle  →  DonutTemplate
}
```

Where `*Base` are hand-crafted skeleton layouts that know each
chart type's quirks (donut needs `hole_size`, bar needs
`is_horizontal`, etc.) and `ChartStyle` carries the portable
brand formatting.

**This is the cross-pollination.** A brand whose source deck only
had column charts gets functional, on-brand stacked-area and pie
templates synthesized from the same style.

Same pattern for tables — TableStyle + base templates for
{agenda, kpi_grid, comparison, data_dump} layouts.

---

## Phase D — Per-template validation (LLM, with vision)

For each candidate template (from B + C), run a validation loop:

### D1. Default-inputs render
Apply the template with its `sample_inputs` from B1-B7. Save PNG.

### D2. Edge-case renders
- **Long-text variant**: replace each `_text` input with a 1.5x-longer
  string. Catches autofit failures.
- **Short-text variant**: replace each with one word. Catches
  alignment-when-sparse issues.
- **Multi-series variant** (charts): 6-series data instead of 1-3.
  Catches legend overflow.

### D3. Vision critique
For each render:
**System:** "This is template `<name>` rendered at `<scale>` of
its intended use. Score on: text overflow (0-3), element collision
(0-3), readability (0-3), brand consistency (0-3). For each issue,
suggest a precise fix (resize box, change autofit, etc.)."

Input: rendered PNG + template's metadata.

Output:
```json
{
  "scores": {"overflow": 0, "collision": 0, "readability": 3, "brand": 3},
  "issues": [],
  "overall": "pass"
}
```

If overall != "pass", run D4:

### D4. Surgical refinement
**System:** "The template `<name>` has these issues: [list].
Propose specific, minimal edits to the template's inputs_schema
defaults or layout. Don't change the layout structure, just tune
sizes / autofits / paddings. Output as JSON patches."

Input: full template JSON + issues list.

Output:
```json
{
  "patches": [
    {"path": "layout[0].body.position.height_in", "new_value": 1.4},
    {"path": "inputs_schema.title_font_size.default", "new_value": 44}
  ]
}
```

Apply patches, re-run D1-D3. Max 3 iterations per template. If
still failing, mark template `confidence: low` but still keep it
(better to have a slightly-flawed template than no template).

---

## Phase E — Cross-template consolidation (LLM)

Runs ONCE after all per-template work, sees the full accepted set.

### E1. Dedup analysis
**System:** "Here are N templates with names, descriptions, and
slot taxonomies. Identify groups of 2+ templates that are
near-duplicates — same intent, slightly different layout — and
should merge into ONE parametric template with new inputs
explaining the variance."

Input: compact list of templates (id, name, description, slot, tags).

Output:
```json
{
  "merge_groups": [
    {
      "members": ["tpl_a", "tpl_b"],
      "variance": "Different accent color (cobalt vs sage)",
      "proposed_new_input": "accent_color"
    }
  ]
}
```

### E2. Merge surgery
For each merge group, one LLM call:
**System:** "Merge these N templates into one. Pick the strongest
layout as the base. Add the proposed input(s). Keep all members'
defaults available as enum options."

Input: full JSON of all members + the variance description.

Output: merged template JSON.

### E3. Naming distinctiveness
**System:** "Given the final list of templates, rename any whose
names a Phase-1 agent might confuse (too-similar adjectives,
overlapping verbs). Make each name uniquely identifiable in one
phrase."

Input: list of all templates' names + descriptions.

Output: rename map.

### E4. Slot coverage audit
Programmatic check: do we have ≥1 template for each canonical
slot type? Output: list of missing slots → feeds Phase F.

---

## Phase F — Coverage synthesis (LLM)

For each canonical slot type that's missing AFTER Phase E:

### F1. Synthesis brief
**System:** "Brand `<X>` has no template for slot `<Y>`. Given
their StyleProfile (colors, fonts, chart style, table style),
their existing templates (for inspiration on layout density),
synthesize a stub template. Output as inputs_schema + layout
JSON."

Input:
- Slot type
- Brand StyleProfile
- Sample of existing templates (3-5)
- Reference layout from Percy Standard for the slot type

Output: complete template JSON.

### F2. Validate via Phase D
Run the synthesized template through D1-D3 (with refinement).

---

## Phase G — Final QC (LLM)

### G1. Coherence check
**System:** "Browse this template set. Does it feel like ONE
designer made it? Flag templates that feel off-brand (different
type system, mismatched palette, inconsistent spacing)."

Input: rendered thumbnails of all final templates + the brand's
StyleProfile.

### G2. Test-deck end-to-end
Run the standard `DEMO_SHOWCASE_V1` blueprint against the set.
If the resulting 7-slide deck looks coherent (per vision critique),
the set is ready. Otherwise, identify which templates the agent
picked + their failure mode and flag for human review.

---

## Provenance + replay

Every output carries:
```python
@dataclass
class CallProvenance:
    phase: str               # "B1.intent"
    call_id: str             # UUID
    model: str               # "us.anthropic.claude-sonnet-4-6"
    system_prompt_hash: str  # for prompt versioning
    input_hash: str
    output: dict
    duration_ms: int
    cost_usd: float
    timestamp: int
```

All persisted to `studio_template_set_inductions` table. Lets us:
- Replay a single failing call without re-running the whole pipeline
- A/B prompt changes by re-running just the affected calls
- Audit which calls produced poor outputs (vision-critique grading)
- Build training data over time (good outputs become few-shot
  examples for future runs)

---

## Cost summary per brand (estimate)

| Phase | Calls | Avg cost | Total |
|---|---|---|---|
| A — extraction | 0 | — | $0 |
| B — semantic (× 10 clusters) | 70 | $0.005 | $0.35 |
| C — style fragments (× 8 fragments) | 32 | $0.02 (vision) | $0.64 |
| D — validation (× 15 templates × 3 iters) | 135 | $0.02 (vision) | $2.70 |
| E — consolidation | 8 | $0.01 | $0.08 |
| F — synthesis (× 5 gaps) | 20 | $0.02 | $0.40 |
| G — final QC | 2 | $0.02 | $0.04 |
| **Total** | **~270 calls** | **~$4-8/brand** | |

On Opus 4.5 (5x more expensive than Sonnet) → ~$20-40/brand. Both
acceptable for a once-per-onboard cost.

---

## Migration path

v1 (`template_induction.py`) stays as-is — it's what's currently
wired for the demo pipeline. v3 lands as
`template_induction_v3.py`. `seed_demo_brand.py` gets a new
`--induction-mode=v3` flag. Once v3 is validated against all 5
mined demo brands (Snowflake / Percy Standard / BlackRock /
Caterpillar / Salesforce) and produces measurably better demos
(vision-critique scores), flip the default and retire v1.
