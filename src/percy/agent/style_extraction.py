"""Deterministic style extraction from Bridge documents.

Reads BridgeChart, BridgeTable, BridgeText, BridgeShape elements across a
set of onboarded reference documents and produces a StyleProfile capturing
the consistent stylistic conventions the team uses.

This is the **structural** part of style mining — no LLM. The LLM polish
layer (which adds when_to_use / when_to_avoid strings) runs separately in
``template_codegen.polish_with_llm``.

Outputs match the dataclasses in ``style_profiles.py``; values are the
mode (most common) or sensible aggregate over the corpus, so calling
``extract_profile`` on a single 57-slide deck gives a richer profile than
calling it on three 10-slide ones.

Usage:

    from percy.agent.style_extraction import extract_profile
    profile = extract_profile([doc1, doc2, doc3], theme_colors=doc1.theme_colors)
    # profile.chart_styles -> [ChartStyle(chart_type='DOUGHNUT', ...), ...]
    # profile.table_style  -> TableStyle(header_fill='#29B5E8', ...)
    # profile.text_styles  -> TextStyleCatalog(title=FontSpec(name='Arial', ...))
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from statistics import median
from typing import Any, Iterable

from .style_profiles import (
    AxisStyle, ChartStyle, DataLabelStyle, FillStyle, FontSpec,
    LegendStyle, LineStyle, StyleProfile, TableStyle, TextStyleCatalog,
)

log = logging.getLogger(__name__)


# ── Color resolution helper ─────────────────────────────────────────────────


def _resolve(color_spec: Any, theme: dict[str, str]) -> str | None:
    """ColorSpec → hex. Returns None if the spec can't resolve to a hex string."""
    if not color_spec or not getattr(color_spec, "value", None):
        return None
    try:
        hex_val = color_spec.resolve(theme)
        if hex_val and hex_val.startswith("#"):
            return hex_val.upper()
    except Exception:
        return None
    return None


def _modal(values: list[Any], default: Any = None) -> Any:
    """Most common value in a list, or default if empty."""
    if not values:
        return default
    return Counter(values).most_common(1)[0][0]


def _safe_median(values: list[float], default: float | None = None) -> float | None:
    nums = [v for v in values if isinstance(v, (int, float))]
    if not nums:
        return default
    return float(round(median(nums), 1))


# ── Text style extraction ───────────────────────────────────────────────────


def _iter_text_runs(el: Any) -> Iterable[Any]:
    """Yield every text run inside an element, regardless of subclass."""
    for path in ("text_frame.paragraphs", "paragraphs",
                 "text_content.paragraphs"):
        cursor = el
        for attr in path.split("."):
            cursor = getattr(cursor, attr, None)
            if cursor is None:
                break
        for para in (cursor or []):
            for run in (getattr(para, "runs", None) or []):
                yield run


def _build_text_styles(docs: list[Any], theme: dict[str, str]) -> TextStyleCatalog:
    """Bucket runs by font_size into title/subtitle/body/caption and pick the
    most common font name + color in each bucket."""
    buckets: dict[str, list[tuple[str, float, bool, str | None]]] = defaultdict(list)

    for doc in docs:
        doc_theme = getattr(doc, "theme_colors", None) or theme
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                for run in _iter_text_runs(el):
                    name = getattr(run, "font_name", None)
                    size = getattr(run, "font_size", None)
                    bold = bool(getattr(run, "font_bold", False))
                    color = _resolve(getattr(run, "font_color", None), doc_theme)
                    if not name or not isinstance(size, (int, float)):
                        continue
                    bucket = (
                        "title" if size >= 28
                        else "subtitle" if size >= 18
                        else "body" if size >= 10
                        else "caption"
                    )
                    buckets[bucket].append((name, float(size), bold, color))

    def _bucket_to_fontspec(bucket: str) -> FontSpec | None:
        entries = buckets.get(bucket) or []
        if not entries:
            return None
        names = [e[0] for e in entries]
        sizes = [e[1] for e in entries]
        bolds = [e[2] for e in entries]
        colors = [e[3] for e in entries if e[3]]
        name = _modal(names) or "Inter"
        # Use median size — robust to outliers.
        size = _safe_median(sizes)
        # Title is bold-by-convention if the majority are.
        bold = sum(1 for b in bolds if b) > len(bolds) / 2
        color = _modal(colors)
        return FontSpec(name=str(name), size=size, bold=bold, color=color)

    catalog = TextStyleCatalog(
        title=_bucket_to_fontspec("title"),
        subtitle=_bucket_to_fontspec("subtitle"),
        body=_bucket_to_fontspec("body"),
        caption=_bucket_to_fontspec("caption"),
    )
    return catalog


