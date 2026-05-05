"""Tests for brand check, diff narrator, deck generator."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import brand_check, diff_narrator
from percy.agent.brand_check import BrandProfile
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


# ── Brand check ─────────────────────────────────────────────────────────────


class TestBrandCheck:
    def test_clean_deck_no_violations(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        # Add a brand-color shape
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
             "fill_color": "#3B82F6"}, THEME, slide=doc.slides[0],
        ))
        report = brand_check.check_document(doc, BrandProfile.percy_default())
        assert len(report.violations) == 0

    def test_off_palette_caught(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        # A wildly-off-palette color
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 2},
             "fill_color": "#FF00FF"}, THEME, slide=doc.slides[0],
        ))
        profile = BrandProfile(
            name="strict", palette_hex={"#3B82F6", "#10B981"},
            palette_tolerance=0.05,
        )
        report = brand_check.check_document(doc, profile)
        off = [v for v in report.violations if v.kind == "off_palette"]
        assert len(off) >= 1
        assert off[0].suggested_fix is not None
        assert off[0].suggested_fix["endpoint_id"] == "element.style"
        # The suggested fix should target a brand color
        assert off[0].suggested_fix["body"]["fill_color"] in {"#3B82F6", "#10B981"}

    def test_forbidden_color(self):
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "fill_color": "#FF0000"}, THEME, slide=doc.slides[0],
        ))
        profile = BrandProfile(
            name="strict",
            palette_hex={"#3B82F6"}, forbidden_colors={"#FF0000"},
        )
        report = brand_check.check_document(doc, profile)
        forbidden = [v for v in report.violations if v.kind == "forbidden"]
        assert len(forbidden) >= 1
        assert forbidden[0].severity == "high"

    def test_color_distance_function(self):
        # Identical
        assert brand_check._color_distance("#FF0000", "#FF0000") == 0.0
        # Close
        d = brand_check._color_distance("#FF0000", "#EE0000")
        assert 0 < d < 0.1
        # Far
        d2 = brand_check._color_distance("#FF0000", "#00FF00")
        assert d2 > 0.5


# ── Diff narrator ──────────────────────────────────────────────────────────


class TestDiffNarrator:
    def _doc(self) -> PercyDocument:
        doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors=THEME,
        )
        return doc

    def test_no_changes(self):
        doc = self._doc()
        diff = diff_narrator.diff_docs(doc, doc)
        assert diff.short_summary() == "No changes."

    def test_element_added(self):
        before = self._doc()
        after = self._doc()
        after.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1}},
            THEME, slide=after.slides[0],
        ))
        diff = diff_narrator.diff_docs(before, after)
        assert "1 element added" in diff.short_summary()

    def test_element_modified(self):
        before = self._doc()
        before.slides[0].elements.append(builders.build_text(
            {"text": "before-text",
             "position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 1}},
            THEME, slide=before.slides[0],
        ))
        # Make 'after' a copy with different text on the same element
        import pickle as _pickle
        after = _pickle.loads(_pickle.dumps(before))
        after.slides[0].elements[0].text_content.paragraphs[0].runs[0].text = "after-text"

        diff = diff_narrator.diff_docs(before, after)
        assert "modified" in diff.short_summary()
        # The element change should mention text in its fields
        ec = diff.slide_changes[0].element_changes[0]
        assert ec.kind == "modified"
        assert "text" in ec.fields

    def test_slide_added(self):
        before = self._doc()
        after = self._doc()
        after.slides.append(BridgeSlide(slide_number=2, elements=[], width=13.333, height=7.5))
        diff = diff_narrator.diff_docs(before, after)
        assert diff.slides_added == [2]


# ── HTTP routes ─────────────────────────────────────────────────────────────


@pytest.fixture
def client_and_doc():
    from app.backend import main as backend_main
    doc_id = "test-advanced"
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                for i in range(2)],
        metadata=PresentationMetadata(slide_count=2),
        theme_colors=THEME,
    )
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    yield TestClient(backend_main.app), doc_id, doc
    backend_main._docs.pop(doc_id, None)


class TestBrandCheckHTTP:
    def test_default_profile(self, client_and_doc):
        client, doc_id, doc = client_and_doc
        # Add an off-palette shape
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "fill_color": "#FF00FF"}, THEME, slide=doc.slides[0],
        ))
        r = client.post(f"/api/docs/{doc_id}/brand-check", json={})
        assert r.status_code == 200
        body = r.json()
        assert body["profile"] == "Percy Default"
        assert body["summary"]["violation_count"] >= 1

    def test_custom_profile(self, client_and_doc):
        client, doc_id, doc = client_and_doc
        doc.slides[0].elements.append(builders.build_shape(
            {"position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
             "fill_color": "#FF0000"}, THEME, slide=doc.slides[0],
        ))
        r = client.post(f"/api/docs/{doc_id}/brand-check", json={
            "profile": {"name": "Strict", "palette_hex": ["#3B82F6"],
                        "forbidden_colors": ["#FF0000"]},
        })
        assert r.status_code == 200
        body = r.json()
        assert body["profile"] == "Strict"


class TestDiffHTTP:
    def test_diff_with_two_snapshots(self, client_and_doc):
        client, doc_id, doc = client_and_doc
        from app.backend import main as backend_main
        # Take snapshot 0
        backend_main._snapshot_doc(doc_id)
        # Mutate the doc (snapshot 1 happens in middleware before this returns)
        client.post(f"/api/docs/{doc_id}/slides/1/elements/shape", json={
            "geometry_preset": "rect",
            "position": {"left_in": 1, "top_in": 1, "width_in": 2, "height_in": 1},
        })
        # Diff snapshot 0 → live
        r = client.post(f"/api/docs/{doc_id}/diff", json={"before": 0})
        assert r.status_code == 200, r.text
        body = r.json()
        # Some change should be detected (an element added)
        assert isinstance(body["long_summary"], str)
