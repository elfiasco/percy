"""Tests for synthetic group projection + group_ops translation expansion."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import group_ops
from percy.agent.element_index import ElementIndex
from percy.bridge import (
    BridgeShape, BridgeSlide, Identification, PercyDocument,
    PresentationMetadata, Position, Stacking, ShapeIdentification,
    ShapeFill, ShapeLine, ShapeBorders, ShapeTextContent, ShapeTextFrame,
    ShapeShadow, Transform, Accessibility,
)
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


def _shape(name: str, sid: int, group_id: str | None,
           left: float, top: float, w: float, h: float) -> BridgeShape:
    return BridgeShape(
        position=Position(left=left, top=top, width=w, height=h),
        transforms=Transform(),
        stacking=Stacking(z_index=sid),
        identification=Identification(shape_id=sid, shape_name=name, group_id=group_id),
        accessibility=Accessibility(alt_text=name),
        shape_identification=ShapeIdentification(),
        fill=ShapeFill(fill_type="solid"),
        line=ShapeLine(visible=False),
        borders=ShapeBorders(),
        text_content=ShapeTextContent(),
        text_frame=ShapeTextFrame(),
        shadow=ShapeShadow(),
    )


def _doc_with_synthetic_group() -> PercyDocument:
    """Three shapes share group_id='slide-1:group-5' simulating an onboarded group."""
    slide = BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)
    slide.elements = [
        _shape("Day 1",  1, "slide-1:group-5", 1.0, 2.0, 1.0, 0.5),
        _shape("Day 2",  2, "slide-1:group-5", 2.5, 2.0, 1.0, 0.5),
        _shape("Day 3",  3, "slide-1:group-5", 4.0, 2.0, 1.0, 0.5),
        _shape("Other",  4, None,              7.0, 5.0, 2.0, 1.0),
    ]
    return PercyDocument(
        slides=[slide],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=1),
        theme_colors=THEME,
    )


class TestSyntheticGroupProjection:
    def test_index_emits_synthetic_entry(self):
        doc = _doc_with_synthetic_group()
        idx = ElementIndex.build(doc)
        synthetic = [d for d in idx.digests if d.synthetic]
        assert len(synthetic) == 1
        sg = synthetic[0]
        assert sg.element_id == "synthetic:slide-1:group-5"
        assert sg.name == "Group 5"
        assert sg.synthetic_members == ["1", "2", "3"]
        # bbox spans the three children
        assert sg.left == 1.0
        assert pytest.approx(sg.left + sg.width, rel=1e-3) == 5.0  # 4.0 + 1.0
        assert sg.top == 2.0

    def test_synthetic_findable_by_query(self):
        doc = _doc_with_synthetic_group()
        idx = ElementIndex.build(doc)
        result = idx.search("the group", viewing_slide_n=1)
        # Synthetic group should rank well — has "group" token + on viewing slide
        assert any(c.digest.synthetic for c in result.candidates)

    def test_singleton_group_id_does_not_make_synthetic(self):
        # Single child with group_id alone shouldn't produce a synthetic entry.
        doc = _doc_with_synthetic_group()
        # Override: only one shape with the group_id
        doc.slides[0].elements = [
            _shape("Solo", 1, "slide-1:group-9", 1, 1, 2, 1),
            _shape("Other", 2, None, 5, 5, 2, 1),
        ]
        idx = ElementIndex.build(doc)
        synthetic = [d for d in idx.digests if d.synthetic]
        assert synthetic == []


class TestGroupOpsTranslation:
    def test_synthetic_translate_expands_per_child(self):
        doc = _doc_with_synthetic_group()
        idx = ElementIndex.build(doc)
        sg = next(d for d in idx.digests if d.synthetic)
        ops = group_ops.expand_translate(sg, dx_in=2.0, dy_in=1.0, doc=doc)
        assert len(ops) == 3
        # Each op should target a member element_id with shifted coords
        for op in ops:
            assert op["endpoint_id"] == "element.update"
            body = op["body"]
            assert "left_in" in body and "top_in" in body
        # First member at (1, 2) → (3, 3)
        first = ops[0]
        assert first["body"]["left_in"] == 3.0
        assert first["body"]["top_in"] == 3.0

    def test_real_element_translate_single_op(self):
        doc = _doc_with_synthetic_group()
        idx = ElementIndex.build(doc)
        # Use the first non-synthetic shape
        real = next(d for d in idx.digests if not d.synthetic)
        ops = group_ops.expand_translate(real, dx_in=1.0, dy_in=1.0, doc=doc)
        assert len(ops) == 1

    def test_synthetic_show_hide_expands(self):
        doc = _doc_with_synthetic_group()
        idx = ElementIndex.build(doc)
        sg = next(d for d in idx.digests if d.synthetic)
        ops = group_ops.expand_show_hide(sg, hidden=True)
        assert len(ops) == 3
        assert all(op["body"] == {"hidden": True} for op in ops)


class TestLiveGroupBuilder:
    def test_builds_empty_group(self):
        slide = BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)
        intent = {
            "position": {"left_in": 1, "top_in": 1, "width_in": 5, "height_in": 2},
            "name": "Timeline",
            "generator_script": "def generate(group, inputs, studio): pass",
            "generator_inputs": {"days": 7},
        }
        group = builders.build_live_group(intent, THEME, slide=slide)
        assert group.element_type == "BridgeGroup"
        assert group.children == []
        assert group.generator_script is not None
        assert group.generator_inputs == {"days": 7}
        assert group.generator_provenance.get("created_at") is not None
