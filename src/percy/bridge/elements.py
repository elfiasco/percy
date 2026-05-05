"""Dataclasses for Percy Bridge elements.

The classes in this module mirror ``bridgemanifest/bridge elements schema.json``.
They intentionally stay lightweight: the first persistence format for Percy is
pickle with a ``.percy`` extension, and conversion to and from PowerPoint objects
will be layered on top of these classes.
"""

from __future__ import annotations

import colorsys
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class Position:
    left: float = 0.0
    top: float = 0.0
    width: float = 0.0
    height: float = 0.0


@dataclass(slots=True)
class Transform:
    rotation: float = 0.0
    flip_h: bool = False
    flip_v: bool = False


@dataclass(slots=True)
class Stacking:
    z_index: int = 1


@dataclass(slots=True)
class Identification:
    slide_number: int | None = None
    shape_name: str | None = None
    shape_id: int | None = None
    group_id: str | None = None


@dataclass(slots=True)
class Accessibility:
    alt_text: str | None = None


@dataclass(slots=True)
class BridgeElement:
    position: Position = field(default_factory=Position)
    transforms: Transform = field(default_factory=Transform)
    stacking: Stacking = field(default_factory=Stacking)
    identification: Identification = field(default_factory=Identification)
    accessibility: Accessibility = field(default_factory=Accessibility)
    custom_properties: dict[str, Any] = field(default_factory=dict)

    @property
    def element_type(self) -> str:
        return type(self).__name__

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class LineFormat:
    line_visible: bool = True
    line_width: float | None = None
    line_style: str | None = None
    line_color: ColorSpec | None = None


@dataclass(slots=True)
class MarkerFormat:
    marker_style: str | None = None
    marker_size: float | None = None
    marker_color: ColorSpec | None = None
    marker_line_visible: bool = True


@dataclass(slots=True)
class DataLabels:
    show: bool = False
    format: str | None = None
    position: str | None = None
    point_positions: dict[str, Any] = field(default_factory=dict)
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    font_color: ColorSpec | None = None
    show_val: bool = True
    show_cat_name: bool = False
    show_ser_name: bool = False
    show_percent: bool = False
    show_legend_key: bool = False
    show_bubble_size: bool = False
    show_leader_lines: bool = False
    separator: str | None = None


@dataclass(slots=True)
class ChartSeries:
    name: str | None = None
    values: list[float] = field(default_factory=list)
    color: ColorSpec | None = None
    negative_color: ColorSpec | None = None
    point_colors: list[ColorSpec] = field(default_factory=list)
    plot_type: str | None = None
    plot_index: int = 0
    invert_if_negative: bool = False
    line: LineFormat = field(default_factory=LineFormat)
    marker: MarkerFormat = field(default_factory=MarkerFormat)
    data_labels: DataLabels = field(default_factory=DataLabels)
    x_values: list[float] = field(default_factory=list)
    point_formatting: dict[int, dict[str, Any]] = field(default_factory=dict)
    custom_labels: dict[int, str] = field(default_factory=dict)
    smooth: bool = False
    fill_type: str | None = None
    gradient_stops: list[Any] = field(default_factory=list)


@dataclass(slots=True)
class ChartTitle:
    title: str | None = None
    title_font_size: float | None = None
    title_font_name: str | None = None
    title_font_bold: bool | None = None
    title_font_color: ColorSpec | None = None
    title_font_italic: bool | None = None
    title_position_x: float | None = None
    title_position_y: float | None = None
    title_width: float | None = None
    title_height: float | None = None
    auto_title_deleted: bool | None = None


@dataclass(slots=True)
class ChartCategories:
    categories: list[str] = field(default_factory=list)
    categories_raw: list[str] = field(default_factory=list)
    categories_are_numeric: bool = False
    category_levels: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class Gridlines:
    has_major_gridlines: bool = False
    gridline_style: str | None = None
    gridline_color: ColorSpec | None = None
    gridline_width: float | None = None
    gridline_no_fill: bool = False


@dataclass(slots=True)
class AxisTitle:
    title_text: str | None = None
    title_font_size: float | None = None
    title_font_name: str | None = None
    title_font_bold: bool | None = None


