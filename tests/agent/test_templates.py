"""Tests for templates: storage, search, and apply flow."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import templates


@pytest.fixture
def tmp_db():
    """Per-test temp DB. SQLite + WAL on Windows holds file locks past the
    connection close, so we just leak the file (it's tmp anyway)."""
    tmp_dir = tempfile.mkdtemp(prefix="percy-tpl-")
    p = Path(tmp_dir) / "agent.db"
    templates._INITIALIZED = False
    templates.init_db(p)
    yield p
    templates._INITIALIZED = False


class TestStorage:
    def test_seeds_standard(self, tmp_db):
        listed = templates.list_templates(db_path=tmp_db)
        names = {t["name"] for t in listed if t["is_builtin"]}
        # Several known standard templates should be present
        assert "Title" in names
        assert "Section Header" in names
        assert "KPI Tiles" in names
        assert "Live Timeline (data-driven)" in names

    def test_get_by_id(self, tmp_db):
        t = templates.get_template("std.title", db_path=tmp_db)
        assert t is not None
        assert t["name"] == "Title"
        assert t["is_builtin"] is True
        assert "title" in t["inputs_schema"]
        assert len(t["layout"]) >= 2

    def test_search(self, tmp_db):
        results = templates.search_templates("kpi metric", top_k=3, db_path=tmp_db)
        names = [r["name"] for r in results]
        assert any("KPI" in n for n in names)

    def test_user_template_save_and_delete(self, tmp_db):
        t = templates.Template(
            id="", name="My Template", description="user one", category="User",
            tags=["custom"],
            layout=[{"kind": "text", "alias": "title",
                     "body": {"text": "hi", "position": {"left_in":0,"top_in":0,"width_in":4,"height_in":1}}}],
        )
        tid = templates.save_template(t, db_path=tmp_db)
        assert tid
        got = templates.get_template(tid, db_path=tmp_db)
        assert got["name"] == "My Template"
        assert templates.delete_template(tid, db_path=tmp_db) is True
        assert templates.get_template(tid, db_path=tmp_db) is None

    def test_cannot_delete_builtin(self, tmp_db):
        assert templates.delete_template("std.title", db_path=tmp_db) is False


class TestSubstitution:
    def test_string_substitution(self):
        result = templates._substitute_str("Hello {{name}}!", {"name": "World"})
        assert result == "Hello World!"

    def test_nested_dict(self):
        out = templates._substitute(
            {"text": "{{a}}", "nested": {"x": "{{b}}", "y": "static"}},
            {"a": "AAA", "b": 42},
        )
        assert out["text"] == "AAA"
        assert out["nested"]["x"] == "42"
        assert out["nested"]["y"] == "static"

    def test_list_substitution(self):
        out = templates._substitute(["{{x}}", "{{y}}"], {"x": 1, "y": 2})
        assert out == ["1", "2"]


class TestApplyEndpoint:
    @pytest.fixture
    def client_and_doc(self):
        from app.backend import main as backend_main
        from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata

        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                    for i in range(2)],
            metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=2),
            theme_colors={"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"},
        )
        doc_id = "test-templates-apply"
        backend_main._docs[doc_id] = {
            "doc": doc,
            "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
            "name": doc_id, "kind": "pptx",
            "_undo_stack": [], "_redo_stack": [],
        }
        (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
        yield TestClient(backend_main.app), doc_id, doc
        backend_main._docs.pop(doc_id, None)

    def test_apply_title_template(self, client_and_doc):
        client, doc_id, doc = client_and_doc
        r = client.post("/api/agent/templates/std.title/apply", json={
            "doc_id": doc_id, "slide_n": 1,
            "inputs": {"title": "My Title", "subtitle": "Subtitle"},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        elements = body["elements"]
        assert len(elements) == 2
        # Title text contains the substituted value
        slide = doc.slides[0]
        title_el = next(e for e in slide.elements if (e.identification.shape_name or "") == "Title")
        assert title_el.text_content.text_content == "My Title"

    def test_apply_kpi_tiles_six_elements(self, client_and_doc):
        client, doc_id, doc = client_and_doc
        r = client.post("/api/agent/templates/std.kpi_tiles/apply", json={
            "doc_id": doc_id, "slide_n": 2,
            "inputs": {
                "title": "Q4",
                "metric_1_label": "Revenue", "metric_1_value": "$4.2M",
                "metric_2_label": "NRR", "metric_2_value": "118%",
                "metric_3_label": "Hires", "metric_3_value": "12",
            },
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        # title + 3 tiles + 3 values + 3 labels = 10 elements
        assert len(body["elements"]) == 10
        slide = doc.slides[1]
        assert len(slide.elements) == 10

    def test_apply_missing_required_input(self, client_and_doc):
        client, doc_id, _ = client_and_doc
        r = client.post("/api/agent/templates/std.title/apply", json={
            "doc_id": doc_id, "slide_n": 1, "inputs": {},   # missing 'title'
        })
        body = r.json()
        assert body["ok"] is False
        assert "title" in body.get("error", "")

    def test_apply_unknown_template(self, client_and_doc):
        client, doc_id, _ = client_and_doc
        r = client.post("/api/agent/templates/std.nope/apply", json={
            "doc_id": doc_id, "slide_n": 1, "inputs": {},
        })
        assert r.status_code == 404
