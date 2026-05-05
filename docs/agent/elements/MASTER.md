# Bridge Elements — Master Capability Spec

**Purpose:** the consolidated capability surface for agent-driven creation and editing of every Bridge element type. Per-element specs are siblings; this doc captures cross-cutting conventions, the unified API surface, and the agent contract.

**Companion docs:**
- `shape.md` · `text.md` · `image.md` · `chart.md` · `table.md` · `connector.md` · `freeform.md` · `group.md`
- `../../percy-agent-blueprint.md`
- `../../../app/backend/agent_manifest.py`

---

## 1. Element type matrix

| Type | `create_thin` | Rich PATCH | Native renderer | PPTX export | Agent priority |
|---|---|---|---|---|---|
| BridgeShape | ✓ existing (extend) | ✓ | (uses PNG) | ✓ | high |
| BridgeText | ✓ via shape `text_box=true` | ✓ | (uses PNG) | ✓ | high |
| BridgeImage | ✓ existing (formalize) | ✓ | ✓ | ✓ | high |
| BridgeChart | **new** | ✓ | ✓ Recharts | ✓ | high |
| BridgeTable | **new** | ✓ | (Phase 2 native) | ✓ | high |
| BridgeConnector | **new** | ✓ | (Phase 2 SVG) | ✓ | medium |
| BridgeFreeform | preset-only | ✓ | (PNG fallback) | ✓ | low |
| BridgeGroup | via `group_elements` | n/a | n/a | ✓ | low |

---

## 2. Cross-cutting conventions

### 2.1 Position

Every element accepts:
```json
"position": {"left_in": 1.0, "top_in": 1.5, "width_in": 4.0, "height_in": 3.0}
```

- All values in inches.
- Default slide is 13.333 × 7.5 (16:9). Builders clamp out-of-bounds positions and warn.
- `width_in` / `height_in` may be omitted on `BridgeImage` (derives from natural size at 96 DPI).

### 2.2 Color

Every color-accepting field on every endpoint accepts the same string-coercion grammar:

| Form | Example | Resolves to |
|---|---|---|
| Hex | `"#3B82F6"` `"#3B82F6CC"` | `ColorSpec(value="#3B82F6", alpha=…)` |
| Named | `"red"` `"blue"` `"white"` `"black"` `"gray"` `"transparent"` | hex |
| Theme accent | `"accent1"` … `"accent6"` | `ColorSpec(value="scheme:ACCENT_1")` |
| Theme semantic | `"text"` `"muted"` `"good"` `"warn"` `"bad"` `"primary"` `"background"` | scheme color or sensible default |
| Modifier | `"accent1 +20%"` (lighter) `"accent1 -30%"` (darker) | `lum_mod`/`shade` modifier |
| Alpha | `"accent1 @50%"` | `alpha=50000` |
| Combined | `"accent1 +20% @80%"` | both |
| `null` / `""` | clear color | `None` |
| Direct ColorSpec dict | `{"value":"#FF0000","alpha":50000}` | passthrough |

The coercion module (`src/percy/bridge/colors.py`) is the single point of truth. Every endpoint that takes a color routes through `coerce_color(value, theme_colors)`.

### 2.3 Naming and identification

- `name` is optional everywhere; defaults to `f"{Type} {id}"`.
- `shape_id` (numeric) is auto-assigned per slide as `max(existing) + 1`.
- `element_id` (string id used by the API) is the runtime identifier; created elements return their `element_id` in the response.

### 2.4 Z-index

- `z_index` is optional; defaults to `max(existing) + 1` (new elements appear on top).
- Insertion order in `slide.elements` is preserved as a tiebreaker.

### 2.5 Theme awareness

The builder receives `doc.theme_colors` and uses it for:
- Color string resolution (§2.2)
- Default font selection (chart titles, table headers — falls back to Inter/Calibri)
- Auto-palette for chart series