# ── Chart style extraction ──────────────────────────────────────────────────


def _build_chart_style(chart_type: str, charts: list[Any], theme: dict[str, str]) -> ChartStyle:
    """Aggregate styling across all observed charts of one type.

    Modes (most-common values) for discrete fields. Medians for numeric.
    """
    color_sequences: list[list[str]] = []
    title_fonts: list[FontSpec] = []
    legend_positions: list[str] = []
    legend_visible: list[bool] = []
    legend_fonts: list[FontSpec] = []
    has_data_labels: list[bool] = []
    data_label_formats: list[str] = []
    category_axis_visible: list[bool] = []
    value_axis_visible: list[bool] = []
    plot_area_fills: list[str] = []

    for chart in charts:
        # ── Color sequence (series order) ──
        seq: list[str] = []
        for series in (chart.series or []):
            c = _resolve(getattr(series, "color", None), theme)
            if c:
                seq.append(c)
            elif getattr(series, "point_colors", None):
                first = _resolve(series.point_colors[0], theme) if series.point_colors else None
                if first:
                    seq.append(first)
        if seq:
            color_sequences.append(seq)

        # ── Title ──
        title = getattr(chart, "title", None)
        if title and getattr(title, "font", None):
            tf = title.font
            title_fonts.append(FontSpec(
                name=str(getattr(tf, "name", None) or "Inter"),
                size=float(getattr(tf, "size", 14)),
                bold=bool(getattr(tf, "bold", True)),
                color=_resolve(getattr(tf, "color", None), theme),
            ))

        # ── Legend ──
        legend = getattr(chart, "legend", None)
        if legend is not None:
            legend_visible.append(bool(getattr(legend, "visible", True)))
            pos = getattr(legend, "position", None) or "bottom"
            legend_positions.append(str(pos).lower())
            lf = getattr(legend, "font", None)
            if lf and getattr(lf, "name", None):
                legend_fonts.append(FontSpec(
                    name=str(lf.name),
                    size=float(getattr(lf, "size", 10) or 10),
                    color=_resolve(getattr(lf, "color", None), theme),
                ))

        # ── Axes (visibility only — geometry is per-chart, not per-style) ──
        cat_ax = getattr(chart, "category_axis", None)
        if cat_ax is not None:
            category_axis_visible.append(bool(getattr(cat_ax, "visible", True)))
        val_ax = getattr(chart, "value_axis", None)
        if val_ax is not None:
            value_axis_visible.append(bool(getattr(val_ax, "visible", True)))

        # ── Data labels ──
        plot_props = getattr(chart, "plot_properties", None)
        if plot_props is not None:
            has_data_labels.append(bool(getattr(plot_props, "has_data_labels", False)))
            fmt = getattr(plot_props, "data_label_format", None)
            if fmt:
                data_label_formats.append(str(fmt))

        # ── Plot area fill ──
        if plot_props is not None:
            pf = getattr(plot_props, "plot_area_fill", None)
            c = _resolve(pf, theme) if pf else None
            if c:
                plot_area_fills.append(c)

    # Roll up.
    longest_seq = max(color_sequences, key=len) if color_sequences else []
    # Pick the most common font for titles (could be different sizes but same name).
    title_font = None
    if title_fonts:
        name = _modal([t.name for t in title_fonts])
        size = _safe_median([t.size for t in title_fonts if t.size])
        bold = sum(1 for t in title_fonts if t.bold) > len(title_fonts) / 2
        color = _modal([t.color for t in title_fonts if t.color])
        title_font = FontSpec(name=name or "Inter", size=size, bold=bold, color=color)

    legend = None
    if legend_visible:
        legend = LegendStyle(
            visible=sum(legend_visible) > len(legend_visible) / 2,
            position=_modal(legend_positions) or "bottom",
            font=legend_fonts[0] if legend_fonts else None,
        )

    data_labels = None
    if has_data_labels:
        show = sum(has_data_labels) > len(has_data_labels) / 2
        data_labels = DataLabelStyle(
            show=show, format=_modal(data_label_formats) if data_label_formats else None,
        )

    cat_ax_style = None
    if category_axis_visible:
        cat_ax_style = AxisStyle(visible=sum(category_axis_visible) > len(category_axis_visible) / 2)
    val_ax_style = None
    if value_axis_visible:
        val_ax_style = AxisStyle(visible=sum(value_axis_visible) > len(value_axis_visible) / 2)

    plot_area = None
    if plot_area_fills:
        plot_area = FillStyle(fill_type="solid", color=_modal(plot_area_fills))

    return ChartStyle(
        chart_type=chart_type,
        color_sequence=longest_seq,
        title_font=title_font,
        legend=legend,
        data_labels=data_labels,
        category_axis=cat_ax_style,
        value_axis=val_ax_style,
        plot_area=plot_area,
        sample_count=len(charts),
    )


