"""Smoke tests for the Bridge element builders.

Exercises every public ``build_*`` function with realistic intent dicts,
asserts the result is a well-formed dataclass tree, and round-trips the
core fields back to JSON via ``to_dict()``.
"""

from __future__ import annotations

import io

import pytest

from percy.bridge import (
    BridgeChart,
    BridgeConnector,
    BridgeFreeform,
    BridgeImage,
    BridgeShape,
    BridgeSlide,
    BridgeTable,
    PercyDocument,
)
from percy.bridge import builders
from percy.bridge.builders import BuilderError
from percy.bridge.colors import coerce_color


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B", "TX2": "#64748B"}


@pytest.fixture
def empty_slide() -> BridgeSlide:
    return BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)


# ── colors ─────────────────────────────────────────────────────────────────

class TestColors:
    def test_hex(self):
        assert coerce_color("#FF0000").value == "#FF0000"

    def test_hex_with_alpha(self):
        cs = coerce_color("#FF000080")
        assert cs.value == "#FF0000"
        assert cs.alpha is not None and 49000 < cs.alpha < 51000

    def test_named(self):
        assert coerce_color("red").value == "#EF4444"
        assert coerce_color("white").value == "#FFFFFF"

    def test_accent(self):
        assert coerce_color("accent1").value == "scheme:ACCENT_1"
        assert coerce_color("accent6").value == "scheme:ACCENT_6"

    def test_modifier_lighter(self):
        cs = coerce_color("accent1 +20%")
        assert cs.value == "scheme:ACCENT_1"
        assert cs.lum_off == 20000

    def test_modifier_darker(self):
        cs = coerce_color("accent1 -30%")
        assert cs.shade == 70000

    def test_alpha_modifier(self):
        cs = coerce_color("accent1 @50%")
        assert cs.alpha == 50000

    def test_combined_modifiers(self):
        cs = coerce_color("accent1 -20% @60%")
        assert cs.shade == 80000
        assert cs.alpha == 60000

    def test_transparent_returns_none(self):
        assert coerce_color("transparent") is None
        assert coerce_color("") is None
        assert coerce_color(None) is None

    def test_theme_alias_resolves_to_scheme(self):
        cs = coerce_color("text", THEME)
        assert cs.value == "scheme:TX1"

    def test_theme_alias_falls_back_when_no_theme(self):
        cs = coerce_color("text", None)
        assert cs.value == "#1E293B"


# ── shape ──────────────────────────────────────────────────────────────────

class TestBuildShape:
    def test_minimal(self, empty_slide):
        el = builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2}},
            THEME, slide=empty_slide,
        )
        assert isinstance(el, BridgeShape)
        assert el.position.left == 1
        assert el.shape_identification.geometry_preset == "rect"
        assert el.fill.fill_type == "solid"
        assert el.fill.color.value == "scheme:ACCENT_1"

    def test_text_box(self, empty_slide):
        el = builders.build_shape(
            {"position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
             "text_box": True, "text": "Hello", "font_size": 32, "font_bold": True},
            THEME, slide=empty_slide,
        )
        assert el.fill.fill_type == "none"
        assert el.text_content.has_text
        assert el.text_content.paragraphs[0].runs[0].text == "Hello"
        assert el.text_content.paragraphs[0].runs[0].font_bold is True

    def test_color_modifier(self, empty_slide):
        el = builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "fill_color": "accent2 -30%"},
            THEME, slide=empty_slide,
        )
        assert el.fill.color.value == "scheme:ACCENT_2"
        assert el.fill.color.shade == 70000

    def test_shadow(self, empty_slide):
        el = builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "shadow": {"blur": 12, "distance": 6, "direction": 90, "color": "#000", "alpha": 0.3}},
            THEME, slide=empty_slide,
        )
        assert el.shadow.has_shadow
        assert el.shadow.blur == 12

    def test_warns_off_slide(self, empty_slide):
        warnings: list[str] = []
        builders.build_shape(
            {"position": {"left_in": 12, "top_in": 1, "width_in": 5, "height_in": 1}},
            THEME, slide=empty_slide, warnings=warnings,
        )
        assert any("right edge" in w for w in warnings)


# ── text ───────────────────────────────────────────────────────────────────

