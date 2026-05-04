"""Local development repository for Percy Enterprise control-plane state."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from app.cloud.models import (
    AccessRequest,
    AuditEvent,
    Document,
    Membership,
    Organization,
    Project,
    Job,
    JobType,
    Role,
    SourceFormat,
    Team,
)


class NotFoundError(KeyError):
    """Raised when a control-plane object does not exist."""


class ConflictError(ValueError):
    """Raised when a control-plane object conflicts with existing state."""


class InMemoryControlPlaneStore:
    """Small local store used until the Postgres repository is added."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.organizations: dict[str, Organization] = {}
        self.org_slug_index: dict[str, str] = {}
        self.teams: dict[str, Team] = {}
        self.projects: dict[str, Project] = {}
        self.documents: dict[str, Document] = {}
        self.jobs: dict[str, Job] = {}
        self.memberships: dict[str, Membership] = {}
        self.access_requests: dict[str, AccessRequest] = {}
        self.audit_events: list[AuditEvent] = []

    def create_organization(self, name: str, slug: str, owner_user_id: str) -> Organization:
        with self._lock:
            normalized_slug = slug.strip().lower()
            if normalized_slug in self.org_slug_index:
                raise ConflictError(f"Organization slug already exists: {normalized_slug}")
            org = Organization(id=_new_id("org"), name=name, slug=normalized_slug)
            self.organizations[org.id] = org
            self.org_slug_index[normalized_slug] = org.id
            self.add_membership(
                org_id=org.id,
                user_id=owner_user_id,
                role="org_admin",
            )
            self.add_audit_event(
                org_id=org.id,
                actor_id=owner_user_id,
                action="organization.created",
                resource_type="organization",
                resource_id=org.id,
                details={"name": name, "slug": normalized_slug},
            )
            return org

    def get_organization(self, org_id: str) -> Organization:
        try:
            return self.organizations[org_id]
        except KeyError as exc:
            raise NotFoundError(f"Organization not found: {org_id}") from exc

    def list_organizations(self) -> list[Organization]:
        return sorted(self.organizations.values(), key=lambda org: org.created_at)

    def create_team(self, org_id: str, name: str, parent_team_id: str | None, actor_id: str) -> Team:
        with self._lock:
            self.get_organization(org_id)
            if parent_team_id is not None:
                parent = self.get_team(parent_team_id)
                if parent.org_id != org_id:
                    raise ConflictError("Parent team belongs to a different organization")
            team = Team(id=_new_id("team"), org_id=org_id, name=name, parent_team_id=parent_team_id)
            self.teams[team.id] = team
            self.add_audit_event(
                org_id=org_id,
                actor_id=actor_id,
                action="team.created",
                resource_type="team",
                resource_id=team.id,
                details={"name": name, "parent_team_id": parent_team_id},
            )
            return team

    def get_team(self, team_id: str) -> Team:
        try:
            return self.teams[team_id]
        except KeyError as exc:
            raise NotFoundError(f"Team not found: {team_id}") from exc

    def list_teams(self, org_id: str) -> list[Team]:
        return sorted(
            [team for team in self.teams.values() if team.org_id == org_id],
            key=lambda team: team.created_at,
        )

    def create_project(self, org_id: str, name: str, team_id: str | None, actor_id: str) -> Project:
        with self._lock:
            self.get_organization(org_id)
            if team_id is not None:
                team = self.get_team(team_id)
                if team.org_id != org_id:
                    raise ConflictError("Project team belongs to a different organization")
            project = Project(id=_new_id("project"), org_id=org_id, name=name, team_id=team_id)
            self.projects[project.id] = project
            self.add_audit_event(
                org_id=org_id,
                actor_id=actor_id,
                action="project.created",
                resource_type="project",
                resource_id=project.id,
                details={"name": name, "team_id": team_id},
            )
            return project

    def get_project(self, project_id: str) -> Project:
        try:
            return self.projects[project_id]
        except KeyError as exc:
            raise NotFoundError(f"Project not found: {project_id}") from exc

    def list_projects(self, org_id: str) -> list[Project]:
        return sorted(
            [project for project in self.projects.values() if project.org_id == org_id],
            key=lambda project: project.created_at,
        )

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
        with self._lock:
            project = self.get_project(project_id)
            document = Document(
                id=_new_id("doc"),
                org_id=project.org_id,
                project_id=project.id,
                name=name,
                source_format=source_format,
                storage_uri=storage_uri,
                content_type=content_type,
                size_bytes=size_bytes,
                created_by_id=created_by_id,
            )
            self.documents[document.id] = document
            self.add_audit_event(
                org_id=project.org_id,
                actor_id=created_by_id,
                action="document.registered",
                resource_type="document",
                resource_id=document.id,
                details={
                    "project_id": project.id,
                    "name": name,
                    "source_format": source_format,
                    "storage_uri": storage_uri,
                },
            )
            return document

    def get_document(self, document_id: str) -> Document:
        try:
            return self.documents[document_id]
        except KeyError as exc:
            raise NotFoundError(f"Document not found: {document_id}") from exc

    def list_project_documents(self, project_id: str) -> list[Document]:
        return sorted(
            [document for document in self.documents.values() if document.project_id == project_id],
            key=lambda document: document.created_at,
        )

    def create_document_job(
        self,
        document_id: str,
        job_type: JobType,
        requested_by_id: str,
        parameters: dict[str, Any] | None = None,
    ) -> Job:
        with self._lock:
            document = self.get_document(document_id)
            job = Job(
                id=_new_id("job"),
                org_id=document.org_id,
                project_id=document.project_id,
                document_id=document.id,
                job_type=job_type,
                requested_by_id=requested_by_id,
                parameters=parameters or {},
            )
            self.jobs[job.id] = job
            self.add_audit_event(
                org_id=document.org_id,
                actor_id=requested_by_id,
                action="job.queued",
                resource_type="job",
                resource_id=job.id,
                details={
                    "document_id": document.id,
                    "project_id": document.project_id,
                    "job_type": job_type,
                },
            )
            return job

    def get_job(self, job_id: str) -> Job:
        try:
            return self.jobs[job_id]
        except KeyError as exc:
            raise NotFoundError(f"Job not found: {job_id}") from exc

    def list_project_jobs(self, project_id: str) -> list[Job]:
        return sorted(
            [job for job in self.jobs.values() if job.project_id == project_id],
            key=lambda job: job.created_at,
            reverse=True,
        )

    def start_job(self, job_id: str, worker_id: str) -> Job:
        with self._lock:
            job = self.get_job(job_id)
            if job.status != "queued":
                raise ConflictError(f"Job is {job.status}, not queued")
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            self.add_audit_event(
                org_id=job.org_id,
                actor_id=worker_id,
                action="job.started",
                resource_type="job",
                resource_id=job.id,
                details={"worker_id": worker_id, "job_type": job.job_type},
            )
            return job

    def complete_job(self, job_id: str, worker_id: str, result: dict[str, Any] | None = None) -> Job:
        with self._lock:
            job = self.get_job(job_id)
            if job.status not in {"queued", "running"}:
                raise ConflictError(f"Job is already {job.status}")
            if job.started_at is None:
                job.started_at = datetime.now(timezone.utc)
            job.status = "completed"
            job.result = result or {}
            job.finished_at = datetime.now(timezone.utc)
            self.add_audit_event(
                org_id=job.org_id,
                actor_id=worker_id,
                action="job.completed",
                resource_type="job",
                resource_id=job.id,
                details={"worker_id": worker_id, "job_type": job.job_type},
            )
            return job

    def fail_job(self, job_id: str, worker_id: str, error: str) -> Job:
        with self._lock:
            job = self.get_job(job_id)
            if job.status in {"completed", "failed", "canceled"}:
                raise ConflictError(f"Job is already {job.status}")
            if job.started_at is None:
                job.started_at = datetime.now(timezone.utc)
            job.status = "failed"
            job.error = error
            job.finished_at = datetime.now(timezone.utc)
            self.add_audit_event(
                org_id=job.org_id,
                actor_id=worker_id,
                action="job.failed",
                resource_type="job",
                resource_id=job.id,
                details={"worker_id": worker_id, "job_type": job.job_type, "error": error},
            )
            return job

    def add_membership(
        self,
        org_id: str,
        user_id: str,
        role: Role,
        team_id: str | None = None,
        project_id: str | None = None,
    ) -> Membership:
        membership = Membership(
            id=_new_id("membership"),
            org_id=org_id,
            user_id=user_id,
            role=role,
            team_id=team_id,
            project_id=project_id,
        )
        self.memberships[membership.id] = membership
        return membership

    def list_memberships(self, org_id: str) -> list[Membership]:
        return sorted(
            [membership for membership in self.memberships.values() if membership.org_id == org_id],
            key=lambda membership: membership.created_at,
        )

    def create_project_access_request(
        self,
        project_id: str,
        requester_id: str,
        requested_role: Role,
        reason: str | None,
    ) -> AccessRequest:
        with self._lock:
            project = self.get_project(project_id)
            access_request = AccessRequest(
                id=_new_id("access"),
                org_id=project.org_id,
                requester_id=requester_id,
                target_type="project",
                target_id=project.id,
                requested_role=requested_role,
                reason=reason,
            )
            self.access_requests[access_request.id] = access_request
            self.add_audit_event(
                org_id=project.org_id,
                actor_id=requester_id,
                action="access.requested",
                resource_type="project",
                resource_id=project.id,
                details={"access_request_id": access_request.id, "requested_role": requested_role},
            )
            return access_request

    def list_project_access_requests(self, project_id: str) -> list[AccessRequest]:
        return sorted(
            [
                request
                for request in self.access_requests.values()
                if request.target_type == "project" and request.target_id == project_id
            ],
            key=lambda request: request.created_at,
        )

    def approve_access_request(
        self,
        request_id: str,
        approver_user_id: str,
        role: Role | None = None,
    ) -> AccessRequest:
        with self._lock:
            access_request = self.get_access_request(request_id)
            if access_request.status != "pending":
                raise ConflictError(f"Access request is already {access_request.status}")
            approved_role = role or access_request.requested_role
            access_request.status = "approved"
            access_request.decided_by_id = approver_user_id
            access_request.decided_at = datetime.now(timezone.utc)
            self.add_membership(
                org_id=access_request.org_id,
                user_id=access_request.requester_id,
                role=approved_role,
                project_id=access_request.target_id if access_request.target_type == "project" else None,
                team_id=access_request.target_id if access_request.target_type == "team" else None,
            )
            self.add_audit_event(
                org_id=access_request.org_id,
                actor_id=approver_user_id,
                action="access.approved",
                resource_type=access_request.target_type,
                resource_id=access_request.target_id,
                details={
                    "access_request_id": access_request.id,
                    "requester_id": access_request.requester_id,
                    "role": approved_role,
                },
            )
            return access_request

    def deny_access_request(self, request_id: str, approver_user_id: str) -> AccessRequest:
        with self._lock:
            access_request = self.get_access_request(request_id)
            if access_request.status != "pending":
                raise ConflictError(f"Access request is already {access_request.status}")
            access_request.status = "denied"
            access_request.decided_by_id = approver_user_id
            access_request.decided_at = datetime.now(timezone.utc)
            self.add_audit_event(
                org_id=access_request.org_id,
                actor_id=approver_user_id,
                action="access.denied",
                resource_type=access_request.target_type,
                resource_id=access_request.target_id,
                details={
                    "access_request_id": access_request.id,
                    "requester_id": access_request.requester_id,
                },
            )
            return access_request

    def get_access_request(self, request_id: str) -> AccessRequest:
        try:
            return self.access_requests[request_id]
        except KeyError as exc:
            raise NotFoundError(f"Access request not found: {request_id}") from exc

    def add_audit_event(
        self,
        org_id: str | None,
        actor_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            id=_new_id("audit"),
            org_id=org_id,
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
        )
        self.audit_events.append(event)
        return event

    def list_audit_events(
        self,
        org_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[AuditEvent]:
        events = self.audit_events
        if org_id is not None:
            events = [event for event in events if event.org_id == org_id]
        if resource_type is not None:
            events = [event for event in events if event.resource_type == resource_type]
        if resource_id is not None:
            events = [event for event in events if event.resource_id == resource_id]
        return sorted(events, key=lambda event: event.created_at, reverse=True)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"