@dataclass(slots=True)
class TickLabels:
    number_format: str | None = None
    tick_label_font_size: float | None = None
    tick_label_font_name: str | None = None
    tick_label_font_bold: bool | None = None
    tick_label_font_color: ColorSpec | None = None
    tick_label_position: str | None = None
    tick_label_rotation: float | None = None
    tick_label_bodypr_attrs: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TickMarks:
    major_tick_mark: str | None = None
    minor_tick_mark: str | None = None
    tick_label_skip: int | None = None
    tick_mark_skip: int | None = None


@dataclass(slots=True)
class AxisUnits:
    major_unit: float | None = None
    minor_unit: float | None = None
    major_time_unit: str | None = None
    minor_time_unit: str | None = None
    base_time_unit: str | None = None


@dataclass(slots=True)
class AxisLine:
    line_visible: bool = True
    line_color: ColorSpec | None = None
    line_width: float | None = None


@dataclass(slots=True)
class BridgeAxis:
    visible: bool = True
    axis_type: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    gridlines: Gridlines = field(default_factory=Gridlines)
    title: AxisTitle = field(default_factory=AxisTitle)
    tick_labels: TickLabels = field(default_factory=TickLabels)
    tick_marks: TickMarks = field(default_factory=TickMarks)
    units: AxisUnits = field(default_factory=AxisUnits)
    axis_line: AxisLine = field(default_factory=AxisLine)
    reverse_order: bool = False
    number_format: str | None = None
    crosses: str | None = None
    crosses_at: float | None = None
    minor_gridlines: Gridlines = field(default_factory=Gridlines)
    delete: bool = False
    ax_pos: str | None = None
    no_multi_lvl_lbl: bool = False
    lbl_offset: int | None = None
    lbl_algn: str | None = None
    cross_between: str | None = None


@dataclass(slots=True)
class AreaBorder:
    has_border: bool = False
    border_width: float | None = None
    border_color: ColorSpec | None = None
    has_fill: bool = False
    fill_color: ColorSpec | None = None
    no_line: bool = False


@dataclass(slots=True)
class PlotProperties:
    grouping: str | None = None
    bar_width_ratio: float | None = None
    overlap: int | None = None
    is_horizontal: bool = False
    area_border: AreaBorder = field(default_factory=AreaBorder)
    first_slice_ang: int | None = None
    hole_size: int | None = None
    vary_colors: bool | None = None


@dataclass(slots=True)
class Legend:
    visible: bool = True
    position: str | None = None
    overlay: bool = True
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    font_color: ColorSpec | None = None
    fill_type: str | None = None
    fill_color: ColorSpec | None = None
    border_type: str | None = None
    border_width: float | None = None
    manual_layout_x: float | None = None
    manual_layout_y: float | None = None
    manual_layout_w: float | None = None
    manual_layout_h: float | None = None
    manual_layout_x_mode: str | None = None
    manual_layout_y_mode: str | None = None


@dataclass(slots=True)
class OverlayFiles:
    chart_user_shapes: bytes | None = None
    chart_style: bytes | None = None
    chart_colors: bytes | None = None
    theme_override: bytes | None = None


@dataclass(slots=True)
class ReconstructionBlobs:
    chart_xml_blob: bytes | None = None
    chart_excel_blob: bytes | None = None


@dataclass(slots=True)
class ChartWorkbookCell:
    address: str
    row: int
    column: int
    value: Any = None
    formula: str | None = None
    data_type: str | None = None
    style_id: int | None = None


@dataclass(slots=True)
class ChartWorkbookSheet:
    name: str
    dimension: str | None = None
    cells: list[ChartWorkbookCell] = field(default_factory=list)