class TestBuildText:
    def test_single_line(self, empty_slide):
        el = builders.build_text(
            {"text": "Quarterly Review",
             "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
             "font_size": 36, "font_bold": True},
            THEME, slide=empty_slide,
        )
        assert el.fill.fill_type == "none"
        assert el.text_content.paragraphs[0].runs[0].text == "Quarterly Review"

    def test_multi_paragraph(self, empty_slide):
        el = builders.build_text(
            {"paragraphs": [
                {"text": "Highlights", "font_size": 24, "font_bold": True},
                {"text": "Revenue up 23%", "indent_level": 1, "bullet_type": "char"},
                {"text": "Margin expanded", "indent_level": 1, "bullet_type": "char"},
             ],
             "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 4}},
            THEME, slide=empty_slide,
        )
        assert len(el.text_content.paragraphs) == 3
        assert el.text_content.paragraphs[1].bullet_type == "char"
        assert el.text_content.paragraphs[1].indent_level == 1


# ── chart ──────────────────────────────────────────────────────────────────

class TestBuildChart:
    def _intent(self):
        return {
            "chart_type": "column_clustered",
            "categories": ["Q1", "Q2", "Q3", "Q4"],
            "series": [
                {"name": "Revenue", "values": [100, 120, 130, 110]},
                {"name": "Cost",    "values": [80,  90,  95,  85]},
            ],
            "title": "Q4 Performance",
            "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 5},
        }

    def test_basic(self, empty_slide):
        el = builders.build_chart(self._intent(), THEME, slide=empty_slide)
        assert isinstance(el, BridgeChart)
        assert el.chart_type == "column_clustered"
        assert el.categories.categories == ["Q1", "Q2", "Q3", "Q4"]
        assert len(el.series) == 2
        assert el.series[0].values == [100.0, 120.0, 130.0, 110.0]
        assert el.title.title == "Q4 Performance"
        # Auto-palette assigned.
        assert el.series[0].color is not None
        assert el.series[1].color is not None
        assert el.series[0].color.value != el.series[1].color.value
        # Legend default for ≥2 series.
        assert el.legend.visible is True
        # Internal-only blobs left as defaults.
        assert el.reconstruction_blobs.chart_xml_blob is None
        assert el.data_source.embedded_workbook_bytes is None

    def test_combo(self, empty_slide):
        intent = self._intent()
        intent["chart_type"] = "combo"
        intent["series"][1]["plot_type"] = "line"
        intent["series"][1]["smooth"] = True
        el = builders.build_chart(intent, THEME, slide=empty_slide)
        assert el.series[0].plot_type == "column"  # default
        assert el.series[1].plot_type == "line"
        assert el.series[1].smooth is True

    def test_pie_warns_extra_series(self, empty_slide):
        intent = self._intent()
        intent["chart_type"] = "pie"
        warnings: list[str] = []
        builders.build_chart(intent, THEME, slide=empty_slide, warnings=warnings)
        assert any("first series" in w for w in warnings)

    def test_scatter_with_numeric_categories(self, empty_slide):
        el = builders.build_chart(
            {"chart_type": "scatter",
             "categories": ["1", "2", "3", "4"],
             "series": [{"name": "Y", "values": [10, 20, 15, 25]}],
             "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 4}},
            THEME, slide=empty_slide,
        )
        assert el.series[0].x_values == [1.0, 2.0, 3.0, 4.0]

    def test_scatter_rejects_non_numeric_categories(self, empty_slide):
        with pytest.raises(BuilderError, match="x_values"):
            builders.build_chart(
                {"chart_type": "scatter",
                 "categories": ["A", "B", "C"],
                 "series": [{"name": "Y", "values": [1, 2, 3]}],
                 "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 4}},
                THEME, slide=empty_slide,
            )

    def test_unsupported_chart_type(self, empty_slide):
        with pytest.raises(BuilderError, match="not supported"):
            builders.build_chart(
                {"chart_type": "radar",
                 "categories": ["a", "b"],
                 "series": [{"name": "x", "values": [1, 2]}],
                 "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3}},
                THEME, slide=empty_slide,
            )

    def test_missing_series_rejected(self, empty_slide):
        with pytest.raises(BuilderError, match="series"):
            builders.build_chart(
                {"chart_type": "line", "categories": ["a", "b"], "series": [],
                 "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3}},
                THEME, slide=empty_slide,
            )


# ── table ──────────────────────────────────────────────────────────────────

class TestBuildTable:
    def test_from_data(self, empty_slide):
        el = builders.build_table(
            {"data": [
                ["Quarter", "Revenue", "Cost"],
                ["Q1", 100, 80],
                ["Q2", 120, 90],
             ],
             "first_row_header": True, "banded_rows": True, "style_preset": "financial",
             "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 2}},
            THEME, slide=empty_slide,
        )
        assert isinstance(el, BridgeTable)
        assert len(el.cell_formats) == 3
        assert len(el.cell_formats[0]) == 3
        # Header cell is bold.
        assert el.cell_formats[0][0].font.font_bold is True
        # Numeric column right-aligned.
        assert el.cell_formats[1][1].alignment.text_alignment == "right"
        # Header has fill.
        assert el.cell_formats[0][0].fill_color is not None
        # Table properties set.
        assert el.table_properties.first_row_header is True

    def test_from_columns_rows(self, empty_slide):
        el = builders.build_table(
            {"columns": ["A", "B"], "rows": [[1, 2], [3, 4]],
             "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2}},
            THEME, slide=empty_slide,
        )
        assert el.data[0] == ["A", "B"]
        assert el.data[1][1] == 2

    def test_empty_grid(self, empty_slide):
        el = builders.build_table(
            {"rows": 5, "cols": 3, "style_preset": "theme",
             "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3}},
            THEME, slide=empty_slide,
        )
        assert len(el.cell_formats) == 5
        assert len(el.cell_formats[0]) == 3

    def test_unknown_preset_rejected(self, empty_slide):
        with pytest.raises(BuilderError, match="style_preset"):
            builders.build_table(
                {"rows": 2, "cols": 2, "style_preset": "fancyy",
                 "position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
                THEME, slide=empty_slide,
            )


# ── connector ──────────────────────────────────────────────────────────────

class TestBuildConnector:
    def test_absolute(self, empty_slide):
        el = builders.build_connector(
            {"connector_type": "straight",
             "start": {"x_in": 1, "y_in": 2},
             "end":   {"x_in": 5, "y_in": 4},
             "head_end": "triangle"},
            THEME, slide=empty_slide,
        )
        assert isinstance(el, BridgeConnector)
        assert el.endpoints.start_x == 1.0
        assert el.endpoints.end_x == 5.0
        assert el.line.head_end == "triangle"

    def test_element_anchor(self, empty_slide):
        # Pre-populate slide with two shapes to anchor against.
        s1 = builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}, "name": "a"},
            THEME, slide=empty_slide,
        )
        empty_slide.elements.append(s1)
        s2 = builders.build_shape(
            {"position": {"left_in": 6, "top_in": 4, "width_in": 2, "height_in": 1}, "name": "b"},
            THEME, slide=empty_slide,
        )
        empty_slide.elements.append(s2)

        def lookup(eid):
            for e in empty_slide.elements:
                if str(e.identification.shape_id) == eid or e.identification.shape_name == eid:
                    return e
            return None

        el = builders.build_connector(
            {"connector_type": "elbow",
             "start": {"element_id": "a", "anchor": "right"},
             "end":   {"element_id": "b", "anchor": "left"}},
            THEME, slide=empty_slide, lookup_element=lookup,
        )
        # right anchor of s1 = (1+2, 1+0.5) = (3, 1.5)
        assert el.endpoints.start_x == 3.0
        assert el.endpoints.start_y == 1.5
        # left anchor of s2 = (6, 4+0.5) = (6, 4.5)
        assert el.endpoints.end_x == 6.0
        assert el.endpoints.end_y == 4.5

    def test_missing_endpoints(self, empty_slide):
        with pytest.raises(BuilderError):
            builders.build_connector({"start": {"x_in": 1, "y_in": 1}}, THEME, slide=empty_slide)


# ── freeform ───────────────────────────────────────────────────────────────

class TestBuildFreeform:
    def test_preset(self, empty_slide):
        el = builders.build_freeform(
            {"preset": "ribbon_banner",
             "position": {"left_in": 2, "top_in": 1, "width_in": 4, "height_in": 1.5},
             "fill_color": "accent2"},
            THEME, slide=empty_slide,
        )
        assert isinstance(el, BridgeFreeform)
        assert el.description == "ribbon_banner"
        assert el.fill.fill_color.value == "scheme:ACCENT_2"

    def test_missing_preset(self, empty_slide):
        with pytest.raises(BuilderError, match="preset"):
            builders.build_freeform(
                {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
                THEME, slide=empty_slide,
            )


# ── image ──────────────────────────────────────────────────────────────────

class TestBuildImage:
    def _png_bytes(self) -> bytes:
        from PIL import Image as PILImage
        buf = io.BytesIO()
        PILImage.new("RGB", (200, 100), color="blue").save(buf, format="PNG")
        return buf.getvalue()

    def test_minimal(self, empty_slide):
        png = self._png_bytes()
        el = builders.build_image(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
             "alt_text": "blue rectangle"},
            THEME, slide=empty_slide, image_bytes=png, image_format="png",
        )
        assert isinstance(el, BridgeImage)
        assert el.image_data.image_bytes == png
        assert el.image_data.image_format == "png"
        assert el.accessibility.alt_text == "blue rectangle"

    def test_derives_size_from_natural(self, empty_slide):
        png = self._png_bytes()
        el = builders.build_image(
            {"position": {"left_in": 1, "top_in": 1}},  # no width/height
            THEME, slide=empty_slide, image_bytes=png, image_format="png",
        )
        # 200x100 px @ 96 dpi → ~2.083 × 1.042 in
        assert 2.0 < el.position.width < 2.2
        assert 1.0 < el.position.height < 1.1


# ── shape-id and z-index assignment ────────────────────────────────────────

def test_shape_id_assignment_on_populated_slide(empty_slide):
    a = builders.build_shape({"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
                             THEME, slide=empty_slide)
    empty_slide.elements.append(a)
    b = builders.build_shape({"position": {"left_in": 3, "top_in": 3, "width_in": 2, "height_in": 1}},
                             THEME, slide=empty_slide)
    empty_slide.elements.append(b)
    assert a.identification.shape_id == 1
    assert b.identification.shape_id == 2
    assert a.stacking.z_index == 1
    assert b.stacking.z_index == 2
