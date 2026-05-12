"""Generate a typed Python builder module from a Template Set.

Output structure (one file per Template Set):

    # acme_brand.py — auto-generated 2026-05-11
    \"\"\"Module docstring with brand name + ref summary\"\"\"

    from __future__ import annotations
    import pandas as pd
    from percy.studio_client import Studio   # the agent-facing HTTP wrapper

    # Brand constants
    ACME_PALETTE = {...}
    ACME_FONTS = {...}

    # One function per accepted slide/element template
    def title_slide(...) -> int: ...
    def kpi_doughnut(label, data: pd.DataFrame, *, ...) -> str: ...
    def comparison_table(df: pd.DataFrame, *, ...) -> str: ...
    ...

Charts use ``pandas.DataFrame`` as the entry point — the agent already
produces DataFrames natively and Python users in notebooks expect them.

What's deterministic vs LLM-polished
--------------------------------------
Deterministic (no LLM):
  * Function name (slugified from template name)
  * Argument list (from inputs_schema)
  * Argument types (heuristic: data→DataFrame, headers→str, etc.)
  * Function body (positions, fonts, colors all come from the layout +
    style profile)
  * Brand constants

LLM-polished (optional, runs once per template at accept-time):
  * Module + function docstrings ("When to use" / "Avoid for" sections)
  * Argument descriptions
  * Inline examples

If no LLM is configured, codegen still produces a complete, working module —
just with shorter docstrings.
"""

from __future__ import annotations

import json
import logging
import re
import textwrap
import time
from dataclasses import dataclass
from typing import Any, Callable

from .style_profiles import (
    ChartStyle, FontSpec, StyleProfile, TableStyle, profile_from_json,
)

log = logging.getLogger(__name__)


# ── Naming / identifier helpers ──────────────────────────────────────────────


_PY_KW = {
    "False", "None", "True", "and", "as", "assert", "async", "await",
    "break", "class", "continue", "def", "del", "elif", "else", "except",
    "finally", "for", "from", "global", "if", "import", "in", "is",
    "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
    "while", "with", "yield",
}


def _snake(s: str) -> str:
    """Anything → snake_case identifier."""
    s = re.sub(r"[^A-Za-z0-9_]+", "_", (s or "").strip())
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", s)
    s = re.sub(r"_+", "_", s).strip("_").lower()
    if not s or s[0].isdigit():
        s = f"t_{s}"
    if s in _PY_KW:
        s = f"{s}_"
    return s


def _const_name(set_name: str, suffix: str) -> str:
    base = _snake(set_name).upper()
    return f"{base}_{suffix}"


# ── Argument typing heuristic ───────────────────────────────────────────────


@dataclass(slots=True)
class ArgSpec:
    name: str
    py_type: str           # 'str' | 'pd.DataFrame' | 'float' | 'int' | 'bool' | 'list[str]'
    required: bool
    default_literal: str   # Python source literal: '""', '0.0', 'None'
    description: str = ""


def _arg_type_for(input_name: str, schema_entry: dict | None) -> str:
    """Decide the Python type annotation for an input.

    Priority:
      1. Explicit schema_entry['type'] of 'dataframe' / 'data' → pd.DataFrame
      2. Name contains 'data' / 'df' / 'rows' / 'series' → pd.DataFrame
      3. Name contains 'count' / 'index' / 'n_' → int
      4. Name ends with '_value' / starts with 'value' / contains 'metric' / 'amount' → float
      5. Name ends with '_on' / '_enabled' / starts with 'is_' / 'has_' → bool
      6. Name contains 'items' / 'tags' / 'list' / 'options' → list[str]
      7. Default → str
    """
    declared = (schema_entry or {}).get("type")
    if isinstance(declared, str):
        d = declared.lower()
        if d in ("dataframe", "data", "df"):
            return "pd.DataFrame"
        if d in ("number", "float"):
            return "float"
        if d in ("int", "integer", "count"):
            return "int"
        if d in ("bool", "boolean"):
            return "bool"
        if d in ("list", "array", "list[str]"):
            return "list[str]"
    n = (input_name or "").lower()
    if any(t in n for t in ("dataframe", "_df", "data_", "rows", "series_data")):
        return "pd.DataFrame"
    if n == "data" or n == "df":
        return "pd.DataFrame"
    if any(t in n for t in ("count", "_index", "n_", "num_")):
        return "int"
    if any(t in n for t in ("value", "metric", "amount", "price", "total")):
        return "float"
    if n.startswith(("is_", "has_")) or n.endswith(("_on", "_enabled")):
        return "bool"
    if any(t in n for t in ("items", "tags", "_list", "options", "categories", "labels")):
        return "list[str]"
    return "str"


