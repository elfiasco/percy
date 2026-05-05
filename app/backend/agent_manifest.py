"""Agent API manifest.

A single source of truth for every editing endpoint the Percy studio exposes,
with one-line natural-language summaries + per-arg descriptions. This is what
the embedding-based retrieval agent indexes against.

When you add a new editable endpoint to main.py, add an entry here too.
The manifest version bumps any time this file changes; the agent re-embeds
when it sees a new version.

Schema (mirrors the spec in docs/percy-agent-macro.md §2.1):
    {
        "id":          str   — stable id, used in plans
        "method":      str   — "GET" | "PATCH" | "POST" | "DELETE"
        "path":        str   — FastAPI path with {placeholders}
        "summary":     str   — one sentence, embedded for retrieval
        "applies_to":  list[str] — element types or ["*"] for global
        "destructive": bool  — requires confirmation gating
        "args":        dict  — body schema, one-line desc per field
        "examples":    list[str] — natural-language phrasings; also embedded
    }
"""

from __future__ import annotations

# Bump this version whenever endpoints change so clients re-embed.
MANIFEST_VERSION = "2026-05-04.4"


# ─── Element types covered ────────────────────────────────────────────────────

ALL_ELEMENT_TYPES = [
    "BridgeShape", "BridgeText", "BridgeImage", "BridgeChart",
    "BridgeTable", "BridgeConnector", "BridgeFreeform", "BridgeGroup",
]


# ─── Endpoint definitions ─────────────────────────────────────────────────────

