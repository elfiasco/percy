"""Storage layer for users / orgs / folders / projects / sessions / invites.

Backends:
  - SQLite (default for local dev). File path = $PERCY_AUTH_DB or <cwd>/percy_app.db.
  - Postgres when $DATABASE_URL or $DB_HOST is set. Uses psycopg2.

The two backends share the same SQL surface; we maintain a thin adapter that
translates `?` placeholders to `%s` for psycopg2. Migrations are written once
in a backend-agnostic dialect (only `IF NOT EXISTS` and standard types).

Schema: same tables in both backends. In Postgres mode, the tables coexist with
the existing app/cloud/db.py tables (organizations, projects, memberships are
intentionally compatible and shared).
"""

from __future__ import annotations

import contextlib
import logging
import os
import secrets

log = logging.getLogger("percy.auth_db")
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterator

# ── Backend selection ────────────────────────────────────────────────────────

def _use_postgres() -> bool:
    return bool(os.environ.get("DATABASE_URL") or os.environ.get("DB_HOST"))


_DB_PATH = Path(os.environ.get("PERCY_AUTH_DB", str(Path.cwd() / "percy_app.db")))
_LOCK = threading.RLock()
_PG_POOL = None  # lazily initialized for postgres


def _pg_dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    host = os.environ["DB_HOST"]
    port = os.environ.get("DB_PORT", "5432")
    name = os.environ.get("DB_NAME", "percy")
    user = os.environ.get("DB_USER", "percy")
    password = os.environ["DB_PASSWORD"]
    return f"postgresql://{user}:{password}@{host}:{port}/{name}"


def _init_pg_pool() -> None:
    global _PG_POOL
    if _PG_POOL is not None:
        return
    import psycopg2.pool  # type: ignore
    _PG_POOL = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=_pg_dsn())


# ── Connection adapter ───────────────────────────────────────────────────────

class _CursorAdapter:
    """Thin wrapper that:
       - translates `?` placeholders to `%s` when running on Postgres
       - returns rows as dict for both backends
    """

    def __init__(self, cur: Any, *, is_pg: bool):
        self._cur = cur
        self._is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()):
        if self._is_pg:
            sql = sql.replace("?", "%s")
            # CHECK (a IN ('x', 'y')) constraint syntax is supported in both
        self._cur.execute(sql, params)
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        if self._is_pg:
            cols = [d[0] for d in self._cur.description]
            return dict(zip(cols, row))
        # sqlite3.Row is already mapping-like
        return dict(row)

    def fetchall(self):
        rows = self._cur.fetchall()
        if not rows:
            return []
        if self._is_pg:
            cols = [d[0] for d in self._cur.description]
            return [dict(zip(cols, r)) for r in rows]
        return [dict(r) for r in rows]


class _ConnAdapter:
    def __init__(self, conn: Any, *, is_pg: bool):
        self._conn = conn
        self._is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()) -> _CursorAdapter:
        cur = self._conn.cursor()
        ad = _CursorAdapter(cur, is_pg=self._is_pg)
        ad.execute(sql, params)
        return ad


@contextlib.contextmanager
def get_conn() -> Iterator[_ConnAdapter]:
    """Context manager that yields a backend-neutral connection adapter."""
    if _use_postgres():
        _init_pg_pool()
        assert _PG_POOL is not None
        raw = _PG_POOL.getconn()
        try:
            yield _ConnAdapter(raw, is_pg=True)
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            _PG_POOL.putconn(raw)
    else:
        with _LOCK:
            raw = sqlite3.connect(str(_DB_PATH), check_same_thread=False, timeout=15.0)
            raw.row_factory = sqlite3.Row
            raw.execute("PRAGMA journal_mode = WAL;")
            raw.execute("PRAGMA foreign_keys = ON;")
            try:
                yield _ConnAdapter(raw, is_pg=False)
                raw.commit()
            except Exception:
                raw.rollback()
                raise
            finally:
                raw.close()


# ── Migrations ───────────────────────────────────────────────────────────────
# We use a backend-neutral subset. SQLite ignores extra constraints we don't need;
# Postgres handles the same DDL. INTEGER NOT NULL with epoch-second timestamps is
# portable and avoids TIMESTAMPTZ ambiguity.

# All tables are prefixed `studio_*` so they coexist cleanly with the existing
# cloud-side tables (organizations, projects, memberships, documents, jobs,
# audit_events, access_requests) which `app/cloud/db.py` owns. The cloud worker
# is unaffected by this schema; the studio backend owns its own data.
_MIGRATIONS_COMMON = [
    """
    CREATE TABLE IF NOT EXISTS studio_users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        google_sub    TEXT UNIQUE,
        display_name  TEXT NOT NULL,
        avatar_url    TEXT,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_orgs (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL UNIQUE,
        kind       TEXT NOT NULL DEFAULT 'team',
        domain     TEXT,
        created_at INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_orgs_domain ON studio_orgs(domain);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_memberships (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        org_id     TEXT NOT NULL,
        role       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, org_id)
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_memberships_user ON studio_memberships(user_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_memberships_org  ON studio_memberships(org_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_folders (
        id         TEXT PRIMARY KEY,
        org_id     TEXT NOT NULL,
        parent_id  TEXT,
        name       TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_folders_org    ON studio_folders(org_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_folders_parent ON studio_folders(parent_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_projects (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL,
        folder_id   TEXT,
        name        TEXT NOT NULL,
        doc_source  TEXT,
        doc_id      TEXT,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_projects_org    ON studio_projects(org_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_projects_folder ON studio_projects(folder_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_sessions_user ON studio_sessions(user_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_invites (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL,
        email       TEXT NOT NULL,
        role        TEXT NOT NULL,
        token       TEXT NOT NULL UNIQUE,
        invited_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        accepted_at INTEGER,
        expires_at  INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_invites_org   ON studio_invites(org_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_invites_email ON studio_invites(email);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_builds (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        triggered_by  TEXT,
        trigger       TEXT NOT NULL,            -- 'manual' | 'scheduled' | 'event'
        status        TEXT NOT NULL,            -- 'queued' | 'running' | 'success' | 'failed'
        formats       TEXT NOT NULL,            -- JSON array of requested output formats
        outputs       TEXT NOT NULL DEFAULT '{}', -- JSON map: format -> file path/uri
        summary       TEXT,
        error         TEXT,
        started_at    INTEGER NOT NULL,
        finished_at   INTEGER,
        elapsed_ms    INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_builds_project ON studio_builds(project_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_builds_status  ON studio_builds(status);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_builds_started ON studio_builds(started_at);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_templates (
        id                  TEXT PRIMARY KEY,
        org_id              TEXT NOT NULL,
        scope               TEXT NOT NULL,        -- 'user' | 'team' | 'org'
        owner_id            TEXT NOT NULL,
        name                TEXT NOT NULL,
        description         TEXT,
        brand               TEXT NOT NULL DEFAULT '{}',  -- JSON: extracted brand data (read-only stats)
        source_project_ids  TEXT NOT NULL DEFAULT '[]',  -- JSON array of project ids
        last_extracted_at   INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_templates_org   ON studio_templates(org_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_templates_owner ON studio_templates(owner_id);
    """,
    # ── Template Set membership ─────────────────────────────────────────────
    # Links a template-set row (studio_templates) to individual reusable slide
    # or element templates owned by the agent layer (src/percy/agent/templates).
    # No FK because the agent templates live in a separate sqlite DB; we treat
    # the template_id as opaque and let the agent layer be the source of truth
    # for the layout/inputs_schema.
    """
    CREATE TABLE IF NOT EXISTS studio_template_set_items (
        set_id          TEXT NOT NULL,
        template_id     TEXT NOT NULL,
        kind            TEXT NOT NULL,                  -- 'slide' | 'element'
        order_index     INTEGER NOT NULL DEFAULT 0,
        provenance      TEXT NOT NULL DEFAULT '{}',     -- JSON: {induced_from: ref_id, confidence, ...}
        added_by        TEXT,
        added_at        INTEGER NOT NULL,
        PRIMARY KEY (set_id, template_id)
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_tsi_set  ON studio_template_set_items(set_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_tsi_kind ON studio_template_set_items(set_id, kind);
    """,
    # ── Template-set reference documents ────────────────────────────────────
    # Example PPTX / PDF / MD files uploaded to a set for the agent to mine
    # patterns from. Distinct from source_project_ids (which points at user
    # projects); refs are standalone uploads scoped only to the set.
    """
    CREATE TABLE IF NOT EXISTS studio_template_set_refs (
        id              TEXT PRIMARY KEY,
        set_id          TEXT NOT NULL,
        filename        TEXT NOT NULL,
        mime_type       TEXT,
        size_bytes      INTEGER NOT NULL DEFAULT 0,
        storage_key     TEXT NOT NULL,
        doc_id          TEXT,                           -- assigned once onboarded as a Bridge doc
        slide_count     INTEGER NOT NULL DEFAULT 0,
        element_count   INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded|onboarding|ready|failed
        error           TEXT,
        uploaded_by     TEXT NOT NULL,
        uploaded_at     INTEGER NOT NULL,
        onboarded_at    INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_tsr_set    ON studio_template_set_refs(set_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_tsr_status ON studio_template_set_refs(status);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_team_envs (
        id                  TEXT PRIMARY KEY,
        org_id              TEXT NOT NULL,
        name                TEXT NOT NULL,
        requirements        TEXT NOT NULL DEFAULT '',
        env_vars            TEXT NOT NULL DEFAULT '{}',
        package_index_url   TEXT,
        package_index_user  TEXT,
        package_index_token TEXT,
        venv_path           TEXT,
        status              TEXT NOT NULL DEFAULT 'unbuilt',
        last_build_log      TEXT,
        last_built_at       INTEGER,
        created_by          TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_team_envs_org ON studio_team_envs(org_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_refresh_jobs (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        env_id          TEXT,
        schedule        TEXT NOT NULL,
        entry_point     TEXT NOT NULL DEFAULT 'refresh.py',
        script_source   TEXT NOT NULL DEFAULT '',
        extra_env       TEXT NOT NULL DEFAULT '{}',
        enabled         INTEGER NOT NULL DEFAULT 1,
        last_run_at     INTEGER,
        next_run_at     INTEGER,
        last_status     TEXT,
        last_error      TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_refresh_jobs_project ON studio_refresh_jobs(project_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_refresh_jobs_next    ON studio_refresh_jobs(next_run_at);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_refresh_runs (
        id           TEXT PRIMARY KEY,
        job_id       TEXT NOT NULL,
        project_id   TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        finished_at  INTEGER,
        status       TEXT NOT NULL,
        log          TEXT,
        build_id     TEXT
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_refresh_runs_job ON studio_refresh_runs(job_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_eval_results (
        id           TEXT PRIMARY KEY,
        env_id       TEXT NOT NULL,
        user_id      TEXT,
        status       TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'running' | 'success' | 'failed'
        exit_code    INTEGER,
        stdout       TEXT,
        stderr       TEXT,
        elapsed_ms   INTEGER,
        note         TEXT,
        created_at   INTEGER NOT NULL,
        finished_at  INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_eval_results_env ON studio_eval_results(env_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_eval_results_status ON studio_eval_results(status);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_email_verifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        token      TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_email_verif_user  ON studio_email_verifications(user_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_email_verif_token ON studio_email_verifications(token);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_password_resets (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        token      TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_pw_resets_token ON studio_password_resets(token);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_user_settings (
        user_id        TEXT PRIMARY KEY,
        theme          TEXT NOT NULL DEFAULT 'light',
        locale         TEXT NOT NULL DEFAULT 'en',
        notifications  TEXT NOT NULL DEFAULT '{}',
        default_org_id TEXT,
        panel_states   TEXT NOT NULL DEFAULT '{}',
        updated_at     INTEGER NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_project_shares (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        grantee_id   TEXT,
        share_token  TEXT UNIQUE,
        role         TEXT NOT NULL DEFAULT 'viewer',
        created_by   TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_proj_shares_project ON studio_project_shares(project_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_proj_shares_token   ON studio_project_shares(share_token);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_proj_shares_grantee ON studio_project_shares(grantee_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_project_assets (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        org_id       TEXT NOT NULL,
        name         TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        storage_key  TEXT NOT NULL,
        created_by   TEXT NOT NULL,
        created_at   INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_proj_assets_project ON studio_project_assets(project_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_audit_events (
        id            TEXT PRIMARY KEY,
        org_id        TEXT,
        user_id       TEXT,
        action        TEXT NOT NULL,
        resource_type TEXT,
        resource_id   TEXT,
        details       TEXT NOT NULL DEFAULT '{}',
        ip_addr       TEXT,
        created_at    INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_audit_org    ON studio_audit_events(org_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_audit_user   ON studio_audit_events(user_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_audit_action ON studio_audit_events(action);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_audit_ts     ON studio_audit_events(created_at);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_plans (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        max_seats      INTEGER NOT NULL DEFAULT 5,
        max_projects   INTEGER NOT NULL DEFAULT 10,
        features       TEXT NOT NULL DEFAULT '[]',
        price_monthly  INTEGER NOT NULL DEFAULT 0,
        price_annual   INTEGER NOT NULL DEFAULT 0,
        is_default     INTEGER NOT NULL DEFAULT 0
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_subscriptions (
        id                  TEXT PRIMARY KEY,
        org_id              TEXT NOT NULL UNIQUE,
        plan_id             TEXT NOT NULL,
        seats_purchased     INTEGER NOT NULL DEFAULT 5,
        status              TEXT NOT NULL DEFAULT 'active',
        current_period_end  INTEGER,
        external_id         TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_studio_subs_org ON studio_subscriptions(org_id);
    """,
    """
    CREATE TABLE IF NOT EXISTS studio_sso_configs (
        id             TEXT PRIMARY KEY,
        org_id         TEXT NOT NULL UNIQUE,
        provider       TEXT NOT NULL DEFAULT 'saml',
        metadata_url   TEXT,
        metadata_xml   TEXT,
        entity_id      TEXT,
        sso_url        TEXT,
        slo_url        TEXT,
        certificate    TEXT,
        attribute_map  TEXT NOT NULL DEFAULT '{}',
        enabled        INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
    );
    """,
]

