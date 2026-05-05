# BridgeConnector — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeConnector`

## What it is

A line connecting two points or two elements. Three flavors: straight, elbow (bent at right angles), curved. Optional arrowheads on either end.

## Anatomy

```
BridgeConnector
├── (BridgeElement base)
├── connector_type    "straight" | "elbow" | "curved"
├── endpoints         ConnectorEndpoints(start_x, start_y, end_x, end_y)   — inches, slide-space
└── line              ShapeLine(visible, color, width, dash_style,
                                head_end, tail_end, head_size, tail_size)
```

## Required for creation

Two ways to specify endpoints:

**Absolute coordinates:**
```json
{"start": {"x_in": 1.0, "y_in": 2.0}, "end": {"x_in": 5.0, "y_in": 4.0}}
```

**Element anchors (preferred when connecting elements):**
```json
{"start": {"element_id": "abc", "anchor": "right"},
 "end":   {"element_id": "xyz", "anchor": "left"}}
```

Anchor values: `"top"`, `"bottom"`, `"left"`, `"right"`, `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, `"center"`.

The builder resolves element anchors → coordinates at create time. (Live re-anchoring on element move is Phase 2; v1 captures coordinates once.)

## Optional for creation

| Field | Default | Notes |
|---|---|---|
| `connector_type` | `"straight"` | |
| `color` | `"text"` | |
| `width` | 1.5 | points |
| `dash_style` | `"solid"` | `"solid"` `"dash"` `"dot"` `"dashDot"` `"longDash"` |
| `head_end` | None | arrowhead on tail (start→end direction) |
| `tail_end` | None | arrowhead on head |
| `head_size` | `"medium"` | `"small"` `"medium"` `"large"` |
| `tail_size` | `"medium"` | |
| `name` | `"Connector {id}"` | |

Arrowhead types (`head_end` / `tail_end`):
`"none"`, `"triangle"`, `"stealth"`, `"diamond"`, `"oval"`, `"arrow"`.

## Edit-only

- `transforms.flip_h/v` (counterintuitive on connectors; use coordinate swap)
- Connector `position` is derived from endpoints; do not set directly

## Gotchas

- **`position` is derived** from `endpoints` (bounding box of start and end). The builder computes it; clients should not pass `position` for connectors.
- **`elbow` connectors** with the same start_y and end_y degenerate to straight. Builder warns.
- **Anchor resolution captures coordinates at create time** — moving the connected elements later does not update the connector. Live anchors come in Phase 2 with a `connections` map on the connector storing element ids + anchor names, applied on render.
- **Theme color for connectors** defaults to `"text"` (resolves to a tx scheme color), not accent — diagrammatic lines should be neutral.

## Example payloads

```json
// Absolute
POST /api/docs/{doc_id}/slides/4/elements/connector
{
  "connector_type": "straight",
  "start": {"x_in": 2.0, "y_in": 3.5},
  "end":   {"x_in": 6.0, "y_in": 3.5},
  "head_end": "triangle",
  "color": "accent1",
  "width": 2.0
}
```

```json
// Element-anchored elbow
POST /api/docs/{doc_id}/slides/4/elements/connector
{
  "connector_type": "elbow",
  "start": {"element_id": "shape-1", "anchor": "right"},
  "end":   {"element_id": "shape-2", "anchor": "left"},
  "head_end": "stealth",
  "dash_style": "dash"
}
```
