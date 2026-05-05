"""Agent actions + telemetry audit log.

One row per agent invocation. Captures what the user asked for, what the
planner produced, what executed, what failed, and the doc-snapshot id so
rollback is one button.

SQLite-backed for v1; lives in the same directory as the auth db.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger(__name__)


_DEFAULT_DB_PATH = Path(os.environ.get("PERCY_AGENT_DB", "")) if os.environ.get("PERCY_AGENT_DB") \
    else Path(__file__).resolve().parent.parent.parent.parent / ".percy_agent.db"


SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS agent_actions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    doc_id          TEXT NOT NULL,
    slide_n         INTEGER,
    element_id      TEXT,
    actor           TEXT NOT NULL DEFAULT 'system',
    source          TEXT NOT NULL DEFAULT 'unknown',
    method          TEXT,
    path            TEXT,
    kind            TEXT NOT NULL,
    mode            TEXT,
    prompt          TEXT NOT NULL,
    plan_json       TEXT,
    response_json   TEXT,
    status          TEXT NOT NULL,
    error           TEXT,
    snapshot_id     TEXT,
    snapshot_index  INTEGER,
    affected_count  INTEGER DEFAULT 0,
    confirmed       INTEGER DEFAULT 0,
    elapsed_ms      INTEGER,
    created_at      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_telemetry (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    doc_id          TEXT,
    prompt          TEXT NOT NULL,
    mode_classified TEXT,
    retrieved_ids   TEXT,
    plan_summary    TEXT,
    validation      TEXT,
    executed        INTEGER DEFAULT 0,
    error           TEXT,
    user_followup   TEXT,
    latency_ms      INTEGER,
    created_at      REAL NOT NULL
);
"""

# Indexes that reference columns added by migration — created AFTER ALTER TABLE.
SCHEMA_INDEXES_BASIC = """
CREATE INDEX IF NOT EXISTS idx_agent_actions_doc       ON agent_actions(doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_user      ON agent_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_status    ON agent_actions(status);
CREATE INDEX IF NOT EXISTS idx_agent_telemetry_doc     ON agent_telemetry(doc_id, created_at DESC);
"""

SCHEMA_INDEXES_NEW = """
CREATE INDEX IF NOT EXISTS idx_agent_actions_actor     ON agent_actions(actor);
CREATE INDEX IF NOT EXISTS idx_agent_actions_source    ON agent_actions(source);
"""


def _conn(db_path: Path | None = None) -> sqlite3.Connection:
    p = db_path or _DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p), timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    return c


_INITIALIZED = False


def init_db(db_path: Path | None = None) -> None:
    """Create tables if missing, run column migrations, then create indexes."""
    global _INITIALIZED
    with _conn(db_path) as c:
        c.executescript(SCHEMA_TABLES)
        # Migrate older agent_actions tables that pre-date actor/source/method/path
        existing_cols = {row["name"] for row in c.execute("PRAGMA table_info(agent_actions)").fetchall()}
        for col, ddl in [
            ("actor",   "TEXT NOT NULL DEFAULT 'system'"),
            ("source",  "TEXT NOT NULL DEFAULT 'unknown'"),
            ("method",  "TEXT"),
            ("path",    "TEXT"),
        ]:
            if col not in existing_cols:
                c.execute(f"ALTER TABLE agent_actions ADD COLUMN {col} {ddl}")
        # Now safe to create the actor/source indexes.
        c.executescript(SCHEMA_INDEXES_BASIC)
        c.executescript(SCHEMA_INDEXES_NEW)
    _INITIALIZED = True


@contextmanager
def _ensured_conn(db_path: Path | None = None):
    if not _INITIALIZED:
        init_db(db_path)
    c = _conn(db_path)
    try:
        yield c
    finally:
        c.close()


# ── Public API ──────────────────────────────────────────────────────────────