def _default_for(py_type: str, schema_entry: dict | None) -> str:
    """Python literal for the argument default."""
    raw_default = (schema_entry or {}).get("default")
    if raw_default is not None and raw_default != "":
        # Quote strings.
        if py_type == "str":
            return repr(str(raw_default))
        if py_type in ("int", "float"):
            try:
                return repr(float(raw_default) if py_type == "float" else int(raw_default))
            except Exception:
                pass
        if py_type == "bool":
            return repr(bool(raw_default))
    return {
        "str": "''",
        "pd.DataFrame": "None",
        "int": "0",
        "float": "0.0",
        "bool": "False",
        "list[str]": "None",
    }.get(py_type, "None")


def _make_arg_specs(inputs_schema: dict[str, dict]) -> list[ArgSpec]:
    """Stable argument order: required inputs first, then optional."""
    specs: list[ArgSpec] = []
    for name, entry in (inputs_schema or {}).items():
        if not isinstance(entry, dict):
            entry = {}
        py_type = _arg_type_for(name, entry)
        required = bool(entry.get("required", False))
        # If we typed it as DataFrame, never make it have an empty-string default.
        default = _default_for(py_type, entry) if not required else "..."
        specs.append(ArgSpec(
            name=_snake(name),
            py_type=py_type,
            required=required,
            default_literal=default,
            description=str(entry.get("description") or ""),
        ))
    # Required ones first.
    specs.sort(key=lambda s: (not s.required, s.name))
    return specs


# ── Module construction ─────────────────────────────────────────────────────


def _palette_dict_literal(palette: list[dict] | None,
                            palette_ordered: list[str] | None) -> str:
    """Render the brand palette as a Python dict literal.

    Prefers the curated `palette` (with role + name) when present;
    otherwise falls back to position-named entries from `palette_ordered`.
    """
    if palette:
        lines = []
        for c in palette:
            key = _snake(str(c.get("name") or c.get("role") or "color"))
            hex_val = c.get("hex") or "#000000"
            lines.append(f'    "{key}": "{hex_val}",')
        return "{\n" + "\n".join(lines) + "\n}"
    if palette_ordered:
        lines = []
        roles = ["primary", "accent_1", "accent_2", "accent_3",
                 "neutral_1", "neutral_2", "neutral_3", "neutral_4"]
        for i, hex_val in enumerate(palette_ordered[:8]):
            role = roles[i] if i < len(roles) else f"swatch_{i}"
            lines.append(f'    "{role}": "{hex_val}",')
        return "{\n" + "\n".join(lines) + "\n}"
    return '{"primary": "#000000"}'


def _fonts_dict_literal(fonts: list[dict] | None, primary_font: str) -> str:
    if fonts:
        out = ["{"]
        for f in fonts:
            role = _snake(str(f.get("role") or "body"))
            name = f.get("name") or primary_font
            out.append(f'    "{role}": "{name}",')
        out.append("}")
        return "\n".join(out)
    return f'{{\n    "heading": "{primary_font}",\n    "body": "{primary_font}",\n}}'


