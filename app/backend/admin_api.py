"""Admin API — audit log, user management, system stats."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from . import auth, auth_db

log = logging.getLogger("percy.admin")
router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/audit-events")
def list_audit_events(request: Request, org_id: str | None = None, limit: int = 100, offset: int = 0):
    user = auth.require_admin(request)
    events = auth_db.list_audit_events(org_id=org_id, limit=limit, offset=offset)
    return {"events": events, "limit": limit, "offset": offset}


@router.get("/orgs/{org_id}/audit-events")
def org_audit_events(request: Request, org_id: str, limit: int = 100, offset: int = 0):
    user = auth.require_user(request)
    mem = auth_db.get_membership(user["id"], org_id)
    if not mem or mem["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Org admin required")
    events = auth_db.list_audit_events(org_id=org_id, limit=limit, offset=offset)
    return {"events": events}


@router.get("/users")
def list_all_users(request: Request, limit: int = 100, offset: int = 0):
    auth.require_admin(request)
    with auth_db.get_conn() as conn:
        users = conn.execute(
            "SELECT id, email, display_name, avatar_url, is_admin, email_verified, created_at FROM studio_users ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return {"users": users}


@router.get("/stats")
def system_stats(request: Request):
    auth.require_admin(request)
    with auth_db.get_conn() as conn:
        user_count    = conn.execute("SELECT COUNT(*) as c FROM studio_users").fetchone()["c"]
        org_count     = conn.execute("SELECT COUNT(*) as c FROM studio_orgs").fetchone()["c"]
        project_count = conn.execute("SELECT COUNT(*) as c FROM studio_projects").fetchone()["c"]
        session_count = conn.execute("SELECT COUNT(*) as c FROM studio_sessions WHERE expires_at > ?", (int(__import__("time").time()),)).fetchone()["c"]
    return {
        "users": user_count,
        "orgs": org_count,
        "projects": project_count,
        "active_sessions": session_count,
    }