def record_action(
    *,
    user_id: str | None,
    doc_id: str,
    prompt: str,
    kind: str,
    actor: str = "system",
    source: str = "unknown",
    method: str | None = None,
    path: str | None = None,
    mode: str | None = None,
    slide_n: int | None = None,
    element_id: str | None = None,
    plan: dict | list | None = None,
    response: dict | None = None,
    status: str = "planned",
    error: str | None = None,
    snapshot_id: str | None = None,
    snapshot_index: int | None = None,
    affected_count: int = 0,
    confirmed: bool = False,
    elapsed_ms: int | None = None,
    db_path: Path | None = None,
) -> str:
    aid = uuid.uuid4().hex
    with _ensured_conn(db_path) as c:
        c.execute(
            """
            INSERT INTO agent_actions
            (id, user_id, doc_id, slide_n, element_id, actor, source, method, path,
             kind, mode, prompt, plan_json, response_json, status, error,
             snapshot_id, snapshot_index, affected_count, confirmed, elapsed_ms, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (aid, user_id, doc_id, slide_n, element_id, actor, source, method, path,
             kind, mode, prompt,
             json.dumps(plan, default=str) if plan is not None else None,
             json.dumps(response, default=str) if response is not None else None,
             status, error, snapshot_id, snapshot_index, affected_count,
             1 if confirmed else 0, elapsed_ms, time.time()),
        )
    return aid


def update_action(action_id: str, db_path: Path | None = None, **fields) -> None:
    """Patch an existing action row. Allowed fields: status, error, response,
    snapshot_id, snapshot_index, affected_count, elapsed_ms."""
    if not fields:
        return
    cols: list[str] = []
    vals: list = []
    for k, v in fields.items():
        if k == "response":
            cols.append("response_json = ?")
            vals.append(json.dumps(v, default=str) if v is not None else None)
        elif k in ("status", "error", "snapshot_id", "snapshot_index",
                   "affected_count", "elapsed_ms"):
            cols.append(f"{k} = ?")
            vals.append(v)
    if not cols:
        return
    vals.append(action_id)
    with _ensured_conn(db_path) as c:
        c.execute(f"UPDATE agent_actions SET {', '.join(cols)} WHERE id = ?", vals)


def list_actions(
    *, doc_id: str | None = None, user_id: str | None = None,
    actor: str | None = None, source: str | None = None,
    limit: int = 50, db_path: Path | None = None,
) -> list[dict]:
    where: list[str] = []
    args: list = []
    if doc_id:
        where.append("doc_id = ?"); args.append(doc_id)
    if user_id:
        where.append("user_id = ?"); args.append(user_id)
    if actor:
        where.append("actor = ?"); args.append(actor)
    if source:
        where.append("source = ?"); args.append(source)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    args.append(limit)
    with _ensured_conn(db_path) as c:
        rows = c.execute(
            f"SELECT * FROM agent_actions {where_sql} ORDER BY created_at DESC LIMIT ?",
            args,
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_action(action_id: str, db_path: Path | None = None) -> dict | None:
    with _ensured_conn(db_path) as c:
        row = c.execute("SELECT * FROM agent_actions WHERE id = ?", (action_id,)).fetchone()
    return _row_to_dict(row) if row else None


def record_telemetry(
    *,
    user_id: str | None,
    doc_id: str | None,
    prompt: str,
    mode_classified: str | None,
    retrieved_ids: list[str] | None = None,
    plan_summary: str | None = None,
    validation: str | None = None,
    executed: bool = False,
    error: str | None = None,
    latency_ms: int | None = None,
    db_path: Path | None = None,
) -> str:
    tid = uuid.uuid4().hex
    with _ensured_conn(db_path) as c:
        c.execute(
            """
            INSERT INTO agent_telemetry
            (id, user_id, doc_id, prompt, mode_classified, retrieved_ids, plan_summary,
             validation, executed, error, latency_ms, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (tid, user_id, doc_id, prompt, mode_classified,
             json.dumps(retrieved_ids) if retrieved_ids else None,
             plan_summary, validation, 1 if executed else 0, error, latency_ms, time.time()),
        )
    return tid


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = {k: row[k] for k in row.keys()}
    if d.get("plan_json"):
        try: d["plan"] = json.loads(d.pop("plan_json"))
        except Exception: d["plan"] = None
    if d.get("response_json"):
        try: d["response"] = json.loads(d.pop("response_json"))
        except Exception: d["response"] = None
    d["confirmed"] = bool(d.get("confirmed"))
    return d
