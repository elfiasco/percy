"""Percy Standard Templates — the canonical, exhaustive built-in library.

Every Template Set in every org has access to these by default. They model
Percy's own visual identity (warm cream / powder cobalt / sage) so a deck
built with the defaults still looks intentional — not a generic Office
"Title and Content" layout.

Visual language:

  * Canvas: 13.333 x 7.5 inches (16:9)
  * Background: warm cream  #F9F8F4
  * Body text: warm slate   #2A2F3A
  * Muted:                  #6A6F7A
  * Accent (cobalt):        #7DA1CC
  * Accent light:           #A4BEDC
  * Secondary (sage):       #6FA17A
  * Warm cream highlight:   #F0E6D8
  * Status — good / warn / bad: #6FA17A / #C5994A / #B8634F
  * Heading font:           "Inter"  (semibold for titles, regular elsewhere)
  * Monospace numbers:      "JetBrains Mono"

Each layout is parameterized via ``inputs_schema``; placeholders use the
``{{var}}`` substitution the Template engine already supports. Defaults
are realistic so a one-click apply produces a sensible-looking slide
without any further edits.

This file is the source of truth for:
  * The agent's templates list (seeded into the agent templates SQLite)
  * The "Percy Standard" Template Set (seeded into studio_templates with
    is_builtin=1; every user sees it alongside their org's own sets)

To add a new builtin: append a ``Template(...)`` here, then re-import — the
seeding logic runs idempotently on every app boot.
"""

from __future__ import annotations

from percy.agent.templates import Template


# ── Percy palette tokens used throughout ───────────────────────────────────
_INK   = "#F9F8F4"   # background
_PAPER = "#2A2F3A"   # primary text
_MUTED = "#6A6F7A"   # captions / footers
_ACCENT      = "#7DA1CC"   # cobalt — primary accent
_ACCENT_LITE = "#A4BEDC"   # cobalt-light — softer accents
_SAGE        = "#6FA17A"   # secondary
_CREAM       = "#F0E6D8"   # warm cream highlight
_OCHRE       = "#C5994A"   # warning / warn status
_BRICK       = "#B8634F"   # danger / bad status
_FONT        = "Inter"
_FONT_MONO   = "JetBrains Mono"


def _pos(left: float, top: float, width: float, height: float) -> dict:
    return {"left_in": left, "top_in": top, "width_in": width, "height_in": height}


# Shared accent-color input used by every "storytelling" template (titles,
# section dividers, big numbers, quotes, closing). The agent reads this
# description verbatim — keep the named-hex hints; they're how the agent
# picks contextually appropriate colors when generating a deck.
#
# Pattern: storytelling templates use `{{accent}}` for any rule/eyebrow/bar
# fill_color. Default is Percy's cobalt — passing a different hex gives the
# slide a different "mood" without touching the template.
ACCENT_INPUT = {
    "accent": {
        "type": "string",
        "required": False,
        "default": _ACCENT,
        "description": (
            "Accent color. Percy named hexes: "
            "cobalt #7DA1CC (default — neutral / corporate), "
            "sage #6FA17A (technical / good / on-track), "
            "ochre #C5994A (warning / at-risk), "
            "brick #B8634F (problem / blocked / urgent), "
            "cobalt-lt #A4BEDC (soft variant). Any custom hex also works."
        ),
    },
}


# Layout helpers used by multi-item templates (defined here so the
# STANDARD_TEMPLATES literal below can reference them via *(_quadrant(...))).


def _agenda_item(idx: int, top: float) -> dict:
    """One agenda row: number + item + minutes inline."""
    return {
        "kind": "text", "alias": f"a{idx}", "body": {
            "text": f"0{idx}    {{{{item{idx}}}}}    {{{{item{idx}_min}}}}",
            "position": _pos(0.5, top, 12.33, 0.7),
            "font_name": _FONT, "font_size": 22,
            "text_color": _PAPER, "name": f"Agenda {idx}",
        },
    }


def _quadrant(prefix: str, left: float, top: float, width: float, height: float,
                tint: str) -> list[dict]:
    """A single OKR quadrant: cream card + tint rule + title + body."""
    return [
        {"kind": "shape", "alias": f"{prefix}_card", "body": {
            "geometry_preset": "rect", "position": _pos(left, top, width, height),
            "fill_color": _CREAM, "line": {"visible": False}, "name": f"{prefix} card",
        }},
        {"kind": "shape", "alias": f"{prefix}_rule", "body": {
            "geometry_preset": "rect", "position": _pos(left, top, 0.04, height),
            "fill_color": tint, "line": {"visible": False}, "name": f"{prefix} rule",
        }},
        {"kind": "text", "alias": f"{prefix}_title", "body": {
            "text": f"{{{{{prefix}_title}}}}",
            "position": _pos(left + 0.25, top + 0.25, width - 0.5, 0.6),
            "font_name": _FONT, "font_size": 20, "font_bold": True,
            "text_color": _PAPER, "name": f"{prefix} title",
        }},
        {"kind": "text", "alias": f"{prefix}_body", "body": {
            "text": f"{{{{{prefix}_body}}}}",
            "position": _pos(left + 0.25, top + 0.95, width - 0.5, height - 1.2),
            "font_name": _FONT, "font_size": 14,
            "text_color": _PAPER, "name": f"{prefix} body",
        }},
    ]


