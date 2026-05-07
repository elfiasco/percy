"""SSO configuration API (SAML / OIDC setup for enterprise orgs)."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import auth, auth_db

log = logging.getLogger("percy.sso")
router = APIRouter(tags=["sso"])


def _require_org_admin(user: dict[str, Any], org_id: str):
    org = auth_db.get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Org not found")
    mem = auth_db.get_membership(user["id"], org_id)
    if not mem or mem["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Org admin required")
    return org


@router.get("/api/orgs/{org_id}/sso")
def get_sso_config(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    cfg = auth_db.get_sso_config(org_id)
    if not cfg:
        return {"configured": False}
    # Redact certificate for display
    safe = {**cfg}
    if safe.get("certificate"):
        safe["certificate"] = safe["certificate"][:40] + "…"
    return {"configured": True, "config": safe}


class SSOConfigRequest(BaseModel):
    provider: str = "saml"
    metadata_url: str | None = None
    metadata_xml: str | None = None
    entity_id: str | None = None
    sso_url: str | None = None
    slo_url: str | None = None
    certificate: str | None = None
    attribute_map: dict | None = None
    enabled: bool = False

@router.put("/api/orgs/{org_id}/sso")
def upsert_sso_config(request: Request, org_id: str, req: SSOConfigRequest):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    cfg = auth_db.upsert_sso_config(org_id, **fields)
    auth_db.log_audit_event("sso.config.update", user_id=user["id"], org_id=org_id,
                            resource_type="sso_config", resource_id=org_id)
    return cfg


@router.delete("/api/orgs/{org_id}/sso")
def delete_sso_config(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    with auth_db.get_conn() as conn:
        conn.execute("DELETE FROM studio_sso_configs WHERE org_id = ?", (org_id,))
    auth_db.log_audit_event("sso.config.delete", user_id=user["id"], org_id=org_id)
    return {"ok": True}


# SCIM provisioning endpoints (stub — implement with real IdP credentials)
@router.get("/api/scim/v2/Users")
def scim_list_users(request: Request):
    # SCIM requires bearer token auth — check X-SCIM-Token header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    scim_token = auth_db.get_scim_token_org(token)
    if not scim_token:
        raise HTTPException(status_code=401, detail="Invalid SCIM token")
    members = auth_db.list_org_members(scim_token["org_id"])
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": len(members),
        "Resources": [
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
                "id": m["id"],
                "userName": m["email"],
                "displayName": m["display_name"],
                "active": True,
            }
            for m in members
        ],
    }