def _format_docstring(name: str, description: str, args: list[ArgSpec],
                       when_to_use: str = "", when_to_avoid: str = "",
                       example: str = "") -> str:
    """Build a function docstring with structured When-to-use / Args / Returns."""
    parts = [description.strip() or f"{name} — auto-generated builder."]
    if when_to_use:
        parts.append("")
        parts.append("When to use:")
        for line in textwrap.wrap(when_to_use.strip(), width=70):
            parts.append(f"    {line}")
    if when_to_avoid:
        parts.append("")
        parts.append("Avoid for:")
        for line in textwrap.wrap(when_to_avoid.strip(), width=70):
            parts.append(f"    {line}")
    if args:
        parts.append("")
        parts.append("Args:")
        for a in args:
            desc = a.description.strip() or f"({a.py_type})"
            parts.append(f"    {a.name}: {desc}")
        parts.append("    studio: Active percy.studio_client.Studio session.")
        parts.append("    doc_id: Target deck id.")
    parts.append("")
    parts.append("Returns:")
    parts.append("    int (slide template) or str (element id) — see the layout.")
    if example:
        parts.append("")
        parts.append("Example:")
        for line in example.strip().splitlines():
            parts.append(f"    {line}")
    return "\n".join(parts)


def _render_function_signature(fn_name: str, args: list[ArgSpec], *,
                                  kind: str = "slide") -> str:
    """Build the `def fn(...) -> X:` line.

    Required positional args first, then `*`, then keyword-only:
      - `studio: Studio` (always — doc-bound session)
      - `slide_n: int` (element templates only — target slide)
      - optional inputs with defaults

    Slide templates return `int` (the new slide number). Element templates
    return `str` (the new element id).
    """
    required = [a for a in args if a.required]
    optional = [a for a in args if not a.required]
    parts: list[str] = []
    for a in required:
        parts.append(f"{a.name}: {a.py_type}")
    parts.append("*")
    parts.append("studio: Studio")
    if kind == "element":
        parts.append("slide_n: int")
    for a in optional:
        parts.append(f"{a.name}: {a.py_type} = {a.default_literal}")
    inner = ",\n    ".join(parts)
    return_type = "int" if kind == "slide" else "str"
    return f"def {fn_name}(\n    {inner},\n) -> {return_type}"


