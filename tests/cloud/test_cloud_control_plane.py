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

    document_response = client.post(
        f"/api/cloud/projects/{project['id']}/documents",
        json={
            "name": "QBR Source Deck",
            "source_format": "pptx",
            "storage_uri": "local://uploads/qbr.pptx",
            "content_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "size_bytes": 1234,
            "created_by_id": "user_analyst",
        },
    )
    assert document_response.status_code == 200
    document = document_response.json()

    job_response = client.post(
        f"/api/cloud/documents/{document['id']}/jobs",
        json={
            "job_type": "onboard_document",
            "requested_by_id": "user_analyst",
            "parameters": {"mode": "bridge"},
        },
    )
    assert job_response.status_code == 200
    job = job_response.json()
    assert job["status"] == "queued"

    started_response = client.post(
        f"/api/cloud/jobs/{job['id']}/start",
        json={"worker_id": "worker_local"},
    )
    assert started_response.status_code == 200
    assert started_response.json()["status"] == "running"

    completed_response = client.post(
        f"/api/cloud/jobs/{job['id']}/complete",
        json={"worker_id": "worker_local", "result": {"bridge_version_id": "bridge_v1"}},
    )
    assert completed_response.status_code == 200
    assert completed_response.json()["status"] == "completed"

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
        "document.registered",
        "job.queued",
        "job.started",
        "job.completed",
    }.issubset(actions)
