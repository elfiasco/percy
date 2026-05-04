"""Percy Enterprise cloud control-plane API."""

from __future__ import annotations

import os
import uuid
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
    DocumentDownloadUrl,
    DenyAccessRequestRequest,
    FailJobRequest,
    Job,
    Organization,
    OrganizationSummary,
    PrepareUploadRequest,
    PrepareUploadResponse,
    Project,
    RegisterDocumentRequest,
    StartJobRequest,
    Team,
    UpdateDocumentStatusRequest,
)
from app.cloud.store import ConflictError, InMemoryControlPlaneStore, NotFoundError


def _build_store():
    if os.environ.get("DB_HOST") or os.environ.get("DATABASE_URL"):
        from app.cloud.db import init_pool, run_migrations
        from app.cloud.pg_store import PostgresControlPlaneStore
        init_pool()
        run_migrations()
        return PostgresControlPlaneStore()
    return InMemoryControlPlaneStore()


def _build_storage():
    bucket = os.environ.get("S3_BUCKET")
    if bucket:
        from app.cloud.s3_storage import S3ObjectStorage
        return S3ObjectStorage(bucket=bucket)
    from app.cloud.storage import LocalObjectStorage
    return LocalObjectStorage(root="/tmp/percy-artifacts")


def _build_queue():
    queue_url = os.environ.get("SQS_ONBOARD_QUEUE_URL")
    if queue_url:
        from app.cloud.queue import SQSJobQueue
        return SQSJobQueue(queue_url=queue_url)
    from app.cloud.queue import LocalJobQueue
    return LocalJobQueue()


app = FastAPI(title="Percy Enterprise Control Plane", version="0.1.0")

from app.cloud.auth import ApiKeyMiddleware, get_api_key as _get_api_key
_api_key = _get_api_key()
if _api_key:
    app.add_middleware(ApiKeyMiddleware, api_key=_api_key)

store = _build_store()
storage = _build_storage()
queue = _build_queue()

ActorHeader = Annotated[str | None, Header(alias="X-Percy-User")]


@app.get("/api/cloud/health")
def health() -> dict[str, str]:
    backend = "postgres" if os.environ.get("DB_HOST") else "memory"
    store_backend = "s3" if os.environ.get("S3_BUCKET") else "local"
    return {"status": "ok", "store": backend, "storage": store_backend}


# ------------------------------------------------------------------
# Organizations
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Teams
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Projects
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Documents
# ------------------------------------------------------------------

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


@app.post("/api/cloud/projects/{project_id}/documents/prepare-upload", response_model=PrepareUploadResponse)
def prepare_upload(project_id: str, req: PrepareUploadRequest) -> PrepareUploadResponse:
    """Register a document and return a presigned S3 PUT URL for direct upload."""
    artifact_key = f"uploads/{project_id}/{uuid.uuid4().hex}/{req.name}"
    storage_uri = f"s3://{os.environ.get('S3_BUCKET', 'local')}/{artifact_key}"
    try:
        doc = store.register_document(
            project_id=project_id,
            name=req.name,
            source_format=req.source_format,
            storage_uri=storage_uri,
            content_type=req.content_type,
            size_bytes=req.size_bytes,
            created_by_id=req.created_by_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if hasattr(storage, "generate_presigned_put_url"):
        upload_url = storage.generate_presigned_put_url(
            artifact_key, content_type=req.content_type
        )
    else:
        upload_url = f"/api/cloud/documents/{doc.id}/upload"

    return PrepareUploadResponse(document=doc, upload_url=upload_url)


@app.get("/api/cloud/documents/{document_id}", response_model=Document)
def get_document(document_id: str) -> Document:
    try:
        return store.get_document(document_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/cloud/projects/{project_id}/documents", response_model=list[Document])
def list_project_documents(project_id: str) -> list[Document]:
    try:
        store.get_project(project_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return store.list_project_documents(project_id)


@app.patch("/api/cloud/documents/{document_id}/status", response_model=Document)
def update_document_status(document_id: str, req: UpdateDocumentStatusRequest) -> Document:
    try:
        doc = store.get_document(document_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if hasattr(store, "update_document_status"):
        return store.update_document_status(document_id, req.status, req.bundle_uri)
    # In-memory fallback
    doc.status = req.status
    if req.bundle_uri:
        doc.bundle_uri = req.bundle_uri
    return doc


@app.get("/api/cloud/documents/{document_id}/download-url", response_model=DocumentDownloadUrl)
def get_download_url(document_id: str) -> DocumentDownloadUrl:
    try:
        doc = store.get_document(document_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if doc.storage_uri is None:
        raise HTTPException(status_code=404, detail="No file stored for this document")
    if not hasattr(storage, "generate_presigned_get_url"):
        raise HTTPException(status_code=501, detail="Presigned URLs require S3 storage")
    key = doc.storage_uri.split("/", 3)[-1] if doc.storage_uri.startswith("s3://") else doc.storage_uri
    url = storage.generate_presigned_get_url(key)
    return DocumentDownloadUrl(download_url=url)


# ------------------------------------------------------------------
# Jobs
# ------------------------------------------------------------------

@app.post("/api/cloud/documents/{document_id}/jobs", response_model=Job)
def create_document_job(document_id: str, req: CreateJobRequest) -> Job:
    try:
        job = store.create_document_job(
            document_id=document_id,
            job_type=req.job_type,
            requested_by_id=req.requested_by_id,
            parameters=req.parameters,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    queue.enqueue(job.id, job.job_type, {"document_id": document_id, **req.parameters})
    return job


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


# ------------------------------------------------------------------
# Access requests
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Audit events
# ------------------------------------------------------------------

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
