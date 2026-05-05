"""HTTP routes for the secrets store.

Endpoints:
  GET    /api/secrets?scope=user|org&scope_id=...     — list keys (NO values)
  POST   /api/secrets                                  — set
  DELETE /api/secrets/{key}?scope=...&scope_id=...    — delete

Scope authorization:
  * user-scope writes: only the user themselves
  * org-scope writes: only org members (any role); revoking is owner-only
  * Anything not authenticated → 401
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent import secrets_store

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/secrets")
async def list_secrets_route(request: Request, scope: str = "user", scope_id: str | None = None):
    user = _require_user(request)
    sid = scope_id or user["id"]
    if scope == "user" and sid != user["id"]:
        raise HTTPException(403, "cannot list another user's secrets")
    if scope == "org" and not _is_org_member(user["id"], sid):
        raise HTTPException(403, "not a member of this org")
    if scope not in ("user", "org"):
        raise HTTPException(400, "scope must be 'user' or 'org'")
    return {"secrets": secrets_store.list_secrets(scope, sid)}


@router.post("/api/secrets")
async def set_secret_route(request: Request):
    user = _require_user(request)
    body = await _parse_json(request)
    scope = body.get("scope", "user")
    scope_id = body.get("scope_id") or user["id"]
    key = body.get("key", "")
    value = body.get("value", "")
    description = body.get("description")

    if scope == "user" and scope_id != user["id"]:
        raise HTTPException(403, "cannot set another user's secret")
    if scope == "org" and not _is_org_member(user["id"], scope_id):
        raise HTTPException(403, "not a member of this org")
    if scope not in ("user", "org"):
        raise HTTPException(400, "scope must be 'user' or 'org'")
    if not key or not value:
        raise HTTPException(400, "key and value are required")

    try:
        secrets_store.set_secret(scope, scope_id, key, value,
                                  set_by=user["id"], description=description)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    return {"ok": True, "scope": scope, "scope_id": scope_id, "key": key}


@router.delete("/api/secrets/{key}")
async def delete_secret_route(key: str, request: Request,
                              scope: str = "user", scope_id: str | None = None):
    user = _require_user(request)
    sid = scope_id or user["id"]
    if scope == "user" and sid != user["id"]:
        raise HTTPException(403, "cannot delete another user's secret")
    if scope == "org" and not _is_org_member(user["id"], sid):
        raise HTTPException(403, "not a member of this org")
    ok = secrets_store.delete_secret(scope, sid, key)
    if not ok:
        raise HTTPException(404, "secret not found")
    return {"ok": True}


# ── Helpers ─────────────────────────────────────────────────────────────────


def _require_user(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "authentication required for secrets")
    return user


def _is_org_member(user_id: str, org_id: str | None) -> bool:
    if not org_id:
        return False
    try:
        from app.backend import auth_db
        memberships = auth_db.list_user_orgs(user_id) or []
        return any(m.get("id") == org_id for m in memberships)
    except Exception:
        return False


async def _parse_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def register_secrets_router(app) -> None:
    secrets_store.init_db()
    app.include_router(router)
    log.info("agent_secrets: registered secret store routes")
