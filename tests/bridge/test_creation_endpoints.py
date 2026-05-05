"""End-to-end test for the create_thin endpoints via FastAPI TestClient.

Constructs a minimal in-memory PercyDocument, registers it in the main app's
``_docs`` cache, and hits each creation endpoint. Verifies:
  - 200 response with a serialized element payload
  - element appended to the slide
  - rollback snapshot recorded
"""

from __future__ import annotations

import io
import os

import pytest
from fastapi.testclient import TestClient

# Bypass auth before app import.
os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata


@pytest.fixture
def client_and_doc():
    """Boot the app, register a fresh doc, hand back a TestClient + doc_id."""
    from app.backend import main as backend_main

    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=1),
        theme_colors={"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"},
    )
    doc_id = "test-doc-creation-suite"
    backend_main._docs[doc_id] = {
        "doc": doc,
        "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id,
        "kind": "pptx",
        "undo_stack": [],
        "redo_stack": [],
    }
    # Ensure directories exist so re-render doesn't blow up
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)

    client = TestClient(backend_main.app)
    yield client, doc_id, doc
    # cleanup
    backend_main._docs.pop(doc_id, None)


def test_create_shape(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/shape",
        json={
            "geometry_preset": "roundRect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
            "fill_color": "accent1",
            "text": "Q4 Highlights",
            "font_size": 24,
            "font_bold": True,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "BridgeShape"
    assert body["left_in"] == 1
    assert len(doc.slides[0].elements) == 1
    assert doc.slides[0].elements[0].element_type == "BridgeShape"


def test_create_text(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/text",
        json={
            "text": "Quarterly Review",
            "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
            "font_size": 36,
            "font_bold": True,
            "text_color": "text",
        },
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    assert el.fill.fill_type == "none"
    assert el.text_content.paragraphs[0].runs[0].text == "Quarterly Review"


def test_create_chart(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/chart",
        json={
            "chart_type": "column_clustered",
            "categories": ["Q1", "Q2", "Q3", "Q4"],
            "series": [
                {"name": "Revenue", "values": [100, 120, 130, 110]},
                {"name": "Cost",    "values": [80,  90,  95,  85]},
            ],
            "title": "Quarterly Performance",
            "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 5},
            "value_axis": {"number_format": "$,.0f", "gridlines": True},
            "legend": {"position": "bottom"},
        },
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    assert el.element_type == "BridgeChart"
    assert el.chart_type == "column_clustered"
    assert len(el.series) == 2
    assert el.title.title == "Quarterly Performance"


def test_create_table(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/table",
        json={
            "data": [
                ["Quarter", "Revenue", "Cost"],
                ["Q1", 100, 80],
                ["Q2", 120, 90],
                ["Q3", 130, 95],
            ],
            "first_row_header": True,
            "banded_rows": True,
            "style_preset": "financial",
            "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 2.5},
        },
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    assert el.element_type == "BridgeTable"
    assert len(el.cell_formats) == 4
    assert el.cell_formats[0][0].font.font_bold is True


def test_create_connector(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/connector",
        json={
            "connector_type": "straight",
            "start": {"x_in": 1, "y_in": 2},
            "end":   {"x_in": 6, "y_in": 4},
            "head_end": "triangle",
            "color": "accent1",
            "width": 2,
        },
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    assert el.element_type == "BridgeConnector"
    assert el.endpoints.start_x == 1.0
    assert el.endpoints.end_x == 6.0


def test_create_freeform_routes_to_shape(client_and_doc):
    client, doc_id, doc = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/freeform",
        json={
            "preset": "check",
            "position": {"left_in": 5, "top_in": 5, "width_in": 1, "height_in": 1},
            "fill_color": "good",
        },
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    # 'check' is in SHAPE_EQUIVALENT_PRESETS so it routes to BridgeShape.
    assert el.element_type == "BridgeShape"
    body = r.json()
    assert "warnings" in body
    assert any("routed to BridgeShape" in w for w in body["warnings"])


def test_create_image_typed(client_and_doc):
    client, doc_id, doc = client_and_doc

    # Generate a small PNG in memory.
    from PIL import Image as PILImage
    buf = io.BytesIO()
    PILImage.new("RGB", (200, 100), color="red").save(buf, format="PNG")
    png_bytes = buf.getvalue()

    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/image-typed",
        files={"file": ("test.png", png_bytes, "image/png")},
        data={"metadata": '{"position": {"left_in": 2, "top_in": 2, "width_in": 3, "height_in": 1.5}, "alt_text": "test image"}'},
    )
    assert r.status_code == 200, r.text
    el = doc.slides[0].elements[-1]
    assert el.element_type == "BridgeImage"
    assert el.image_data.image_bytes == png_bytes
    assert el.accessibility.alt_text == "test image"


def test_builder_validation_returns_400(client_and_doc):
    client, doc_id, _ = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/chart",
        json={
            "chart_type": "radar",  # not supported
            "categories": ["a", "b"],
            "series": [{"name": "x", "values": [1, 2]}],
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3},
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "builder_validation"
    assert body["detail"]["field"] == "chart_type"


def test_unknown_slide_returns_404(client_and_doc):
    client, doc_id, _ = client_and_doc
    r = client.post(
        f"/api/docs/{doc_id}/slides/99/elements/shape",
        json={"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
    )
    assert r.status_code == 404


def test_rollback_snapshot_recorded(client_and_doc):
    client, doc_id, _ = client_and_doc
    from app.backend import main as backend_main
    initial_undo_depth = len(backend_main._docs[doc_id].get("_undo_stack", []))
    r = client.post(
        f"/api/docs/{doc_id}/slides/1/elements/shape",
        json={"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
    )
    assert r.status_code == 200
    assert len(backend_main._docs[doc_id]["_undo_stack"]) == initial_undo_depth + 1
