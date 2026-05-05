# Percy Agent — Build Blueprint

**Status:** working plan as of 2026-05-04. Supersedes `docs/percy-agent-macro.md` where they conflict; the macro doc is preserved as the original brief.

**Read first:** `docs/percy-mission.md`, `docs/percy-enterprise-vision.md`, `docs/percy-pitch-deck.md` (slides 11, 12, 16, 19), `docs/percy-agent-macro.md`.

---

## 1. What this is

The Percy agent translates natural-language intent into precise actions on the studio: editing existing Bridge elements, creating new ones, and authoring the Python that drives data refresh. It is the user-facing realization of the pitch-deck claim *"AI that operates on structure, not screenshots."*

The macro doc treated this as a single retrieval-then-act loop over editing endpoints. After working through the Bridge schema, the connect runtime, and the create gap, it's clear the agent is actually two skills behind one chat surface, sitting on top of three pieces of infrastructure that mostly don't exist yet.

This blueprint covers all of it, in the order it should be built.

---

## 2. Architecture

```
                   ┌──────────────────────┐
   user prompt ──► │  Router              │
                   │  (haiku, 3-way)      │
                   └─┬─────────┬──────────┘
                     │         │
              ┌──────▼──┐   ┌──▼──────┐
              │ Editor  │   │ Coder   │
              │ skill   │   │ skill   │
              └──┬──────┘   └──┬──────┘
                 │             │
       ┌─────────▼─────────────▼─────────┐
       │ Retrieval (3 corpora)           │
       │  • API manifest                 │
       │  • Templates                    │
       │  • Project supplementary code   │
       └─────────────┬───────────────────┘
                     │
       ┌─────────────▼───────────────────┐
       │ Planner (Sonnet)                │
       │  prompt + context + retrieved   │
       │  → plan: tool calls / source    │
       └─────────────┬───────────────────┘
                     │
       ┌─────────────▼───────────────────┐
       │ Validator                       │
       │  schema · lint · dry-run · diff │
       └─────────────┬───────────────────┘
                     │
       ┌─────────────▼───────────────────┐
       │ Executor                        │
       │  doc snapshot → calls → audit   │
       └─────────────────────────────────┘
```

**Key choices that differ from the macro doc:**

- **Two skills, not one.** Router classifies into Editor / Coder / Hybrid. Different contexts, output formats, and validation paths.
- **Build the planner without retrieval first.** ~150 endpoints × ~30-token summaries is ~5k tokens with prompt caching — measure quality at full surface before committing to a vector index. Add retrieval only if numbers force it.
- **One rollback path: per-invocation doc snapshot.** Not per-PATCH GET-and-store *plus* `/undo`. Pick one. The agent invocation = the unit of undo.
- **Plan/execute is a loop, not a flat list.** `read → propose → execute → observe → continue`. Multi-step edits need mid-plan state reads; flat plans break on real prompts. Retrieval narrows the surface; the loop is still required.
- **Blast-radius gating.** Confirmation triggered by plan-level `affected_element_count > N`, not per-endpoint `destructive: true`. (`destructive` is still useful as a hint — but the gate is plan-level.)

---

## 3. Skill 1 — Editor

The editor skill handles edits to existing elements: style, text, position, chart/table data, slide ops, deck ops.

### 3.1 The API manifest

`app/backend/agent_manifest.py` is the catalog. Each entry: `id`, `method`, `path`, `summary` (one sentence, embed target), `applies_to`, `destructive`, `args` (one-line desc per field), `examples` (alternate phrasings).

