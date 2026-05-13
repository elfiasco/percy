"""Templates — saved bundles of element layout + connect scripts + slide script.

A template is the unifying primitive for "create a quarterly review" / "apply
the team-update layout". It's how the agent (and the user) materializes
multi-element structure with one call.

A template carries:
  * ``layout``         — list of element create specs (kind + body)
  * ``slide_script``   — optional slide-level script
  * ``connects``       — element_alias → connect script source
  * ``inputs_schema``  — declarations of {name, type, required, default, description}
  * ``sample_inputs``  — for previews and quick testing
  * ``provenance``     — tags, source, etc.

Templates are stored in SQLite. ``Percy Standard`` templates ship with the
package and are loaded on first use. User-saved templates live in the same
table with ``category`` set to the org/project name.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


_DEFAULT_DB_PATH = Path(os.environ.get("PERCY_AGENT_DB", "")) if os.environ.get("PERCY_AGENT_DB") \
    else Path(__file__).resolve().parent.parent.parent.parent / ".percy_agent.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL,                -- 'Percy Standard' | <org_id> | <project_id>
    tags            TEXT,                          -- JSON list
    inputs_schema   TEXT,                          -- JSON dict
    sample_inputs   TEXT,                          -- JSON dict
    layout_json     TEXT NOT NULL,                 -- JSON list of {kind, body, alias?}
    slide_script    TEXT,
    connects_json   TEXT,                          -- JSON {alias: script}
    preview_image   TEXT,                          -- optional URL or data URI
    is_builtin      INTEGER DEFAULT 0,             -- 1 for Percy Standard
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_name     ON templates(name);
"""


@dataclass(slots=True)
class Template:
    id:             str
    name:           str
    description:    str
    category:       str
    tags:           list[str] = field(default_factory=list)
    inputs_schema:  dict[str, dict] = field(default_factory=dict)
    sample_inputs:  dict[str, Any] = field(default_factory=dict)
    layout:         list[dict] = field(default_factory=list)
    slide_script:   str | None = None
    connects:       dict[str, str] = field(default_factory=dict)
    preview_image:  str | None = None
    is_builtin:     bool = False
    created_at:     float = 0.0
    updated_at:     float = 0.0

    def to_dict(self) -> dict:
        d = {k: getattr(self, k) for k in self.__slots__}
        return d


# ── DB helpers ──────────────────────────────────────────────────────────────


_INITIALIZED = False


def _conn(db_path: Path | None = None) -> sqlite3.Connection:
    p = db_path or _DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p), timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db(db_path: Path | None = None) -> None:
    global _INITIALIZED
    with _conn(db_path) as c:
        c.executescript(SCHEMA)
    _INITIALIZED = True
    _seed_builtins(db_path)


@contextmanager
def _ensured(db_path: Path | None = None):
    if not _INITIALIZED:
        init_db(db_path)
    c = _conn(db_path)
    try:
        yield c
    finally:
        c.close()


# ── CRUD ────────────────────────────────────────────────────────────────────


