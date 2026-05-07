"""Project sharing API — share projects with specific users or via link."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr

from . import auth, auth_db

log = logging.getLogger("percy.sharing")
router = APIRouter(tags=["sharing"])


def _require_project_member(user: dict[str, Any], project_id: str) -> dict[str, Any]:
    project = auth_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    membership = auth_db.get_membership(user["id"], project["org_id"])
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this project's org")
    return project


class CreateShareRequest(BaseModel):
    grantee_email: str | None = None
    role: str = "viewer"  # viewer | editor
    expires_in_days: int | None = None

@router.post("/api/projects/{project_id}/shares")
def create_share(request: Request, project_id: str, req: CreateShareRequest):
    user = auth.require_user(request)
    project = _require_project_member(user, project_id)
    membership = auth_db.get_membership(user["id"], project["org_id"])
    if not membership or membership["role"] not in ("owner", "admin", "member"):
        raise HTTPException(status_code=403, detail="Must be a project member to share")
    if req.role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="role must be 'viewer' or 'editor'")

    grantee_id = None
    if req.grantee_email:
        grantee = auth_db.get_user_by_email(req.grantee_email)
        if not grantee:
            raise HTTPException(status_code=404, detail=f"No user with email {req.grantee_email}")
        grantee_id = grantee["id"]

    ttl = req.expires_in_days * 86400 if req.expires_in_days else None
    share = auth_db.create_project_share(
        project_id=project_id,
        created_by=user["id"],
        grantee_id=grantee_id,
        role=req.role,
        ttl=ttl,
    )
    auth_db.log_audit_event("project.share.create", user_id=user["id"], org_id=project["org_id"],
                            resource_type="project", resource_id=project_id,
                            details={"grantee_id": grantee_id, "role": req.role})
    return share


@router.get("/api/projects/{project_id}/shares")
def list_shares(request: Request, project_id: str):
    user = auth.require_user(request)
    _require_project_member(user, project_id)
    return {"shares": auth_db.list_project_shares(project_id)}


@router.delete("/api/projects/{project_id}/shares/{share_id}")
def delete_share(request: Request, project_id: str, share_id: str):
    user = auth.require_user(request)
    project = _require_project_member(user, project_id)
    auth_db.delete_project_share(share_id)
    auth_db.log_audit_event("project.share.delete", user_id=user["id"], org_id=project["org_id"],
                            resource_type="project", resource_id=project_id)
    return {"ok": True}


@router.get("/api/share/{token}")
def accept_share_link(request: Request, token: str):
    """Look up a share token and return project info. Frontend redirects to studio."""
    user = auth.require_user(request)
    from . import auth_db
    import time
    share = auth_db.get_project_share_by_token(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")
    if share.get("expires_at") and share["expires_at"] < int(time.time()):
        raise HTTPException(status_code=410, detail="Share link has expired")
    project = auth_db.get_project(share["project_id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Grant access by creating a grantee share if none exists for this user
    existing = auth_db.check_project_access(user["id"], share["project_id"])
    if not existing:
        auth_db.create_project_share(
            project_id=share["project_id"],
            created_by=share["created_by"],
            grantee_id=user["id"],
            role=share["role"],
        )
    return {"project": project, "role": share["role"]}
