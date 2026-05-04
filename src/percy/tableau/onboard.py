"""Tableau workbook onboarding into existing Percy bridge elements."""

from __future__ import annotations

import zipfile
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from percy.bridge import (
    BridgeChart,
    BridgeImage,
    BridgeShape,
    BridgeSlide,
    BridgeTable,
    BridgeText,
    ChartCategories,
    ChartDataSource,
    ChartSeries,
    ChartTitle,
    ImageData,
    ImageDimensions,
    ImageFileInfo,
    PercyDocument,
    Position,
    PresentationMetadata,
    ShapeFill,
    ShapeIdentification,
    ShapeLine,
    ShapeTextContent,
    TextFrame,
    TextParagraph,
    TextRun,
)

_DEFAULT_WIDTH_IN = 16.0
_DEFAULT_HEIGHT_IN = 9.0
_DASHBOARD_UNITS_PER_INCH = 100.0

# Tableau's default "Tableau 10" color palette — used as fallback when no explicit
# palette is found in the workbook or worksheet style formats.
_TABLEAU_DEFAULT_PALETTE: list[str] = [
    "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
    "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
]

# Tableau named color palettes that appear in workbook XML.
# Maps canonical Tableau palette names → hex color lists.
_TABLEAU_NAMED_PALETTES: dict[str, list[str]] = {
    "tableau10medium": ["#729ECE","#FF9E4A","#67BF5C","#ED665D","#AD8BC9","#A8786E","#ED97CA","#A2A2A2","#CDCC5D","#6DCCDA"],
    "tableau20": ["#4E79A7","#A0CBE8","#F28E2B","#FFBE7D","#59A14F","#8CD17D","#B6992D","#F1CE63","#499894","#86BCB6","#E15759","#FF9D9A","#79706E","#BAB0AC","#D37295","#FABFD2","#B07AA1","#D4A6C8","#9D7660","#D7B5A6"],
    "colorblind10": ["#1170AA","#FC7D0B","#A3ACB9","#57606C","#5FA2CE","#C85200","#7B848F","#A3CDE9","#FFD94A","#9999FF"],
    "tableau-colorblind-10": ["#1170AA","#FC7D0B","#A3ACB9","#57606C","#5FA2CE","#C85200","#7B848F","#A3CDE9","#FFD94A","#9999FF"],
    "blue-teal": ["#1F456E","#2E6B9E","#4592C4","#6BB0D2","#96CBE1","#BFE0EE","#DAF0FA"],
    "red-gold": ["#C8000B","#EB1C2D","#F7372C","#FA7F5F","#F9B799","#FAD9CC","#FEF4F0"],
    "green": ["#1A4D2E","#2E7D46","#3E9D5C","#64B87A","#90CDA0","#BEE3C2","#DEF1DF"],
}

_CHART_MARKS = {
    "Area",
    "Bar",
    "Circle",
    "GanttBar",
    "Line",
    "Map",
    "Pie",
    "Polygon",
    "Shape",
    "Square",
}

_FIELD_REF_RE = re.compile(r"\[([^\]]+)\](?:\.\[([^\]]+)\])?")
_TABLEAU_FUNCTION_RE = re.compile(r"\b([A-Z][A-Z0-9_]*)\s*\(", re.IGNORECASE)


def onboard_tableau(path: str | Path) -> PercyDocument:
    """Convert a Tableau ``.twb`` or ``.twbx`` into a PercyDocument.

    Tableau is not flattened into a new workbook model here. We extract the
    core visual artifacts into existing bridge elements and keep Tableau shelf,
    mark, datasource, filter, and layout metadata in ``custom_properties``.
    """

    source_path = Path(path)
    workbook_xml, packaged_files, package_bytes = _read_tableau_workbook(source_path)
    root = ET.fromstring(workbook_xml)

    datasources = _parse_datasources(root)
    dashboard_placements = _dashboard_placements(root)
    workbook_info = _workbook_info(root, source_path, packaged_files, package_bytes, datasources)
    workbook_info["dashboard_placements"] = dashboard_placements
    color_palettes = workbook_info.get("color_palettes", [])
    slides: list[BridgeSlide] = []

    hyper_ds = _HyperDataSource(package_bytes)
    try:
        for worksheet in _direct_children(root, "worksheets", "worksheet"):
            slides.append(
                _worksheet_to_slide(
                    worksheet,
                    len(slides) + 1,
                    datasources,
                    workbook_info.get("packaged_extracts", []),
                    dashboard_placements,
                    color_palettes=color_palettes,
                    hyper_ds=hyper_ds,
                )
            )
    finally:
        hyper_ds.close()

    for dashboard in _direct_children(root, "dashboards", "dashboard"):
        slides.append(_dashboard_to_slide(dashboard, len(slides) + 1, package_bytes))

    document = PercyDocument(
        slides=slides,
        metadata=PresentationMetadata(
            slide_width=_DEFAULT_WIDTH_IN,
            slide_height=_DEFAULT_HEIGHT_IN,
            slide_count=len(slides),
            source_path=str(source_path),
            notes={"tableau": workbook_info},
        ),
        source_path=str(source_path),
        custom_properties={
            "source_format": "tableau",
            "tableau": workbook_info,
        },
    )
    return document


def inspect_tableau(path: str | Path) -> dict[str, Any]:
    """Return a compact summary for a Tableau workbook."""

    document = onboard_tableau(path)
    tableau = document.custom_properties.get("tableau", {})
    return {
        "source": str(path),
        "slides": len(document.slides),
        "worksheets": tableau.get("worksheet_count", 0),
        "dashboards": tableau.get("dashboard_count", 0),
        "datasources": tableau.get("datasource_count", 0),
        "packaged_files": tableau.get("packaged_files", []),
        "bridge_elements": _count_elements(document),
    }


def _read_tableau_workbook(path: Path) -> tuple[str, list[str], dict[str, bytes]]:
    if path.suffix.lower() == ".twb":
        return path.read_text(encoding="utf-8"), [path.name], {}

    if path.suffix.lower() != ".twbx":
        raise ValueError(f"Expected .twb or .twbx, got {path.suffix}")

    with zipfile.ZipFile(path) as package:
        names = package.namelist()
        twb_names = [name for name in names if name.lower().endswith(".twb")]
        if not twb_names:
            raise ValueError(f"No .twb workbook found in {path}")
        twb_name = min(twb_names, key=lambda name: (name.count("/"), len(name)))
        workbook_xml = package.read(twb_name).decode("utf-8")
        package_bytes = {
            name.replace("\\", "/"): package.read(name)
            for name in names
            if not name.lower().endswith(".twb")
        }
    return workbook_xml, names, package_bytes


def _inspect_packaged_extracts(package_bytes: dict[str, bytes]) -> list[dict[str, Any]]:
    extracts = []
    for package_path, payload in package_bytes.items():
        suffix = Path(package_path).suffix.lower()
        if suffix not in {".hyper", ".tde"}:
            continue
        extract = {
            "path": package_path,
            "name": Path(package_path).name,
            "format": suffix.lstrip("."),
            "size_bytes": len(payload),
            "status": "unsupported_legacy_tde" if suffix == ".tde" else "pending",
            "tables": [],
        }
        if suffix == ".hyper":
            extract.update(_inspect_hyper_payload(package_path, payload))
        else:
            extract["header_preview"] = _ascii_preview(payload[:256])
            extract["message"] = "Legacy .tde extracts are inventoried, but require Tableau legacy extract tooling to query."
        extracts.append(extract)
    return extracts


def _inspect_hyper_payload(package_path: str, payload: bytes) -> dict[str, Any]:
    try:
        from tableauhyperapi import Connection, HyperProcess, Telemetry
    except Exception as exc:
        return {
            "status": "missing_dependency",
            "error": f"{type(exc).__name__}: {exc}",
            "message": "Install tableauhyperapi/pantab to inspect packaged .hyper data.",
            "tables": [],
        }

    try:
        with _hyper_temp_dir() as tmp_dir:
            hyper_path = Path(tmp_dir) / Path(package_path).name
            hyper_path.write_bytes(payload)
            tables = []
            with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as hyper:
                with Connection(endpoint=hyper.endpoint, database=hyper_path) as conn:
                    for schema in conn.catalog.get_schema_names():
                        for table_name in conn.catalog.get_table_names(schema=schema):
                            definition = conn.catalog.get_table_definition(table_name)
                            columns = [
                                {
                                    "name": _hyper_name(column.name),
                                    "type": str(column.type),
                                    "nullable": str(column.nullability),
                                }
                                for column in definition.columns
                            ]
                            row_count = conn.execute_scalar_query(f"SELECT COUNT(*) FROM {table_name}")
                            tables.append(
                                {
                                    "schema": _hyper_name(schema),
                                    "name": _hyper_table_name(schema, table_name),
                                    "row_count": int(row_count or 0),
                                    "columns": columns,
                                    "sample_rows": _hyper_sample_rows(conn, table_name, columns),
                                }
                            )
            return {"status": "ok", "tables": tables}
    except Exception as exc:
        return {
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "tables": [],
        }


def _hyper_sample_rows(conn: Any, table_name: Any, columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not columns:
        return []
    try:
        rows = conn.execute_list_query(f"SELECT * FROM {table_name} LIMIT 5")
    except Exception:
        return []
    names = [column["name"] for column in columns]
    return [
        {
            name: _json_value(value)
            for name, value in zip(names, row)
        }
        for row in rows
    ]


class _HyperDataSource:
    """Opens the first packaged .hyper extract and provides SQL query capability."""

    def __init__(self, package_bytes: dict[str, bytes]) -> None:
        self._conn: Any = None
        self._hyper: Any = None
        self._tmp_dir: str | None = None
        self._table: Any = None
        self._col_names: dict[str, str] = {}  # lowercase → original casing
        self._setup(package_bytes)

    def _setup(self, package_bytes: dict[str, bytes]) -> None:
        hyper_items = [(k, v) for k, v in package_bytes.items() if k.lower().endswith(".hyper")]
        if not hyper_items:
            return
        try:
            from tableauhyperapi import Connection, HyperProcess, Telemetry
        except ImportError:
            return
        package_path, payload = hyper_items[0]
        self._tmp_dir = tempfile.mkdtemp(prefix="percy-hyper-")
        hyper_path = Path(self._tmp_dir) / Path(package_path).name
        hyper_path.write_bytes(payload)
        try:
            self._hyper = HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU)
            self._conn = Connection(endpoint=self._hyper.endpoint, database=hyper_path)
            for schema in self._conn.catalog.get_schema_names():
                for table in self._conn.catalog.get_table_names(schema=schema):
                    defn = self._conn.catalog.get_table_definition(table)
                    self._table = table
                    self._col_names = {
                        _hyper_name(col.name).lower(): _hyper_name(col.name)
                        for col in defn.columns
                    }
                    return
        except Exception:
            self._close_resources()

    def _close_resources(self) -> None:
        for attr in ("_conn", "_hyper"):
            obj = getattr(self, attr, None)
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
        if self._tmp_dir:
            import shutil
            shutil.rmtree(self._tmp_dir, ignore_errors=True)
        self._conn = self._hyper = self._tmp_dir = None

    def available(self) -> bool:
        return self._conn is not None and self._table is not None

    def col_names(self) -> dict[str, str]:
        return self._col_names

    def table_sql(self) -> str:
        return str(self._table) if self._table else '"Extract"."Extract"'

    def query(self, sql: str) -> list[tuple]:
        if not self.available():
            return []
        try:
            return list(self._conn.execute_list_query(sql))  # type: ignore[union-attr]
        except Exception:
            return []

    def close(self) -> None:
        self._close_resources()


# Tableau formula patterns that cannot be lowered to plain HyperSQL
_HYPER_UNSUPPORTED_RE = re.compile(
    r"\{|\bWINDOW_|\bLAST\s*\(|\bFIRST\s*\(|\bINDEX\s*\(|\bRANK\b|\bRUNNING_|\bSIZE\s*\(|"
    r"\bPCTO\b|\bPCTD\b|\bLOOKUP\s*\(",
    re.IGNORECASE,
)

_DATE_TRUNC_MAP = {"tdy": "day", "wk": "week", "mnth": "month", "qr": "quarter", "yr": "year"}

_SHELF_AGG_TO_SQL = {
    "sum": "SUM", "avg": "AVG", "average": "AVG",
    "min": "MIN", "max": "MAX", "cnt": "COUNT", "countd": "COUNT(DISTINCT ",
    "med": "MEDIAN", "var": "VAR_SAMP", "stdev": "STDDEV_SAMP",
}


def _resolve_tableau_name_to_sql(
    name: str,
    columns_dict: dict[str, dict[str, Any]],
    hyper_col_names: dict[str, str],
    depth: int = 0,
) -> str | None:
    """Resolve a Tableau field name to a HyperSQL expression, recursively through formulas."""
    if depth > 6:
        return None
    clean = name.strip("[]").strip()
    cl = clean.lower()
    # Direct base-column match
    if cl in hyper_col_names:
        return f'"{hyper_col_names[cl]}"'
    col = columns_dict.get(clean) or columns_dict.get(cl)
    if not col:
        return None
    formula = col.get("formula")
    if not formula:
        caption = (col.get("caption") or "").strip().lower()
        if caption in hyper_col_names:
            return f'"{hyper_col_names[caption]}"'
        return None
    # In Tableau, '+' between strings is concatenation; HyperSQL uses '||'.
    # Apply this substitution for string-typed columns only to avoid breaking numeric '+'.
    if col.get("datatype") == "string" and "+" in formula:
        formula = formula.replace("+", "||")
    result = _tableau_formula_to_hyper_sql(formula, columns_dict, hyper_col_names, depth + 1)
    if result is not None:
        return result
    # Formula couldn't be lowered (e.g. DATEADD with parameter reference).
    # Try each field reference inside the formula as a best-effort fallback so
    # that "DATEADD('day', [Parameter 1], [InvoiceDate])" → "InvoiceDate".
    for m in _FIELD_REF_RE.finditer(formula):
        ref = m.group(2) or m.group(1)  # prefer datasource.field, else just field
        if ref.lower() in {"parameters", "parameter 1", "parameter1"}:
            continue
        if ref.lower().startswith("parameter"):
            continue
        fallback = _resolve_tableau_name_to_sql(ref, columns_dict, hyper_col_names, depth + 1)
        if fallback:
            return fallback
    return None