def list_templates(*, category: str | None = None, db_path: Path | None = None) -> list[dict]:
    with _ensured(db_path) as c:
        if category:
            rows = c.execute("SELECT * FROM templates WHERE category = ? ORDER BY name", (category,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM templates ORDER BY is_builtin DESC, name").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_template(template_id: str, db_path: Path | None = None) -> dict | None:
    with _ensured(db_path) as c:
        row = c.execute("SELECT * FROM templates WHERE id = ?", (template_id,)).fetchone()
    return _row_to_dict(row) if row else None


def save_template(t: Template, db_path: Path | None = None) -> str:
    if not t.id:
        t.id = uuid.uuid4().hex
    if not t.created_at:
        t.created_at = time.time()
    t.updated_at = time.time()
    with _ensured(db_path) as c:
        c.execute(
            """
            INSERT OR REPLACE INTO templates
            (id, name, description, category, tags, inputs_schema, sample_inputs,
             layout_json, slide_script, connects_json, preview_image, is_builtin,
             created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (t.id, t.name, t.description, t.category,
             json.dumps(t.tags), json.dumps(t.inputs_schema), json.dumps(t.sample_inputs),
             json.dumps(t.layout), t.slide_script, json.dumps(t.connects),
             t.preview_image, 1 if t.is_builtin else 0, t.created_at, t.updated_at),
        )
    return t.id


def delete_template(template_id: str, db_path: Path | None = None) -> bool:
    with _ensured(db_path) as c:
        cur = c.execute("DELETE FROM templates WHERE id = ? AND is_builtin = 0", (template_id,))
        return cur.rowcount > 0


def search_templates(query: str, *, top_k: int = 5, db_path: Path | None = None) -> list[dict]:
    """Simple keyword search across name + description + tags."""
    import re as _re
    q_tokens = {t.lower() for t in _re.findall(r"[A-Za-z][A-Za-z0-9_]*", query or "")
                if len(t) >= 2}
    if not q_tokens:
        return list_templates(db_path=db_path)[:top_k]

    with _ensured(db_path) as c:
        rows = c.execute("SELECT * FROM templates").fetchall()

    scored: list[tuple[float, dict]] = []
    for r in rows:
        d = _row_to_dict(r)
        text = " ".join([d["name"], d["description"] or "", " ".join(d.get("tags") or [])])
        text_tokens = {t.lower() for t in _re.findall(r"[A-Za-z][A-Za-z0-9_]*", text) if len(t) >= 2}
        overlap = len(q_tokens & text_tokens)
        if overlap:
            score = overlap / max(1, len(q_tokens))
            if d.get("is_builtin"):
                score += 0.05  # tiny tiebreak for builtins
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:top_k]]


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = {k: row[k] for k in row.keys()}
    d["tags"] = json.loads(d.pop("tags") or "[]")
    d["inputs_schema"] = json.loads(d.pop("inputs_schema") or "{}")
    d["sample_inputs"] = json.loads(d.pop("sample_inputs") or "{}")
    d["layout"] = json.loads(d.pop("layout_json") or "[]")
    d["connects"] = json.loads(d.pop("connects_json") or "{}")
    d["is_builtin"] = bool(d.get("is_builtin"))
    return d


# ── Apply ───────────────────────────────────────────────────────────────────


def apply_template(
    template: dict,
    *,
    studio,                            # percy.agent.script_api.Studio instance
    slide_n: int,
    inputs: dict | None = None,
) -> dict:
    """Materialize a template onto a slide.

    Steps:
      1. Validate inputs against ``inputs_schema``
      2. For each layout entry, call the appropriate ``create_*`` endpoint
      3. Map ``alias → element_id`` from create responses
      4. Attach connect scripts to elements with matching aliases
      5. If template has a slide_script, set + run it

    Returns: {"ok": True, "elements": [...], "slide_script_result": {...}?}
    """
    inputs = inputs or {}

    # Validate inputs + pre-fill defaults for EVERY schema entry that has
    # one (not just required ones). This guarantees that no {{var}}
    # placeholder leaks through to the rendered output just because the
    # planner forgot to include an optional input. Saw this on the
    # Snowflake demo: agent picked a template with an `eyebrow` input
    # and never filled it → literal "{{eyebrow}}" showed up on screen.
    errors: list[str] = []
    schema = template.get("inputs_schema") or {}
    for key, spec in schema.items():
        if key in inputs:
            continue
        if "default" in spec:
            inputs[key] = spec["default"]
        elif spec.get("required"):
            errors.append(f"missing required input: {key}")
    if errors:
        return {"ok": False, "error": "; ".join(errors)}

    # Pre-process derived inputs. The modular text template (std.el.text)
    # supports a `runs` input — a list of segments with mixed formatting.
    # When set, we synthesize a `paragraphs` input matching what
    # percy.bridge.builders.build_text expects so the layout can simply
    # reference `{{paragraphs}}`. This keeps the template engine logic-free
    # while still supporting the runs feature.
    runs_input = inputs.get("runs")
    if isinstance(runs_input, list) and runs_input:
        # Bridge expects: paragraphs=[{runs:[{text, font_bold, font_italic,
        # font_color, font_size, font_name, ...}]}]
        # We normalize the agent-friendly short keys (bold, italic, color,
        # size, font) to the Bridge-canonical font_* names so any caller
        # can use the shorthand.
        def _norm(seg: dict) -> dict:
            normalized = {"text": str(seg.get("text", ""))}
            if "bold" in seg or "font_bold" in seg:
                normalized["font_bold"] = bool(seg.get("bold", seg.get("font_bold", False)))
            if "italic" in seg or "font_italic" in seg:
                normalized["font_italic"] = bool(seg.get("italic", seg.get("font_italic", False)))
            if "color" in seg or "font_color" in seg:
                normalized["font_color"] = seg.get("color", seg.get("font_color"))
            if "size" in seg or "font_size" in seg:
                normalized["font_size"] = seg.get("size", seg.get("font_size"))
            if "font" in seg or "font_name" in seg:
                normalized["font_name"] = seg.get("font", seg.get("font_name"))
            return normalized
        inputs["paragraphs"] = [{"runs": [_norm(seg) for seg in runs_input if isinstance(seg, dict)]}]
    else:
        # Make {{paragraphs}} substitute to None so the template body's
        # paragraphs key is dropped during cleanup.
        inputs.setdefault("paragraphs", None)

    # Substitute inputs into layout (simple {{var}} replacement in strings)
    layout = template.get("layout") or []
    materialized_layout = _substitute(layout, inputs)

    # Strip None-valued body keys so the create_<kind> endpoints see clean
    # JSON. This is what makes `{{paragraphs}}` disappear when runs is empty.
    for entry in materialized_layout:
        body = entry.get("body") or {}
        for k in list(body.keys()):
            if body[k] is None:
                del body[k]

    # Auto-shrink text whose copy would visibly overflow its box. Runs
    # regardless of whether the template parameterized font_size — it's
    # a safety net for the agent picking templates whose source slide
    # had short copy and being asked to render long copy. Pure heuristic;
    # never grows font, only shrinks, and floors at 8pt.
    _autoshrink_text_overflow(materialized_layout)
    materialized_connects = _substitute(template.get("connects") or {}, inputs)
    slide_script = _substitute_str(template.get("slide_script"), inputs) if template.get("slide_script") else None

    alias_to_id: dict[str, str] = {}
    created_elements: list[dict] = []
    errors2: list[str] = []

    for entry in materialized_layout:
        kind = entry.get("kind")
        alias = entry.get("alias")
        if not kind:
            continue
        # Full-fidelity bridge insertion path (v3 induction emits these).
        if kind == "bridge-raw":
            bridge_dict = entry.get("bridge") or {}
            bridge_dict = _strip_none_recursive(bridge_dict)
            try:
                resp = studio.insert_bridge_raw(slide_n, bridge_dict)
            except Exception as exc:
                errors2.append(f"insert_bridge_raw{f'/{alias}' if alias else ''} failed: {exc}")
                continue
            eid = resp.get("element_id") or resp.get("id")
            if alias:
                alias_to_id[alias] = eid
            created_elements.append({"alias": alias, "element_id": eid,
                                     "kind": bridge_dict.get("__type__", "bridge-raw"),
                                     "name": resp.get("name")})
            continue
        # Legacy intent-JSON path (kept for non-v3 templates).
        body = entry.get("body") or {}
        try:
            resp = studio.create_element(slide_n, kind, body)
        except Exception as exc:
            errors2.append(f"create {kind}{f'/{alias}' if alias else ''} failed: {exc}")
            continue
        eid = resp.get("element_id") or resp.get("id")
        if alias:
            alias_to_id[alias] = eid
        created_elements.append({"alias": alias, "element_id": eid, "kind": kind, "name": resp.get("name")})

    # Attach connects
    connect_results: list[dict] = []
    for alias, script in materialized_connects.items():
        eid = alias_to_id.get(alias)
        if not eid:
            errors2.append(f"connect {alias!r}: no element materialized for that alias")
            continue
        try:
            studio._patch(
                f"/api/docs/{studio.doc_id}/slides/{slide_n}/elements/{eid}/connect",
                {"script": script, "inputs": inputs.get(f"{alias}_inputs") or {}},
            )
            connect_results.append({"alias": alias, "element_id": eid, "ok": True})
        except Exception as exc:
            connect_results.append({"alias": alias, "element_id": eid, "ok": False, "error": str(exc)})

    # Slide script
    slide_script_result = None
    if slide_script:
        try:
            studio._put(
                f"/api/docs/{studio.doc_id}/slides/{slide_n}/script",
                {"script": slide_script, "inputs": inputs},
            )
            slide_script_result = studio._post(
                f"/api/docs/{studio.doc_id}/slides/{slide_n}/script/run", {},
            )
        except Exception as exc:
            slide_script_result = {"ok": False, "error": str(exc)}

    return {
        "ok": not errors2,
        "errors": errors2,
        "elements": created_elements,
        "alias_to_id": alias_to_id,
        "connects": connect_results,
        "slide_script_result": slide_script_result,
    }


# ── Auto-shrink ─────────────────────────────────────────────────────────────


def _autoshrink_text_overflow(layout: list[dict]) -> None:
    """Clamp font_size on text-bearing elements whose substituted copy
    would obviously overflow the element's bounding box.

    Why this exists: templates capture box geometry verbatim from the
    source slide they were induced from. A "subtitle" template with
    box width 4in and font 24pt is sized to comfortably hold the
    original ~12 chars. When the agent then fills it with a 50-char
    subtitle, it visibly runs past the edge. This pass catches that
    case at apply time.

    Heuristic (intentionally simple, no font metrics):
      * Proportional fonts average ~0.5 × font_pt per character.
      * Capacity = (chars-per-line × line-count) where:
            chars_per_line = floor(width_in × 144 / font_pt)
            line_count     = floor(height_in × 72 / (font_pt × 1.15))
      * If actual length is > 1.1× capacity, solve for the largest
        font_pt that fits (preserve aspect ratio, ignore wrapping at
        word boundaries — over-counting chars is fine here).
      * Floor at 8pt so we never make text unreadable, and only apply
        the shrink if the new size is meaningfully smaller (≥5% drop).

    Operates in place on every element with text_runs.
    """
    import math
    for entry in layout:
        body = entry.get("body") or {}
        runs = body.get("text_runs")
        if not isinstance(runs, list) or not runs:
            continue
        pos = body.get("position") or {}
        try:
            w = float(pos.get("width_in") or 0)
            h = float(pos.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue

        text = "".join(
            str(r.get("text", "")) for r in runs
            if isinstance(r, dict) and r.get("text") is not None
        )
        if not text.strip():
            continue

        first = runs[0] if isinstance(runs[0], dict) else None
        if not first:
            continue
        try:
            fs = float(first.get("font_size") or 0)
        except (TypeError, ValueError):
            continue
        if fs <= 0:
            continue

        chars_per_line = max(1, int(w * 144 / fs))
        lines_avail    = max(1, int(h * 72 / (fs * 1.15)))
        capacity       = chars_per_line * lines_avail
        if len(text) <= capacity * 1.1:
            continue

        # Solve for fs' such that the capacity formula equals len(text):
        #   (w*144/fs') * (h*72/(fs'*1.15)) = len(text)
        #   fs'^2 = w * h * 144 * 72 / 1.15 / len(text)
        target = math.sqrt(w * h * 144 * 72 / 1.15 / max(1, len(text)))
        new_fs = max(8.0, min(fs, target))
        if new_fs >= fs * 0.95:
            continue   # not enough of a shrink to bother
        scale = new_fs / fs
        for r in runs:
            if not isinstance(r, dict):
                continue
            rfs = r.get("font_size")
            if isinstance(rfs, (int, float)) and rfs > 0:
                r["font_size"] = round(float(rfs) * scale, 1)
        log.info("autoshrink: %s font %.1f→%.1fpt for %d chars in %.2f×%.2fin",
                 entry.get("alias") or "?", fs, new_fs, len(text), w, h)


# ── Substitution ────────────────────────────────────────────────────────────


_LONE_VAR_RE = None  # lazy-compiled below


def _strip_none_recursive(obj: Any) -> Any:
    """Drop keys whose values are None at every level of a nested dict/list.

    Used right before insert_bridge_raw so that optional inputs the caller
    didn't fill (the placeholder substituted to None) don't sneak through
    as literal None values into the BridgeElement reconstruction. The codec
    is happy with a missing key (default applies); it would choke on None
    for a typed field like an int.
    """
    if isinstance(obj, dict):
        return {k: _strip_none_recursive(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_none_recursive(v) for v in obj]
    return obj


def _substitute(obj: Any, inputs: dict) -> Any:
    """Recursively walk dict/list and replace {{var}} references.

    Two substitution modes:
      * **String interpolation** — a string with embedded {{var}} keeps its
        string nature; refs replaced inline via _substitute_str.
      * **Typed pass-through** — when the entire string is a single
        ``"{{var}}"`` reference (no surrounding text), the input's actual
        type wins: a list stays a list, a number stays a number, a bool
        stays a bool. This is critical for fields like ``runs``,
        ``categories``, ``values``, ``font_size`` where the template body
        carries a placeholder but the backend create_* endpoint expects
        a specific typed value.
    """
    if isinstance(obj, str):
        return _substitute_str(obj, inputs)
    if isinstance(obj, dict):
        return {k: _substitute(v, inputs) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute(v, inputs) for v in obj]
    return obj


def _substitute_str(s: str | None, inputs: dict) -> Any:
    """Replace {{var}} references. Returns the input's native type when the
    string is a single bare reference; otherwise returns the interpolated
    string."""
    if s is None:
        return None
    import re as _re
    global _LONE_VAR_RE
    if _LONE_VAR_RE is None:
        _LONE_VAR_RE = _re.compile(r"^\s*\{\{\s*([A-Za-z_][A-Za-z_0-9]*)\s*\}\}\s*$")

    # Typed pass-through: the WHOLE string is "{{var}}" → return native value.
    m = _LONE_VAR_RE.match(s)
    if m:
        key = m.group(1)
        if key in inputs:
            return inputs[key]
        # Missing → empty string. We do NOT preserve the literal `{{var}}`
        # because that would leak placeholders into rendered slides.

    def repl(m2: _re.Match) -> str:
        key = m2.group(1).strip()
        # Default to empty string when the key is missing — same reason.
        val = inputs.get(key, "")
        return str(val)
    return _re.sub(r"\{\{([^}]+)\}\}", repl, s)


# ── Builtin seeding ─────────────────────────────────────────────────────────


def _seed_builtins(db_path: Path | None = None) -> None:
    """Insert Percy Standard templates if missing."""
    from percy.agent import standard_templates
    with _ensured(db_path) as c:
        existing = {r["id"] for r in c.execute(
            "SELECT id FROM templates WHERE is_builtin = 1"
        ).fetchall()}
    for t in standard_templates.STANDARD_TEMPLATES:
        if t.id in existing:
            # Update content (in case the standard library changed) but preserve
            # created_at.
            with _ensured(db_path) as c:
                row = c.execute("SELECT created_at FROM templates WHERE id = ?", (t.id,)).fetchone()
                if row:
                    t.created_at = row["created_at"]
        save_template(t, db_path=db_path)
    log.info("templates: seeded %d Percy Standard templates", len(standard_templates.STANDARD_TEMPLATES))
