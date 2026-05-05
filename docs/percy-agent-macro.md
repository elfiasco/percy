# Percy Agent — Macro Spec

**Purpose of this document:** specify the custom Percy agent that operates inside the studio. This is the brief for the parallel Claude Code agent that is going to build it. Read this end-to-end before writing code.

The agent's job: given a free-form user instruction ("make the Q1 chart's revenue line bold and red", "rebuild slide 3 from this CSV", "tighten the agenda bullets"), figure out which Bridge-element APIs to call and call them. The studio already exposes a structured editing API across every Bridge element type. The agent's role is to translate intent into the right sequence of calls.

The architecture below is **retrieval-then-act**, not a generic tool-loop. We embed every API endpoint's description once, embed the user instruction at request time, find the top-k most relevant endpoints, and let the model plan + execute against that narrowed surface. This is faster, cheaper, and more controllable than letting an LLM see all 80+ endpoints up front.

---

## 1. Goals

1. **Coverage.** Every editable field on every Bridge element should be reachable through the agent. The agent should never have to say "I can't change that" if the API can.
2. **Grounded planning.** The agent works from a small, retrieved surface (top-k endpoints) rather than the full API. Embedding-based retrieval narrows the search before the model sees anything.
3. **Auditable execution.** Every action the agent takes is a recorded sequence of HTTP requests against the typed API. Each request can be replayed, undone, or inspected. No magic.
4. **Safety by default.** Destructive actions (delete element, delete slide, mass-style changes) require an explicit confirmation step. Connect-script execution stays sandboxed (subprocess + 10s timeout already in place).
5. **Conversational, not autonomous.** The agent assists; it does not run on a schedule unless the user opts in. Phase 1 is "ask → propose → execute → report." Phase 2 is the chained / scheduled refresh agent.

---

## 2. Architecture

```
                      ┌─────────────────────┐
   user prompt ─────► │  embedder           │
                      │  (e.g. text-embedding-3-small)
                      └──────────┬──────────┘
                                 │ query embedding
                                 ▼
                      ┌─────────────────────┐
                      │  endpoint index     │
                      │  (FAISS / sqlite)   │
                      │  pre-embedded       │
                      │  endpoint descs     │
                      └──────────┬──────────┘
                                 │ top-k endpoints
                                 ▼
                      ┌─────────────────────┐
                      │  planner            │
                      │  Claude / GPT       │
                      │  sees: prompt +     │
                      │   element context + │
                      │   top-k endpoint    │
                      │   schemas           │
                      └──────────┬──────────┘
                                 │ ordered tool calls
                                 ▼
                      ┌─────────────────────┐
                      │  executor           │
                      │  HTTP → studio API  │
                      │  audit log          │
                      │  rollback support   │
                      └─────────────────────┘
```

### 2.1 Embedding the API surface

A **manifest endpoint** at `GET /api/agent/api-manifest` returns:

```json
{
  "endpoints": [
    {
      "id":        "chart_data.patch",
      "method":    "PATCH",
      "path":      "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data",
      "summary":   "Edit chart data — categories, series values, axis bounds, legend, plot properties.",
      "applies_to": ["BridgeChart"],
      "args": {
        "categories":  { "type": "string[]",          "desc": "X-axis labels in order" },
        "series":      { "type": "ChartSeriesData[]", "desc": "All series; each has name, values, color, data labels, line, marker" },
        "title":       { "type": "ChartTitleFull?",   "desc": "Chart title text + font" },
        "value_axis":  { "type": "ChartAxisData?",    "desc": "Y-axis: min, max, gridlines, number format" },
        "legend":      { "type": "ChartLegendData?",  "desc": "Legend visibility, position, font" }
      },
      "destructive": false,
      "examples": [
        "Change the chart from quarterly to monthly categories",
        "Make the revenue line red",
        "Hide the legend"
      ]
    },
    ...
  ],
  "version": "2026-05-04"
}
```

Each endpoint has:
- A **summary** (one sentence) that is the embedded text for retrieval.
- **applies_to** — element types this works on. Used to filter endpoints by what's selected.
- **args** with one-line descriptions per field.
- **destructive** flag — gates whether the agent must confirm before calling.
- **examples** — natural-language phrases that should map to this endpoint. These are *also* embedded and indexed so multiple phrasings hit the right route.

**The agent build pipeline:**
1. On startup, fetch the manifest.
2. For each endpoint, embed `summary` + each `examples[]` entry as separate vectors (all pointing back to the same endpoint id).
3. Cache the index. Re-embed only when the manifest version changes.

### 2.2 Retrieval

