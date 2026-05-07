"""Project assets API — image/font/file uploads scoped to a project."""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from . import auth, auth_db

log = logging.getLogger("percy.assets")
router = APIRouter(tags=["assets"])

ASSETS_DIR = Path(os.environ.get("PERCY_ASSETS_DIR", "uploads/assets"))
MAX_ASSET_SIZE = 20 * 1024 * 1024  # 20 MB

ALLOWED_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "font/ttf", "font/otf", "font/woff", "font/woff2",
    "application/pdf",
}


def _require_project_access(user: dict[str, Any], project_id: str, min_role: str = "member") -> dict[str, Any]:
    project = auth_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    role = auth_db.check_project_access(user["id"], project_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to this project")
    return project


@router.post("/api/projects/{project_id}/assets")
async def upload_asset(request: Request, project_id: str, file: UploadFile = File(...)):
    user = auth.require_user(request)
    project = _require_project_access(user, project_id)

    data = await file.read()
    if len(data) > MAX_ASSET_SIZE:
        raise HTTPException(status_code=413, detail=f"Asset must be ≤{MAX_ASSET_SIZE // 1024 // 1024} MB")

    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {mime}")

    # Store locally under uploads/assets/{project_id}/{sha256[:8]}_{filename}
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    proj_dir = ASSETS_DIR / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)

    sha = hashlib.sha256(data).hexdigest()[:8]
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in (file.filename or "asset"))
    storage_key = f"{project_id}/{sha}_{safe_name}"
    storage_path = ASSETS_DIR / storage_key
    storage_path.write_bytes(data)

    asset = auth_db.create_project_asset(
        project_id=project_id,
        org_id=project["org_id"],
        name=file.filename or safe_name,
        mime_type=mime,
        size_bytes=len(data),
        storage_key=storage_key,
        created_by=user["id"],
    )
    auth_db.log_audit_event("asset.upload", user_id=user["id"], org_id=project["org_id"],
                            resource_type="asset", resource_id=asset["id"],
                            details={"name": asset["name"], "size": len(data)})
    return asset


@router.get("/api/projects/{project_id}/assets")
def list_assets(request: Request, project_id: str):
    user = auth.require_user(request)
    _require_project_access(user, project_id)
    return {"assets": auth_db.list_project_assets(project_id)}


@router.get("/api/assets/{asset_id}/download")
def download_asset(request: Request, asset_id: str):
    user = auth.require_user(request)
    asset = auth_db.get_project_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    _require_project_access(user, asset["project_id"])
    path = ASSETS_DIR / asset["storage_key"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file not found")
    return FileResponse(str(path), media_type=asset["mime_type"], filename=asset["name"])


@router.delete("/api/assets/{asset_id}")
def delete_asset(request: Request, asset_id: str):
    user = auth.require_user(request)
    asset = auth_db.get_project_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    project = _require_project_access(user, asset["project_id"])
    # Only creator or org admin can delete
    membership = auth_db.get_membership(user["id"], project["org_id"])
    if asset["created_by"] != user["id"] and (not membership or membership["role"] not in ("owner", "admin")):
        raise HTTPException(status_code=403, detail="Cannot delete this asset")
    path = ASSETS_DIR / asset["storage_key"]
    if path.exists():
        path.unlink()
    auth_db.delete_project_asset(asset_id)
    return {"ok": True}
