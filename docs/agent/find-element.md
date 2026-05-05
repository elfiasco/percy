# `find_element` — Agent Resolution Tool

The single highest-leverage piece of Editor-skill infrastructure. Endpoint selection is easy; *which element_id?* is the actually-hard problem. Every prompt that isn't pre-targeted (selected element via UI) flows through this tool.

**Endpoint:** `POST /api/agent/find_element`
**Module:** `app/backend/agent_find.py` (router) · `src/percy/agent/element_index.py` (index + ranker)

## Contract

### Request

```json
{
  "doc_id":   "abc123",
  "query":    "the revenue chart",
  "context": {
    "viewing_slide_n":     3,
    "selected_element_id": "el-7",
    "scope":               "current_slide",
    "element_types":       ["BridgeChart"]
  },
  "limit":           5,
  "min_confidence":  0.0,
  "include_digest":  false
}
```

| Field | Required | Notes |
|---|---|---|
| `doc_id` | yes | |
| `query` | yes | natural-language target description |
| `context.viewing_slide_n` | no | the slide the user is currently looking at — strong boost |
| `context.selected_element_id` | no | id of currently-selected element — used for "this", "it", "selected" |
| `context.scope` | no | `"current_slide"` (default if `viewing_slide_n` set) · `"deck"` · `{slides: [n,...]}` · `{range: [start, end]}` |
| `context.element_types` | no | filter — only return elements of these types |
| `limit` | no | max candidates (default 5) |
| `min_confidence` | no | drop candidates below this score (default 0.0) |
| `include_digest` | no | include the full element digest entry per candidate (debug) |

### Response

```json
{
  "candidates": [
    {
      "slide_n":    3,
      "element_id": "el-7",
      "type":       "BridgeChart",
      "name":       "Q4 Revenue",
      "text_preview": "Q4 Revenue Performance",
      "position_summary": "top-center, 8.0×5.0in",
      "score":      0.92,
      "why":        ["type matches 'chart'", "name 'revenue' matches", "on viewing slide"]
    }
  ],
  "top_score":      0.92,
  "ambiguous":      false,
  "scoped_to":      "slide 3",
  "considered":     12
}
```

| Field | Notes |
|---|---|
| `candidates` | ranked list, `len == 0` means "no match — surface clarify question" |
| `top_score` | 0–1; >0.8 = high confidence, 0.5–0.8 = medium, <0.5 = ask user |
| `ambiguous` | true when top two candidates are within 0.1 of each other |
| `scoped_to` | human-readable description of search scope |
| `considered` | total elements scored (for debug / telemetry) |

## Scoring

For each candidate element, compute a weighted sum of feature scores. Final score is normalized to 0–1.

| Feature | Weight | Notes |
|---|---:|---|
| Text match (BM25 over name + text content + type label) | 1.0 | core signal |
| Type match (query mentions "chart", "title", "table" → element is that type) | 1.0 | strong filter-y signal |
| Slide match (context.viewing_slide_n == candidate.slide_n) | 1.0 | "the title" with viewing_slide_n=3 → titles on slide 3 win |
| Slide adjacency (±1 from viewing) | 0.3 | fallback when on the right slide there's no match |
| Position quadrant match ("top right" → element in top-right quadrant) | 0.5 | |
| Selected-element same-slide bonus | 0.4 | when user has something selected, prefer same slide |
| Pronoun resolution ("this", "it", "selected") | direct return | no scoring — return the selected element if present |

Stopwords removed from query before scoring: the, a, an, this, that, it, on, in, at, of, for, to, with, by, my.

## Element digest

The index pre-computes one digest entry per element. Cheap to build and refresh.

```python
{
  "slide_n":      int,
  "element_id":   str,           # _element_id(el, idx) — same as serializer
  "type":         str,           # "BridgeChart" etc.
  "type_label":   str,           # "Chart" — friendly name from _ELEMENT_TYPE_LABELS
  "name":         str,           # identification.shape_name
  "text":         str,           # first 200 chars of element text content
  "title":        str | None,    # for charts: chart.title.title; for tables: cell[0][0]
  "data_summary": str | None,    # for charts: "categories=['Q1','Q2','Q3','Q4'], series=['Revenue','Cost']"
                                 # for tables: "5×3 with header"
  "position":     {left, top, width, height},   # inches
  "quadrant":     str,           # "top-left" | "top-center" | ... | "center"
  "z_index":      int,
  "tokens":       set[str],      # pre-tokenized for BM25
  "locked":       bool,
  "hidden":       bool,
}
```

## Index lifecycle

- Built lazily on first `find_element` call against a doc; cached in `_docs[doc_id]["_element_index"]`.
- Invalidated by any mutating endpoint that touches elements (snapshot/PATCH/DELETE/POST). Lazy: invalidation just clears the cache; the next find_element call rebuilds.
- For docs with >500 elements, this could be ~10ms to rebuild — fine for v1.

## Why not embeddings (yet)

Same reasoning as the manifest retrieval call: build it without embeddings, measure on a benchmark, only add the dependency if quality forces it. With ~50 elements per slide × 50 slides, BM25 over the digest is fast and explainable. Score breakdowns ("type matches 'chart'", "name 'revenue' matches", "on viewing slide") give the agent debuggable feedback.

If a benchmark reveals BM25 misses (e.g. semantic queries like "the visualization showing growth"), then a small embedding model joins the digest at index time and contributes a vector-similarity feature. The architecture leaves a slot for it.

## Examples

**Selected element, pronoun query:**
```
{query: "this", context: {selected_element_id: "el-7"}}
→ candidates: [{element_id: "el-7", score: 1.0, why: ["selected element"]}]
```

**Type + slide context:**
```
{query: "the chart", context: {viewing_slide_n: 3}}
→ candidates ranked by:
  type='BridgeChart' matches → +1.0
  on slide 3 → +1.0
  charts on other slides → 0.3 (adjacent boost only)
```

**Position-aware:**
```
{query: "the bottom right callout", context: {viewing_slide_n: 5}}
→ filters elements with quadrant ∈ {bottom-right, bottom-center}, then text-matches "callout"
```

**Ambiguous:**
```
{query: "the title", context: {viewing_slide_n: 3}}
→ if slide 3 has both a "Title" text-box and a chart whose title is "Q4 Performance"
  candidates: [
    {type: BridgeText, name: "Title", score: 0.85},
    {type: BridgeChart, title: "Q4 Performance", score: 0.78}
  ]
  ambiguous: true   ← planner should ask which one
```

## Agent contract

The planner's loop becomes:

1. User: "make the chart's revenue line bold and red"
2. Planner has no selected element → emits `{find_element: {query: "the chart with revenue series", context: {...}}}`
3. Server returns top candidate `{slide_n: 3, element_id: "el-7", type: "BridgeChart"}`
4. Planner now has the element_id; emits `{endpoint_id: "chart_data.patch", path_args: {doc_id, slide_n: 3, element_id: "el-7"}, body: {series: [...]}}`
5. Executor runs the patch.

Planner system-prompt rule (added to existing rules):
> When the user references an element ambiguously ("the title", "the chart", "this", "that one"), call `find_element` first to resolve. Use the user's selected element id and viewing slide number as context. If `top_score < 0.5` or `ambiguous: true`, ask one clarifying question via `clarify` instead of guessing.