@dataclass(slots=True)
class ChartDataSource:
    has_external_data: bool = False
    relationship_id: str | None = None
    relationship_type: str | None = None
    target: str | None = None
    target_mode: str | None = None
    source_kind: str = "cache_only"
    auto_update: bool | None = None
    has_embedded_workbook: bool = False
    embedded_workbook_filename: str | None = None
    embedded_workbook_bytes: bytes | None = None
    workbook_sheet_names: list[str] = field(default_factory=list)
    workbook_dimensions: dict[str, str] = field(default_factory=dict)
    workbook_sheets: list[ChartWorkbookSheet] = field(default_factory=list)
    cache_series_count: int = 0
    cache_category_count: int = 0
    cache_point_count: int = 0
    formulas: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BridgeChart(BridgeElement):
    chart_type: str | None = None
    title: ChartTitle = field(default_factory=ChartTitle)
    categories: ChartCategories = field(default_factory=ChartCategories)
    series: list[ChartSeries] = field(default_factory=list)
    category_axis: BridgeAxis = field(default_factory=BridgeAxis)
    value_axis: BridgeAxis = field(default_factory=BridgeAxis)
    plot_properties: PlotProperties = field(default_factory=PlotProperties)
    legend: Legend = field(default_factory=Legend)
    chart_space_fill: dict[str, Any] = field(default_factory=dict)
    figsize: tuple[float, float] | None = None
    data_source: ChartDataSource = field(default_factory=ChartDataSource)
    overlay_files: OverlayFiles = field(default_factory=OverlayFiles)
    reconstruction_blobs: ReconstructionBlobs = field(default_factory=ReconstructionBlobs)
    plot_area_x: float | None = None
    plot_area_y: float | None = None
    plot_area_w: float | None = None
    plot_area_h: float | None = None
    plot_area_x_mode: str | None = None
    plot_area_y_mode: str | None = None
    plot_area_layout_target: str | None = None
    chart_txpr_font_name: str | None = None
    chart_txpr_font_size: float | None = None
    chart_txpr_font_bold: bool | None = None
    chart_txpr_font_color: ColorSpec | None = None
    disp_blanks_as: str | None = None
    plot_vis_only: bool | None = None


@dataclass(slots=True)
class Margins:
    margin_left: float | None = None
    margin_right: float | None = None
    margin_top: float | None = None
    margin_bottom: float | None = None


@dataclass(slots=True)
class CellFont:
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    font_italic: bool | None = None
    text_color: ColorSpec | None = None


@dataclass(slots=True)
class CellAlignment:
    text_alignment: str = "left"
    vertical_alignment: str = "top"


@dataclass(slots=True)
class Border:
    style: str | None = None
    width: float | None = None
    color: ColorSpec | None = None
    visible: bool = True
    transparency: float | None = None
    dash_style: str | None = None


@dataclass(slots=True)
class CellBorders:
    border_top: Border | None = None
    border_bottom: Border | None = None
    border_left: Border | None = None
    border_right: Border | None = None
    diagonal_down: Border | None = None
    diagonal_up: Border | None = None


@dataclass(slots=True)
class CellMerge:
    is_merged: bool = False
    is_merge_origin: bool = False
    is_spanned: bool = False
    merge_span_rows: int = 1
    merge_span_cols: int = 1


@dataclass(slots=True)
class CellFormat:
    text: str | None = None
    paragraphs: list["TextParagraph"] = field(default_factory=list)
    font: CellFont = field(default_factory=CellFont)
    alignment: CellAlignment = field(default_factory=CellAlignment)
    fill_color: ColorSpec | None = None
    fill_type: str | None = None
    fill_transparency: float | None = None
    borders: CellBorders = field(default_factory=CellBorders)
    margins: Margins = field(default_factory=Margins)
    text_autofit: str | None = None
    number_format: str | None = None
    merge: CellMerge = field(default_factory=CellMerge)
    grid_row: int = 0
    grid_col: int = 0
    text_direction: str | None = None
    word_wrap: bool | None = None
    anchor: str | None = None
    raw_properties: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TableDimensions:
    column_widths: list[float] = field(default_factory=list)
    row_heights: list[float] = field(default_factory=list)


@dataclass(slots=True)
class TableStyleSection:
    """Resolved properties for one section of a table style (e.g. firstRow, band1H)."""
    bold: bool | None = None
    font_name: str | None = None
    font_color: "ColorSpec | None" = None
    fill_color: "ColorSpec | None" = None
    # Border definitions: outer edges and inner/inside borders
    border_left: "Border | None" = None
    border_right: "Border | None" = None
    border_top: "Border | None" = None
    border_bottom: "Border | None" = None
    border_inside_h: "Border | None" = None
    border_inside_v: "Border | None" = None


