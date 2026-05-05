"""Bridge element builders — turn intent dicts into well-formed dataclass trees.

This is the layer the agent calls into. Inputs are loose, JSON-shaped intent
dicts; outputs are fully-populated Bridge dataclasses ready to drop into a
``BridgeSlide.elements`` list.

Each builder:
  - validates required fields, raising ``BuilderError`` on real problems
  - applies sensible defaults from theme + intent context
  - coerces color strings via ``percy.bridge.colors``
  - returns the dataclass

Builders are pure functions over their inputs — no I/O, no FastAPI, no
mutation of slide state. Endpoint handlers in ``app/backend`` are the thin
adapters that call into here.

See ``docs/agent/elements/MASTER.md`` for the contract.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Callable

from percy.bridge.colors import coerce_color
from percy.bridge.elements import (
    AreaBorder,
    BridgeGroup,
    AxisLine,
    AxisTitle,
    AxisUnits,
    BridgeAxis,
    BridgeChart,
    BridgeConnector,
    BridgeFreeform,
    BridgeImage,
    BridgeShape,
    BridgeTable,
    CellAlignment,
    CellBorders,
    CellFont,
    CellFormat,
    CellMerge,
    ChartCategories,
    ChartDataSource,
    ChartSeries,
    ChartTitle,
    ColorSpec,
    ConnectorEndpoints,
    DataLabels,
    FillAndBorder,
    FreeformFill,
    FreeformLine,
    Gridlines,
    Identification,
    ImageBorder,
    ImageData,
    ImageDimensions,
    ImageFileInfo,
    Legend,
    LineFormat,
    Margins,
    MarkerFormat,
    OverlayFiles,
    PlotProperties,
    Position,
    ReconstructionBlobs,
    ShapeBorders,
    ShapeFill,
    ShapeIdentification,
    ShapeLine,
    ShapeShadow,
    ShapeTextContent,
    ShapeTextFrame,
    Stacking,
    TableDefaults,
    TableDimensions,
    TableProperties,
    TextFrame,
    TextParagraph,
    TextRun,
    Transform,
    Accessibility,
)

# Slide dimensions for clamping (16:9 standard).
SLIDE_W_DEFAULT = 13.333
SLIDE_H_DEFAULT = 7.5


# ── Errors / warnings ───────────────────────────────────────────────────────


class BuilderError(ValueError):
    """Raised when an intent dict cannot be built into a valid element."""

    def __init__(self, message: str, *, field: str | None = None, code: str = "builder_validation"):
        super().__init__(message)
        self.field = field
        self.code = code


def _warn(warnings: list[str] | None, msg: str) -> None:
    if warnings is not None:
        warnings.append(msg)


# ── Common helpers ──────────────────────────────────────────────────────────


def _build_position(
    intent: dict,
    *,
    slide_w: float = SLIDE_W_DEFAULT,
    slide_h: float = SLIDE_H_DEFAULT,
    required: bool = True,
    warnings: list[str] | None = None,
) -> Position:
    p = intent.get("position") or {}
    if required and not p:
        raise BuilderError("position is required", field="position")
    left = float(p.get("left_in", 0.5))
    top = float(p.get("top_in", 0.5))
    width = float(p.get("width_in", 4.0))
    height = float(p.get("height_in", 3.0))

    # Clamp to slide bounds (warn but don't reject — gives the agent a hint).
    if left < 0:
        _warn(warnings, f"left_in {left} clamped to 0")
        left = 0.0
    if top < 0:
        _warn(warnings, f"top_in {top} clamped to 0")
        top = 0.0
    if left + width > slide_w + 0.01:
        _warn(warnings, f"position extends past slide right edge ({left + width:.2f} > {slide_w})")
    if top + height > slide_h + 0.01:
        _warn(warnings, f"position extends past slide bottom edge ({top + height:.2f} > {slide_h})")

    return Position(left=left, top=top, width=width, height=height)


def _next_shape_id(slide: Any) -> int:
    existing = {getattr(getattr(e, "identification", None), "shape_id", None) for e in slide.elements}
    return max((x for x in existing if x is not None), default=0) + 1


def _next_z(slide: Any) -> int:
    return max((getattr(e.stacking, "z_index", 1) for e in slide.elements), default=0) + 1


def _identification(shape_id: int, name: str | None, default_name: str) -> Identification:
    return Identification(shape_name=name or default_name, shape_id=shape_id)


def _make_text_frame_for_shape(intent: dict) -> ShapeTextFrame:
    return ShapeTextFrame(
        vertical_anchor=intent.get("vertical_align", "middle"),
        word_wrap=bool(intent.get("word_wrap", True)),
        text_insets={},
        autofit_type=intent.get("autofit_type", "shrink"),
    )


def _build_shape_text_content(intent: dict, theme: dict[str, str] | None) -> ShapeTextContent:
    """Build ShapeTextContent from a 'text' string or 'paragraphs' list."""
    paragraphs_src = intent.get("paragraphs")
    text_value = intent.get("text", "")

    if paragraphs_src and isinstance(paragraphs_src, list):
        paragraphs = [_build_paragraph(p, intent, theme) for p in paragraphs_src]
        flat_text = "\n".join((p.runs[0].text if p.runs else "") for p in paragraphs)
        return ShapeTextContent(has_text=bool(flat_text), text_content=flat_text, paragraphs=paragraphs)

    if not text_value:
        return ShapeTextContent(has_text=False, text_content="", paragraphs=[])

    para = _build_paragraph({"text": text_value}, intent, theme)
    return ShapeTextContent(has_text=True, text_content=text_value, paragraphs=[para])


def _build_paragraph(
    p_intent: dict,
    parent_intent: dict,
    theme: dict[str, str] | None,
) -> TextParagraph:
    """Build a TextParagraph. Falls back to parent_intent for defaults."""
    if "runs" in p_intent:
        runs = [_build_run(r, parent_intent, theme) for r in (p_intent.get("runs") or [])]
    else:
        runs = [_build_run(p_intent, parent_intent, theme)]

    return TextParagraph(
        runs=runs,
        alignment=p_intent.get("text_align") or parent_intent.get("text_align"),
        line_spacing=p_intent.get("line_spacing"),
        space_before=p_intent.get("space_before"),
        space_after=p_intent.get("space_after"),
        indent_level=int(p_intent.get("indent_level", 0)),
        bullet_type=p_intent.get("bullet_type", "none"),
        bullet_char=p_intent.get("bullet_char"),
        bullet_font=p_intent.get("bullet_font"),
    )


def _build_run(r_intent: dict, parent_intent: dict, theme: dict[str, str] | None) -> TextRun:
    return TextRun(
        text=str(r_intent.get("text", "")),
        font_name=r_intent.get("font_name") or parent_intent.get("font_name"),
        font_size=r_intent.get("font_size") or parent_intent.get("font_size"),
        font_bold=r_intent.get("font_bold") if "font_bold" in r_intent else parent_intent.get("font_bold"),
        font_italic=r_intent.get("font_italic") if "font_italic" in r_intent else parent_intent.get("font_italic"),
        font_underline=r_intent.get("font_underline") if "font_underline" in r_intent else parent_intent.get("font_underline"),
        font_color=coerce_color(
            r_intent.get("font_color") or r_intent.get("color") or parent_intent.get("font_color") or parent_intent.get("text_color"),
            theme,
        ),
        is_line_break=bool(r_intent.get("is_line_break", False)),
    )


def _build_shadow(intent: Any, theme: dict[str, str] | None) -> ShapeShadow:
    if intent is False or intent is None:
        return ShapeShadow()
    if intent is True:
        return ShapeShadow(has_shadow=True, blur=8.0, distance=4.0, direction=90.0,
                           color=ColorSpec(value="#000000"), alpha=30000)
    if isinstance(intent, dict):
        return ShapeShadow(
            has_shadow=True,
            blur=intent.get("blur", 8.0),
            distance=intent.get("distance", 4.0),
            direction=intent.get("direction", 90.0),
            color=coerce_color(intent.get("color", "#000000"), theme),
            alpha=int(intent.get("alpha", 0.3) * 100000) if isinstance(intent.get("alpha"), (int, float)) and intent.get("alpha") <= 1 else int(intent.get("alpha", 30000)),
        )
    return ShapeShadow()


# ── BridgeShape ─────────────────────────────────────────────────────────────


def build_shape(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeShape:
    """Build a BridgeShape from intent.

    Required: position, geometry_preset (or text_box=true).
    """
    is_text_box = bool(intent.get("text_box", False))
    geometry_preset = intent.get("geometry_preset") or ("rect" if is_text_box else "rect")

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Text {shape_id}" if is_text_box else f"Shape {shape_id}"

    fill_color_intent = intent.get("fill_color")
    fill_type = intent.get("fill_type") or ("none" if is_text_box and fill_color_intent in (None, "transparent", "") else "solid")
    fill_color_spec = None if fill_type == "none" else coerce_color(
        fill_color_intent if fill_color_intent is not None else "accent1",
        theme_colors,
    )

    border_color = intent.get("border_color")
    border_width = float(intent.get("border_width", 0))
    line = ShapeLine(
        visible=bool(border_color) and border_width > 0,
        color=coerce_color(border_color, theme_colors) if border_color else None,
        width=border_width if border_width > 0 else None,
        dash_style=intent.get("border_dash", "solid"),
    )

    # Text content uses a ShapeTextFrame, propagating font defaults.
    intent_with_defaults = dict(intent)
    intent_with_defaults.setdefault("font_size", 32 if is_text_box and intent.get("font_size") is None and (intent.get("text", "") or "").strip() else 18)
    intent_with_defaults.setdefault("text_color", "text" if is_text_box else _auto_text_color(fill_color_spec, theme_colors))

    text_content = _build_shape_text_content(intent_with_defaults, theme_colors)
    text_frame = _make_text_frame_for_shape(intent_with_defaults)

    return BridgeShape(
        position=_build_position(intent, warnings=warnings),
        transforms=Transform(rotation=float(intent.get("rotation", 0))),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        shape_identification=ShapeIdentification(
            shape_type="auto_shape",
            geometry_preset=geometry_preset,
        ),
        fill=ShapeFill(
            fill_type=fill_type,
            color=fill_color_spec,
            transparency=float(intent.get("fill_transparency", 0.0)),
        ),
        line=line,
        borders=ShapeBorders(),
        text_content=text_content,
        text_frame=text_frame,
        shadow=_build_shadow(intent.get("shadow"), theme_colors),
    )


def build_text(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeShape:
    """Text-box convenience — routes to build_shape with text_box=true."""
    text_intent = dict(intent)
    text_intent["text_box"] = True
    text_intent.setdefault("geometry_preset", "rect")
    return build_shape(text_intent, theme_colors, slide=slide, warnings=warnings)


def _auto_text_color(fill: ColorSpec | None, theme: dict[str, str] | None) -> str:
    """Pick light or dark text based on fill luminance."""
    if fill is None:
        return "text"
    try:
        hex_str = fill.resolve(theme or {})
    except Exception:
        return "text"
    if not hex_str.startswith("#") or len(hex_str) < 7:
        return "text"
    r = int(hex_str[1:3], 16)
    g = int(hex_str[3:5], 16)
    b = int(hex_str[5:7], 16)
    # Perceived luminance
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return "#FFFFFF" if lum < 0.55 else "#1E293B"


# ── BridgeChart ─────────────────────────────────────────────────────────────


SUPPORTED_CHART_TYPES = {
    "column_clustered", "column_stacked", "column_stacked_100",
    "bar_clustered", "bar_stacked", "bar_stacked_100",
    "line", "line_markers",
    "area", "area_stacked", "area_stacked_100",
    "pie", "doughnut",
    "scatter",
    "combo",
}


_DEFAULT_PALETTES: dict[str, list[str]] = {
    "viridis": ["#440154", "#3B528B", "#21918C", "#5DC863", "#FDE725"],
    "warm":    ["#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16"],
    "cool":    ["#3B82F6", "#06B6D4", "#14B8A6", "#10B981", "#8B5CF6"],
    "mono":    ["#1E293B", "#475569", "#64748B", "#94A3B8", "#CBD5E1"],
}


def _resolve_palette(name: str, theme: dict[str, str] | None) -> list[str]:
    if name == "theme":
        # Use theme accents if available — emitted in the user-friendly form
        # so coerce_color() handles them uniformly.
        if theme:
            accents = [f"accent{i}" for i in range(1, 7) if f"ACCENT_{i}" in theme]
            if accents:
                return accents
        return ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"]
    return _DEFAULT_PALETTES.get(name, _DEFAULT_PALETTES["cool"])


def build_chart(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeChart:
    """Build a BridgeChart from intent."""
    chart_type = intent.get("chart_type")
    if not chart_type:
        raise BuilderError("chart_type is required", field="chart_type")
    if chart_type not in SUPPORTED_CHART_TYPES:
        raise BuilderError(
            f"chart_type {chart_type!r} not supported. Supported: {sorted(SUPPORTED_CHART_TYPES)}",
            field="chart_type",
        )

    categories = intent.get("categories")
    if not isinstance(categories, list) or not categories:
        raise BuilderError("categories must be a non-empty list", field="categories")
    categories = [str(c) for c in categories]
    are_numeric = all(_is_numeric(c) for c in categories)

    series_intents = intent.get("series")
    if not isinstance(series_intents, list) or not series_intents:
        raise BuilderError("series must be a non-empty list", field="series")

    # Resolve palette for color fallbacks.
    palette_intent = intent.get("palette", "theme")
    if isinstance(palette_intent, list):
        palette = palette_intent
    else:
        palette = _resolve_palette(palette_intent, theme_colors)

    series: list[ChartSeries] = []
    for i, s in enumerate(series_intents):
        if not isinstance(s, dict):
            raise BuilderError(f"series[{i}] must be an object", field=f"series[{i}]")
        if "values" not in s:
            raise BuilderError(f"series[{i}].values is required", field=f"series[{i}].values")
        values = [float(v) if v is not None else 0.0 for v in (s.get("values") or [])]
        if len(values) != len(categories):
            _warn(
                warnings,
                f"series[{i}] has {len(values)} values vs {len(categories)} categories — chart may render with gaps",
            )

        # Color: explicit → palette cycle.
        color_intent = s.get("color")
        if color_intent is None:
            color_intent = palette[i % len(palette)]
        color_spec = coerce_color(color_intent, theme_colors)

        # Plot type override (combo charts).
        plot_type = s.get("plot_type")
        if chart_type == "combo" and not plot_type:
            plot_type = "column"
        if chart_type == "scatter":
            plot_type = "scatter"

        line_intent = s.get("line", {}) if isinstance(s.get("line"), dict) else {}
        marker_intent = s.get("marker", {}) if isinstance(s.get("marker"), dict) else {}
        dl_intent = s.get("data_labels") or intent.get("data_labels_global") or {}

        # Sensible per-type defaults.
        if chart_type in ("line", "line_markers"):
            line_visible = True
        elif chart_type == "area" or chart_type == "area_stacked":
            line_visible = False
        else:
            line_visible = bool(line_intent.get("visible", False))

        marker_style = marker_intent.get("style")
        if marker_style is None and chart_type == "line_markers":
            marker_style = "circle"

        series.append(ChartSeries(
            name=s.get("name") or f"Series {i+1}",
            values=values,
            color=color_spec,
            plot_type=plot_type,
            plot_index=i,
            line=LineFormat(
                line_visible=line_visible,
                line_width=line_intent.get("width"),
                line_color=coerce_color(line_intent.get("color"), theme_colors) if line_intent.get("color") else color_spec,
                line_style=line_intent.get("dash"),
            ),
            marker=MarkerFormat(
                marker_style=marker_style,
                marker_size=marker_intent.get("size"),
                marker_color=coerce_color(marker_intent.get("color"), theme_colors) if marker_intent.get("color") else color_spec,
            ),
            data_labels=DataLabels(
                show=bool(dl_intent.get("show", False)),
                format=dl_intent.get("format"),
                position=dl_intent.get("position"),
            ),
            x_values=[float(v) for v in (s.get("x_values") or [])] if s.get("x_values") else [],
            smooth=bool(s.get("smooth", False)),
        ))

    if chart_type == "scatter":
        for i, s in enumerate(series):
            if not s.x_values:
                if are_numeric:
                    s.x_values = [float(c) for c in categories]
                else:
                    raise BuilderError(
                        f"scatter chart series[{i}] needs x_values (categories are non-numeric)",
                        field=f"series[{i}].x_values",
                    )

    if chart_type in ("pie", "doughnut") and len(series) > 1:
        _warn(warnings, f"{chart_type} only renders the first series; {len(series) - 1} additional series ignored visually")

    # Title.
    title_intent = intent.get("title")
    if title_intent is None:
        title = ChartTitle(title=None)
    elif isinstance(title_intent, str):
        title = ChartTitle(title=title_intent, title_font_bold=True)
    elif isinstance(title_intent, dict):
        title = ChartTitle(
            title=title_intent.get("text") or title_intent.get("title"),
            title_font_size=title_intent.get("font_size"),
            title_font_name=title_intent.get("font_name"),
            title_font_bold=title_intent.get("bold", True) if title_intent.get("bold") is not None else True,
            title_font_color=coerce_color(title_intent.get("color"), theme_colors),
        )
    else:
        title = ChartTitle(title=str(title_intent))

    # Axes.
    cat_axis = _build_axis(intent.get("category_axis", {}), theme_colors, default_visible=True, default_gridlines=False)
    val_axis = _build_axis(intent.get("value_axis", {}),    theme_colors, default_visible=True, default_gridlines=True)
    if chart_type in ("pie", "doughnut"):
        cat_axis.delete = True
        val_axis.delete = True

    # Legend.
    leg_intent = intent.get("legend")
    if leg_intent is False:
        legend = Legend(visible=False)
    elif leg_intent is None:
        legend = Legend(visible=len(series) >= 2, position="b")
    elif isinstance(leg_intent, dict):
        pos = leg_intent.get("position", "bottom")
        # Normalize "bottom" → "b" (OOXML)
        pos_map = {"top": "t", "bottom": "b", "left": "l", "right": "r", "top_right": "tr"}
        legend = Legend(
            visible=bool(leg_intent.get("visible", True)),
            position=pos_map.get(pos, pos),
            font_size=leg_intent.get("font_size"),
        )
    else:
        legend = Legend(visible=True, position="b")

    # Plot properties.
    plot_props = PlotProperties(
        grouping=_chart_type_to_grouping(chart_type),
        bar_width_ratio=float(intent.get("bar_width_ratio", 0.7)),
        is_horizontal=chart_type.startswith("bar_"),
        hole_size=int(intent.get("hole_size", 50)) if chart_type == "doughnut" else None,
        area_border=AreaBorder(),
    )

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Chart {shape_id}"

    return BridgeChart(
        position=_build_position(intent, warnings=warnings),
        transforms=Transform(),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or (title.title or name)),
        chart_type=chart_type,
        title=title,
        categories=ChartCategories(
            categories=categories,
            categories_raw=categories,
            categories_are_numeric=are_numeric,
        ),
        series=series,
        category_axis=cat_axis,
        value_axis=val_axis,
        plot_properties=plot_props,
        legend=legend,
        # Internal-only fields stay at defaults — verified renderable without them
        # (chart-data PATCH explicitly excludes these).
        data_source=ChartDataSource(),
        overlay_files=OverlayFiles(),
        reconstruction_blobs=ReconstructionBlobs(),
    )


def _chart_type_to_grouping(t: str) -> str:
    if t.endswith("_stacked"):
        return "stacked"
    if t.endswith("_stacked_100"):
        return "percentStacked"
    if t in ("column_clustered", "bar_clustered"):
        return "clustered"
    return "standard"


def _build_axis(
    intent: dict,
    theme: dict[str, str] | None,
    *,
    default_visible: bool,
    default_gridlines: bool,
) -> BridgeAxis:
    return BridgeAxis(
        visible=bool(intent.get("visible", default_visible)),
        min_value=intent.get("min"),
        max_value=intent.get("max"),
        gridlines=Gridlines(
            has_major_gridlines=bool(intent.get("gridlines", default_gridlines)),
            gridline_color=coerce_color(intent.get("gridline_color"), theme) if intent.get("gridline_color") else None,
        ),
        title=AxisTitle(
            title_text=intent.get("title"),
            title_font_size=intent.get("title_font_size"),
        ),
        number_format=intent.get("number_format"),
        axis_line=AxisLine(line_visible=True),
    )


def _is_numeric(s: str) -> bool:
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


# ── BridgeTable ─────────────────────────────────────────────────────────────


_TABLE_PRESETS: dict[str, dict] = {
    "plain":     {"header_fill": None,       "header_text": "text",  "band_a": None,           "band_b": None,            "borders": "none"},
    "theme":     {"header_fill": "accent1",  "header_text": "white", "band_a": "accent1 +90%", "band_b": "accent1 +95%",  "borders": "inside"},
    "banded":    {"header_fill": None,       "header_text": "text",  "band_a": "#F1F5F9",       "band_b": "#FFFFFF",       "borders": "none"},
    "bordered":  {"header_fill": None,       "header_text": "text",  "band_a": None,           "band_b": None,            "borders": "all_thin"},
    "financial": {"header_fill": "text",     "header_text": "white", "band_a": None,           "band_b": None,            "borders": "rows_thin"},
    "matrix":    {"header_fill": "muted",    "header_text": "white", "band_a": None,           "band_b": None,            "borders": "all_thin"},
}


def build_table(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeTable:
    """Build a BridgeTable from intent.

    Accepts one of three data forms:
      - data: list[list]          full matrix
      - rows + cols (ints)        empty grid
      - columns + rows (lists)    DataFrame-shape (columns become header row)
    """
    data = _resolve_table_data(intent)
    n_rows = len(data)
    n_cols = max((len(r) for r in data), default=0)
    if n_rows == 0 or n_cols == 0:
        raise BuilderError("table must have at least one row and one column", field="data")

    first_row_header = bool(intent.get("first_row_header", "data" in intent or "columns" in intent))
    preset_name = intent.get("style_preset", "theme")
    preset = _TABLE_PRESETS.get(preset_name)
    if preset is None:
        raise BuilderError(f"unknown style_preset {preset_name!r}. Options: {sorted(_TABLE_PRESETS)}", field="style_preset")

    banded_rows = bool(intent.get("banded_rows", preset["band_a"] is not None and not first_row_header is False))

    font_name = intent.get("font_name")
    font_size = float(intent.get("font_size", 11))

    cell_formats: list[list[CellFormat]] = []
    for r in range(n_rows):
        row_cells: list[CellFormat] = []
        for c in range(n_cols):
            value = data[r][c] if c < len(data[r]) else ""
            text = "" if value is None else str(value)
            is_header = first_row_header and r == 0
            is_numeric_col = not is_header and _column_is_numeric(data, c, skip_first=first_row_header)

            # Style layering
            fill_color: str | None = None
            text_color = "text"
            font_bold = False
            if is_header and preset["header_fill"]:
                fill_color = preset["header_fill"]
                text_color = preset["header_text"]
                font_bold = True
            elif banded_rows and not is_header:
                body_row = r - (1 if first_row_header else 0)
                fill_color = preset["band_a"] if body_row % 2 == 0 else preset["band_b"]

            h_align = "right" if is_numeric_col else "left"
            v_align = "middle"

            cf = CellFormat(
                text=text,
                paragraphs=[TextParagraph(runs=[TextRun(
                    text=text, font_name=font_name, font_size=font_size, font_bold=font_bold,
                    font_color=coerce_color(text_color, theme_colors),
                )])],
                font=CellFont(
                    font_name=font_name,
                    font_size=font_size,
                    font_bold=font_bold,
                    text_color=coerce_color(text_color, theme_colors),
                ),
                alignment=CellAlignment(text_alignment=h_align, vertical_alignment=v_align),
                fill_color=coerce_color(fill_color, theme_colors) if fill_color else None,
                fill_type="solid" if fill_color else "none",
                borders=_table_borders(preset["borders"], r, n_rows, c, n_cols, theme_colors),
                margins=Margins(margin_left=0.05, margin_right=0.05, margin_top=0.03, margin_bottom=0.03),
                merge=CellMerge(),
                grid_row=r,
                grid_col=c,
                number_format=_infer_number_format(data, c, intent, skip_first=first_row_header) if is_numeric_col else None,
                word_wrap=True,
            )
            row_cells.append(cf)
        cell_formats.append(row_cells)

    # Dimensions
    pos = _build_position(intent, warnings=warnings)
    col_widths_intent = intent.get("column_widths")
    if isinstance(col_widths_intent, list) and len(col_widths_intent) == n_cols:
        col_widths = [float(w) for w in col_widths_intent]
    else:
        col_widths = [pos.width / n_cols] * n_cols
    row_heights_intent = intent.get("row_heights")
    if isinstance(row_heights_intent, list) and len(row_heights_intent) == n_rows:
        row_heights = [float(h) for h in row_heights_intent]
    else:
        row_heights = [pos.height / n_rows] * n_rows

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Table {shape_id}"

    return BridgeTable(
        position=pos,
        transforms=Transform(),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        data=[list(row) + [""] * (n_cols - len(row)) for row in data],
        cell_formats=cell_formats,
        dimensions=TableDimensions(column_widths=col_widths, row_heights=row_heights),
        table_properties=TableProperties(
            first_row_header=first_row_header,
            first_col_header=bool(intent.get("first_col_header", False)),
            last_row_total=bool(intent.get("last_row_total", False)),
            last_col_total=bool(intent.get("last_col_total", False)),
            banded_rows=banded_rows,
            banded_cols=bool(intent.get("banded_cols", False)),
        ),
        defaults=TableDefaults(
            default_font_name=font_name,
            default_font_size=font_size,
        ),
    )


def _resolve_table_data(intent: dict) -> list[list[Any]]:
    if "data" in intent and intent["data"] is not None:
        d = intent["data"]
        if not isinstance(d, list) or not all(isinstance(r, list) for r in d):
            raise BuilderError("data must be a list of lists", field="data")
        return d

    if "columns" in intent and "rows" in intent:
        cols = intent.get("columns") or []
        rows = intent.get("rows") or []
        if not isinstance(cols, list) or not isinstance(rows, list):
            raise BuilderError("columns and rows must both be lists", field="columns/rows")
        return [list(cols)] + [list(r) for r in rows]

    if "rows" in intent and "cols" in intent:
        n_rows = int(intent["rows"])
        n_cols = int(intent["cols"])
        if n_rows < 1 or n_cols < 1:
            raise BuilderError("rows and cols must be >= 1", field="rows/cols")
        return [["" for _ in range(n_cols)] for _ in range(n_rows)]

    raise BuilderError("provide one of: data | (columns+rows) | (rows+cols)", field="data")


def _column_is_numeric(data: list[list[Any]], col: int, *, skip_first: bool) -> bool:
    start = 1 if skip_first else 0
    samples = []
    for r in range(start, len(data)):
        if col < len(data[r]) and data[r][col] not in (None, ""):
            samples.append(data[r][col])
    if not samples:
        return False
    return all(_is_numeric(str(v).replace("$", "").replace(",", "").rstrip("%")) for v in samples)


def _infer_number_format(data: list[list[Any]], col: int, intent: dict, *, skip_first: bool) -> str | None:
    explicit = intent.get("number_format")
    if explicit:
        return explicit
    if not skip_first or col >= len(data[0]):
        return None
    header = str(data[0][col]).lower()
    if any(tok in header for tok in ("$", "revenue", "cost", "margin $", "price", "spend")):
        return "$#,##0"
    if "%" in header or "rate" in header or "growth" in header:
        return "0.0%"
    return "#,##0"


def _table_borders(
    style: str,
    r: int,
    n_rows: int,
    c: int,
    n_cols: int,
    theme: dict[str, str] | None,
) -> CellBorders:
    from percy.bridge.elements import Border
    if style == "none":
        return CellBorders()
    thin = Border(visible=True, style="solid", width=0.5,
                  color=coerce_color("muted", theme))
    if style == "all_thin":
        return CellBorders(border_top=thin, border_bottom=thin, border_left=thin, border_right=thin)
    if style == "rows_thin":
        return CellBorders(border_bottom=thin)
    if style == "inside":
        b = CellBorders()
        if r > 0:
            b.border_top = thin
        if c > 0:
            b.border_left = thin
        return b
    return CellBorders()


# ── BridgeConnector ─────────────────────────────────────────────────────────


_ANCHORS: dict[str, tuple[float, float]] = {
    "top":          (0.5, 0.0),
    "bottom":       (0.5, 1.0),
    "left":         (0.0, 0.5),
    "right":        (1.0, 0.5),
    "top-left":     (0.0, 0.0),
    "top-right":    (1.0, 0.0),
    "bottom-left":  (0.0, 1.0),
    "bottom-right": (1.0, 1.0),
    "center":       (0.5, 0.5),
}


def build_connector(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    lookup_element: Callable[[str], Any] | None = None,
    warnings: list[str] | None = None,
) -> BridgeConnector:
    """Build a BridgeConnector. Endpoints can be coordinate dicts or element anchors."""
    start = intent.get("start")
    end = intent.get("end")
    if not start or not end:
        raise BuilderError("start and end are required", field="start/end")

    sx, sy = _resolve_endpoint(start, lookup_element, "start", warnings)
    ex, ey = _resolve_endpoint(end, lookup_element, "end", warnings)

    connector_type = intent.get("connector_type", "straight")
    if connector_type not in ("straight", "elbow", "curved"):
        raise BuilderError(
            f"connector_type {connector_type!r} not in (straight, elbow, curved)",
            field="connector_type",
        )

    line = ShapeLine(
        visible=True,
        color=coerce_color(intent.get("color", "text"), theme_colors),
        width=float(intent.get("width", 1.5)),
        dash_style=intent.get("dash_style", "solid"),
        head_end=intent.get("head_end"),
        tail_end=intent.get("tail_end"),
        head_size=intent.get("head_size", "medium"),
        tail_size=intent.get("tail_size", "medium"),
    )

    # Position is the bounding box of endpoints.
    left = min(sx, ex)
    top = min(sy, ey)
    width = max(abs(ex - sx), 0.01)
    height = max(abs(ey - sy), 0.01)

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Connector {shape_id}"

    return BridgeConnector(
        position=Position(left=left, top=top, width=width, height=height),
        transforms=Transform(),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        connector_type=connector_type,
        endpoints=ConnectorEndpoints(start_x=sx, start_y=sy, end_x=ex, end_y=ey),
        line=line,
    )


def _resolve_endpoint(
    spec: dict,
    lookup_element: Callable[[str], Any] | None,
    label: str,
    warnings: list[str] | None,
) -> tuple[float, float]:
    if "x_in" in spec and "y_in" in spec:
        return float(spec["x_in"]), float(spec["y_in"])
    eid = spec.get("element_id")
    anchor = spec.get("anchor", "center")
    if eid and lookup_element:
        try:
            target = lookup_element(eid)
        except Exception as exc:
            raise BuilderError(f"connector {label}: element {eid!r} not found ({exc})", field=label)
        if target is None:
            raise BuilderError(f"connector {label}: element {eid!r} not found", field=label)
        pos = target.position
        ax, ay = _ANCHORS.get(anchor, (0.5, 0.5))
        return pos.left + pos.width * ax, pos.top + pos.height * ay
    raise BuilderError(
        f"connector {label}: provide either (x_in, y_in) or (element_id, anchor)",
        field=label,
    )


# ── BridgeFreeform (preset-only) ────────────────────────────────────────────


def build_freeform(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeFreeform:
    """V1: preset-only. The preset library is intentionally narrow.

    For presets that map cleanly to a BridgeShape geometry, the endpoint handler
    routes there instead. This builder handles the residual cases that need
    actual freeform paths — and for v1 those still defer to a fallback raster
    or a placeholder geometry until preset path generators are added.
    """
    preset = intent.get("preset")
    if not preset:
        raise BuilderError("preset is required", field="preset")

    # Map presets that are really just BridgeShape geometries — caller should
    # route, but if we get here, we fall through to a placeholder rect.
    pos = _build_position(intent, warnings=warnings)

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"{preset} {shape_id}"

    fill_color = coerce_color(intent.get("fill_color", "accent1"), theme_colors)
    border_color_raw = intent.get("border_color")
    border = coerce_color(border_color_raw, theme_colors) if border_color_raw else None

    return BridgeFreeform(
        position=pos,
        transforms=Transform(
            rotation=float(intent.get("rotation", 0)),
            flip_h=bool(intent.get("flip_h", False)),
            flip_v=bool(intent.get("flip_v", False)),
        ),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        fill=FreeformFill(
            fill_type="solid",
            fill_color=fill_color,
        ),
        line=FreeformLine(
            line_visible=border is not None,
            line_color=border,
            line_width=float(intent.get("border_width", 0)) or None,
        ),
        description=preset,
    )


# Presets that can be served by BridgeShape with the right geometry_preset.
SHAPE_EQUIVALENT_PRESETS: dict[str, str] = {
    "arrow_thick":          "rightArrow",
    "chevron_arrow":        "chevron",
    "check":                "checkmark",
    "cross":                "mathMultiply",
    "plus":                 "mathPlus",
    "flowchart_decision":   "flowChartDecision",
    "flowchart_terminator": "flowChartTerminator",
    "flowchart_data":       "flowChartInputOutput",
    "callout_speech":       "wedgeRoundRectCallout",
    "callout_thought":      "cloudCallout",
    "banner":               "horizontalScroll",
    "badge":                "star5",
    "bracket_curly":        "leftBrace",
    "bracket_square":       "leftBracket",
}


# ── BridgeImage ─────────────────────────────────────────────────────────────


def build_image(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    image_bytes: bytes,
    image_format: str,
    warnings: list[str] | None = None,
) -> BridgeImage:
    """Build a BridgeImage from raw bytes + intent. Caller handles the upload/URL fetch."""
    if not image_bytes:
        raise BuilderError("image_bytes is empty", field="image")

    pos_intent = dict(intent.get("position") or {})
    if not pos_intent.get("width_in") or not pos_intent.get("height_in"):
        # Derive from natural size at 96 DPI if not provided.
        try:
            from PIL import Image
            from io import BytesIO
            img = Image.open(BytesIO(image_bytes))
            w_px, h_px = img.size
            dpi = 96
            pos_intent.setdefault("width_in",  w_px / dpi)
            pos_intent.setdefault("height_in", h_px / dpi)
        except Exception:
            pos_intent.setdefault("width_in", 4.0)
            pos_intent.setdefault("height_in", 3.0)
    pos = _build_position({**intent, "position": pos_intent}, warnings=warnings)

    crop_intent = intent.get("crop") or {}
    border_color_intent = intent.get("border_color")
    border = ImageBorder(
        has_border=bool(border_color_intent),
        border_color=coerce_color(border_color_intent, theme_colors) if border_color_intent else None,
        border_width=float(intent.get("border_width", 0)) or None,
    )

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Image {shape_id}"

    return BridgeImage(
        position=pos,
        transforms=Transform(),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        image_data=ImageData(image_bytes=image_bytes, image_format=image_format),
        file_info=ImageFileInfo(
            original_filename=intent.get("original_filename"),
            original_path=intent.get("original_path"),
        ),
        dimensions=ImageDimensions(),  # filled by renderer
        cropping=replace(_zero_cropping(),
                         crop_left=float(crop_intent.get("left", 0)),
                         crop_right=float(crop_intent.get("right", 0)),
                         crop_top=float(crop_intent.get("top", 0)),
                         crop_bottom=float(crop_intent.get("bottom", 0))),
        border=border,
        shadow=_build_shadow(intent.get("shadow"), theme_colors),
        hyperlink=intent.get("hyperlink"),
        fill_mode=intent.get("fill_mode", "stretch"),
        shape_geometry=intent.get("shape_geometry"),
    )


def _zero_cropping():
    from percy.bridge.elements import ImageCropping
    return ImageCropping()


# ── BridgeGroup (live + static) ─────────────────────────────────────────────


def build_live_group(
    intent: dict,
    theme_colors: dict[str, str] | None,
    *,
    slide: Any,
    warnings: list[str] | None = None,
) -> BridgeGroup:
    """Build a BridgeGroup with optional generator script bound.

    The group starts empty — children are produced by running the generator
    script through ``percy.agent.sandbox.run_live_group_generator`` and then
    materialized via the standard ``create_*`` endpoints. Endpoint-side code
    handles that lifecycle; this builder just produces the empty group shell.

    Required: position. Optional: generator_script, generator_inputs, name.
    """
    pos = _build_position(intent, warnings=warnings)

    shape_id = _next_shape_id(slide)
    z_index = int(intent.get("z_index") or _next_z(slide))
    name = intent.get("name") or f"Group {shape_id}"

    group = BridgeGroup(
        position=pos,
        transforms=Transform(rotation=float(intent.get("rotation", 0))),
        stacking=Stacking(z_index=z_index),
        identification=_identification(shape_id, intent.get("name"), name),
        accessibility=Accessibility(alt_text=intent.get("alt_text") or name),
        children=[],
        generator_script=intent.get("generator_script"),
        generator_inputs=dict(intent.get("generator_inputs") or {}),
        generator_provenance={
            "created_at": _now(),
            "source_template_id": intent.get("source_template_id"),
            "child_count": 0,
        },
    )
    return group


def _now() -> float:
    import time as _time
    return _time.time()