def _render_function_body(layout: list[dict], args: list[ArgSpec],
                            palette_const: str, fonts_const: str,
                            chart_styles: dict[str, ChartStyle],
                            *, kind: str = "slide") -> list[str]:
    """Construct the call sequence that creates the slide / element.

    Each layout entry is `{kind, alias, body}`. Kind ∈ shape | text | chart |
    table | connector | live-group. We emit one `studio.create_*` call per
    entry. Text replacement uses the parameterized inputs if `body.text`
    matches a `{{var}}` template; chart inputs map a `pd.DataFrame` arg if
    present.

    Slide templates (`kind="slide"`) prepend `slide_n = studio.add_slide()`
    and return the new slide index. Element templates (`kind="element"`)
    expect the caller to pass `slide_n` and return the new element's id.
    """
    arg_names = {a.name for a in args}
    lines: list[str] = []
    is_slide_kind = (kind == "slide")
    if is_slide_kind:
        lines.append("slide_n = studio.add_slide()")
    target_slide = "slide_n"

    last_alias: str = "el"
    for entry in layout:
        ekind = entry.get("kind") or "shape"
        body = dict(entry.get("body") or {})
        alias = _snake(str(entry.get("alias") or ekind))
        last_alias = alias

        # ── Substitute {{var}} placeholders in body.text with the actual arg ──
        if "text" in body and isinstance(body["text"], str):
            txt = body["text"]
            for var_match in re.findall(r"\{\{(\w+)\}\}", txt):
                snake_var = _snake(var_match)
                if snake_var in arg_names:
                    txt = txt.replace(f"{{{{{var_match}}}}}", f"{{{snake_var}}}")
            body["text"] = txt

        # Inject brand fonts where unset.
        if ekind == "text" and "font_name" not in body:
            body["font_name"] = "__FONT_HEADING__" if (body.get("font_size") or 0) >= 28 else "__FONT_BODY__"

        body_lit = _body_literal(body, palette_const, fonts_const)

        if ekind == "shape":
            lines.append(f"{alias}_id = studio.create_shape({target_slide}, {body_lit})")
        elif ekind == "text":
            lines.append(f"{alias}_id = studio.create_text({target_slide}, {body_lit})")
        elif ekind == "chart":
            df_args = [a for a in args if a.py_type == "pd.DataFrame"]
            if df_args:
                df_arg = df_args[0].name
                ct = (body.get("chart_type") or "").upper()
                style = chart_styles.get(ct)
                color_seq_expr = "None"
                if style and style.color_sequence:
                    seq_lit = ", ".join(repr(c) for c in style.color_sequence[:8])
                    color_seq_expr = f"[{seq_lit}]"
                lines.append(f"# Chart inputs from DataFrame '{df_arg}'.")
                lines.append(f"_categories = {df_arg}.iloc[:, 0].astype(str).tolist()")
                lines.append(f"_values     = {df_arg}.iloc[:, 1].astype(float).tolist()")
                body["categories"] = "__CATEGORIES__"
                body["series"] = "__SERIES__"
                body_lit = _body_literal(body, palette_const, fonts_const)
                body_lit = body_lit.replace("'__CATEGORIES__'", "_categories")
                body_lit = body_lit.replace(
                    "'__SERIES__'",
                    f"[{{'name': '{df_arg}', 'values': _values, 'point_colors': {color_seq_expr}}}]",
                )
                lines.append(f"{alias}_id = studio.create_chart({target_slide}, {body_lit})")
            else:
                lines.append(f"{alias}_id = studio.create_chart({target_slide}, {body_lit})")
        elif ekind == "table":
            df_args = [a for a in args if a.py_type == "pd.DataFrame"]
            if df_args:
                df_arg = df_args[0].name
                lines.append(f"# Table from DataFrame '{df_arg}': header row + body rows.")
                lines.append(f"_headers = [{df_arg}.index.name or ''] + list({df_arg}.columns)")
                lines.append(
                    f"_rows    = [[str(_idx), *(str(_v) for _v in _row)] "
                    f"for _idx, _row in {df_arg}.iterrows()]"
                )
                body["data"] = "__ROWS__"
                body_lit = _body_literal(body, palette_const, fonts_const)
                body_lit = body_lit.replace("'__ROWS__'", "[_headers, *_rows]")
                lines.append(f"{alias}_id = studio.create_table({target_slide}, {body_lit})")
            else:
                lines.append(f"{alias}_id = studio.create_table({target_slide}, {body_lit})")
        elif ekind == "connector":
            lines.append(f"{alias}_id = studio.create_connector({target_slide}, {body_lit})")
        elif ekind == "image-typed":
            lines.append(f"{alias}_id = studio.create_image({target_slide}, {body_lit})")
        elif ekind == "live-group":
            lines.append(f"{alias}_id = studio.create_live_group({target_slide}, {body_lit})")
        else:
            lines.append(f"# Unknown kind {ekind!r} — skipping")

    if is_slide_kind:
        lines.append("return slide_n")
    else:
        lines.append(f"return {last_alias}_id")
    return lines


def _body_literal(body: dict, palette_const: str, fonts_const: str) -> str:
    """Render a dict body as Python source for inclusion inside a function
    body. Returns a string at column 0 — the caller adds outer indent.

    Uses ``indent=4`` so nested dict content reads naturally once shifted
    one level by the function-body indenter.
    """
    src = json.dumps(body, indent=4, ensure_ascii=False)
    src = src.replace('"__FONT_HEADING__"', f'{fonts_const}["heading"]')
    src = src.replace('"__FONT_BODY__"', f'{fonts_const}["body"]')
    def _fstring_repl(m: re.Match) -> str:
        raw = m.group(1)
        if "{" in raw and "}" in raw:
            return f'f"{raw}"'
        return f'"{raw}"'
    src = re.sub(r'"((?:[^"\\]|\\.)*)"', _fstring_repl, src, count=0)
    # JSON booleans/null → Python equivalents. Match on word boundaries so we
    # don't accidentally hit substrings of strings (the string-literal pass
    # above already wrapped strings in quotes/f-strings so we're operating
    # only on bare JSON tokens here).
    src = re.sub(r"\btrue\b", "True", src)
    src = re.sub(r"\bfalse\b", "False", src)
    src = re.sub(r"\bnull\b", "None", src)
    return src