@dataclass(slots=True)
class TableStyle:
    """Fully-resolved table style: stores per-section formatting rules so cell properties
    can be computed dynamically based on position (supports adding rows, alternating colors, etc.).

    Priority order (lowest → highest): wholeTbl → banding → firstRow/Col/lastRow/Col → corners.
    """
    style_id: str | None = None
    style_name: str | None = None
    whole_tbl: TableStyleSection = field(default_factory=TableStyleSection)
    band1_h: TableStyleSection = field(default_factory=TableStyleSection)
    band2_h: TableStyleSection = field(default_factory=TableStyleSection)
    band1_v: TableStyleSection = field(default_factory=TableStyleSection)
    band2_v: TableStyleSection = field(default_factory=TableStyleSection)
    first_row: TableStyleSection = field(default_factory=TableStyleSection)
    last_row: TableStyleSection = field(default_factory=TableStyleSection)
    first_col: TableStyleSection = field(default_factory=TableStyleSection)
    last_col: TableStyleSection = field(default_factory=TableStyleSection)
    nw_cell: TableStyleSection = field(default_factory=TableStyleSection)
    ne_cell: TableStyleSection = field(default_factory=TableStyleSection)
    sw_cell: TableStyleSection = field(default_factory=TableStyleSection)
    se_cell: TableStyleSection = field(default_factory=TableStyleSection)

    def resolve_cell(
        self, row: int, col: int, n_rows: int, n_cols: int,
        first_row_flag: bool, last_row_flag: bool,
        first_col_flag: bool, last_col_flag: bool,
        banded_rows: bool, banded_cols: bool,
    ) -> "TableStyleSection":
        """Compute the effective style for a given cell by layering sections (dynamic)."""
        layers: list[TableStyleSection] = [self.whole_tbl]

        if banded_rows:
            body_row = row - (1 if first_row_flag else 0)
            if body_row >= 0:
                layers.append(self.band1_h if body_row % 2 == 0 else self.band2_h)
        if banded_cols:
            body_col = col - (1 if first_col_flag else 0)
            if body_col >= 0:
                layers.append(self.band1_v if body_col % 2 == 0 else self.band2_v)

        if first_row_flag and row == 0:
            layers.append(self.first_row)
        if last_row_flag and row == n_rows - 1:
            layers.append(self.last_row)
        if first_col_flag and col == 0:
            layers.append(self.first_col)
        if last_col_flag and col == n_cols - 1:
            layers.append(self.last_col)

        is_nw = first_row_flag and row == 0 and first_col_flag and col == 0
        is_ne = first_row_flag and row == 0 and last_col_flag and col == n_cols - 1
        is_sw = last_row_flag and row == n_rows - 1 and first_col_flag and col == 0
        is_se = last_row_flag and row == n_rows - 1 and last_col_flag and col == n_cols - 1
        if is_nw:
            layers.append(self.nw_cell)
        if is_ne:
            layers.append(self.ne_cell)
        if is_sw:
            layers.append(self.sw_cell)
        if is_se:
            layers.append(self.se_cell)

        result = TableStyleSection()
        for layer in layers:
            if layer.bold is not None:
                result.bold = layer.bold
            if layer.font_name is not None:
                result.font_name = layer.font_name
            if layer.font_color is not None:
                result.font_color = layer.font_color
            if layer.fill_color is not None:
                result.fill_color = layer.fill_color
            if layer.border_left is not None:
                result.border_left = layer.border_left
            if layer.border_right is not None:
                result.border_right = layer.border_right
            if layer.border_top is not None:
                result.border_top = layer.border_top
            if layer.border_bottom is not None:
                result.border_bottom = layer.border_bottom
            if layer.border_inside_h is not None:
                result.border_inside_h = layer.border_inside_h
            if layer.border_inside_v is not None:
                result.border_inside_v = layer.border_inside_v
        return result


@dataclass(slots=True)
class TableProperties:
    first_row_header: bool = False
    first_col_header: bool = False
    last_row_total: bool = False
    last_col_total: bool = False
    banded_rows: bool = False
    banded_cols: bool = False
    style: "TableStyle | None" = None
    conditional_formatting: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class TableDefaults:
    text_autofit: str | None = None
    default_font_name: str | None = None
    default_font_size: float | None = None


@dataclass(slots=True)
class BridgeTable(BridgeElement):
    data: list[list[Any]] = field(default_factory=list)
    cell_formats: list[list[CellFormat]] = field(default_factory=list)
    dimensions: TableDimensions = field(default_factory=TableDimensions)
    table_properties: TableProperties = field(default_factory=TableProperties)
    defaults: TableDefaults = field(default_factory=TableDefaults)


@dataclass(slots=True)
class TextRun:
    text: str = ""
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    font_italic: bool | None = None
    font_underline: bool | None = None
    font_color: ColorSpec | None = None
    hyperlink: str | None = None
    is_line_break: bool = False
    char_spacing: float | None = None
    font_caps: str | None = None   # "all" | "small" | None — OOXML rPr cap attribute
    baseline_shift: float | None = None  # fraction of font_size; negative=up (super), positive=down (sub)
    strikethrough: str | None = None    # "sng" | "dbl" | None — OOXML rPr strike attribute
    pdf_span_x_in: float | None = None  # X origin of this span relative to text block left (inches); PDF only


