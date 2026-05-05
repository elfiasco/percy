# BridgeText — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeText`

## What it is

A pure text container — paragraphs of runs, each run with its own font/color/style. Distinct from `BridgeShape` (which can also hold text). `BridgeText` is what onboarding produces from a PowerPoint text box that has no fill or geometry; for new creation, we route most text-box requests to `BridgeShape` with `text_box=true` for simplicity, and reserve `BridgeText` creation for the rare case the user explicitly wants the dedicated text dataclass.

**Recommendation:** ship `text.create` as a thin wrapper around `shape.create` with `text_box=true`. Don't expose a separate code path unless a real fidelity reason emerges.

## Anatomy

```
BridgeText
├── position, transforms, stacking, identification, accessibility (BridgeElement base)
├── paragraphs           list[TextParagraph]
│   └── runs             list[TextRun(text, font_name, font_size, font_bold, font_italic,
│                                     font_underline, font_color, hyperlink, is_line_break,
│                                     char_spacing, font_caps, baseline_shift, strikethrough)]
├── text_frame           TextFrame(word_wrap, autofit_type, vertical_anchor, text_direction,
│                                  font_scale, ln_spc_reduction, body_insets)
├── margins              Margins(margin_left/right/top/bottom)
├── fill_and_border      FillAndBorder(fill_color, has_fill, border_color, border_width, has_border)
├── effects              dict
├── shape_info           ShapeInfo(shape_type, is_placeholder, placeholder_type, placeholder_idx)
├── shadow               ShapeShadow
└── lst_style_xml        raw OOXML — edit-only
```

## Required for creation

| Field | Type | Notes |
|---|---|---|
| `text` | string OR list[paragraph] | single string → one paragraph, one run; list → multi-paragraph |
| `position` | `{left_in, top_in, width_in, height_in}` | |

Multi-paragraph form:

```json
"paragraphs": [
  {"text": "Heading", "font_size": 32, "font_bold": true},
  {"text": "Body line 1"},
  {"text": "Body line 2", "indent_level": 1, "bullet_type": "char", "bullet_char": "•"}
]
```

Mixed-formatting within one paragraph (rare):

```json
"paragraphs": [
  {"runs": [
    {"text": "Revenue grew "},
    {"text": "23%", "font_bold": true, "font_color": "good"},
    {"text": " year-over-year."}
  ]}
]
```

## Optional for creation

| Field | Default | Notes |
|---|---|---|
| `font_name` | theme body font | applies to all runs unless overridden |
| `font_size` | 18 (body), 32 (single paragraph >= "title" hint) | |
| `font_bold/italic/underline` | false | |
| `font_color` | `"text"` (theme-aware, defaults to dark) | |
| `text_align` | `"left"` | per-paragraph |
| `vertical_anchor` | `"top"` | `"top"` `"middle"` `"bottom"` |
| `line_spacing` | None (single) | per-paragraph |
| `space_before/after` | None | per-paragraph, points |
| `bullet_type` | `"none"` | `"char"` `"number"` `"none"` (per-paragraph) |
| `bullet_char` | `"•"` | when `bullet_type == "char"` |
| `indent_level` | 0 | per-paragraph (0–8) |
| `autofit_type` | `"shrink"` | `"none"` `"shrink"` `"resize"` |
| `word_wrap` | true | |

## Edit-only

- `lst_style_xml` (raw OOXML)
- `body_insets` (use position + margins for create)
- `font_scale`, `ln_spc_reduction` (autofit internals)
- `pdf_y_offset`, `pdf_x_offset`, `end_para_font_size` (PDF render hints)
- `is_placeholder`, `placeholder_type` (placeholder semantics — onboarding only)

## Gotchas

- **`is_line_break: true`** on a `TextRun` represents a soft break within a paragraph. For agent creation, treat newlines in input as paragraph breaks; use line breaks only when explicitly asked.
- **Theme-aware colors.** `"text"` should resolve to the deck's primary text color (typically `scheme:tx1`); `"muted"` to `tx2`. The coercion helper handles these aliases.
- **Bullet inheritance** is hierarchical via `lst_style_xml` in onboarded decks. New text elements don't inherit any list style; bullets must be set explicitly per paragraph.

## Example payload

```json
POST /api/docs/{doc_id}/slides/2/elements/text
{
  "text": "Q4 2025 Board Update",
  "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 1.0},
  "font_size": 36,
  "font_bold": true,
  "font_color": "text",
  "text_align": "left",
  "name": "Title"
}
```

```json
POST /api/docs/{doc_id}/slides/2/elements/text
{
  "paragraphs": [
    {"text": "Highlights", "font_size": 24, "font_bold": true, "space_after": 8},
    {"text": "Revenue up 23% YoY", "indent_level": 1, "bullet_type": "char"},
    {"text": "Gross margin expanded 240 bps", "indent_level": 1, "bullet_type": "char"},
    {"text": "Net retention 118%", "indent_level": 1, "bullet_type": "char"}
  ],
  "position": {"left_in": 0.5, "top_in": 1.5, "width_in": 6.0, "height_in": 4.0}
}
```
