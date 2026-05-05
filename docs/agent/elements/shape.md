# BridgeShape — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeShape`
**Today's create endpoint:** `POST /api/docs/{doc_id}/slides/{n}/elements` (limited — only shape_type + position + fill)

## What it is

A geometric shape on a slide: rectangle, oval, arrow, callout, text-box, any of the OOXML preset geometries. Carries fill, line/border, optional text content, shadow.

## Anatomy

```
BridgeShape
├── position             Position(left, top, width, height)  — inches
├── transforms           Transform(rotation, flip_h, flip_v)
├── stacking             Stacking(z_index)
├── identification       Identification(slide_number, shape_name, shape_id, group_id)
├── accessibility        Accessibility(alt_text)
├── shape_identification ShapeIdentification(shape_type, geometry_preset, geometry_adjustments)
├── fill                 ShapeFill(fill_type, color, transparency, gradient_*, pattern_preset, bg_color)
├── line                 ShapeLine(visible, color, width, dash_style, head_end, tail_end, head_size, tail_size)
├── borders              ShapeBorders(all/left/right/top/bottom/diagonals — dict-based, edit-only)
├── text_content         ShapeTextContent(has_text, text_content, paragraphs)
├── text_frame           ShapeTextFrame(vertical_anchor, word_wrap, text_insets, autofit_type, anchor_center)
├── shadow               ShapeShadow(has_shadow, blur, distance, direction, color, alpha, align)
└── custom_properties    dict — connect script lives here
```

## Required for creation

| Field | Type | Notes |
|---|---|---|
| `position` | `{left_in, top_in, width_in, height_in}` | inches; slide is typically 13.333 × 7.5 |
| `geometry_preset` | string | `"rect"`, `"roundRect"`, `"ellipse"`, `"triangle"`, `"rightArrow"`, `"chevron"`, `"star5"`, `"cloud"`, etc. (OOXML preset names). Default `"rect"`. |

## Optional for creation (smart defaults)

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | `""` | inserted as single paragraph, single run |
| `fill_color` | color string | `"accent1"` if theme present, else `"#3B82F6"` | passed through coercion helper |
| `fill_type` | `"solid"` `"gradient"` `"none"` | `"solid"` | |
| `border_color` | color string | None | |
| `border_width` | float (pt) | 0 (no border) | |
| `border_dash` | string | `"solid"` | |
| `text_color` | color string | auto contrast vs fill | |
| `font_name` | string | inherits theme body font | |
| `font_size` | float (pt) | 18 | |
| `font_bold` | bool | False | |
| `text_align` | `"left"` `"center"` `"right"` `"justify"` | `"left"` | |
| `vertical_align` | `"top"` `"middle"` `"bottom"` | `"middle"` | |
| `rotation` | float | 0 | degrees |
| `shadow` | `{blur, distance, direction, color, alpha}` or `false` | None | |
| `name` | string | `f"Shape {shape_id}"` | display name |
| `alt_text` | string | None | |
| `z_index` | int | next available | |

## Edit-only (not for creation)

- Per-side `borders` (use `border_*` for the unified case at create; edit per-side later)
- `gradient_stops` (edit-only; create accepts `fill_color` + optional `fill_type:"gradient"` + simple two-stop gradient via `gradient_to`)
- `text_insets` (edit-only)
- `pattern_preset` (edit-only)
- `flip_h`, `flip_v` (edit-only)

## Gotchas

- **Text-boxes are shapes too.** A text-box is a `BridgeShape` with `geometry_preset="rect"` and `fill_type="none"`. Creation should accept `text_box: true` as a shorthand that sets these.
- **Arrows have `head_end`/`tail_end` on `line`, not on shape itself.** When `geometry_preset` is an arrow preset, decoration is in the geometry; `line.head_end/tail_end` only apply to actual line/connector shapes.
- **`borders` dict vs `line` field.** `BridgeShape.line` is the *outline* of the shape geometry. `BridgeShape.borders` is a dict keyed by side, used mostly by tables and complex shapes. For agent creation, use `line` for the outline; ignore `borders`.
- **Geometry adjustments** (`geometry_adjustments`) shape modifiers like roundRect corner radius. Not exposed on creation in v1; defaults are used.

## Example payload

```json
POST /api/docs/{doc_id}/slides/3/elements/shape
{
  "geometry_preset": "roundRect",
  "position": {"left_in": 1.0, "top_in": 1.5, "width_in": 4.0, "height_in": 2.5},
  "fill_color": "accent1",
  "border_color": "accent1 -30%",
  "border_width": 1.5,
  "text": "Q4 Revenue",
  "text_color": "white",
  "font_size": 24,
  "font_bold": true,
  "text_align": "center",
  "vertical_align": "middle",
  "shadow": {"blur": 8, "distance": 4, "direction": 90, "color": "#000000", "alpha": 0.3},
  "name": "Hero Card"
}
```

```json
POST /api/docs/{doc_id}/slides/3/elements/text   // shorthand
{
  "text": "Quarterly Revenue Review",
  "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 1.0},
  "font_size": 32,
  "font_bold": true,
  "text_color": "text"
}
// internally creates a BridgeShape with text_box=true, fill_type=none, geometry=rect
```