@dataclass(slots=True)
class TextParagraph:
    runs: list[TextRun] = field(default_factory=list)
    alignment: str | None = None
    line_spacing: float | None = None
    space_before: float | None = None
    space_after: float | None = None
    indent_level: int = 0
    left_indent: float | None = None
    first_line_indent: float | None = None
    bullet_type: str = "none"
    bullet_char: str | None = None
    bullet_font: str | None = None
    bullet_blip_bytes: bytes | None = None
    bullet_blip_ext: str | None = None
    pdf_y_offset: float | None = None  # Y offset from block top (inches) for PDF text
    pdf_x_offset: float | None = None  # X offset from block left (inches) for PDF text
    pdf_line_width_in: float | None = None  # Actual rendered width of this line in PDF (inches); used for horizontal scale correction
    end_para_font_size: float | None = None  # endParaRPr sz in points (controls line height for empty paras)


@dataclass(slots=True)
class TextFrame:
    word_wrap: bool = True
    autofit_type: str = "shrink"
    vertical_anchor: str | None = None
    text_direction: str = "horizontal"
    font_scale: int | None = None  # normAutoFit fontScale (e.g. 92500 = 92.5%)
    ln_spc_reduction: int | None = None  # normAutoFit lnSpcReduction
    body_insets: dict = field(default_factory=dict)  # explicit bodyPr insets: left/right/top/bottom in inches


@dataclass(slots=True)
class FillAndBorder:
    fill_color: ColorSpec | None = None
    has_fill: bool = False
    border_color: ColorSpec | None = None
    border_width: float | None = None
    has_border: bool = False
    borders: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ShapeInfo:
    shape_type: str = "textbox"
    is_placeholder: bool = False
    placeholder_type: str | None = None
    placeholder_idx: int | None = None


@dataclass(slots=True)
class BridgeText(BridgeElement):
    paragraphs: list[TextParagraph] = field(default_factory=list)
    text_frame: TextFrame = field(default_factory=TextFrame)
    margins: Margins = field(default_factory=Margins)
    fill_and_border: FillAndBorder = field(default_factory=FillAndBorder)
    effects: dict[str, Any] = field(default_factory=dict)
    shape_info: ShapeInfo = field(default_factory=ShapeInfo)
    lst_style_xml: str | None = None
    shadow: "ShapeShadow" = field(default_factory=lambda: ShapeShadow())


@dataclass(slots=True)
class ShapeIdentification:
    shape_type: str = "auto_shape"
    geometry_preset: str = "rect"
    geometry_adjustments: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ColorSpec:
    """Portable color value supporting RGB and theme-scheme colors with OOXML modifiers."""
    value: str = ""               # "#RRGGBB" or "scheme:ACCENT_1"
    lum_mod: int | None = None    # /100000 — multiply luminance (75000 = 75%)
    lum_off: int | None = None    # /100000 — add to luminance (25000 = +25%)
    shade: int | None = None      # /100000 — darken toward black
    tint: int | None = None       # /100000 — lighten toward white
    alpha: int | None = None      # /100000 — opacity (100000 = fully opaque)
    hue_mod: int | None = None    # /100000 — hue rotation
    sat_mod: int | None = None    # /100000 — saturation multiplier

    @property
    def has_modifiers(self) -> bool:
        return any(x is not None for x in (
            self.lum_mod, self.lum_off, self.shade, self.tint,
            self.alpha, self.hue_mod, self.sat_mod,
        ))

    def resolve(self, theme_colors: dict[str, str] | None = None) -> str:
        """Return #RRGGBB with all OOXML modifiers applied."""
        val = self.value
        if not val:
            return "#888888"
        if val.startswith("scheme:"):
            key = val[7:]
            resolved = (theme_colors or {}).get(key, "")
            if not resolved:
                return "#888888"
            hex_val = resolved.lstrip("#")
        else:
            hex_val = val.lstrip("#")
        if len(hex_val) == 8:
            hex_val = hex_val[2:]
        if len(hex_val) != 6:
            return "#888888"
        if not self.has_modifiers:
            return "#" + hex_val.upper()
        r = int(hex_val[0:2], 16) / 255
        g = int(hex_val[2:4], 16) / 255
        b = int(hex_val[4:6], 16) / 255
        if self.lum_mod is not None or self.lum_off is not None:
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            if self.lum_mod is not None:
                l *= self.lum_mod / 100000
            if self.lum_off is not None:
                l += self.lum_off / 100000
            l = max(0.0, min(1.0, l))
            r, g, b = colorsys.hls_to_rgb(h, l, s)
        if self.shade is not None:
            f = self.shade / 100000
            r, g, b = r * f, g * f, b * f
        if self.tint is not None:
            f = self.tint / 100000
            r = 1 - (1 - r) * f
            g = 1 - (1 - g) * f
            b = 1 - (1 - b) * f
        if self.alpha is not None:
            opacity = max(0.0, min(1.0, self.alpha / 100000))
            r = r * opacity + 1.0 * (1 - opacity)
            g = g * opacity + 1.0 * (1 - opacity)
            b = b * opacity + 1.0 * (1 - opacity)
        ri = max(0, min(255, round(r * 255)))
        gi = max(0, min(255, round(g * 255)))
        bi = max(0, min(255, round(b * 255)))
        return f"#{ri:02X}{gi:02X}{bi:02X}"


