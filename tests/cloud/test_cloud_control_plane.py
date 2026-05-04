from __future__ import annotations

import uuid

import pytest


pytest.importorskip("fastapi")

from fastapi.testclient import TestClient

from app.cloud.main import app


def test_org_team_project_access_request_flow() -> None:
    client = TestClient(app)
    slug = f"acme-{uuid.uuid4().hex[:8]}"

    org_response = client.post(
        "/api/cloud/orgs",
        json={"name": "Acme", "slug": slug, "owner_user_id": "user_owner"},
    )
    assert org_response.status_code == 200
    org = org_response.json()

    team_response = client.post(
        f"/api/cloud/orgs/{org['id']}/teams",
        json={"name": "Finance"},
        headers={"X-Percy-User": "user_owner"},
    )
    assert team_response.status_code == 200
    team = team_response.json()

    project_response = client.post(
        f"/api/cloud/orgs/{org['id']}/projects",
        json={"name": "QBR", "team_id": team["id"]},
        headers={"X-Percy-User": "user_owner"},
    )
    assert project_response.status_code == 200
    project = project_response.json()

    access_response = client.post(
        f"/api/cloud/projects/{project['id']}/access-requests",
        json={
            "requester_id": "user_analyst",
            "requested_role": "editor",
            "reason": "Joining QBR reporting workflow",
        },
    )
    assert access_response.status_code == 200
    access_request = access_response.json()
    assert access_request["status"] == "pending"

    approval_response = client.post(
        f"/api/cloud/access-requests/{access_request['id']}/approve",
        json={"approver_user_id": "user_owner"},
    )
    assert approval_response.status_code == 200
    assert approval_response.json()["status"] == "approved"

    summary_response = client.get(f"/api/cloud/orgs/{org['id']}")
    assert summary_response.status_code == 200
    summary = summary_response.json()
    assert summary["organization"]["slug"] == slug
    assert len(summary["teams"]) == 1
    assert len(summary["projects"]) == 1
    assert any(
        membership["user_id"] == "user_analyst"
        and membership["project_id"] == project["id"]
        and membership["role"] == "editor"
        for membership in summary["memberships"]
    )

    audit_response = client.get("/api/cloud/audit-events", params={"org_id": org["id"]})
    assert audit_response.status_code == 200
    actions = {event["action"] for event in audit_response.json()}
    assert {
        "organization.created",
        "team.created",
        "project.created",
        "access.requested",
        "access.approved",
    }.issubset(actions)