_PG_COLUMN_ADDS: list[str] = []  # No legacy schema reconciliation needed — studio_* tables are isolated

# Forward-compatible idempotent ALTERs that work on both SQLite and Postgres.
_FORWARD_ADDS = [
    # Projects gain a refresh schedule (None | "on_demand" | "daily" | "weekly" | "monthly")
    ("studio_projects", "schedule", "TEXT"),
    ("studio_users", "email_verified", "INTEGER NOT NULL DEFAULT 0"),
    # ── Template Sets ────────────────────────────────────────────────────────
    # Curated brand fields (separate from the auto-extracted `brand` stats).
    # `palette`: JSON list of {name, hex, role?} entries chosen by the user
    #            (or pre-populated via brand-extraction then confirmed).
    # `fonts`:   JSON list of {role: 'heading'|'body'|'mono', name, fallbacks}
    # `style_rules`: JSON dict — max_title_length, capitalization, number_format,
    #                lock_to_palette (bool), forbid_off_palette_colors (bool), etc.
    # `instructions_md`: free-form markdown voice/layout guide sent to the LLM
    #                    verbatim when this set is active.
    ("studio_templates", "instructions_md", "TEXT NOT NULL DEFAULT ''"),
    ("studio_templates", "palette",         "TEXT NOT NULL DEFAULT '[]'"),
    ("studio_templates", "fonts",           "TEXT NOT NULL DEFAULT '[]'"),
    ("studio_templates", "style_rules",     "TEXT NOT NULL DEFAULT '{}'"),
    # Inheritance walk: null folder_id = org-wide; folder_id set = team override.
    # `is_default` marks the chosen set within a scope (one per (org_id, folder_id)).
    ("studio_templates", "folder_id",       "TEXT"),
    ("studio_templates", "is_default",      "INTEGER NOT NULL DEFAULT 0"),
    # Direct pointers for fast resolution. Kept in sync with `is_default` by the
    # set_default helpers, but cached here so the agent can resolve without
    # scanning every template row.
    ("studio_orgs",      "default_template_set_id", "TEXT"),
    ("studio_folders",   "template_set_id",         "TEXT"),
    # Style profile — chart/table style fingerprints + palette ordering,
    # produced by src/percy/agent/style_extraction.py. Read by codegen and
    # by future agents that want programmatic access to brand specifics.
    ("studio_templates", "style_profile",   "TEXT NOT NULL DEFAULT '{}'"),
    # Builtin flag — distinguishes seeded sets (e.g. Percy Standard) from
    # user-created ones. Builtins are read-only for everyone, visible across
    # all orgs via list_org_templates' UNION.
    ("studio_templates", "is_builtin",      "INTEGER NOT NULL DEFAULT 0"),
    # Auto-demo bookkeeping. Every ref onboarding pipeline ends with a
    # throttled run of the canned demo prompt against this set, creating
    # a real studio_project the user can open. We store the most recent
    # demo's doc_id + project_id here so the editor can surface a
    # "View latest demo" link without polling.
    ("studio_templates", "last_demo_doc_id",     "TEXT"),
    ("studio_templates", "last_demo_project_id", "TEXT"),
    ("studio_templates", "last_demo_at",         "INTEGER"),
    ("studio_templates", "last_demo_summary",    "TEXT NOT NULL DEFAULT '{}'"),
    # Persisted demo slide JSON. After the demo runner generates a deck,
    # we serialize each slide's elements (same shape as the svg-data
    # endpoint) and store them here so the showcase splash survives
    # server restarts without re-running expensive LLM generation. Empty
    # default '[]' means "no demo has been generated yet."
    ("studio_templates", "demo_slides_json",     "TEXT NOT NULL DEFAULT '[]'"),
]


def _column_exists(conn, table: str, col: str) -> bool:
    if _use_postgres():
        row = conn.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
            (table, col),
        ).fetchone()
        return row is not None
    # SQLite: PRAGMA table_info
    raw = conn._conn  # type: ignore[attr-defined]
    rows = raw.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == col for r in rows)

_PERSONAL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
    "live.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
    "protonmail.com", "msn.com", "ymail.com", "verizon.net", "comcast.net",
}


