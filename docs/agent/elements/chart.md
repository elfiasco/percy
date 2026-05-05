# BridgeChart — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeChart`
**Existing typed PATCH:** `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data` (rich)
**Existing native renderer:** `frontend/src/components/studio/renderers/ChartRenderer.tsx` (Recharts)

## What it is

The most structurally rich Bridge element. Categories + series with full styling, two axes (category + value), plot properties, legend, title. Onboarded charts also carry `reconstruction_blobs` (raw OOXML chart XML + embedded Excel) — **agent-created charts leave these blobs as `None`** and rely on the native renderer + `rebuild_pptx` structured-field path. Confirmed working for column/bar/line/pie/area; verified by chart-editor architecture (memory `project_chart_editor_architecture.md`).

## Supported chart types (v1)

| `chart_type` | Native renderer | PPTX export | Notes |
|---|---|---|---|
| `"column_clustered"` | ✓ | ✓ | vertical bars |
| `"column_stacked"` | ✓ | ✓ | |
| `"column_stacked_100"` | ✓ | ✓ | percentage |
| `"bar_clustered"` | ✓ | ✓ | horizontal bars |
| `"bar_stacked"` | ✓ | ✓ | |
| `"line"` | ✓ | ✓ | |
| `"line_markers"` | ✓ | ✓ | line with point markers |
| `"area"` | ✓ | ✓ | |
| `"area_stacked"` | ✓ | ✓ | |
| `"pie"` | ✓ | ✓ | first series only |
| `"doughnut"` | ✓ | ✓ | |
| `"scatter"` | ✓ | ✓ | requires x_values |
| `"combo"` | ✓ | ✓ | uses per-series `plot_type` overrides |

Other types (radar, surface, bubble, etc.) — Phase 2.

## Anatomy

```
BridgeChart
├── (BridgeElement base — position, transforms, stacking, identification, accessibility)
├── chart_type           string
├── title                ChartTitle(title, font_size, font_name, font_bold, font_color, italic,
│                                   position_x/y, width, height, auto_title_deleted)
├── categories           ChartCategories(categories, categories_raw, categories_are_numeric, levels)
├── series               list[ChartSeries]
│   └── ChartSeries(name, values, color, negative_color, point_colors, plot_type, plot_index,
│                   invert_if_negative, line, marker, data_labels, x_values, point_formatting,
│                   custom_labels, smooth, fill_type, gradient_stops)
├── category_axis        BridgeAxis (gridlines, title, tick_labels, tick_marks, units, axis_line, ...)
├── value_axis           BridgeAxis
├── plot_properties      PlotProperties(grouping, bar_width_ratio, overlap, is_horizontal,
│                                       area_border, first_slice_ang, hole_size, vary_colors)
├── legend               Legend(visible, position, overlay, font_*, fill_*, border_*, manual_layout_*)
├── chart_space_fill     dict
├── data_source          ChartDataSource — agent leaves defaults
├── overlay_files        OverlayFiles — agent leaves defaults (None)
└── reconstruction_blobs ReconstructionBlobs — agent leaves defaults (None)
```

## Required for creation

| Field | Type | Notes |
|---|---|---|
| `chart_type` | string | from supported list above |
| `categories` | list[string] | x-axis labels |
| `series` | list[{name, values, ...}] | at least one |
| `position` | `{left_in, top_in, width_in, height_in}` | |

Series object:

```json
{
  "name": "Revenue",
  "values": [100, 120, 130, 110],
  "color": "accent1",                    // optional; auto-palette if omitted
  "plot_type": "line",                   // optional; for combo charts
  "smooth": false,
  "data_labels": {"show": true, "format": "$,.0f"}
}
```

## Optional for creation

| Field | Default | Notes |
|---|---|---|
| `title` | first series name | string or `{text, font_size, bold, color}` |
| `legend` | `{visible: true, position: "bottom"}` for ≥2 series, `false` for 1 | |
| `value_axis` | `{visible: true, gridlines: true, number_format: "auto"}` | |
| `category_axis` | `{visible: true, gridlines: false}` | |
| `data_labels_global` | `{show: false}` | applies to all series unless overridden |
| `palette` | `"theme"` (uses scheme accents) | `"theme"`, `"viridis"`, `"warm"`, `"cool"`, `"mono"`, or list of colors |
| `bar_width_ratio` | 0.7 | for column/bar |
| `is_horizontal` | derived from chart_type | |
| `hole_size` | 50 | doughnut only (% of outer radius) |
| `name` | `"Chart {id}"` | display name |

## Edit-only

- `reconstruction_blobs.*`, `overlay_files.*` (left None; not exposed)
- `data_source.embedded_workbook_bytes` (left None)
- `point_formatting`, `custom_labels` (per-point overrides; rich PATCH only)
- `gradient_stops` on series fill
- `manual_layout_*` (legend manual positioning; rich PATCH only)
- `plot_area_*` (manual plot-area positioning; rich PATCH only)
- `chart_txpr_*` (chart-wide font defaults; derived from theme on create)

## Gotchas

- **Numeric categories.** If all category values parse as numbers, set `categories_are_numeric=true`. The native renderer uses this for scatter/numeric x-axis behavior. The builder detects this automatically.
- **Pie charts ignore extra series.** Only `series[0]` is plotted. The builder warns but accepts.
- **Combo chart contract.** Set `chart_type="combo"` and give each series an explicit `plot_type` (`"line"`, `"column"`, `"area"`). Default plot type is column.
- **Scatter requires `x_values`.** If `chart_type="scatter"` and a series has no `x_values`, builder uses `categories` cast to numeric, or rejects if non-numeric.
- **Auto-palette.** When series colors are omitted and theme has `ACCENT_1..ACCENT_6`, builder cycles through them. Beyond 6 series, falls back to `viridis`.
- **`data_source.has_embedded_workbook=False`** is correct for new charts. PPTX export builds a minimal workbook at export time.
- **Theme-aware default styling.** Title font defaults to theme major font; tick labels to minor font.

## Example payload

```json
POST /api/docs/{doc_id}/slides/3/elements/chart
{
  "chart_type": "column_clustered",
  "categories": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    {"name": "Revenue", "values": [100, 120, 130, 110]},
    {"name": "Cost",    "values": [80,  90,  95,  85]}
  ],
  "title": "Quarterly Performance",
  "position": {"left_in": 1.0, "top_in": 1.5, "width_in": 8.0, "height_in": 5.0},
  "value_axis": {"number_format": "$,.0f", "gridlines": true},
  "legend": {"position": "bottom"}
}
```

```json
// Combo
POST /api/docs/{doc_id}/slides/3/elements/chart
{
  "chart_type": "combo",
  "categories": ["Jan", "Feb", "Mar", "Apr"],
  "series": [
    {"name": "Revenue",  "values": [100, 120, 130, 110], "plot_type": "column"},
    {"name": "Margin %", "values": [22,  24,  26,  25 ], "plot_type": "line",
     "color": "good", "smooth": true, "data_labels": {"show": true, "format": ".0%"}}
  ],
  "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 5}
}
```
