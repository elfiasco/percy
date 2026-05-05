"""Percy Standard Templates — baked-in template library shipped with the agent.

Each template is a ready-to-apply layout that exercises a real use case. Most
are static layouts (just elements + positions); a couple use slide-level
scripts and live groups so the templates demonstrate the full capability
surface.

When the templates table is initialized, these are inserted (or refreshed) as
``is_builtin=1`` rows. Users can browse + apply them directly; saved-as-mine
copies become user templates with ``is_builtin=0``.

NOTE: dummy content for v1 — these will be customized per organization later
once the materials/template-authoring flow is in place.
"""

from __future__ import annotations

from percy.agent.templates import Template


# ── Standard slide width 13.333, height 7.5 ────────────────────────────────


STANDARD_TEMPLATES: list[Template] = [

    # ── 1. Title slide ─────────────────────────────────────────────────────
    Template(
        id="std.title",
        name="Title",
        description="Big centered title with optional subtitle. The opening slide for any deck.",
        category="Percy Standard",
        tags=["title", "opening", "cover", "intro"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": True,  "description": "Main title text"},
            "subtitle": {"type": "string", "required": False, "default": "", "description": "Optional subtitle"},
        },
        sample_inputs={"title": "Q4 2025 Board Update", "subtitle": "December 2025"},
        layout=[
            {
                "kind": "text", "alias": "title",
                "body": {
                    "text": "{{title}}",
                    "position": {"left_in": 0.5, "top_in": 2.8, "width_in": 12.33, "height_in": 1.5},
                    "font_size": 48, "font_bold": True, "text_color": "text", "text_align": "center",
                    "name": "Title",
                },
            },
            {
                "kind": "text", "alias": "subtitle",
                "body": {
                    "text": "{{subtitle}}",
                    "position": {"left_in": 0.5, "top_in": 4.5, "width_in": 12.33, "height_in": 0.8},
                    "font_size": 22, "text_color": "muted", "text_align": "center",
                    "name": "Subtitle",
                },
            },
        ],
    ),

    # ── 2. Section header ──────────────────────────────────────────────────
    Template(
        id="std.section_header",
        name="Section Header",
        description="Full-bleed dark band with a section title — divides a deck into chapters.",
        category="Percy Standard",
        tags=["section", "divider", "chapter"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": True, "description": "Section title"},
            "subtitle": {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={"title": "Financials", "subtitle": "Three quarters of progress"},
        layout=[
            {
                "kind": "shape", "alias": "background",
                "body": {
                    "geometry_preset": "rect",
                    "position": {"left_in": 0, "top_in": 0, "width_in": 13.333, "height_in": 7.5},
                    "fill_color": "text", "name": "Background",
                },
            },
            {
                "kind": "text", "alias": "title",
                "body": {
                    "text": "{{title}}",
                    "position": {"left_in": 1, "top_in": 2.8, "width_in": 11.33, "height_in": 1.5},
                    "font_size": 56, "font_bold": True, "text_color": "white", "text_align": "left",
                    "name": "Section Title",
                },
            },
            {
                "kind": "text", "alias": "subtitle",
                "body": {
                    "text": "{{subtitle}}",
                    "position": {"left_in": 1, "top_in": 4.5, "width_in": 11.33, "height_in": 0.8},
                    "font_size": 22, "text_color": "white", "text_align": "left",
                    "name": "Section Subtitle",
                },
            },
        ],
    ),

    # ── 3. Title + content ─────────────────────────────────────────────────
    Template(
        id="std.title_content",
        name="Title + Content",
        description="Standard content slide: title at top, body region below. The workhorse layout.",
        category="Percy Standard",
        tags=["content", "body", "default", "standard"],
        is_builtin=True,
        inputs_schema={
            "title": {"type": "string", "required": True},
            "body":  {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={"title": "Highlights", "body": "Key points here..."},
        layout=[
            {
                "kind": "text", "alias": "title",
                "body": {
                    "text": "{{title}}",
                    "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 1.0},
                    "font_size": 32, "font_bold": True, "text_color": "text", "name": "Title",
                },
            },
            {
                "kind": "text", "alias": "body",
                "body": {
                    "text": "{{body}}",
                    "position": {"left_in": 0.5, "top_in": 1.6, "width_in": 12.33, "height_in": 5.4},
                    "font_size": 18, "text_color": "text", "vertical_align": "top",
                    "name": "Body",
                },
            },
        ],
    ),

    # ── 4. Two-column comparison ───────────────────────────────────────────
    Template(
        id="std.two_column",
        name="Two-Column Comparison",
        description="Title with two side-by-side columns; great for before/after, pros/cons, or A/B.",
        category="Percy Standard",
        tags=["comparison", "two-column", "split"],
        is_builtin=True,
        inputs_schema={
            "title":          {"type": "string", "required": True},
            "left_heading":   {"type": "string", "required": False, "default": "Left"},
            "right_heading":  {"type": "string", "required": False, "default": "Right"},
            "left_body":      {"type": "string", "required": False, "default": ""},
            "right_body":     {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "title": "Before vs After",
            "left_heading": "Before", "right_heading": "After",
            "left_body": "Manual every week.", "right_body": "Automated, audited.",
        },
        layout=[
            {"kind": "text", "alias": "title",
             "body": {"text": "{{title}}",
                      "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 0.8},
                      "font_size": 30, "font_bold": True, "name": "Title"}},
            {"kind": "shape", "alias": "left_header",
             "body": {"geometry_preset": "rect",
                      "position": {"left_in": 0.5, "top_in": 1.5, "width_in": 5.9, "height_in": 0.7},
                      "fill_color": "accent1", "text": "{{left_heading}}",
                      "text_color": "white", "font_bold": True, "text_align": "center",
                      "name": "Left Header"}},
            {"kind": "text", "alias": "left_body",
             "body": {"text": "{{left_body}}",
                      "position": {"left_in": 0.5, "top_in": 2.4, "width_in": 5.9, "height_in": 4.5},
                      "font_size": 16, "vertical_align": "top",
                      "name": "Left Body"}},
            {"kind": "shape", "alias": "right_header",
             "body": {"geometry_preset": "rect",
                      "position": {"left_in": 6.93, "top_in": 1.5, "width_in": 5.9, "height_in": 0.7},
                      "fill_color": "accent2", "text": "{{right_heading}}",
                      "text_color": "white", "font_bold": True, "text_align": "center",
                      "name": "Right Header"}},
            {"kind": "text", "alias": "right_body",
             "body": {"text": "{{right_body}}",
                      "position": {"left_in": 6.93, "top_in": 2.4, "width_in": 5.9, "height_in": 4.5},
                      "font_size": 16, "vertical_align": "top",
                      "name": "Right Body"}},
        ],
    ),

    # ── 5. KPI tiles ───────────────────────────────────────────────────────
    Template(
        id="std.kpi_tiles",
        name="KPI Tiles",
        description="Three large stat cards across the slide for headline metrics.",
        category="Percy Standard",
        tags=["kpi", "stats", "tiles", "metrics"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": True, "default": "Key Metrics"},
            "metric_1_label": {"type": "string", "required": True},
            "metric_1_value": {"type": "string", "required": True},
            "metric_2_label": {"type": "string", "required": True},
            "metric_2_value": {"type": "string", "required": True},
            "metric_3_label": {"type": "string", "required": True},
            "metric_3_value": {"type": "string", "required": True},
        },
        sample_inputs={
            "title": "Q4 Highlights",
            "metric_1_label": "Revenue",     "metric_1_value": "$4.2M",
            "metric_2_label": "Net Retention","metric_2_value": "118%",
            "metric_3_label": "Headcount",   "metric_3_value": "68",
        },
        layout=[
            {"kind": "text", "alias": "title",
             "body": {"text": "{{title}}",
                      "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 0.8},
                      "font_size": 30, "font_bold": True, "name": "Title"}},
            # Tile 1
            {"kind": "shape", "alias": "tile_1",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 0.5, "top_in": 2.0, "width_in": 4.0, "height_in": 4.0},
                      "fill_color": "accent1", "name": "Tile 1"}},
            {"kind": "text", "alias": "metric_1_value",
             "body": {"text": "{{metric_1_value}}",
                      "position": {"left_in": 0.5, "top_in": 2.5, "width_in": 4.0, "height_in": 2.0},
                      "font_size": 64, "font_bold": True, "text_color": "white", "text_align": "center",
                      "name": "Metric 1 Value"}},
            {"kind": "text", "alias": "metric_1_label",
             "body": {"text": "{{metric_1_label}}",
                      "position": {"left_in": 0.5, "top_in": 4.7, "width_in": 4.0, "height_in": 0.8},
                      "font_size": 18, "text_color": "white", "text_align": "center",
                      "name": "Metric 1 Label"}},
            # Tile 2
            {"kind": "shape", "alias": "tile_2",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 4.67, "top_in": 2.0, "width_in": 4.0, "height_in": 4.0},
                      "fill_color": "accent2", "name": "Tile 2"}},
            {"kind": "text", "alias": "metric_2_value",
             "body": {"text": "{{metric_2_value}}",
                      "position": {"left_in": 4.67, "top_in": 2.5, "width_in": 4.0, "height_in": 2.0},
                      "font_size": 64, "font_bold": True, "text_color": "white", "text_align": "center",
                      "name": "Metric 2 Value"}},
            {"kind": "text", "alias": "metric_2_label",
             "body": {"text": "{{metric_2_label}}",
                      "position": {"left_in": 4.67, "top_in": 4.7, "width_in": 4.0, "height_in": 0.8},
                      "font_size": 18, "text_color": "white", "text_align": "center",
                      "name": "Metric 2 Label"}},
            # Tile 3
            {"kind": "shape", "alias": "tile_3",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 8.83, "top_in": 2.0, "width_in": 4.0, "height_in": 4.0},
                      "fill_color": "accent3", "name": "Tile 3"}},
            {"kind": "text", "alias": "metric_3_value",
             "body": {"text": "{{metric_3_value}}",
                      "position": {"left_in": 8.83, "top_in": 2.5, "width_in": 4.0, "height_in": 2.0},
                      "font_size": 64, "font_bold": True, "text_color": "white", "text_align": "center",
                      "name": "Metric 3 Value"}},
            {"kind": "text", "alias": "metric_3_label",
             "body": {"text": "{{metric_3_label}}",
                      "position": {"left_in": 8.83, "top_in": 4.7, "width_in": 4.0, "height_in": 0.8},
                      "font_size": 18, "text_color": "white", "text_align": "center",
                      "name": "Metric 3 Label"}},
        ],
    ),

    # ── 6. OKR quadrants ───────────────────────────────────────────────────
    Template(
        id="std.okr_quadrants",
        name="OKR Quadrants",
        description="2x2 grid for objectives + status across four areas.",
        category="Percy Standard",
        tags=["okr", "quadrant", "matrix", "status"],
        is_builtin=True,
        inputs_schema={
            "title":  {"type": "string", "required": True, "default": "OKRs"},
            "q1_text":{"type": "string", "required": False, "default": "Quadrant 1"},
            "q2_text":{"type": "string", "required": False, "default": "Quadrant 2"},
            "q3_text":{"type": "string", "required": False, "default": "Quadrant 3"},
            "q4_text":{"type": "string", "required": False, "default": "Quadrant 4"},
        },
        sample_inputs={
            "title": "Q4 OKRs",
            "q1_text": "Revenue: $4M target ✓",
            "q2_text": "Net retention: 110% target ✓",
            "q3_text": "Hire 12 engineers ◐",
            "q4_text": "Ship Studio v2 ◐",
        },
        layout=[
            {"kind": "text", "alias": "title",
             "body": {"text": "{{title}}",
                      "position": {"left_in": 0.5, "top_in": 0.3, "width_in": 12.33, "height_in": 0.7},
                      "font_size": 28, "font_bold": True, "name": "Title"}},
            {"kind": "shape", "alias": "q1_box",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 0.5, "top_in": 1.2, "width_in": 5.9, "height_in": 2.9},
                      "fill_color": "accent1 +85%", "border_color": "accent1", "border_width": 1.5,
                      "text": "{{q1_text}}", "font_size": 16, "text_align": "left", "vertical_align": "top",
                      "name": "Q1"}},
            {"kind": "shape", "alias": "q2_box",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 6.93, "top_in": 1.2, "width_in": 5.9, "height_in": 2.9},
                      "fill_color": "accent2 +85%", "border_color": "accent2", "border_width": 1.5,
                      "text": "{{q2_text}}", "font_size": 16, "text_align": "left", "vertical_align": "top",
                      "name": "Q2"}},
            {"kind": "shape", "alias": "q3_box",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 0.5, "top_in": 4.2, "width_in": 5.9, "height_in": 2.9},
                      "fill_color": "accent3 +85%", "border_color": "accent3", "border_width": 1.5,
                      "text": "{{q3_text}}", "font_size": 16, "text_align": "left", "vertical_align": "top",
                      "name": "Q3"}},
            {"kind": "shape", "alias": "q4_box",
             "body": {"geometry_preset": "roundRect",
                      "position": {"left_in": 6.93, "top_in": 4.2, "width_in": 5.9, "height_in": 2.9},
                      "fill_color": "accent1 +85%", "border_color": "accent1", "border_width": 1.5,
                      "text": "{{q4_text}}", "font_size": 16, "text_align": "left", "vertical_align": "top",
                      "name": "Q4"}},
        ],
    ),

    # ── 7. Agenda ──────────────────────────────────────────────────────────
    Template(
        id="std.agenda",
        name="Agenda",
        description="Title + numbered list of topics. Drop one in at the start of every meeting deck.",
        category="Percy Standard",
        tags=["agenda", "outline", "intro"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": True, "default": "Agenda"},
            "items":    {"type": "string", "required": True, "description": "Newline-separated agenda items"},
        },
        sample_inputs={
            "title": "Agenda",
            "items": "Q4 financials\nProduct update\nHiring plan\nBoard discussion",
        },
        layout=[
            {"kind": "text", "alias": "title",
             "body": {"text": "{{title}}",
                      "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 1.0},
                      "font_size": 36, "font_bold": True, "name": "Title"}},
            {"kind": "text", "alias": "items",
             "body": {"text": "{{items}}",
                      "position": {"left_in": 0.5, "top_in": 1.8, "width_in": 12.33, "height_in": 5.0},
                      "font_size": 22, "text_color": "text",
                      "name": "Agenda Items"}},
        ],
    ),

    # ── 8. Live Timeline ───────────────────────────────────────────────────
    # Demonstrates a live-group template — children are produced by a script.
    Template(
        id="std.live_timeline",
        name="Live Timeline (data-driven)",
        description="Live group: one bar per day in the date range. Regenerate with new dates to refresh.",
        category="Percy Standard",
        tags=["timeline", "live", "scripted", "schedule"],
        is_builtin=True,
        inputs_schema={
            "title":     {"type": "string", "required": True, "default": "Sprint Timeline"},
            "day_count": {"type": "number", "required": True, "default": 7,
                          "description": "How many days to render"},
            "labels":    {"type": "string", "required": False, "default": "",
                          "description": "Comma-separated day labels (optional)"},
        },
        sample_inputs={"title": "Next 7 Days", "day_count": 7, "labels": "Mon,Tue,Wed,Thu,Fri,Sat,Sun"},
        layout=[
            {"kind": "text", "alias": "title",
             "body": {"text": "{{title}}",
                      "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12.33, "height_in": 1.0},
                      "font_size": 28, "font_bold": True, "name": "Title"}},
            {"kind": "live-group", "alias": "timeline",
             "body": {
                 "position": {"left_in": 0.5, "top_in": 2.0, "width_in": 12.33, "height_in": 3.0},
                 "name": "Timeline",
                 "generator_inputs": {"day_count": "{{day_count}}", "labels": "{{labels}}"},
                 "run_on_create": True,
                 "generator_script": (
                     "def generate(group, inputs, studio):\n"
                     "    n = int(inputs.get('day_count') or 7)\n"
                     "    raw = inputs.get('labels') or ''\n"
                     "    labels = [s.strip() for s in raw.split(',')] if raw else [str(i+1) for i in range(n)]\n"
                     "    if len(labels) < n:\n"
                     "        labels = labels + [str(i+1) for i in range(len(labels), n)]\n"
                     "    bar_width = group.width / max(1, n)\n"
                     "    for i in range(n):\n"
                     "        group.add_child('shape', {\n"
                     "            'geometry_preset': 'roundRect',\n"
                     "            'position': {\n"
                     "                'left_in': group.left + i * bar_width + 0.05,\n"
                     "                'top_in':  group.top + 0.6,\n"
                     "                'width_in':  bar_width - 0.1,\n"
                     "                'height_in': group.height - 0.7,\n"
                     "            },\n"
                     "            'fill_color': 'accent1' if i % 2 == 0 else 'accent2',\n"
                     "            'text': labels[i] if i < len(labels) else str(i+1),\n"
                     "            'text_color': 'white',\n"
                     "            'font_bold': True,\n"
                     "            'text_align': 'center',\n"
                     "        })\n"
                 ),
             }},
        ],
    ),
]