ENDPOINTS: list[dict] = [

    # ─── Position / geometry / flags (every element) ──────────────────────

    {
        "id": "element.update",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}",
        "summary": "Move, resize, rotate, reorder, rename, lock, or hide any element on a slide.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "left_in":   {"type": "number?", "desc": "Left position in inches"},
            "top_in":    {"type": "number?", "desc": "Top position in inches"},
            "width_in":  {"type": "number?", "desc": "Width in inches"},
            "height_in": {"type": "number?", "desc": "Height in inches"},
            "rotation":  {"type": "number?", "desc": "Rotation in degrees, 0–360"},
            "z_index":   {"type": "number?", "desc": "Stacking order; higher = on top"},
            "name":      {"type": "string?", "desc": "Display name for the element"},
            "locked":    {"type": "bool?",   "desc": "Prevent further edits"},
            "hidden":    {"type": "bool?",   "desc": "Hide from rendering"},
        },
        "examples": [
            "Move this element to the center",
            "Resize the chart to 6 inches wide",
            "Rotate this 45 degrees",
            "Send to back",
            "Lock this element",
            "Rename to Hero Title",
        ],
    },
    {
        "id": "element.delete",
        "method": "DELETE",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}",
        "summary": "Delete an element from the slide.",
        "applies_to": ["*"],
        "destructive": True,
        "args": {},
        "examples": [
            "Delete this element",
            "Remove the footer text box",
        ],
    },
    {
        "id": "element.duplicate",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/duplicate",
        "summary": "Duplicate an element on the same slide.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Duplicate this shape",
            "Make a copy of the title",
        ],
    },
    {
        "id": "element.copy_to_slide",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/copy-to-slide",
        "summary": "Copy an element to another slide.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "target_slide_n": {"type": "int", "desc": "Destination slide number"},
        },
        "examples": [
            "Copy this footer to slide 5",
            "Put this logo on every slide",
        ],
    },

    # ─── Style (fill / line / shadow / opacity / crop) ────────────────────

    {
        "id": "element.style.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/style",
        "summary": "Read the style (fill, line, shadow, opacity, image crop) of an element.",
        "applies_to": ["BridgeShape", "BridgeText", "BridgeFreeform", "BridgeImage", "BridgeConnector"],
        "destructive": False,
        "args": {},
        "examples": [
            "What color is this shape?",
            "Show me this element's style",
        ],
    },
    {
        "id": "element.style.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/style",
        "summary": "Change fill color, line color/width/dash, shadow, opacity, or image crop.",
        "applies_to": ["BridgeShape", "BridgeText", "BridgeFreeform", "BridgeImage", "BridgeConnector"],
        "destructive": False,
        "args": {
            "fill_color":      {"type": "string?", "desc": "Hex like #4472C4 or empty to clear"},
            "fill_type":       {"type": "string?", "desc": "'solid' | 'gradient' | 'pattern' | 'none'"},
            "line_color":      {"type": "string?", "desc": "Border color, hex"},
            "line_width":      {"type": "number?", "desc": "Border width in pt"},
            "line_dash":       {"type": "string?", "desc": "'solid' | 'dash' | 'dot' | 'dash_dot' | 'long_dash' | 'long_dash_dot'"},
            "opacity":         {"type": "number?", "desc": "0.0 to 1.0"},
            "shadow_on":       {"type": "bool?",   "desc": "Toggle shadow"},
            "shadow_color":    {"type": "string?", "desc": "Shadow color, hex"},
            "shadow_blur":     {"type": "number?", "desc": "Shadow blur in pt"},
            "shadow_offset_x": {"type": "number?", "desc": "Shadow offset (used as distance, in pt)"},
            "shadow_offset_y": {"type": "number?", "desc": "Shadow direction in degrees"},
            "crop_left":       {"type": "number?", "desc": "Image crop, left fraction 0.0–1.0"},
            "crop_right":      {"type": "number?", "desc": "Image crop, right fraction 0.0–1.0"},
            "crop_top":        {"type": "number?", "desc": "Image crop, top fraction 0.0–1.0"},
            "crop_bottom":     {"type": "number?", "desc": "Image crop, bottom fraction 0.0–1.0"},
        },
        "examples": [
            "Make this shape blue",
            "Set the fill to #1a1a2e",
            "Add a thin black border",
            "Remove the fill",
            "Make this 50% transparent",
            "Add a soft drop shadow",
            "Crop the image 20% off the left",
        ],
    },

    # ─── Text content ─────────────────────────────────────────────────────

    {
        "id": "element.text.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/text",
        "summary": "Read the text content (paragraphs, runs, fonts) of a text-bearing element.",
        "applies_to": ["BridgeText", "BridgeShape", "BridgeFreeform", "BridgeChart", "BridgeTable"],
        "destructive": False,
        "args": {},
        "examples": [
            "What does this text say?",
            "Show the text content",
        ],
    },
    {
        "id": "element.text.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/text",
        "summary": "Edit text content: paragraphs, runs, font family/size/weight/italic/underline/color, alignment, spacing.",
        "applies_to": ["BridgeText", "BridgeShape", "BridgeFreeform", "BridgeChart", "BridgeTable"],
        "destructive": False,
        "args": {
            "paragraphs": {"type": "ParagraphData[]?", "desc": "Full paragraph list with runs + alignment + spacing"},
            "kind":       {"type": "string?",         "desc": "'paragraphs' | 'chart' | 'table' — usually inferred"},
        },
        "examples": [
            "Change the title to Q1 2026 Results",
            "Make this bold",
            "Change the font to Helvetica",
            "Set the size to 24pt",
            "Center this paragraph",
            "Add 12pt spacing after",
        ],
    },
    {
        "id": "element.text.rewrite",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/rewrite",
        "summary": "AI-rewrite the text in an element with a natural-language instruction.",
        "applies_to": ["BridgeText", "BridgeShape", "BridgeFreeform"],
        "destructive": False,
        "args": {
            "instruction": {"type": "string", "desc": "Plain-English instruction (e.g. 'make shorter', 'more formal')"},
        },
        "examples": [
            "Make this text more concise",
            "Rewrite in a formal tone",
            "Shorten to one sentence",
        ],
    },

    # ─── Chart data (typed) ───────────────────────────────────────────────

    {
        "id": "chart.data.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data",
        "summary": "Read full chart data: type, categories, series values + colors, axes, legend, plot properties.",
        "applies_to": ["BridgeChart"],
        "destructive": False,
        "args": {},
        "examples": [
            "Show the chart data",
            "What are the chart's series?",
        ],
    },
    {
        "id": "chart.data.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data",
        "summary": "Edit chart: change chart type, categories, series values/colors/labels, axes (min/max/grid), legend, title, plot style.",
        "applies_to": ["BridgeChart"],
        "destructive": False,
        "args": {
            "chart_type":       {"type": "string?",          "desc": "COLUMN_CLUSTERED | BAR_CLUSTERED | LINE | PIE | DOUGHNUT | AREA | XY_SCATTER | …"},
            "categories":       {"type": "string[]?",        "desc": "X-axis labels in order"},
            "series":           {"type": "ChartSeriesData[]?", "desc": "Each series: name, values, color, plot_type override, line, marker, data_labels, smooth"},
            "title":            {"type": "ChartTitleFull?",  "desc": "Chart title text + font (size, bold, italic, color)"},
            "legend":           {"type": "ChartLegendData?", "desc": "Visible, position (TOP/BOTTOM/LEFT/RIGHT), font"},
            "category_axis":    {"type": "ChartAxisData?",   "desc": "X-axis: visible, min, max, gridlines, title, tick formatting"},
            "value_axis":       {"type": "ChartAxisData?",   "desc": "Y-axis: visible, min, max, major_unit, gridlines, number_format, title"},
            "plot_properties":  {"type": "ChartPlotProperties?", "desc": "Bar gap_width, overlap, hole_size for donut, vary_colors, etc."},
        },
        "examples": [
            "Change this column chart to a line chart",
            "Make the revenue series red",
            "Set the y-axis to start at zero and max at 100",
            "Hide the legend",
            "Add data labels to the first series",
            "Change the chart title to Q1 Revenue",
            "Use percent format on the y-axis",
            "Update the categories to Q1 Q2 Q3 Q4",
        ],
    },

    # ─── Table data (typed) ───────────────────────────────────────────────

    {
        "id": "table.data.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/table-data",
        "summary": "Read full table data: cells with text/font/colors/borders/merge, column widths, row heights, header/banding flags.",
        "applies_to": ["BridgeTable"],
        "destructive": False,
        "args": {},
        "examples": [
            "Show the table contents",
            "What's in row 2?",
        ],
    },
    {
        "id": "table.data.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/table-data",
        "summary": "Edit table cells (text/font/fill/borders/alignment/merge), column widths, row heights, table-wide flags (banded rows, header). Insert/delete rows or columns via op + index.",
        "applies_to": ["BridgeTable"],
        "destructive": False,   # individual row/col delete is structural but reversible via undo
        "args": {
            "cells":         {"type": "TableCellPatch[]?", "desc": "Per-cell partial updates; each must include row + col"},
            "column_widths": {"type": "number[]?",         "desc": "Replace all column widths (inches)"},
            "row_heights":   {"type": "number[]?",         "desc": "Replace all row heights (inches)"},
            "properties":    {"type": "TableProperties?",  "desc": "first_row_header, last_row_total, banded_rows, banded_cols"},
            "op":            {"type": "string?",           "desc": "'insert_row' | 'delete_row' | 'insert_col' | 'delete_col'"},
            "index":         {"type": "int?",              "desc": "0-based index for the structural op"},
        },
        "examples": [
            "Set cell [0,1] to Q2 2026",
            "Make the first row a header with white text",
            "Insert a row between rows 2 and 3",
            "Delete the third column",
            "Add banded row colors",
            "Bold every cell in column 0",
            "Right-align all numeric columns",
        ],
    },

    # ─── Connector data (typed) ───────────────────────────────────────────

    {
        "id": "connector.data.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/connector-data",
        "summary": "Read connector type, endpoints, line styling, and arrowheads.",
        "applies_to": ["BridgeConnector"],
        "destructive": False,
        "args": {},
        "examples": [
            "What does this arrow look like?",
            "Show the connector endpoints",
        ],
    },
    {
        "id": "connector.data.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/connector-data",
        "summary": "Edit connector: type (straight/elbow/curved), endpoint coordinates, line color/width/dash, arrowheads (head_end/tail_end + size).",
        "applies_to": ["BridgeConnector"],
        "destructive": False,
        "args": {
            "connector_type": {"type": "string?",            "desc": "'straight' | 'elbow' | 'curved'"},
            "endpoints":      {"type": "ConnectorEndpoints?", "desc": "{ start_x, start_y, end_x, end_y } in inches"},
            "line":           {"type": "ConnectorLine?",     "desc": "{ visible, color, width, dash_style, head_end, tail_end, head_size, tail_size }"},
        },
        "examples": [
            "Change this to an elbow connector",
            "Make the arrow red",
            "Add an arrowhead on both ends",
            "Make the connector a dashed line",
            "Swap the start and end of this connector",
        ],
    },

    # ─── Connect (per-element Python script) ──────────────────────────────

    {
        "id": "connect.get",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/connect",
        "summary": "Read the Python connect script (data binding) attached to an element.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Does this element have a Python binding?",
            "Show the connect script",
        ],
    },
    {
        "id": "connect.patch",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/connect",
        "summary": "Save (or replace) the Python connect script and any saved test inputs for an element.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "script":  {"type": "string?", "desc": "Full Python source. Has access to globals 'element' (JSON) and 'inputs' (dict)."},
            "inputs":  {"type": "object?", "desc": "Default test inputs as a JSON object"},
        },
        "examples": [
            "Add a Python script that pulls revenue from the warehouse",
            "Bind this chart to the Q1 sales pipeline",
            "Write a connect that fetches today's KPI from the API",
        ],
    },
    {
        "id": "connect.test",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/{element_id}/connect/test",
        "summary": "Run the connect script in a sandboxed subprocess (10s timeout) and return its result, stdout, stderr.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "script": {"type": "string?", "desc": "Optional override; defaults to saved script"},
            "inputs": {"type": "object?", "desc": "Optional override; defaults to saved inputs"},
        },
        "examples": [
            "Test the connect for this element",
            "Run the Python and show me the output",
        ],
    },
    {
        "id": "connect.list",
        "method": "GET",
        "path": "/api/docs/{doc_id}/connects",
        "summary": "List every element across the deck that has a Python connect attached.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Which elements have Python bindings?",
            "Show all connects in this deck",
        ],
    },

    # ─── Slide management ─────────────────────────────────────────────────

    {
        "id": "slide.add",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides",
        "summary": "Insert a blank slide after the given slide number.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "after_n": {"type": "int", "desc": "Insert after this slide number; 0 = at start"},
        },
        "examples": [
            "Add a new slide after slide 3",
            "Insert a slide at the end",
        ],
    },
    {
        "id": "slide.delete",
        "method": "DELETE",
        "path": "/api/docs/{doc_id}/slides/{n}",
        "summary": "Delete a slide and all its elements.",
        "applies_to": ["*"],
        "destructive": True,
        "args": {},
        "examples": [
            "Delete slide 5",
            "Remove the empty slide at the end",
        ],
    },
    {
        "id": "slide.duplicate",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/duplicate",
        "summary": "Duplicate a slide and all its elements.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Duplicate slide 2",
            "Copy this slide",
        ],
    },
    {
        "id": "slide.move",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/move",
        "summary": "Reorder a slide to a new position.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "to_n": {"type": "int", "desc": "Destination slide number (1-based)"},
        },
        "examples": [
            "Move slide 5 to position 2",
            "Swap slides 3 and 4",
        ],
    },
    {
        "id": "slide.background",
        "method": "PATCH",
        "path": "/api/docs/{doc_id}/slides/{n}/background",
        "summary": "Set the slide background color (single hex). Pass empty/null to clear.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "color": {"type": "string?", "desc": "Hex like #1a1a2e; null/empty to clear"},
        },
        "examples": [
            "Change the slide background to dark blue",
            "Set the background to white",
            "Clear the background color",
        ],
    },
    {
        "id": "slide.elements",
        "method": "GET",
        "path": "/api/docs/{doc_id}/slides/{n}/elements",
        "summary": "List every element on a slide with id, type, geometry, z-index, locked/hidden flags.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "What's on slide 4?",
            "List the elements on this slide",
        ],
    },

    # ─── Element creation ─────────────────────────────────────────────────

    {
        "id": "element.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements",
        "summary": "Insert a new shape/text element on a slide. Supports rect, ellipse, triangle, diamond, star5, rightArrow, ribbon, text_box, and other PowerPoint shape types.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "shape_type": {"type": "string?", "desc": "rect | roundRect | ellipse | triangle | diamond | star5 | rightArrow | leftArrow | ribbon | text_box | …"},
            "left_in":    {"type": "number?", "desc": "Left position (in)"},
            "top_in":     {"type": "number?", "desc": "Top position (in)"},
            "width_in":   {"type": "number?", "desc": "Width (in)"},
            "height_in":  {"type": "number?", "desc": "Height (in)"},
            "fill_color": {"type": "string?", "desc": "Initial fill, hex"},
            "label":      {"type": "string?", "desc": "Display name and initial text"},
        },
        "examples": [
            "Insert a red rectangle in the top-right",
            "Add a text box with the words Q1 2026",
            "Put a star at the center of the slide",
            "Insert an arrow pointing right",
        ],
    },

    # ─── Document-level / rebuild / export ────────────────────────────────

    {
        "id": "doc.rebuild",
        "method": "POST",
        "path": "/api/docs/{doc_id}/rebuild",
        "summary": "Rebuild the .pptx from the current Bridge model via python-pptx (round-trip; updates the comparison view).",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Rebuild the deck",
            "Regenerate the .pptx",
        ],
    },
    {
        "id": "doc.undo",
        "method": "POST",
        "path": "/api/docs/{doc_id}/undo",
        "summary": "Undo the most recent edit. Each PATCH/DELETE/structural change creates a snapshot.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Undo that",
            "Roll back the last change",
        ],
    },
    {
        "id": "doc.redo",
        "method": "POST",
        "path": "/api/docs/{doc_id}/redo",
        "summary": "Redo the most recently undone edit.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "Redo that",
            "Bring it back",
        ],
    },

    # ─── create_thin family (intent → builder → dataclass tree) ──────────
    # Spec: docs/agent/elements/MASTER.md
    # Builders: src/percy/bridge/builders.py
    # Routes:   app/backend/element_creation.py

    {
        "id": "shape.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/shape",
        "summary": "Create a new shape (rectangle, oval, arrow, callout, any OOXML preset geometry) on a slide.",
        "applies_to": ["BridgeShape"],
        "destructive": False,
        "args": {
            "geometry_preset": {"type": "string", "desc": "OOXML preset: rect, roundRect, ellipse, triangle, rightArrow, chevron, star5, cloud, etc."},
            "position":        {"type": "Position", "desc": "{left_in, top_in, width_in, height_in} in inches"},
            "fill_color":      {"type": "color?", "desc": "Color string: hex, named, accent1-6, theme alias, with optional +/-pct or @alpha"},
            "fill_type":       {"type": "string?", "desc": "solid | gradient | none"},
            "border_color":    {"type": "color?", "desc": "Outline color"},
            "border_width":    {"type": "number?", "desc": "Outline width in points"},
            "border_dash":     {"type": "string?", "desc": "solid | dash | dot | dashDot | longDash"},
            "text":            {"type": "string?", "desc": "Single-line text; for multi-paragraph use 'paragraphs' instead"},
            "paragraphs":      {"type": "list?", "desc": "Multi-paragraph: [{text, font_size?, font_bold?, indent_level?, bullet_type?, ...}]"},
            "text_color":      {"type": "color?", "desc": "Text color"},
            "font_name":       {"type": "string?", "desc": "Font family"},
            "font_size":       {"type": "number?", "desc": "Font size in points"},
            "font_bold":       {"type": "bool?", "desc": "Bold text"},
            "text_align":      {"type": "string?", "desc": "left | center | right | justify"},
            "vertical_align":  {"type": "string?", "desc": "top | middle | bottom"},
            "rotation":        {"type": "number?", "desc": "Rotation in degrees"},
            "shadow":          {"type": "object?", "desc": "{blur, distance, direction, color, alpha} or true/false"},
            "name":            {"type": "string?", "desc": "Display name"},
            "alt_text":        {"type": "string?", "desc": "Accessibility alt text"},
            "z_index":         {"type": "number?", "desc": "Stacking order; defaults to top"},
        },
        "examples": [
            "Add a blue rectangle in the top right corner",
            "Create a rounded callout that says 'Q4 Highlights'",
            "Insert a thick red arrow pointing right",
            "Draw a star badge in the corner with text '20% off'",
            "Add a dark navy section divider across the slide",
        ],
    },
    {
        "id": "text.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/text",
        "summary": "Create a new text box on a slide (no fill, no geometry — just text).",
        "applies_to": ["BridgeShape", "BridgeText"],
        "destructive": False,
        "args": {
            "text":            {"type": "string?", "desc": "Single-line or single-paragraph text"},
            "paragraphs":      {"type": "list?", "desc": "[{text, font_size?, indent_level?, bullet_type?, ...}] for multi-paragraph"},
            "position":        {"type": "Position", "desc": "{left_in, top_in, width_in, height_in}"},
            "font_name":       {"type": "string?", "desc": "Font family"},
            "font_size":       {"type": "number?", "desc": "Font size in points"},
            "font_bold":       {"type": "bool?", "desc": "Bold"},
            "font_italic":     {"type": "bool?", "desc": "Italic"},
            "text_color":      {"type": "color?", "desc": "Color string"},
            "text_align":      {"type": "string?", "desc": "left | center | right | justify"},
            "vertical_align":  {"type": "string?", "desc": "top | middle | bottom"},
            "name":            {"type": "string?", "desc": "Display name"},
        },
        "examples": [
            "Add a title 'Q4 2025 Board Update' at the top",
            "Insert a bullet list with three highlights",
            "Place a small footer caption with the date",
            "Add a quote in big italic type centered on the slide",
        ],
    },
    {
        "id": "chart.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/chart",
        "summary": "Create a new chart (column, bar, line, area, pie, doughnut, scatter, combo) with data and styling.",
        "applies_to": ["BridgeChart"],
        "destructive": False,
        "args": {
            "chart_type":     {"type": "string", "desc": "column_clustered | column_stacked | bar_clustered | bar_stacked | line | line_markers | area | area_stacked | pie | doughnut | scatter | combo"},
            "categories":     {"type": "string[]", "desc": "X-axis labels in order; required"},
            "series":         {"type": "object[]", "desc": "[{name, values, color?, plot_type?, smooth?, data_labels?}]; at least one"},
            "title":          {"type": "string|object?", "desc": "Chart title; string or {text, font_size, bold, color}"},
            "position":       {"type": "Position", "desc": "{left_in, top_in, width_in, height_in}"},
            "value_axis":     {"type": "object?", "desc": "{visible?, gridlines?, min?, max?, number_format?, title?}"},
            "category_axis":  {"type": "object?", "desc": "{visible?, gridlines?, title?}"},
            "legend":         {"type": "object|bool?", "desc": "{position: top|bottom|left|right} or false"},
            "palette":        {"type": "string|list?", "desc": "theme | viridis | warm | cool | mono | [hex,...]"},
            "data_labels_global": {"type": "object?", "desc": "{show, format, position} applied to all series"},
            "bar_width_ratio":{"type": "number?", "desc": "0-1; default 0.7"},
            "hole_size":      {"type": "number?", "desc": "Doughnut hole size %, default 50"},
            "name":           {"type": "string?", "desc": "Display name"},
        },
        "examples": [
            "Create a bar chart of Q1-Q4 revenue and cost",
            "Add a line chart showing monthly active users",
            "Make a pie chart of revenue by region",
            "Insert a combo chart with revenue columns and margin % line",
            "Add a stacked column chart of headcount by department over time",
        ],
    },
    {
        "id": "table.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/table",
        "summary": "Create a new table — accepts data matrix, columns+rows, or empty rows×cols grid; applies a style preset.",
        "applies_to": ["BridgeTable"],
        "destructive": False,
        "args": {
            "data":             {"type": "any[][]?", "desc": "Full cell-value matrix; if first_row_header, row 0 is the header"},
            "columns":          {"type": "string[]?", "desc": "Header row when paired with rows[]"},
            "rows":             {"type": "any[][]?", "desc": "Data rows when paired with columns[]; OR an int when paired with cols (empty grid)"},
            "cols":             {"type": "number?", "desc": "When paired with rows int, creates an empty rows×cols grid"},
            "first_row_header": {"type": "bool?", "desc": "Treat row 0 as header (default true when data provided)"},
            "first_col_header": {"type": "bool?", "desc": "Treat col 0 as header"},
            "last_row_total":   {"type": "bool?", "desc": "Treat last row as totals"},
            "banded_rows":      {"type": "bool?", "desc": "Alternating row fills (default true)"},
            "banded_cols":      {"type": "bool?", "desc": "Alternating column fills"},
            "style_preset":     {"type": "string?", "desc": "plain | theme | banded | bordered | financial | matrix"},
            "position":         {"type": "Position", "desc": "{left_in, top_in, width_in, height_in}"},
            "font_name":        {"type": "string?", "desc": "Default font for all cells"},
            "font_size":        {"type": "number?", "desc": "Default font size"},
            "name":             {"type": "string?", "desc": "Display name"},
        },
        "examples": [
            "Create a 4-column quarterly revenue table",
            "Add an empty 5x3 table with a header row",
            "Insert a financial-style table with these numbers...",
            "Make a comparison matrix with row and column headers",
        ],
    },
    {
        "id": "connector.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/connector",
        "summary": "Create a line/arrow connecting two points or two existing elements.",
        "applies_to": ["BridgeConnector"],
        "destructive": False,
        "args": {
            "connector_type": {"type": "string?", "desc": "straight | elbow | curved (default straight)"},
            "start":          {"type": "object", "desc": "{x_in, y_in} OR {element_id, anchor: top|bottom|left|right|...}"},
            "end":            {"type": "object", "desc": "Same shape as start"},
            "color":          {"type": "color?", "desc": "Line color (default 'text')"},
            "width":          {"type": "number?", "desc": "Line width in points (default 1.5)"},
            "dash_style":     {"type": "string?", "desc": "solid | dash | dot | dashDot | longDash"},
            "head_end":       {"type": "string?", "desc": "Arrowhead type at end: triangle | stealth | diamond | oval | arrow | none"},
            "tail_end":       {"type": "string?", "desc": "Arrowhead at start"},
            "head_size":      {"type": "string?", "desc": "small | medium | large"},
            "tail_size":      {"type": "string?", "desc": "small | medium | large"},
            "name":            {"type": "string?", "desc": "Display name"},
        },
        "examples": [
            "Draw an arrow from the top box to the bottom box",
            "Connect the chart and the table with an elbow connector",
            "Add a dashed line from (1, 2) to (5, 4)",
            "Insert a thick red arrow pointing from A to B",
        ],
    },
    {
        "id": "freeform.create_preset",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/freeform",
        "summary": "Create a freeform shape from a named preset (arrow_thick, callout_speech, badge, banner, check, plus, etc.).",
        "applies_to": ["BridgeFreeform", "BridgeShape"],
        "destructive": False,
        "args": {
            "preset":       {"type": "string", "desc": "Preset name; many route to BridgeShape geometry presets internally"},
            "position":     {"type": "Position", "desc": "{left_in, top_in, width_in, height_in}"},
            "fill_color":   {"type": "color?", "desc": "Fill color"},
            "border_color": {"type": "color?", "desc": "Outline color"},
            "border_width": {"type": "number?", "desc": "Outline width in points"},
            "rotation":     {"type": "number?", "desc": "Degrees"},
            "flip_h":       {"type": "bool?", "desc": "Flip horizontally"},
            "flip_v":       {"type": "bool?", "desc": "Flip vertically"},
            "name":         {"type": "string?", "desc": "Display name"},
        },
        "examples": [
            "Add a checkmark in the corner",
            "Insert a speech bubble callout",
            "Create a 5-pointed star badge in the top right",
            "Add a curly brace bracket on the left",
            "Place a flowchart decision diamond",
        ],
    },
    {
        "id": "image.create_typed",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/elements/image-typed",
        "summary": "Upload an image with rich placement/styling metadata (multipart: file + metadata JSON).",
        "applies_to": ["BridgeImage"],
        "destructive": False,
        "args": {
            "file":           {"type": "multipart-file", "desc": "Image binary"},
            "metadata":       {"type": "json-string?", "desc": "{position, crop?, border_color?, border_width?, shadow?, shape_geometry?, alt_text?, name?}"},
        },
        "examples": [
            "Upload this logo and place it in the top-left corner",
            "Add this screenshot with a rounded-rectangle clip",
            "Insert this photo full-bleed",
        ],
    },
    {
        "id": "group.create",
        "method": "POST",
        "path": "/api/docs/{doc_id}/slides/{n}/group-elements",
        "summary": "Group existing elements into a single BridgeGroup so they move/resize together.",
        "applies_to": ["BridgeGroup"],
        "destructive": False,
        "args": {
            "element_ids": {"type": "string[]", "desc": "IDs of elements to group; must all be on the same slide"},
            "name":         {"type": "string?", "desc": "Group display name"},
        },
        "examples": [
            "Group these three shapes together",
            "Wrap the title and subtitle into one unit",
        ],
    },

    # ─── Agent meta-tools ───────────────────────────────────────────────────
    # Spec: docs/agent/find-element.md
    # The planner calls find_element FIRST when the user references an element
    # ambiguously (e.g. "the title", "the chart", "this", "that one") to
    # resolve it to a concrete (slide_n, element_id) tuple before planning the
    # actual edit. Pass the user's viewing slide and selected element id as
    # context to disambiguate relative references.

    {
        "id": "agent.find_element",
        "method": "POST",
        "path": "/api/agent/find_element",
        "summary": "Resolve a natural-language element reference (e.g. 'the title', 'the revenue chart') to ranked (slide, element_id) candidates.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "doc_id":         {"type": "string", "desc": "Document id"},
            "query":          {"type": "string", "desc": "Natural-language target description: 'the title', 'the revenue chart', 'the bottom-right callout'"},
            "context":        {"type": "object?", "desc": "{viewing_slide_n?, selected_element_id?, scope?, element_types?}"},
            "limit":          {"type": "number?", "desc": "Max candidates (default 5)"},
            "min_confidence": {"type": "number?", "desc": "Drop candidates below this score 0-1 (default 0)"},
            "include_digest": {"type": "bool?", "desc": "Include full digest per candidate (debug)"},
        },
        "examples": [
            "Find the title on this slide",
            "Where is the revenue chart",
            "Find the bottom-right callout",
            "Locate the table I just made",
            "Find this element",
            "Find all the charts in the deck",
        ],
    },

    # ─── Templates ──────────────────────────────────────────────────────────
    # Saved layout + connect-script bundles. The agent picks one and
    # materializes it on the slide via /apply. See src/percy/agent/templates.py.

    {
        "id": "template.list",
        "method": "GET",
        "path": "/api/agent/templates",
        "summary": "List available templates (Percy Standard + user-saved).",
        "applies_to": ["*"],
        "destructive": False,
        "args": {"category": {"type": "string?", "desc": "Filter by category, e.g. 'Percy Standard'"}},
        "examples": [
            "Show me available templates",
            "List standard templates",
            "What templates can I apply",
        ],
    },
    {
        "id": "template.search",
        "method": "GET",
        "path": "/api/agent/templates/search",
        "summary": "Keyword search for templates by name, description, or tags.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "q":     {"type": "string", "desc": "Search query"},
            "limit": {"type": "number?", "desc": "Max results (default 5)"},
        },
        "examples": [
            "Find a template for a quarterly review",
            "Search templates with 'kpi'",
            "Look for an agenda template",
        ],
    },
    {
        "id": "template.apply",
        "method": "POST",
        "path": "/api/agent/templates/{template_id}/apply",
        "summary": "Materialize a template on a slide — creates all elements + connects + slide script.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "doc_id":  {"type": "string", "desc": "Document id"},
            "slide_n": {"type": "number", "desc": "Slide to apply onto"},
            "inputs":  {"type": "object?", "desc": "Values for the template's inputs_schema"},
        },
        "examples": [
            "Apply the title template with title='Q4 Update'",
            "Use the KPI tiles template with my three metrics",
            "Drop the section header template on slide 3",
            "Apply the live timeline template with 7 days",
        ],
    },

    # ─── Supplementary materials ───────────────────────────────────────────
    # Per-project file uploads — Python helpers, CSVs, reference docs. Used
    # by the coder skill for "fill in the gaps from my upload" workflows.

    {
        "id": "materials.list",
        "method": "GET",
        "path": "/api/docs/{doc_id}/materials",
        "summary": "List uploaded supplementary materials for this document (Python files, CSVs, reference text).",
        "applies_to": ["*"],
        "destructive": False,
        "args": {},
        "examples": [
            "What files have I uploaded",
            "List my supplementary materials",
        ],
    },
    {
        "id": "agent.retrieve_chunks",
        "method": "POST",
        "path": "/api/agent/retrieve_chunks",
        "summary": "Search uploaded supplementary code/text chunks by keyword.",
        "applies_to": ["*"],
        "destructive": False,
        "args": {
            "doc_id":       {"type": "string", "desc": "Document id"},
            "query":        {"type": "string", "desc": "Keyword query"},
            "top_k":        {"type": "number?", "desc": "Max chunks (default 5)"},
            "only_starter": {"type": "bool?", "desc": "Only chunks from files marked usable_as_starter"},
        },
        "examples": [
            "Find code in my uploads about revenue",
            "Search supplementary materials for 'pull'",
        ],
    },
]


def get_manifest() -> dict:
    return {
        "version":   MANIFEST_VERSION,
        "endpoints": ENDPOINTS,
    }
