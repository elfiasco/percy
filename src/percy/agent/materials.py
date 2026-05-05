"""Project supplementary materials — upload, security pre-pass, index, retrieve.

When the user drops in `monthly_pull.py`, we want the coder skill to read it
as context but never echo secrets back into a generated script. This module:

  * Stores files in ``.percy_materials/<doc_id>/<filename>``
  * Runs a security pre-pass on every upload:
      - regex secret detection (AWS keys, GitHub tokens, generic patterns)
      - dangerous-import flagging (subprocess, socket, os.system) → soft flag
      - syntax check for .py files
  * Chunks Python by function/class, CSV by row group, text by paragraph
  * Maintains a per-doc keyword index for retrieval
  * Exposes ``retrieve_chunks(prompt, doc_id, top_k)``

Two flags per file:
  * ``usable_as_reference`` — auto on after security check (pass / soft-warn)
    *unless* hard-rejected for plaintext secrets
  * ``usable_as_starter``   — user opts in per file
"""

from __future__ import annotations

import ast
import hashlib
import json
import logging
import os
import re
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
_MATERIALS_ROOT = Path(os.environ.get("PERCY_MATERIALS_DIR", "")) if os.environ.get("PERCY_MATERIALS_DIR") \
    else Path(__file__).resolve().parent.parent.parent.parent / ".percy_materials"


SCHEMA = """
CREATE TABLE IF NOT EXISTS materials (
    id                 TEXT PRIMARY KEY,
    doc_id             TEXT NOT NULL,
    filename           TEXT NOT NULL,
    file_size          INTEGER NOT NULL,
    file_kind          TEXT NOT NULL,        -- 'python' | 'csv' | 'text' | 'json' | 'other'
    storage_path       TEXT NOT NULL,
    secret_findings    TEXT,                 -- JSON list of {kind, line, redacted_excerpt}
    dangerous_imports  TEXT,                 -- JSON list of import names
    syntax_ok          INTEGER DEFAULT 1,
    syntax_error       TEXT,
    usable_as_reference INTEGER DEFAULT 1,
    usable_as_starter  INTEGER DEFAULT 0,
    chunk_count        INTEGER DEFAULT 0,
    created_at         REAL NOT NULL,
    updated_at         REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS material_chunks (
    id              TEXT PRIMARY KEY,
    material_id     TEXT NOT NULL,
    doc_id          TEXT NOT NULL,
    kind            TEXT NOT NULL,          -- 'function' | 'class' | 'csv_rows' | 'paragraph'
    name            TEXT,
    text            TEXT NOT NULL,
    tokens          TEXT NOT NULL,          -- JSON list of normalized tokens
    line_start      INTEGER,
    line_end        INTEGER,
    FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_materials_doc        ON materials(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_material      ON material_chunks(material_id);
CREATE INDEX IF NOT EXISTS idx_chunks_doc           ON material_chunks(doc_id);
"""


# ── Security: secret regexes ───────────────────────────────────────────────


