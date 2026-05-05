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

    # Validate inputs
    errors: list[str] = []
    schema = template.get("inputs_schema") or {}
    for key, spec in schema.items():
        if spec.get("required") and key not in inputs:
            if "default" in spec:
                inputs[key] = spec["default"]
            else:
                errors.append(f"missing required input: {key}")
    if errors:
        return {"ok": False, "error": "; ".join(errors)}

    # Substitute inputs into layout (simple {{var}} replacement in strings)
    layout = template.get("layout") or []
    materialized_layout = _substitute(layout, inputs)
    materialized_connects = _substitute(template.get("connects") or {}, inputs)
    slide_script = _substitute_str(template.get("slide_script"), inputs) if template.get("slide_script") else None

    alias_to_id: dict[str, str] = {}
    created_elements: list[dict] = []
    errors2: list[str] = []

    for entry in materialized_layout:
        kind = entry.get("kind")
        alias = entry.get("alias")
        body = entry.get("body") or {}
        if not kind:
            continue
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


# ── Substitution ────────────────────────────────────────────────────────────


def _substitute(obj: Any, inputs: dict) -> Any:
    """Recursively walk dict/list and replace {{var}} in strings with inputs[var]."""
    if isinstance(obj, str):
        return _substitute_str(obj, inputs)
    if isinstance(obj, dict):
        return {k: _substitute(v, inputs) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute(v, inputs) for v in obj]
    return obj


def _substitute_str(s: str | None, inputs: dict) -> str | None:
    if s is None:
        return None
    import re as _re
    def repl(m: _re.Match) -> str:
        key = m.group(1).strip()
        val = inputs.get(key, m.group(0))
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
