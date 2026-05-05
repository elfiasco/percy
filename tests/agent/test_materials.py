"""Tests for materials: security pre-pass, chunking, retrieval, HTTP."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import materials


@pytest.fixture
def tmp_env(monkeypatch):
    """Isolate materials DB + storage to a temp dir."""
    tmp = tempfile.mkdtemp(prefix="percy-mat-")
    db_path = Path(tmp) / "agent.db"
    storage = Path(tmp) / "materials"
    monkeypatch.setattr(materials, "_DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(materials, "_MATERIALS_ROOT", storage)
    materials._INITIALIZED = False
    materials.init_db(db_path)
    yield tmp
    materials._INITIALIZED = False


class TestSecurityScan:
    def test_clean_python(self):
        text = "def hello():\n    return 42\n"
        report = materials.security_scan(text, file_kind="python")
        assert report.findings == []
        assert report.dangerous_imports == []
        assert report.syntax_ok is True
        assert report.hard_reject is False

    def test_aws_key_detected(self):
        text = "key = 'AKIA1234567890ABCDEF'\nsecret = 'abc' + 'def'\n"
        report = materials.security_scan(text, file_kind="python")
        kinds = {f.kind for f in report.findings}
        assert "aws_access_key" in kinds
        assert report.hard_reject is True

    def test_password_assignment_detected(self):
        text = "PASSWORD = 'super-secret-password-1234'\n"
        report = materials.security_scan(text, file_kind="python")
        assert any(f.kind == "password_assign" for f in report.findings)
        assert report.hard_reject is True

    def test_dangerous_import_flagged(self):
        text = "import subprocess\nimport socket\n\ndef f(): pass\n"
        report = materials.security_scan(text, file_kind="python")
        assert "subprocess" in report.dangerous_imports
        assert "socket" in report.dangerous_imports
        # Flagged but not hard-rejected (no plaintext secrets)
        assert report.hard_reject is False

    def test_syntax_error(self):
        text = "def broken(:\n    pass\n"
        report = materials.security_scan(text, file_kind="python")
        assert report.syntax_ok is False
        assert "line" in report.syntax_error.lower()

    def test_redact_text(self):
        text = "key = 'AKIA1234567890ABCDEF'"
        report = materials.security_scan(text, file_kind="python")
        redacted = materials.redact_text(text, report)
        assert "AKIA1234567890ABCDEF" not in redacted


class TestChunking:
    def test_python_function_chunks(self):
        src = """
def alpha():
    return 1

def beta(x):
    return x + 1

class Gamma:
    def method(self):
        return 2
"""
        chunks = materials._chunk_python(src)
        names = [c["name"] for c in chunks]
        assert "alpha" in names
        assert "beta" in names
        assert "Gamma" in names

    def test_csv_chunks(self):
        text = "name,value\nalpha,1\nbeta,2\ngamma,3\n"
        chunks = materials._chunk_csv(text, group_size=2)
        # header chunk + at least one rows chunk
        kinds = [c["kind"] for c in chunks]
        assert "csv_header" in kinds
        assert "csv_rows" in kinds

    def test_text_paragraph_chunks(self):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird."
        chunks = materials._chunk_text(text)
        assert len(chunks) == 3


class TestUploadAndRetrieve:
    def test_upload_clean_python(self, tmp_env):
        raw = b"def fetch_revenue():\n    return [100, 120, 130, 140]\n"
        result = materials.upload_material("doc1", "fetch.py", raw)
        assert result["ok"] is True
        assert result["chunk_count"] >= 1
        listed = materials.list_materials("doc1")
        assert len(listed) == 1
        assert listed[0]["filename"] == "fetch.py"

    def test_upload_with_secret_rejected(self, tmp_env):
        raw = b"PASSWORD = 'super-secret-password-1234'\nKEY = 'AKIA1234567890ABCDEF'\n"
        result = materials.upload_material("doc1", "creds.py", raw)
        assert result["ok"] is False
        assert result["hard_rejected"] is True
        # File should NOT be on disk
        listed = materials.list_materials("doc1")
        assert all(m["filename"] != "creds.py" for m in listed)

    def test_retrieval_finds_relevant_chunk(self, tmp_env):
        raw = b"def fetch_revenue():\n    return [100, 120]\n\ndef fetch_costs():\n    return [80, 90]\n"
        materials.upload_material("doc2", "data.py", raw)

        results = materials.retrieve_chunks("doc2", "revenue", top_k=3)
        assert len(results) >= 1
        assert any("fetch_revenue" in (c["text"] or "") for c in results)

    def test_starter_flag_and_only_starter(self, tmp_env):
        raw = b"def helper():\n    return 'starter'\n"
        result = materials.upload_material("doc3", "h.py", raw)
        mid = result["material_id"]
        # Without starter flag, only_starter should return nothing
        assert materials.retrieve_chunks("doc3", "starter", only_starter=True) == []
        # Toggle starter flag
        materials.set_starter_flag(mid, True)
        results = materials.retrieve_chunks("doc3", "starter", only_starter=True)
        assert len(results) >= 1

    def test_delete_material(self, tmp_env):
        raw = b"def x(): pass\n"
        result = materials.upload_material("doc4", "x.py", raw)
        mid = result["material_id"]
        assert materials.delete_material(mid) is True
        assert materials.get_material(mid) is None


class TestHTTPRoutes:
    @pytest.fixture
    def client(self, monkeypatch):
        # Use a fresh DB / storage for HTTP tests
        tmp = tempfile.mkdtemp(prefix="percy-mat-http-")
        db_path = Path(tmp) / "agent.db"
        storage = Path(tmp) / "materials"
        monkeypatch.setattr(materials, "_DEFAULT_DB_PATH", db_path)
        monkeypatch.setattr(materials, "_MATERIALS_ROOT", storage)
        materials._INITIALIZED = False
        materials.init_db(db_path)
        from app.backend import main as backend_main
        return TestClient(backend_main.app)

    def test_upload_clean(self, client):
        r = client.post(
            "/api/docs/test-doc-mat/materials",
            files={"file": ("helper.py", b"def f():\n    return 1\n", "text/x-python")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True

    def test_upload_with_secret_rejected_http(self, client):
        r = client.post(
            "/api/docs/test-doc-mat/materials",
            files={"file": ("bad.py", b"K = 'AKIA1234567890ABCDEF'\n", "text/x-python")},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False
        assert body["hard_rejected"] is True

    def test_list_and_retrieve_http(self, client):
        client.post(
            "/api/docs/doc-list-test/materials",
            files={"file": ("rev.py", b"def fetch_revenue():\n    return 100\n", "text/x-python")},
        )
        r = client.get("/api/docs/doc-list-test/materials")
        assert r.status_code == 200
        assert len(r.json()["materials"]) == 1

        r2 = client.post("/api/agent/retrieve_chunks", json={
            "doc_id": "doc-list-test", "query": "revenue", "top_k": 3,
        })
        assert r2.status_code == 200
        assert len(r2.json()["chunks"]) >= 1
