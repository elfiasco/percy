"""End-to-end test: every mutating endpoint writes an audit row.

The middleware should record actor/source/method/path/snapshot_index for
mutations that handlers don't explicitly log themselves. Handlers that do
log explicitly (chat, template apply, regenerate, slide-script run, rollback)
should produce richer rows AND suppress the middleware row.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import audit
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata


@pytest.fixture
def fresh_audit():
    """Per-test fresh audit DB."""
    tmp_dir = tempfile.mkdtemp(prefix="percy-audit-")
    db_path = Path(tmp_dir) / "agent.db"
    audit._INITIALIZED = False
    audit._DEFAULT_DB_PATH_OLD = audit._DEFAULT_DB_PATH
    audit._DEFAULT_DB_PATH = db_path
    audit.init_db(db_path)
    yield db_path
    audit._INITIALIZED = False
    audit._DEFAULT_DB_PATH = audit._DEFAULT_DB_PATH_OLD


@pytest.fixture
def client_and_doc(fresh_audit):
    from app.backend import main as backend_main

    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                for i in range(2)],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=2),
        theme_colors={"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"},
    )
    doc_id = "test-audit-coverage"
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    yield TestClient(backend_main.app), doc_id, doc, fresh_audit
    backend_main._docs.pop(doc_id, None)


def _actions_for_doc(doc_id: str, db_path: Path) -> list[dict]:
    return audit.list_actions(doc_id=doc_id, db_path=db_path, limit=100)


class TestMiddlewareAuditCoverage:
    def test_create_shape_logged_by_middleware(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        before = len(_actions_for_doc(doc_id, db))
        r = client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
            "fill_color": "accent1",
        })
        assert r.status_code == 200
        after = _actions_for_doc(doc_id, db)
        assert len(after) == before + 1
        row = after[0]
        assert row["source"] == "middleware"
        assert row["method"] == "POST"
        assert "/elements/shape" in row["path"]
        assert row["status"] == "executed"
        assert row["kind"] == "create"
        assert row["actor"] == "system"  # no auth in test
        assert row["snapshot_index"] is not None

    def test_create_chart_logged(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        r = client.post(f"/api/docs/{doc_id}/slides/2/elements/chart", json={
            "chart_type": "column_clustered",
            "categories": ["Q1", "Q2"],
            "series": [{"name": "Revenue", "values": [100, 120]}],
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3},
        })
        assert r.status_code == 200
        rows = _actions_for_doc(doc_id, db)
        assert any("chart" in r["path"] and r["source"] == "middleware" for r in rows)

    def test_actor_inferred_from_header(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        r = client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
        }, headers={"X-Percy-Actor": "agent"})
        assert r.status_code == 200
        rows = _actions_for_doc(doc_id, db)
        assert rows[0]["actor"] == "agent"

    def test_failed_response_logged(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        # Bad chart type → 400
        r = client.post(f"/api/docs/{doc_id}/slides/1/elements/chart", json={
            "chart_type": "radar",  # unsupported
            "categories": ["a"], "series": [{"name": "x", "values": [1]}],
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3},
        })
        assert r.status_code == 400
        rows = _actions_for_doc(doc_id, db)
        # Should still have an audit row for the failed attempt.
        failed = [r for r in rows if r["status"] == "failed"]
        assert len(failed) >= 1
        assert "HTTP 400" in (failed[0]["error"] or "")

    def test_get_requests_not_logged(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        before = len(_actions_for_doc(doc_id, db))
        # GETs to read endpoints should NOT log
        client.get(f"/api/docs/{doc_id}/snapshots")
        client.get(f"/api/docs/{doc_id}/materials")
        after = _actions_for_doc(doc_id, db)
        assert len(after) == before


class TestExplicitAuditPaths:
    def test_template_apply_logs_richer_row(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        r = client.post("/api/agent/templates/std.title/apply", json={
            "doc_id": doc_id, "slide_n": 1,
            "inputs": {"title": "Test", "subtitle": "Sub"},
        })
        assert r.status_code == 200, r.text
        rows = _actions_for_doc(doc_id, db)
        # Find the template_apply row (not the auto middleware shadow rows from the
        # Studio sub-calls).
        template_rows = [r for r in rows if r["source"] == "template_apply"]
        assert len(template_rows) == 1, f"expected 1 template_apply row, got {len(template_rows)}"
        tr = template_rows[0]
        assert tr["kind"] == "apply_template"
        assert "Apply template" in tr["prompt"]
        assert tr["affected_count"] >= 1

    def test_template_apply_suppresses_middleware_double_log(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        client.post("/api/agent/templates/std.title/apply", json={
            "doc_id": doc_id, "slide_n": 1,
            "inputs": {"title": "X", "subtitle": "Y"},
        })
        rows = _actions_for_doc(doc_id, db)
        # The /apply path should log exactly ONE template_apply row, not also a middleware row.
        template_paths = [r for r in rows if "/templates/std.title/apply" in (r.get("path") or "")]
        assert len(template_paths) == 1


class TestRollbackEvent:
    def test_rollback_writes_event_and_marks_original_cancelled(self, client_and_doc):
        client, doc_id, doc, db = client_and_doc
        # Create a shape so there's something to roll back
        r = client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
        })
        assert r.status_code == 200
        rows_before = _actions_for_doc(doc_id, db)
        original = next(r for r in rows_before if "/elements/shape" in (r["path"] or ""))

        # Roll back
        rb = client.post(f"/api/agent/actions/{original['id']}/rollback")
        assert rb.status_code == 200, rb.text

        rows_after = _actions_for_doc(doc_id, db)
        # An additional 'rollback' action row exists
        rollback_rows = [r for r in rows_after if r["source"] == "rollback"]
        assert len(rollback_rows) >= 1
        # And the original is marked cancelled (re-fetch)
        orig_after = audit.get_action(original["id"], db_path=db)
        assert orig_after["status"] == "cancelled"


class TestActorAndSourceFiltering:
    def test_filter_by_actor(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        # System action
        client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
        })
        # Agent action
        client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "ellipse",
            "position": {"left_in": 4, "top_in": 1, "width_in": 2, "height_in": 1},
        }, headers={"X-Percy-Actor": "agent"})

        sys_rows = audit.list_actions(doc_id=doc_id, actor="system", db_path=db)
        agent_rows = audit.list_actions(doc_id=doc_id, actor="agent", db_path=db)
        assert len(sys_rows) >= 1 and len(agent_rows) >= 1
        assert all(r["actor"] == "system" for r in sys_rows)
        assert all(r["actor"] == "agent" for r in agent_rows)

    def test_filter_by_source(self, client_and_doc):
        client, doc_id, _, db = client_and_doc
        client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
        })
        client.post("/api/agent/templates/std.title/apply", json={
            "doc_id": doc_id, "slide_n": 1,
            "inputs": {"title": "X", "subtitle": "Y"},
        })

        mw = audit.list_actions(doc_id=doc_id, source="middleware", db_path=db)
        ta = audit.list_actions(doc_id=doc_id, source="template_apply", db_path=db)
        assert len(mw) >= 1
        assert len(ta) == 1


class TestSecretsStore:
    def test_set_get_delete_user_secret(self):
        from percy.agent import secrets_store
        # Use a temp DB
        tmp = tempfile.mkdtemp(prefix="percy-sec-")
        db = Path(tmp) / "secrets.db"
        secrets_store._INITIALIZED = False
        secrets_store.init_db(db)

        secrets_store.set_secret("user", "u1", "API_TOKEN", "the-real-secret",
                                  set_by="u1", db_path=db)
        # list returns metadata only — never the value
        listed = secrets_store.list_secrets("user", "u1", db_path=db)
        assert len(listed) == 1
        assert listed[0]["key"] == "API_TOKEN"
        assert "value" not in listed[0]

        # get decrypts
        v = secrets_store.get_secret("user", "u1", "API_TOKEN", db_path=db)
        assert v == "the-real-secret"

        # access count incremented
        listed2 = secrets_store.list_secrets("user", "u1", db_path=db)
        assert listed2[0]["access_count"] == 1

        # delete
        assert secrets_store.delete_secret("user", "u1", "API_TOKEN", db_path=db) is True
        assert secrets_store.get_secret("user", "u1", "API_TOKEN", db_path=db) is None

    def test_resolve_user_overrides_org(self):
        from percy.agent import secrets_store
        tmp = tempfile.mkdtemp(prefix="percy-sec-")
        db = Path(tmp) / "secrets.db"
        secrets_store._INITIALIZED = False
        secrets_store.init_db(db)

        secrets_store.set_secret("org", "org1", "DB_USER", "shared-user", db_path=db)
        secrets_store.set_secret("user", "u1", "DB_USER", "personal-user", db_path=db)

        # User scope overrides org scope
        resolved = secrets_store.resolve_for_user("u1", "org1", ["DB_USER"], db_path=db)
        assert resolved["DB_USER"] == "personal-user"

        # If user doesn't have it, falls back to org
        resolved2 = secrets_store.resolve_for_user("u2", "org1", ["DB_USER"], db_path=db)
        assert resolved2["DB_USER"] == "shared-user"

    def test_invalid_key_rejected(self):
        from percy.agent import secrets_store
        tmp = tempfile.mkdtemp(prefix="percy-sec-")
        db = Path(tmp) / "secrets.db"
        secrets_store._INITIALIZED = False
        secrets_store.init_db(db)
        with pytest.raises(ValueError):
            secrets_store.set_secret("user", "u1", "lowercase_key", "v", db_path=db)
        with pytest.raises(ValueError):
            secrets_store.set_secret("user", "u1", "WITH-DASH", "v", db_path=db)


class TestSaveAsTemplate:
    def test_capture_slide_into_template(self, client_and_doc):
        client, doc_id, doc, db = client_and_doc
        # Apply a template first to populate slide 1
        r = client.post("/api/agent/templates/std.kpi_tiles/apply", json={
            "doc_id": doc_id, "slide_n": 1,
            "inputs": {
                "title": "Q4", "metric_1_label": "Rev", "metric_1_value": "$4M",
                "metric_2_label": "NRR", "metric_2_value": "118%",
                "metric_3_label": "Hires", "metric_3_value": "12",
            },
        })
        assert r.status_code == 200

        # Now save slide 1 as a new user template
        r2 = client.post(f"/api/docs/{doc_id}/slides/1/save-as-template", json={
            "name": "My Custom KPI Layout",
            "description": "Saved from a real slide",
            "tags": ["kpi", "saved"],
        })
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["ok"] is True
        assert body["elements"] == 10  # KPI tiles has 10 elements

        # Confirm it's listed
        r3 = client.get("/api/agent/templates")
        listed = r3.json()["templates"]
        names = {t["name"] for t in listed}
        assert "My Custom KPI Layout" in names

        # And the saved template can be applied to a fresh slide
        r4 = client.post(f"/api/agent/templates/{body['id']}/apply", json={
            "doc_id": doc_id, "slide_n": 2, "inputs": {},
        })
        assert r4.status_code == 200, r4.text
        assert r4.json()["ok"] is True
        # Slide 2 should now have ~10 elements too
        assert len(doc.slides[1].elements) == 10
