"""Tests for the find_element index, scoring, and HTTP endpoint."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

# Bypass auth before app import.
os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent.element_index import ElementIndex, quadrant_for, tokenize
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


# ── tokenization + quadrant ────────────────────────────────────────────────


class TestTokenize:
    def test_drops_stopwords(self):
        assert "the" not in tokenize("the title")
        assert "title" in tokenize("the title")

    def test_drops_short(self):
        assert "of" not in tokenize("a b cd")
        assert "cd" in tokenize("a b cd")

    def test_lowercases(self):
        assert tokenize("Q4 Revenue") == {"q4", "revenue"}


class TestQuadrant:
    def test_top_left(self):
        # 13.333 x 7.5 slide, element at (0, 0, 2, 1)
        assert quadrant_for(0, 0, 2, 1, 13.333, 7.5) == "top-left"

    def test_top_right(self):
        assert quadrant_for(11, 0.2, 2, 1, 13.333, 7.5) == "top-right"

    def test_center(self):
        assert quadrant_for(5, 3, 3, 1.5, 13.333, 7.5) == "center"

    def test_bottom_center(self):
        assert quadrant_for(4, 6, 5, 1, 13.333, 7.5) == "bottom-center"


# ── Index construction ─────────────────────────────────────────────────────


def _build_test_doc() -> PercyDocument:
    """Build a small doc with deterministic elements for ranking tests."""
    doc = PercyDocument(
        slides=[
            BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5),
            BridgeSlide(slide_number=2, elements=[], width=13.333, height=7.5),
            BridgeSlide(slide_number=3, elements=[], width=13.333, height=7.5),
        ],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=3),
        theme_colors=THEME,
    )

    # Slide 1: a title text-box (top), one chart (center)
    doc.slides[0].elements.append(builders.build_text(
        {"text": "Quarterly Review", "name": "Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 36, "font_bold": True},
        THEME, slide=doc.slides[0],
    ))
    doc.slides[0].elements.append(builders.build_chart(
        {"chart_type": "column_clustered",
         "categories": ["Q1", "Q2", "Q3", "Q4"],
         "series": [{"name": "Revenue", "values": [100, 120, 130, 110]},
                    {"name": "Cost",    "values": [80,  90,  95,  85]}],
         "title": "Revenue Performance",
         "name": "Q4 Revenue",
         "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 5}},
        THEME, slide=doc.slides[0],
    ))

    # Slide 2: a different chart, plus a table
    doc.slides[1].elements.append(builders.build_chart(
        {"chart_type": "line",
         "categories": ["Jan", "Feb", "Mar"],
         "series": [{"name": "Headcount", "values": [10, 12, 15]}],
         "title": "Headcount Growth",
         "name": "Headcount Chart",
         "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 4}},
        THEME, slide=doc.slides[1],
    ))
    doc.slides[1].elements.append(builders.build_table(
        {"data": [["Department", "Count"], ["Eng", 10], ["Sales", 5]],
         "first_row_header": True,
         "name": "Department Table",
         "position": {"left_in": 8, "top_in": 1, "width_in": 4, "height_in": 3}},
        THEME, slide=doc.slides[1],
    ))

    # Slide 3: bottom-right callout shape
    doc.slides[2].elements.append(builders.build_shape(
        {"geometry_preset": "wedgeRoundRectCallout",
         "position": {"left_in": 9, "top_in": 5.5, "width_in": 4, "height_in": 1.5},
         "fill_color": "accent2", "text": "Important note", "name": "Bottom Callout"},
        THEME, slide=doc.slides[2],
    ))
    doc.slides[2].elements.append(builders.build_text(
        {"text": "Quarterly Review",  # same text as slide 1 title — disambig test
         "name": "Slide 3 Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 36, "font_bold": True},
        THEME, slide=doc.slides[2],
    ))

    return doc


class TestIndexBuild:
    def test_digest_count(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # 2 + 2 + 2 = 6 elements
        assert len(idx.digests) == 6

    def test_digest_extracts_chart_data_summary(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        chart_digests = [d for d in idx.digests if d.type == "BridgeChart"]
        assert len(chart_digests) == 2
        assert "Revenue" in chart_digests[0].data_summary
        assert "categories" in chart_digests[0].data_summary

    def test_digest_extracts_position_quadrant(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # Title text-box at (0.5, 0.4, 12, 1) → top-center (spans width)
        title = next(d for d in idx.digests if d.name == "Title")
        assert title.quadrant.startswith("top")
        # Bottom callout at (9, 5.5, 4, 1.5) → bottom-right
        callout = next(d for d in idx.digests if d.name == "Bottom Callout")
        assert callout.quadrant == "bottom-right"


# ── Scoring ────────────────────────────────────────────────────────────────


class TestSearch:
    def test_pronoun_returns_selected(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # Get an arbitrary element_id from slide 1
        target = next(d for d in idx.digests if d.slide_n == 1 and d.type == "BridgeChart")
        result = idx.search("this", viewing_slide_n=1, selected_element_id=target.element_id)
        assert len(result.candidates) == 1
        assert result.candidates[0].digest.element_id == target.element_id
        assert result.candidates[0].score == 1.0

    def test_type_query_filters(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("the chart", viewing_slide_n=1)
        # Top candidate should be a chart on slide 1
        assert result.candidates[0].digest.type == "BridgeChart"
        assert result.candidates[0].digest.slide_n == 1

    def test_slide_context_disambiguates_duplicates(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # "Quarterly Review" exists on slide 1 and slide 3.
        r1 = idx.search("the quarterly title", viewing_slide_n=1)
        r3 = idx.search("the quarterly title", viewing_slide_n=3)
        assert r1.candidates[0].digest.slide_n == 1
        assert r3.candidates[0].digest.slide_n == 3

    def test_position_phrase(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("the bottom right callout", viewing_slide_n=3)
        assert result.candidates[0].digest.name == "Bottom Callout"
        assert "bottom-right" in result.candidates[0].why[0] or "position" in " ".join(result.candidates[0].why)

    def test_text_match_finds_chart_by_title(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("the headcount chart")
        assert result.candidates[0].digest.title == "Headcount Growth"

    def test_element_types_filter(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("anything", element_types=["BridgeTable"])
        assert all(c.digest.type == "BridgeTable" for c in result.candidates)

    def test_scope_current_slide(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("chart", viewing_slide_n=2, scope="current_slide")
        # Only slide 2 elements considered → only the line chart
        for c in result.candidates:
            assert c.digest.slide_n == 2

    def test_scope_range(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        result = idx.search("chart", scope={"range": [2, 3]})
        for c in result.candidates:
            assert 2 <= c.digest.slide_n <= 3

    def test_no_match_returns_empty(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # Filter to a type none of the query terms match, with no other signal
        result = idx.search("octopus", element_types=["BridgeFreeform"])
        assert result.candidates == []
        assert result.top_score == 0.0

    def test_ambiguous_flag(self):
        doc = _build_test_doc()
        idx = ElementIndex.build(doc)
        # "the title" in deck-wide scope hits two titles (slide 1 + slide 3).
        result = idx.search("the title", scope="deck")
        if len(result.candidates) >= 2:
            # Without slide context they should be roughly tied.
            assert result.ambiguous or result.candidates[0].score == result.candidates[1].score


# ── HTTP endpoint ──────────────────────────────────────────────────────────


@pytest.fixture
def client_and_doc():
    from app.backend import main as backend_main

    doc = _build_test_doc()
    doc_id = "test-find-element-doc"
    backend_main._docs[doc_id] = {
        "doc": doc,
        "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    yield TestClient(backend_main.app), doc_id
    backend_main._docs.pop(doc_id, None)


class TestEndpoint:
    def test_basic(self, client_and_doc):
        client, doc_id = client_and_doc
        r = client.post("/api/agent/find_element", json={
            "doc_id": doc_id,
            "query": "the revenue chart",
            "context": {"viewing_slide_n": 1},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["candidates"]) >= 1
        top = body["candidates"][0]
        assert top["type"] == "BridgeChart"
        assert top["slide_n"] == 1
        assert top["score"] > 0.5
        assert "why" in top
        assert body["scoped_to"] == "whole deck"

    def test_with_scope(self, client_and_doc):
        client, doc_id = client_and_doc
        r = client.post("/api/agent/find_element", json={
            "doc_id": doc_id,
            "query": "chart",
            "context": {"viewing_slide_n": 2, "scope": "current_slide"},
        })
        assert r.status_code == 200
        body = r.json()
        for c in body["candidates"]:
            assert c["slide_n"] == 2
        assert body["scoped_to"] == "slide 2"

    def test_pronoun(self, client_and_doc):
        client, doc_id = client_and_doc
        # First find an element id to "select"
        r = client.post("/api/agent/find_element", json={
            "doc_id": doc_id, "query": "headcount chart",
        })
        eid = r.json()["candidates"][0]["element_id"]

        r2 = client.post("/api/agent/find_element", json={
            "doc_id": doc_id,
            "query": "this",
            "context": {"viewing_slide_n": 2, "selected_element_id": eid},
        })
        assert r2.status_code == 200
        body = r2.json()
        assert body["candidates"][0]["element_id"] == eid
        assert body["candidates"][0]["score"] == 1.0

    def test_element_types_filter(self, client_and_doc):
        client, doc_id = client_and_doc
        r = client.post("/api/agent/find_element", json={
            "doc_id": doc_id,
            "query": "anything",
            "context": {"element_types": ["BridgeTable"]},
        })
        assert r.status_code == 200
        body = r.json()
        assert all(c["type"] == "BridgeTable" for c in body["candidates"])

    def test_missing_doc_id(self, client_and_doc):
        client, _ = client_and_doc
        r = client.post("/api/agent/find_element", json={"query": "anything"})
        assert r.status_code == 400

    def test_unknown_doc(self, client_and_doc):
        client, _ = client_and_doc
        r = client.post("/api/agent/find_element", json={"doc_id": "nope", "query": "x"})
        assert r.status_code == 404

    def test_invalidate(self, client_and_doc):
        client, doc_id = client_and_doc
        # Build the index by calling once
        r = client.post("/api/agent/find_element", json={"doc_id": doc_id, "query": "chart"})
        assert r.status_code == 200
        # Invalidate
        r2 = client.post("/api/agent/element_index/invalidate", json={"doc_id": doc_id})
        assert r2.status_code == 200
        # Should still work after rebuild
        r3 = client.post("/api/agent/find_element", json={"doc_id": doc_id, "query": "chart"})
        assert r3.status_code == 200