def init_db() -> None:
    """Create the database file (sqlite) or run migrations against pg, idempotent."""
    if not _use_postgres():
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        for sql in _MIGRATIONS_COMMON:
            conn.execute(sql)
        if _use_postgres():
            for sql in _PG_COLUMN_ADDS:
                try:
                    conn.execute(sql)
                except Exception:
                    pass
        # Forward-compat ALTERs (e.g. add columns to existing tables)
        for table, col, coltype in _FORWARD_ADDS:
            try:
                if not _column_exists(conn, table, col):
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
            except Exception:
                pass
    # Seed the always-on Percy Standard Template Set. Safe to call on every
    # boot — idempotent on both the set row and the item links.
    try:
        seed_percy_standard_template_set()
    except Exception as exc:
        log.warning("init_db: seed_percy_standard failed (non-fatal): %s", exc)
    # Seed the showcase demo brand sets (Snowflake / Caterpillar / Salesforce
    # / BlackRock — all extracted from real investor decks via the seeder
    # CLI). Loads `demo_brands/*.json`; idempotent.
    try:
        seed_demo_brand_sets()
    except Exception as exc:
        log.warning("init_db: seed_demo_brand_sets failed (non-fatal): %s", exc)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> int:
    return int(time.time())


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12)}"


def _slugify(s: str) -> str:
    out = []
    for ch in s.lower().strip():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_") and (not out or out[-1] != "-"):
            out.append("-")
    slug = "".join(out).strip("-")
    return slug or "x"


def domain_is_personal(email: str) -> bool:
    domain = email.split("@", 1)[1].lower() if "@" in email else ""
    return domain in _PERSONAL_DOMAINS or not domain


def email_domain(email: str) -> str:
    return email.split("@", 1)[1].lower() if "@" in email else ""


def _lower_email(email: str) -> str:
    return email.lower().strip()


# ── User CRUD ─────────────────────────────────────────────────────────────────

def create_user(
    email: str,
    *,
    password_hash: str | None = None,
    google_sub: str | None = None,
    display_name: str | None = None,
    avatar_url: str | None = None,
) -> dict[str, Any]:
    user_id = _gen_id("usr")
    name = display_name or email.split("@", 1)[0]
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_users (id, email, password_hash, google_sub, display_name, avatar_url, is_admin, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, _lower_email(email), password_hash, google_sub, name, avatar_url, 0, _now()),
        )
    return get_user(user_id) or {}


