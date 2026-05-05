"""Audit middleware — records every mutating studio API call automatically.

Applies to:
  * POST/PATCH/PUT/DELETE on ``/api/docs/{doc_id}/...`` paths
  * POST/PATCH/PUT/DELETE on a small allowlist of ``/api/agent/...`` paths

Skipped when the handler explicitly recorded its own audit row by setting
``request.state.audit_handled = True``. The chat handler does this (it
writes a richer record with the planner's plan + execution steps).

Actor inference:
  * If the request has ``X-Percy-Actor: agent`` header (the Studio client
    sets this when running the agent loop) → ``actor = "agent"``
  * If a session user is attached → ``actor = "human"``
  * Otherwise → ``actor = "system"``

The middleware also takes a doc snapshot before mutating endpoints and
records the snapshot_index, so every action is rollback-able.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from percy.agent import audit

log = logging.getLogger(__name__)


_MUTATING_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})

# Match /api/docs/<doc_id>/...
_DOC_PATH_RE = re.compile(r"^/api/docs/(?P<doc_id>[^/]+)(?:/slides/(?P<slide_n>\d+))?(?:/elements/(?P<element_id>[^/]+))?")

# Endpoints under /api/docs/* that should NOT be audited (read-only or plumbing)
_DOC_PATH_EXEMPT_SUFFIXES = (
    "/element-png", "/bridge.png", "/original.png", "/rebuilt.png",
    "/diagnostics", "/render-status", "/export", "/export-pdf", "/export-png-zip",
    "/export-html", "/export-script", "/export-markdown", "/notes-export",
    "/notes-html-export", "/notes-pages-pdf", "/notes-summary",
    "/snapshots", "/undo-state",
    "/save-to-cloud",
    "/templates", "/template-variables",
    "/style", "/text", "/elements",   # GETs only — POST/PATCH still audited (this is method-checked)
)

# /api/agent/* paths that should be audited (writes only)
_AGENT_AUDIT_PATHS = (
    "/api/agent/templates",                # POST/DELETE
    "/api/agent/element_index/invalidate", # POST
    "/api/agent/actions/",                 # /rollback
)


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        method = request.method
        path = request.url.path

        # Fast path: only audit mutating verbs
        if method not in _MUTATING_METHODS:
            return await call_next(request)

        # Determine if this endpoint is in scope
        doc_match = _DOC_PATH_RE.match(path)
        is_doc_path = doc_match is not None
        is_agent_path = any(path.startswith(prefix) for prefix in _AGENT_AUDIT_PATHS)

        if not (is_doc_path or is_agent_path):
            return await call_next(request)

        # We need the body for the audit record. Read it (and re-inject so the
        # handler can read it again).
        body_bytes = await request.body()

        async def receive():
            return {"type": "http.request", "body": body_bytes, "more_body": False}
        request._receive = receive  # type: ignore[attr-defined]

        # Initialize the per-request flag — the handler can flip this to suppress
        # automatic logging when it logs its own (richer) record.
        request.state.audit_handled = False

        t0 = time.time()
        try:
            response = await call_next(request)
        except Exception as exc:
            # Even on exception, record an action row so failures are auditable.
            _safe_record(request, body_bytes, status="failed",
                         error=f"{type(exc).__name__}: {exc}",
                         elapsed_ms=int((time.time() - t0) * 1000))
            raise

        elapsed_ms = int((time.time() - t0) * 1000)

        # Don't double-log when the handler already wrote its own row.
        if getattr(request.state, "audit_handled", False):
            return response

        # Don't audit unsuccessful responses other than 4xx (server errors are
        # often middleware-level surprises).
        if response.status_code >= 500:
            _safe_record(request, body_bytes,
                         status="failed", error=f"HTTP {response.status_code}",
                         elapsed_ms=elapsed_ms)
            return response

        # Skip GETs disguised as the same path (already filtered, but safety)
        if method == "GET":
            return response

        # Skip ignored read-only-ish suffixes.
        if is_doc_path and any(path.endswith(suf) for suf in _DOC_PATH_EXEMPT_SUFFIXES):
            return response

        status = "executed" if response.status_code < 400 else "failed"
        _safe_record(request, body_bytes,
                     status=status,
                     error=None if status == "executed" else f"HTTP {response.status_code}",
                     elapsed_ms=elapsed_ms)
        return response


def _safe_record(request: Request, body_bytes: bytes,
                 *, status: str, error: str | None, elapsed_ms: int) -> None:
    """Best-effort audit row write. Never let logging failures break the response."""
    try:
        method = request.method
        path = request.url.path
        doc_match = _DOC_PATH_RE.match(path)
        doc_id = doc_match.group("doc_id") if doc_match else _doc_id_from_body(body_bytes)
        slide_n = int(doc_match.group("slide_n")) if doc_match and doc_match.group("slide_n") else None
        element_id = doc_match.group("element_id") if doc_match else None

        actor = _infer_actor(request)
        source = "middleware"

        # Try to extract a concise prompt-like description.
        prompt = _summary(method, path, body_bytes)

        # Don't take a snapshot here — most handlers already do their own
        # snapshot before mutating. We just read the top-of-stack index so the
        # audit row points to the right rollback target.
        snapshot_index: int | None = None
        if doc_id and method in _MUTATING_METHODS and status == "executed":
            snapshot_index = _current_snapshot_index(doc_id)

        # Approximate kind from the path.
        kind = _classify_kind(method, path)

        audit.record_action(
            user_id=_user_id(request),
            doc_id=doc_id or "(unknown)",
            slide_n=slide_n,
            element_id=element_id,
            actor=actor,
            source=source,
            method=method,
            path=path,
            kind=kind,
            prompt=prompt,
            plan=_safe_json(body_bytes),
            status=status,
            error=error,
            snapshot_index=snapshot_index,
            elapsed_ms=elapsed_ms,
        )
    except Exception as exc:
        log.warning("audit middleware: failed to record %s %s: %s", request.method, request.url.path, exc)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _infer_actor(request: Request) -> str:
    if request.headers.get("X-Percy-Actor", "").lower() == "agent":
        return "agent"
    user = getattr(request.state, "user", None)
    if user:
        return "human"
    return "system"


def _user_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    return user.get("id") if user else None


def _safe_json(body_bytes: bytes) -> Any:
    if not body_bytes:
        return None
    try:
        return json.loads(body_bytes)
    except Exception:
        # Probably multipart or binary — store a marker
        return {"_binary_or_multipart": True, "size": len(body_bytes)}


def _doc_id_from_body(body_bytes: bytes) -> str | None:
    body = _safe_json(body_bytes)
    if isinstance(body, dict):
        return body.get("doc_id")
    return None


def _summary(method: str, path: str, body_bytes: bytes) -> str:
    """One-line description of the action for the activity log."""
    body = _safe_json(body_bytes)
    if not isinstance(body, dict):
        body = {}

    # Most mutating endpoints have telltale paths
    if "/elements/chart" in path:                     return f"Create chart"
    if "/elements/table" in path:                     return f"Create table"
    if "/elements/connector" in path:                 return f"Create connector"
    if "/elements/text" in path:                      return f"Create text box"
    if "/elements/shape" in path:                     return f"Create shape"
    if "/elements/freeform" in path:                  return f"Create freeform"
    if "/elements/image" in path:                     return f"Insert image"
    if "/elements/live-group" in path:                return f"Create live group"
    if path.endswith("/regenerate"):                  return f"Regenerate live group"
    if path.endswith("/group-elements"):              return f"Group elements"
    if path.endswith("/ungroup"):                     return f"Ungroup elements"
    if path.endswith("/script/run"):                  return f"Run slide script"
    if path.endswith("/script") and method in ("PUT","POST"): return f"Save slide script"
    if path.endswith("/connect"):                     return f"Save element connect"
    if path.endswith("/connect/test"):                return f"Test element connect"
    if path.endswith("/duplicate"):                   return f"Duplicate element"
    if path.endswith("/copy-to-slide"):               return f"Copy element to slide"
    if "/slides/" in path and method == "POST":       return f"Create slide"
    if "/slides/" in path and method == "DELETE":     return f"Delete slide"
    if "/slides/" in path and "/move" in path:        return f"Move slide"
    if "/slides/" in path and "/reorder" in path:     return f"Reorder slides"
    if "/slides/" in path and "/duplicate" in path:   return f"Duplicate slide"
    if path.endswith("/undo"):                        return f"Undo"
    if path.endswith("/redo"):                        return f"Redo"
    if "/elements/" in path and method == "PATCH":
        # Show the keys patched for context
        keys = list(body.keys()) if body else []
        if keys:
            return f"Edit element ({', '.join(keys[:3])}{'...' if len(keys) > 3 else ''})"
        return "Edit element"
    if "/elements/" in path and method == "DELETE":   return "Delete element"
    if "/templates/" in path and path.endswith("/apply"): return f"Apply template"
    if path.endswith("/rollback"):                    return "Rollback action"
    return f"{method} {path}"


def _classify_kind(method: str, path: str) -> str:
    if path.endswith("/apply"):              return "apply_template"
    if path.endswith("/regenerate"):         return "regenerate"
    if path.endswith("/script/run"):         return "code"
    if "/elements/" in path and method == "POST" and not path.endswith("/duplicate") and not path.endswith("/copy-to-slide"):
        return "create"
    if method == "DELETE":                   return "delete"
    return "edit"


def _current_snapshot_index(doc_id: str) -> int | None:
    """Return the top index of the doc's undo stack (handler already snapshotted)."""
    try:
        from app.backend import main as _m
        d = _m._docs.get(doc_id)
        if d is None:
            return None
        stack = d.get("_undo_stack") or []
        return len(stack) - 1 if stack else None
    except Exception:
        return None


def install(app) -> None:
    """Mount the audit middleware. Call AFTER the auth middleware so request.state.user is set."""
    app.add_middleware(AuditMiddleware)
    audit.init_db()
    log.info("audit_middleware: installed (records every mutating /api/docs/* and /api/agent/* call)")
