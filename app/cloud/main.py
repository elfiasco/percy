"""Percy Enterprise cloud control-plane API prototype."""

from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

from app.cloud.models import (
    AccessRequest,
    ApproveAccessRequestRequest,
    AuditEvent,
    CompleteJobRequest,
    CreateAccessRequestRequest,
    CreateJobRequest,
    CreateOrganizationRequest,
    CreateProjectRequest,
    CreateTeamRequest,
    Document,
    FailJobRequest,
    Job,
    DenyAccessRequestRequest,
    Organization,
    OrganizationSummary,
    Project,
    RegisterDocumentRequest,
    StartJobRequest,
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


@app.post("/api/cloud/projects/{project_id}/documents", response_model=Document)
def register_document(project_id: str, req: RegisterDocumentRequest) -> Document:
    try:
        return store.register_document(
            project_id=project_id,
            name=req.name,
            source_format=req.source_format,
            storage_uri=req.storage_uri,
            content_type=req.content_type,
            size_bytes=req.size_bytes,
            created_by_id=req.created_by_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/cloud/projects/{project_id}/documents", response_model=list[Document])
def list_project_documents(project_id: str) -> list[Document]:
    try:
        store.get_project(project_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return store.list_project_documents(project_id)


@app.post("/api/cloud/documents/{document_id}/jobs", response_model=Job)
def create_document_job(document_id: str, req: CreateJobRequest) -> Job:
    try:
        return store.create_document_job(
            document_id=document_id,
            job_type=req.job_type,
            requested_by_id=req.requested_by_id,
            parameters=req.parameters,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/cloud/projects/{project_id}/jobs", response_model=list[Job])
def list_project_jobs(project_id: str) -> list[Job]:
    try:
        store.get_project(project_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return store.list_project_jobs(project_id)


@app.get("/api/cloud/jobs/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    try:
        return store.get_job(job_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/cloud/jobs/{job_id}/start", response_model=Job)
def start_job(job_id: str, req: StartJobRequest) -> Job:
    try:
        return store.start_job(job_id, worker_id=req.worker_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/cloud/jobs/{job_id}/complete", response_model=Job)
def complete_job(job_id: str, req: CompleteJobRequest) -> Job:
    try:
        return store.complete_job(job_id, worker_id=req.worker_id, result=req.result)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/cloud/jobs/{job_id}/fail", response_model=Job)
def fail_job(job_id: str, req: FailJobRequest) -> Job:
    try:
        return store.fail_job(job_id, worker_id=req.worker_id, error=req.error)
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