# ── Public entry point ──────────────────────────────────────────────────────


@dataclass(slots=True)
class GeneratedFunction:
    """One emitted function — used by callers that want to inspect each function
    before stitching them into a module (e.g. a per-template preview)."""
    name: str
    kind: str                # 'slide' | 'element'
    signature: str
    body: str
    docstring: str
    source: str              # full `def ...: """..."""\n    ...` block

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name, "kind": self.kind, "signature": self.signature,
            "body": self.body, "docstring": self.docstring, "source": self.source,
        }


def generate_function(
    *, template: dict[str, Any], kind: str,
    palette_const: str, fonts_const: str,
    chart_styles: dict[str, ChartStyle],
    polish: dict[str, str] | None = None,
) -> GeneratedFunction:
    """Render one accepted template into a typed Python builder function.

    `template` is the agent.templates.Template dict shape (id, name,
    description, layout, inputs_schema, ...).

    `polish` is an optional LLM-supplied {when_to_use, when_to_avoid, example}
    bundle — purely cosmetic (improves docstrings).
    """
    name = _snake(template["name"])
    args = _make_arg_specs(template.get("inputs_schema") or {})
    sig = _render_function_signature(name, args, kind=kind)
    body_lines = _render_function_body(
        template.get("layout") or [], args,
        palette_const=palette_const, fonts_const=fonts_const,
        chart_styles=chart_styles, kind=kind,
    )
    doc = _format_docstring(
        name=name,
        description=str(template.get("description") or ""),
        args=args,
        when_to_use=(polish or {}).get("when_to_use") or "",
        when_to_avoid=(polish or {}).get("when_to_avoid") or "",
        example=(polish or {}).get("example") or "",
    )

    # Source rendering owns ALL function-body indentation. Body lines (which
    # may include json.dumps multi-line dict literals) come in at column 0;
    # we prepend 4 spaces to every non-empty line.
    def _ind(s: str) -> str:
        return "\n".join(("    " + line) if line else "" for line in s.splitlines())

    indented_doc = _ind(doc)
    indented_body = "\n".join(_ind(b) for b in body_lines)
    source = f'{sig}:\n    """\n{indented_doc}\n    """\n{indented_body}'
    return GeneratedFunction(
        name=name, kind=kind, signature=sig,
        body="\n".join(body_lines), docstring=doc, source=source,
    )


