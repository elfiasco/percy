"""Percy Enterprise cloud control-plane API prototype."""

from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

from app.cloud.models import (
    AccessRequest,
    ApproveAccessRequestRequest,
    AuditEvent,
    CreateAccessRequestRequest,
    CreateOrganizationRequest,
    CreateProjectRequest,
    CreateTeamRequest,
    DenyAccessRequestRequest,
    Organization,
    OrganizationSummary,
    Project,
    Team,
)
from app.cloud.store import ConflictError, InMemoryControlPlaneStore, NotFoundError


app = FastAPI(title="Percy Enterprise Control Plane", version="0.1.0")
store = InMemoryControlPlaneStore()

ActorHeader = Annotated[str | None, Header(alias="X-Percy-User")]


@app.get("/api/cloud/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/cloud/orgs", response_model=Organization)
def create_organization(req: CreateOrganizationRequest) -> Organization:
    try:
        return store.create_organization(req.name, req.slug, req.owner_user_id)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/cloud/orgs", response_model=list[Organization])
def list_organizations() -> list[Organization]:
    return store.list_organizations()


@app.get("/api/cloud/orgs/{org_id}", response_model=OrganizationSummary)
def get_organization(org_id: str) -> OrganizationSummary:
    try:
        return OrganizationSummary(
            organization=store.get_organization(org_id),
            teams=store.list_teams(org_id),
            projects=store.list_projects(org_id),
            memberships=store.list_memberships(org_id),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/cloud/orgs/{org_id}/teams", response_model=Team)
def create_team(org_id: str, req: CreateTeamRequest, actor_id: ActorHeader = None) -> Team:
    try:
        return store.create_team(
            org_id=org_id,
            name=req.name,
            parent_team_id=req.parent_team_id,
            actor_id=actor_id or "system",
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/cloud/orgs/{org_id}/projects", response_model=Project)
def create_project(org_id: str, req: CreateProjectRequest, actor_id: ActorHeader = None) -> Project:
    try:
        return store.create_project(
            org_id=org_id,
            name=req.name,
            team_id=req.team_id,
            actor_id=actor_id or "system",
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/cloud/projects/{project_id}/access-requests", response_model=AccessRequest)
def create_project_access_request(
    project_id: str, req: CreateAccessRequestRequest
) -> AccessRequest:
    try:
        return store.create_project_access_request(
            project_id=project_id,
            requester_id=req.requester_id,
            requested_role=req.requested_role,
            reason=req.reason,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/cloud/projects/{project_id}/access-requests", response_model=list[AccessRequest])
def list_project_access_requests(project_id: str) -> list[AccessRequest]:
    try:
        store.get_project(project_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return store.list_project_access_requests(project_id)


@app.post("/api/cloud/access-requests/{request_id}/approve", response_model=AccessRequest)
def approve_access_request(request_id: str, req: ApproveAccessRequestRequest) -> AccessRequest:
    try:
        return store.approve_access_request(
            request_id=request_id,
            approver_user_id=req.approver_user_id,
            role=req.role,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/cloud/access-requests/{request_id}/deny", response_model=AccessRequest)
def deny_access_request(request_id: str, req: DenyAccessRequestRequest) -> AccessRequest:
    try:
        return store.deny_access_request(request_id, req.approver_user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/cloud/audit-events", response_model=list[AuditEvent])
def list_audit_events(
    org_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> list[AuditEvent]:
    return store.list_audit_events(
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )

