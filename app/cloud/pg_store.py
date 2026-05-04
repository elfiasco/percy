"""Postgres-backed control-plane store for Percy Enterprise."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2.extras

from app.cloud.db import get_conn
from app.cloud.models import (
    AccessRequest,
    AuditEvent,
    Document,
    Job,
    JobType,
    Membership,
    Organization,
    Project,
    Role,
    SourceFormat,
    Team,
)
from app.cloud.store import ConflictError, NotFoundError


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _row(conn, query: str, params=()) -> dict | None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        return cur.fetchone()


def _rows(conn, query: str, params=()) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        return cur.fetchall()


def _exec(conn, query: str, params=()) -> None:
    with conn.cursor() as cur:
        cur.execute(query, params)


class PostgresControlPlaneStore:
    """Production store backed by RDS Postgres."""

    # ------------------------------------------------------------------
    # Organizations
    # ------------------------------------------------------------------

    def create_organization(self, name: str, slug: str, owner_user_id: str) -> Organization:
        normalized = slug.strip().lower()
        with get_conn() as conn:
            existing = _row(conn, "SELECT id FROM organizations WHERE slug = %s", (normalized,))
            if existing:
                raise ConflictError(f"Organization slug already exists: {normalized}")
            org_id = _new_id("org")
            _exec(
                conn,
                "INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)",
                (org_id, name, normalized),
            )
            self._add_membership_conn(conn, org_id=org_id, user_id=owner_user_id, role="org_admin")
            self._add_audit_conn(
                conn,
                org_id=org_id,
                actor_id=owner_user_id,
                action="organization.created",
                resource_type="organization",
                resource_id=org_id,
                details={"name": name, "slug": normalized},
            )
            return self._org_from_row(_row(conn, "SELECT * FROM organizations WHERE id = %s", (org_id,)))

    def get_organization(self, org_id: str) -> Organization:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM organizations WHERE id = %s", (org_id,))
        if not row:
            raise NotFoundError(f"Organization not found: {org_id}")
        return self._org_from_row(row)

    def list_organizations(self) -> list[Organization]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM organizations ORDER BY created_at")
        return [self._org_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Teams
    # ------------------------------------------------------------------

    def create_team(self, org_id: str, name: str, parent_team_id: str | None, actor_id: str) -> Team:
        with get_conn() as conn:
            if not _row(conn, "SELECT id FROM organizations WHERE id = %s", (org_id,)):
                raise NotFoundError(f"Organization not found: {org_id}")
            if parent_team_id:
                parent = _row(conn, "SELECT org_id FROM teams WHERE id = %s", (parent_team_id,))
                if not parent:
                    raise NotFoundError(f"Team not found: {parent_team_id}")
                if parent["org_id"] != org_id:
                    raise ConflictError("Parent team belongs to a different organization")
            team_id = _new_id("team")
            _exec(
                conn,
                "INSERT INTO teams (id, org_id, name, parent_team_id) VALUES (%s, %s, %s, %s)",
                (team_id, org_id, name, parent_team_id),
            )
            self._add_audit_conn(
                conn, org_id=org_id, actor_id=actor_id,
                action="team.created", resource_type="team", resource_id=team_id,
                details={"name": name, "parent_team_id": parent_team_id},
            )
            return self._team_from_row(_row(conn, "SELECT * FROM teams WHERE id = %s", (team_id,)))

    def get_team(self, team_id: str) -> Team:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM teams WHERE id = %s", (team_id,))
        if not row:
            raise NotFoundError(f"Team not found: {team_id}")
        return self._team_from_row(row)

    def list_teams(self, org_id: str) -> list[Team]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM teams WHERE org_id = %s ORDER BY created_at", (org_id,))
        return [self._team_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    def create_project(self, org_id: str, name: str, team_id: str | None, actor_id: str) -> Project:
        with get_conn() as conn:
            if not _row(conn, "SELECT id FROM organizations WHERE id = %s", (org_id,)):
                raise NotFoundError(f"Organization not found: {org_id}")
            if team_id:
                team = _row(conn, "SELECT org_id FROM teams WHERE id = %s", (team_id,))
                if not team:
                    raise NotFoundError(f"Team not found: {team_id}")
                if team["org_id"] != org_id:
                    raise ConflictError("Project team belongs to a different organization")
            project_id = _new_id("project")
            _exec(
                conn,
                "INSERT INTO projects (id, org_id, name, team_id) VALUES (%s, %s, %s, %s)",
                (project_id, org_id, name, team_id),
            )
            self._add_audit_conn(
                conn, org_id=org_id, actor_id=actor_id,
                action="project.created", resource_type="project", resource_id=project_id,
                details={"name": name, "team_id": team_id},
            )
            return self._project_from_row(_row(conn, "SELECT * FROM projects WHERE id = %s", (project_id,)))

    def get_project(self, project_id: str) -> Project:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
        if not row:
            raise NotFoundError(f"Project not found: {project_id}")
        return self._project_from_row(row)

    def list_projects(self, org_id: str) -> list[Project]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM projects WHERE org_id = %s ORDER BY created_at", (org_id,))
        return [self._project_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------

    def register_document(
        self,
        project_id: str,
        name: str,
        source_format: SourceFormat,
        storage_uri: str | None,
        content_type: str | None,
        size_bytes: int | None,
        created_by_id: str,
    ) -> Document:
        with get_conn() as conn:
            project = _row(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
            if not project:
                raise NotFoundError(f"Project not found: {project_id}")
            doc_id = _new_id("doc")
            _exec(
                conn,
                """INSERT INTO documents
                   (id, org_id, project_id, name, source_format, storage_uri, content_type, size_bytes, created_by_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (doc_id, project["org_id"], project_id, name, source_format,
                 storage_uri, content_type, size_bytes, created_by_id),
            )
            self._add_audit_conn(
                conn, org_id=project["org_id"], actor_id=created_by_id,
                action="document.registered", resource_type="document", resource_id=doc_id,
                details={"project_id": project_id, "name": name, "source_format": source_format, "storage_uri": storage_uri},
            )
            return self._doc_from_row(_row(conn, "SELECT * FROM documents WHERE id = %s", (doc_id,)))

    def get_document(self, document_id: str) -> Document:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM documents WHERE id = %s", (document_id,))
        if not row:
            raise NotFoundError(f"Document not found: {document_id}")
        return self._doc_from_row(row)

    def list_project_documents(self, project_id: str) -> list[Document]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM documents WHERE project_id = %s ORDER BY created_at", (project_id,))
        return [self._doc_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    def create_document_job(
        self,
        document_id: str,
        job_type: JobType,
        requested_by_id: str,
        parameters: dict[str, Any] | None = None,
    ) -> Job:
        import json as _json
        with get_conn() as conn:
            doc = _row(conn, "SELECT * FROM documents WHERE id = %s", (document_id,))
            if not doc:
                raise NotFoundError(f"Document not found: {document_id}")
            job_id = _new_id("job")
            _exec(
                conn,
                """INSERT INTO jobs (id, org_id, project_id, document_id, job_type, requested_by_id, parameters)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (job_id, doc["org_id"], doc["project_id"], document_id, job_type,
                 requested_by_id, _json.dumps(parameters or {})),
            )
            self._add_audit_conn(
                conn, org_id=doc["org_id"], actor_id=requested_by_id,
                action="job.queued", resource_type="job", resource_id=job_id,
                details={"document_id": document_id, "project_id": doc["project_id"], "job_type": job_type},
            )
            return self._job_from_row(_row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,)))

    def get_job(self, job_id: str) -> Job:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,))
        if not row:
            raise NotFoundError(f"Job not found: {job_id}")
        return self._job_from_row(row)

    def list_project_jobs(self, project_id: str) -> list[Job]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM jobs WHERE project_id = %s ORDER BY created_at DESC", (project_id,))
        return [self._job_from_row(r) for r in rows]

    def start_job(self, job_id: str, worker_id: str) -> Job:
        with get_conn() as conn:
            job_row = _row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,))
            if not job_row:
                raise NotFoundError(f"Job not found: {job_id}")
            if job_row["status"] != "queued":
                raise ConflictError(f"Job is {job_row['status']}, not queued")
            _exec(
                conn,
                "UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = %s",
                (job_id,),
            )
            self._add_audit_conn(
                conn, org_id=job_row["org_id"], actor_id=worker_id,
                action="job.started", resource_type="job", resource_id=job_id,
                details={"worker_id": worker_id, "job_type": job_row["job_type"]},
            )
            return self._job_from_row(_row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,)))

    def complete_job(self, job_id: str, worker_id: str, result: dict[str, Any] | None = None) -> Job:
        import json as _json
        with get_conn() as conn:
            job_row = _row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,))
            if not job_row:
                raise NotFoundError(f"Job not found: {job_id}")
            if job_row["status"] not in ("queued", "running"):
                raise ConflictError(f"Job is already {job_row['status']}")
            _exec(
                conn,
                """UPDATE jobs SET status = 'completed', result = %s, finished_at = NOW(),
                   started_at = COALESCE(started_at, NOW()) WHERE id = %s""",
                (_json.dumps(result or {}), job_id),
            )
            self._add_audit_conn(
                conn, org_id=job_row["org_id"], actor_id=worker_id,
                action="job.completed", resource_type="job", resource_id=job_id,
                details={"worker_id": worker_id, "job_type": job_row["job_type"]},
            )
            return self._job_from_row(_row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,)))

    def fail_job(self, job_id: str, worker_id: str, error: str) -> Job:
        with get_conn() as conn:
            job_row = _row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,))
            if not job_row:
                raise NotFoundError(f"Job not found: {job_id}")
            if job_row["status"] in ("completed", "failed", "canceled"):
                raise ConflictError(f"Job is already {job_row['status']}")
            _exec(
                conn,
                """UPDATE jobs SET status = 'failed', error = %s, finished_at = NOW(),
                   started_at = COALESCE(started_at, NOW()) WHERE id = %s""",
                (error, job_id),
            )
            self._add_audit_conn(
                conn, org_id=job_row["org_id"], actor_id=worker_id,
                action="job.failed", resource_type="job", resource_id=job_id,
                details={"worker_id": worker_id, "job_type": job_row["job_type"], "error": error},
            )
            return self._job_from_row(_row(conn, "SELECT * FROM jobs WHERE id = %s", (job_id,)))

    # ------------------------------------------------------------------
    # Memberships
    # ------------------------------------------------------------------

    def add_membership(
        self,
        org_id: str,
        user_id: str,
        role: Role,
        team_id: str | None = None,
        project_id: str | None = None,
    ) -> Membership:
        with get_conn() as conn:
            return self._add_membership_conn(conn, org_id=org_id, user_id=user_id, role=role,
                                              team_id=team_id, project_id=project_id)

    def _add_membership_conn(self, conn, org_id, user_id, role, team_id=None, project_id=None) -> Membership:
        mid = _new_id("membership")
        _exec(
            conn,
            "INSERT INTO memberships (id, org_id, user_id, role, team_id, project_id) VALUES (%s,%s,%s,%s,%s,%s)",
            (mid, org_id, user_id, role, team_id, project_id),
        )
        return self._membership_from_row(_row(conn, "SELECT * FROM memberships WHERE id = %s", (mid,)))

    def list_memberships(self, org_id: str) -> list[Membership]:
        with get_conn() as conn:
            rows = _rows(conn, "SELECT * FROM memberships WHERE org_id = %s ORDER BY created_at", (org_id,))
        return [self._membership_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Access requests
    # ------------------------------------------------------------------

    def create_project_access_request(
        self,
        project_id: str,
        requester_id: str,
        requested_role: Role,
        reason: str | None,
    ) -> AccessRequest:
        with get_conn() as conn:
            project = _row(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
            if not project:
                raise NotFoundError(f"Project not found: {project_id}")
            req_id = _new_id("access")
            _exec(
                conn,
                """INSERT INTO access_requests
                   (id, org_id, requester_id, target_type, target_id, requested_role, reason)
                   VALUES (%s, %s, %s, 'project', %s, %s, %s)""",
                (req_id, project["org_id"], requester_id, project_id, requested_role, reason),
            )
            self._add_audit_conn(
                conn, org_id=project["org_id"], actor_id=requester_id,
                action="access.requested", resource_type="project", resource_id=project_id,
                details={"access_request_id": req_id, "requested_role": requested_role},
            )
            return self._access_request_from_row(_row(conn, "SELECT * FROM access_requests WHERE id = %s", (req_id,)))

    def list_project_access_requests(self, project_id: str) -> list[AccessRequest]:
        with get_conn() as conn:
            rows = _rows(
                conn,
                "SELECT * FROM access_requests WHERE target_type = 'project' AND target_id = %s ORDER BY created_at",
                (project_id,),
            )
        return [self._access_request_from_row(r) for r in rows]

    def approve_access_request(
        self,
        request_id: str,
        approver_user_id: str,
        role: Role | None = None,
    ) -> AccessRequest:
        with get_conn() as conn:
            req = _row(conn, "SELECT * FROM access_requests WHERE id = %s", (request_id,))
            if not req:
                raise NotFoundError(f"Access request not found: {request_id}")
            if req["status"] != "pending":
                raise ConflictError(f"Access request is already {req['status']}")
            approved_role = role or req["requested_role"]
            _exec(
                conn,
                "UPDATE access_requests SET status = 'approved', decided_by_id = %s, decided_at = NOW() WHERE id = %s",
                (approver_user_id, request_id),
            )
            self._add_membership_conn(
                conn,
                org_id=req["org_id"],
                user_id=req["requester_id"],
                role=approved_role,
                project_id=req["target_id"] if req["target_type"] == "project" else None,
                team_id=req["target_id"] if req["target_type"] == "team" else None,
            )
            self._add_audit_conn(
                conn, org_id=req["org_id"], actor_id=approver_user_id,
                action="access.approved", resource_type=req["target_type"], resource_id=req["target_id"],
                details={"access_request_id": request_id, "requester_id": req["requester_id"], "role": approved_role},
            )
            return self._access_request_from_row(_row(conn, "SELECT * FROM access_requests WHERE id = %s", (request_id,)))

    def deny_access_request(self, request_id: str, approver_user_id: str) -> AccessRequest:
        with get_conn() as conn:
            req = _row(conn, "SELECT * FROM access_requests WHERE id = %s", (request_id,))
            if not req:
                raise NotFoundError(f"Access request not found: {request_id}")
            if req["status"] != "pending":
                raise ConflictError(f"Access request is already {req['status']}")
            _exec(
                conn,
                "UPDATE access_requests SET status = 'denied', decided_by_id = %s, decided_at = NOW() WHERE id = %s",
                (approver_user_id, request_id),
            )
            self._add_audit_conn(
                conn, org_id=req["org_id"], actor_id=approver_user_id,
                action="access.denied", resource_type=req["target_type"], resource_id=req["target_id"],
                details={"access_request_id": request_id, "requester_id": req["requester_id"]},
            )
            return self._access_request_from_row(_row(conn, "SELECT * FROM access_requests WHERE id = %s", (request_id,)))

    def get_access_request(self, request_id: str) -> AccessRequest:
        with get_conn() as conn:
            row = _row(conn, "SELECT * FROM access_requests WHERE id = %s", (request_id,))
        if not row:
            raise NotFoundError(f"Access request not found: {request_id}")
        return self._access_request_from_row(row)

    # ------------------------------------------------------------------
    # Audit events
    # ------------------------------------------------------------------

    def add_audit_event(
        self,
        org_id: str | None,
        actor_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
    ) -> AuditEvent:
        with get_conn() as conn:
            return self._add_audit_conn(
                conn, org_id=org_id, actor_id=actor_id, action=action,
                resource_type=resource_type, resource_id=resource_id, details=details,
            )

    def _add_audit_conn(self, conn, org_id, actor_id, action, resource_type, resource_id, details=None) -> AuditEvent:
        import json as _json
        event_id = _new_id("audit")
        _exec(
            conn,
            """INSERT INTO audit_events (id, org_id, actor_id, action, resource_type, resource_id, details)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (event_id, org_id, actor_id, action, resource_type, resource_id, _json.dumps(details or {})),
        )
        return self._audit_from_row(_row(conn, "SELECT * FROM audit_events WHERE id = %s", (event_id,)))

    def list_audit_events(
        self,
        org_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[AuditEvent]:
        filters = []
        params = []
        if org_id:
            filters.append("org_id = %s")
            params.append(org_id)
        if resource_type:
            filters.append("resource_type = %s")
            params.append(resource_type)
        if resource_id:
            filters.append("resource_id = %s")
            params.append(resource_id)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        with get_conn() as conn:
            rows = _rows(conn, f"SELECT * FROM audit_events {where} ORDER BY created_at DESC", params)
        return [self._audit_from_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Row mappers
    # ------------------------------------------------------------------

    def _org_from_row(self, r: dict) -> Organization:
        return Organization(id=r["id"], name=r["name"], slug=r["slug"], created_at=r["created_at"])

    def _team_from_row(self, r: dict) -> Team:
        return Team(id=r["id"], org_id=r["org_id"], name=r["name"],
                    parent_team_id=r["parent_team_id"], created_at=r["created_at"])

    def _project_from_row(self, r: dict) -> Project:
        return Project(id=r["id"], org_id=r["org_id"], name=r["name"],
                       team_id=r["team_id"], created_at=r["created_at"])

    def _doc_from_row(self, r: dict) -> Document:
        return Document(
            id=r["id"], org_id=r["org_id"], project_id=r["project_id"],
            name=r["name"], source_format=r["source_format"],
            storage_uri=r["storage_uri"], content_type=r["content_type"],
            size_bytes=r["size_bytes"], created_by_id=r["created_by_id"],
            created_at=r["created_at"],
        )

    def _job_from_row(self, r: dict) -> Job:
        return Job(
            id=r["id"], org_id=r["org_id"], project_id=r["project_id"],
            document_id=r["document_id"], job_type=r["job_type"], status=r["status"],
            requested_by_id=r["requested_by_id"],
            parameters=r["parameters"] if isinstance(r["parameters"], dict) else {},
            result=r["result"] if isinstance(r["result"], dict) else {},
            error=r["error"], created_at=r["created_at"],
            started_at=r["started_at"], finished_at=r["finished_at"],
        )

    def _membership_from_row(self, r: dict) -> Membership:
        return Membership(id=r["id"], org_id=r["org_id"], user_id=r["user_id"],
                          role=r["role"], team_id=r["team_id"], project_id=r["project_id"],
                          created_at=r["created_at"])

    def _access_request_from_row(self, r: dict) -> AccessRequest:
        return AccessRequest(
            id=r["id"], org_id=r["org_id"], requester_id=r["requester_id"],
            target_type=r["target_type"], target_id=r["target_id"],
            requested_role=r["requested_role"], reason=r["reason"],
            status=r["status"], decided_by_id=r["decided_by_id"],
            decided_at=r["decided_at"], created_at=r["created_at"],
        )

    def _audit_from_row(self, r: dict) -> AuditEvent:
        return AuditEvent(
            id=r["id"], org_id=r["org_id"], actor_id=r["actor_id"],
            action=r["action"], resource_type=r["resource_type"],
            resource_id=r["resource_id"],
            details=r["details"] if isinstance(r["details"], dict) else {},
            created_at=r["created_at"],
        )