STANDARD_TEMPLATES: list[Template] = [

    # ────────────────────────────────────────────────────────────────────────
    # SLIDE TEMPLATES — full-slide layouts
    # ────────────────────────────────────────────────────────────────────────

    # 1. Title slide
    Template(
        id="std.title",
        name="Title",
        description="Cover slide. Big heading, optional subtitle, accent rule, and presenter line. Accent color is parameterized — use it to signal mood (cobalt for default, sage for technical, brick for urgent).",
        category="Percy Standard",
        tags=["title", "cover", "opening", "intro"],
        is_builtin=True,
        inputs_schema={
            "title":     {"type": "string", "required": True,  "description": "Main heading"},
            "subtitle":  {"type": "string", "required": False, "default": "", "description": "Optional second line"},
            "presenter": {"type": "string", "required": False, "default": "", "description": "Presenter or team name"},
            "date":      {"type": "string", "required": False, "default": "", "description": "Date (free-form)"},
            **ACCENT_INPUT,
        },
        sample_inputs={
            "title": "Q4 board update",
            "subtitle": "Three months, three commitments shipped.",
            "presenter": "Operations team",
            "date": "December 2025",
            "accent": _ACCENT,
        },
        layout=[
            {"kind": "shape", "alias": "accent_rule", "body": {
                "geometry_preset": "rect",
                "position": _pos(0.5, 4.55, 1.0, 0.04),
                "fill_color": "{{accent}}", "line": {"visible": False},
                "name": "Accent rule",
            }},
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}",
                "position": _pos(0.5, 2.6, 12.33, 1.8),
                "font_name": _FONT, "font_size": 52, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Title",
            }},
            {"kind": "text", "alias": "subtitle", "body": {
                "text": "{{subtitle}}",
                "position": _pos(0.5, 4.7, 12.33, 0.7),
                "font_name": _FONT, "font_size": 22,
                "text_color": _MUTED, "text_align": "left", "name": "Subtitle",
            }},
            {"kind": "text", "alias": "presenter", "body": {
                "text": "{{presenter}} · {{date}}",
                "position": _pos(0.5, 6.7, 12.33, 0.4),
                "font_name": _FONT, "font_size": 11,
                "text_color": _MUTED, "text_align": "left", "name": "Footer",
            }},
        ],
    ),

    # 2. Section divider
    Template(
        id="std.section_header",
        name="Section Header",
        description="Chapter break: oversized number + section title with cream side bar. Accent color sets the mood — vary it across sections (cobalt / sage / ochre / brick) for visual rhythm.",
        category="Percy Standard",
        tags=["section", "divider", "chapter"],
        is_builtin=True,
        inputs_schema={
            "section_number": {"type": "string", "required": False, "default": "01"},
            "title":          {"type": "string", "required": True, "description": "Section title"},
            "subtitle":       {"type": "string", "required": False, "default": ""},
            **ACCENT_INPUT,
        },
        sample_inputs={"section_number": "02", "title": "Financials", "subtitle": "Three quarters of compounding", "accent": _ACCENT},
        layout=[
            {"kind": "shape", "alias": "side_bar", "body": {
                "geometry_preset": "rect",
                "position": _pos(0, 0, 3.5, 7.5),
                "fill_color": _CREAM, "line": {"visible": False},
                "name": "Side bar",
            }},
            {"kind": "text", "alias": "section_num", "body": {
                "text": "{{section_number}}",
                "position": _pos(0.5, 0.6, 2.5, 3.5),
                "font_name": _FONT_MONO, "font_size": 140, "font_bold": True,
                "text_color": "{{accent}}", "text_align": "left", "name": "Section number",
            }},
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}",
                "position": _pos(4.2, 2.9, 8.6, 1.4),
                "font_name": _FONT, "font_size": 48, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Section title",
            }},
            {"kind": "text", "alias": "subtitle", "body": {
                "text": "{{subtitle}}",
                "position": _pos(4.2, 4.4, 8.6, 0.6),
                "font_name": _FONT, "font_size": 18,
                "text_color": _MUTED, "text_align": "left", "name": "Subtitle",
            }},
        ],
    ),

    # 3. Title + Content
    Template(
        id="std.title_content",
        name="Title and Content",
        description="Workhorse layout: heading, supporting paragraph, footer with eyebrow tag.",
        category="Percy Standard",
        tags=["text", "content", "body", "standard"],
        is_builtin=True,
        inputs_schema={
            "eyebrow": {"type": "string", "required": False, "default": ""},
            "title":   {"type": "string", "required": True},
            "body":    {"type": "string", "required": True, "description": "Body paragraph"},
            "footer":  {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "eyebrow": "WHAT CHANGED",
            "title": "We moved off Postgres-on-RDS to Aurora Serverless.",
            "body": "The migration finished on Nov 12. Read latency dropped 38% on the customer-facing queries; cost held flat. Two side benefits worth flagging: point-in-time restore is now seconds, not minutes, and our staging environment auto-pauses overnight.",
            "footer": "Read more: docs/aurora-migration.md",
        },
        layout=[
            {"kind": "text", "alias": "eyebrow", "body": {
                "text": "{{eyebrow}}",
                "position": _pos(0.5, 0.55, 12.33, 0.35),
                "font_name": _FONT, "font_size": 10, "font_bold": True,
                "text_color": _ACCENT, "text_align": "left", "name": "Eyebrow",
            }},
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}",
                "position": _pos(0.5, 1.0, 12.33, 1.2),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Title",
            }},
            {"kind": "text", "alias": "body", "body": {
                "text": "{{body}}",
                "position": _pos(0.5, 2.4, 12.33, 4.0),
                "font_name": _FONT, "font_size": 16,
                "text_color": _PAPER, "text_align": "left", "name": "Body",
            }},
            {"kind": "text", "alias": "footer", "body": {
                "text": "{{footer}}",
                "position": _pos(0.5, 7.0, 12.33, 0.3),
                "font_name": _FONT, "font_size": 10,
                "text_color": _MUTED, "text_align": "left", "name": "Footer",
            }},
        ],
    ),

    # 4. Two-Column
    Template(
        id="std.two_column",
        name="Two Column",
        description="Two side-by-side text blocks under a heading. Compare / contrast.",
        category="Percy Standard",
        tags=["two-column", "compare", "split"],
        is_builtin=True,
        inputs_schema={
            "title":       {"type": "string", "required": True},
            "left_label":  {"type": "string", "required": True},
            "left_body":   {"type": "string", "required": True},
            "right_label": {"type": "string", "required": True},
            "right_body":  {"type": "string", "required": True},
        },
        sample_inputs={
            "title": "What changed, what didn't",
            "left_label": "Before",
            "left_body": "Manual exports every Monday. Two people, half a day each. Schema drift every quarter.",
            "right_label": "After",
            "right_body": "Cron-driven refresh through the studio. One owner, alerts in Slack. Schema validated at ingest.",
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.6, 12.33, 1.0),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Title",
            }},
            {"kind": "shape", "alias": "left_card", "body": {
                "geometry_preset": "rect",
                "position": _pos(0.5, 2.0, 5.9, 4.6),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Left card",
            }},
            {"kind": "text", "alias": "left_label", "body": {
                "text": "{{left_label}}",
                "position": _pos(0.85, 2.25, 5.4, 0.4),
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_color": _ACCENT, "text_align": "left", "name": "Left label",
            }},
            {"kind": "text", "alias": "left_body", "body": {
                "text": "{{left_body}}",
                "position": _pos(0.85, 2.7, 5.4, 3.7),
                "font_name": _FONT, "font_size": 16,
                "text_color": _PAPER, "text_align": "left", "name": "Left body",
            }},
            {"kind": "shape", "alias": "right_card", "body": {
                "geometry_preset": "rect",
                "position": _pos(6.95, 2.0, 5.9, 4.6),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Right card",
            }},
            {"kind": "text", "alias": "right_label", "body": {
                "text": "{{right_label}}",
                "position": _pos(7.3, 2.25, 5.4, 0.4),
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_color": _ACCENT, "text_align": "left", "name": "Right label",
            }},
            {"kind": "text", "alias": "right_body", "body": {
                "text": "{{right_body}}",
                "position": _pos(7.3, 2.7, 5.4, 3.7),
                "font_name": _FONT, "font_size": 16,
                "text_color": _PAPER, "text_align": "left", "name": "Right body",
            }},
        ],
    ),

    # 5. KPI Tiles (three)
    Template(
        id="std.kpi_tiles",
        name="KPI Tiles (3)",
        description="Three large metrics side-by-side. Number + label + optional delta.",
        category="Percy Standard",
        tags=["kpi", "metrics", "dashboard", "numbers"],
        is_builtin=True,
        inputs_schema={
            "title":  {"type": "string", "required": False, "default": "Snapshot"},
            "kpi1_value": {"type": "string", "required": True},
            "kpi1_label": {"type": "string", "required": True},
            "kpi1_delta": {"type": "string", "required": False, "default": ""},
            "kpi2_value": {"type": "string", "required": True},
            "kpi2_label": {"type": "string", "required": True},
            "kpi2_delta": {"type": "string", "required": False, "default": ""},
            "kpi3_value": {"type": "string", "required": True},
            "kpi3_label": {"type": "string", "required": True},
            "kpi3_delta": {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "title": "Q4 at a glance",
            "kpi1_value": "$2.4M", "kpi1_label": "ARR added",      "kpi1_delta": "▲ 18% QoQ",
            "kpi2_value": "98.7%", "kpi2_label": "Gross retention", "kpi2_delta": "▲ 1.2 pts",
            "kpi3_value": "47",    "kpi3_label": "Logos closed",    "kpi3_delta": "▼ 4 vs Q3",
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.6, 12.33, 0.8),
                "font_name": _FONT, "font_size": 28, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            # Tile 1
            {"kind": "shape", "alias": "tile1", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.0, 4.1, 4.7),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Tile 1",
            }},
            {"kind": "text", "alias": "k1v", "body": {
                "text": "{{kpi1_value}}", "position": _pos(0.7, 2.6, 3.7, 1.7),
                "font_name": _FONT_MONO, "font_size": 64, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "KPI 1 value",
            }},
            {"kind": "text", "alias": "k1l", "body": {
                "text": "{{kpi1_label}}", "position": _pos(0.7, 4.5, 3.7, 0.6),
                "font_name": _FONT, "font_size": 14, "text_color": _PAPER, "name": "KPI 1 label",
            }},
            {"kind": "text", "alias": "k1d", "body": {
                "text": "{{kpi1_delta}}", "position": _pos(0.7, 5.2, 3.7, 0.4),
                "font_name": _FONT_MONO, "font_size": 12, "text_color": _SAGE, "name": "KPI 1 delta",
            }},
            # Tile 2
            {"kind": "shape", "alias": "tile2", "body": {
                "geometry_preset": "rect", "position": _pos(4.85, 2.0, 4.1, 4.7),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Tile 2",
            }},
            {"kind": "text", "alias": "k2v", "body": {
                "text": "{{kpi2_value}}", "position": _pos(5.05, 2.6, 3.7, 1.7),
                "font_name": _FONT_MONO, "font_size": 64, "font_bold": True,
                "text_color": _PAPER, "name": "KPI 2 value",
            }},
            {"kind": "text", "alias": "k2l", "body": {
                "text": "{{kpi2_label}}", "position": _pos(5.05, 4.5, 3.7, 0.6),
                "font_name": _FONT, "font_size": 14, "text_color": _PAPER, "name": "KPI 2 label",
            }},
            {"kind": "text", "alias": "k2d", "body": {
                "text": "{{kpi2_delta}}", "position": _pos(5.05, 5.2, 3.7, 0.4),
                "font_name": _FONT_MONO, "font_size": 12, "text_color": _SAGE, "name": "KPI 2 delta",
            }},
            # Tile 3
            {"kind": "shape", "alias": "tile3", "body": {
                "geometry_preset": "rect", "position": _pos(9.2, 2.0, 4.1, 4.7),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Tile 3",
            }},
            {"kind": "text", "alias": "k3v", "body": {
                "text": "{{kpi3_value}}", "position": _pos(9.4, 2.6, 3.7, 1.7),
                "font_name": _FONT_MONO, "font_size": 64, "font_bold": True,
                "text_color": _PAPER, "name": "KPI 3 value",
            }},
            {"kind": "text", "alias": "k3l", "body": {
                "text": "{{kpi3_label}}", "position": _pos(9.4, 4.5, 3.7, 0.6),
                "font_name": _FONT, "font_size": 14, "text_color": _PAPER, "name": "KPI 3 label",
            }},
            {"kind": "text", "alias": "k3d", "body": {
                "text": "{{kpi3_delta}}", "position": _pos(9.4, 5.2, 3.7, 0.4),
                "font_name": _FONT_MONO, "font_size": 12, "text_color": _BRICK, "name": "KPI 3 delta",
            }},
        ],
    ),

    # 6. Big Number — single metric center-stage
    Template(
        id="std.big_number",
        name="Big Number",
        description="Single dominant metric. Use sparingly — the slide IS the number. Accent color sets the eyebrow tone.",
        category="Percy Standard",
        tags=["kpi", "single", "number", "hero"],
        is_builtin=True,
        inputs_schema={
            "eyebrow": {"type": "string", "required": False, "default": ""},
            "value":   {"type": "string", "required": True, "description": "The headline number"},
            "label":   {"type": "string", "required": True, "description": "What it measures"},
            "context": {"type": "string", "required": False, "default": "", "description": "Sentence below for context"},
            **ACCENT_INPUT,
        },
        sample_inputs={
            "eyebrow": "Q4 ARR ADDED",
            "value": "$2.4M",
            "label": "Net new annual recurring revenue",
            "context": "Largest single quarter in our history. Up 18% QoQ.",
            "accent": _ACCENT,
        },
        layout=[
            {"kind": "text", "alias": "eyebrow", "body": {
                "text": "{{eyebrow}}", "position": _pos(0.5, 1.2, 12.33, 0.5),
                "font_name": _FONT, "font_size": 14, "font_bold": True,
                "text_color": "{{accent}}", "text_align": "center", "name": "Eyebrow",
            }},
            {"kind": "text", "alias": "value", "body": {
                "text": "{{value}}", "position": _pos(0.5, 2.0, 12.33, 3.2),
                "font_name": _FONT_MONO, "font_size": 200, "font_bold": True,
                "text_color": _PAPER, "text_align": "center", "name": "Value",
            }},
            {"kind": "text", "alias": "label", "body": {
                "text": "{{label}}", "position": _pos(0.5, 5.5, 12.33, 0.7),
                "font_name": _FONT, "font_size": 24,
                "text_color": _PAPER, "text_align": "center", "name": "Label",
            }},
            {"kind": "text", "alias": "context", "body": {
                "text": "{{context}}", "position": _pos(1.5, 6.4, 10.33, 0.6),
                "font_name": _FONT, "font_size": 14,
                "text_color": _MUTED, "text_align": "center", "name": "Context",
            }},
        ],
    ),

    # 7. Quote / Pull quote
    Template(
        id="std.quote",
        name="Quote",
        description="Pull quote with attribution. Accent rule color sets the mood.",
        category="Percy Standard",
        tags=["quote", "testimonial", "pullquote"],
        is_builtin=True,
        inputs_schema={
            "quote":       {"type": "string", "required": True},
            "attribution": {"type": "string", "required": False, "default": ""},
            "context":     {"type": "string", "required": False, "default": ""},
            **ACCENT_INPUT,
        },
        sample_inputs={
            "quote": "We replaced three internal tools with Percy. The team's first decks shipped the next day.",
            "attribution": "VP Operations",
            "context": "Series B SaaS company, 280 employees",
            "accent": _ACCENT,
        },
        layout=[
            {"kind": "shape", "alias": "rule", "body": {
                "geometry_preset": "rect", "position": _pos(1.5, 2.0, 0.6, 0.04),
                "fill_color": "{{accent}}", "line": {"visible": False}, "name": "Accent rule",
            }},
            {"kind": "text", "alias": "quote", "body": {
                "text": "“{{quote}}”",
                "position": _pos(1.5, 2.3, 10.33, 3.0),
                "font_name": _FONT, "font_size": 36, "font_italic": True,
                "text_color": _PAPER, "text_align": "left", "name": "Quote",
            }},
            {"kind": "text", "alias": "attribution", "body": {
                "text": "{{attribution}}", "position": _pos(1.5, 5.6, 10.33, 0.4),
                "font_name": _FONT, "font_size": 16, "font_bold": True,
                "text_color": _PAPER, "name": "Attribution",
            }},
            {"kind": "text", "alias": "context", "body": {
                "text": "{{context}}", "position": _pos(1.5, 6.1, 10.33, 0.4),
                "font_name": _FONT, "font_size": 12,
                "text_color": _MUTED, "name": "Context",
            }},
        ],
    ),

    # 8. Chart Focus — title + chart placeholder + takeaway
    Template(
        id="std.chart_focus",
        name="Chart Focus",
        description="Headline above, takeaway below, chart in the middle. Caller adds the chart element after applying. Accent color drives the takeaway rule.",
        category="Percy Standard",
        tags=["chart", "data", "viz"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": True},
            "takeaway": {"type": "string", "required": True, "description": "The key insight in plain English"},
            "source":   {"type": "string", "required": False, "default": ""},
            **ACCENT_INPUT,
        },
        sample_inputs={
            "title": "Net retention is back above 110%",
            "takeaway": "Expansion in mid-market accounts (red bars) is now outpacing churn for the second straight quarter.",
            "source": "Source: Salesforce, weekly snapshot 2025-12-12",
            "accent": _ACCENT,
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.5, 12.33, 0.9),
                "font_name": _FONT, "font_size": 28, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            {"kind": "shape", "alias": "chart_placeholder", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 1.6, 12.33, 4.5),
                "fill_color": _CREAM, "line": {"visible": False},
                "name": "Chart placeholder",
                "text": "[CHART GOES HERE]",
            }},
            {"kind": "shape", "alias": "takeaway_rule", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 6.3, 0.04, 0.5),
                "fill_color": "{{accent}}", "line": {"visible": False}, "name": "Takeaway rule",
            }},
            {"kind": "text", "alias": "takeaway", "body": {
                "text": "{{takeaway}}", "position": _pos(0.75, 6.25, 11.0, 0.6),
                "font_name": _FONT, "font_size": 14, "font_italic": True,
                "text_color": _PAPER, "name": "Takeaway",
            }},
            {"kind": "text", "alias": "source", "body": {
                "text": "{{source}}", "position": _pos(0.75, 6.9, 11.0, 0.3),
                "font_name": _FONT, "font_size": 9,
                "text_color": _MUTED, "name": "Source",
            }},
        ],
    ),

    # 9. Three Columns
    Template(
        id="std.three_columns",
        name="Three Columns",
        description="Three feature/value columns under a heading. Each column has an eyebrow, body, and accent rule.",
        category="Percy Standard",
        tags=["three-column", "features", "grid"],
        is_builtin=True,
        inputs_schema={
            "title":   {"type": "string", "required": True},
            "col1_label": {"type": "string", "required": True},
            "col1_body":  {"type": "string", "required": True},
            "col2_label": {"type": "string", "required": True},
            "col2_body":  {"type": "string", "required": True},
            "col3_label": {"type": "string", "required": True},
            "col3_body":  {"type": "string", "required": True},
        },
        sample_inputs={
            "title": "How Percy compares",
            "col1_label": "Faster",
            "col1_body": "From upload to a brand-safe deck in under 90 seconds — without a designer.",
            "col2_label": "Safer",
            "col2_body": "Brand checks block off-palette colors before they ship. Templates lock to your style.",
            "col3_label": "Smarter",
            "col3_body": "The agent learns from your past decks. Every refresh inherits the team's choices.",
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.6, 12.33, 1.0),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            # Column 1
            {"kind": "shape", "alias": "rule1", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.2, 0.6, 0.04),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Rule 1",
            }},
            {"kind": "text", "alias": "c1l", "body": {
                "text": "{{col1_label}}", "position": _pos(0.5, 2.4, 4.0, 0.6),
                "font_name": _FONT, "font_size": 20, "font_bold": True,
                "text_color": _PAPER, "name": "Col 1 label",
            }},
            {"kind": "text", "alias": "c1b", "body": {
                "text": "{{col1_body}}", "position": _pos(0.5, 3.1, 4.0, 3.6),
                "font_name": _FONT, "font_size": 14,
                "text_color": _PAPER, "name": "Col 1 body",
            }},
            # Column 2
            {"kind": "shape", "alias": "rule2", "body": {
                "geometry_preset": "rect", "position": _pos(4.7, 2.2, 0.6, 0.04),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Rule 2",
            }},
            {"kind": "text", "alias": "c2l", "body": {
                "text": "{{col2_label}}", "position": _pos(4.7, 2.4, 4.0, 0.6),
                "font_name": _FONT, "font_size": 20, "font_bold": True,
                "text_color": _PAPER, "name": "Col 2 label",
            }},
            {"kind": "text", "alias": "c2b", "body": {
                "text": "{{col2_body}}", "position": _pos(4.7, 3.1, 4.0, 3.6),
                "font_name": _FONT, "font_size": 14,
                "text_color": _PAPER, "name": "Col 2 body",
            }},
            # Column 3
            {"kind": "shape", "alias": "rule3", "body": {
                "geometry_preset": "rect", "position": _pos(8.9, 2.2, 0.6, 0.04),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Rule 3",
            }},
            {"kind": "text", "alias": "c3l", "body": {
                "text": "{{col3_label}}", "position": _pos(8.9, 2.4, 4.0, 0.6),
                "font_name": _FONT, "font_size": 20, "font_bold": True,
                "text_color": _PAPER, "name": "Col 3 label",
            }},
            {"kind": "text", "alias": "c3b", "body": {
                "text": "{{col3_body}}", "position": _pos(8.9, 3.1, 4.0, 3.6),
                "font_name": _FONT, "font_size": 14,
                "text_color": _PAPER, "name": "Col 3 body",
            }},
        ],
    ),

    # 10. Bullet List — em-dash bullets
    Template(
        id="std.bullet_list",
        name="Bullet List",
        description="Sparse em-dash bulleted list. Up to 5 items.",
        category="Percy Standard",
        tags=["bullets", "list", "agenda"],
        is_builtin=True,
        inputs_schema={
            "title":   {"type": "string", "required": True},
            "item1":   {"type": "string", "required": True},
            "item2":   {"type": "string", "required": False, "default": ""},
            "item3":   {"type": "string", "required": False, "default": ""},
            "item4":   {"type": "string", "required": False, "default": ""},
            "item5":   {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "title": "What we'll cover today",
            "item1": "Where the metrics landed for Q4 — three wins, one miss.",
            "item2": "The two product bets that paid off, and the one we're killing.",
            "item3": "What the team needs from the board before January.",
            "item4": "Open Q&A.",
            "item5": "",
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.6, 12.33, 1.0),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            {"kind": "text", "alias": "i1", "body": {
                "text": "—  {{item1}}", "position": _pos(0.7, 2.0, 12.1, 0.8),
                "font_name": _FONT, "font_size": 20, "text_color": _PAPER, "name": "Item 1",
            }},
            {"kind": "text", "alias": "i2", "body": {
                "text": "—  {{item2}}", "position": _pos(0.7, 2.9, 12.1, 0.8),
                "font_name": _FONT, "font_size": 20, "text_color": _PAPER, "name": "Item 2",
            }},
            {"kind": "text", "alias": "i3", "body": {
                "text": "—  {{item3}}", "position": _pos(0.7, 3.8, 12.1, 0.8),
                "font_name": _FONT, "font_size": 20, "text_color": _PAPER, "name": "Item 3",
            }},
            {"kind": "text", "alias": "i4", "body": {
                "text": "—  {{item4}}", "position": _pos(0.7, 4.7, 12.1, 0.8),
                "font_name": _FONT, "font_size": 20, "text_color": _PAPER, "name": "Item 4",
            }},
            {"kind": "text", "alias": "i5", "body": {
                "text": "—  {{item5}}", "position": _pos(0.7, 5.6, 12.1, 0.8),
                "font_name": _FONT, "font_size": 20, "text_color": _PAPER, "name": "Item 5",
            }},
        ],
    ),

    # 11. Agenda
    Template(
        id="std.agenda",
        name="Agenda",
        description="Numbered agenda. Up to 5 sections with optional time estimates.",
        category="Percy Standard",
        tags=["agenda", "intro", "outline"],
        is_builtin=True,
        inputs_schema={
            "title":    {"type": "string", "required": False, "default": "Agenda"},
            "item1":    {"type": "string", "required": True},
            "item1_min":{"type": "string", "required": False, "default": ""},
            "item2":    {"type": "string", "required": False, "default": ""},
            "item2_min":{"type": "string", "required": False, "default": ""},
            "item3":    {"type": "string", "required": False, "default": ""},
            "item3_min":{"type": "string", "required": False, "default": ""},
            "item4":    {"type": "string", "required": False, "default": ""},
            "item4_min":{"type": "string", "required": False, "default": ""},
            "item5":    {"type": "string", "required": False, "default": ""},
            "item5_min":{"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "title": "Agenda",
            "item1": "Q4 results", "item1_min": "10 min",
            "item2": "Product update", "item2_min": "15 min",
            "item3": "Hiring plan", "item3_min": "10 min",
            "item4": "Open discussion", "item4_min": "20 min",
            "item5": "", "item5_min": "",
        },
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.6, 12.33, 0.9),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            # Numbered items at consistent vertical rhythm
            *(_agenda_item(i, top) for i, top in enumerate([2.0, 2.9, 3.8, 4.7, 5.6], start=1)),
        ],
    ),

    # 12. Image with caption (placeholder shape acts as image until populated)
    Template(
        id="std.image_caption",
        name="Image with Caption",
        description="Large image placeholder above a caption. Caller swaps the rect for an actual image.",
        category="Percy Standard",
        tags=["image", "caption", "photo"],
        is_builtin=True,
        inputs_schema={
            "caption_title": {"type": "string", "required": True},
            "caption_body":  {"type": "string", "required": True},
            "source":        {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "caption_title": "The new editor in action",
            "caption_body": "Selecting an element opens the typed editor — no formula bar, no XML.",
            "source": "Screenshot, build 2026.05.11",
        },
        layout=[
            {"kind": "shape", "alias": "image_placeholder", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 0.5, 12.33, 5.3),
                "fill_color": _CREAM, "line": {"visible": False},
                "name": "Image placeholder", "text": "[IMAGE]",
            }},
            {"kind": "text", "alias": "caption_title", "body": {
                "text": "{{caption_title}}", "position": _pos(0.5, 6.1, 12.33, 0.5),
                "font_name": _FONT, "font_size": 18, "font_bold": True,
                "text_color": _PAPER, "name": "Caption title",
            }},
            {"kind": "text", "alias": "caption_body", "body": {
                "text": "{{caption_body}}", "position": _pos(0.5, 6.6, 12.33, 0.4),
                "font_name": _FONT, "font_size": 13,
                "text_color": _MUTED, "name": "Caption body",
            }},
            {"kind": "text", "alias": "source", "body": {
                "text": "{{source}}", "position": _pos(0.5, 7.05, 12.33, 0.3),
                "font_name": _FONT, "font_size": 9,
                "text_color": _MUTED, "name": "Source",
            }},
        ],
    ),

    # 13. OKR Quadrants
    Template(
        id="std.okr_quadrants",
        name="OKR Quadrants",
        description="Four-box layout with one objective per quadrant. Sage/cobalt/ochre/brick tinted.",
        category="Percy Standard",
        tags=["okr", "quadrants", "goals"],
        is_builtin=True,
        inputs_schema={
            "q1_title": {"type": "string", "required": True},
            "q1_body":  {"type": "string", "required": True},
            "q2_title": {"type": "string", "required": True},
            "q2_body":  {"type": "string", "required": True},
            "q3_title": {"type": "string", "required": True},
            "q3_body":  {"type": "string", "required": True},
            "q4_title": {"type": "string", "required": True},
            "q4_body":  {"type": "string", "required": True},
        },
        sample_inputs={
            "q1_title": "Grow ARR to $25M", "q1_body": "Anchor on mid-market expansion.",
            "q2_title": "Ship Studio 3.0",   "q2_body": "Public beta by end of Q1.",
            "q3_title": "Hire 8 engineers",  "q3_body": "Half senior, half new grad.",
            "q4_title": "Customer NPS > 60", "q4_body": "Quarterly close-the-loop calls.",
        },
        layout=[
            *_quadrant("q1", 0.5, 0.5, 6.16, 3.25, _SAGE),
            *_quadrant("q2", 6.66, 0.5, 6.16, 3.25, _ACCENT),
            *_quadrant("q3", 0.5, 3.85, 6.16, 3.25, _OCHRE),
            *_quadrant("q4", 6.66, 3.85, 6.16, 3.25, _BRICK),
        ],
    ),

    # 14. Live Timeline — uses a slide script
    Template(
        id="std.live_timeline",
        name="Live Timeline",
        description="Horizontal timeline driven by a slide script. Run via studio script API to populate.",
        category="Percy Standard",
        tags=["timeline", "live-group", "script"],
        is_builtin=True,
        inputs_schema={
            "title": {"type": "string", "required": True},
        },
        sample_inputs={"title": "What shipped this year"},
        slide_script="""# slide-script: timeline-from-csv
# inputs: {date, label}
# Reads from materials/timeline.csv and lays out markers.""",
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 0.5, 12.33, 0.9),
                "font_name": _FONT, "font_size": 28, "font_bold": True,
                "text_color": _PAPER, "name": "Title",
            }},
            {"kind": "shape", "alias": "rail", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 4.0, 12.33, 0.03),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Rail",
            }},
        ],
    ),

    # 15. Closing / Thank You
    Template(
        id="std.closing",
        name="Closing",
        description="End slide. Big thank-you, contact info, and a final accent rule. Match the closing accent to the deck's tone (cobalt for default, sage for a positive close).",
        category="Percy Standard",
        tags=["closing", "thanks", "final"],
        is_builtin=True,
        inputs_schema={
            "headline": {"type": "string", "required": False, "default": "Thank you."},
            "contact":  {"type": "string", "required": False, "default": ""},
            "next":     {"type": "string", "required": False, "default": ""},
            **ACCENT_INPUT,
        },
        sample_inputs={
            "headline": "Thank you.",
            "contact": "hello@percy.so",
            "next": "Office hours Thursdays at 11am.",
            "accent": _ACCENT,
        },
        layout=[
            {"kind": "shape", "alias": "rule", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 4.05, 1.0, 0.04),
                "fill_color": "{{accent}}", "line": {"visible": False}, "name": "Accent rule",
            }},
            {"kind": "text", "alias": "headline", "body": {
                "text": "{{headline}}", "position": _pos(0.5, 2.4, 12.33, 1.6),
                "font_name": _FONT, "font_size": 64, "font_bold": True,
                "text_color": _PAPER, "name": "Headline",
            }},
            {"kind": "text", "alias": "contact", "body": {
                "text": "{{contact}}", "position": _pos(0.5, 4.2, 12.33, 0.6),
                "font_name": _FONT_MONO, "font_size": 20,
                "text_color": "{{accent}}", "name": "Contact",
            }},
            {"kind": "text", "alias": "next", "body": {
                "text": "{{next}}", "position": _pos(0.5, 5.0, 12.33, 0.5),
                "font_name": _FONT, "font_size": 14,
                "text_color": _MUTED, "name": "Next",
            }},
        ],
    ),

    # ────────────────────────────────────────────────────────────────────────
    # ELEMENT TEMPLATES — single-element building blocks
    #
    # The "structural" elements at the top of this list (slide_title, eyebrow,
    # slide_subtitle, bottom_note, source_line, confidentiality_stamp) are
    # the canonical Percy versions of pieces every slide tends to need. Drop
    # them on any layout to inherit the brand's typography + position rhythm
    # without recomputing it per-slide.
    # ────────────────────────────────────────────────────────────────────────

    # E0a. THE canonical slide title block
    Template(
        id="std.el.slide_title",
        name="Slide Title",
        description=(
            "Canonical Percy slide title — 32pt Inter Bold, warm slate, "
            "top-left aligned at the standard rhythm (0.5\" left margin, "
            "1.0\" top). Use this on any slide that needs a heading instead "
            "of recomputing the position + font from scratch."
        ),
        category="Percy Standard",
        tags=["element", "title", "heading", "essential", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": True, "description": "Title text. Sentence case per brand."},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 1.0},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
            "height_in":{"type": "float",  "required": False, "default": 1.0},
        },
        sample_inputs={"text": "Net retention is back above 110%"},
        layout=[
            {"kind": "text", "alias": "title", "body": {
                "text": "{{text}}",
                "position": _pos(0.5, 1.0, 12.33, 1.0),
                "font_name": _FONT, "font_size": 32, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Slide title",
            }},
        ],
    ),

    # E0b. Eyebrow / kicker label (small caps cobalt above a title)
    Template(
        id="std.el.eyebrow",
        name="Eyebrow Label",
        description=(
            "Small-caps tracking-out label that sits above a slide title — "
            "10pt Inter Bold, cobalt by default. Title Case in the source; "
            "the brand instructions say title-case eyebrows + sentence-case titles."
        ),
        category="Percy Standard",
        tags=["element", "eyebrow", "kicker", "label", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": True, "description": "Eyebrow text. TITLE CASE."},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 0.55},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
            **ACCENT_INPUT,
        },
        sample_inputs={"text": "Q4 RETENTION", "accent": _ACCENT},
        layout=[
            {"kind": "text", "alias": "eyebrow", "body": {
                "text": "{{text}}",
                "position": _pos(0.5, 0.55, 12.33, 0.3),
                "font_name": _FONT, "font_size": 10, "font_bold": True,
                "text_color": "{{accent}}", "text_align": "left", "name": "Eyebrow",
            }},
        ],
    ),

    # E0c. Slide subtitle — title's pairing partner
    Template(
        id="std.el.slide_subtitle",
        name="Slide Subtitle",
        description="Supporting subtitle below a slide title — 18pt Inter Regular, muted gray.",
        category="Percy Standard",
        tags=["element", "subtitle", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": True},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 2.1},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
        },
        sample_inputs={"text": "Mid-market expansion led the quarter for the second straight period."},
        layout=[
            {"kind": "text", "alias": "subtitle", "body": {
                "text": "{{text}}",
                "position": _pos(0.5, 2.1, 12.33, 0.6),
                "font_name": _FONT, "font_size": 18,
                "text_color": _MUTED, "text_align": "left", "name": "Slide subtitle",
            }},
        ],
    ),

    # E0d. Bottom note — gray italic text above the footer rule (the requested element)
    Template(
        id="std.el.bottom_note",
        name="Bottom Note",
        description=(
            "Gray italic note pinned just above the footer rule. For "
            "methodology, disclaimers, caveats, or 'see appendix' notes that "
            "deserve more weight than a source citation but less than body."
        ),
        category="Percy Standard",
        tags=["element", "note", "footnote", "caveat", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": True},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 6.5},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
        },
        sample_inputs={"text": "Excludes one-time professional services revenue (~$120K in Q4)."},
        layout=[
            {"kind": "text", "alias": "note", "body": {
                "text": "{{text}}",
                "position": _pos(0.5, 6.5, 12.33, 0.4),
                "font_name": _FONT, "font_size": 11, "font_italic": True,
                "text_color": _MUTED, "text_align": "left", "name": "Bottom note",
            }},
        ],
    ),

    # E0e. Source citation — fine print
    Template(
        id="std.el.source_line",
        name="Source Citation",
        description="Bottom-left fine-print source line — 9pt muted. Always lead with 'Source:'.",
        category="Percy Standard",
        tags=["element", "source", "citation", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": True, "description": "Citation text. Should start with 'Source:'."},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 6.85},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
        },
        sample_inputs={"text": "Source: Salesforce snapshot 2025-12-12, internal data warehouse."},
        layout=[
            {"kind": "text", "alias": "source", "body": {
                "text": "{{text}}",
                "position": _pos(0.5, 6.85, 12.33, 0.3),
                "font_name": _FONT, "font_size": 9,
                "text_color": _MUTED, "text_align": "left", "name": "Source",
            }},
        ],
    ),

    # E0f. Confidentiality stamp — top-right corner
    Template(
        id="std.el.confidentiality_stamp",
        name="Confidentiality Stamp",
        description="Small-caps stamp pinned to the upper-right corner — 9pt Inter Bold, muted. For internal/confidential decks.",
        category="Percy Standard",
        tags=["element", "stamp", "confidential", "structural"],
        is_builtin=True,
        inputs_schema={
            "text":     {"type": "string", "required": False, "default": "CONFIDENTIAL"},
            "left_in":  {"type": "float",  "required": False, "default": 10.5},
            "top_in":   {"type": "float",  "required": False, "default": 0.3},
            "width_in": {"type": "float",  "required": False, "default": 2.5},
        },
        sample_inputs={"text": "CONFIDENTIAL · DO NOT FORWARD"},
        layout=[
            {"kind": "text", "alias": "stamp", "body": {
                "text": "{{text}}",
                "position": _pos(10.5, 0.3, 2.5, 0.3),
                "font_name": _FONT, "font_size": 9, "font_bold": True,
                "text_color": _MUTED, "text_align": "right", "name": "Confidentiality stamp",
            }},
        ],
    ),

    # ── existing element templates (chart_title, footer_group, kpi_tile, etc.)
    #    continue below

    # E1. Chart title text box
    Template(
        id="std.el.chart_title",
        name="Chart Title",
        description="Small-caps tracking-out title box for above a chart. Cobalt eyebrow + paper headline.",
        category="Percy Standard",
        tags=["element", "chart", "title", "text-box"],
        is_builtin=True,
        inputs_schema={
            "eyebrow":  {"type": "string", "required": False, "default": ""},
            "headline": {"type": "string", "required": True},
            "left_in":  {"type": "float",  "required": False, "default": 0.5},
            "top_in":   {"type": "float",  "required": False, "default": 0.5},
            "width_in": {"type": "float",  "required": False, "default": 12.33},
        },
        sample_inputs={
            "eyebrow": "MONTHLY ARR",
            "headline": "Net retention is back above 110%",
        },
        layout=[
            {"kind": "text", "alias": "eyebrow", "body": {
                "text": "{{eyebrow}}", "position": {"left_in": 0.5, "top_in": 0.5, "width_in": 12.33, "height_in": 0.3},
                "font_name": _FONT, "font_size": 10, "font_bold": True,
                "text_color": _ACCENT, "text_align": "left", "name": "Chart eyebrow",
            }},
            {"kind": "text", "alias": "headline", "body": {
                "text": "{{headline}}", "position": {"left_in": 0.5, "top_in": 0.85, "width_in": 12.33, "height_in": 0.7},
                "font_name": _FONT, "font_size": 22, "font_bold": True,
                "text_color": _PAPER, "text_align": "left", "name": "Chart headline",
            }},
        ],
    ),

    # E2. Footer group — accent line + page number + footer text
    Template(
        id="std.el.footer",
        name="Footer Group",
        description="Reusable footer: thin accent rule, left-aligned text, right-aligned page number. Drop on any slide.",
        category="Percy Standard",
        tags=["element", "footer", "page-number", "group"],
        is_builtin=True,
        inputs_schema={
            "footer_text": {"type": "string", "required": False, "default": "Percy · Confidential"},
            "page_number": {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={"footer_text": "Percy · Confidential", "page_number": "1 / 24"},
        layout=[
            {"kind": "shape", "alias": "rule", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 7.05, 12.33, 0.02),
                "fill_color": _ACCENT_LITE, "line": {"visible": False},
                "name": "Footer rule",
            }},
            {"kind": "text", "alias": "footer_text", "body": {
                "text": "{{footer_text}}", "position": _pos(0.5, 7.15, 9.0, 0.3),
                "font_name": _FONT, "font_size": 10,
                "text_color": _MUTED, "text_align": "left", "name": "Footer text",
            }},
            {"kind": "text", "alias": "page_number", "body": {
                "text": "{{page_number}}", "position": _pos(9.5, 7.15, 3.33, 0.3),
                "font_name": _FONT_MONO, "font_size": 10,
                "text_color": _MUTED, "text_align": "right", "name": "Page number",
            }},
        ],
    ),

    # E3. KPI tile (single)
    Template(
        id="std.el.kpi_tile",
        name="KPI Tile",
        description="One KPI tile: cream box with mono number, label, and optional delta.",
        category="Percy Standard",
        tags=["element", "kpi", "metric"],
        is_builtin=True,
        inputs_schema={
            "value": {"type": "string", "required": True},
            "label": {"type": "string", "required": True},
            "delta": {"type": "string", "required": False, "default": ""},
            "left_in": {"type": "float", "required": False, "default": 1.0},
            "top_in":  {"type": "float", "required": False, "default": 2.0},
        },
        sample_inputs={"value": "$2.4M", "label": "ARR added", "delta": "▲ 18% QoQ"},
        layout=[
            {"kind": "shape", "alias": "tile", "body": {
                "geometry_preset": "rect", "position": _pos(1.0, 2.0, 4.0, 4.5),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Tile",
            }},
            {"kind": "text", "alias": "value", "body": {
                "text": "{{value}}", "position": _pos(1.2, 2.6, 3.6, 1.7),
                "font_name": _FONT_MONO, "font_size": 64, "font_bold": True,
                "text_color": _PAPER, "name": "KPI value",
            }},
            {"kind": "text", "alias": "label", "body": {
                "text": "{{label}}", "position": _pos(1.2, 4.5, 3.6, 0.5),
                "font_name": _FONT, "font_size": 14, "text_color": _PAPER, "name": "KPI label",
            }},
            {"kind": "text", "alias": "delta", "body": {
                "text": "{{delta}}", "position": _pos(1.2, 5.1, 3.6, 0.4),
                "font_name": _FONT_MONO, "font_size": 12,
                "text_color": _SAGE, "name": "KPI delta",
            }},
        ],
    ),

    # E4. Callout box
    Template(
        id="std.el.callout",
        name="Callout Box",
        description="Cream box with accent rule, label, and body. For pull-aside notes mid-slide.",
        category="Percy Standard",
        tags=["element", "callout", "note", "aside"],
        is_builtin=True,
        inputs_schema={
            "label": {"type": "string", "required": True},
            "body":  {"type": "string", "required": True},
        },
        sample_inputs={
            "label": "Worth noting",
            "body": "Last quarter's outage cost ~$80K in credits. Engineering's on it; no recurrence in the trailing 60 days.",
        },
        layout=[
            {"kind": "shape", "alias": "card", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.0, 12.33, 2.0),
                "fill_color": _CREAM, "line": {"visible": False}, "name": "Callout card",
            }},
            {"kind": "shape", "alias": "rule", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.0, 0.04, 2.0),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Callout rule",
            }},
            {"kind": "text", "alias": "label", "body": {
                "text": "{{label}}", "position": _pos(0.85, 2.2, 11.8, 0.4),
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_color": _ACCENT, "name": "Callout label",
            }},
            {"kind": "text", "alias": "body", "body": {
                "text": "{{body}}", "position": _pos(0.85, 2.65, 11.8, 1.2),
                "font_name": _FONT, "font_size": 14, "text_color": _PAPER, "name": "Callout body",
            }},
        ],
    ),

    # E5. Status pills
    Template(
        id="std.el.status_good",
        name="Status Pill — Good",
        description="Sage rounded pill with white label. Use for positive status indicators.",
        category="Percy Standard",
        tags=["element", "pill", "status", "good"],
        is_builtin=True,
        inputs_schema={"label": {"type": "string", "required": True}},
        sample_inputs={"label": "ON TRACK"},
        layout=[
            {"kind": "shape", "alias": "pill", "body": {
                "geometry_preset": "roundRect", "position": _pos(1.0, 1.0, 2.0, 0.5),
                "fill_color": _SAGE, "line": {"visible": False}, "name": "Status pill",
                "text": "{{label}}", "text_color": "#FFFFFF",
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_align": "center",
            }},
        ],
    ),
    Template(
        id="std.el.status_warn",
        name="Status Pill — Warn",
        description="Ochre rounded pill. Use for at-risk indicators.",
        category="Percy Standard",
        tags=["element", "pill", "status", "warn"],
        is_builtin=True,
        inputs_schema={"label": {"type": "string", "required": True}},
        sample_inputs={"label": "AT RISK"},
        layout=[
            {"kind": "shape", "alias": "pill", "body": {
                "geometry_preset": "roundRect", "position": _pos(1.0, 1.0, 2.0, 0.5),
                "fill_color": _OCHRE, "line": {"visible": False}, "name": "Status pill",
                "text": "{{label}}", "text_color": "#FFFFFF",
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_align": "center",
            }},
        ],
    ),
    Template(
        id="std.el.status_bad",
        name="Status Pill — Bad",
        description="Brick rounded pill. Use for blocked/off-track.",
        category="Percy Standard",
        tags=["element", "pill", "status", "bad"],
        is_builtin=True,
        inputs_schema={"label": {"type": "string", "required": True}},
        sample_inputs={"label": "BLOCKED"},
        layout=[
            {"kind": "shape", "alias": "pill", "body": {
                "geometry_preset": "roundRect", "position": _pos(1.0, 1.0, 2.0, 0.5),
                "fill_color": _BRICK, "line": {"visible": False}, "name": "Status pill",
                "text": "{{label}}", "text_color": "#FFFFFF",
                "font_name": _FONT, "font_size": 11, "font_bold": True,
                "text_align": "center",
            }},
        ],
    ),

    # E6. Section divider line
    Template(
        id="std.el.section_rule",
        name="Section Divider",
        description="Short cobalt accent rule. Drop above section titles or between blocks.",
        category="Percy Standard",
        tags=["element", "divider", "rule", "accent"],
        is_builtin=True,
        inputs_schema={
            "left_in":  {"type": "float", "required": False, "default": 0.5},
            "top_in":   {"type": "float", "required": False, "default": 2.0},
            "width_in": {"type": "float", "required": False, "default": 1.0},
        },
        sample_inputs={"left_in": 0.5, "top_in": 2.0, "width_in": 1.0},
        layout=[
            {"kind": "shape", "alias": "rule", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.0, 1.0, 0.04),
                "fill_color": _ACCENT, "line": {"visible": False}, "name": "Divider rule",
            }},
        ],
    ),

    # E7. Pull quote (standalone element)
    Template(
        id="std.el.pull_quote",
        name="Pull Quote",
        description="Standalone italic pull quote with attribution. Drop into a slide for emphasis.",
        category="Percy Standard",
        tags=["element", "quote", "pullquote"],
        is_builtin=True,
        inputs_schema={
            "quote": {"type": "string", "required": True},
            "by":    {"type": "string", "required": False, "default": ""},
        },
        sample_inputs={
            "quote": "We replaced three internal tools with Percy.",
            "by": "VP Operations, Series B SaaS",
        },
        layout=[
            {"kind": "text", "alias": "quote", "body": {
                "text": "“{{quote}}”", "position": _pos(1.0, 2.5, 11.33, 2.0),
                "font_name": _FONT, "font_size": 28, "font_italic": True,
                "text_color": _PAPER, "text_align": "left", "name": "Pull quote",
            }},
            {"kind": "text", "alias": "by", "body": {
                "text": "— {{by}}", "position": _pos(1.0, 4.6, 11.33, 0.4),
                "font_name": _FONT, "font_size": 12, "text_color": _MUTED, "name": "Attribution",
            }},
        ],
    ),

    # E8. Stat with delta
    Template(
        id="std.el.stat_delta",
        name="Stat with Delta",
        description="Mono number + ▲/▼ change indicator. Compact inline metric.",
        category="Percy Standard",
        tags=["element", "stat", "kpi", "delta"],
        is_builtin=True,
        inputs_schema={
            "value": {"type": "string", "required": True},
            "delta": {"type": "string", "required": False, "default": ""},
            "label": {"type": "string", "required": False, "default": ""},
            "left_in": {"type": "float", "required": False, "default": 1.0},
            "top_in":  {"type": "float", "required": False, "default": 1.0},
        },
        sample_inputs={"value": "$2.4M", "delta": "▲ 18%", "label": "ARR added"},
        layout=[
            {"kind": "text", "alias": "value", "body": {
                "text": "{{value}}", "position": _pos(1.0, 1.0, 4.0, 1.2),
                "font_name": _FONT_MONO, "font_size": 48, "font_bold": True,
                "text_color": _PAPER, "name": "Stat value",
            }},
            {"kind": "text", "alias": "delta", "body": {
                "text": "{{delta}}", "position": _pos(1.0, 2.3, 4.0, 0.5),
                "font_name": _FONT_MONO, "font_size": 16,
                "text_color": _SAGE, "name": "Stat delta",
            }},
            {"kind": "text", "alias": "label", "body": {
                "text": "{{label}}", "position": _pos(1.0, 2.85, 4.0, 0.4),
                "font_name": _FONT, "font_size": 11,
                "text_color": _MUTED, "name": "Stat label",
            }},
        ],
    ),

    # E9. Em-dash bullet
    Template(
        id="std.el.em_bullet",
        name="Em-Dash Bullet",
        description="Single em-dash bulleted line. Use multiple to compose a list with consistent rhythm.",
        category="Percy Standard",
        tags=["element", "bullet", "list-item"],
        is_builtin=True,
        inputs_schema={
            "text": {"type": "string", "required": True},
            "left_in":  {"type": "float", "required": False, "default": 0.7},
            "top_in":   {"type": "float", "required": False, "default": 2.0},
            "width_in": {"type": "float", "required": False, "default": 12.1},
        },
        sample_inputs={"text": "A meaningful bullet point that respects the reader's time."},
        layout=[
            {"kind": "text", "alias": "bullet", "body": {
                "text": "—  {{text}}", "position": _pos(0.7, 2.0, 12.1, 0.6),
                "font_name": _FONT, "font_size": 18, "text_color": _PAPER, "name": "Bullet",
            }},
        ],
    ),

    # E10. Section header bar
    Template(
        id="std.el.section_header_bar",
        name="Section Header Bar",
        description="Eyebrow + heading + thin underline. Use mid-slide to start a new visual section.",
        category="Percy Standard",
        tags=["element", "header", "section"],
        is_builtin=True,
        inputs_schema={
            "eyebrow": {"type": "string", "required": False, "default": ""},
            "title":   {"type": "string", "required": True},
        },
        sample_inputs={"eyebrow": "SECTION 02", "title": "How we measure progress"},
        layout=[
            {"kind": "text", "alias": "eyebrow", "body": {
                "text": "{{eyebrow}}", "position": _pos(0.5, 1.0, 12.33, 0.3),
                "font_name": _FONT, "font_size": 10, "font_bold": True,
                "text_color": _ACCENT, "name": "Section eyebrow",
            }},
            {"kind": "text", "alias": "title", "body": {
                "text": "{{title}}", "position": _pos(0.5, 1.4, 12.33, 0.8),
                "font_name": _FONT, "font_size": 28, "font_bold": True,
                "text_color": _PAPER, "name": "Section title",
            }},
            {"kind": "shape", "alias": "underline", "body": {
                "geometry_preset": "rect", "position": _pos(0.5, 2.2, 12.33, 0.02),
                "fill_color": _ACCENT_LITE, "line": {"visible": False}, "name": "Underline",
            }},
        ],
    ),
]


# (Helpers _pos / _agenda_item / _quadrant are defined at the top of the file
# so the STANDARD_TEMPLATES literal can reference them.)