def get_user(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_users WHERE LOWER(email) = ?", (_lower_email(email),)).fetchone()


def get_user_by_google_sub(sub: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_users WHERE google_sub = ?", (sub,)).fetchone()


def update_user(user_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_user(user_id)
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_users SET {cols} WHERE id = ?", (*fields.values(), user_id))
    return get_user(user_id)


# ── Org CRUD ──────────────────────────────────────────────────────────────────

def create_org(name: str, *, kind: str, domain: str | None = None) -> dict[str, Any]:
    assert kind in ("personal", "team")
    org_id = _gen_id("org")
    base_slug = _slugify(name)
    slug = base_slug
    n = 1
    while get_org_by_slug(slug):
        n += 1
        slug = f"{base_slug}-{n}"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_orgs (id, name, slug, kind, domain, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (org_id, name, slug, kind, domain, _now()),
        )
    return get_org(org_id) or {}


def get_org(org_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_orgs WHERE id = ?", (org_id,)).fetchone()


def get_org_by_slug(slug: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_orgs WHERE LOWER(slug) = ?", (slug.lower(),)).fetchone()


def get_org_by_domain(domain: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_orgs WHERE domain = ? AND kind = ?",
            (domain.lower(), "team"),
        ).fetchone()


def update_org(org_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_org(org_id)
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_orgs SET {cols} WHERE id = ?", (*fields.values(), org_id))
    return get_org(org_id)


# ── Membership ────────────────────────────────────────────────────────────────

def add_membership(user_id: str, org_id: str, role: str) -> None:
    assert role in ("owner", "admin", "member")
    with get_conn() as conn:
        # Skip if already a member
        existing = conn.execute(
            "SELECT 1 FROM studio_memberships WHERE user_id = ? AND org_id = ?",
            (user_id, org_id),
        ).fetchone()
        if existing:
            return
        conn.execute(
            "INSERT INTO studio_memberships (id, user_id, org_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (_gen_id("mem"), user_id, org_id, role, _now()),
        )


def update_membership_role(user_id: str, org_id: str, role: str) -> None:
    assert role in ("owner", "admin", "member")
    with get_conn() as conn:
        conn.execute(
            "UPDATE studio_memberships SET role = ? WHERE user_id = ? AND org_id = ?",
            (role, user_id, org_id),
        )


def remove_membership(user_id: str, org_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM studio_memberships WHERE user_id = ? AND org_id = ?",
            (user_id, org_id),
        )


def list_user_orgs(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT o.*, m.role
            FROM studio_orgs o
            JOIN studio_memberships m ON m.org_id = o.id
            WHERE m.user_id = ?
            ORDER BY o.kind, o.name
            """,
            (user_id,),
        ).fetchall()


def get_membership(user_id: str, org_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_memberships WHERE user_id = ? AND org_id = ?",
            (user_id, org_id),
        ).fetchone()


def list_org_members(org_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, m.role, m.created_at AS joined_at
            FROM studio_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.org_id = ?
            ORDER BY m.created_at
            """,
            (org_id,),
        ).fetchall()


# ── Folders ───────────────────────────────────────────────────────────────────

def create_folder(org_id: str, name: str, parent_id: str | None, created_by: str) -> dict[str, Any]:
    fid = _gen_id("fld")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_folders (id, org_id, parent_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (fid, org_id, parent_id, name, created_by, _now()),
        )
    return get_folder(fid) or {}


def get_folder(folder_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_folders WHERE id = ?", (folder_id,)).fetchone()


def list_org_folders(org_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_folders WHERE org_id = ? ORDER BY name",
            (org_id,),
        ).fetchall()


def rename_folder(folder_id: str, name: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE studio_folders SET name = ? WHERE id = ?", (name, folder_id))


def delete_folder(folder_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_folders WHERE id = ?", (folder_id,))


# ── Projects ──────────────────────────────────────────────────────────────────

def create_project(
    org_id: str,
    name: str,
    *,
    folder_id: str | None = None,
    doc_source: str | None = None,
    created_by: str,
) -> dict[str, Any]:
    pid = _gen_id("prj")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_projects (id, org_id, folder_id, name, doc_source, doc_id, created_by, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
            (pid, org_id, folder_id, name, doc_source, created_by, _now(), _now()),
        )
    return get_project(pid) or {}


def get_project(project_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_projects WHERE id = ?", (project_id,)).fetchone()


def list_org_projects(org_id: str, folder_id: str | None | object = ...) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if folder_id is ...:
            return conn.execute(
                "SELECT * FROM studio_projects WHERE org_id = ? ORDER BY updated_at DESC",
                (org_id,),
            ).fetchall()
        if folder_id is None:
            return conn.execute(
                "SELECT * FROM studio_projects WHERE org_id = ? AND folder_id IS NULL ORDER BY updated_at DESC",
                (org_id,),
            ).fetchall()
        return conn.execute(
            "SELECT * FROM studio_projects WHERE org_id = ? AND folder_id = ? ORDER BY updated_at DESC",
            (org_id, folder_id),
        ).fetchall()


def update_project(project_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_project(project_id)
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_projects SET {cols} WHERE id = ?", (*fields.values(), project_id))
    return get_project(project_id)


def delete_project(project_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_projects WHERE id = ?", (project_id,))


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(user_id: str, ttl_seconds: int = 60 * 60 * 24 * 30) -> str:
    sid = _gen_id("ses")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (sid, user_id, now, now + ttl_seconds),
        )
    return sid


def get_session(session_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_sessions WHERE id = ? AND expires_at > ?",
            (session_id, _now()),
        ).fetchone()


def revoke_session(session_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_sessions WHERE id = ?", (session_id,))


# ── Invites ──────────────────────────────────────────────────────────────────

def create_invite(org_id: str, email: str, role: str, invited_by: str, ttl_days: int = 14) -> dict[str, Any]:
    assert role in ("owner", "admin", "member")
    iid = _gen_id("inv")
    token = secrets.token_urlsafe(24)
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_invites (id, org_id, email, role, token, invited_by, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (iid, org_id, _lower_email(email), role, token, invited_by, now, now + ttl_days * 86400),
        )
    return get_invite(iid) or {}


def get_invite(invite_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_invites WHERE id = ?", (invite_id,)).fetchone()


def get_invite_by_token(token: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_invites WHERE token = ? AND accepted_at IS NULL AND expires_at > ?",
            (token, _now()),
        ).fetchone()


def list_org_invites(org_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
            (org_id, _now()),
        ).fetchall()


def list_pending_invites_for_email(email: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM studio_invites WHERE LOWER(email) = ? AND accepted_at IS NULL AND expires_at > ?",
            (_lower_email(email), _now()),
        ).fetchall()


def mark_invite_accepted(invite_id: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE studio_invites SET accepted_at = ? WHERE id = ?", (_now(), invite_id))


def delete_invite(invite_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_invites WHERE id = ?", (invite_id,))


# ── First-time bootstrap helpers ──────────────────────────────────────────────

def ensure_personal_org_for(user: dict[str, Any]) -> dict[str, Any]:
    """Create (or return) a personal org for this user with owner membership."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT o.*
            FROM studio_orgs o
            JOIN studio_memberships m ON m.org_id = o.id
            WHERE m.user_id = ? AND o.kind = ? AND m.role = ?
            LIMIT 1
            """,
            (user["id"], "personal", "owner"),
        ).fetchone()
    if row:
        return row
    name = f"{user['display_name']}'s workspace"
    org = create_org(name, kind="personal")
    add_membership(user["id"], org["id"], "owner")
    return org


def ensure_team_org_for_domain(domain: str) -> dict[str, Any]:
    """Find or create a team org keyed by email domain."""
    existing = get_org_by_domain(domain)
    if existing:
        return existing
    return create_org(domain.split(".", 1)[0].title(), kind="team", domain=domain.lower())


# ── Builds ───────────────────────────────────────────────────────────────────

import json as _json


def create_build(
    project_id: str, *,
    triggered_by: str | None,
    trigger: str = "manual",
    formats: list[str],
) -> dict[str, Any]:
    bid = _gen_id("bld")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_builds (id, project_id, triggered_by, trigger, status, formats, outputs, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (bid, project_id, triggered_by, trigger, "queued", _json.dumps(formats), "{}", _now()),
        )
    return get_build(bid) or {}


def get_build(build_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_builds WHERE id = ?", (build_id,)).fetchone()
        if not row:
            return None
        # Decode JSON columns
        try: row["formats"] = _json.loads(row["formats"]) if row.get("formats") else []
        except Exception: row["formats"] = []
        try: row["outputs"] = _json.loads(row["outputs"]) if row.get("outputs") else {}
        except Exception: row["outputs"] = {}
        return row


def list_project_builds(project_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_builds WHERE project_id = ? ORDER BY started_at DESC LIMIT ?",
            (project_id, limit),
        ).fetchall()
    out = []
    for r in rows:
        try: r["formats"] = _json.loads(r["formats"]) if r.get("formats") else []
        except Exception: r["formats"] = []
        try: r["outputs"] = _json.loads(r["outputs"]) if r.get("outputs") else {}
        except Exception: r["outputs"] = {}
        out.append(r)
    return out


def update_build(build_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_build(build_id)
    # JSON-encode the outputs dict if present
    if "outputs" in fields and not isinstance(fields["outputs"], str):
        fields["outputs"] = _json.dumps(fields["outputs"])
    if "formats" in fields and not isinstance(fields["formats"], str):
        fields["formats"] = _json.dumps(fields["formats"])
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_builds SET {cols} WHERE id = ?", (*fields.values(), build_id))
    return get_build(build_id)


# ── Templates ────────────────────────────────────────────────────────────────

def _decode_template(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    try: row["brand"] = _json.loads(row["brand"]) if row.get("brand") else {}
    except Exception: row["brand"] = {}
    try: row["source_project_ids"] = _json.loads(row["source_project_ids"]) if row.get("source_project_ids") else []
    except Exception: row["source_project_ids"] = []
    # New Template-Set fields. Defaults handle pre-migration rows that won't
    # have these columns yet (older Postgres deployments).
    try: row["palette"] = _json.loads(row.get("palette") or "[]")
    except Exception: row["palette"] = []
    try: row["fonts"] = _json.loads(row.get("fonts") or "[]")
    except Exception: row["fonts"] = []
    try: row["style_rules"] = _json.loads(row.get("style_rules") or "{}")
    except Exception: row["style_rules"] = {}
    row["instructions_md"] = row.get("instructions_md") or ""
    row["folder_id"] = row.get("folder_id") or None
    row["is_default"] = bool(row.get("is_default") or 0)
    row["is_builtin"] = bool(row.get("is_builtin") or 0)
    # Style profile — defaults to empty dict so callers can do
    # `tpl["style_profile"].get("chart_styles", [])` without a None check.
    try: row["style_profile"] = _json.loads(row.get("style_profile") or "{}")
    except Exception: row["style_profile"] = {}
    # Auto-demo bookkeeping (defaults preserve None for "never run").
    try: row["last_demo_summary"] = _json.loads(row.get("last_demo_summary") or "{}")
    except Exception: row["last_demo_summary"] = {}
    try: row["demo_slides_json"] = _json.loads(row.get("demo_slides_json") or "[]")
    except Exception: row["demo_slides_json"] = []
    return row


def create_template(
    org_id: str, *,
    scope: str,
    owner_id: str,
    name: str,
    description: str | None = None,
    folder_id: str | None = None,
    is_default: bool = False,
) -> dict[str, Any]:
    """Create a new template set.

    `folder_id` pins this set to a folder (team override); None = org-wide.
    `is_default` marks it as the active set for its scope. Only one default
    per (org_id, folder_id) is enforced by set_default_template_set().
    """
    assert scope in ("user", "team", "org")
    tid = _gen_id("tpl")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO studio_templates
              (id, org_id, scope, owner_id, name, description, brand, source_project_ids,
               instructions_md, palette, fonts, style_rules, folder_id, is_default,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?)
            """,
            (tid, org_id, scope, owner_id, name, description, "{}", "[]",
             "", "[]", "[]", "{}", folder_id, 1 if is_default else 0,
             now, now),
        )
    if is_default:
        # Promote in a transactional follow-up so unique-default invariant holds.
        set_default_template_set(tid, org_id=org_id, folder_id=folder_id)
    return get_template(tid) or {}


def get_template(template_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_templates WHERE id = ?", (template_id,)).fetchone()
    return _decode_template(row)


def list_org_templates(org_id: str, *, viewer_id: str) -> list[dict[str, Any]]:
    """Templates visible to the viewer in the given org. team/org scope visible to all
    org members; user scope only to its owner. Builtin sets (is_builtin=1)
    are returned for every viewer regardless of org_id — they're the
    "shipped with Percy" libraries (e.g. Percy Standard)."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM studio_templates
            WHERE (org_id = ? AND
                   (scope IN ('team', 'org') OR (scope = 'user' AND owner_id = ?)))
               OR is_builtin = 1
            ORDER BY is_builtin DESC, updated_at DESC
            """,
            (org_id, viewer_id),
        ).fetchall()
    return [d for d in (_decode_template(r) for r in rows) if d]


_TEMPLATE_JSON_FIELDS = ("brand", "source_project_ids", "palette", "fonts", "style_rules", "style_profile", "last_demo_summary", "demo_slides_json")


def update_template(template_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_template(template_id)
    for k in _TEMPLATE_JSON_FIELDS:
        if k in fields and not isinstance(fields[k], str):
            fields[k] = _json.dumps(fields[k])
    if "is_default" in fields:
        fields["is_default"] = 1 if fields["is_default"] else 0
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_templates SET {cols} WHERE id = ?", (*fields.values(), template_id))
    return get_template(template_id)


def delete_template(template_id: str) -> None:
    with get_conn() as conn:
        # Cascade: drop items and refs first. We do this manually because the
        # cross-DB nature (agent templates live elsewhere) means no FK to lean on.
        conn.execute("DELETE FROM studio_template_set_items WHERE set_id = ?", (template_id,))
        conn.execute("DELETE FROM studio_template_set_refs  WHERE set_id = ?", (template_id,))
        # Clear pointers from orgs/folders that defaulted to this set.
        conn.execute(
            "UPDATE studio_orgs    SET default_template_set_id = NULL WHERE default_template_set_id = ?",
            (template_id,),
        )
        conn.execute(
            "UPDATE studio_folders SET template_set_id = NULL WHERE template_set_id = ?",
            (template_id,),
        )
        conn.execute("DELETE FROM studio_templates WHERE id = ?", (template_id,))


# ── Template Set defaults + resolution walk ─────────────────────────────────

def set_default_template_set(
    template_id: str,
    *,
    org_id: str,
    folder_id: str | None = None,
) -> dict[str, Any] | None:
    """Promote `template_id` to be the active default for its scope.

    Scope is keyed by (org_id, folder_id). Demotes any other set previously
    flagged for the same scope so the resolution walk has a deterministic
    answer. Mirrors the choice into `studio_orgs.default_template_set_id` or
    `studio_folders.template_set_id` for fast resolution without scanning.
    """
    with get_conn() as conn:
        # Demote siblings in the same scope.
        if folder_id is None:
            conn.execute(
                "UPDATE studio_templates SET is_default = 0 "
                "WHERE org_id = ? AND folder_id IS NULL AND id <> ?",
                (org_id, template_id),
            )
            conn.execute(
                "UPDATE studio_orgs SET default_template_set_id = ? WHERE id = ?",
                (template_id, org_id),
            )
        else:
            conn.execute(
                "UPDATE studio_templates SET is_default = 0 "
                "WHERE folder_id = ? AND id <> ?",
                (folder_id, template_id),
            )
            conn.execute(
                "UPDATE studio_folders SET template_set_id = ? WHERE id = ?",
                (template_id, folder_id),
            )
        conn.execute(
            "UPDATE studio_templates SET is_default = 1, folder_id = ?, updated_at = ? WHERE id = ?",
            (folder_id, _now(), template_id),
        )
    return get_template(template_id)


def clear_default_template_set(*, org_id: str | None = None, folder_id: str | None = None) -> None:
    """Remove the default-set pointer for an org or a folder. The template set
    itself is preserved; just no longer the active one. Falls back to parent
    inheritance on the next resolution.
    """
    with get_conn() as conn:
        if folder_id is not None:
            conn.execute(
                "UPDATE studio_folders SET template_set_id = NULL WHERE id = ?",
                (folder_id,),
            )
            conn.execute(
                "UPDATE studio_templates SET is_default = 0 WHERE folder_id = ?",
                (folder_id,),
            )
        elif org_id is not None:
            conn.execute(
                "UPDATE studio_orgs SET default_template_set_id = NULL WHERE id = ?",
                (org_id,),
            )
            conn.execute(
                "UPDATE studio_templates SET is_default = 0 "
                "WHERE org_id = ? AND folder_id IS NULL",
                (org_id,),
            )


def resolve_active_template_set(*, project_id: str | None = None, folder_id: str | None = None,
                                 org_id: str | None = None) -> dict[str, Any] | None:
    """Walk the folder chain to find the first template set that applies.

    Resolution order:
      1. Start at the project's folder (or `folder_id` if provided directly).
      2. Walk up `parent_id` until a folder has `template_set_id` set.
      3. Fall back to the org's `default_template_set_id`.
      4. Return None if no set is configured anywhere.

    Returns the full decoded template-set row (with brand, palette, fonts,
    style_rules, instructions_md), or None.
    """
    target_org_id = org_id
    target_folder_id = folder_id

    if project_id and not target_folder_id:
        project = get_project(project_id)
        if not project:
            return None
        target_org_id = target_org_id or project.get("org_id")
        target_folder_id = project.get("folder_id")

    # Walk the folder chain up.
    visited: set[str] = set()
    with get_conn() as conn:
        current_id = target_folder_id
        while current_id and current_id not in visited:
            visited.add(current_id)
            row = conn.execute(
                "SELECT id, parent_id, org_id, template_set_id FROM studio_folders WHERE id = ?",
                (current_id,),
            ).fetchone()
            if not row:
                break
            if row.get("template_set_id"):
                tpl = get_template(row["template_set_id"])
                if tpl:
                    return tpl
            if not target_org_id:
                target_org_id = row.get("org_id")
            current_id = row.get("parent_id")

        # Org default fallback.
        if target_org_id:
            org_row = conn.execute(
                "SELECT default_template_set_id FROM studio_orgs WHERE id = ?",
                (target_org_id,),
            ).fetchone()
            if org_row and org_row.get("default_template_set_id"):
                return get_template(org_row["default_template_set_id"])

    return None


# ── Template Set items (slide + element templates in the set) ───────────────

def add_template_set_item(
    set_id: str,
    template_id: str,
    *,
    kind: str,
    order_index: int = 0,
    added_by: str | None = None,
    provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Add a slide or element template to a set. Idempotent on (set_id, template_id):
    re-adding updates kind / order_index / provenance rather than erroring."""
    assert kind in ("slide", "element")
    now = _now()
    prov_json = _json.dumps(provenance or {})
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM studio_template_set_items WHERE set_id = ? AND template_id = ?",
            (set_id, template_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE studio_template_set_items SET kind = ?, order_index = ?, provenance = ? "
                "WHERE set_id = ? AND template_id = ?",
                (kind, order_index, prov_json, set_id, template_id),
            )
        else:
            conn.execute(
                "INSERT INTO studio_template_set_items "
                "(set_id, template_id, kind, order_index, provenance, added_by, added_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (set_id, template_id, kind, order_index, prov_json, added_by, now),
            )
        # Bump parent set's updated_at so list orderings stay sane.
        conn.execute("UPDATE studio_templates SET updated_at = ? WHERE id = ?", (now, set_id))
    return {"set_id": set_id, "template_id": template_id, "kind": kind, "order_index": order_index}


def remove_template_set_item(set_id: str, template_id: str) -> bool:
    """Detect existence before deleting so we can return a reliable bool —
    the connection adapter doesn't surface rowcount."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM studio_template_set_items WHERE set_id = ? AND template_id = ?",
            (set_id, template_id),
        ).fetchone()
        if not existing:
            return False
        conn.execute(
            "DELETE FROM studio_template_set_items WHERE set_id = ? AND template_id = ?",
            (set_id, template_id),
        )
        conn.execute("UPDATE studio_templates SET updated_at = ? WHERE id = ?", (_now(), set_id))
    return True


def list_template_set_items(set_id: str, *, kind: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM studio_template_set_items WHERE set_id = ?"
    params: list[Any] = [set_id]
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    sql += " ORDER BY order_index ASC, added_at ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    out = []
    for r in rows:
        try: r["provenance"] = _json.loads(r.get("provenance") or "{}")
        except Exception: r["provenance"] = {}
        out.append(r)
    return out


def reorder_template_set_items(set_id: str, ordered_template_ids: list[str]) -> None:
    """Reassign order_index based on the given ordering. Items not in the list
    are pushed to the end in their original relative order."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT template_id FROM studio_template_set_items WHERE set_id = ?",
            (set_id,),
        ).fetchall()
        existing_ids = {r["template_id"] for r in existing}
        idx = 0
        for tid in ordered_template_ids:
            if tid in existing_ids:
                conn.execute(
                    "UPDATE studio_template_set_items SET order_index = ? "
                    "WHERE set_id = ? AND template_id = ?",
                    (idx, set_id, tid),
                )
                idx += 1
        # Append untouched items at the tail keeping their old order.
        for r in existing:
            if r["template_id"] not in ordered_template_ids:
                conn.execute(
                    "UPDATE studio_template_set_items SET order_index = ? "
                    "WHERE set_id = ? AND template_id = ?",
                    (idx, set_id, r["template_id"]),
                )
                idx += 1
        conn.execute("UPDATE studio_templates SET updated_at = ? WHERE id = ?", (_now(), set_id))


# ── Template Set reference documents (mining sources) ───────────────────────

def create_template_set_ref(
    set_id: str, *,
    filename: str,
    mime_type: str | None,
    size_bytes: int,
    storage_key: str,
    uploaded_by: str,
    doc_id: str | None = None,
    status: str = "uploaded",
) -> dict[str, Any]:
    rid = _gen_id("ref")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_template_set_refs "
            "(id, set_id, filename, mime_type, size_bytes, storage_key, doc_id, "
            " status, uploaded_by, uploaded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rid, set_id, filename, mime_type, size_bytes, storage_key, doc_id,
             status, uploaded_by, now),
        )
    return get_template_set_ref(rid) or {}


def update_template_set_ref(ref_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_template_set_ref(ref_id)
    if "status" in fields and fields["status"] == "ready" and "onboarded_at" not in fields:
        fields["onboarded_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_template_set_refs SET {cols} WHERE id = ?",
                     (*fields.values(), ref_id))
    return get_template_set_ref(ref_id)


def get_template_set_ref(ref_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_template_set_refs WHERE id = ?", (ref_id,)).fetchone()
    return row


def list_template_set_refs(set_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_template_set_refs WHERE set_id = ? ORDER BY uploaded_at DESC",
            (set_id,),
        ).fetchall()
    return rows


def get_project_by_doc_id(doc_id: str) -> dict[str, Any] | None:
    """Find a project whose `doc_id` column matches. Used by the agent to
    resolve which project (and therefore which active template set) owns the
    deck the user is editing."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE doc_id = ? LIMIT 1",
            (doc_id,),
        ).fetchone()
    return row


PERCY_STANDARD_SET_ID = "tpl_percy_standard_v1"
PERCY_STANDARD_OWNER_ID = "__system__"
PERCY_STANDARD_ORG_ID = "__percy_system__"


def seed_percy_standard_template_set() -> dict[str, Any] | None:
    """Idempotently seed the Percy Standard Template Set.

    Owns no real org — uses the sentinel "__percy_system__" so list queries
    that filter by org still find it via the is_builtin=1 union branch.
    Links every Template from src/percy/agent/standard_templates.py (slide
    AND element kinds, distinguished by id prefix `std.el.`) as set items.

    Safe to call on every boot — the set's row is created with a fixed id;
    item links use INSERT ... WHERE NOT EXISTS so duplicates can't happen.
    """
    # The agent templates SQLite owns the actual Template rows. Seed them
    # first so their ids exist; then create / refresh the linkage.
    try:
        from percy.agent import templates as _agent_tpls
        _agent_tpls.init_db()
    except Exception as exc:
        log.warning("seed_percy_standard: agent templates init failed: %s", exc)
        return None

    from percy.agent.standard_templates import STANDARD_TEMPLATES

    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM studio_templates WHERE id = ?",
            (PERCY_STANDARD_SET_ID,),
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO studio_templates (
                    id, org_id, scope, owner_id, name, description,
                    brand, source_project_ids,
                    instructions_md, palette, fonts, style_rules,
                    folder_id, is_default, is_builtin,
                    style_profile,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    PERCY_STANDARD_SET_ID, PERCY_STANDARD_ORG_ID, "org",
                    PERCY_STANDARD_OWNER_ID,
                    "Percy Standard",
                    "Percy's exhaustive built-in library: 15 slide layouts + 12 reusable element templates. "
                    "Warm cream + powder cobalt brand. Available to every workspace.",
                    "{}", "[]",
                    _PERCY_STANDARD_INSTRUCTIONS,
                    _json.dumps(_PERCY_STANDARD_PALETTE),
                    _json.dumps(_PERCY_STANDARD_FONTS),
                    _json.dumps(_PERCY_STANDARD_STYLE_RULES),
                    None, 0, 1,
                    "{}",
                    now, now,
                ),
            )
            log.info("seed_percy_standard: created Percy Standard set %s", PERCY_STANDARD_SET_ID)
        else:
            # Refresh curated brand fields in case we tweaked them in source.
            conn.execute(
                """
                UPDATE studio_templates SET
                  instructions_md = ?, palette = ?, fonts = ?, style_rules = ?,
                  is_builtin = 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    _PERCY_STANDARD_INSTRUCTIONS,
                    _json.dumps(_PERCY_STANDARD_PALETTE),
                    _json.dumps(_PERCY_STANDARD_FONTS),
                    _json.dumps(_PERCY_STANDARD_STYLE_RULES),
                    now, PERCY_STANDARD_SET_ID,
                ),
            )

        # Link every standard template (idempotent). The agent-templates layer
        # seeds the actual Template rows on its own init; ids match the agent
        # ids exactly so a join works.
        for idx, tpl in enumerate(STANDARD_TEMPLATES):
            kind = "element" if tpl.id.startswith("std.el.") else "slide"
            already = conn.execute(
                "SELECT 1 FROM studio_template_set_items WHERE set_id = ? AND template_id = ?",
                (PERCY_STANDARD_SET_ID, tpl.id),
            ).fetchone()
            if not already:
                conn.execute(
                    "INSERT INTO studio_template_set_items "
                    "(set_id, template_id, kind, order_index, provenance, added_by, added_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (PERCY_STANDARD_SET_ID, tpl.id, kind, idx,
                     "{}", PERCY_STANDARD_OWNER_ID, now),
                )
    return get_template(PERCY_STANDARD_SET_ID)


_PERCY_STANDARD_PALETTE = [
    {"name": "ink",       "hex": "#F9F8F4", "role": "background"},
    {"name": "surface",   "hex": "#FEFDFA", "role": "neutral"},
    {"name": "paper",     "hex": "#2A2F3A", "role": "text"},
    {"name": "muted",     "hex": "#6A6F7A", "role": "neutral"},
    {"name": "cobalt",    "hex": "#7DA1CC", "role": "primary"},
    {"name": "cobalt-lt", "hex": "#A4BEDC", "role": "accent"},
    {"name": "sage",      "hex": "#6FA17A", "role": "secondary"},
    {"name": "cream",     "hex": "#F0E6D8", "role": "highlight"},
    {"name": "ochre",     "hex": "#C5994A", "role": "warning"},
    {"name": "brick",     "hex": "#B8634F", "role": "danger"},
]

_PERCY_STANDARD_FONTS = [
    {"name": "Inter",          "role": "heading", "fallbacks": ["system-ui", "sans-serif"]},
    {"name": "Inter",          "role": "body",    "fallbacks": ["system-ui", "sans-serif"]},
    {"name": "JetBrains Mono", "role": "mono",    "fallbacks": ["Fira Code", "monospace"]},
]

_PERCY_STANDARD_STYLE_RULES = {
    "max_title_length": 70,
    "capitalization": "sentence",       # Sentence case in body, Title in eyebrows
    "palette_tolerance": 0.08,          # Tight — we know our hex values
    "lock_to_palette": False,
    "number_format": "{:,.0f}",
}

def seed_demo_brand_sets() -> None:
    """Idempotently seed demo Template Sets from `demo_brands/*.json` snapshots.

    Two file kinds in `demo_brands/`:
      * `<slug>.json`         — the template set itself (palette, fonts,
                                items). Generated by scripts/seed_demo_brand.py.
      * `<slug>.demo.json`    — a generated demo deck for that set (the
                                persisted slide JSON). Generated by
                                scripts/generate_showcase_demos.py. Stamped
                                onto studio_templates.demo_slides_json so
                                the showcase API serves it directly with no
                                runtime LLM call.

    Re-runnable on every boot — adds missing rows, refreshes the curated
    fields on rows that already exist. Item linkage is also idempotent.
    """
    import json as _json
    from pathlib import Path as _P

    snapshots_dir = _P(__file__).resolve().parents[2] / "demo_brands"
    if not snapshots_dir.exists():
        return

    try:
        from percy.agent import templates as _agent_tpls
        _agent_tpls.init_db()
    except Exception as exc:
        log.warning("seed_demo_brand_sets: agent templates init failed: %s", exc)
        return

    # First: seed the brand-set snapshots (palette + items).
    for snapshot_path in sorted(snapshots_dir.glob("*.json")):
        if snapshot_path.name.endswith(".demo.json"):
            continue
        try:
            snapshot = _json.loads(snapshot_path.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("seed_demo_brand_sets: could not read %s: %s", snapshot_path, exc)
            continue
        _seed_one_demo_brand(snapshot)

    # Second: stamp pre-baked demo decks onto their sets.
    for demo_path in sorted(snapshots_dir.glob("*.demo.json")):
        try:
            demo = _json.loads(demo_path.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("seed_demo_brand_sets: could not read %s: %s", demo_path, exc)
            continue
        set_id = demo.get("set_id")
        slides = demo.get("demo_slides_json") or []
        if not set_id or not slides:
            continue
        # Only stamp if the set exists AND it doesn't already have a demo
        # — preserves anything that's been regenerated post-deploy.
        existing = get_template(set_id)
        if not existing:
            log.info("seed_demo_brand_sets: skipping demo %s — set %s not found",
                     demo_path.name, set_id)
            continue
        if existing.get("demo_slides_json"):
            log.info("seed_demo_brand_sets: skipping demo %s — set already has %d slides",
                     demo_path.name, len(existing.get("demo_slides_json") or []))
            continue
        update_template(
            set_id,
            demo_slides_json=slides,
            last_demo_summary=demo.get("summary") or {},
            last_demo_at=int(demo.get("generated_at") or 0),
            last_demo_doc_id=None,        # in-memory doc isn't on this server
            last_demo_project_id=None,    # no project — the snapshot IS the deck
        )
        log.info("seed_demo_brand_sets: stamped %d slides onto %s from %s",
                 len(slides), set_id, demo_path.name)


def _seed_one_demo_brand(snapshot: dict[str, Any]) -> None:
    """Apply one snapshot. Called from seed_demo_brand_sets per snapshot file."""
    import json as _json
    from percy.agent import templates as _agent_tpls
    from percy.agent.templates import Template as _AgentTpl

    slug = snapshot.get("slug")
    if not slug:
        return
    set_id = f"tpl_demo_{slug}"
    display_name = snapshot.get("display_name") or slug.title()
    now = _now()

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM studio_templates WHERE id = ?", (set_id,),
        ).fetchone()
        cols = dict(
            org_id=PERCY_STANDARD_ORG_ID,
            scope="org",
            owner_id=PERCY_STANDARD_OWNER_ID,
            name=display_name,
            description=snapshot.get("description") or "",
            brand=_json.dumps(snapshot.get("brand") or {}),
            source_project_ids="[]",
            instructions_md=snapshot.get("instructions_md") or "",
            palette=_json.dumps(snapshot.get("palette") or []),
            fonts=_json.dumps(snapshot.get("fonts") or []),
            style_rules=_json.dumps(snapshot.get("style_rules") or {}),
            folder_id=None,
            is_default=0,
            is_builtin=1,
            style_profile=_json.dumps(snapshot.get("style_profile") or {}),
            updated_at=now,
        )
        if existing:
            set_clause = ", ".join(f"{k} = ?" for k in cols)
            conn.execute(
                f"UPDATE studio_templates SET {set_clause} WHERE id = ?",
                (*cols.values(), set_id),
            )
        else:
            cols["id"] = set_id
            cols["created_at"] = now
            ordered_cols = [
                "id", "org_id", "scope", "owner_id", "name", "description",
                "brand", "source_project_ids", "instructions_md", "palette",
                "fonts", "style_rules", "folder_id", "is_default", "is_builtin",
                "style_profile", "created_at", "updated_at",
            ]
            placeholders = ", ".join(["?"] * len(ordered_cols))
            conn.execute(
                f"INSERT INTO studio_templates ({', '.join(ordered_cols)}) "
                f"VALUES ({placeholders})",
                tuple(cols[k] for k in ordered_cols),
            )
            log.info("seed_demo_brand_sets: created %s (%s)", set_id, display_name)

        # ── Items: import each underlying agent template + link it ──
        for idx, item in enumerate(snapshot.get("items") or []):
            template_data = item.get("template") or {}
            template_id = template_data.get("id")
            if not template_id:
                continue
            # Recreate the agent template if not present.
            if not _agent_tpls.get_template(template_id):
                try:
                    t = _AgentTpl(
                        id=template_id,
                        name=template_data.get("name") or template_id,
                        description=template_data.get("description") or "",
                        category=template_data.get("category") or f"Demo:{slug}",
                        tags=list(template_data.get("tags") or []),
                        inputs_schema=dict(template_data.get("inputs_schema") or {}),
                        sample_inputs=dict(template_data.get("sample_inputs") or {}),
                        layout=list(template_data.get("layout") or []),
                        slide_script=template_data.get("slide_script"),
                        connects=dict(template_data.get("connects") or {}),
                        is_builtin=True,
                    )
                    _agent_tpls.save_template(t)
                except Exception as exc:
                    log.warning("seed_demo_brand: could not save agent template %s: %s",
                                template_id, exc)
                    continue
            # Link to set (idempotent).
            already = conn.execute(
                "SELECT 1 FROM studio_template_set_items "
                "WHERE set_id = ? AND template_id = ?",
                (set_id, template_id),
            ).fetchone()
            if not already:
                conn.execute(
                    "INSERT INTO studio_template_set_items "
                    "(set_id, template_id, kind, order_index, provenance, added_by, added_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (set_id, template_id, item.get("kind") or "slide",
                     int(item.get("order_index") or idx),
                     _json.dumps(item.get("provenance") or {}),
                     PERCY_STANDARD_OWNER_ID, now),
                )


_PERCY_STANDARD_INSTRUCTIONS = """\
# Percy voice

* **Lead with the metric.** Numbers belong above prose. If a slide has a
  KPI, surface the value before the explanation.
* **Sentence case** in headings and body. Title Case is reserved for
  eyebrow / kicker labels in small caps.
* **Em-dashes** for bullets, not bullets. Two-space gap after the dash.
* **Cobalt for emphasis**, not decoration. Accent rules signal "this is
  what matters." Avoid red unless you mean it (it means *bad*).
* **JetBrains Mono for numbers**, especially KPI values. The slight
  technical feel is part of the brand.
* **Cream cards** for content blocks; never pure white on the warm-cream
  background.
* **No clip art, no stock photography placeholders.** Use diagrams,
  screenshots, or text.

## When generating decks

1. Start with `std.title`. Always give it a subtitle and a presenter line.
2. Use `std.section_header` between thematic blocks (max 4 in a deck).
3. Prefer `std.big_number` over a chart when the story is a single
   metric.
4. Use `std.chart_focus` (one chart + takeaway) over multi-chart slides.
5. End every deck with `std.closing` — never trail off with a body slide.
"""


def delete_template_set_ref(ref_id: str) -> bool:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM studio_template_set_refs WHERE id = ?",
            (ref_id,),
        ).fetchone()
        if not existing:
            return False
        conn.execute("DELETE FROM studio_template_set_refs WHERE id = ?", (ref_id,))
    return True


# ── Team environments ───────────────────────────────────────────────────────

def _decode_team_env(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    try: row["env_vars"] = _json.loads(row["env_vars"]) if row.get("env_vars") else {}
    except Exception: row["env_vars"] = {}
    # Mask the token from any read; callers that need it use get_team_env_secret.
    if row.get("package_index_token"):
        row["package_index_token_set"] = True
    row.pop("package_index_token", None)
    return row


def create_team_env(org_id: str, *, name: str, created_by: str) -> dict[str, Any]:
    eid = _gen_id("env")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_team_envs (id, org_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (eid, org_id, name, created_by, now, now),
        )
    return get_team_env(eid) or {}


def get_team_env(env_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_team_envs WHERE id = ?", (env_id,)).fetchone()
    return _decode_team_env(row)


def get_team_env_secret(env_id: str) -> dict[str, Any] | None:
    """Read includes the package_index_token. Use only inside the build worker."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_team_envs WHERE id = ?", (env_id,)).fetchone()
    if not row: return None
    try: row["env_vars"] = _json.loads(row["env_vars"]) if row.get("env_vars") else {}
    except Exception: row["env_vars"] = {}
    return row


def list_org_team_envs(org_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_team_envs WHERE org_id = ? ORDER BY updated_at DESC",
            (org_id,),
        ).fetchall()
    return [d for d in (_decode_team_env(r) for r in rows) if d]


def update_team_env(env_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_team_env(env_id)
    if "env_vars" in fields and not isinstance(fields["env_vars"], str):
        fields["env_vars"] = _json.dumps(fields["env_vars"])
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_team_envs SET {cols} WHERE id = ?", (*fields.values(), env_id))
    return get_team_env(env_id)


def delete_team_env(env_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_team_envs WHERE id = ?", (env_id,))


# ── Refresh jobs ─────────────────────────────────────────────────────────────

_SCHEDULE_INTERVALS = {
    "hourly":  3600,
    "daily":   86400,
    "weekly":  604800,
    "monthly": 2592000,  # 30 days, close enough for v1
}


def _next_run_for(schedule: str, *, after: int | None = None) -> int | None:
    if schedule in (None, "", "on_demand"):
        return None
    base = after if after is not None else _now()
    interval = _SCHEDULE_INTERVALS.get(schedule)
    if interval is None:
        return None
    return base + interval


def _decode_refresh_job(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row: return None
    try: row["extra_env"] = _json.loads(row["extra_env"]) if row.get("extra_env") else {}
    except Exception: row["extra_env"] = {}
    row["enabled"] = bool(row.get("enabled"))
    return row


def create_refresh_job(project_id: str, *, schedule: str, env_id: str | None = None,
                       entry_point: str = "refresh.py", script_source: str = "",
                       extra_env: dict | None = None) -> dict[str, Any]:
    jid = _gen_id("job")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_refresh_jobs (id, project_id, env_id, schedule, entry_point, script_source, extra_env, enabled, next_run_at, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
            (jid, project_id, env_id, schedule, entry_point, script_source,
             _json.dumps(extra_env or {}), _next_run_for(schedule), now, now),
        )
    return get_refresh_job(jid) or {}


def get_refresh_job(job_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_refresh_jobs WHERE id = ?", (job_id,)).fetchone()
    return _decode_refresh_job(row)


def get_project_refresh_job(project_id: str) -> dict[str, Any] | None:
    """A project has at most one refresh job in v1."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM studio_refresh_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
    return _decode_refresh_job(row)


def update_refresh_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_refresh_job(job_id)
    if "extra_env" in fields and not isinstance(fields["extra_env"], str):
        fields["extra_env"] = _json.dumps(fields["extra_env"])
    if "enabled" in fields:
        fields["enabled"] = 1 if fields["enabled"] else 0
    if "schedule" in fields:
        fields["next_run_at"] = _next_run_for(fields["schedule"])
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_refresh_jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))
    return get_refresh_job(job_id)


def delete_refresh_job(job_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_refresh_jobs WHERE id = ?", (job_id,))


def list_due_refresh_jobs(now: int | None = None) -> list[dict[str, Any]]:
    cutoff = now if now is not None else _now()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_refresh_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
            (cutoff,),
        ).fetchall()
    return [d for d in (_decode_refresh_job(r) for r in rows) if d]


def mark_refresh_job_ran(job_id: str, *, status: str, error: str | None = None) -> None:
    job = get_refresh_job(job_id)
    if not job: return
    next_run = _next_run_for(job["schedule"])
    with get_conn() as conn:
        conn.execute(
            "UPDATE studio_refresh_jobs SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
            (_now(), status, error, next_run, _now(), job_id),
        )


# ── Refresh runs ─────────────────────────────────────────────────────────────

def create_refresh_run(job_id: str, project_id: str) -> dict[str, Any]:
    rid = _gen_id("run")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_refresh_runs (id, job_id, project_id, started_at, status) VALUES (?, ?, ?, ?, 'running')",
            (rid, job_id, project_id, _now()),
        )
    return get_refresh_run(rid) or {}


def get_refresh_run(run_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_refresh_runs WHERE id = ?", (run_id,)).fetchone()
    return row


def update_refresh_run(run_id: str, **fields: Any) -> None:
    if not fields: return
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_refresh_runs SET {cols} WHERE id = ?", (*fields.values(), run_id))


# ── Eval results (async via worker) ──────────────────────────────────────────

def create_eval_result(env_id: str, *, user_id: str | None = None) -> dict[str, Any]:
    rid = _gen_id("ev")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_eval_results (id, env_id, user_id, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
            (rid, env_id, user_id, _now()),
        )
    return get_eval_result(rid) or {}


def get_eval_result(eval_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_eval_results WHERE id = ?", (eval_id,)).fetchone()
    return row


def update_eval_result(eval_id: str, **fields: Any) -> None:
    if not fields: return
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE studio_eval_results SET {cols} WHERE id = ?", (*fields.values(), eval_id))


def list_project_refresh_runs(project_id: str, *, limit: int = 25) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_refresh_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?",
            (project_id, limit),
        ).fetchall()
    return [r for r in rows if r]


# ── Email verification ────────────────────────────────────────────────────────

def create_email_verification(user_id: str, ttl: int = 86400) -> dict[str, Any]:
    now = _now()
    vid = _gen_id("ev")
    token = secrets.token_urlsafe(32)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_email_verifications (id, user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (vid, user_id, token, now, now + ttl),
        )
    return {"id": vid, "user_id": user_id, "token": token, "expires_at": now + ttl}


def get_email_verification_by_token(token: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_email_verifications WHERE token = ?", (token,)).fetchone()


def mark_email_verification_used(vid: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE studio_email_verifications SET used_at = ? WHERE id = ?", (_now(), vid))


# ── Password reset ────────────────────────────────────────────────────────────

def create_password_reset(user_id: str, ttl: int = 3600) -> dict[str, Any]:
    now = _now()
    rid = _gen_id("pr")
    token = secrets.token_urlsafe(32)
    with get_conn() as conn:
        # Invalidate any existing unused tokens for this user
        conn.execute(
            "UPDATE studio_password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (now, user_id),
        )
        conn.execute(
            "INSERT INTO studio_password_resets (id, user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (rid, user_id, token, now, now + ttl),
        )
    return {"id": rid, "user_id": user_id, "token": token, "expires_at": now + ttl}


def get_password_reset_by_token(token: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_password_resets WHERE token = ?", (token,)).fetchone()


def mark_password_reset_used(rid: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE studio_password_resets SET used_at = ? WHERE id = ?", (_now(), rid))


# ── User settings ─────────────────────────────────────────────────────────────

def get_user_settings(user_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_user_settings WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {
            "user_id": user_id, "theme": "light", "locale": "en",
            "notifications": {}, "default_org_id": None, "panel_states": {},
        }
    import json
    return {
        "user_id": row["user_id"],
        "theme": row["theme"],
        "locale": row["locale"],
        "notifications": json.loads(row["notifications"] or "{}"),
        "default_org_id": row.get("default_org_id"),
        "panel_states": json.loads(row["panel_states"] or "{}"),
    }


def upsert_user_settings(user_id: str, **fields: Any) -> dict[str, Any]:
    import json
    allowed = {"theme", "locale", "notifications", "default_org_id", "panel_states"}
    clean: dict[str, Any] = {}
    for k, v in fields.items():
        if k in allowed:
            clean[k] = json.dumps(v) if isinstance(v, dict) else v
    clean["updated_at"] = _now()
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM studio_user_settings WHERE user_id = ?", (user_id,)).fetchone()
        if exists:
            cols = ", ".join(f"{k} = ?" for k in clean)
            conn.execute(f"UPDATE studio_user_settings SET {cols} WHERE user_id = ?", (*clean.values(), user_id))
        else:
            clean["user_id"] = user_id
            cols = ", ".join(clean.keys())
            placeholders = ", ".join("?" * len(clean))
            conn.execute(f"INSERT INTO studio_user_settings ({cols}) VALUES ({placeholders})", tuple(clean.values()))
    return get_user_settings(user_id)


# ── Project shares ────────────────────────────────────────────────────────────

def create_project_share(project_id: str, created_by: str, *, grantee_id: str | None = None, role: str = "viewer", ttl: int | None = None) -> dict[str, Any]:
    sid = _gen_id("sh")
    token = secrets.token_urlsafe(24) if not grantee_id else None
    expires_at = _now() + ttl if ttl else None
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_project_shares (id, project_id, grantee_id, share_token, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, project_id, grantee_id, token, role, created_by, _now(), expires_at),
        )
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_project_shares WHERE id = ?", (sid,)).fetchone() or {}


def list_project_shares(project_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_project_shares WHERE project_id = ?", (project_id,)).fetchall()


def get_project_share_by_token(token: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_project_shares WHERE share_token = ?", (token,)).fetchone()


def delete_project_share(share_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_project_shares WHERE id = ?", (share_id,))


def check_project_access(user_id: str, project_id: str) -> str | None:
    """Return the user's role for a project: 'owner'/'admin'/'member' via org, or 'viewer'/'editor' via share. None = no access."""
    project = get_project(project_id)
    if not project:
        return None
    mem = get_membership(user_id, project["org_id"])
    if mem:
        return mem["role"]
    with get_conn() as conn:
        share = conn.execute(
            "SELECT * FROM studio_project_shares WHERE project_id = ? AND grantee_id = ? AND (expires_at IS NULL OR expires_at > ?)",
            (project_id, user_id, _now()),
        ).fetchone()
    return share["role"] if share else None


# ── Project assets ────────────────────────────────────────────────────────────

def create_project_asset(project_id: str, org_id: str, name: str, mime_type: str, size_bytes: int, storage_key: str, created_by: str) -> dict[str, Any]:
    aid = _gen_id("ast")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_project_assets (id, project_id, org_id, name, mime_type, size_bytes, storage_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (aid, project_id, org_id, name, mime_type, size_bytes, storage_key, created_by, _now()),
        )
    return get_project_asset(aid) or {}


def get_project_asset(asset_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_project_assets WHERE id = ?", (asset_id,)).fetchone()


def list_project_assets(project_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_project_assets WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()


def delete_project_asset(asset_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM studio_project_assets WHERE id = ?", (asset_id,))


# ── Audit events ──────────────────────────────────────────────────────────────

def log_audit_event(action: str, *, user_id: str | None = None, org_id: str | None = None, resource_type: str | None = None, resource_id: str | None = None, details: dict | None = None, ip_addr: str | None = None) -> None:
    import json
    eid = _gen_id("aud")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO studio_audit_events (id, org_id, user_id, action, resource_type, resource_id, details, ip_addr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (eid, org_id, user_id, action, resource_type, resource_id, json.dumps(details or {}), ip_addr, _now()),
        )


def list_audit_events(*, org_id: str | None = None, user_id: str | None = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if org_id:
            return conn.execute(
                "SELECT * FROM studio_audit_events WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (org_id, limit, offset),
            ).fetchall()
        elif user_id:
            return conn.execute(
                "SELECT * FROM studio_audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (user_id, limit, offset),
            ).fetchall()
        else:
            return conn.execute(
                "SELECT * FROM studio_audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()


# ── Billing / plans ───────────────────────────────────────────────────────────

def get_or_create_default_plan() -> dict[str, Any]:
    import json
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_plans WHERE is_default = 1").fetchone()
        if row:
            return row
        # Seed default plans if none exist
        plans = [
            ("plan_free",  "Free",       5,   10, ["collab","share"],        0,     0,    1),
            ("plan_pro",   "Pro",        25,  100, ["collab","share","sso"], 1500, 12000, 0),
            ("plan_ent",   "Enterprise", 500, 999, ["collab","share","sso","saml","scim","audit"], 0, 0, 0),
        ]
        for p in plans:
            try:
                conn.execute(
                    "INSERT INTO studio_plans (id, name, max_seats, max_projects, features, price_monthly, price_annual, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (p[0], p[1], p[2], p[3], json.dumps(p[4]), p[5], p[6], p[7]),
                )
            except Exception:
                pass
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_plans WHERE is_default = 1").fetchone() or {}


def get_org_subscription(org_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        sub = conn.execute("SELECT * FROM studio_subscriptions WHERE org_id = ?", (org_id,)).fetchone()
    if sub:
        return sub
    # Auto-create free plan subscription
    plan = get_or_create_default_plan()
    if not plan:
        return {}
    now = _now()
    sub_id = _gen_id("sub")
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO studio_subscriptions (id, org_id, plan_id, seats_purchased, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sub_id, org_id, plan["id"], plan["max_seats"], "active", now, now),
            )
        except Exception:
            pass
    with get_conn() as conn:
        return conn.execute("SELECT * FROM studio_subscriptions WHERE org_id = ?", (org_id,)).fetchone() or {}


def update_org_subscription(org_id: str, **fields: Any) -> dict[str, Any]:
    allowed = {"plan_id", "seats_purchased", "status", "current_period_end", "external_id"}
    clean = {k: v for k, v in fields.items() if k in allowed}
    clean["updated_at"] = _now()
    with get_conn() as conn:
        cols = ", ".join(f"{k} = ?" for k in clean)
        conn.execute(f"UPDATE studio_subscriptions SET {cols} WHERE org_id = ?", (*clean.values(), org_id))
    return get_org_subscription(org_id)


def list_plans() -> list[dict[str, Any]]:
    import json
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM studio_plans ORDER BY price_monthly").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["features"] = json.loads(d.get("features") or "[]")
        result.append(d)
    return result


def count_org_seats_used(org_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) as cnt FROM studio_memberships WHERE org_id = ?", (org_id,)).fetchone()
    return row["cnt"] if row else 0


# ── SSO configs ───────────────────────────────────────────────────────────────

def get_sso_config(org_id: str) -> dict[str, Any] | None:
    import json
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM studio_sso_configs WHERE org_id = ?", (org_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["attribute_map"] = json.loads(d.get("attribute_map") or "{}")
    return d


def upsert_sso_config(org_id: str, **fields: Any) -> dict[str, Any]:
    import json
    allowed = {"provider", "metadata_url", "metadata_xml", "entity_id", "sso_url", "slo_url", "certificate", "attribute_map", "enabled"}
    clean: dict[str, Any] = {}
    for k, v in fields.items():
        if k in allowed:
            clean[k] = json.dumps(v) if isinstance(v, dict) else v
    now = _now()
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM studio_sso_configs WHERE org_id = ?", (org_id,)).fetchone()
        if exists:
            clean["updated_at"] = now
            cols = ", ".join(f"{k} = ?" for k in clean)
            conn.execute(f"UPDATE studio_sso_configs SET {cols} WHERE org_id = ?", (*clean.values(), org_id))
        else:
            clean.update({"org_id": org_id, "created_at": now, "updated_at": now})
            if "id" not in clean:
                clean["id"] = _gen_id("sso")
            cols = ", ".join(clean.keys())
            placeholders = ", ".join("?" * len(clean))
            conn.execute(f"INSERT INTO studio_sso_configs ({cols}) VALUES ({placeholders})", tuple(clean.values()))
    return get_sso_config(org_id) or {}
