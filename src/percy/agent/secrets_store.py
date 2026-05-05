"""Per-user / per-org secret store.

Encrypted-at-rest KV store for secrets that scripts can request via the
sandbox's ``scope.secret_keys`` allowlist. Replaces the ``os.environ``
fallback for production: each user has personal secrets, each org has
shared secrets, and a script invoked by user U on doc D belonging to
org O sees the union (user > org precedence).

Encryption: Fernet (AES-128-CBC + HMAC) with a key derived from
``PERCY_SECRETS_KEY`` env var via PBKDF2. If the env var is missing on a
non-prod environment, falls back to a per-machine generated key cached at
``~/.percy/secrets.key`` so dev workflows just work.

API:
    set_secret(scope_kind, scope_id, key, value, *, set_by)
    get_secret(scope_kind, scope_id, key)
    list_secrets(scope_kind, scope_id)        # returns keys only, never values
    delete_secret(scope_kind, scope_id, key)
    resolve_for_user(user_id, org_id, requested_keys) → dict[key, value]

scope_kind: 'user' | 'org'
scope_id:   user id or org id
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets as _secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger(__name__)


_DEFAULT_DB_PATH = Path(os.environ.get("PERCY_AGENT_DB", "")) if os.environ.get("PERCY_AGENT_DB") \
    else Path(__file__).resolve().parent.parent.parent.parent / ".percy_agent.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS secrets (
    id              TEXT PRIMARY KEY,
    scope_kind      TEXT NOT NULL,        -- 'user' | 'org'
    scope_id        TEXT NOT NULL,
    key             TEXT NOT NULL,
    value_enc       BLOB NOT NULL,        -- encrypted value
    description     TEXT,
    set_by          TEXT,                 -- user id who created/updated
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL,
    last_accessed_at REAL,
    access_count    INTEGER DEFAULT 0,
    UNIQUE(scope_kind, scope_id, key)
);
CREATE INDEX IF NOT EXISTS idx_secrets_scope ON secrets(scope_kind, scope_id);
"""


# ── Encryption ──────────────────────────────────────────────────────────────


def _derive_key() -> bytes:
    """Get a 32-byte Fernet key from env var or local cache file."""
    raw = os.environ.get("PERCY_SECRETS_KEY")
    if raw:
        # PBKDF2 derive a Fernet key from the env var
        salt = b"percy-secrets-v1"
        key = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt, 100_000, dklen=32)
        return base64.urlsafe_b64encode(key)

    # Dev fallback: generate + cache a key locally
    cache_dir = Path.home() / ".percy"
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / "secrets.key"
    if not cache_file.exists():
        new_key = base64.urlsafe_b64encode(_secrets.token_bytes(32))
        cache_file.write_bytes(new_key)
        log.warning("secrets_store: generated dev key at %s — set PERCY_SECRETS_KEY in prod", cache_file)
    return cache_file.read_bytes()


def _cipher():
    """Return a Fernet cipher. Imported lazily so tests can patch."""
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise RuntimeError(
            "secrets_store requires the 'cryptography' package. Install it: pip install cryptography"
        ) from exc
    return Fernet(_derive_key())


def _encrypt(value: str) -> bytes:
    return _cipher().encrypt(value.encode("utf-8"))


def _decrypt(blob: bytes) -> str:
    return _cipher().decrypt(blob).decode("utf-8")


# ── DB ──────────────────────────────────────────────────────────────────────


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


@contextmanager
def _ensured(db_path: Path | None = None):
    if not _INITIALIZED:
        init_db(db_path)
    c = _conn(db_path)
    try:
        yield c
    finally:
        c.close()


# ── Public API ──────────────────────────────────────────────────────────────


def set_secret(
    scope_kind: str, scope_id: str, key: str, value: str,
    *, set_by: str | None = None, description: str | None = None,
    db_path: Path | None = None,
) -> str:
    """Insert or update a secret. Returns the row id."""
    if scope_kind not in ("user", "org"):
        raise ValueError(f"scope_kind must be 'user' or 'org', got {scope_kind!r}")
    if not _is_valid_key(key):
        raise ValueError(f"invalid secret key {key!r} — use [A-Z0-9_], 1-64 chars")

    enc = _encrypt(value)
    now = time.time()
    sid = uuid.uuid4().hex
    with _ensured(db_path) as c:
        c.execute(
            """
            INSERT INTO secrets (id, scope_kind, scope_id, key, value_enc, description, set_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
                value_enc = excluded.value_enc,
                description = COALESCE(excluded.description, secrets.description),
                set_by = excluded.set_by,
                updated_at = excluded.updated_at
            """,
            (sid, scope_kind, scope_id, key, enc, description, set_by, now, now),
        )
    return sid


def get_secret(
    scope_kind: str, scope_id: str, key: str,
    db_path: Path | None = None,
) -> str | None:
    """Decrypt and return a secret. Touches access metadata. Returns None if not set."""
    with _ensured(db_path) as c:
        row = c.execute(
            "SELECT value_enc FROM secrets WHERE scope_kind = ? AND scope_id = ? AND key = ?",
            (scope_kind, scope_id, key),
        ).fetchone()
        if not row:
            return None
        c.execute(
            "UPDATE secrets SET last_accessed_at = ?, access_count = access_count + 1 WHERE scope_kind = ? AND scope_id = ? AND key = ?",
            (time.time(), scope_kind, scope_id, key),
        )
    try:
        return _decrypt(row["value_enc"])
    except Exception as exc:
        log.error("secrets_store: failed to decrypt %s/%s/%s: %s", scope_kind, scope_id, key, exc)
        return None


def list_secrets(
    scope_kind: str, scope_id: str,
    db_path: Path | None = None,
) -> list[dict]:
    """List secret KEYS (no values). Returns metadata only."""
    with _ensured(db_path) as c:
        rows = c.execute(
            """
            SELECT key, description, set_by, created_at, updated_at, last_accessed_at, access_count
            FROM secrets WHERE scope_kind = ? AND scope_id = ?
            ORDER BY key
            """,
            (scope_kind, scope_id),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_secret(
    scope_kind: str, scope_id: str, key: str,
    db_path: Path | None = None,
) -> bool:
    with _ensured(db_path) as c:
        cur = c.execute(
            "DELETE FROM secrets WHERE scope_kind = ? AND scope_id = ? AND key = ?",
            (scope_kind, scope_id, key),
        )
        return cur.rowcount > 0


def resolve_for_user(
    user_id: str | None, org_id: str | None,
    requested_keys: list[str],
    db_path: Path | None = None,
) -> dict[str, str]:
    """Return the requested secret keys, with user-scoped overriding org-scoped.

    Used by the sandbox: ``scope.secret_keys`` lists the keys the script is
    allowed to receive; this function resolves them against the user's scope
    and the org's scope.

    Falls back to ``os.environ[key]`` only for keys explicitly prefixed with
    ``ENV_`` — preserves the old "set this in your shell for dev" workflow
    without leaking arbitrary process env into scripts.
    """
    out: dict[str, str] = {}
    for key in requested_keys:
        if key.startswith("ENV_") and key in os.environ:
            out[key] = os.environ[key]
            continue
        # User-scoped first
        if user_id:
            v = get_secret("user", user_id, key, db_path=db_path)
            if v is not None:
                out[key] = v
                continue
        # Then org-scoped
        if org_id:
            v = get_secret("org", org_id, key, db_path=db_path)
            if v is not None:
                out[key] = v
                continue
    return out


def _is_valid_key(key: str) -> bool:
    import re
    return bool(re.fullmatch(r"[A-Z0-9_]{1,64}", key))