# ── Table style extraction ──────────────────────────────────────────────────


def _build_table_style(tables: list[Any], theme: dict[str, str],
                         text_styles: TextStyleCatalog) -> TableStyle | None:
    """Aggregate styling across all observed tables. Returns None if no tables."""
    if not tables:
        return None

    header_fills: list[str] = []
    header_text_colors: list[str] = []
    cell_fonts_names: list[str] = []
    cell_fonts_sizes: list[float] = []
    banded_observed: list[bool] = []
    first_row_header_observed: list[bool] = []
    cols: list[int] = []
    rows: list[int] = []
    band_pair: list[tuple[str, str]] = []
    border_h_visibles: list[bool] = []
    border_v_visibles: list[bool] = []
    border_colors: list[str] = []
    border_widths: list[float] = []

    for tbl in tables:
        tp = getattr(tbl, "table_properties", None)
        if tp:
            banded_observed.append(bool(getattr(tp, "banded_rows", False)))
            first_row_header_observed.append(bool(getattr(tp, "first_row_header", False)))

        # Header fill + text font come from row 0 cell formats.
        cell_formats = getattr(tbl, "cell_formats", None) or []
        if cell_formats and len(cell_formats) > 0:
            header_row = cell_formats[0]
            for cell in header_row:
                fill = getattr(cell, "fill", None) or getattr(cell, "fill_color", None)
                hex_val = _resolve(fill, theme)
                if hex_val:
                    header_fills.append(hex_val)
                font = getattr(cell, "font", None)
                if font:
                    c = _resolve(getattr(font, "color", None), theme)
                    if c: header_text_colors.append(c)
            # Cell font from row 1 (first body row) if present.
            if len(cell_formats) > 1:
                body_row = cell_formats[1]
                for cell in body_row:
                    font = getattr(cell, "font", None)
                    if font:
                        if getattr(font, "name", None):
                            cell_fonts_names.append(str(font.name))
                        if getattr(font, "size", None):
                            cell_fonts_sizes.append(float(font.size))

            # Band pair: row 1 + row 2 fills.
            if len(cell_formats) >= 3:
                r1 = cell_formats[1]
                r2 = cell_formats[2]
                if r1 and r2:
                    f1 = _resolve(getattr(r1[0], "fill", None) or getattr(r1[0], "fill_color", None), theme)
                    f2 = _resolve(getattr(r2[0], "fill", None) or getattr(r2[0], "fill_color", None), theme)
                    if f1 and f2:
                        band_pair.append((f1, f2))

        data = getattr(tbl, "data", None) or []
        if data:
            rows.append(len(data))
            cols.append(len(data[0]) if data else 0)

    body_font_name = _modal(cell_fonts_names) or "Inter"
    body_font_size = _safe_median(cell_fonts_sizes, default=10.0)

    return TableStyle(
        header_fill=_modal(header_fills),
        header_font=FontSpec(
            name=body_font_name, size=11.0, bold=True,
            color=_modal(header_text_colors),
        ),
        cell_font=FontSpec(name=body_font_name, size=body_font_size or 10.0),
        banded_rows=(sum(banded_observed) > len(banded_observed) / 2) if banded_observed else False,
        band_fills=list(_modal(band_pair) or ()),
        first_row_header=(sum(first_row_header_observed) > len(first_row_header_observed) / 2)
                          if first_row_header_observed else False,
        border_horizontal=LineStyle(visible=True, color="#D5D5D5", width=1.0)
                            if tables else None,
        border_vertical=LineStyle(visible=False),
        typical_columns=int(round(_safe_median(cols) or 0)) if cols else None,
        typical_rows=int(round(_safe_median(rows) or 0)) if rows else None,
        sample_count=len(tables),
    )


