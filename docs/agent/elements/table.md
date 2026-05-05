# BridgeTable — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeTable`
**Existing typed PATCH:** `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/table-data` (rich, with insert_row/col, cell-level updates)

## What it is

A rectangular grid of cells with rich per-cell formatting (font, alignment, fill, borders, merges) and table-wide style sections (header row, totals row, banded rows/cols, corner cells). The format matrix `cell_formats: list[list[CellFormat]]` mirrors `data` cell-for-cell.

## Anatomy

```
BridgeTable
├── (BridgeElement base)
├── data                  list[list[Any]]    — raw cell values
├── cell_formats          list[list[CellFormat]]   — parallel matrix
│   └── CellFormat(text, paragraphs, font, alignment, fill_color, fill_type, fill_transparency,
│                  borders, margins, text_autofit, number_format, merge, grid_row, grid_col,
│                  text_direction, word_wrap, anchor, raw_properties)
├── dimensions            TableDimensions(column_widths, row_heights — inches, optional)
├── table_properties      TableProperties(first_row_header, first_col_header, last_row_total,
│                                        last_col_total, banded_rows, banded_cols, style)
└── defaults              TableDefaults(text_autofit, default_font_name, default_font_size)
```

## Required for creation

| Field | Type | Notes |
|---|---|---|
| `position` | `{left_in, top_in, width_in, height_in}` | |
| `data` | `list[list[any]]` OR `{rows, cols}` for empty grid | |

Either:
- **`data`** — full cell-value matrix; row and column counts derived from it
- **`rows` + `cols`** — empty N×M grid; cells are blank strings

## Optional for creation

| Field | Default | Notes |
|---|---|---|
| `first_row_header` | true if `data` provided | applies header style section |
| `first_col_header` | false | |
| `last_row_total` | false | applies totals style |
| `last_col_total` | false | |
| `banded_rows` | true | alternating fill colors |
| `banded_cols` | false | |
| `style_preset` | `"theme"` | named style — see presets below |
| `column_widths` | auto (proportional to width / cols) | inches |
| `row_heights` | auto | inches |
| `font_name` | theme body font | applied to all cells |
| `font_size` | 11 | |
| `text_align` | `"left"` for text cells, `"right"` for numeric | per-cell, auto-detected |
| `vertical_align` | `"middle"` | |
| `number_format` | inferred from column type | e.g. `"$,.0f"` for currency-looking columns |
| `name` | `"Table {id}"` | |

## Style presets

Named presets that materialize a `TableStyle`:

| Preset | Header | Bands | Borders | Use |
|---|---|---|---|---|
| `"plain"` | none | none | none | minimal |
| `"theme"` | accent1 fill, white bold | accent1 +90%/+100% bands | thin tx2 inside | default |
| `"banded"` | none | gray bands | none | data table |
| `"bordered"` | none | none | thin all | grid |
| `"financial"` | tx2 fill, white bold | none | thin tx2 bottom only on rows | board reports |
| `"matrix"` | first_row + first_col headers | none | thin tx2 all | cross-tab |

Custom styles still possible via the rich PATCH endpoint after creation.

## Edit-only

- `cell_formats[r][c].raw_properties` (untyped passthrough)
- Per-cell `borders` (use the rich PATCH for fine-grained control after creation)
- `merge` (use the rich PATCH; create produces an unmerged grid)
- `paragraphs` per cell (multi-paragraph cells via rich PATCH; create produces single-paragraph cells)
- `conditional_formatting` (Phase 2)

## Gotchas

- **`data` and `cell_formats` must stay parallel.** The builder enforces this. After-the-fact insert_row/col via the rich PATCH already handles this; agent's create endpoint defers to the builder.
- **Numeric detection.** Cells whose string-cast values all parse as numbers get `text_align="right"` and a sensible `number_format`. Currency columns with column names like `"Revenue"`, `"Cost"`, `"$"` get `"$,.0f"`. Percentage columns (header contains `%`) get `".1%"`.
- **Header row with `first_row_header=true`** is the *first row* of `data`, not separate. The builder applies header styling to row 0.
- **Column widths default to equal split** of the table width. Auto-fit by content is a Phase 2 stretch.
- **Merge cells** are not part of v1 creation. User merges after via the editor.

## Example payloads

```json
// From data
POST /api/docs/{doc_id}/slides/3/elements/table
{
  "data": [
    ["Quarter", "Revenue", "Cost", "Margin"],
    ["Q1",      100,       80,    "20%"],
    ["Q2",      120,       90,    "25%"],
    ["Q3",      130,       95,    "27%"],
    ["Q4",      110,       85,    "23%"]
  ],
  "first_row_header": true,
  "banded_rows": true,
  "style_preset": "financial",
  "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 3.5}
}
```

```json
// Empty grid for later population
POST /api/docs/{doc_id}/slides/3/elements/table
{
  "rows": 5,
  "cols": 4,
  "first_row_header": true,
  "style_preset": "theme",
  "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 3}
}
```

```json
// From a DataFrame-shaped JSON
POST /api/docs/{doc_id}/slides/3/elements/table
{
  "columns": ["Quarter", "Revenue", "Cost"],
  "rows": [["Q1", 100, 80], ["Q2", 120, 90]],
  "first_row_header": true,
  "style_preset": "financial",
  "position": {"left_in": 1, "top_in": 1.5, "width_in": 6, "height_in": 2}
}
```
