"""Billing and subscription management API."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import auth, auth_db

log = logging.getLogger("percy.billing")
router = APIRouter(tags=["billing"])


def _require_org_admin(user: dict[str, Any], org_id: str):
    org = auth_db.get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Org not found")
    mem = auth_db.get_membership(user["id"], org_id)
    if not mem or mem["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Org admin required")
    return org


@router.get("/api/plans")
def list_plans(request: Request):
    auth.require_user(request)
    return {"plans": auth_db.list_plans()}


@router.get("/api/orgs/{org_id}/subscription")
def get_subscription(request: Request, org_id: str):
    user = auth.require_user(request)
    mem = auth_db.get_membership(user["id"], org_id)
    if not mem:
        raise HTTPException(status_code=403, detail="Not a member")
    sub = auth_db.get_org_subscription(org_id)
    seats_used = auth_db.count_org_seats_used(org_id)
    plan = None
    if sub:
        with auth_db.get_conn() as conn:
            plan = conn.execute("SELECT * FROM studio_plans WHERE id = ?", (sub["plan_id"],)).fetchone()
    return {
        "subscription": sub,
        "plan": plan,
        "seats_used": seats_used,
        "seats_available": (sub.get("seats_purchased") or 5) - seats_used,
    }


class UpdateSubscriptionRequest(BaseModel):
    plan_id: str | None = None
    seats_purchased: int | None = None

@router.patch("/api/orgs/{org_id}/subscription")
def update_subscription(request: Request, org_id: str, req: UpdateSubscriptionRequest):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        return auth_db.get_org_subscription(org_id)
    sub = auth_db.update_org_subscription(org_id, **fields)
    auth_db.log_audit_event("subscription.update", user_id=user["id"], org_id=org_id,
                            resource_type="subscription", resource_id=org_id, details=fields)
    return sub
