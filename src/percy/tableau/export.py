"""Tableau TWBX export for BridgeChart and BridgeTable.

Generates a self-contained ``.twbx`` (ZIP of .twb XML + .hyper data) from
any BridgeChart or BridgeTable.  The same BridgeDataSource used for
``refresh_chart_data`` is passed here — one DataFrame, two render targets.

Requirements::

    pip install pantab tableauhyperapi

Usage::

    from percy.bridge.data import BridgeDataSource, refresh_chart_data
    from percy.tableau import chart_to_twbx

    ds = BridgeDataSource.from_csv("revenue.csv")
    refresh_chart_data(chart, ds, category_col="Quarter")
    twbx_bytes = chart_to_twbx(chart, ds, sheet_name="Revenue Chart")
    Path("output.twbx").write_bytes(twbx_bytes)
"""

from __future__ import annotations

import hashlib
import io
import os
import tempfile
import uuid
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

from percy.bridge.data import BridgeDataSource
from percy.bridge.elements import BridgeChart, BridgeTable


# ---------------------------------------------------------------------------
# Chart type → Tableau mark type
# ---------------------------------------------------------------------------

_MARK_TYPE: dict[str, str] = {
    "COLUMN_CLUSTERED":             "Bar",
    "COLUMN_STACKED":               "Bar",
    "COLUMN_100_PERCENT_STACKED":   "Bar",
    "BAR_CLUSTERED":                "Bar",
    "BAR_STACKED":                  "Bar",
    "BAR_100_PERCENT_STACKED":      "Bar",
    "LINE":                         "Line",
    "LINE_MARKERS":                 "Line",
    "LINE_STACKED":                 "Line",
    "AREA":                         "Area",
    "AREA_STACKED":                 "Area",
    "PIE":                          "Pie",
    "DOUGHNUT":                     "Pie",
    "XY_SCATTER":                   "Circle",
    "BUBBLE":                       "Circle",
}

_STACKED_TYPES = {
    "COLUMN_STACKED", "COLUMN_100_PERCENT_STACKED",
    "BAR_STACKED", "BAR_100_PERCENT_STACKED",
    "AREA_STACKED",
}