@dataclass(slots=True)
class GradientStop:
    position: float = 0.0   # 0.0–1.0
    color: ColorSpec = field(default_factory=ColorSpec)


@dataclass(slots=True)
class ShapeFill:
    fill_type: str | None = None
    color: ColorSpec | None = None
    transparency: float = 0.0
    gradient_angle: float = 0.0
    gradient_stops: list[GradientStop] = field(default_factory=list)
    pattern_preset: str | None = None
    bg_color: ColorSpec | None = None


@dataclass(slots=True)
class ShapeLine:
    visible: bool = True
    color: ColorSpec | None = None
    width: float | None = None
    dash_style: str = "solid"
    head_end: str | None = None
    tail_end: str | None = None
    head_size: str | None = None
    tail_size: str | None = None


@dataclass(slots=True)
class ShapeBorders:
    all: dict[str, Any] = field(default_factory=dict)
    left: dict[str, Any] = field(default_factory=dict)
    right: dict[str, Any] = field(default_factory=dict)
    top: dict[str, Any] = field(default_factory=dict)
    bottom: dict[str, Any] = field(default_factory=dict)
    tl_to_br: dict[str, Any] = field(default_factory=dict)
    bl_to_tr: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ShapeTextContent:
    has_text: bool = False
    text_content: str | None = None
    paragraphs: list[TextParagraph] = field(default_factory=list)


@dataclass(slots=True)
class ShapeTextFrame:
    vertical_anchor: str | None = None
    word_wrap: bool = True
    text_insets: dict[str, float] = field(default_factory=dict)
    autofit_type: str | None = None
    anchor_center: bool | None = None
    font_scale: int | None = None  # normAutoFit fontScale (e.g. 92500 = 92.5%)
    ln_spc_reduction: int | None = None  # normAutoFit lnSpcReduction


@dataclass(slots=True)
class BridgeShape(BridgeElement):
    shape_identification: ShapeIdentification = field(default_factory=ShapeIdentification)
    fill: ShapeFill = field(default_factory=ShapeFill)
    line: ShapeLine = field(default_factory=ShapeLine)
    borders: ShapeBorders = field(default_factory=ShapeBorders)
    text_content: ShapeTextContent = field(default_factory=ShapeTextContent)
    text_frame: ShapeTextFrame = field(default_factory=ShapeTextFrame)
    shadow: "ShapeShadow" = field(default_factory=lambda: ShapeShadow())


@dataclass(slots=True)
class ImageData:
    image_bytes: bytes | None = None
    image_base64: str | None = None
    image_format: str | None = None


@dataclass(slots=True)
class ImageFileInfo:
    original_filename: str | None = None
    original_path: str | None = None


@dataclass(slots=True)
class ImageDimensions:
    width_px: int | None = None
    height_px: int | None = None
    dpi: int | None = None


@dataclass(slots=True)
class ImageCropping:
    crop_left: float = 0.0
    crop_right: float = 0.0
    crop_top: float = 0.0
    crop_bottom: float = 0.0


@dataclass(slots=True)
class ImageBorder:
    has_border: bool = False
    border_color: ColorSpec | None = None
    border_width: float | None = None