```python
def retrieve(prompt: str, element_type: str | None = None, k: int = 8) -> list[Endpoint]:
    q = embed(prompt)
    hits = index.search(q, top_k=20)
    # filter by element type compatibility
    if element_type:
        hits = [h for h in hits if element_type in h.applies_to or h.applies_to == ["*"]]
    # dedupe back to endpoint ids (since each endpoint may have multiple example vectors)
    seen = set(); unique = []
    for h in hits:
        if h.endpoint_id not in seen:
            seen.add(h.endpoint_id); unique.append(h)
        if len(unique) >= k: break
    return unique
```

### 2.3 Planning

The model sees:
- The user's prompt verbatim.
- The currently selected element (if any) — a JSON dump of its Bridge state, truncated.
- The deck-wide structure summary (slide count, slide titles, element types per slide). Capped to ~2KB.
- The top-k retrieved endpoints, full schema each.
- A short system prompt with the rules (described in §3).

Output: a JSON array of tool calls. Each call has `endpoint_id`, `path_args`, `body`, and an optional `reason`. The model can also output a `clarify` field instead, which surfaces a question to the user without executing.

### 2.4 Execution

The executor:
1. Resolves `path_args` (e.g. `doc_id`, `slide_n`, `element_id`) against the current studio session.
2. Validates the body against the endpoint's `args` schema.
3. If the endpoint is `destructive: true`, surfaces a confirmation modal in the UI and pauses.
4. Issues the HTTP request with the same auth cookie as the user's session.
5. Logs the request, response, and a human-readable summary to an `agent_actions` audit table.
6. Bumps the studio refresh key on success so the canvas reloads.

### 2.5 Rollback

Every executed action gets a corresponding undo:
- For PATCH endpoints: the executor first GETs the current state, stores it in the audit row, and the rollback re-PATCHes that snapshot.
- For DELETE endpoints: the audit row stores the full element JSON before delete; rollback POSTs a recreate.
- For structural ops (insert_row, etc.): the inverse op is recorded.

There's already a `_snapshot_doc` helper that snapshots the entire doc on every PATCH. The agent's rollback can leverage that: each agent action becomes one snapshot, and `POST /api/docs/:id/undo` rolls back. Simple.

---

## 3. Agent rules / system prompt

Verbatim seed for the planner system prompt:

> You are the Percy editing agent. Your job is to translate a user's instruction into a precise sequence of HTTP calls against the Percy studio API. You see the user's prompt, the currently selected element (if any), a summary of the deck, and a small set of retrieved API endpoints relevant to the request.
>
> Rules:
> 1. Use only the endpoints provided. If none of them fit, output `{ "clarify": "..." }` and ask one specific question.
> 2. Plan before executing. Output a JSON array of tool calls. Order matters; the executor runs them in sequence and stops on first error.
> 3. Prefer the smallest possible patch. If the user says "make the revenue line bold," patch only the relevant series's line, not all series.
> 4. Never invent endpoint paths. Never call an endpoint that wasn't retrieved.
> 5. If an action is destructive (`destructive: true`), include a `confirm: true` flag — the executor will surface a confirmation modal before running.
> 6. If the user's request has multiple plausible interpretations, ask. Do not guess on ambiguous edits.
> 7. Bridge elements are the source of truth. Do not call rebuild/export endpoints unless the user explicitly asks.
> 8. Respect locked elements. If `element.locked === true`, do not edit it; surface a message.
>
> Output schema:
>
> ```
> {
>   "plan": [
>     {
>       "endpoint_id": "chart_data.patch",
>       "path_args":   { "doc_id": "...", "slide_n": 3, "element_id": "..." },
>       "body":        { "series": [...] },
>       "reason":      "Make the revenue series red and bold per user request",
>       "confirm":     false
>     }
>   ]
> }
> ```

---

## 4. Integration points

The agent lives behind the existing `POST /api/docs/{doc_id}/chat` endpoint, which already accepts `messages[]` and returns `{ reply, actions_taken }`. The new agent replaces the current Claude-tool-use implementation in `app/backend/main.py`.

**Frontend:**
- The `StudioAgent` panel's Chat tab is the primary interface.
- A new `Plan` tab shows the proposed action list with a "Run" button — turns the agent from "fire and forget" into "preview-then-execute."
- The `Activity` tab (already in StudioAgent) continues to show the audit trail.
- Confirmation prompts for destructive actions appear as modal cards inside the Chat tab, with explicit "Confirm" / "Cancel" buttons.

**Backend:**
- New module `app/backend/agent.py` containing:
  - `embed_endpoints()` — runs once at startup, populates the index.
  - `retrieve(prompt, element_type, k)` — top-k retrieval.
  - `plan(prompt, context, endpoints) -> Plan` — calls the LLM.
  - `execute(plan) -> ExecutionResult` — runs the plan, with confirmation gating.
- New table `agent_actions` (in `studio_*` schema): id, user_id, doc_id, slide_n, element_id, endpoint_id, request_body, response, status, snapshot_before, created_at.

