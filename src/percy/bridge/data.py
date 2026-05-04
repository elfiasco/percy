"""Data refresh utilities for BridgeElements.

``BridgeDataSource`` is the single data-binding point for all BridgeElements.
The same object drives Percy presentation rendering *and* Tableau export — the
DataFrame is just rendered into different targets.

Usage::

    from percy.bridge.data import BridgeDataSource, refresh_chart_data

    ds = BridgeDataSource.from_csv("revenue.csv")
    refresh_chart_data(chart, ds, category_col="Quarter")
    # same ds → Tableau:
    from percy.tableau import chart_to_twbx
    twbx_bytes = chart_to_twbx(chart, ds)
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import pandas as pd

from percy.bridge.elements import (
    BridgeChart,
    BridgeShape,
    BridgeTable,
    BridgeText,
    CellFormat,
    ChartCategories,
    ChartSeries,
    TextParagraph,
    TextRun,
)


# ---------------------------------------------------------------------------
# BridgeDataSource
# ---------------------------------------------------------------------------

class BridgeDataSource:
    """
    Tabular data container that binds to BridgeElements and exports to Tableau.

    Wraps a pandas DataFrame in **wide form**:
      - One column for categories / row labels
      - Remaining columns are series (one column per series, column name = series name)

    Example::

        ds = BridgeDataSource.from_dict({
            "Quarter": ["Q1", "Q2", "Q3", "Q4"],
            "Revenue": [100, 120, 130, 110],
            "Cost":    [ 80,  90,  95,  85],
        })
    """

    def __init__(self, df: "pd.DataFrame", name: str = "BridgeData") -> None:
        self.df = df
        self.name = name

    # ------------------------------------------------------------------
    # Constructors
    # ------------------------------------------------------------------

    @classmethod
    def from_csv(cls, path: str, name: str | None = None, **kwargs: Any) -> "BridgeDataSource":
        import pandas as pd
        return cls(pd.read_csv(path, **kwargs), name=name or path)

    @classmethod
    def from_records(cls, records: list[dict], name: str = "BridgeData") -> "BridgeDataSource":
        import pandas as pd
        return cls(pd.DataFrame(records), name=name)

    @classmethod
    def from_dict(cls, data: dict[str, list], name: str = "BridgeData") -> "BridgeDataSource":
        import pandas as pd
        return cls(pd.DataFrame(data), name=name)

    @classmethod
    def from_chart(cls, chart: BridgeChart) -> "BridgeDataSource":
        """Snapshot the live data of a BridgeChart into a new BridgeDataSource."""
        import pandas as pd
        cats = chart.categories.categories or chart.categories.categories_raw
        axis_label = (chart.category_axis.title.title_text or "Category")
        data: dict[str, list] = {axis_label: list(cats)}
        for s in chart.series:
            col = s.name or f"Series_{chart.series.index(s)}"
            data[col] = list(s.values)
        return cls(pd.DataFrame(data), name=chart.title.title or "BridgeData")

    @classmethod
    def from_table(
        cls, table: BridgeTable, has_header: bool = True
    ) -> "BridgeDataSource":
        """Snapshot the live data of a BridgeTable into a new BridgeDataSource."""
        import pandas as pd
        rows = table.data
        if not rows:
            return cls(pd.DataFrame(), name="BridgeData")
        if has_header and len(rows) > 1:
            return cls(pd.DataFrame(rows[1:], columns=rows[0]), name="BridgeData")
        return cls(pd.DataFrame(rows), name="BridgeData")

    # ------------------------------------------------------------------
    # Long-form view (for Tableau)
    # ------------------------------------------------------------------

    def to_long_form(
        self,
        category_col: str | None = None,
        series_cols: list[str] | None = None,
        value_col: str = "Value",
        series_name_col: str = "Series",
    ) -> "pd.DataFrame":
        """
        Pivot wide-form DataFrame to long form (Category / Series / Value).
        This is the canonical layout for Tableau chart encoding.

        Returns a DataFrame with columns: [category_col renamed to "Category",
        series_name_col, value_col].
        """
        cat_col = category_col or self.df.columns[0]
        val_cols = series_cols or [c for c in self.df.columns if c != cat_col]
        long = self.df.melt(
            id_vars=[cat_col],
            value_vars=val_cols,
            var_name=series_name_col,
            value_name=value_col,
        )
        if cat_col != "Category":
            long = long.rename(columns={cat_col: "Category"})
        return long

    # ------------------------------------------------------------------
    # Tableau Hyper export
    # ------------------------------------------------------------------

    def to_hyper(
        self,
        path: str,
        table_name: str = "Extract",
        long_form: bool = True,
        category_col: str | None = None,
    ) -> None:
        """
        Write to a Tableau Hyper file.  Requires: ``pip install pantab``

        Parameters
        ----------
        path : str
            Destination .hyper file path.
        long_form : bool
            If True (default), pivot to long form (Category / Series / Value)
            before writing — this is what standard Tableau chart worksheets expect.
        """
        try:
            import pantab
        except ImportError as exc:
            raise ImportError(
                "pantab is required for Hyper export:\n  pip install pantab"
            ) from exc
        df = self.to_long_form(category_col=category_col) if long_form else self.df
        pantab.frame_to_hyper(df, path, table=f"Extract.{table_name}")

    def __repr__(self) -> str:
        return f"BridgeDataSource(name={self.name!r}, shape={self.df.shape})"


# ---------------------------------------------------------------------------
# Data refresh functions
# ---------------------------------------------------------------------------

def refresh_chart_data(
    chart: BridgeChart,
    source: "pd.DataFrame | BridgeDataSource",
    category_col: str | None = None,
    value_cols: list[str] | None = None,
) -> BridgeChart:
    """
    Replace BridgeChart data in-place. All formatting is preserved.

    Parameters
    ----------
    chart : BridgeChart
        The chart to update.
    source : DataFrame or BridgeDataSource
        Wide-form data: one column for categories, one per series.
    category_col : str, optional
        Column to use as categories (default: first column).
    value_cols : list[str], optional
        Columns to use as series values (default: all non-category columns).
        Column names become series names.

    Returns
    -------
    BridgeChart
        The same object, mutated in-place.

    Notes
    -----
    - If the new data has fewer series than the original chart, extra series
      are dropped.
    - If the new data has MORE series, extra series are cloned from the last
      existing series (preserving its color, markers, line style, etc.).
    - Category count changes are handled gracefully.
    """
    import pandas as pd

    df: pd.DataFrame = source.df if isinstance(source, BridgeDataSource) else source
    cat_col = category_col or df.columns[0]
    val_cols = value_cols or [c for c in df.columns if c != cat_col]

    # --- categories ---
    new_cats = df[cat_col].astype(str).tolist()
    are_numeric = all(_is_numeric(v) for v in new_cats)
    chart.categories = replace(
        chart.categories,
        categories=new_cats,
        categories_raw=new_cats,
        categories_are_numeric=are_numeric,
    )

    # --- series ---
    template = chart.series[-1] if chart.series else ChartSeries()
    new_series: list[ChartSeries] = []
    for i, col in enumerate(val_cols):
        values = [float(v) if v is not None else 0.0 for v in df[col]]
        if i < len(chart.series):
            new_series.append(replace(chart.series[i], name=col, values=values))
        else:
            new_series.append(replace(template, name=col, values=values))
    chart.series = new_series

    return chart


def refresh_table_data(
    table: BridgeTable,
    source: "pd.DataFrame | list[list] | BridgeDataSource",
    has_header: bool | None = None,
) -> BridgeTable:
    """
    Replace BridgeTable cell values in-place. All formatting is preserved.

    Parameters
    ----------
    table : BridgeTable
        The table to update.
    source : DataFrame, list-of-lists, or BridgeDataSource
        New data. When a DataFrame is passed, column names become the header row
        (if has_header is True or if the original table had first_row_header).
    has_header : bool, optional
        Whether the new data includes a header row.  Defaults to
        ``table.table_properties.first_row_header``.

    Returns
    -------
    BridgeTable
        The same object, mutated in-place.

    Notes
    -----
    - Formatting for existing row/column positions is preserved.
    - New rows beyond the original row count are assigned formatting cloned
      from the last non-header data row.
    - New columns beyond the original column count use default formatting.
    """
    import pandas as pd

    include_header = (
        has_header if has_header is not None
        else table.table_properties.first_row_header
    )

    if isinstance(source, BridgeDataSource):
        df = source.df
    elif isinstance(source, pd.DataFrame):
        df = source
    else:
        # raw list-of-lists — treat as-is
        table.data = [list(row) for row in source]
        _sync_cell_formats(table)
        return table

    if include_header:
        new_data = [list(df.columns)] + [list(row) for row in df.itertuples(index=False)]
    else:
        new_data = [list(row) for row in df.itertuples(index=False)]

    table.data = new_data
    _sync_cell_formats(table)
    return table


def refresh_text_data(
    element: BridgeText,
    text: str,
    paragraph_idx: int = 0,
) -> BridgeText:
    """
    Replace the text content of a BridgeText element.

    All run formatting (font, color, size, bold, italic) from the first
    existing run is preserved and applied to the replacement text.

    Parameters
    ----------
    element : BridgeText
    text : str
        Replacement text content.
    paragraph_idx : int
        Which paragraph to replace (default: 0, the first one).

    Returns
    -------
    BridgeText
        The same object, mutated in-place.
    """
    if not element.paragraphs:
        element.paragraphs = [TextParagraph(runs=[TextRun(text=text)])]
        return element

    idx = min(paragraph_idx, len(element.paragraphs) - 1)
    para = element.paragraphs[idx]

    if para.runs:
        first_run = para.runs[0]
        new_run = replace(first_run, text=text, is_line_break=False)
        new_para = replace(para, runs=[new_run])
    else:
        new_para = replace(para, runs=[TextRun(text=text)])

    paras = list(element.paragraphs)
    paras[idx] = new_para
    element.paragraphs = paras
    return element


def refresh_shape_text(
    shape: BridgeShape,
    text: str,
) -> BridgeShape:
    """
    Replace text content in a BridgeShape. Shape geometry and fill preserved.

    Parameters
    ----------
    shape : BridgeShape
    text : str

    Returns
    -------
    BridgeShape
        The same object, mutated in-place.
    """
    tc = shape.text_content
    shape.text_content = replace(tc, has_text=bool(text), text_content=text)

    if tc.paragraphs:
        first_para = tc.paragraphs[0]
        if first_para.runs:
            new_run = replace(first_para.runs[0], text=text, is_line_break=False)
            new_para = replace(first_para, runs=[new_run])
        else:
            new_para = replace(first_para, runs=[TextRun(text=text)])
        shape.text_content = replace(
            shape.text_content, paragraphs=[new_para]
        )
    return shape


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_datasources(document: "Any") -> "dict[tuple[int, int], BridgeDataSource]":
    """
    Walk a PercyDocument and return a BridgeDataSource for every BridgeChart
    and BridgeTable, keyed by (slide_number, shape_id).

    Usage::

        doc = onboard_pptx("deck.pptx")
        sources = extract_datasources(doc)
        ds = sources[(1, 42)]          # slide 1, shape id 42
        refresh_chart_data(chart, ds)
    """
    result: dict[tuple[int, int], "BridgeDataSource"] = {}
    for slide in document.slides:
        for element in slide.elements:
            key = (
                element.identification.slide_number or slide.slide_number,
                element.identification.shape_id or 0,
            )
            if isinstance(element, BridgeChart):
                result[key] = BridgeDataSource.from_chart(element)
            elif isinstance(element, BridgeTable):
                result[key] = BridgeDataSource.from_table(
                    element,
                    has_header=element.table_properties.first_row_header,
                )
    return result


def _is_numeric(val: str) -> bool:
    try:
        float(val)
        return True
    except (ValueError, TypeError):
        return False


def _sync_cell_formats(table: BridgeTable) -> None:
    """
    Ensure cell_formats has the same row/col dimensions as table.data.
    Preserves existing formatting, clones last-row format for new rows,
    and uses a blank CellFormat for new columns.
    """
    n_rows = len(table.data)
    n_cols = max((len(r) for r in table.data), default=0)

    old_formats = table.cell_formats
    last_data_row_idx = max(
        (i for i in range(len(old_formats)) if old_formats[i]), default=0
    )
    template_row: list[CellFormat] = (
        old_formats[last_data_row_idx] if old_formats else []
    )

    new_formats: list[list[CellFormat]] = []
    for r in range(n_rows):
        row: list[CellFormat] = []
        for c in range(n_cols):
            if r < len(old_formats) and c < len(old_formats[r]):
                cell = old_formats[r][c]
            elif c < len(template_row):
                cell = deepcopy(template_row[c])
            else:
                cell = CellFormat(grid_row=r, grid_col=c)
            # Always sync the text value from table.data
            row.append(replace(cell, text=str(table.data[r][c]), grid_row=r, grid_col=c))
        new_formats.append(row)

    table.cell_formats = new_formats