@dataclass(slots=True)
class ShapeShadow:
    """Outer drop shadow extracted from effectLst/outerShdw."""
    has_shadow: bool = False
    blur: float | None = None        # points (blurRad / 12700)
    distance: float | None = None    # points (dist / 12700)
    direction: float | None = None   # degrees (dir / 60000)
    color: "ColorSpec | None" = None
    alpha: int | None = None         # /100000 (100000 = fully opaque)
    align: str | None = None         # algn attribute ("ctr", "tl", etc.)
    rot_with_shape: bool = False


# Keep ImageShadow as an alias for backward compatibility
ImageShadow = ShapeShadow


@dataclass(slots=True)
class BridgeImage(BridgeElement):
    image_data: ImageData = field(default_factory=ImageData)
    file_info: ImageFileInfo = field(default_factory=ImageFileInfo)
    dimensions: ImageDimensions = field(default_factory=ImageDimensions)
    cropping: ImageCropping = field(default_factory=ImageCropping)
    border: ImageBorder = field(default_factory=ImageBorder)
    shadow: ShapeShadow = field(default_factory=ShapeShadow)
    hyperlink: str | None = None
    fill_mode: str | None = None     # "stretch" | "tile" | "fit" | None
    shape_geometry: str | None = None          # prstGeom prst (e.g. "roundRect"), None = "rect"
    shape_geometry_adj: dict[str, str] = field(default_factory=dict)  # e.g. {"adj": "val 27092"}


@dataclass(slots=True)
class BridgeGroup(BridgeElement):
    """A group of Bridge elements that move/resize together.

    Two flavors:
      - **static** — children authored manually; ``generator_script`` is None.
      - **live** — children authored by ``generator_script`` at runtime.

    Live groups are how the agent supports data-driven structure: a script
    that runs in the sandbox emits N children based on its ``generator_inputs``.
    On regenerate, children whose ``custom_properties["user_locked"]`` flag
    is True survive; the rest are replaced.

    PPTX export flattens both flavors to flat shapes (groups don't round-trip).
    """
    children: list[BridgeElement] = field(default_factory=list)
    generator_script: str | None = None
    generator_inputs: dict[str, Any] = field(default_factory=dict)
    generator_provenance: dict[str, Any] = field(default_factory=dict)
    # ^ {last_run_at, last_run_inputs_hash, child_count, source_template_id?,
    #    last_run_logs?, last_run_error?}


@dataclass(slots=True)
class ConnectorEndpoints:
    start_x: float = 0.0
    start_y: float = 0.0
    end_x: float = 0.0
    end_y: float = 0.0


@dataclass(slots=True)
class BridgeConnector(BridgeElement):
    connector_type: str = "straight"
    endpoints: ConnectorEndpoints = field(default_factory=ConnectorEndpoints)
    line: ShapeLine = field(default_factory=ShapeLine)


@dataclass(slots=True)
class PathCommand:
    command: str
    points: list[tuple[int, int]] = field(default_factory=list)
    arc_params: dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class FreeformPath:
    width: int = 0
    height: int = 0
    commands: list[PathCommand] = field(default_factory=list)
    fill_mode: str | None = None
    stroke: bool = True


@dataclass(slots=True)
class FreeformFill:
    fill_type: str | None = None
    fill_color: ColorSpec | None = None
    fill_scheme: str | None = None
    transparency: float = 0.0
    gradient_angle: float = 0.0
    gradient_stops: list[GradientStop] = field(default_factory=list)
    pattern_preset: str | None = None
    bg_color: ColorSpec | None = None


@dataclass(slots=True)
class FreeformLine:
    line_visible: bool = False
    line_color: ColorSpec | None = None
    line_scheme: str | None = None
    line_width: float | None = None
    line_cap: str | None = None
    line_join: str | None = None
    line_dash: str | None = None


@dataclass(slots=True)
class TransformEmus:
    offset_x: int | None = None
    offset_y: int | None = None
    extent_cx: int | None = None
    extent_cy: int | None = None


@dataclass(slots=True)
class FreeformFallback:
    image_bytes: bytes | None = None
    image_format: str = "PNG"


@dataclass(slots=True)
class BridgeFreeform(BridgeElement):
    paths: list[FreeformPath] = field(default_factory=list)
    geometry_xml: str | None = None
    fill: FreeformFill = field(default_factory=FreeformFill)
    line: FreeformLine = field(default_factory=FreeformLine)
    transform_emus: TransformEmus = field(default_factory=TransformEmus)
    fallback: FreeformFallback = field(default_factory=FreeformFallback)
    description: str | None = None
    style_xml: str | None = None


