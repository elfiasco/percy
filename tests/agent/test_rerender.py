"""Verify that the create-then-render path actually writes a fresh PNG.

This test was added because the agent edits would mutate Bridge state but
the slide thumbnail would stay stale (the matplotlib re-render never ran
because of a renamed import). After fixing render_bridge_slides this should
just work.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


@pytest.fixture
def client_and_doc(tmp_path):
    from app.backend import main as backend_main
    doc_id = f"test-rerender-{tmp_path.name}"
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors=THEME,
    )
    bridge_dir = tmp_path / "bridge"
    bridge_dir.mkdir(parents=True, exist_ok=True)
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": bridge_dir,
        "name": f"{doc_id}.pptx", "kind": "pptx", "source_format": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    yield TestClient(backend_main.app), doc_id, doc, bridge_dir
    backend_main._docs.pop(doc_id, None)


def test_create_shape_writes_fresh_png(client_and_doc, caplog):
    client, doc_id, doc, bridge_dir = client_and_doc
    png_path = bridge_dir / "slide-001.png"
    assert not png_path.exists()

    r = client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
        "geometry_preset": "rect",
        "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
        "fill_color": "accent1",
    })
    assert r.status_code == 200, r.text

    # The PNG should now exist (re-render fired).
    assert png_path.exists(), f"PNG was not written to {png_path} — re-render didn't run"
    assert png_path.stat().st_size > 1000, "PNG suspiciously small"

    # No "render_bridge_slides" import warnings in the log
    bad = [r for r in caplog.records if "cannot import" in (r.getMessage() or "")]
    assert bad == [], f"unexpected import warnings: {[r.getMessage() for r in bad]}"


def test_template_apply_re_renders(client_and_doc):
    client, doc_id, doc, bridge_dir = client_and_doc
    png_path = bridge_dir / "slide-001.png"

    r = client.post("/api/agent/templates/std.title/apply", json={
        "doc_id": doc_id, "slide_n": 1,
        "inputs": {"title": "Hello", "subtitle": "World"},
    })
    assert r.status_code == 200, r.text

    # The Studio HTTP-on-self path also calls /elements/text which triggers
    # the re-render. We expect the PNG to exist after the apply.
    assert png_path.exists(), "template apply didn't trigger a re-render"