def _tableau_formula_to_hyper_sql(
    formula: str,
    columns_dict: dict[str, dict[str, Any]],
    hyper_col_names: dict[str, str],
    depth: int = 0,
) -> str | None:
    """Convert a Tableau formula string to a HyperSQL expression. Returns None if unsupported."""
    if depth > 6 or not formula:
        return None
    if _HYPER_UNSUPPORTED_RE.search(formula):
        return None

    def _sub_ref(m: re.Match) -> str:
        inner = m.group(1)
        resolved = _resolve_tableau_name_to_sql(inner, columns_dict, hyper_col_names, depth + 1)
        return resolved or f'"{inner}"'

    sql = re.sub(r"\[([^\]]+)\]", _sub_ref, formula)
    # Aggregate functions
    sql = re.sub(r"\bSUM\s*\(", "SUM(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bCOUNTD\s*\(", "COUNT(DISTINCT ", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bCOUNT\s*\(", "COUNT(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bAVG\s*\(", "AVG(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bMIN\s*\(", "MIN(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bMAX\s*\(", "MAX(", sql, flags=re.IGNORECASE)
    # Conditionals
    sql = re.sub(r"\bIF\b", "CASE WHEN", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bELSEIF\b", "WHEN", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bTHEN\b", "THEN", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bELSE\b", "ELSE", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bEND\b", "END", sql, flags=re.IGNORECASE)
    # String / math helpers
    sql = re.sub(r"\bLEN\s*\(", "LENGTH(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bLOWER\s*\(", "LOWER(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bUPPER\s*\(", "UPPER(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bLEFT\s*\(", "LEFT(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bRIGHT\s*\(", "RIGHT(", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bSTR\s*\(([^)]+)\)", r"CAST(\1 AS TEXT)", sql, flags=re.IGNORECASE)
    # Bail if result still has unsupported constructs or unresolved parameter references.
    # '"Parameters"' appears when a Tableau parameter datasource ref couldn't be resolved
    # (e.g. DATEADD('day', [Parameters].[Parameter 1], [InvoiceDate]) →
    #        DATEADD('day', "Parameters"."4018", "InvoiceDate") — not valid HyperSQL).
    if _HYPER_UNSUPPORTED_RE.search(sql) or "{" in sql or '"Parameters"' in sql:
        return None
    return sql.strip()


def _query_chart_data(
    hyper_ds: _HyperDataSource,
    info: dict[str, Any],
) -> "tuple[list[str], list[ChartSeries]] | None":
    """Query the Hyper extract for real chart categories and values.

    Returns (categories, series) on success, None when the worksheet is too
    complex (table calcs, LOD, percent-of-total) to lower to plain SQL.
    """
    if not hyper_ds.available():
        return None

    hyper_cols = hyper_ds.col_names()
    columns_dict: dict[str, dict[str, Any]] = {}
    # Datasource schemas carry formula data; process them first so setdefault keeps them.
    for schema in info.get("datasource_schemas", []):
        for col in schema.get("columns", []):
            for key in (col.get("name", "").strip("[]"), (col.get("caption") or "").strip()):
                if key:
                    columns_dict.setdefault(key, col)
                    columns_dict.setdefault(key.lower(), col)
    # Worksheet-level columns may lack formulas but have correct per-worksheet metadata.
    for col in info.get("columns", []):
        for key in (col.get("name", "").strip("[]"), (col.get("caption") or "").strip()):
            if key:
                columns_dict.setdefault(key, col)
                columns_dict.setdefault(key.lower(), col)

    row_dims, row_measures = _shelf_fields_by_role(info.get("row_shelves", []))
    col_dims, col_measures = _shelf_fields_by_role(info.get("col_shelves", []))

    # Re-classify any field that _shelf_fields_by_role put in dims but whose
    # columns_dict entry says role="measure" (e.g. pcto:usr:… table-calc wrappers).
    def _reclas(dims: list, measures: list) -> tuple[list, list]:
        real_dims: list = []
        real_meas: list = list(measures)
        for f in dims:
            fname = (f.get("name") or "").strip("[]")
            col = columns_dict.get(fname) or columns_dict.get(fname.lower())
            if col and col.get("role") == "measure":
                real_meas.append(f)
            else:
                real_dims.append(f)
        return real_dims, real_meas

    row_dims, row_measures = _reclas(row_dims, row_measures)
    col_dims, col_measures = _reclas(col_dims, col_measures)

    # Strip Tableau's special layout placeholders from shelf classification
    _SKIP_NAMES = {"Measure Names", "Multiple Values", "Measure Values"}
    row_dims = [f for f in row_dims if (f.get("name") or "") not in _SKIP_NAMES]
    col_dims = [f for f in col_dims if (f.get("name") or "") not in _SKIP_NAMES]

    # Determine layout: which shelf is dimension, which is measure
    dim_field: dict[str, Any] | None = None
    measure_fields: list[dict[str, Any]] = []
    sort_desc = False
    date_trunc: str | None = None
    limit = 12

    if row_dims and col_measures:
        # Horizontal bar: e.g. Description on rows, SUM(sales) on cols
        dim_field = row_dims[0]
        measure_fields = col_measures[:3]
        sort_desc = True
        limit = 10
        # If the row dimension is a date-trunc field, treat as time-series (sort by date, no ranking limit)
        _agg_raw_b1 = (dim_field.get("aggregation") or "").lower()
        _agg_b1 = _TABLE_CALC_PREFIX_RE.sub("", _agg_raw_b1).split(":")[0]
        if _agg_b1 in _DATE_TRUNC_AGGS:
            date_trunc = _DATE_TRUNC_MAP.get(_agg_b1)
            sort_desc = False
            limit = 36
    elif col_dims and row_measures:
        # Vertical bar / line: e.g. InvoiceDate on cols, sales on rows
        dim_field = col_dims[0]
        measure_fields = row_measures[:3]
        sort_desc = False
        limit = 36
        agg_raw = (dim_field.get("aggregation") or "").lower()
        agg = _TABLE_CALC_PREFIX_RE.sub("", agg_raw).split(":")[0]
        date_trunc = _DATE_TRUNC_MAP.get(agg)
    elif row_dims and not col_measures:
        # Dimension-only or mixed-row shelf — look for a color/size encoding first
        dim_field = row_dims[0]
        for mark in info.get("shelves", {}).get("marks", []):
            for enc in mark.get("encodings", []):
                if enc.get("type") in {"color", "size"} and enc.get("field_info", {}).get("name"):
                    fname = enc["field_info"]["name"].strip("[]")
                    if columns_dict.get(fname, {}).get("role") == "measure":
                        measure_fields = [{"name": f"[{fname}]", "aggregation": "sum", "role_code": "qk"}]
                        break
            if measure_fields:
                break
        # Fallback: row_measures misclassified earlier (e.g. pcto:sum:… now fixed) or genuinely on rows
        if not measure_fields and row_measures:
            measure_fields = row_measures[:3]
        sort_desc = True
        limit = 10
    else:
        return None

    if not dim_field:
        return None

    # Resolve dimension → SQL: try candidates in order until one resolves.
    # The primary dim may be an unresolvable table-calc (e.g. INDEX()); fall through to others.
    all_dim_candidates = [dim_field] + [d for d in (row_dims + col_dims) if d is not dim_field]
    dim_sql: str | None = None
    for _dcand in all_dim_candidates:
        _dname = (_dcand.get("name") or "").strip("[]")
        _dsql = _resolve_tableau_name_to_sql(_dname, columns_dict, hyper_cols)
        if _dsql:
            dim_field = _dcand
            dim_sql = _dsql
            break
    if not dim_sql:
        # Last resort for map charts: find a dimension in LOD mark encodings
        # (e.g. Country in a Latitude/Longitude map where shelves use generated fields)
        for mark in info.get("shelves", {}).get("marks", []):
            for enc in mark.get("encodings", []):
                if enc.get("type") not in {"lod", "detail"}:
                    continue
                fi = enc.get("field_info") or {}
                fname = (fi.get("name") or "").strip("[]")
                if not fname:
                    continue
                col = columns_dict.get(fname) or columns_dict.get(fname.lower())
                if not col or col.get("role") != "dimension":
                    continue
                _dsql = _resolve_tableau_name_to_sql(fname, columns_dict, hyper_cols)
                if not _dsql:
                    continue
                dim_field = {"name": f"[{fname}]", "aggregation": "none", "role_code": "nk"}
                dim_sql = _dsql
                break
            if dim_sql:
                break
        if dim_sql:
            # Also pull the measure from LOD encodings (prefer over any color/size measure
            # that may have been set to an unresolvable table-calc field)
            for mark in info.get("shelves", {}).get("marks", []):
                for enc in mark.get("encodings", []):
                    if enc.get("type") != "lod":
                        continue
                    fi2 = enc.get("field_info") or {}
                    f2 = (fi2.get("name") or "").strip("[]")
                    if not f2:
                        continue
                    c2 = columns_dict.get(f2) or columns_dict.get(f2.lower())
                    if not c2 or c2.get("role") != "measure":
                        continue
                    measure_fields = [{"name": f"[{f2}]", "aggregation": fi2.get("aggregation") or "usr", "role_code": "qk"}]
                    sort_desc = True
                    limit = 10
                    break
                if measure_fields:
                    break
    if not dim_sql:
        return None

    if date_trunc:
        cat_expr = f"DATE_TRUNC('{date_trunc}', {dim_sql})"
        def _fmt(v: Any) -> str:
            return str(v)[:10] if v is not None else "?"
    else:
        cat_expr = dim_sql
        def _fmt(v: Any) -> str:  # type: ignore[misc]
            return str(v) if v is not None else "?"

    # Resolve measure fields → SQL expressions
    measure_exprs: list[tuple[str, str]] = []  # (sql, display_name)
    for mf in measure_fields:
        m_name = (mf.get("name") or "").strip("[]")
        m_agg_raw = (mf.get("aggregation") or "").lower()
        # Use [0]: pcto:sum:Field:ok:2 → sum:Field:ok:2 → "sum", not "2"
        m_agg = _TABLE_CALC_PREFIX_RE.sub("", m_agg_raw).split(":")[0]

        # Skip pure table-calc measures that can't be expressed as plain SQL
        # (pcto/pctd are approximated by using the inner SUM, which is fine for ranking)
        if any(tag in m_agg_raw for tag in ("running", "window", "lookup", "rank")):
            continue

        inner = _resolve_tableau_name_to_sql(m_name, columns_dict, hyper_cols)
        if not inner:
            continue

        display = _field_display_name(f"[{m_name}]", info) or m_name
        formula = (columns_dict.get(m_name) or {}).get("formula") or ""
        already_agg = bool(re.search(r"\b(sum|avg|min|max|count|countd)\s*\(", formula, re.IGNORECASE))

        if already_agg:
            measure_exprs.append((inner, display))
        elif m_agg == "countd":
            measure_exprs.append((f"COUNT(DISTINCT {inner})", display))
        elif m_agg in _SHELF_AGG_TO_SQL:
            measure_exprs.append((f"{_SHELF_AGG_TO_SQL[m_agg]}({inner})", display))
        else:
            measure_exprs.append((f"SUM({inner})", display))

        if len(measure_exprs) >= 3:
            break

    if not measure_exprs:
        return None

    # If the primary measure is a trivial numeric constant (e.g. formula='0'), it's a dummy
    # positioning field. Scan mark encodings for a real resolvable measure instead.
    def _is_trivial_sql(expr: str) -> bool:
        s = expr.strip()
        try:
            float(s)
            return True
        except ValueError:
            pass
        m = re.match(r'^(?:MIN|MAX|SUM|AVG|COUNT)\s*\(\s*-?[\d.]+\s*\)$', s, re.IGNORECASE)
        return bool(m)

    if _is_trivial_sql(measure_exprs[0][0]):
        for mark in info.get("shelves", {}).get("marks", []):
            for enc in mark.get("encodings", []):
                if enc.get("type") not in {"color", "size", "text", "tooltip"}:
                    continue
                fi = enc.get("field_info") or {}
                enc_fname = (fi.get("name") or "").strip("[]")
                if not enc_fname:
                    continue
                enc_agg_raw = (fi.get("aggregation") or "").lower()
                if any(tag in enc_agg_raw for tag in ("running", "window", "lookup", "rank")):
                    continue
                enc_col = columns_dict.get(enc_fname) or columns_dict.get(enc_fname.lower())
                if not enc_col or enc_col.get("role") != "measure":
                    continue
                enc_inner = _resolve_tableau_name_to_sql(enc_fname, columns_dict, hyper_cols)
                if not enc_inner or _is_trivial_sql(enc_inner):
                    continue
                enc_display = _field_display_name(f"[{enc_fname}]", info) or enc_fname
                enc_formula = (enc_col.get("formula") or "")
                enc_already_agg = bool(re.search(r"\b(sum|avg|min|max|count|countd)\s*\(", enc_formula, re.IGNORECASE))
                measure_exprs = [(enc_inner if enc_already_agg else f"SUM({enc_inner})", enc_display)]
                break
            if not _is_trivial_sql(measure_exprs[0][0]):
                break

    # Build and execute the GROUP BY query
    m0_expr = measure_exprs[0][0]
    sel = [f"{cat_expr} AS _cat"] + [f"{expr} AS _m{i}" for i, (expr, _) in enumerate(measure_exprs)]
    order = f"ORDER BY {m0_expr} DESC NULLS LAST" if sort_desc else "ORDER BY _cat ASC NULLS LAST"
    sql = (
        f"SELECT {', '.join(sel)} FROM {hyper_ds.table_sql()} "
        f"WHERE {cat_expr} IS NOT NULL "
        f"GROUP BY _cat {order} LIMIT {limit}"
    )

    rows = hyper_ds.query(sql)
    # Filter out rows where the primary measure is NULL
    rows = [r for r in rows if r[1] is not None]
    if not rows:
        return None

    categories = [_fmt(row[0]) for row in rows]

    # Colors from mark style, resolved palette, or default
    pane_colors: list[str] = []
    _skip = {"#ffffff", "#000000"}
    for mark in info.get("shelves", {}).get("marks", []):
        for fmt in mark.get("style_formats", []):
            if fmt.get("attr") == "mark-color":
                c = (fmt.get("value") or "").strip()
                if c and c.lower() not in _skip:
                    h = c.lstrip("#")
                    if len(h) == 6:
                        r2, g2, b2 = int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16)
                        if (r2 * 299 + g2 * 587 + b2 * 114) / 1000 <= 220:
                            pane_colors.append(c)
                            break
    colors = pane_colors or list(info.get("resolved_colors") or [])
    if len(colors) < 2:
        colors = colors + [c for c in _TABLEAU_DEFAULT_PALETTE if c not in colors]

    series: list[ChartSeries] = []
    for i, (_, display) in enumerate(measure_exprs):
        values = [float(row[i + 1] or 0) for row in rows]
        color = colors[i % len(colors)] if colors else _TABLEAU_DEFAULT_PALETTE[0]
        series.append(ChartSeries(name=display, values=values, color=color))

    return categories, series


def _extract_temp_root() -> str:
    candidates = [
        Path(tempfile.gettempdir()) / "percy-tableau-extracts",
        Path.cwd() / ".percy-tableau-extracts",
        Path.cwd() / "out" / "tableau-hyper-inspect",
    ]
    for root in candidates:
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return str(root)
        except Exception:
            continue
    return tempfile.gettempdir()


class _hyper_temp_dir:
    def __init__(self) -> None:
        self.path: Path | None = None

    def __enter__(self) -> str:
        root = Path(_extract_temp_root())
        for _ in range(5):
            candidate = root / f"hyper-{uuid.uuid4().hex}"
            try:
                candidate.mkdir(parents=True, exist_ok=False)
                probe = candidate / ".write_probe"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink(missing_ok=True)
                self.path = candidate
                return str(candidate)
            except Exception:
                continue
        raise PermissionError(f"Could not create writable Hyper temp dir under {root}")

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.path is not None:
            shutil.rmtree(self.path, ignore_errors=True)


def _hyper_name(value: Any) -> str:
    text = str(value)
    parts = [part.strip('"') for part in text.split(".")]
    return ".".join(part for part in parts if part)


def _hyper_table_name(schema: Any, table_name: Any) -> str:
    schema_name = _hyper_name(schema)
    name = _hyper_name(table_name)
    prefix = f"{schema_name}."
    return name[len(prefix):] if schema_name and name.startswith(prefix) else name


def _json_value(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    return value


def _ascii_preview(payload: bytes) -> str:
    return "".join(chr(byte) if 32 <= byte <= 126 or byte in {9, 10, 13} else "." for byte in payload)


def _color_palettes(root: ET.Element) -> list[dict[str, Any]]:
    palettes = []
    for palette in root.findall(".//color-palette"):
        colors = [
            (color.text or "").strip()
            for color in _children(palette, "color")
            if (color.text or "").strip()
        ]
        palettes.append(
            {
                "name": palette.attrib.get("name"),
                "type": palette.attrib.get("type"),
                "custom": palette.attrib.get("custom"),
                "colors": colors,
            }
        )
    return palettes


def _dashboard_placements(root: ET.Element) -> dict[str, list[dict[str, Any]]]:
    placements: dict[str, list[dict[str, Any]]] = {}
    for dashboard in _direct_children(root, "dashboards", "dashboard"):
        dashboard_name = dashboard.attrib.get("name") or "Dashboard"
        size = dashboard.find("./size")
        width_px = _int_attr(size, "maxwidth") or _int_attr(size, "minwidth") or 1600
        height_px = _int_attr(size, "maxheight") or _int_attr(size, "minheight") or 900
        for zone in dashboard.findall("./zones//zone"):
            worksheet_name = zone.attrib.get("name")
            if not worksheet_name:
                continue
            placement = _dashboard_zone_placement(zone, dashboard_name, width_px, height_px)
            placements.setdefault(worksheet_name, []).append(placement)
    return placements


def _dashboard_zone_placement(
    zone: ET.Element,
    dashboard_name: str,
    dashboard_width_px: int,
    dashboard_height_px: int,
) -> dict[str, Any]:
    x = _as_int(zone.attrib.get("x")) or 0
    y = _as_int(zone.attrib.get("y")) or 0
    w = _as_int(zone.attrib.get("w")) or 0
    h = _as_int(zone.attrib.get("h")) or 0
    return {
        "dashboard": dashboard_name,
        "zone_id": zone.attrib.get("id"),
        "zone_type": zone.attrib.get("type-v2") or zone.attrib.get("type"),
        "worksheet": zone.attrib.get("name"),
        "dashboard_size_px": {"width": dashboard_width_px, "height": dashboard_height_px},
        "tableau_units": {"x": x, "y": y, "w": w, "h": h},
        "normalized": {
            "x": x / 100000.0,
            "y": y / 100000.0,
            "w": w / 100000.0,
            "h": h / 100000.0,
        },
        "pixels": {
            "x": round((x / 100000.0) * dashboard_width_px, 2),
            "y": round((y / 100000.0) * dashboard_height_px, 2),
            "w": round((w / 100000.0) * dashboard_width_px, 2),
            "h": round((h / 100000.0) * dashboard_height_px, 2),
        },
        "raw_properties": dict(zone.attrib),
    }


def _workbook_info(
    root: ET.Element,
    source_path: Path,
    packaged_files: list[str],
    package_bytes: dict[str, bytes],
    datasources: list[dict[str, Any]],
) -> dict[str, Any]:
    worksheets = _direct_children(root, "worksheets", "worksheet")
    dashboards = _direct_children(root, "dashboards", "dashboard")
    return {
        "workbook_name": source_path.stem,
        "version": root.attrib.get("version"),
        "source_build": root.attrib.get("source-build"),
        "source_platform": root.attrib.get("source-platform"),
        "worksheet_count": len(worksheets),
        "dashboard_count": len(dashboards),
        "datasource_count": len(datasources),
        "datasources": datasources,
        "packaged_files": packaged_files,
        "packaged_extracts": _inspect_packaged_extracts(package_bytes),
        "packaged_images": _packaged_images(package_bytes),
        "color_palettes": _color_palettes(root),
    }


def _packaged_images(package_bytes: dict[str, bytes]) -> list[dict[str, Any]]:
    images = []
    for package_path, payload in package_bytes.items():
        suffix = Path(package_path).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg"}:
            continue
        image_info: dict[str, Any] = {
            "index": len(images),
            "path": package_path,
            "name": Path(package_path).name,
            "format": suffix.lstrip(".").upper(),
            "size_bytes": len(payload),
            "kind": _packaged_image_kind(package_path),
        }
        try:
            from PIL import Image
            import io

            with Image.open(io.BytesIO(payload)) as image:
                image_info["width_px"] = image.width
                image_info["height_px"] = image.height
        except Exception:
            pass
        images.append(image_info)
    return images


def _packaged_image_kind(path: str) -> str:
    name = Path(path).name.lower()
    if "icon" in name or name.endswith(".ico"):
        return "asset_icon"
    if "dashboard" in name or "worksheet" in name or "sheet" in name:
        return "native_snapshot_candidate"
    return "packaged_image"


def _parse_datasources(root: ET.Element) -> list[dict[str, Any]]:
    datasources: list[dict[str, Any]] = []
    for datasource in _direct_children(root, "datasources", "datasource"):
        columns = [_column_info(column) for column in _children(datasource, "column")]
        connections = [
            {
                "class": connection.attrib.get("class"),
                "caption": connection.attrib.get("caption"),
                "name": connection.attrib.get("name"),
                "dbname": connection.attrib.get("dbname"),
                "server": connection.attrib.get("server"),
                "raw_properties": dict(connection.attrib),
                "relations": [_relation_info(relation) for relation in _children(connection, "relation")],
            }
            for connection in datasource.iter()
            if _tag(connection) in {"connection", "named-connection"}
        ]
        metadata_records = []
        for record in datasource.findall(".//metadata-record"):
            metadata_records.append(
                {
                    "class": record.attrib.get("class"),
                    "remote_name": _child_text(record, "remote-name"),
                    "local_name": _child_text(record, "local-name"),
                    "parent_name": _child_text(record, "parent-name"),
                    "local_type": _child_text(record, "local-type"),
                    "aggregation": _child_text(record, "aggregation"),
                }
            )
        datasources.append(
            {
                "name": datasource.attrib.get("name"),
                "caption": datasource.attrib.get("caption"),
                "version": datasource.attrib.get("version"),
                "columns": columns,
                "connections": connections,
                "metadata_records": metadata_records,
            }
        )
    return datasources


def _worksheet_to_slide(
    worksheet: ET.Element,
    slide_number: int,
    datasources: list[dict[str, Any]],
    packaged_extracts: list[dict[str, Any]],
    dashboard_placements: dict[str, list[dict[str, Any]]],
    color_palettes: list[dict[str, Any]] | None = None,
    hyper_ds: "_HyperDataSource | None" = None,
) -> BridgeSlide:
    width = _DEFAULT_WIDTH_IN
    height = _DEFAULT_HEIGHT_IN
    name = worksheet.attrib.get("name") or f"Worksheet {slide_number}"
    title = _resolve_title_params(
        _formatted_text(worksheet.find("./layout-options/title/formatted-text")) or name,
        name,
    )
    worksheet_info = _worksheet_info(
        worksheet, datasources, packaged_extracts, dashboard_placements,
        color_palettes=color_palettes,
        worksheet_name=name,
    )

    slide = BridgeSlide(
        slide_number=slide_number,
        width=width,
        height=height,
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "worksheet",
            "tableau": worksheet_info,
        },
    )
    slide.elements.append(_title_text(title, name, width))

    if _is_chart_worksheet(worksheet_info):
        slide.elements.append(_worksheet_chart(worksheet_info, width, height, hyper_ds=hyper_ds))
    elif _is_kpi_card(worksheet_info):
        slide.elements.append(_worksheet_kpi_shape(worksheet_info, width, height))
    else:
        slide.elements.append(_worksheet_table(worksheet_info, width, height))

    return slide


def _resolve_all_colors(values: list[str]) -> list[str]:
    """Filter and normalize a list of color strings to valid hex values only."""
    resolved = []
    for v in values:
        if not v or not isinstance(v, str):
            continue
        v = v.strip()
        # Standard #RRGGBB
        if v.startswith("#") and len(v) == 7:
            resolved.append(v.upper())
        # ARGB #AARRGGBB → strip alpha channel
        elif v.startswith("#") and len(v) == 9:
            resolved.append("#" + v[3:].upper())
        # Short #RGB → expand
        elif v.startswith("#") and len(v) == 4:
            r, g, b = v[1], v[2], v[3]
            resolved.append(f"#{r}{r}{g}{g}{b}{b}".upper())
        # Skip non-hex (auto, transparent, named, etc.)
    return resolved


def _resolve_color(value: str | None) -> str | None:
    """Resolve a Tableau color value to a hex string, or None if not resolvable."""
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    # Already a valid hex color
    if v.startswith("#") and len(v) in {4, 7, 9}:
        return v.upper() if len(v) == 7 else v
    # Tableau stores ARGB as 8-char hex like #FF4E79A7 — strip alpha
    if v.startswith("#") and len(v) == 9:
        return "#" + v[3:].upper()
    return None


def _resolve_palette_colors(palette_name: str, color_palettes: list[dict[str, Any]]) -> list[str]:
    """Return hex colors for a named palette, falling back to built-ins."""
    key = palette_name.lower().replace(" ", "-").replace("_", "-")
    # Check workbook-defined palettes first
    for palette in color_palettes:
        if (palette.get("name") or "").lower().replace(" ", "-") == key:
            return [c for c in (palette.get("colors") or []) if c and c.startswith("#")]
    # Check built-in named palettes
    builtin = _TABLEAU_NAMED_PALETTES.get(key) or _TABLEAU_NAMED_PALETTES.get(key.replace("-", ""))
    if builtin:
        return builtin
    return []


def _resolve_worksheet_colors(
    style_summary: dict[str, Any],
    color_palettes: list[dict[str, Any]],
) -> list[str]:
    """Return a resolved list of hex colors for use in bridge chart series.

    Priority:
    1. Mark-specific colors from the worksheet style (element=marks/pane)
    2. General non-background, non-text hex colors from style
    3. First workbook palette with at least 3 colors
    4. Tableau default palette
    """
    _skip = {"#FFFFFF", "#000000", "#FFFFFFFF", "#FF000000"}

    # 1. Mark-specific colors
    mark_colors = [
        c for c in (style_summary.get("mark_colors") or [])
        if c and c.upper() not in _skip
    ]
    if mark_colors:
        return mark_colors

    # 2. General worksheet colors (already filtered in _style_summary)
    ws_colors = [
        c for c in (style_summary.get("colors") or [])
        if c and c.upper() not in _skip
    ]
    if ws_colors:
        return ws_colors

    # 3. First categorical workbook palette (skip sequential/diverging gradient scales)
    _gradient_types = {"ordered-sequential", "ordered-diverging"}
    for palette in color_palettes:
        if palette.get("type") in _gradient_types:
            continue
        colors = [c for c in (palette.get("colors") or []) if c and c.startswith("#")]
        if len(colors) >= 3:
            return colors

    # 4. Default Tableau palette
    return list(_TABLEAU_DEFAULT_PALETTE)


def _worksheet_info(
    worksheet: ET.Element,
    datasources: list[dict[str, Any]],
    packaged_extracts: list[dict[str, Any]],
    dashboard_placements: dict[str, list[dict[str, Any]]],
    color_palettes: list[dict[str, Any]] | None = None,
    worksheet_name: str | None = None,
) -> dict[str, Any]:
    name = worksheet.attrib.get("name")
    ws_name = worksheet_name or name or ""
    datasource_refs = []
    for datasource in worksheet.findall("./table/view/datasources/datasource"):
        datasource_refs.append(
            {
                "name": datasource.attrib.get("name"),
                "caption": datasource.attrib.get("caption"),
            }
        )

    columns = []
    column_instances = []
    for dep in worksheet.findall("./table/view/datasource-dependencies"):
        datasource_name = dep.attrib.get("datasource")
        for column in _children(dep, "column"):
            info = _column_info(column)
            info["datasource"] = datasource_name
            columns.append(info)
        for column in _children(dep, "column-instance"):
            info = dict(column.attrib)
            info["datasource"] = datasource_name
            column_instances.append(info)

    row_nodes = worksheet.findall("./table/rows")
    col_nodes = worksheet.findall("./table/cols")
    rows = [_text_or_xml(row) for row in row_nodes]
    cols = [_text_or_xml(col) for col in col_nodes]
    row_fields = _unique([ref for row in row_nodes for ref in _field_refs(row)])
    col_fields = _unique([ref for col in col_nodes for ref in _field_refs(col)])
    row_shelves = [_shelf_info("rows", value) for value in rows if value]
    col_shelves = [_shelf_info("cols", value) for value in cols if value]
    panes = [_pane_info(pane) for pane in worksheet.findall("./table/panes/pane")]
    marks = panes or [_mark_info(mark) for mark in worksheet.findall(".//mark")]
    mark_types = _unique([mark["class"] for mark in marks])
    primary_mark_type = mark_types[0] if mark_types else "Automatic"
    filters = [_filter_info(filter_el) for filter_el in worksheet.findall("./table/view/filter")]
    sorts = [_sort_info(sort_el) for sort_el in worksheet.findall("./table/view/shelf-sorts/*")]
    style_formats = _style_formats(worksheet.find("./table/style"))
    style_summary = _style_summary(style_formats, panes)
    style_model = _style_model(style_formats, panes)
    shelves = {
        "rows": rows,
        "cols": cols,
        "row_shelves": row_shelves,
        "col_shelves": col_shelves,
        "row_fields": row_fields,
        "col_fields": col_fields,
        "marks": marks,
    }
    used_fields = sorted(
        {
            field
            for field in _field_refs(worksheet)
            if field and not field.endswith(".[:Measure Names]")
        }
    )
    datasource_lookup = {source.get("name"): source for source in datasources}

    info = {
        "name": name,
        "title": _resolve_title_params(
            _formatted_text(worksheet.find("./layout-options/title/formatted-text")) or name,
            ws_name,
        ),
        "datasources": datasource_refs,
        "datasource_schemas": [
            datasource_lookup.get(ref.get("name"), {}) for ref in datasource_refs if ref.get("name")
        ],
        "packaged_extracts": packaged_extracts,
        "layout": {
            "worksheet_canvas": {
                "normalized": {"x": 0, "y": 0, "w": 1, "h": 1},
                "position_in": {"left": 0.5, "top": 1.1, "width": _DEFAULT_WIDTH_IN - 1.0, "height": _DEFAULT_HEIGHT_IN - 1.6},
            },
            "dashboard_placements": dashboard_placements.get(name or "", []),
        },
        "columns": columns,
        "column_instances": column_instances,
        "column_instance_model": _column_instance_model(column_instances),
        "rows": rows,
        "cols": cols,
        "row_fields": row_fields,
        "col_fields": col_fields,
        "row_shelves": row_shelves,
        "col_shelves": col_shelves,
        "mark_types": mark_types,
        "primary_mark_type": primary_mark_type,
        "filters": filters,
        "sorts": sorts,
        "shelves": shelves,
        "style_formats": style_formats,
        "style_summary": style_summary,
        "style_model": style_model,
        "used_fields": used_fields,
    }
    info["resolved_colors"] = _resolve_worksheet_colors(style_summary, color_palettes or [])
    info["layout"]["element_positions"] = _worksheet_element_positions(info)
    info["pythonic_model"] = _worksheet_pythonic_model(info)
    info["visual_items"] = _worksheet_visual_items(info)
    info["reconstruction"] = _worksheet_reconstruction(info)
    return info


def _is_kpi_card(info: dict[str, Any]) -> bool:
    """Return True for KPI number-card worksheets: Automatic mark with text encoding but no row/col fields."""
    primary_mark = info.get("primary_mark_type") or ""
    if primary_mark.lower() not in {"automatic", ""}:
        return False
    # row_fields/col_fields can be empty for compound shelf expressions — also check parsed shelf field_count
    has_row_col_fields = bool(
        info.get("row_fields") or info.get("col_fields")
        or any(
            shelf.get("field_count", 0) > 0
            for shelf in info.get("row_shelves", []) + info.get("col_shelves", [])
        )
    )
    if has_row_col_fields:
        return False
    # Check that at least one pane encoding has type "text"
    for pane in info.get("shelves", {}).get("marks", []):
        for enc in pane.get("encodings", []):
            if enc.get("type") == "text" and enc.get("column"):
                return True
    return False


def _is_chart_worksheet(info: dict[str, Any]) -> bool:
    primary_mark = info.get("primary_mark_type")
    if primary_mark in {"Text", "Icon"}:
        return False
    if _is_kpi_card(info):
        return False
    mark_types = set(info.get("mark_types") or [])
    if mark_types & _CHART_MARKS:
        return True
    measures = [column for column in info.get("columns", []) if column.get("role") == "measure"]
    # row_fields/col_fields can be empty for compound shelf expressions — also check parsed shelf field_count
    has_axes = bool(
        info.get("row_fields") or info.get("col_fields")
        or any(
            shelf.get("field_count", 0) > 0
            for shelf in info.get("row_shelves", []) + info.get("col_shelves", [])
        )
    )
    return bool(measures and has_axes)


def _worksheet_chart(
    info: dict[str, Any],
    width: float,
    height: float,
    hyper_ds: "_HyperDataSource | None" = None,
) -> BridgeChart:
    used_column_names = _column_names_from_refs(info.get("used_fields", []))
    dimensions = [
        column for column in info["columns"]
        if column.get("role") == "dimension" and _column_used(column, used_column_names)
    ]
    measures = [
        column for column in info["columns"]
        if column.get("role") == "measure" and _column_used(column, used_column_names)
    ]
    if not dimensions:
        dimensions = [column for column in info["columns"] if column.get("role") == "dimension"]
    if not measures:
        measures = [column for column in info["columns"] if column.get("role") == "measure"]
    mark_type = info.get("primary_mark_type") or _primary_mark_type(info.get("mark_types", []))

    # Attempt real data query from the Hyper extract; fall back to placeholder on failure
    real_data = None
    if hyper_ds is not None:
        try:
            real_data = _query_chart_data(hyper_ds, info)
        except Exception:
            real_data = None

    if real_data is not None:
        categories, series = real_data
    else:
        categories = _preview_categories(info, dimensions)
        series = _preview_series(info, measures, len(categories))

    resolved_chart_type = _bridge_chart_type_from_tableau_mark(mark_type, info)
    # Map/polygon worksheets with real LOD data render as a horizontal bar chart
    # (country names on Y-axis, values on X-axis) rather than a scatter placeholder.
    if real_data is not None and resolved_chart_type == "XY_SCATTER" and (mark_type or "").lower() in {"multipolygon", "polygon", "map"}:
        resolved_chart_type = "BAR_CLUSTERED"

    chart = BridgeChart(
        position=Position(left=0.5, top=1.1, width=width - 1.0, height=height - 1.6),
        chart_type=resolved_chart_type,
        title=ChartTitle(title=info.get("title") or info.get("name")),
        categories=ChartCategories(categories=categories, categories_raw=categories),
        series=series,
        data_source=ChartDataSource(
            source_kind="tableau",
            cache_series_count=len(series),
            cache_category_count=len(categories),
            cache_point_count=0,
            formulas=[column["formula"] for column in info["columns"] if column.get("formula")],
        ),
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "worksheet_chart",
            "tableau": info,
            "tableau_preview": {
                "mode": "structure_only",
                "uses_placeholder_values": True,
                "message": "Rendered from Tableau shelves/marks/fields with deterministic placeholder values; real extract values have not been queried.",
            },
        },
    )
    return chart


_AGG_LABELS: dict[str, str] = {
    "sum": "SUM", "avg": "AVG", "min": "MIN", "max": "MAX",
    "tmn": "MIN", "tmx": "MAX", "tdy": "DATE", "cnt": "COUNT",
    "ctd": "COUNTD", "med": "MED", "usr": "", "pcto": "%",
    "mdy": "DATE", "wk": "WEEK", "mnth": "MONTH", "yr": "YEAR",
}

_INTERNAL_SUFFIX_RE = re.compile(r"_\d{10,}$")
_COPY_SUFFIX_RE = re.compile(r"\s+\(copy(?:\s+\d+)?\)\s*$", re.IGNORECASE)
_TABLEAU_SHEETNAME_RE = re.compile(r"<Sheet\s*Name>", re.IGNORECASE)
_TABLE_CALC_PREFIX_RE = re.compile(r"^(?:pcdf|pcto|running|window|lookup|rank|percentile):", re.IGNORECASE)

# Role codes that indicate a measure (quantitative) on a Tableau shelf
_MEASURE_ROLE_CODES = frozenset({"qk"})
# Pure-measure aggregation codes (not date truncations like yr/mnth/wk)
_MEASURE_AGG_CODES = frozenset({"sum", "avg", "average", "min", "max", "cnt", "countd", "ctd", "med", "var", "stdev"})
# Tableau date-truncation aggregation prefixes — these produce continuous date axes but are dimensions, not measures
_DATE_TRUNC_AGGS = frozenset({"yr", "qr", "mnth", "wk", "tdy", "day", "hr", "mn", "sc"})


def _clean_field_name(name: str) -> str:
    """Strip Tableau internal suffixes and copy markers from a field name."""
    name = _INTERNAL_SUFFIX_RE.sub("", name).strip()
    name = _COPY_SUFFIX_RE.sub("", name).strip()
    return name


def _resolve_title_params(title: str, worksheet_name: str) -> str:
    """Replace Tableau built-in title parameters like <Sheet Name> with actual values."""
    return _TABLEAU_SHEETNAME_RE.sub(worksheet_name, title)


def _field_display_name(field_name: str, info: dict[str, Any]) -> str:
    """Return the best display name for a field: caption > cleaned name.

    Looks up the column caption from the worksheet columns list using both the raw
    internal name (e.g. Calculation_785596694854914057) and its cleaned form.
    """
    raw = field_name.strip("[]")
    cleaned = _clean_field_name(raw)
    columns_by_name: dict[str, dict[str, Any]] = {}
    for col in info.get("columns", []):
        col_raw = (col.get("name") or "").strip("[]")
        col_cleaned = _clean_field_name(col_raw)
        columns_by_name[col_raw] = col
        columns_by_name[col_cleaned] = col
    # Try raw match first (preserves specificity for copy-suffixed fields)
    col = columns_by_name.get(raw) or columns_by_name.get(cleaned)
    if col:
        caption = (col.get("caption") or "").strip()
        # Skip captions that are purely numeric — authors use "0" etc. to suppress labels
        if caption and not caption.lstrip("-").replace(".", "", 1).isdigit():
            # For formula captions like "[sales]^1.5", extract the inner field name
            if caption.startswith("["):
                import re as _re
                m = _re.match(r'^\[([^\]]+)\]', caption)
                if m:
                    return _clean_field_name(m.group(1))
            # Skip other formula-like captions (LOD expressions, etc.)
            if not any(op in caption for op in ("^", "{", "FIXED", "INCLUDE", "EXCLUDE")):
                return _clean_field_name(caption)
        return cleaned
    return cleaned


def _shelf_fields_by_role(shelf_list: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """Split shelf fields into (dimensions, measures) using role_code and aggregation heuristics."""
    dims: list[dict] = []
    measures: list[dict] = []
    for shelf in shelf_list:
        for field in shelf.get("fields", []):
            rc = field.get("role_code") or ""
            agg_raw = (field.get("aggregation") or "").lower()
            # Strip table-calc prefixes to get the inner aggregation
            # Use [0] not [-1]: pcto:sum:Field:ok:2 → sum:Field:ok:2 → "sum", not "2"
            agg = _TABLE_CALC_PREFIX_RE.sub("", agg_raw).split(":")[0]
            # Date-truncation aggs (tdy/wk/mnth/yr etc.) are continuous date axes — treat as dimensions
            is_date_trunc = agg in _DATE_TRUNC_AGGS
            if (rc in _MEASURE_ROLE_CODES and not is_date_trunc) or agg in _MEASURE_AGG_CODES:
                measures.append(field)
            else:
                dims.append(field)
    return dims, measures


def _worksheet_kpi_shape(info: dict[str, Any], width: float, height: float) -> BridgeShape:
    """Render a Tableau KPI number-card worksheet as a styled BridgeShape placeholder."""
    label = ""
    agg_inner = ""
    agg_label = ""
    for pane in info.get("shelves", {}).get("marks", []):
        for enc in pane.get("encodings", []):
            if enc.get("type") == "text" and enc.get("column"):
                fi = enc.get("field_info") or _field_ref_info(enc.get("column"))
                field_name = (fi.get("name") or "").strip("[]")
                # Resolve caption from datasource columns so "Calculation_XXXX" → "avg sales" etc.
                label = _field_display_name(field_name, info) if field_name else ""
                agg_raw = (fi.get("aggregation") or "").lower()
                # Strip table-calc prefixes (pcdf:sum → sum) then look up display label
                agg_inner = _TABLE_CALC_PREFIX_RE.sub("", agg_raw).split(":")[-1]
                agg_label = _AGG_LABELS.get(agg_inner, agg_inner.upper() if agg_inner else "")
                break
        if label:
            break
    if not label:
        label = info.get("name") or "KPI"
    # SUM and table-calc (usr) aggregations are implicit — don't add as a prefix
    _IMPLICIT_AGGS = {"sum", "usr", ""}
    # When label already contains the agg concept (e.g. "avg sales" → don't add "AVG"), skip prefix
    if agg_inner in _IMPLICIT_AGGS or (agg_label and agg_label.lower() in label.lower()):
        display = label
    else:
        display = f"{agg_label}({label})" if agg_label else label

    colors = info.get("resolved_colors") or _TABLEAU_DEFAULT_PALETTE
    accent = colors[0] if colors else "#4E79A7"

    return BridgeShape(
        position=Position(left=0.5, top=1.1, width=width - 1.0, height=height - 1.6),
        shape_identification=ShapeIdentification(shape_type="rect"),
        fill=ShapeFill(fill_type="solid", color=accent),
        line=ShapeLine(visible=False),
        text_content=ShapeTextContent(
            has_text=True,
            text_content=display,
            paragraphs=[
                TextParagraph(runs=[TextRun(text=display, font_bold=True, font_size=28.0, font_color="#FFFFFF")]),
                TextParagraph(runs=[TextRun(text="—", font_size=36.0, font_color="#FFFFFF")]),
            ],
        ),
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "kpi_card",
            "kpi_label": display,
            "kpi_accent": accent,
            "tableau": info,
        },
    )


def _worksheet_table(info: dict[str, Any], width: float, height: float) -> BridgeTable:
    # For Text/crosstab worksheets, show the actual metrics from column_instance_model
    col_model = info.get("column_instance_model") or {}
    instances_by_inst = col_model.get("by_instance") or {}
    if instances_by_inst:
        rows = [["Metric", "Type"]]
        for inst_name, ci in instances_by_inst.items():
            # source_field_info is from the column= attr (base field, no agg prefix)
            src_fi = ci.get("source_field_info") or {}
            field_name = (src_fi.get("name") or "").strip("[]")
            label = _field_display_name(field_name, info) if field_name else field_name
            # The instance name token has format "agg:field:role_code" — split to get agg
            raw_token = inst_name.strip("[]")
            parts = raw_token.split(":")
            agg_inner = parts[0].lower() if len(parts) > 1 else ""
            agg_label = _AGG_LABELS.get(agg_inner, agg_inner.upper() if agg_inner else "")
            metric = f"{agg_label}({label})" if agg_label and agg_label.lower() not in label.lower() else label
            role_code = parts[-1].lower() if len(parts) > 1 else ""
            role = "measure" if role_code == "qk" else "dimension"
            rows.append([metric, role])
    else:
        rows = [["Field", "Role", "Type", "Formula"]]
        for column in info.get("columns", []):
            rows.append(
                [
                    _display_name(column),
                    column.get("role") or "",
                    column.get("datatype") or column.get("type") or "",
                    column.get("formula") or "",
                ]
            )
        if len(rows) == 1:
            rows.extend([["Worksheet", "", "", info.get("name") or ""], ["Marks", "", "", ", ".join(info.get("mark_types") or [])]])

    return BridgeTable(
        position=Position(left=0.5, top=1.1, width=width - 1.0, height=height - 1.6),
        data=rows,
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "worksheet_table",
            "tableau": info,
        },
    )


def _dashboard_to_slide(
    dashboard: ET.Element,
    slide_number: int,
    package_bytes: dict[str, bytes],
) -> BridgeSlide:
    name = dashboard.attrib.get("name") or f"Dashboard {slide_number}"
    size = dashboard.find("./size")
    width_px = _int_attr(size, "maxwidth") or _int_attr(size, "minwidth") or 1600
    height_px = _int_attr(size, "maxheight") or _int_attr(size, "minheight") or 900
    width = width_px / _DASHBOARD_UNITS_PER_INCH
    height = height_px / _DASHBOARD_UNITS_PER_INCH
    dashboard_info = _dashboard_info(dashboard)

    slide = BridgeSlide(
        slide_number=slide_number,
        width=width,
        height=height,
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "dashboard",
            "tableau": dashboard_info,
        },
    )

    zones_parent = dashboard.find("./zones")
    if zones_parent is not None:
        for z_index, zone in enumerate(_children(zones_parent, "zone"), start=1):
            slide.elements.extend(_zone_to_elements(zone, width, height, package_bytes, z_index))

    if not slide.elements:
        slide.elements.append(_title_text(name, name, width))
    return slide


def _dashboard_info(dashboard: ET.Element) -> dict[str, Any]:
    size = dashboard.find("./size")
    return {
        "name": dashboard.attrib.get("name"),
        "size": dict(size.attrib) if size is not None else {},
        "repository_location": dict(dashboard.find("./repository-location").attrib)
        if dashboard.find("./repository-location") is not None
        else {},
        "datasources": [
            datasource.attrib.get("name")
            for datasource in dashboard.findall("./datasources/datasource")
            if datasource.attrib.get("name")
        ],
        "zones": [_zone_info(zone) for zone in dashboard.findall("./zones/zone")],
    }


def _zone_to_elements(
    zone: ET.Element,
    width: float,
    height: float,
    package_bytes: dict[str, bytes],
    z_index: int,
) -> list[Any]:
    elements: list[Any] = []
    zone_type = zone.attrib.get("type-v2") or zone.attrib.get("type")
    if zone_type == "bitmap":
        image = _zone_image(zone, width, height, package_bytes)
        if image is not None:
            image.stacking.z_index = z_index
            elements.append(image)
    elif zone_type == "text":
        text = _zone_text(zone, width, height)
        text.stacking.z_index = z_index
        elements.append(text)
    elif zone.attrib.get("name"):
        shape = _zone_sheet_placeholder(zone, width, height)
        shape.stacking.z_index = z_index
        elements.append(shape)

    for child in _children(zone, "zone"):
        elements.extend(_zone_to_elements(child, width, height, package_bytes, z_index + len(elements) + 1))
    return elements


def _zone_image(
    zone: ET.Element,
    width: float,
    height: float,
    package_bytes: dict[str, bytes],
) -> BridgeImage | None:
    image_path = (zone.attrib.get("param") or "").replace("\\", "/")
    image_bytes = package_bytes.get(image_path)
    if image_bytes is None:
        return None

    dimensions = ImageDimensions()
    try:
        from PIL import Image
        import io

        with Image.open(io.BytesIO(image_bytes)) as image:
            dimensions = ImageDimensions(width_px=image.width, height_px=image.height)
    except Exception:
        pass

    return BridgeImage(
        position=_zone_position(zone, width, height),
        image_data=ImageData(image_bytes=image_bytes, image_format=Path(image_path).suffix.lstrip(".").upper()),
        file_info=ImageFileInfo(original_filename=Path(image_path).name, original_path=image_path),
        dimensions=dimensions,
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "dashboard_bitmap",
            "tableau_zone": _zone_info(zone),
        },
    )


def _zone_text(zone: ET.Element, width: float, height: float) -> BridgeText:
    text = _formatted_text(zone.find("./formatted-text")) or ""
    return BridgeText(
        position=_zone_position(zone, width, height),
        paragraphs=[TextParagraph(runs=[TextRun(text=text)])],
        text_frame=TextFrame(word_wrap=True, autofit_type="shrink"),
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "dashboard_text",
            "tableau_zone": _zone_info(zone),
        },
    )


def _zone_sheet_placeholder(zone: ET.Element, width: float, height: float) -> BridgeShape:
    name = zone.attrib.get("name") or ""
    return BridgeShape(
        position=_zone_position(zone, width, height),
        shape_identification=ShapeIdentification(shape_type="tableau_zone", geometry_preset="rect"),
        fill=ShapeFill(fill_type="solid", transparency=1.0),
        line=ShapeLine(visible=True, width=0.5),
        text_content=ShapeTextContent(
            has_text=True,
            text_content=name,
            paragraphs=[TextParagraph(runs=[TextRun(text=name)])],
        ),
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "dashboard_worksheet_zone",
            "tableau_zone": _zone_info(zone),
        },
    )


def _title_text(title: str, name: str, width: float) -> BridgeText:
    return BridgeText(
        position=Position(left=0.35, top=0.25, width=max(1.0, width - 0.7), height=0.55),
        paragraphs=[TextParagraph(runs=[TextRun(text=title, font_size=18, font_bold=True)])],
        custom_properties={
            "source_format": "tableau",
            "tableau_kind": "title",
            "tableau_name": name,
        },
    )


def _zone_position(zone: ET.Element, width: float, height: float) -> Position:
    x = (_int_attr(zone, "x") or 0) / 100000.0
    y = (_int_attr(zone, "y") or 0) / 100000.0
    w = (_int_attr(zone, "w") or 100000) / 100000.0
    h = (_int_attr(zone, "h") or 100000) / 100000.0
    return Position(left=x * width, top=y * height, width=w * width, height=h * height)


def _column_info(column: ET.Element) -> dict[str, Any]:
    calculation = column.find("./calculation")
    formula = calculation.attrib.get("formula") if calculation is not None else None
    aliases = [
        {"key": alias.attrib.get("key"), "value": alias.attrib.get("value")}
        for alias in column.findall("./aliases/alias")
    ]
    return {
        "name": column.attrib.get("name"),
        "caption": column.attrib.get("caption"),
        "datatype": column.attrib.get("datatype"),
        "role": column.attrib.get("role"),
        "type": column.attrib.get("type"),
        "ordinal": _as_int(column.attrib.get("ordinal")),
        "value": column.attrib.get("value"),
        "formula": formula,
        "calculation_class": calculation.attrib.get("class") if calculation is not None else None,
        "has_table_calc": calculation.find(".//table-calc") is not None if calculation is not None else False,
        "aliases": aliases,
    }


def _relation_info(relation: ET.Element) -> dict[str, Any]:
    return {
        "name": relation.attrib.get("name"),
        "table": relation.attrib.get("table"),
        "type": relation.attrib.get("type"),
        "connection": relation.attrib.get("connection"),
        "columns": [_column_info(column) for column in relation.findall("./columns/column")],
    }


def _filter_info(filter_el: ET.Element) -> dict[str, Any]:
    return {
        "raw_properties": dict(filter_el.attrib),
        "class": filter_el.attrib.get("class"),
        "column": filter_el.attrib.get("column"),
        "field_info": _field_ref_info(filter_el.attrib.get("column")),
        "context": filter_el.attrib.get("context"),
        "included_values": filter_el.attrib.get("included-values"),
        "filter_group": filter_el.attrib.get("filter-group"),
        "groupfilters": [
            {
                "function": groupfilter.attrib.get("function"),
                "level": groupfilter.attrib.get("level"),
                "member": groupfilter.attrib.get("member"),
                "field_info": _field_ref_info(groupfilter.attrib.get("level")),
                "raw_properties": dict(groupfilter.attrib),
            }
            for groupfilter in filter_el.findall(".//groupfilter")
        ],
        "groupfilter_functions": [
            groupfilter.attrib.get("function")
            for groupfilter in filter_el.findall(".//groupfilter")
            if groupfilter.attrib.get("function")
        ],
    }


def _sort_info(sort_el: ET.Element) -> dict[str, Any]:
    return {
        "type": _tag(sort_el),
        "shelf": sort_el.attrib.get("shelf"),
        "direction": sort_el.attrib.get("direction"),
        "dimension_to_sort": sort_el.attrib.get("dimension-to-sort"),
        "measure_to_sort_by": sort_el.attrib.get("measure-to-sort-by"),
        "dimension_field": _field_ref_info(sort_el.attrib.get("dimension-to-sort")),
        "measure_field": _field_ref_info(sort_el.attrib.get("measure-to-sort-by")),
        "raw_properties": dict(sort_el.attrib),
    }


def _mark_info(mark: ET.Element) -> dict[str, Any]:
    info = {"class": mark.attrib.get("class") or "Automatic", "encodings": []}
    for child in list(mark):
        if _tag(child) in {"color", "size", "text", "lod", "shape", "tooltip", "path", "detail", "geometry"}:
            info["encodings"].append(
                {
                    "type": _tag(child),
                    "column": child.attrib.get("column"),
                    "field": child.attrib.get("field"),
                    "field_info": _field_ref_info(child.attrib.get("column") or child.attrib.get("field")),
                    "raw_properties": dict(child.attrib),
                }
            )
    return info


def _pane_info(pane: ET.Element) -> dict[str, Any]:
    mark = pane.find("./mark")
    encodings = []
    if mark is not None:
        encodings.extend(_mark_info(mark).get("encodings", []))
    for encoding in pane.findall("./encodings/*"):
        field_ref = encoding.attrib.get("column") or encoding.attrib.get("field")
        encodings.append({
            "type": _tag(encoding),
            "column": encoding.attrib.get("column"),
            "field": encoding.attrib.get("field"),
            "field_info": _field_ref_info(field_ref),
            "raw_properties": dict(encoding.attrib),
        })
    customized_label = _formatted_text(pane.find("./customized-label/formatted-text"))
    customized_tooltip = _formatted_text(pane.find("./customized-tooltip/formatted-text"))
    return {
        "pane_id": pane.attrib.get("id"),
        "class": mark.attrib.get("class") if mark is not None else "Automatic",
        "encodings": encodings,
        "style_formats": _style_formats(pane.find("./style")),
        "customized_label": customized_label,
        "customized_tooltip": customized_tooltip,
        "raw_properties": dict(pane.attrib),
    }


def _style_formats(style: ET.Element | None) -> list[dict[str, str | None]]:
    if style is None:
        return []
    formats = []
    for rule in style.findall(".//style-rule"):
        element = rule.attrib.get("element")
        for fmt in rule.findall("./format"):
            formats.append({
                "element": element,
                "attr": fmt.attrib.get("attr"),
                "field": fmt.attrib.get("field"),
                "field_info": _field_ref_info(fmt.attrib.get("field")),
                "scope": fmt.attrib.get("scope"),
                "value": fmt.attrib.get("value"),
                "class": fmt.attrib.get("class"),
                "id": fmt.attrib.get("id"),
                "raw_properties": dict(fmt.attrib),
            })
    return formats


def _style_model(
    worksheet_formats: list[dict[str, str | None]],
    panes: list[dict[str, Any]],
) -> dict[str, Any]:
    all_formats: list[dict[str, Any]] = list(worksheet_formats)
    for pane in panes:
        all_formats.extend(pane.get("style_formats", []))

    by_element: dict[str, list[dict[str, Any]]] = {}
    by_field: dict[str, dict[str, Any]] = {}
    bridge_hints: dict[str, Any] = {
        "font_family": None,
        "font_size": None,
        "text_color": None,
        "background_color": None,
        "gridline_visible": None,
        "row_divider_visible": None,
        "column_divider_visible": None,
        "hidden_axes": [],
    }
    for fmt in all_formats:
        element = str(fmt.get("element") or "unknown")
        attr = str(fmt.get("attr") or "")
        value = fmt.get("value")
        field = fmt.get("field")
        by_element.setdefault(element, []).append(fmt)
        if field:
            field_bucket = by_field.setdefault(str(field), {"field_info": fmt.get("field_info"), "formats": {}})
            field_bucket["formats"][attr] = value

        if attr == "font-family" and bridge_hints["font_family"] is None:
            bridge_hints["font_family"] = value
        elif attr == "font-size" and bridge_hints["font_size"] is None:
            bridge_hints["font_size"] = _as_float(value)
        elif attr == "color" and bridge_hints["text_color"] is None:
            bridge_hints["text_color"] = value
        elif attr == "background-color" and bridge_hints["background_color"] is None:
            bridge_hints["background_color"] = value
        elif attr == "line-visibility" and element == "gridline":
            bridge_hints["gridline_visible"] = value != "off"
        elif attr == "line-visibility" and element == "table-div" and fmt.get("scope") == "rows":
            bridge_hints["row_divider_visible"] = value != "off"
        elif attr == "line-visibility" and element == "table-div" and fmt.get("scope") == "cols":
            bridge_hints["column_divider_visible"] = value != "off"
        elif attr == "display" and value == "false" and field:
            bridge_hints["hidden_axes"].append(field)

    return {
        "by_element": by_element,
        "by_field": by_field,
        "bridge_hints": bridge_hints,
        "format_count": len(all_formats),
    }


def _style_summary(
    worksheet_formats: list[dict[str, str | None]],
    panes: list[dict[str, Any]],
) -> dict[str, Any]:
    all_formats = list(worksheet_formats)
    for pane in panes:
        all_formats.extend(pane.get("style_formats", []))
    by_attr: dict[str, list[dict[str, str | None]]] = {}
    for fmt in all_formats:
        attr = fmt.get("attr")
        if attr:
            by_attr.setdefault(attr, []).append(fmt)
    # Separate mark-specific colors from all colors
    # Tableau uses "mark-color" for the primary mark fill color and "color" on mark elements
    mark_elements = {"marks", "pane", "mark", "circle", "bar", "line", "area", "shape"}
    mark_colors_raw = [
        fmt.get("value")
        for fmt in all_formats
        if fmt.get("attr") in {"mark-color", "color"}
        and (fmt.get("element") or "").lower() in mark_elements
    ]
    _skip_colors = {"#FFFFFF", "#000000", "#FFFFFFFF", "#FF000000", "#00000000"}
    mark_hex_colors = [c for c in _resolve_all_colors(mark_colors_raw) if c and c.upper() not in _skip_colors]
    # Only mark-specific colors are usable as chart series colors.
    # Colors from 'cell', 'label', 'worksheet', 'axis', etc. are text/axis styling — excluded.
    usable_colors = mark_hex_colors
    return {
        "fonts": _unique_values(by_attr, "font-family"),
        "font_sizes": _unique_values(by_attr, "font-size"),
        "font_weights": _unique_values(by_attr, "font-weight"),
        "colors": usable_colors,
        "mark_colors": mark_hex_colors,
        "background_colors": [c for c in (_resolve_all_colors(_unique_values(by_attr, "background-color"))) if c],
        "number_formats": _unique_values(by_attr, "text-format"),
        "mark_sizes": _unique_values(by_attr, "size"),
        "hidden_axis_fields": [
            fmt.get("field")
            for fmt in by_attr.get("display", [])
            if fmt.get("value") == "false" and fmt.get("field")
        ],
        "dimensions": {
            "cell_widths": _unique_values(by_attr, "cell-w") + _field_values(by_attr, "width"),
            "cell_heights": _unique_values(by_attr, "cell-h") + _field_values(by_attr, "height"),
        },
        "format_count": len(all_formats),
    }


def _unique_values(by_attr: dict[str, list[dict[str, str | None]]], attr: str) -> list[str]:
    return _unique([
        str(fmt.get("value"))
        for fmt in by_attr.get(attr, [])
        if fmt.get("value") not in {None, ""}
    ])


def _field_values(by_attr: dict[str, list[dict[str, str | None]]], attr: str) -> list[str]:
    values = []
    for fmt in by_attr.get(attr, []):
        value = fmt.get("value")
        field = fmt.get("field")
        if value:
            values.append(f"{field}: {value}" if field else value)
    return _unique(values)


def _column_instance_model(column_instances: list[dict[str, Any]]) -> dict[str, Any]:
    by_column: dict[str, list[dict[str, Any]]] = {}
    by_instance: dict[str, dict[str, Any]] = {}
    for instance in column_instances:
        column = str(instance.get("column") or "")
        name = str(instance.get("name") or "")
        info = {
            "column": column,
            "name": name,
            "field_info": _field_ref_info(name),
            "source_field_info": _field_ref_info(column),
            "derivation": instance.get("derivation"),
            "pivot": instance.get("pivot"),
            "type": instance.get("type"),
            "datasource": instance.get("datasource"),
            "raw_properties": dict(instance),
        }
        if column:
            by_column.setdefault(column, []).append(info)
        if name:
            by_instance[name] = info
    return {
        "by_column": by_column,
        "by_instance": by_instance,
        "count": len(column_instances),
    }


def _worksheet_element_positions(info: dict[str, Any]) -> list[dict[str, Any]]:
    placements = info.get("layout", {}).get("dashboard_placements", []) or []
    visual_placements = [placement for placement in placements if not placement.get("zone_type")]
    base_placement = visual_placements[0] if visual_placements else placements[0] if placements else {}
    base_pixels = base_placement.get("pixels", {}) if isinstance(base_placement, dict) else {}
    canvas_w = float(base_pixels.get("w") or 1200)
    canvas_h = float(base_pixels.get("h") or 800)
    row_fields = [
        field
        for shelf in info.get("row_shelves", [])
        for field in shelf.get("fields", [])
    ]
    col_fields = [
        field
        for shelf in info.get("col_shelves", [])
        for field in shelf.get("fields", [])
    ]
    style_model = info.get("style_model", {})
    by_field = style_model.get("by_field", {})
    elements: list[dict[str, Any]] = []

    top_header_h = max(28.0, sum(_field_style_px(field, by_field, ["height", "height-header"], 30.0) for field in col_fields) or 40.0)
    left_header_w = max(0.0, sum(_field_style_px(field, by_field, ["width"], 96.0) for field in row_fields))
    left_header_w = min(left_header_w, canvas_w * 0.55)
    top_header_h = min(top_header_h, canvas_h * 0.45)

    x_cursor = 0.0
    for index, field in enumerate(row_fields, start=1):
        width_px = _field_style_px(field, by_field, ["width"], 96.0)
        elements.append(
            _layout_element(
                element_id=f"row-header-{index}",
                kind="row_header",
                field=field,
                x=x_cursor,
                y=top_header_h,
                w=width_px,
                h=max(1.0, canvas_h - top_header_h),
                canvas_w=canvas_w,
                canvas_h=canvas_h,
                order=index,
                style=_field_style(field, by_field),
            )
        )
        x_cursor += width_px

    y_cursor = 0.0
    for index, field in enumerate(col_fields, start=1):
        height_px = _field_style_px(field, by_field, ["height", "height-header"], 30.0)
        elements.append(
            _layout_element(
                element_id=f"column-header-{index}",
                kind="column_header",
                field=field,
                x=left_header_w,
                y=y_cursor,
                w=max(1.0, canvas_w - left_header_w),
                h=height_px,
                canvas_w=canvas_w,
                canvas_h=canvas_h,
                order=index,
                style=_field_style(field, by_field),
            )
        )
        y_cursor += height_px

    elements.append(
        _layout_element(
            element_id="marks-area",
            kind="marks_area",
            field=None,
            x=left_header_w,
            y=top_header_h,
            w=max(1.0, canvas_w - left_header_w),
            h=max(1.0, canvas_h - top_header_h),
            canvas_w=canvas_w,
            canvas_h=canvas_h,
            order=0,
            style=style_model.get("bridge_hints", {}),
        )
    )

    for index, filter_info in enumerate(info.get("filters", []), start=1):
        elements.append(
            {
                "id": f"filter-{index}",
                "kind": "filter",
                "bridge_target": "BridgeTableRegion",
                "position_confidence": "exact_if_dashboard_filter_zone_matches",
                "field": filter_info.get("field_info"),
                "source": "worksheet_filter",
                "dashboard_placements": [
                    placement for placement in placements
                    if placement.get("zone_type") == "filter"
                    and placement.get("raw_properties", {}).get("param") == filter_info.get("column")
                ],
                "raw_properties": filter_info.get("raw_properties", {}),
            }
        )

    for index, placement in enumerate(visual_placements, start=1):
        elements.append(
            {
                "id": f"dashboard-zone-{index}",
                "kind": "dashboard_zone",
                "bridge_target": "BridgeElement.position",
                "position_confidence": "exact_from_dashboard_zone",
                "source": "dashboard",
                "dashboard": placement.get("dashboard"),
                "normalized": placement.get("normalized"),
                "pixels": placement.get("pixels"),
                "raw_properties": placement.get("raw_properties", {}),
            }
        )
    return elements


def _layout_element(
    element_id: str,
    kind: str,
    field: dict[str, Any] | None,
    x: float,
    y: float,
    w: float,
    h: float,
    canvas_w: float,
    canvas_h: float,
    order: int,
    style: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": element_id,
        "kind": kind,
        "bridge_target": _bridge_target_for_layout_kind(kind),
        "position_confidence": "estimated_from_worksheet_shelves_and_formatting",
        "order": order,
        "field": field,
        "source": "worksheet_style_estimate",
        "pixels": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
        "normalized": {
            "x": round(x / canvas_w, 5) if canvas_w else 0,
            "y": round(y / canvas_h, 5) if canvas_h else 0,
            "w": round(w / canvas_w, 5) if canvas_w else 0,
            "h": round(h / canvas_h, 5) if canvas_h else 0,
        },
        "style": style,
    }


def _field_style_px(field: dict[str, Any], by_field: dict[str, Any], attrs: list[str], fallback: float) -> float:
    style = _field_style(field, by_field)
    for attr in attrs:
        value = style.get(attr)
        parsed = _as_float(value)
        if parsed is not None:
            return parsed
    return fallback


def _field_style(field: dict[str, Any] | None, by_field: dict[str, Any]) -> dict[str, Any]:
    if not field:
        return {}
    candidates = [
        field.get("raw"),
        field.get("name"),
        f"[{field.get('name')}]" if field.get("name") else None,
    ]
    for candidate in candidates:
        if candidate and str(candidate) in by_field:
            return dict(by_field[str(candidate)].get("formats", {}))
    return {}


def _shelf_info(axis: str, expression: str) -> dict[str, Any]:
    fields = _field_ref_infos(expression)
    return {
        "axis": axis,
        "expression": expression,
        "fields": fields,
        "field_count": len(fields),
        "has_tableau_expression": any(op in expression for op in ("(", ")", "/", "*", "+")),
    }


def _worksheet_pythonic_model(info: dict[str, Any]) -> dict[str, Any]:
    formulas = [_formula_model(column) for column in info.get("columns", []) if column.get("formula")]
    filters = [_filter_model(filter_info) for filter_info in info.get("filters", [])]
    sorts = [_sort_model(sort_info) for sort_info in info.get("sorts", [])]
    layout = _layout_model(info.get("layout", {}).get("element_positions", []))
    style = _style_python_model(info.get("style_model", {}))
    blockers = _unique([
        blocker
        for model in formulas + filters + sorts
        for blocker in model.get("blocked_by", [])
    ])
    return {
        "status": "requires_lowering" if blockers else "pythonic_ready",
        "target": "pandas_dataframe_to_bridge_elements",
        "formulas": formulas,
        "filters": filters,
        "sorts": sorts,
        "style": style,
        "layout": layout,
        "field_instances": info.get("column_instance_model", {}),
        "blocked_by": blockers,
        "execution_order": [
            "read packaged Hyper extract with tableauhyperapi",
            "rename/expose extract columns using Tableau column-instance mappings",
            "apply lowerable filters",
            "compute lowerable formulas",
            "apply shelf sorts",
            "aggregate rows/columns/marks into chart or table data",
            "apply style/layout model to BridgeChart or BridgeTable",
        ],
    }


def _formula_model(column: dict[str, Any]) -> dict[str, Any]:
    formula = str(column.get("formula") or "")
    functions = _unique([match.group(1).upper() for match in _TABLEAU_FUNCTION_RE.finditer(formula)])
    dependencies = _field_ref_infos(formula)
    features = {
        "has_lod": "{" in formula and "}" in formula,
        "has_if": bool(re.search(r"\bIF\b", formula, flags=re.IGNORECASE)),
        "has_table_calc": bool(column.get("has_table_calc")) or any(func in _TABLE_CALC_FUNCTIONS for func in functions),
        "has_date_math": any(func in {"DATEADD", "DATEDIFF", "DATEPART", "DATETRUNC", "DAY", "MONTH", "YEAR"} for func in functions),
        "has_string_ops": any(func in {"LEFT", "RIGHT", "LOWER", "UPPER", "STR", "LEN"} for func in functions),
        "has_aggregate": any(func in {"SUM", "AVG", "MIN", "MAX", "COUNT", "COUNTD"} for func in functions),
    }
    blocked_by = []
    if features["has_lod"]:
        blocked_by.append("tableau_lod_semantics")
    if features["has_table_calc"]:
        blocked_by.append("tableau_table_calc_semantics")
    unsupported = [func for func in functions if func not in _LOWERABLE_TABLEAU_FUNCTIONS]
    if unsupported:
        blocked_by.append("unsupported_tableau_functions")

    return {
        "field": column.get("name"),
        "caption": column.get("caption"),
        "datatype": column.get("datatype"),
        "role": column.get("role"),
        "source_formula": formula,
        "kind": _formula_kind(formula, features),
        "functions": functions,
        "dependencies": dependencies,
        "features": features,
        "status": "requires_tableau_semantics" if blocked_by else "lowerable_sketch",
        "blocked_by": blocked_by,
        "unsupported_functions": unsupported,
        "pandas_sketch": _tableau_formula_to_pandas_sketch(formula),
        "sql_sketch": _tableau_formula_to_sql_sketch(formula),
    }


_LOWERABLE_TABLEAU_FUNCTIONS = {
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COUNT",
    "COUNTD",
    "IF",
    "IIF",
    "THEN",
    "ELSE",
    "END",
    "DATEADD",
    "DATEDIFF",
    "DAY",
    "MONTH",
    "YEAR",
    "LEFT",
    "RIGHT",
    "LOWER",
    "UPPER",
    "STR",
    "LEN",
}

_TABLE_CALC_FUNCTIONS = {
    "INDEX",
    "LAST",
    "FIRST",
    "LOOKUP",
    "RUNNING_SUM",
    "WINDOW_SUM",
    "WINDOW_AVG",
    "WINDOW_MIN",
    "WINDOW_MAX",
}


def _formula_kind(formula: str, features: dict[str, Any]) -> str:
    if features.get("has_lod"):
        return "lod_expression"
    if features.get("has_table_calc"):
        return "table_calculation"
    if features.get("has_if"):
        return "conditional"
    if features.get("has_aggregate"):
        return "aggregate"
    refs = _field_ref_infos(formula)
    if len(refs) == 1 and formula.strip() == refs[0].get("raw"):
        return "direct_field_alias"
    return "scalar_expression"


def _tableau_formula_to_pandas_sketch(formula: str) -> str | None:
    if not formula:
        return None
    sketch = formula
    sketch = re.sub(r"\[([^\]]+)\]\.\[([^\]]+)\]", lambda m: f"df[{m.group(2)!r}]", sketch)
    sketch = re.sub(r"\[([^\]]+)\]", lambda m: f"df[{m.group(1)!r}]", sketch)
    replacements = {
        "COUNTD": "nunique",
        "COUNT": "count",
        "SUM": "sum",
        "AVG": "mean",
        "MIN": "min",
        "MAX": "max",
        "STR": "astype(str)",
        "LOWER": "str.lower",
        "UPPER": "str.upper",
        "LEN": "str.len",
    }
    for source, target in replacements.items():
        sketch = re.sub(rf"\b{source}\s*\(", f"{target}(", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bAND\b", "&", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bOR\b", "|", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bIF\b", "np.where(", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bTHEN\b", ",", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bELSE\b", ",", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bEND\b", ")", sketch, flags=re.IGNORECASE)
    return sketch


def _tableau_formula_to_sql_sketch(formula: str) -> str | None:
    if not formula:
        return None
    sketch = formula
    sketch = re.sub(r"\[([^\]]+)\]\.\[([^\]]+)\]", lambda m: _quote_hyper_identifier(m.group(2)), sketch)
    sketch = re.sub(r"\[([^\]]+)\]", lambda m: _quote_hyper_identifier(m.group(1)), sketch)
    sketch = re.sub(r"\bCOUNTD\s*\(", "COUNT(DISTINCT ", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bAVG\s*\(", "AVG(", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bIF\b", "CASE WHEN", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bTHEN\b", "THEN", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bELSE\b", "ELSE", sketch, flags=re.IGNORECASE)
    sketch = re.sub(r"\bEND\b", "END", sketch, flags=re.IGNORECASE)
    return sketch


def _filter_model(filter_info: dict[str, Any]) -> dict[str, Any]:
    field = filter_info.get("field_info", {})
    groupfilters = filter_info.get("groupfilters", []) or []
    pandas_predicates = []
    sql_predicates = []
    blockers = []
    if filter_info.get("included_values") == "non-null":
        column = _python_field_ref(field)
        pandas_predicates.append(f"{column}.notna()")
        sql_predicates.append(f"{_quote_hyper_identifier(field.get('name') or filter_info.get('column'))} IS NOT NULL")
    for groupfilter in groupfilters:
        function = groupfilter.get("function")
        member = groupfilter.get("member")
        if function == "member" and member:
            column = _python_field_ref(groupfilter.get("field_info") or field)
            pandas_predicates.append(f"{column} == {member!r}")
            sql_predicates.append(f"{_quote_hyper_identifier((groupfilter.get('field_info') or field).get('name') or filter_info.get('column'))} = {member!r}")
        else:
            blockers.append("unsupported_groupfilter_function")
    return {
        "field": field,
        "class": filter_info.get("class"),
        "context": filter_info.get("context"),
        "status": "lowerable_sketch" if not blockers else "requires_tableau_semantics",
        "groupfilters": groupfilters,
        "pandas_predicate_sketch": " & ".join(pandas_predicates) if pandas_predicates else None,
        "sql_predicate_sketch": " AND ".join(sql_predicates) if sql_predicates else None,
        "blocked_by": blockers,
    }


def _sort_model(sort_info: dict[str, Any]) -> dict[str, Any]:
    direction = str(sort_info.get("direction") or "ASC").upper()
    ascending = direction != "DESC"
    dimension = sort_info.get("dimension_field", {})
    measure = sort_info.get("measure_field", {})
    by = measure if measure.get("name") else dimension
    return {
        "shelf": sort_info.get("shelf"),
        "direction": direction,
        "dimension": dimension,
        "measure": measure,
        "status": "lowerable_sketch",
        "pandas_sketch": f"df.sort_values({_python_field_name(by)!r}, ascending={ascending})" if by else None,
        "sql_sketch": (
            f"ORDER BY {_quote_hyper_identifier(_python_field_name(by))} {direction}"
            if by and _python_field_name(by)
            else None
        ),
        "blocked_by": [],
    }


def _style_python_model(style_model: dict[str, Any]) -> dict[str, Any]:
    hints = style_model.get("bridge_hints", {}) if isinstance(style_model, dict) else {}
    return {
        "status": "bridge_style_hints",
        "bridge_properties": {
            "font_family": hints.get("font_family"),
            "font_size": hints.get("font_size"),
            "font_color": hints.get("text_color"),
            "background_color": hints.get("background_color"),
            "show_gridlines": hints.get("gridline_visible"),
            "show_row_dividers": hints.get("row_divider_visible"),
            "show_column_dividers": hints.get("column_divider_visible"),
            "hidden_axes": hints.get("hidden_axes", []),
        },
        "field_style_count": len(style_model.get("by_field", {}) if isinstance(style_model, dict) else {}),
    }


def _layout_model(elements: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "status": "estimated_from_tableau_layout_and_formatting",
        "coordinate_space": "worksheet_or_dashboard_pixels_plus_normalized",
        "elements": elements,
        "element_count": len(elements),
        "bridge_mapping": [
            {
                "source_id": element.get("id"),
                "kind": element.get("kind"),
                "bridge_target": _bridge_target_for_layout_kind(str(element.get("kind") or "")),
                "position": element.get("pixels"),
                "normalized": element.get("normalized"),
            }
            for element in elements
        ],
    }


def _bridge_target_for_layout_kind(kind: str) -> str:
    if kind in {"row_header", "column_header", "filter"}:
        return "BridgeTableRegion"
    if kind == "marks_area":
        return "BridgeChart.plot_area"
    if kind == "dashboard_zone":
        return "BridgeElement.position"
    return "BridgeElement"


def _python_field_ref(field: dict[str, Any]) -> str:
    return f"df[{_python_field_name(field)!r}]"


def _python_field_name(field: dict[str, Any]) -> str:
    return str(field.get("name") or field.get("raw") or "")


def _worksheet_visual_items(info: dict[str, Any]) -> list[dict[str, Any]]:
    marks = info.get("shelves", {}).get("marks", []) or [{"class": info.get("primary_mark_type") or "Automatic"}]
    rows = info.get("row_shelves") or [_shelf_info("rows", value) for value in info.get("rows", []) if value]
    cols = info.get("col_shelves") or [_shelf_info("cols", value) for value in info.get("cols", []) if value]
    columns_by_name = _columns_by_name(info.get("columns", []))
    filters = info.get("filters", [])
    style_formats = info.get("style_formats", [])
    items = []
    for index, mark in enumerate(marks, start=1):
        mark_type = mark.get("class") or info.get("primary_mark_type") or "Automatic"
        encodings = mark.get("encodings", [])
        field_refs = []
        for shelf in rows + cols:
            field_refs.extend(field.get("raw") for field in shelf.get("fields", []))
        field_refs.extend(encoding.get("column") or encoding.get("field") for encoding in encodings)
        field_refs.extend(filter_info.get("column") for filter_info in filters)
        dependencies = _field_dependencies(field_refs, columns_by_name)
        visual_kind = _visual_kind_for_mark(mark_type, dependencies)
        limitations = _visual_item_limitations(visual_kind, dependencies, filters, info)
        query_plan = _target_query_plan(dependencies, rows, cols, encodings, filters, info)
        has_axis_or_text = bool(rows or cols or encodings)
        can_recreate_structure = bool(mark_type and has_axis_or_text and dependencies)
        items.append(
            {
                "id": f"worksheet-{index}" if not mark.get("pane_id") else f"pane-{mark.get('pane_id')}",
                "name": f"{info.get('name') or 'Worksheet'} / {mark_type}",
                "kind": visual_kind,
                "bridge_target": "BridgeTable" if visual_kind == "table" else "BridgeChart",
                "mark_type": mark_type,
                "pane_id": mark.get("pane_id"),
                "can_recreate_structure": can_recreate_structure,
                "can_recreate_values": False,
                "role_mappings": {
                    "rows": rows,
                    "cols": cols,
                    "marks": _encoding_roles(encodings),
                    "filters": filters,
                    "sorts": info.get("sorts", []),
                },
                "field_dependencies": dependencies,
                "style": {
                    "summary": info.get("style_summary", {}),
                    "model": info.get("style_model", {}),
                    "worksheet_formats": style_formats,
                    "pane_formats": mark.get("style_formats", []),
                    "label": mark.get("customized_label"),
                    "tooltip": mark.get("customized_tooltip"),
                },
                "data_requirements": {
                    "datasources": info.get("datasources", []),
                    "requires_extract_query": True,
                    "requires_formula_evaluation": any(dep.get("formula") for dep in dependencies),
                    "requires_table_calculation_engine": any(dep.get("has_table_calc") for dep in dependencies),
                    "requires_filter_evaluation": bool(filters),
                },
                "layout": info.get("layout", {}),
                "pythonic_model": info.get("pythonic_model", {}),
                "query_plan": query_plan,
                "render_plan": {
                    "recipe_status": "visual_recipe_found" if can_recreate_structure else "visual_recipe_incomplete",
                    "value_status": "not_executed",
                    "preview_mode": "structure_only_placeholder_values",
                    "query_fields": dependencies,
                    "python_execution": query_plan.get("python_execution", {}),
                    "python_bridge_model": info.get("pythonic_model", {}),
                    "shelf_expressions": {
                        "rows": [row.get("expression") for row in rows],
                        "cols": [col.get("expression") for col in cols],
                    },
                    "explanation": (
                        "Percy can render a structural preview from Tableau shelves, marks, and field definitions. "
                        "Real values require querying the packaged datasource and evaluating Tableau calculations/filters."
                    ),
                },
                "limitations": limitations,
            }
        )
    return items


def _worksheet_reconstruction(info: dict[str, Any]) -> dict[str, Any]:
    mark_type = info.get("primary_mark_type") or "Automatic"
    kind = _worksheet_visual_kind(info)
    columns = info.get("columns", [])
    calculations = [column for column in columns if column.get("formula")]
    table_calcs = [column for column in columns if column.get("has_table_calc")]
    encodings = [
        encoding
        for pane in info.get("shelves", {}).get("marks", [])
        for encoding in pane.get("encodings", [])
    ]
    datasource_schemas = info.get("datasource_schemas", [])
    packaged_extract = any(
        connection.get("class") in {"hyper", "dataengine"}
        for ds in datasource_schemas
        for connection in ds.get("connections", [])
    )
    has_shelves = bool(info.get("row_fields") or info.get("col_fields") or encodings)
    has_field_defs = bool(columns)
    has_datasource = bool(info.get("datasources"))
    limitations = []
    if calculations:
        limitations.append("calculated_fields_require_formula_evaluation")
    if table_calcs:
        limitations.append("table_calculations_require_tableau_compute_semantics")
    if info.get("filters"):
        limitations.append("filters_require_query_or_groupfilter_evaluation")
    if kind == "map":
        limitations.append("map_layers_require_geocoding_or_generated_lat_long_support")
    if not packaged_extract:
        limitations.append("no_packaged_extract_detected_for_values")

    can_recreate_structure = bool(mark_type and has_shelves and has_field_defs and has_datasource)
    can_recreate_values = False
    confidence = "high" if can_recreate_structure and not limitations else "medium" if can_recreate_structure else "low"
    return {
        "visual_kind": kind,
        "bridge_target": "BridgeTable" if kind == "table" else "BridgeChart",
        "can_recreate_structure": can_recreate_structure,
        "can_recreate_values": can_recreate_values,
        "confidence": confidence,
        "items": info.get("visual_items", []),
        "available": {
            "mark_type": bool(mark_type),
            "shelves": has_shelves,
            "pane_encodings": bool(encodings),
            "field_definitions": has_field_defs,
            "datasource_bindings": has_datasource,
            "calculations": bool(calculations),
            "filters": bool(info.get("filters")),
            "sorts": bool(info.get("sorts")),
            "style_formats": bool(info.get("style_formats") or any(pane.get("style_formats") for pane in info.get("shelves", {}).get("marks", []))),
            "element_positions": bool(info.get("layout", {}).get("element_positions")),
            "packaged_extract": packaged_extract,
        },
        "counts": {
            "dimensions": len([column for column in columns if column.get("role") == "dimension"]),
            "measures": len([column for column in columns if column.get("role") == "measure"]),
            "calculations": len(calculations),
            "table_calculations": len(table_calcs),
            "filters": len(info.get("filters", [])),
            "sorts": len(info.get("sorts", [])),
            "encodings": len(encodings),
            "visual_items": len(info.get("visual_items", [])),
            "style_formats": len(info.get("style_formats", [])),
            "element_positions": len(info.get("layout", {}).get("element_positions", [])),
        },
        "limitations": limitations,
        "next_step": "query_extract_and_evaluate_tableau_formulas" if can_recreate_structure else "inspect_raw_worksheet_xml",
    }


def _worksheet_visual_kind(info: dict[str, Any]) -> str:
    mark = info.get("primary_mark_type")
    fields = " ".join(info.get("used_fields", []) + info.get("row_fields", []) + info.get("col_fields", []))
    if mark in {"Text", "Icon"}:
        return "table"
    if mark in {"Map", "Multipolygon"} or "Latitude (generated)" in fields or "Longitude (generated)" in fields:
        return "map"
    return "chart"


def _visual_kind_for_mark(mark_type: str, dependencies: list[dict[str, Any]]) -> str:
    names = " ".join(str(dep.get("name") or "") for dep in dependencies)
    if mark_type in {"Text", "Icon"}:
        return "table"
    if mark_type in {"Map", "Multipolygon"} or "Latitude (generated)" in names or "Longitude (generated)" in names:
        return "map"
    return "chart"


def _visual_item_limitations(
    visual_kind: str,
    dependencies: list[dict[str, Any]],
    filters: list[dict[str, Any]],
    info: dict[str, Any],
) -> list[str]:
    limitations = []
    if any(dep.get("formula") for dep in dependencies):
        limitations.append("needs_tableau_formula_evaluator")
    if any(dep.get("has_table_calc") for dep in dependencies):
        limitations.append("needs_tableau_table_calc_engine")
    if filters:
        limitations.append("needs_filter_and_groupfilter_evaluation")
    if visual_kind == "map":
        limitations.append("needs_tableau_map_geometry_or_geocoding")
    datasource_schemas = info.get("datasource_schemas", [])
    has_extract = any(
        connection.get("class") in {"hyper", "dataengine"}
        for datasource in datasource_schemas
        for connection in datasource.get("connections", [])
    )
    if not has_extract:
        limitations.append("needs_datasource_query_backend")
    return limitations


def _target_query_plan(
    dependencies: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    cols: list[dict[str, Any]],
    encodings: list[dict[str, Any]],
    filters: list[dict[str, Any]],
    info: dict[str, Any],
) -> dict[str, Any]:
    extracts = [extract for extract in info.get("packaged_extracts", []) if extract.get("status") == "ok"]
    candidate_tables = _candidate_extract_tables(extracts, dependencies)
    group_refs = _field_names_from_shelves(rows) + _field_names_from_shelves(cols)
    group_refs += [
        encoding.get("field_info", {}).get("name")
        for encoding in encodings
        if encoding.get("type") in {"color", "shape", "detail", "lod", "path"}
    ]
    group_names = _unique([str(name) for name in group_refs if name])

    measure_deps = [dep for dep in dependencies if _is_measure_dependency(dep)]
    dimension_deps = [dep for dep in dependencies if dep.get("name") in group_names or dep.get("role") == "dimension"]
    direct_columns = _direct_column_matches(dependencies, candidate_tables)
    unresolved = [
        dep
        for dep in dependencies
        if dep.get("name") and dep.get("name") not in {match.get("field") for match in direct_columns}
    ]
    formula_deps = [dep for dep in dependencies if dep.get("formula")]
    plan_status = "queryable_direct_extract"
    if not candidate_tables:
        plan_status = "no_queryable_extract"
    elif formula_deps or filters:
        plan_status = "needs_formula_or_filter_lowering"
    elif unresolved:
        plan_status = "needs_field_mapping"

    sql_sketch = _sql_sketch(candidate_tables, group_names, measure_deps, direct_columns)
    return {
        "status": plan_status,
        "pythonic_source": "tableauhyperapi",
        "candidate_tables": candidate_tables,
        "group_by": [_python_field(dep) for dep in dimension_deps if dep.get("name") in group_names],
        "measures": [_python_measure(dep) for dep in measure_deps],
        "filters": filters,
        "direct_column_matches": direct_columns,
        "formula_dependencies": [_python_field(dep) for dep in formula_deps],
        "unresolved_fields": [_python_field(dep) for dep in unresolved],
        "sql_sketch": sql_sketch,
        "python_code_sketch": _python_code_sketch(candidate_tables, sql_sketch),
        "python_execution": {
            "reader": "tableauhyperapi.Connection",
            "steps": [
                "extract .hyper from .twbx package to temp file",
                "open with HyperProcess + Connection",
                "run generated SQL for direct aggregate fields",
                "evaluate or lower Tableau formulas/filters before final values",
                "write result rows into BridgeChart/BridgeTable",
            ],
            "blocked_by": _query_blockers(plan_status, formula_deps, filters, unresolved),
        },
    }


def _candidate_extract_tables(
    extracts: list[dict[str, Any]],
    dependencies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    dep_names = {str(dep.get("name")) for dep in dependencies if dep.get("name")}
    candidates = []
    for extract in extracts:
        for table in extract.get("tables", []):
            columns = table.get("columns", [])
            column_names = {str(column.get("name")) for column in columns}
            matches = sorted(dep_names & column_names)
            candidates.append(
                {
                    "extract_path": extract.get("path"),
                    "format": extract.get("format"),
                    "schema": table.get("schema"),
                    "table": table.get("name"),
                    "row_count": table.get("row_count"),
                    "columns": columns,
                    "matching_fields": matches,
                    "match_count": len(matches),
                    "python_table_ref": _hyper_table_ref(table),
                }
            )
    return sorted(candidates, key=lambda table: table.get("match_count", 0), reverse=True)


def _field_names_from_shelves(shelves: list[dict[str, Any]]) -> list[str]:
    return [
        str(field.get("name"))
        for shelf in shelves
        for field in shelf.get("fields", [])
        if field.get("name")
    ]


def _direct_column_matches(
    dependencies: list[dict[str, Any]],
    candidate_tables: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not candidate_tables:
        return []
    table = candidate_tables[0]
    column_names = {str(column.get("name")) for column in table.get("columns", [])}
    matches = []
    for dep in dependencies:
        name = dep.get("name")
        if name in column_names:
            matches.append(
                {
                    "field": name,
                    "table": table.get("table"),
                    "column": name,
                    "aggregation": _aggregation_for(dep),
                    "role": dep.get("role"),
                }
            )
    return matches


def _is_measure_dependency(dep: dict[str, Any]) -> bool:
    aggregation = str(dep.get("aggregation") or "").lower()
    return dep.get("role") == "measure" or aggregation not in {"", "none", "tmn", "tdy"}


def _aggregation_for(dep: dict[str, Any]) -> str:
    aggregation = str(dep.get("aggregation") or "").lower()
    if aggregation in {"sum", "avg", "average", "min", "max", "count", "cnt", "countd"}:
        return "avg" if aggregation == "average" else "count" if aggregation == "cnt" else aggregation
    if dep.get("role") == "measure":
        return "sum"
    return "group"


def _python_field(dep: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": dep.get("name"),
        "caption": dep.get("caption"),
        "role": dep.get("role"),
        "datatype": dep.get("datatype"),
        "formula": dep.get("formula"),
        "source_ref": dep.get("raw"),
    }


def _python_measure(dep: dict[str, Any]) -> dict[str, Any]:
    return {
        **_python_field(dep),
        "aggregation": _aggregation_for(dep),
        "requires_formula": bool(dep.get("formula")),
        "requires_table_calc": bool(dep.get("has_table_calc")),
    }


def _sql_sketch(
    candidate_tables: list[dict[str, Any]],
    group_names: list[str],
    measure_deps: list[dict[str, Any]],
    direct_columns: list[dict[str, Any]],
) -> str | None:
    if not candidate_tables:
        return None
    table = candidate_tables[0]
    column_names = {match.get("field") for match in direct_columns}
    groups = [name for name in group_names if name in column_names][:6]
    measures = [dep for dep in measure_deps if dep.get("name") in column_names][:6]
    if not groups and not measures:
        return f"SELECT * FROM {_hyper_table_ref(table)} LIMIT 100"
    select_parts = [_quote_hyper_identifier(name) for name in groups]
    for dep in measures:
        name = dep.get("name")
        aggregation = _aggregation_for(dep).upper()
        if aggregation == "COUNTD":
            select_parts.append(f"COUNT(DISTINCT {_quote_hyper_identifier(name)}) AS {_quote_hyper_identifier(name)}")
        elif aggregation in {"SUM", "AVG", "MIN", "MAX", "COUNT"}:
            select_parts.append(f"{aggregation}({_quote_hyper_identifier(name)}) AS {_quote_hyper_identifier(name)}")
    group_clause = f" GROUP BY {', '.join(_quote_hyper_identifier(name) for name in groups)}" if groups else ""
    return f"SELECT {', '.join(select_parts)} FROM {_hyper_table_ref(table)}{group_clause} LIMIT 500"


def _hyper_table_ref(table: dict[str, Any]) -> str:
    schema = table.get("schema")
    name = table.get("table") or table.get("name")
    if schema and name:
        return f"{_quote_hyper_identifier(schema)}.{_quote_hyper_identifier(name)}"
    if name and "." in str(name):
        return ".".join(_quote_hyper_identifier(part) for part in str(name).split("."))
    return _quote_hyper_identifier(name or "Extract")


def _quote_hyper_identifier(value: Any) -> str:
    return f'"{str(value).replace(chr(34), chr(34) + chr(34))}"'


def _python_code_sketch(candidate_tables: list[dict[str, Any]], sql_sketch: str | None) -> str | None:
    if not candidate_tables or not sql_sketch:
        return None
    extract_path = str(candidate_tables[0].get("extract_path") or "<extracted-hyper-path>")
    return "\n".join(
        [
            "from tableauhyperapi import Connection, HyperProcess, Telemetry",
            "",
            f"hyper_path = r{extract_path!r}",
            f"sql = {sql_sketch!r}",
            "",
            "with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as hyper:",
            "    with Connection(endpoint=hyper.endpoint, database=hyper_path) as connection:",
            "        rows = list(connection.execute_list_query(sql))",
            "",
            "# TODO: lower Tableau formulas/filters before treating rows as final values.",
            "# rows can feed BridgeChart/BridgeTable data series once mappings are resolved.",
        ]
    )


def _query_blockers(
    plan_status: str,
    formula_deps: list[dict[str, Any]],
    filters: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
) -> list[str]:
    blockers = []
    if plan_status == "no_queryable_extract":
        blockers.append("no_queryable_hyper_extract")
    if formula_deps:
        blockers.append("tableau_formula_lowering")
    if filters:
        blockers.append("tableau_filter_lowering")
    if unresolved:
        blockers.append("field_to_extract_column_mapping")
    return blockers


_DATE_PREFIXES = {"tdy:", "wk:", "mnth:", "qr:", "yr:", "hr:", "day:", "mdy:", "dquarter:"}


def _shelf_has_date(info: dict[str, Any]) -> bool:
    """Return True when rows/cols shelves contain a Tableau date truncation field."""
    for ref in (info.get("rows") or []) + (info.get("cols") or []):
        text = (ref or "").lower()
        if any(text.lstrip("[( ").startswith(p) for p in _DATE_PREFIXES):
            return True
        # also catch date inside a nested expression like ([federated...].[tdy:...])
        if any(f".[{p}" in text or f":tdy:" in text for p in _DATE_PREFIXES):
            return True
    return False


def _bridge_chart_type_from_tableau_mark(mark_type: str | None, info: dict[str, Any] | None = None) -> str:
    mark = (mark_type or "").lower()
    if mark in {"multipolygon", "polygon", "map"}:
        return "XY_SCATTER"  # render map worksheets as scatter/bubble placeholder
    if mark in {"line"}:
        return "LINE"
    if mark in {"area"}:
        return "AREA"
    if mark == "pie":
        return "PIE"
    is_date_axis = _shelf_has_date(info) if info else False
    if mark in {"circle", "shape"} and is_date_axis:
        return "LINE"  # circle marks on a date axis = time-series dot/line chart
    if mark in {"circle", "square", "shape"} and info:
        row_dims, _ = _shelf_fields_by_role(info.get("row_shelves", []))
        col_dims, _ = _shelf_fields_by_role(info.get("col_shelves", []))
        if row_dims or col_dims:
            return "BAR_CLUSTERED"  # dot plot on categorical axis → render as bar for preview readability
        return "XY_SCATTER"
    if mark in {"circle", "square", "shape"}:
        return "XY_SCATTER"
    if mark in {"bar"} and info:
        col_dims, _ = _shelf_fields_by_role(info.get("col_shelves", []))
        _, row_measures = _shelf_fields_by_role(info.get("row_shelves", []))
        col_has_date = any((f.get("aggregation") or "").lower() in _DATE_TRUNC_AGGS for f in col_dims)
        if col_has_date:
            # Measures on rows + date dim on cols = vertical column/bar chart (not a line)
            if row_measures:
                return "COLUMN_CLUSTERED"
            # Pure date-on-col with no row measures = time-series bar → render as line for readability
    if mark in {"automatic", ""} and is_date_axis:
        return "LINE"  # automatic mark on date axis = line chart
    return "BAR_CLUSTERED"


_GENERIC_FIELD_NAMES = frozenset({"calculation", "measure names", "measure values", ""})
_STOPWORDS = frozenset({"top", "the", "and", "for", "all", "daily", "weekly", "monthly", "by", "of", "in", "a", "an"})


def _dim_label(raw_name: str, info: dict[str, Any], fallback: str = "Item") -> str:
    """Return a clean dim label; substitute a title-derived noun when the name is generic."""
    name = _clean_field_name(raw_name).strip("[]")
    if name.lower() in _GENERIC_FIELD_NAMES:
        title = _clean_field_name(info.get("title") or info.get("name") or "")
        words = [w for w in title.replace("-", " ").split() if w.lower() not in _STOPWORDS and len(w) > 2]
        if words:
            candidate = words[-1].rstrip("s").capitalize()
            if candidate.lower() not in _GENERIC_FIELD_NAMES:
                return candidate
        return fallback
    return name


def _preview_categories(info: dict[str, Any], dimensions: list[dict[str, Any]]) -> list[str]:
    """Generate placeholder category labels for the structural preview.

    Uses row/col shelf structure to determine which dimension forms the category axis,
    then generates labeled placeholder items (e.g. "Country A", "Country B") that convey
    the dimension type without exposing raw datasource column names.
    """
    row_dims, _ = _shelf_fields_by_role(info.get("row_shelves", []))
    _, col_measures = _shelf_fields_by_role(info.get("col_shelves", []))
    col_dims, _ = _shelf_fields_by_role(info.get("col_shelves", []))

    # Row shelf dimensions form the categorical axis for horizontal bar charts
    if row_dims:
        dim_name = _dim_label(row_dims[0].get("name") or "", info, fallback="Item")
        return [f"{dim_name} {s}" for s in ("A", "B", "C", "D", "E", "F")]

    # Col shelf dimensions form the categorical axis for vertical/line charts
    if col_dims:
        dim_name = _dim_label(col_dims[0].get("name") or "", info, fallback="Point")
        return [f"{dim_name} {i}" for i in range(1, 7)]

    # Fall back to used dimension display names when no shelf structure is clear
    names = [_display_name(col) for col in dimensions[:6] if _display_name(col)]
    return names if names else ["A", "B", "C", "D", "E", "F"]


def _preview_series(info: dict[str, Any], measures: list[dict[str, Any]], category_count: int) -> list[ChartSeries]:
    """Generate placeholder series for the structural preview.

    Priority:
    1. Measures from the col shelf (most common: dimension on rows, measure on cols)
    2. Measures from the row shelf (e.g. dual-axis line charts)
    3. Mark encodings (color/size/text encoding fields)
    4. All used measure columns (fallback)
    """
    _, col_measures = _shelf_fields_by_role(info.get("col_shelves", []))
    _, row_measures = _shelf_fields_by_role(info.get("row_shelves", []))

    # For map worksheets, lat/lon shelf measures are spatial coords, not data series —
    # skip them and use color/size encoding names instead.
    _LAT_LON_NAMES = frozenset({"latitude (generated)", "longitude (generated)", "latitude", "longitude"})
    is_map = (info.get("primary_mark_type") or "").lower() in {"multipolygon", "polygon", "map"}
    if is_map:
        col_measures = [f for f in col_measures if (f.get("name") or "").lower().strip("[]") not in _LAT_LON_NAMES]
        row_measures = [f for f in row_measures if (f.get("name") or "").lower().strip("[]") not in _LAT_LON_NAMES]

    # Resolve shelf measure names using caption lookup for specificity
    shelf_measure_names = []
    for f in (col_measures or row_measures):
        raw_name = f.get("name") or ""
        if not raw_name:
            continue
        display = _field_display_name(raw_name, info)
        # Fall back to title-derived label for truly generic names
        if not display or display.lower() in _GENERIC_FIELD_NAMES:
            display = _dim_label(raw_name, info, fallback="Value")
        shelf_measure_names.append(display)

    if shelf_measure_names:
        names = _unique(shelf_measure_names)[:6]
    else:
        # Try mark encodings that carry value information
        encoding_names = [
            _field_display_name(str(enc.get("field_info", {}).get("name") or ""), info)
            for mark in info.get("shelves", {}).get("marks", [])
            for enc in mark.get("encodings", [])
            if enc.get("type") in {"color", "size", "text"} and enc.get("field_info", {}).get("name")
        ]
        encoding_names = [n for n in encoding_names if n and n.lower() not in _GENERIC_FIELD_NAMES]
        if encoding_names:
            names = _unique(encoding_names)[:6]
        else:
            # Fall back to used measure display names
            names = [_display_name(col) for col in measures if _display_name(col)]
            names = names[:6] if names else [info.get("primary_mark_type") or "Value"]

    point_count = max(category_count, 1)

    # Extract per-pane mark colors from marks style_formats — one color per mark pane in order
    # Skip near-white colors (background/base map layers like #ebedf1) using luminance threshold
    def _is_too_light(hex_color: str) -> bool:
        h = hex_color.lstrip("#")
        if len(h) != 6:
            return False
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (r * 299 + g * 587 + b * 114) / 1000 > 220  # YIQ luminance > 220 → near-white

    pane_colors: list[str] = []
    _skip_colors = {"#ffffff", "#000000"}
    for mark in info.get("shelves", {}).get("marks", []):
        for fmt in mark.get("style_formats", []):
            if fmt.get("attr") == "mark-color":
                c = (fmt.get("value") or "").strip()
                if c and c.lower() not in _skip_colors and not _is_too_light(c):
                    pane_colors.append(c)
                    break

    # Fall back to resolved_colors then Tableau default palette
    colors = pane_colors if pane_colors else list(info.get("resolved_colors") or [])
    if len(colors) < 2:
        extras = [c for c in _TABLEAU_DEFAULT_PALETTE if c not in colors]
        colors = colors + extras
    if not colors:
        colors = list(_TABLEAU_DEFAULT_PALETTE)

    import math
    series = []
    for series_index, name in enumerate(_unique(names)[:6], start=1):
        base = series_index * 3.0
        values = [
            max(0.2, base + point_index * 0.7 + math.sin(point_index * 1.1 + series_index * 2.3) * base * 0.35)
            for point_index in range(1, point_count + 1)
        ]
        color = colors[(series_index - 1) % len(colors)]
        series.append(ChartSeries(name=name, values=values, color=color))
    return series


def _encoding_roles(encodings: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    roles: dict[str, list[dict[str, Any]]] = {}
    for encoding in encodings:
        role = str(encoding.get("type") or "encoding")
        roles.setdefault(role, []).append(
            {
                "column": encoding.get("column"),
                "field": encoding.get("field"),
                "field_info": encoding.get("field_info") or _field_ref_info(encoding.get("column") or encoding.get("field")),
                "raw_properties": encoding.get("raw_properties", {}),
            }
        )
    return roles


def _field_dependencies(refs: list[str | None], columns_by_name: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    dependencies = []
    seen = set()
    for ref in refs:
        for field in _field_ref_infos(ref or ""):
            key = field.get("key") or field.get("raw")
            if not key or key in seen:
                continue
            seen.add(key)
            column = columns_by_name.get(str(field.get("name") or ""))
            dependencies.append(
                {
                    **field,
                    "caption": column.get("caption") if column else None,
                    "datatype": column.get("datatype") if column else None,
                    "role": column.get("role") if column else None,
                    "type": column.get("type") if column else None,
                    "formula": column.get("formula") if column else None,
                    "calculation_class": column.get("calculation_class") if column else None,
                    "has_table_calc": column.get("has_table_calc") if column else False,
                }
            )
    return dependencies


def _columns_by_name(columns: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup = {}
    for column in columns:
        for name in (column.get("name"), column.get("caption")):
            if not name:
                continue
            clean = str(name).strip("[]")
            lookup[clean] = column
    return lookup


def _field_ref_infos(expression: str) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for match in _FIELD_REF_RE.finditer(expression or ""):
        raw = match.group(0)
        info = _field_ref_info(raw)
        key = info.get("key") or raw
        if key in seen:
            continue
        seen.add(key)
        result.append(info)
    return result


def _field_ref_info(ref: str | None) -> dict[str, Any]:
    if not ref:
        return {}
    match = _FIELD_REF_RE.search(ref)
    if not match:
        return {"raw": ref, "key": ref, "name": ref.strip("[]")}
    datasource, token = match.groups()
    if token is None:
        return {"raw": ref, "key": datasource, "datasource": None, "name": datasource}
    parts = token.split(":")
    role_index = _role_code_index(parts)
    if role_index is None:
        aggregation = parts[0] if len(parts) > 1 else None
        name = parts[-1] if len(parts) > 1 else token
        role_code = None
        extra = []
    else:
        aggregation = ":".join(parts[: max(role_index - 1, 0)]) or None
        name = parts[role_index - 1] if role_index > 0 else token
        role_code = parts[role_index]
        extra = parts[role_index + 1 :]
    return {
        "raw": ref,
        "key": f"{datasource}.{name}",
        "datasource": datasource,
        "token": token,
        "aggregation": aggregation,
        "name": name,
        "role_code": role_code,
        "extra": extra,
    }


def _column_names_from_refs(refs: list[str]) -> set[str]:
    return {
        str(field.get("name"))
        for ref in refs
        for field in _field_ref_infos(ref)
        if field.get("name")
    }


def _role_code_index(parts: list[str]) -> int | None:
    role_codes = {"nk", "qk", "ok", "uk"}
    for index in range(len(parts) - 1, -1, -1):
        if parts[index] in role_codes:
            return index
    return None


def _column_used(column: dict[str, Any], used_names: set[str]) -> bool:
    raw = (column.get("name") or "").strip("[]")
    caption = column.get("caption")
    return raw in used_names or bool(caption and caption in used_names)


def _zone_info(zone: ET.Element) -> dict[str, Any]:
    return {
        "id": zone.attrib.get("id"),
        "type": zone.attrib.get("type-v2") or zone.attrib.get("type"),
        "name": zone.attrib.get("name"),
        "param": zone.attrib.get("param"),
        "x": _as_int(zone.attrib.get("x")),
        "y": _as_int(zone.attrib.get("y")),
        "w": _as_int(zone.attrib.get("w")),
        "h": _as_int(zone.attrib.get("h")),
        "children": [_zone_info(child) for child in _children(zone, "zone")],
    }


def _field_refs(element: ET.Element) -> list[str]:
    refs: list[str] = []
    for node in element.iter():
        for attr_name in ("column", "field", "level", "name", "param"):
            value = node.attrib.get(attr_name)
            if value and "[" in value and "]" in value:
                refs.append(value)
        if _tag(node) in {"column", "field"} and node.text:
            refs.append(node.text.strip())
    return refs


def _primary_mark_type(mark_types: list[str]) -> str:
    for mark in mark_types:
        if mark in _CHART_MARKS:
            return mark
    return mark_types[0] if mark_types else "Automatic"


def _unique(values: list[str]) -> list[str]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _display_name(column: dict[str, Any]) -> str:
    name = column.get("caption") or column.get("name") or ""
    return _clean_field_name(name.strip("[]"))


def _formatted_text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    parts = []
    for run in element.findall(".//run"):
        if run.text:
            parts.append(run.text)
        # Handle <formatted-attr type='sheetname'/> which Tableau uses as a parameter reference
        for attr_el in run.findall("formatted-attr"):
            if attr_el.attrib.get("type") == "sheetname":
                parts.append("<Sheet Name>")  # resolved by _resolve_title_params later
    return "".join(parts).replace("\r\n", "\n").strip()


def _direct_children(root: ET.Element, parent_tag: str, child_tag: str) -> list[ET.Element]:
    parent = root.find(parent_tag)
    if parent is None:
        return []
    return _children(parent, child_tag)


def _children(element: ET.Element, tag: str) -> list[ET.Element]:
    return [child for child in list(element) if _tag(child) == tag]


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _child_text(element: ET.Element, tag: str) -> str | None:
    child = element.find(tag)
    return child.text if child is not None else None


def _text_or_xml(element: ET.Element) -> str:
    text = "".join(element.itertext()).strip()
    if text:
        return text
    return ET.tostring(element, encoding="unicode")


def _int_attr(element: ET.Element | None, name: str) -> int | None:
    if element is None:
        return None
    return _as_int(element.attrib.get(name))


def _as_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _count_elements(document: PercyDocument) -> dict[str, int]:
    counts: dict[str, int] = {}
    for slide in document.slides:
        for element in slide.elements:
            counts[element.element_type] = counts.get(element.element_type, 0) + 1
    return counts