@dataclass(slots=True)
class BridgeSlide:
    slide_number: int
    elements: list[BridgeElement] = field(default_factory=list)
    width: float | None = None
    height: float | None = None
    background_color: str | None = None    # resolved hex, e.g. "#29B5E8"; None = white
    background_gradient_stops: list[GradientStop] = field(default_factory=list)
    background_gradient_angle: float = 0.0
    default_text_color: str | None = None  # resolved hex fallback for runs with no explicit color
    custom_properties: dict[str, Any] = field(default_factory=dict)
    # Slide-level Python script. Runs in the sandbox with a `studio` client and
    # the same `script_api` SDK that live-group generators use. Used for slide-
    # wide logic — hide callouts with empty data, recolor by status, etc.
    script: str | None = None
    script_inputs: dict[str, Any] = field(default_factory=dict)
    script_provenance: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EmbeddedFont:
    typeface: str
    style: str = "regular"   # "regular" | "bold" | "italic" | "boldItalic"
    font_bytes: bytes = b""   # raw font bytes (may be obfuscated .fntdata)
    is_obfuscated: bool = False


@dataclass(slots=True)
class BridgeFont:
    """A font extracted from a source document (PDF or PPTX).

    Stores everything needed for high-fidelity text rendering:
    the original name as it appeared in the file, the resolved
    matplotlib-compatible family/weight/style, and optionally the
    raw font bytes so the renderer can register it at runtime.

    Attributes
    ----------
    source_name : str
        The font name exactly as found in the source file
        (e.g. ``"Inter-SemiBoldItalic"``, ``"AllianceNo.2-Regular"``).
    family : str
        The font family name suitable for matplotlib / CSS
        (e.g. ``"Inter"``, ``"AllianceNo.2"``).
    weight : str
        CSS-style weight token: ``"normal"``, ``"bold"``, ``"semibold"``,
        ``"light"``, ``"ultralight"``, ``"black"``, etc.
    style : str
        ``"normal"``, ``"italic"``, or ``"oblique"``.
    font_format : str
        File extension of the embedded data: ``"ttf"`` or ``"otf"``.
        Empty string when no bytes are available.
    font_bytes : bytes
        Raw TrueType / OpenType font data extracted from the source file.
        Empty when the font is not embedded (subset-only or external).
    registered_path : str
        Absolute path to the temp file written for matplotlib registration.
        Empty until ``register()`` is called.
    """

    source_name: str
    family: str = ""
    weight: str = "normal"
    style: str = "normal"
    font_format: str = ""
    font_bytes: bytes = b""
    registered_path: str = ""
    nonempty_glyph_count: int = 0
    suspect_glyph_mapping: bool = False

    def register(self) -> bool:
        """Write bytes to a temp file and register with matplotlib.

        Returns True on success.  Safe to call multiple times (idempotent).
        """
        if self.registered_path:
            return True
        if not self.font_bytes:
            return False
        try:
            import tempfile
            from matplotlib import font_manager as fm
            ext = self.font_format or "ttf"
            safe = self.source_name.replace("/", "_").replace("\\", "_")
            fd, path = tempfile.mkstemp(suffix=f"_{safe}.{ext}", prefix="percy_font_")
            import os
            os.close(fd)
            with open(path, "wb") as f:
                f.write(self.font_bytes)
            fm.fontManager.addfont(path)
            self.registered_path = path
            return True
        except Exception:
            return False


@dataclass(slots=True)
class PresentationMetadata:
    slide_width: float | None = None
    slide_height: float | None = None
    slide_count: int = 0
    source_path: str | None = None
    page_number_elements: list[dict[str, Any]] = field(default_factory=list)
    footer_elements: list[dict[str, Any]] = field(default_factory=list)
    notes: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PercyDocument:
    slides: list[BridgeSlide] = field(default_factory=list)
    metadata: PresentationMetadata = field(default_factory=PresentationMetadata)
    source_path: str | None = None
    theme_colors: dict[str, str] = field(default_factory=dict)  # normalized key → hex, e.g. {"ACCENT_1": "#29B5E8"}
    custom_properties: dict[str, Any] = field(default_factory=dict)
    embedded_fonts: list[EmbeddedFont] = field(default_factory=list)
    fonts: dict[str, BridgeFont] = field(default_factory=dict)  # source_name → BridgeFont