_HORIZONTAL_TYPES = {
    "BAR_CLUSTERED", "BAR_STACKED", "BAR_100_PERCENT_STACKED",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def chart_to_twbx(
    chart: BridgeChart,
    datasource: BridgeDataSource,
    sheet_name: str | None = None,
    category_col: str | None = None,
) -> bytes:
    """
    Convert a BridgeChart + its BridgeDataSource to a Tableau TWBX file.

    Parameters
    ----------
    chart : BridgeChart
    datasource : BridgeDataSource
        The same datasource used with ``refresh_chart_data``.
    sheet_name : str, optional
        Tableau worksheet name (defaults to chart title or "Sheet 1").
    category_col : str, optional
        Which column in the datasource is the category axis
        (defaults to first column).

    Returns
    -------
    bytes
        Raw .twbx file bytes — write to disk with ``Path(...).write_bytes()``.
    """
    name = sheet_name or chart.title.title or "Sheet 1"
    cat_col = category_col or datasource.df.columns[0]
    mark_type = _MARK_TYPE.get(chart.chart_type or "", "Bar")
    is_horizontal = (
        chart.plot_properties.is_horizontal
        or (chart.chart_type or "") in _HORIZONTAL_TYPES
    )
    colors = [s.color for s in chart.series if s.color]

    long_df = datasource.to_long_form(category_col=cat_col)
    return _build_twbx(
        long_df=long_df,
        ds_name=datasource.name,
        sheet_name=name,
        mark_type=mark_type,
        is_horizontal=is_horizontal,
        colors=colors,
        chart_title=chart.title.title,
    )


def table_to_twbx(
    table: BridgeTable,
    datasource: BridgeDataSource,
    sheet_name: str = "Sheet 1",
) -> bytes:
    """
    Convert a BridgeTable + its BridgeDataSource to a Tableau TWBX text table.

    Returns
    -------
    bytes
        Raw .twbx file bytes.
    """
    return _build_twbx(
        long_df=datasource.df,
        ds_name=datasource.name,
        sheet_name=sheet_name,
        mark_type="Text",
        is_horizontal=False,
        colors=[],
        chart_title=None,
        is_table=True,
    )


# ---------------------------------------------------------------------------
# Internal TWBX builder
# ---------------------------------------------------------------------------

def _build_twbx(
    long_df: "Any",  # pd.DataFrame
    ds_name: str,
    sheet_name: str,
    mark_type: str,
    is_horizontal: bool,
    colors: list[str],
    chart_title: str | None,
    is_table: bool = False,
) -> bytes:
    """Build a .twbx ZIP in memory and return its bytes."""
    ds_id = "federated." + hashlib.md5(ds_name.encode()).hexdigest()[:12]

    with tempfile.TemporaryDirectory() as tmpdir:
        hyper_path = os.path.join(tmpdir, "data.hyper")
        _write_hyper(long_df, hyper_path)

        twb_xml = _build_twb(
            df=long_df,
            ds_id=ds_id,
            ds_caption=ds_name,
            hyper_filename="data.hyper",
            sheet_name=sheet_name,
            mark_type=mark_type,
            is_horizontal=is_horizontal,
            colors=colors,
            chart_title=chart_title,
            is_table=is_table,
        )

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{sheet_name}.twb", twb_xml)
            zf.write(hyper_path, "data.hyper")
        return buf.getvalue()


def _write_hyper(df: "Any", path: str) -> None:
    """Write DataFrame to a Tableau Hyper file via pantab."""
    try:
        import pantab
    except ImportError as exc:
        raise ImportError(
            "pantab is required for Tableau export:\n  pip install pantab"
        ) from exc
    pantab.frame_to_hyper(df, path, table="Extract.Extract")


def _build_twb(
    df: "Any",
    ds_id: str,
    ds_caption: str,
    hyper_filename: str,
    sheet_name: str,
    mark_type: str,
    is_horizontal: bool,
    colors: list[str],
    chart_title: str | None,
    is_table: bool,
) -> str:
    """Generate TWB XML string for the given parameters."""
    import pandas as pd

    # Infer column roles
    col_roles = _infer_column_roles(df)

    # Build datasource XML
    ds_xml = _datasource_xml(ds_id, ds_caption, hyper_filename, col_roles)

    # Build worksheet XML
    ws_xml = _worksheet_xml(
        ds_id=ds_id,
        col_roles=col_roles,
        sheet_name=sheet_name,
        mark_type=mark_type,
        is_horizontal=is_horizontal,
        colors=colors,
        chart_title=chart_title,
        is_table=is_table,
    )

    # Color palette from series colors
    palette_xml = ""
    if colors:
        entries = "\n".join(f"  <color>{c if c.startswith('#') else '#' + c}</color>" for c in colors)
        palette_xml = f"""<preferences>
<color-palette name="percy_series" type="regular">
{entries}
</color-palette>
</preferences>"""
    else:
        palette_xml = "<preferences />"

    return f"""<?xml version='1.0' encoding='utf-8' ?>
<workbook source-build='2024.1.0' source-platform='win' version='18.1'
          xmlns:user='http://www.tableausoftware.com/xml/user'>
  {palette_xml}
  <datasources>
    {ds_xml}
  </datasources>
  <worksheets>
    {ws_xml}
  </worksheets>
</workbook>"""


# ---------------------------------------------------------------------------
# Column role inference
# ---------------------------------------------------------------------------

def _infer_column_roles(df: "Any") -> list[dict[str, str]]:
    """
    Classify each DataFrame column as dimension or measure.
    Returns list of dicts: {name, datatype, role, type, domain_code}.

    domain_code is used in Tableau shelf references:
      - 'nk' = nominal dimension (kept)
      - 'qk' = quantitative measure (kept)
    """
    import pandas as pd

    roles = []
    for col in df.columns:
        is_numeric = pd.api.types.is_numeric_dtype(df[col])
        roles.append({
            "name": col,
            "datatype": "real" if is_numeric else "string",
            "role": "measure" if is_numeric else "dimension",
            "type": "quantitative" if is_numeric else "nominal",
            "domain_code": "qk" if is_numeric else "nk",
            "agg": "sum" if is_numeric else "none",
        })
    return roles


# ---------------------------------------------------------------------------
# Datasource XML
# ---------------------------------------------------------------------------

def _datasource_xml(
    ds_id: str,
    ds_caption: str,
    hyper_filename: str,
    col_roles: list[dict[str, str]],
) -> str:
    metadata = "\n".join(
        f"""<metadata-record class='column'>
          <remote-name>{r['name']}</remote-name>
          <remote-type>{'129' if r['datatype'] == 'string' else '5'}</remote-type>
          <local-name>[{r['name']}]</local-name>
          <parent-name>[Extract]</parent-name>
          <remote-alias>{r['name']}</remote-alias>
        </metadata-record>"""
        for r in col_roles
    )

    col_defs = "\n".join(
        f"<column datatype='{r['datatype']}' name='[{r['name']}]' "
        f"role='{r['role']}' type='{r['type']}' />"
        for r in col_roles
    )

    return f"""<datasource caption='{_esc(ds_caption)}' inline='true' name='{ds_id}' version='18.1'>
      <connection authentication='prompt' class='hyper'
                  dbname='{hyper_filename}' port='' server='' username=''>
        <relation name='Extract' table='[Extract].[Extract]' type='table' />
        <metadata-records>
          {metadata}
        </metadata-records>
      </connection>
      {col_defs}
    </datasource>"""


# ---------------------------------------------------------------------------
# Worksheet XML
# ---------------------------------------------------------------------------

def _worksheet_xml(
    ds_id: str,
    col_roles: list[dict[str, str]],
    sheet_name: str,
    mark_type: str,
    is_horizontal: bool,
    colors: list[str],
    chart_title: str | None,
    is_table: bool,
) -> str:
    dims  = [r for r in col_roles if r["role"] == "dimension"]
    meas  = [r for r in col_roles if r["role"] == "measure"]

    def ref(r: dict) -> str:
        return f"[{ds_id}].[{r['agg']}:{r['name']}:{r['domain_code']}]"

    if is_table:
        # Text table: all dimensions on Rows, all measures on Text encoding
        rows_shelf = " + ".join(ref(d) for d in dims) if dims else ""
        cols_shelf = " + ".join(ref(m) for m in meas) if meas else ""
        color_enc = ""
    else:
        # Chart: category on Cols shelf, value on Rows shelf
        cat_dim   = dims[0] if dims else None
        series_dim = dims[1] if len(dims) > 1 else None
        value_mea = meas[0] if meas else None

        if is_horizontal:
            rows_shelf = ref(cat_dim) if cat_dim else ""
            cols_shelf = ref(value_mea) if value_mea else ""
        else:
            cols_shelf = ref(cat_dim) if cat_dim else ""
            rows_shelf = ref(value_mea) if value_mea else ""

        color_enc = (
            f"<color field='{ref(series_dim)}' />"
            if series_dim else ""
        )

    title_xml = (
        f"<title><run>{_esc(chart_title)}</run></title>"
        if chart_title else ""
    )

    color_palette_attr = " color-palette='percy_series'" if colors else ""

    return f"""<worksheet name='{_esc(sheet_name)}'>
      {title_xml}
      <table>
        <view>
          <datasources>
            <datasource name='{ds_id}' />
          </datasources>
          <rows>{rows_shelf}</rows>
          <cols>{cols_shelf}</cols>
          <marks>
            <mark type='{mark_type}'{color_palette_attr} />
          </marks>
          <encodings>
            {color_enc}
          </encodings>
        </view>
        <style />
      </table>
    </worksheet>"""


def _esc(s: str | None) -> str:
    if not s:
        return ""
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace("'", "&apos;")
         .replace('"', "&quot;")
    )
