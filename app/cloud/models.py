"""Cloud control-plane models for Percy Enterprise."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


Role = Literal[
    "org_admin",
    "workspace_admin",
    "project_owner",
    "editor",
    "reviewer",
    "viewer",
    "data_admin",
    "environment_admin",
    "security_admin",
]

AccessStatus = Literal["pending", "approved", "denied"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserRef(BaseModel):
    id: str
    email: str | None = None
    display_name: str | None = None


class Organization(BaseModel):
    id: str
    name: str
    slug: str
    created_at: datetime = Field(default_factory=utc_now)


class Team(BaseModel):
    id: str
    org_id: str
    name: str
    parent_team_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Project(BaseModel):
    id: str
    org_id: str
    name: str
    team_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Membership(BaseModel):
    id: str
    org_id: str
    user_id: str
    role: Role
    team_id: str | None = None
    project_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class AccessRequest(BaseModel):
    id: str
    org_id: str
    requester_id: str
    target_type: Literal["project", "team"]
    target_id: str
    requested_role: Role
    reason: str | None = None
    status: AccessStatus = "pending"
    decided_by_id: str | None = None
    decided_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)


class AuditEvent(BaseModel):
    id: str
    org_id: str | None = None
    actor_id: str
    action: str
    resource_type: str
    resource_id: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class CreateOrganizationRequest(BaseModel):
    name: str
    slug: str
    owner_user_id: str


class CreateTeamRequest(BaseModel):
    name: str
    parent_team_id: str | None = None


class CreateProjectRequest(BaseModel):
    name: str
    team_id: str | None = None


class CreateAccessRequestRequest(BaseModel):
    requester_id: str
    requested_role: Role = "viewer"
    reason: str | None = None


class ApproveAccessRequestRequest(BaseModel):
    approver_user_id: str
    role: Role | None = None


class DenyAccessRequestRequest(BaseModel):
    approver_user_id: str


class OrganizationSummary(BaseModel):
    organization: Organization
    teams: list[Team]
    projects: list[Project]
    memberships: list[Membership]