When a deck has no theme, sensible web-safe defaults are used (#3B82F6 accent, #1E293B text, etc.).

---

## 3. Unified API surface (Phase 0 deliverable)

All under `POST /api/docs/{doc_id}/slides/{n}/elements/{type}`:

```
POST .../elements/shape       — BridgeShape (geometry_preset or text_box)
POST .../elements/text        — alias → shape with text_box=true
POST .../elements/image       — BridgeImage (multipart or url)
POST .../elements/chart       — BridgeChart
POST .../elements/table       — BridgeTable
POST .../elements/connector   — BridgeConnector
POST .../elements/freeform    — BridgeFreeform (preset-only)
```

Plus existing endpoints (kept):
```
POST .../slides/{n}/group-elements        — wrap existing into BridgeGroup
POST .../slides/{n}/elements/{id}/ungroup — unwrap
POST .../slides/{n}/apply-layout          — multi-shape layout preset (existing)
```

**Common response shape:**
```json
{
  "element_id":   "abc123",
  "type":         "BridgeChart",
  "slide_n":      3,
  "name":         "Quarterly Performance",
  "position":     {"left_in":1, "top_in":1.5, "width_in":8, "height_in":5},
  "z_index":      4,
  "snapshot_id":  "snap_xyz789"
}
```

The `snapshot_id` is the doc snapshot taken before the create — used for one-button rollback.

**Common error shape:**
```json
{
  "detail": "table builder rejected: cols (5) does not match data row width (4)",
  "code":   "builder_validation",
  "field":  "data"
}
```

---

## 4. The builder layer

Internal-only Python module, `src/percy/bridge/builders.py`:

```python
from percy.bridge import builders

shape  = builders.build_shape(intent_dict, theme_colors)         # → BridgeShape
text   = builders.build_text(intent_dict, theme_colors)          # → BridgeShape (text_box)
chart  = builders.build_chart(intent_dict, theme_colors)         # → BridgeChart
table  = builders.build_table(intent_dict, theme_colors)         # → BridgeTable
conn   = builders.build_connector(intent_dict, theme_colors,
                                  lookup_element=lambda eid: ...)  # → BridgeConnector
free   = builders.build_freeform(intent_dict, theme_colors)      # → BridgeFreeform
image  = builders.build_image(intent_dict, image_bytes)          # → BridgeImage
```

Each builder:
1. Validates required fields, raises `BuilderError` with structured messages on failure.
2. Coerces color strings via `colors.coerce_color`.
3. Applies sensible defaults from theme + intent context.
4. Returns a fully-populated dataclass tree.

The builders are pure functions over their inputs. Endpoint handlers call them and append the result to `slide.elements`. This split makes builders unit-testable without spinning up FastAPI.

---

## 5. Agent contract

### 5.1 What the agent sees

For each element type the agent gets, in the manifest:
- `id` — e.g. `"chart.create"`
- `summary` — one sentence for retrieval
- `applies_to` — `["BridgeChart"]` (creation endpoints apply to a *type*, not an existing element)
- `args` — the create body schema with one-line per-field descriptions
- `examples` — natural-language phrasings ("create a bar chart of revenue", "make a 4-row table", "draw an arrow from A to B")
- `destructive: false` — creation is non-destructive (rollback is one snapshot away)

### 5.2 What the agent should not see

The full Bridge dataclass schema. Agent emits intent JSON only; the builder owns the dataclass shape. This is the entire reason the builder exists — to keep the agent's branching factor manageable.

### 5.3 Common agent mistakes the builders catch

- Off-grid positions (>13.333" wide on a 16:9 slide) — clamp + warn
- Empty `series` on a chart — reject
- Mismatched `data` shape on a table — reject with row/col counts shown
- Unsupported `chart_type` — list supported types in the error
- Color strings that don't resolve — fall back to default + add to response warnings
- Missing required arrowhead config when `connector_type` implies one — silently use defaults

---

## 6. What's not in v1

These are deliberate cuts to ship Phase 0 cleanly:

- **Live element-anchored connectors** (Phase 2 — `connections` map + render-time resolution)
- **Image generation from prompts** (Phase 1.5 — gated provider integration)
- **Project-asset references** (Phase 3 — needs the materials pipeline)
- **Cell merges in tables on create** (post-create via rich PATCH)
- **Multi-paragraph cells in tables on create** (post-create via rich PATCH)
- **Custom freeform paths from natural language** (Phase 2+ — preset-only for now)
- **Nested groups** (out of scope; flat groups only)
- **Conditional formatting on tables** (Phase 2)

---

## 7. Validation strategy

Every builder runs through:

1. **Schema check** (Pydantic-style — required fields present, types correct)
2. **Semantic check** (chart_type valid, table data rectangular, connector endpoints sensible)
3. **Theme/coercion** (colors resolved against theme; warnings collected)
4. **Position normalize** (clamp to slide bounds, warn)
5. **Build** (produce dataclass tree)

Validation errors → 400 with structured detail. Warnings → response includes `warnings: [...]`.

---

## 8. Testing pyramid

For Phase 0 acceptance:

- **Unit tests** per builder: required-field validation, default population, coercion correctness
- **Round-trip tests**: create via API → render PNG → matplotlib doesn't error → re-PATCH → re-render
- **PPTX export round-trip**: create → export → re-onboard → assert structured fields preserved (chart_type, categories, series values; table data, header flags; shape geometry, fill)
- **LM Studio smoke test**: hit local Gemma with the manifest + a creation prompt; verify the produced JSON validates and creates a renderable element

---

## 9. Phase ordering recap

Phase 0 (this work):
- ColorSpec coercion module
- Builder module
- All 6 create endpoints (shape, text→shape, image, chart, table, connector)
- Freeform-preset stub (preset library can grow over time)
- Agent manifest entries for `*.create`
- Smoke + round-trip tests
- LM Studio integration test

Then Phase 1 (Editor skill — separate work stream).