Today: 30 entries. Target: every editable endpoint in `main.py` (~120 endpoints worth surfacing; many of the 200+ aren't agent-relevant — diagnostics, exports, etc.).

**CI check:** a startup test that walks `app.routes` and warns/fails on routes missing from the manifest. Without this, the manifest rots inside a quarter.

### 3.2 Element resolution — the actually-hard part

Endpoint selection is easy. *"Which element_id?"* is the real work. When the user says "make the title bold and the revenue line red," there is no selected element and the planner can't invent IDs.

**Solution:** a `find_element` tool the planner calls *before* it plans the edit. Inputs: a natural-language target (`"the title on slide 3"`, `"the chart with revenue"`, `"the bottom-right callout"`), an optional scope (current slide, range, whole deck). Returns: a ranked list of candidate `(slide_n, element_id, summary)` tuples. The planner picks one, or asks the user to disambiguate when confidence is low.

Implementation: indexed digest of every element in the deck — type + name + first text run + position quadrant — searched by BM25 + light embedding. Refreshed on element change, cheap.

This is the single highest-leverage piece of agent infrastructure. Every edit that isn't on a pre-selected element flows through it.

### 3.3 Planning

The planner sees:
- The user's prompt verbatim
- The selected element (if any), as JSON dump truncated to ~1KB
- A deck digest: slide count, slide titles, element types per slide (~2KB cap)
- The full API manifest summary (or top-k retrieved if measured to be necessary)
- The deck's `theme_colors`
- The agent rules (system prompt below)

Output: a JSON array of tool calls *or* one of: `{clarify: "..."}`, `{find_element: "..."}`. Order matters; executor runs sequentially.

### 3.4 System prompt rules (verbatim seed)

> You are the Percy editing agent. You translate user instructions into precise sequences of HTTP calls against the studio API.
>
> 1. Use only endpoints that appear in the manifest. Never invent paths.
> 2. If the target element is ambiguous, call `find_element` before planning the edit.
> 3. Plan the smallest patch. "Make the revenue line bold" patches that one series, not all series.
> 4. Prefer `scheme:` colors when the deck has a theme — this preserves brand.
> 5. If a step might be destructive or affect many elements, set `confirm: true`. The executor will gate.
> 6. Respect `locked` elements. Surface a message rather than editing.
> 7. Bridge elements are the source of truth. Don't call rebuild/export unless asked.
> 8. On ambiguity with multiple plausible interpretations, ask one specific question via `clarify`.

### 3.5 Color coercion

`ColorSpec` supports `#RRGGBB`, `scheme:ACCENT_1`, plus seven OOXML modifiers (`lum_mod`, `tint`, `shade`, `alpha`, `hue_mod`, `sat_mod`, `lum_off`). The agent should not learn this surface.

Add a server-side coercion helper: accepts `"red"`, `"#FF0000"`, `"accent1"`, `"accent1 +20%"` (lighter), `"accent1 -30%"` (darker), `"primary"`, `"warning"`, `"text"`, etc. Coerces to `ColorSpec` using the deck's `theme_colors`. Every endpoint that takes a color routes through this.

Drops the planner branching factor on color by ~10x.

---

## 4. Skill 2 — Coder

The coder skill generates and edits Python: per-element connect scripts, slide-level scripts, and adapters between user-uploaded code and Bridge elements.

### 4.1 Where scripts live

| Scope | Storage | Status |
|---|---|---|
| Per-element connect | `el.custom_properties["connect"] = {script, inputs, updated_at}` | exists |
| Slide-level | `BridgeSlide.script` (new first-class field) | **add** |
| Project-level helpers | project files surfaced via supplementary-materials pipeline (§6) | **add** |

Don't bury slide scripts in `custom_properties` — make them a first-class field for clarity, type-safety, and serialization.

### 4.2 Slide script runtime contract

Two options were considered:
1. **Pure transform**: returns `{hide: [...], show: [...], updates: {element_id: {patch}}}`.
2. **API caller**: receives a `studio` client and calls the same typed APIs the agent calls.

**Choose (2).** The slide script becomes "an agent action authored in Python" and reuses the audit/snapshot/rollback machinery. One mental model. A slide script that hides element X writes the same audit row as the agent hiding element X.

```python
# slide_script signature
def run(slide, doc, inputs, studio):
    # studio.elements.patch(slide_n, element_id, {...})
    # studio.elements.hide(...), studio.find(...), etc.
    # return value optional; mutations happen via studio
    ...
```

### 4.3 Script execution sandbox

The current connect runner is a `_user_main()` subprocess with stdin JSON, 10s timeout, no network/secret/import gating. That's fine for read-only chart-shaping but insufficient for slide scripts that pull from a warehouse.

Extend the runner with a per-script **scope manifest:**

```json
{
  "network":   {"egress": ["snowflake.example.com:443"]},
  "secrets":   ["SF_USER", "SF_PASSWORD"],
  "file_reads":["/data/inputs/"],
  "timeout_s": 30,
  "memory_mb": 512
}
```

Default: no network, no secrets, 10s timeout. User explicitly grants additional scope per-script. The agent surfaces the requested scope in the plan-preview UI; user confirms before save.

### 4.4 The `percy.bridge.script_api` SDK

Inside scripts, expose a thin SDK rather than raw dataclasses:

```python
chart.set_series("Revenue", values=df["rev"].tolist(), color="accent1")
chart.bind(df, category="Quarter")
chart.set_title("Q4 Revenue")
table.set_cells(df, header=True, style="banded")
slide.hide("title-2"); slide.show_only(["chart-1"])
slide.find("revenue chart")  # by description
```

Same names as the API manifest. Two benefits:
- Agent-generated scripts are short and unambiguous.
- Decouples scripts from internal Bridge schema changes — if `BridgeChart` adds a field tomorrow, scripts don't break.

The SDK lives in `src/percy/bridge/script_api/` and is the *only* Bridge surface scripts see. Internally it calls the typed API.

### 4.5 Validation pipeline

Every coder output runs through:
1. **Lint** (ruff, fast subprocess)
2. **Import allowlist** (no `os.system`, no raw `subprocess` from user code unless scope grants it)
3. **Dry-run** in the sandbox with mock or saved `inputs`
4. **Schema check** — does the script's return / mutations match the bound element's expected shape? Catches "plausible but wrong-shaped" bugs.
5. **Diff preview** — what would the rendered slide look like vs current?

Save is gated behind a confirm with the diff visible.

### 4.6 Caching

Scripts that touch external systems must cache. Bind output to the element's data with `last_run_at` + `inputs_hash`. Re-execute only on:
- Explicit refresh
- `inputs` change
- Scheduled refresh (Phase 2)

Otherwise opening a 50-slide deck = 50 warehouse queries. Hard requirement.

---

## 5. Creation infrastructure (prerequisite)

Today's `POST /elements` only spawns `BridgeShape`. There is no path to create charts, tables, or connectors from scratch. **This must land before the agent ships create flows.**

### 5.1 Two-tier endpoints

For each rich element type, two endpoints:

| Tier | Purpose | Caller | Schema |
|---|---|---|---|
| `create_thin` | Minimal intent → defaults → dataclass | Agent + templates | Small |
| `patch_rich` | Full granular edit (already exists) | Refinement | Large |

Agent's typical flow: `create_thin` → `patch_rich` for follow-up details. Same pattern a user would do by hand: drop the chart, then tweak.

### 5.2 What to build

```
POST /api/docs/{doc_id}/slides/{n}/elements/chart
  body: {chart_type, categories, series:[{name, values, color?}], title?, position?}

POST /api/docs/{doc_id}/slides/{n}/elements/table
  body: {n_rows, n_cols, data?, first_row_header?, banded_rows?, style_preset?, position?}

POST /api/docs/{doc_id}/slides/{n}/elements/connector
  body: {connector_type, start:{x,y}, end:{x,y}, line?:{color, width, dash, head_end, tail_end}}

POST /api/docs/{doc_id}/slides/{n}/elements/text
  body: {text, font?, size?, color?, bold?, align?, position}

# already exists, expose under unified create_* family in manifest:
POST /api/docs/{doc_id}/slides/{n}/elements/image
POST /api/docs/{doc_id}/slides/{n}/elements   (BridgeShape)
```

Each accepts *minimal intent* and an internal builder fills the dataclass tree. `create_chart` leaves `reconstruction_blobs`, `overlay_files`, `embedded_workbook_bytes` as `None` — verified that the Recharts renderer, matplotlib renderer, and `rebuild_pptx` all work without them for common chart types (column, bar, line, pie, area; verified 2026-05-04).

### 5.3 What we are not building

**No agent-driven `BridgeFreeform` creation.** Raw `geometry_xml`, EMU-coordinate `PathCommand` lists, and `style_xml` are not LLM-friendly outputs. Instead, ship a small library of preset freeforms (arrows, callouts, ribbons, badges) and a `freeform.create_preset` endpoint that picks by name. Arbitrary path generation is a stretch goal.

### 5.4 Templates (multi-element creation)

A template is the unifying primitive for everything beyond single-element creation:

```
Template = {
  layout:          [element_create_call, ...],   # multi-element layout
  connects:        {element_alias: script},      # bound data scripts
  slide_script:    str?,                         # optional slide-level
  inputs_schema:   {name: type, ...},            # what the user must supply
  sample_inputs:   {...},
  provenance:      ["uploads/monthly_pull.py", ...],
}
```

Template materialization:
1. Agent retrieves matching template
2. Calls `create_thin` for each element in `layout`
3. Attaches bundled `connects`
4. Sets `slide_script`
5. Asks user for declared `inputs` (or auto-fills from supplementary code)
6. Runs once, shows rendered diff, gates save

This single primitive ties creation, scripts, and supplementary materials into one story. It's also the on-ramp to the pitch-deck "team agentic memory" claim — every saved template is a piece of organizational reporting structure.

Templates are scoped: project-private, org-shared, public. Phase 1: project-private only.

---

## 6. Supplementary materials pipeline

When the user uploads `monthly_pull.py`, `helpers.py`, a CSV, etc., the agent treats them as a per-project code corpus.

### 6.1 Upload pipeline

```
upload → security pre-pass → chunk → embed → index
                ↓
           rejection / redaction / flagging
```

**Security pre-pass (mandatory):**
- Plaintext secret detection (regex + entropy). Hard reject if found, with a redaction option.
- Dangerous-import flag (`subprocess`, `socket`, `eval`, `exec`, `open` with absolute paths). Soft flag — included in the file metadata.
- Prompt-injection scan on string literals (Phase 1.5; an LLM check for "ignore previous instructions"-style content).

Without this pass, a user uploads a script with `DB_PASSWORD = "xxx"` on line 3 and the agent regurgitates it into a generated script. Non-negotiable.

### 6.2 File usage flags

Two flags per file:
- `usable_as_reference` — agent can read it for context. On automatically after security pre-pass.
- `usable_as_starter` — agent can copy/adapt code from it. User opts in per file.

Distinction matters for audit: when a generated connect was adapted from `pull_revenue.py`, the audit row records the source.

### 6.3 The "fill in the gaps" workflow

The flagship coder demo:

> User: *"Here's our `monthly_pull.py`. Connect this chart to the revenue series."*

1. Coder reads the chart's expected shape (`categories: list[str]`, `series: [{name, values}]`).
2. Coder retrieves relevant chunks from the upload (the `fetch_revenue` function and its return shape).
3. Coder generates a thin adapter script.
4. Validator lints, dry-runs with sample inputs, schema-checks the output against chart shape.
5. UI shows: source code, dry-run output, before/after chart preview.
6. User confirms; connect saved; chart re-renders.

This workflow is the killer demo. It is also concrete enough to build today on top of the existing connect runner once the upload pipeline lands.

### 6.4 Three corpora, one retrieve call

The planner needs to pull from three indexes:
- API manifest (Editor)
- Templates (Creation)
- Project supplementary code (Coder)

Keep them as separate indexes (different shapes, different versioning) but unify behind a single `retrieve(prompt, scope)` that fans out and returns a typed mix:

```json
{
  "endpoints": [...],
  "templates": [...],
  "code_chunks": [...]
}
```

Planner sees a coherent menu. Skill router uses the result to decide Editor vs Coder vs Hybrid.

---

## 7. Audit, rollback, security

### 7.1 The `agent_actions` table

```
id, user_id, doc_id, slide_n, element_id?,
kind        (edit | code | hybrid),
endpoint_id (or 'connect.set' / 'slide_script.set'),
request_body, response, status,
snapshot_id (FK — the doc snapshot taken before this invocation),
provenance  (uploaded files referenced, template id, etc.),
created_at
```

One row per agent invocation, not per executed call. Rolls up the whole plan.

### 7.2 Rollback

Each agent invocation = one doc snapshot. Audit row points to it. Rollback restores the snapshot. **One mechanism, one button.**

The existing `_snapshot_doc` helper + `POST /api/docs/:id/undo` machinery already do this; the agent invocation just needs to write a snapshot id into the audit row.

### 7.3 Security

The Security & Trust section of the enterprise vision becomes load-bearing here:
- **Sandboxed execution** for connects and slide scripts (subprocess + scope manifest from §4.3).
- **Secret isolation** — secrets are not in script source; they're injected as env vars by the runner from a per-project secret store. Phase 1: dev-only secrets via local SQLite-encrypted store; Phase 2: cloud KMS.
- **Prompt-injection guardrails** — scan supplementary uploads (§6.1); strip suspicious instruction-like content from any user file before LLM context inclusion.
- **Audit log retention** — agent_actions retained per-org policy (default: 90 days).

### 7.4 Telemetry

`agent_actions` is the audit log; `agent_telemetry` is the learning loop:

```
prompt, retrieved_endpoints, plan, validation_result,
executed, error?, user_followup_correction?, latency_ms
```

Local-only by default, opt-in for cloud aggregation. Without this from day 1, you can't improve retrieval, prompts, or manifest summaries empirically.

---

## 8. UI surface

`StudioAgent.tsx` extends from one chat tab to a richer panel:

- **Chat** — same conversational surface; messages now include plan cards and script previews inline.
- **Plan preview** — for any non-trivial plan: the proposed actions with a Run button. Auto-execute single-step, non-destructive, low-blast-radius plans; preview the rest. Always-preview is a user toggle.
- **Code preview** — for coder outputs: source, lint, dry-run, schema check, before/after element render. Save behind confirm.
- **Activity** — chronological audit; rollback button per entry.
- **Connects** — already exists; extend to show slide scripts.
- **Materials** — uploaded supplementary files; security flags visible; `usable_as_starter` toggles.
- **Templates** — saved templates; retrieval and apply.

New components:
- `AgentPlanCard.tsx` — renders a plan with confirm/run/edit affordances.
- `AgentCodePreview.tsx` — source + lint + diff + dry-run output.
- `MaterialsPanel.tsx` — uploads, flags, redaction display.

---

## 9. Phased delivery plan

Each phase is independently demoable and useful even if the next never ships.

### Phase 0 — Prerequisites (creation infra)

- [ ] `create_thin` endpoints: `chart`, `table`, `connector`, `text`
- [ ] ColorSpec string-coercion helper, applied to all color args across endpoints
- [ ] `BridgeSlide.script` first-class field + serialization round-trip
- [ ] Manifest expansion to ~120 endpoints; CI parity check vs `app.routes`
- [ ] `agent_actions` + `agent_telemetry` SQLite tables

**Demo:** create a chart from scratch via direct API; via the existing chat tool-use; round-trip a slide script.

### Phase 1 — Editor skill

- [ ] `find_element` tool + per-deck element digest index
- [ ] Planner replaces current `chat()` tool-use; full manifest, no retrieval yet
- [ ] Plan-preview UI with auto-execute heuristic
- [ ] Blast-radius confirmation gating
- [ ] Snapshot-per-invocation rollback wired through audit log
- [ ] One-shot error retry with error context

**Demo:** the three flagship workflows from the macro doc:
- *"Make the title bold and dark blue."*
- *"Change the chart's revenue series color to red and add data labels."*
- *"Insert a row between rows 2 and 3 with values: Q5, 100, 200, 300."*

### Phase 1.5 — Measure & optimize

- [ ] Compare full-manifest vs top-k retrieval on a benchmark of 30 prompts
- [ ] Add retrieval index only if quality/latency demand it
- [ ] Tune system prompt from telemetry

**Demo:** quality and cost dashboards.

### Phase 2 — Coder skill

- [ ] `percy.bridge.script_api` SDK
- [ ] Sandbox extended with scope manifest (network, secrets, timeout)
- [ ] Lint + dry-run + schema-check validation pipeline
- [ ] Slide-script runtime via the `studio` client
- [ ] Coder planner with code-preview UI

**Demo:** *"Write a slide script that hides any element with empty bound data."*

### Phase 3 — Supplementary materials & "fill in the gaps"

- [ ] Materials upload + security pre-pass + redaction
- [ ] Per-project chunk/embed index
- [ ] Coder retrieval pulls from materials corpus
- [ ] `usable_as_starter` flag respected in audit

**Demo:** *"Here's our `monthly_pull.py`. Connect this chart to the revenue series."* — the killer demo.

### Phase 4 — Templates

- [ ] Template schema + storage
- [ ] Template materialization flow
- [ ] Template authoring UI (save current slide as template)
- [ ] Template retrieval in the unified `retrieve()`

**Demo:** *"Make me a quarterly revenue review using the board template."*

### Phase 5 — Refresh agent (autonomous, scheduled)

- [ ] Scheduler integration with the existing snapshot/diff machinery
- [ ] Refresh-and-summarize flow ("here's what changed since last week")
- [ ] Multi-step plans with checkpoints

**Demo:** every Monday morning, the deck refreshes itself and posts a summary of changes.

---

## 10. Open questions

These need owner decisions before later phases lock in:

1. **Embedding provider.** OpenAI `text-embedding-3-small` vs local sentence-transformers. Recommend OpenAI for Phase 1.5 (better quality, no infra), local for offline/desktop later. Anthropic ships no embeddings — `claude-3-haiku-20240307` is not an embedding model despite its mention in the macro doc.

2. **Secrets backend for Phase 2.** Local SQLite-encrypted store with passphrase? OS keychain? We already have an auth model — does it extend?

3. **Slide-script schedule storage and runner.** Where do scheduled jobs live? Same SQLite, or a dedicated worker queue? The AWS deployment already has SQS + ECS worker — leverage those for cloud, fall back to in-process scheduler for desktop.

4. **Templates cross-project visibility.** Phase 4 ships project-scoped only. Org-shared and public templates need a sharing UI + permissions story; punt to Phase 4.5.

5. **Multi-element scope for Editor.** The studio supports `multiSelectIds`. Should the agent treat multi-select as implicit bulk? Recommend: yes — implicit bulk on multi-select, explicit "all" requires confirm.

6. **Model split.** Router = haiku. Editor planner = sonnet. Coder planner = sonnet (longer context, code quality matters). Validator/lint = local. Worth measuring opus on the coder for the "fill in the gaps" workflow specifically — code generation quality differential may be worth the cost.

---

## 11. Acceptance criteria

The agent is "done" for v1 (post-Phase 3) when:

1. Every Bridge element field with an API can be edited via natural-language prompt.
2. Every Bridge element type (except freeform) can be created from scratch via prompt.
3. Slide scripts can be authored and run safely with scope-limited sandboxing.
4. Supplementary code uploads pass security pre-pass and are retrievable as context.
5. The "fill in the gaps" demo runs end-to-end on a real warehouse-pull script.
6. The activity log shows chronological history with one-click rollback.
7. Confirmation modals appear for destructive or high-blast-radius plans.
8. Telemetry captures the full `(prompt, retrieved, plan, outcome)` tuple per invocation.

Phase 4 (templates) and Phase 5 (refresh) are post-v1.

---

## 12. Future readers

If you're a maintainer years from now: this blueprint replaced `docs/percy-agent-macro.md` in 2026-05-04 once the Bridge schema, connect runtime, and create gap were properly understood. The agent is two skills (Editor + Coder) over three corpora (manifest + templates + materials), unified by one router and one rollback mechanism. If the architecture has shifted since, update this doc — don't let it rot. The whole point is that the studio's typed API surface is the agent's source of truth, and this document is the index to it.