def generate_module(
    *,
    set_name: str,
    description: str,
    palette: list[dict] | None,
    fonts: list[dict] | None,
    style_profile: StyleProfile,
    items: list[dict[str, Any]],
    polish_by_template_id: dict[str, dict[str, str]] | None = None,
) -> str:
    """Stitch every accepted template in a set into one Python module.

    Returns the full module source ready to be written to disk or shown in
    the UI's Python tab.
    """
    palette_const = _const_name(set_name, "PALETTE")
    fonts_const = _const_name(set_name, "FONTS")
    palette_lit = _palette_dict_literal(palette, style_profile.palette_ordered)
    fonts_lit = _fonts_dict_literal(fonts, style_profile.primary_font)

    chart_styles_by_type = {cs.chart_type: cs for cs in style_profile.chart_styles}
    polish_map = polish_by_template_id or {}

    # Built directly (no textwrap.dedent) because palette_lit and fonts_lit are
    # multi-line dict literals starting at column 0, which breaks dedent's
    # common-prefix detection.
    doc_plural = "" if style_profile.sample_doc_count == 1 else "s"
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    header_lines = [
        f'"""{set_name} — auto-generated slide builders ({len(items)} functions).',
        "",
        f"Generated {timestamp} from the {set_name!r} Template Set.",
        'Do not hand-edit — regenerate via the Template Set editor\'s "Python" tab',
        "or via POST /api/template-sets/{set_id}/python-module.",
        "",
        description.strip() or "",
        "",
        "Usage:",
        "",
        "    from percy.studio_client import Studio",
        "    import pandas as pd",
        "",
        '    studio = Studio(base_url="http://localhost:8000", doc_id="abc12345")',
        '    slide_n = title_slide("Q4 Update", studio=studio)',
        '    el_id   = kpi_doughnut("Customer mix", df,',
        "                            studio=studio, slide_n=slide_n)",
        "",
        f"Brand inventory mined from {style_profile.sample_doc_count} reference doc{doc_plural},",
        f"{style_profile.sample_element_count:,} elements analyzed.",
        '"""',
        "from __future__ import annotations",
        "",
        "import pandas as pd",
        "",
        "from percy.studio_client import Studio",
        "",
        "",
        "# ── Brand constants ─────────────────────────────────────────────────────",
        f"{palette_const} = {palette_lit}",
        "",
        f"{fonts_const} = {fonts_lit}",
        "",
        "# Primary font (most-used across the corpus)",
        f"PRIMARY_FONT = {style_profile.primary_font!r}",
    ]
    header = "\n".join(header_lines)

    function_blocks: list[str] = []
    chart_style_meta_lines: list[str] = []
    if style_profile.chart_styles:
        chart_style_meta_lines.append("# Chart style profile (one entry per observed chart type)")
        chart_style_meta_lines.append("# Read with: from percy.agent.style_profiles import StyleProfile")
        chart_style_meta_lines.append("# Hand-coded for programmatic access; matches /style-profile JSON.")
        chart_style_meta_lines.append("CHART_STYLE_PROFILE = " + repr(style_profile.to_dict()))

    for it in items:
        tpl = it.get("template") or {}
        if not tpl:
            continue
        polish = polish_map.get(tpl.get("id"))
        gen = generate_function(
            template=tpl, kind=it.get("kind") or "slide",
            palette_const=palette_const, fonts_const=fonts_const,
            chart_styles=chart_styles_by_type,
            polish=polish,
        )
        function_blocks.append(gen.source)

    parts = [header, "", *function_blocks]
    if chart_style_meta_lines:
        parts.append("")
        parts.append("\n".join(chart_style_meta_lines))
    return "\n\n\n".join(parts) + "\n"


# ── LLM polish helper (optional) ────────────────────────────────────────────


_POLISH_SYSTEM = """\
You are documenting a single auto-generated Python builder function for a
slide template. Given the template's name, description, inputs, and the layout
shape, write three short fields:

  * when_to_use   — 1-2 sentences: when this template is the right choice
  * when_to_avoid — 1 sentence: when a different template is better
  * example       — 3-6 lines of plausible Python showing the function being
                     called with realistic args

Respond with one JSON object, no prose, no fences:

{"when_to_use": "...", "when_to_avoid": "...", "example": "..."}
"""


def polish_template(
    template: dict[str, Any], llm_call: Callable[[str, str], str]
) -> dict[str, str]:
    """Call the LLM for the cosmetic docstring fields. Returns {} on any
    failure — the codegen still emits a complete module without polish.
    """
    user = json.dumps({
        "name": template.get("name"),
        "description": template.get("description"),
        "kind": template.get("category"),
        "tags": template.get("tags"),
        "inputs": list((template.get("inputs_schema") or {}).keys()),
        "layout_size": len(template.get("layout") or []),
    }, default=str)
    try:
        raw = llm_call(_POLISH_SYSTEM, user)
    except Exception as exc:
        log.warning("polish_template: LLM failed for %s: %s", template.get("name"), exc)
        return {}
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {
                "when_to_use": str(data.get("when_to_use") or "")[:300],
                "when_to_avoid": str(data.get("when_to_avoid") or "")[:300],
                "example": str(data.get("example") or "")[:500],
            }
    except Exception as exc:
        log.debug("polish_template: JSON parse failed: %s", exc)
    return {}