---

## 5. What the parallel Claude Code agent should build (hand-off list)

The parallel agent — i.e. you, reading this — should deliver the following, in order:

### 5.1 Read first
- `docs/percy-mission.md`
- `docs/percy-enterprise-vision.md`
- `docs/percy-pitch-deck.md`
- This doc.
- `app/backend/main.py` (skim the API surface — chart-data, table-data, connector-data, style, text, position, connect, etc.)
- `app/backend/auth.py` (authentication model)
- `frontend/src/components/studio/StudioAgent.tsx` (current chat panel)
- `frontend/src/components/studio/ConnectModal.tsx` (existing per-element AI flow — same pattern, smaller scope)

### 5.2 Build, in this order

1. **Manifest endpoint** (`GET /api/agent/api-manifest`) — already partially done by the human (see §2.1 schema). The parallel agent should fill in every endpoint and write tight, embedding-friendly summaries.

2. **Embedding cache** — local SQLite-backed FAISS-or-equivalent index of endpoint embeddings. Use OpenAI `text-embedding-3-small` or `claude-3-haiku-20240307` for embeddings. Cache by manifest version.

3. **Retrieval API** (`POST /api/agent/retrieve`) — for testing. Body: `{ prompt, element_type? }`. Returns the top-k endpoints. Agent doesn't call this directly in prod (it's all server-side), but it's invaluable for debugging.

4. **Planner** — wraps the LLM call with the system prompt above. Replace the existing `chat()` endpoint's tool-use logic with this retrieval-then-plan flow.

5. **Executor** — runs the plan. Uses the studio's existing typed APIs. Snapshots before each call. Handles confirmation gating.

6. **Audit table + UI** — `agent_actions` table, history view in StudioAgent's Activity tab.

7. **Confirmation flow** — destructive-action confirmation modal in StudioAgent.

### 5.3 Constraints

- **Don't change the studio APIs themselves.** Those are the contract. If something can't be done with the current API, file a TODO and pause; don't add a "magic" endpoint.
- **Don't change the auth model.** All agent calls go through the same session as the user.
- **Don't change the Bridge model.** Bridge elements are the source of truth.
- **Stay in `app/backend/agent.py`** for new server code. Don't pollute `main.py`.
- **Frontend changes scoped to `StudioAgent.tsx`** and possibly a new `AgentPlanCard.tsx`. Don't touch the studio canvas.
- **No autonomous loops in phase 1.** No background polling, no scheduled refresh. The agent runs only when the user sends a message.

### 5.4 Stretch goals (Phase 2)

- **Refresh agent.** A scheduler that re-runs Connects on a cadence and uses the agent to summarize what changed.
- **Multi-step plans with checkpoints.** Long edits paused mid-plan for user approval.
- **"What should I do?" surfacing** — an idle agent that, given the deck, suggests improvements (typos, inconsistent metrics, stale data, brand violations) without being prompted.
- **Cross-deck queries.** "Has the ARR figure changed in our last 4 board decks?" — needs a corpus index across the org's documents.

---

## 6. Acceptance criteria for Phase 1

The agent is "done" for Phase 1 when:

1. Every Bridge element field that has an API can be edited via natural-language prompt.
2. The Activity tab shows a chronological audit log with rollback buttons.
3. Destructive actions trigger a confirmation modal.
4. Re-deploying the manifest doesn't require a frontend rebuild — the index re-embeds on startup.
5. Three flagship workflows pass end-to-end:
   - "Make the title bold and dark blue."
   - "Change the chart's revenue series color to red and add data labels."
   - "Insert a row between rows 2 and 3 with values: Q5, 100, 200, 300."

---

## 7. Open questions for the project owner

These need answers before the parallel agent ships:

- **Embedding provider:** OpenAI, Anthropic, or local sentence-transformers? (Local removes a dependency; hosted is faster and probably better quality.)
- **Confirmation default:** are bulk style changes destructive? (Default: yes, anything affecting >5 elements at once.)
- **Multi-element scope:** should the agent be able to operate on multiple selected elements at once, or always single-element? (Recommend: respect the studio's `multiSelectIds` — if multiple are selected, the prompt is implicitly bulk.)
- **Telemetry:** do we capture prompts and audit logs in the cloud control plane for later analysis? (Recommend: opt-in, off by default.)

---

## 8. Future readers

If you're a maintainer years from now: this document was the brief for the agent build, written when the studio first got typed editing APIs across every Bridge element type. The `chat()` endpoint at the time used Anthropic tool-use with a small fixed tool set; this spec replaced that with retrieval-then-plan. If the architecture has changed since, update this doc — don't let it rot. The whole point of the agent is that the API surface is its source of truth.