# ── Palette ordering ────────────────────────────────────────────────────────


def _build_palette_ordered(docs: list[Any], theme: dict[str, str]) -> list[str]:
    """Most-used → least-used hex colors across the whole corpus."""
    counts: Counter = Counter()
    for doc in docs:
        doc_theme = getattr(doc, "theme_colors", None) or theme
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                # Fill
                fill = getattr(el, "fill", None)
                if fill is not None:
                    fc = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
                    h = _resolve(fc, doc_theme)
                    if h: counts[h] += 1
                # Line
                line = getattr(el, "line", None)
                if line is not None:
                    h = _resolve(getattr(line, "color", None), doc_theme)
                    if h: counts[h] += 1
                # Text
                for run in _iter_text_runs(el):
                    h = _resolve(getattr(run, "font_color", None), doc_theme)
                    if h: counts[h] += 1
    return [hex_val for hex_val, _ in counts.most_common(16)]


# ── Public entry point ──────────────────────────────────────────────────────


def extract_profile(docs: list[Any], theme_colors: dict[str, str] | None = None) -> StyleProfile:
    """Walk every BridgeDocument and produce a StyleProfile."""
    theme = theme_colors or {}

    # Bucket charts by type, collect tables.
    charts_by_type: dict[str, list[Any]] = defaultdict(list)
    tables: list[Any] = []
    element_count = 0

    for doc in docs:
        doc_theme = getattr(doc, "theme_colors", None) or theme
        for slide in (doc.slides or []):
            for el in (slide.elements or []):
                element_count += 1
                etype = getattr(el, "element_type", None)
                if etype == "BridgeChart":
                    ct = (getattr(el, "chart_type", None) or "UNKNOWN").upper()
                    charts_by_type[ct].append(el)
                elif etype == "BridgeTable":
                    tables.append(el)
        # Merge theme colors from all docs so resolve() works even when one
        # doc references a color slot defined in another.
        for k, v in (getattr(doc, "theme_colors", None) or {}).items():
            theme.setdefault(k, v)

    # Build the dataclasses.
    text_styles = _build_text_styles(docs, theme)
    chart_styles = [
        _build_chart_style(ct, charts, theme)
        for ct, charts in sorted(charts_by_type.items(), key=lambda kv: -len(kv[1]))
    ]
    table_style = _build_table_style(tables, theme, text_styles)
    palette = _build_palette_ordered(docs, theme)

    primary_font = (text_styles.body.name if text_styles.body
                    else text_styles.title.name if text_styles.title
                    else "Inter")

    return StyleProfile(
        chart_styles=chart_styles,
        table_style=table_style,
        text_styles=text_styles,
        palette_ordered=palette,
        primary_font=primary_font,
        sample_element_count=element_count,
        sample_doc_count=len(docs),
    )
