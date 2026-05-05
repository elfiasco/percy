"""Tests for refresh agent, onboarding suggestions, metric consistency."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import metric_consistency, onboarding, refresh
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


# ── Onboarding suggestions ──────────────────────────────────────────────────


class TestOnboarding:
    def test_empty_slide_suggested(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        sugs = onboarding.suggest_for_doc(doc)
        assert any(s.kind == "empty_slide" for s in sugs)

    def test_off_palette_suggested_as_brand_fix(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "fill_color": "#FF00FF"}, THEME, slide=doc.slides[0],
        ))
        sugs = onboarding.suggest_for_doc(doc)
        brand = [s for s in sugs if s.kind == "brand_fix"]
        assert len(brand) >= 1
        assert brand[0].auto_fix is not None

    def test_chart_without_connect_suggests_binding(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        doc.slides[0].elements.append(builders.build_chart({
            "chart_type": "line",
            "categories": ["Jan", "Feb"],
            "series": [{"name": "X", "values": [1, 2]}],
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3},
        }, THEME, slide=doc.slides[0]))

        sugs = onboarding.suggest_for_doc(doc)
        bind = [s for s in sugs if s.kind == "bind_metric"]
        assert len(bind) == 1


# ── Metric consistency ──────────────────────────────────────────────────────


class TestMetricExtraction:
    def test_simple_label_value(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
        )
        doc.slides[0].elements.append(builders.build_text({
            "text": "Revenue: $4.2M",
            "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 1},
        }, THEME, slide=doc.slides[0]))
        instances = metric_consistency.extract_metrics(doc, doc_id="d1", doc_name="A")
        labels = [i.label for i in instances]
        assert any("Revenue" in l for l in labels)

    def test_alias_normalization(self):
        assert metric_consistency._normalize_label("Annual Recurring Revenue") == "arr"
        assert metric_consistency._normalize_label("Net Revenue Retention") == "nrr"

    def test_value_normalization(self):
        assert metric_consistency._normalize_value("$4.2M") == 4_200_000.0
        assert metric_consistency._normalize_value("23%") == 0.23
        assert metric_consistency._normalize_value("1,250") == 1250.0
        assert metric_consistency._normalize_value("100K") == 100_000.0


class TestMetricInconsistency:
    def test_cross_deck_inconsistency(self):
        # Two docs with different ARR values
        def _make(text: str, doc_id: str) -> tuple:
            doc = PercyDocument(
                slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
                metadata=PresentationMetadata(slide_count=1),
            )
            doc.slides[0].elements.append(builders.build_text({
                "text": text,
                "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 1},
            }, THEME, slide=doc.slides[0]))
            return (doc_id, doc_id, doc)

        docs = [
            _make("ARR: $4.2M", "deck-a"),
            _make("ARR: $4.5M", "deck-b"),
        ]
        inconsistencies = metric_consistency.find_inconsistencies(docs)
        # ARR appears with two different values
        assert any(c.label == "arr" for c in inconsistencies)


# ── Refresh agent ──────────────────────────────────────────────────────────


@pytest.fixture
def client_and_doc_with_scripts():
    """Doc with a slide-level script and a connect script."""
    from app.backend import main as backend_main
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors=THEME,
    )
    # Add a shape with a connect script attached
    shape = builders.build_shape({
        "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
        "name": "Test Shape",
    }, THEME, slide=doc.slides[0])
    shape.custom_properties = {"connect": {"script": "def run(slide, inputs, studio):\n    return {'shape_value': 42}\n", "inputs": {}}}
    doc.slides[0].elements.append(shape)

    # Add a slide-level script
    doc.slides[0].script = "def run(slide, inputs, studio):\n    return {'slide_total': 100}\n"

    doc_id = "test-refresh"
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    yield TestClient(backend_main.app), doc_id, doc
    backend_main._docs.pop(doc_id, None)


class TestRefreshAgent:
    def test_find_runnable_scripts(self, client_and_doc_with_scripts):
        _, _, doc = client_and_doc_with_scripts
        scripts = refresh.find_runnable_scripts(doc)
        kinds = [s["kind"] for s in scripts]
        # Order: slide_script first, then connect (no live groups)
        assert "slide_script" in kinds
        assert "connect" in kinds
        assert kinds[0] == "slide_script"

    def test_refresh_endpoint_runs_all(self, client_and_doc_with_scripts):
        client, doc_id, _ = client_and_doc_with_scripts
        r = client.post(f"/api/docs/{doc_id}/refresh", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["doc_id"] == doc_id
        assert body["n_scripts"] == 2
        assert body["snapshot_before_index"] is not None
        # Each outcome has expected fields
        for o in body["outcomes"]:
            assert o["kind"] in ("slide_script", "connect", "live_group")
            assert "elapsed_s" in o