_SECRET_PATTERNS: list[tuple[str, str]] = [
    ("aws_access_key",    r"\bAKIA[0-9A-Z]{16}\b"),
    ("aws_secret",        r"\b[A-Za-z0-9/+=]{40}\b"),  # noisy; only fires alongside AKIA
    ("github_pat",        r"\bghp_[A-Za-z0-9]{36}\b"),
    ("github_oauth",      r"\bgho_[A-Za-z0-9]{36}\b"),
    ("openai_key",        r"\bsk-[A-Za-z0-9]{20,}\b"),
    ("anthropic_key",     r"\bsk-ant-[A-Za-z0-9_\-]{50,}\b"),
    ("slack_token",       r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ("private_key",       r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----"),
    ("password_assign",   r"(?im)^\s*(?:password|passwd|secret|api_key|api_token|access_token|auth_token)\s*=\s*['\"][^'\"]{6,}['\"]"),
    ("connection_string", r"\b(?:postgres|postgresql|mysql|mongodb|redis)://[^\s'\"]+:[^\s'\"@]+@"),
]

_DANGEROUS_IMPORTS: frozenset[str] = frozenset({
    "subprocess", "socket", "os.system", "ctypes", "marshal", "pickle",
    "ftplib", "smtplib", "telnetlib", "shutil",
})


@dataclass(slots=True)
class SecretFinding:
    kind: str
    line: int
    excerpt: str  # already-redacted


@dataclass(slots=True)
class SecurityReport:
    findings:           list[SecretFinding]
    dangerous_imports:  list[str]
    syntax_ok:          bool
    syntax_error:       str | None
    hard_reject:        bool       # True if secret findings count > 0 AND not redacted

    def to_dict(self) -> dict:
        return {
            "findings": [{"kind": f.kind, "line": f.line, "excerpt": f.excerpt} for f in self.findings],
            "dangerous_imports": list(self.dangerous_imports),
            "syntax_ok": self.syntax_ok, "syntax_error": self.syntax_error,
            "hard_reject": self.hard_reject,
        }


def security_scan(text: str, *, file_kind: str) -> SecurityReport:
    """Scan a file's text content for secrets and dangerous imports."""
    findings: list[SecretFinding] = []
    lines = text.splitlines()
    aws_access_seen = False

    for kind, pattern in _SECRET_PATTERNS:
        # AWS secret-access-key pattern is too generic on its own; skip unless
        # an AWS access key id was already found.
        if kind == "aws_secret" and not aws_access_seen:
            continue
        for m in re.finditer(pattern, text):
            line_no = text.count("\n", 0, m.start()) + 1
            line_text = lines[line_no - 1] if line_no - 1 < len(lines) else ""
            excerpt = _redact_match(line_text, m)
            findings.append(SecretFinding(kind=kind, line=line_no, excerpt=excerpt))
            if kind == "aws_access_key":
                aws_access_seen = True

    # Dangerous imports + syntax check (Python only).
    dangerous: list[str] = []
    syntax_ok = True
    syntax_err: str | None = None
    if file_kind == "python":
        try:
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for a in node.names:
                        if a.name in _DANGEROUS_IMPORTS:
                            dangerous.append(a.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module and node.module in _DANGEROUS_IMPORTS:
                        dangerous.append(node.module)
        except SyntaxError as exc:
            syntax_ok = False
            syntax_err = f"line {exc.lineno}: {exc.msg}"

    hard_reject = len(findings) > 0
    return SecurityReport(findings=findings, dangerous_imports=sorted(set(dangerous)),
                          syntax_ok=syntax_ok, syntax_error=syntax_err,
                          hard_reject=hard_reject)


def _redact_match(line: str, m: re.Match) -> str:
    """Replace the matched secret with [REDACTED-{N}] and trim the line."""
    secret = m.group(0)
    redacted = line.replace(secret, f"[REDACTED-{len(secret)}]")
    return redacted[:200]


def redact_text(text: str, scan: SecurityReport) -> str:
    """Apply all known secret regexes to a body of text — used before LLM context inclusion."""
    out = text
    for kind, pattern in _SECRET_PATTERNS:
        if kind == "aws_secret":
            # Only redact if a finding identified one
            if not any(f.kind == "aws_secret" for f in scan.findings):
                continue
        out = re.sub(pattern, lambda m: f"[REDACTED-{kind}]", out)
    return out


# ── Storage + DB ───────────────────────────────────────────────────────────


_INITIALIZED = False


def _conn(db_path: Path | None = None) -> sqlite3.Connection:
    p = db_path or _DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p), timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
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


def _classify_kind(filename: str) -> str:
    n = filename.lower()
    if n.endswith(".py"): return "python"
    if n.endswith(".csv"): return "csv"
    if n.endswith(".json"): return "json"
    if n.endswith(".txt") or n.endswith(".md"): return "text"
    return "other"


def _storage_path(doc_id: str, filename: str) -> Path:
    base = _MATERIALS_ROOT / doc_id
    base.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._\-]", "_", filename)
    return base / safe


# ── Public API ──────────────────────────────────────────────────────────────


def upload_material(
    doc_id: str, filename: str, raw: bytes,
    *, db_path: Path | None = None,
) -> dict:
    """Save + scan + index a single uploaded file.

    Returns: {ok, material_id, security: {...}, chunk_count, hard_rejected}
    """
    text = raw.decode("utf-8", errors="replace")
    file_kind = _classify_kind(filename)
    scan = security_scan(text, file_kind=file_kind)

    if scan.hard_reject:
        # Don't write the raw file to disk if it has plaintext secrets.
        return {
            "ok": False,
            "hard_rejected": True,
            "security": scan.to_dict(),
            "message": "File contains plaintext secrets; either redact and re-upload or store the secret in env/secret store.",
        }

    path = _storage_path(doc_id, filename)
    path.write_bytes(raw)

    mid = uuid.uuid4().hex
    now = time.time()
    chunks = list(_chunk(text, file_kind=file_kind))

    with _ensured(db_path) as c:
        c.execute(
            """
            INSERT INTO materials (id, doc_id, filename, file_size, file_kind, storage_path,
              secret_findings, dangerous_imports, syntax_ok, syntax_error,
              usable_as_reference, usable_as_starter, chunk_count, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (mid, doc_id, filename, len(raw), file_kind, str(path),
             json.dumps([{"kind": f.kind, "line": f.line, "excerpt": f.excerpt} for f in scan.findings]),
             json.dumps(scan.dangerous_imports),
             1 if scan.syntax_ok else 0, scan.syntax_error,
             1, 0, len(chunks), now, now),
        )
        for ch in chunks:
            c.execute(
                "INSERT INTO material_chunks (id, material_id, doc_id, kind, name, text, tokens, line_start, line_end) VALUES (?,?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, mid, doc_id, ch["kind"], ch["name"], ch["text"],
                 json.dumps(sorted(_tokenize(ch["text"]))), ch.get("line_start"), ch.get("line_end")),
            )

    return {
        "ok": True, "material_id": mid, "filename": filename, "kind": file_kind,
        "security": scan.to_dict(), "chunk_count": len(chunks),
        "usable_as_reference": True, "usable_as_starter": False,
    }


def list_materials(doc_id: str, db_path: Path | None = None) -> list[dict]:
    with _ensured(db_path) as c:
        rows = c.execute(
            "SELECT * FROM materials WHERE doc_id = ? ORDER BY created_at DESC",
            (doc_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_material(material_id: str, db_path: Path | None = None) -> dict | None:
    with _ensured(db_path) as c:
        row = c.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    return _row_to_dict(row) if row else None


def set_starter_flag(material_id: str, value: bool, db_path: Path | None = None) -> bool:
    with _ensured(db_path) as c:
        cur = c.execute(
            "UPDATE materials SET usable_as_starter = ?, updated_at = ? WHERE id = ?",
            (1 if value else 0, time.time(), material_id),
        )
        return cur.rowcount > 0


def delete_material(material_id: str, db_path: Path | None = None) -> bool:
    with _ensured(db_path) as c:
        row = c.execute("SELECT storage_path FROM materials WHERE id = ?", (material_id,)).fetchone()
        if not row:
            return False
        try:
            Path(row["storage_path"]).unlink(missing_ok=True)
        except Exception:
            pass
        c.execute("DELETE FROM material_chunks WHERE material_id = ?", (material_id,))
        c.execute("DELETE FROM materials WHERE id = ?", (material_id,))
    return True


def retrieve_chunks(
    doc_id: str, query: str,
    *, top_k: int = 5, only_starter: bool = False,
    db_path: Path | None = None,
) -> list[dict]:
    """Keyword search across this doc's material chunks."""
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []

    with _ensured(db_path) as c:
        if only_starter:
            rows = c.execute(
                """
                SELECT mc.*, m.filename, m.file_kind
                FROM material_chunks mc
                JOIN materials m ON m.id = mc.material_id
                WHERE mc.doc_id = ? AND m.usable_as_starter = 1
                """,
                (doc_id,),
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT mc.*, m.filename, m.file_kind
                FROM material_chunks mc
                JOIN materials m ON m.id = mc.material_id
                WHERE mc.doc_id = ? AND m.usable_as_reference = 1
                """,
                (doc_id,),
            ).fetchall()

    scored: list[tuple[float, dict]] = []
    for r in rows:
        try:
            tokens = set(json.loads(r["tokens"]))
        except Exception:
            tokens = set()
        overlap = len(q_tokens & tokens)
        if overlap == 0:
            continue
        score = overlap / max(1, len(q_tokens))
        scored.append((score, {
            "material_id": r["material_id"], "filename": r["filename"],
            "file_kind": r["file_kind"], "chunk_id": r["id"],
            "kind": r["kind"], "name": r["name"], "text": r["text"],
            "line_start": r["line_start"], "line_end": r["line_end"],
            "score": round(score, 4),
        }))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:top_k]]


# ── Chunking ────────────────────────────────────────────────────────────────


def _chunk(text: str, *, file_kind: str) -> list[dict]:
    """Split a file's text into searchable chunks."""
    if file_kind == "python":
        return _chunk_python(text)
    if file_kind == "csv":
        return _chunk_csv(text)
    return _chunk_text(text)


def _chunk_python(text: str) -> list[dict]:
    """One chunk per top-level function / class. Module body → one extra chunk."""
    chunks: list[dict] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        # Fall back to text chunking.
        return _chunk_text(text)
    lines = text.splitlines()
    module_body_lines = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = node.lineno
            end = getattr(node, "end_lineno", start) or start
            chunk_text = "\n".join(lines[start - 1:end])
            chunks.append({
                "kind": "class" if isinstance(node, ast.ClassDef) else "function",
                "name": node.name, "text": chunk_text,
                "line_start": start, "line_end": end,
            })
        else:
            start = node.lineno
            end = getattr(node, "end_lineno", start) or start
            module_body_lines.extend(lines[start - 1:end])
    if module_body_lines:
        chunks.insert(0, {
            "kind": "module", "name": "module",
            "text": "\n".join(module_body_lines), "line_start": 1, "line_end": len(module_body_lines),
        })
    return chunks


def _chunk_csv(text: str, *, group_size: int = 20) -> list[dict]:
    lines = text.splitlines()
    if not lines:
        return []
    header = lines[0]
    chunks: list[dict] = []
    chunks.append({"kind": "csv_header", "name": "header", "text": header,
                   "line_start": 1, "line_end": 1})
    for i in range(1, len(lines), group_size):
        block = "\n".join(lines[i:i + group_size])
        if not block.strip():
            continue
        chunks.append({
            "kind": "csv_rows", "name": f"rows {i+1}-{min(i+group_size, len(lines))}",
            "text": header + "\n" + block,
            "line_start": i + 1, "line_end": min(i + group_size, len(lines)),
        })
    return chunks


def _chunk_text(text: str) -> list[dict]:
    chunks: list[dict] = []
    paragraphs = re.split(r"\n\s*\n", text)
    line_cursor = 1
    for i, p in enumerate(paragraphs):
        if not p.strip():
            line_cursor += p.count("\n") + 1
            continue
        n_lines = p.count("\n") + 1
        chunks.append({
            "kind": "paragraph", "name": f"paragraph {i+1}",
            "text": p.strip(),
            "line_start": line_cursor, "line_end": line_cursor + n_lines - 1,
        })
        line_cursor += n_lines + 1
    return chunks


def _tokenize(s: str) -> set[str]:
    """Tokenize for keyword retrieval.

    Splits on non-letter boundaries AND on underscores, so both
    'fetch_revenue' (full identifier) and 'fetch'/'revenue' (sub-words)
    end up in the token set. Also splits camelCase via a second pass.
    """
    if not s:
        return set()
    out: set[str] = set()
    for whole in re.findall(r"[A-Za-z][A-Za-z0-9_]*", s):
        if len(whole) >= 3:
            out.add(whole.lower())
        # Split underscore-delimited identifiers into sub-words.
        for part in whole.split("_"):
            if len(part) >= 3:
                out.add(part.lower())
        # Split camelCase: insert spaces before capital letters.
        camel_split = re.sub(r"(?<!^)([A-Z])", r" \1", whole)
        for part in camel_split.split():
            if len(part) >= 3:
                out.add(part.lower())
    return out


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = {k: row[k] for k in row.keys()}
    try: d["secret_findings"] = json.loads(d.pop("secret_findings") or "[]")
    except Exception: d["secret_findings"] = []
    try: d["dangerous_imports"] = json.loads(d.pop("dangerous_imports") or "[]")
    except Exception: d["dangerous_imports"] = []
    d["syntax_ok"] = bool(d.get("syntax_ok"))
    d["usable_as_reference"] = bool(d.get("usable_as_reference"))
    d["usable_as_starter"] = bool(d.get("usable_as_starter"))
    return d
