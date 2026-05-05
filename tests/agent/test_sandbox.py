"""Tests for the script sandbox runner."""

from __future__ import annotations

import pytest

from percy.agent import sandbox
from percy.agent.sandbox import ScopeManifest, lint_imports, run_live_group_generator, run_slide_script


class TestLint:
    def test_default_imports_ok(self):
        ok, vio = lint_imports("import json\nimport math\nfrom datetime import date", ScopeManifest())
        assert ok
        assert vio == []

    def test_gated_import_rejected(self):
        ok, vio = lint_imports("import os\n", ScopeManifest())
        assert not ok
        assert any("os" in v for v in vio)

    def test_gated_import_with_grant(self):
        ok, vio = lint_imports("import os\n", ScopeManifest(allow_imports=["os"]))
        assert ok

    def test_unknown_module_rejected(self):
        ok, vio = lint_imports("import this_does_not_exist_module_zzz\n", ScopeManifest())
        assert not ok

    def test_syntax_error(self):
        ok, vio = lint_imports("def broken(:\n", ScopeManifest())
        assert not ok
        assert any("SyntaxError" in v for v in vio)


class TestRunGenerator:
    def test_simple_generator(self):
        source = """
def generate(group, inputs, studio):
    for i in range(inputs.get("count", 0)):
        group.add_child("shape", {
            "geometry_preset": "rect",
            "position": {"left_in": i * 0.5, "top_in": 0, "width_in": 0.4, "height_in": 0.5},
            "fill_color": "accent1",
        })
"""
        result = run_live_group_generator(
            source=source,
            slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={"count": 3},
            base_url="http://localhost:9999",  # not actually called in this test
            doc_id="test-doc",
        )
        assert result.ok, result.error
        specs = result.result["children_spec"]
        assert len(specs) == 3
        assert specs[0]["kind"] == "shape"
        assert specs[0]["body"]["geometry_preset"] == "rect"

    def test_generator_with_locked_child(self):
        source = """
def generate(group, inputs, studio):
    group.add_child("shape", {"geometry_preset": "rect", "position": {"left_in": 0, "top_in": 0, "width_in": 1, "height_in": 1}}, locked=True)
"""
        result = run_live_group_generator(
            source=source, slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={}, base_url="http://localhost:9999", doc_id="test",
        )
        assert result.ok
        assert result.result["children_spec"][0]["locked"] is True

    def test_generator_runtime_error(self):
        source = """
def generate(group, inputs, studio):
    raise ValueError("boom")
"""
        result = run_live_group_generator(
            source=source, slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={}, base_url="http://localhost:9999", doc_id="test",
        )
        assert not result.ok
        assert "ValueError" in (result.error or "")
        assert result.traceback

    def test_missing_generate_function(self):
        source = "def something_else(): pass"
        result = run_live_group_generator(
            source=source, slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={}, base_url="http://localhost:9999", doc_id="test",
        )
        assert not result.ok
        assert "generate" in (result.error or "")

    def test_disallowed_import_blocked_before_run(self):
        source = """
import os
def generate(group, inputs, studio): pass
"""
        result = run_live_group_generator(
            source=source, slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={}, base_url="http://localhost:9999", doc_id="test",
        )
        assert not result.ok
        assert "import_violation" in (result.error or "")

    def test_timeout(self):
        source = """
def generate(group, inputs, studio):
    import time
    time.sleep(5)
"""
        scope = ScopeManifest(timeout_s=1.0)
        result = run_live_group_generator(
            source=source, slide_n=1,
            position={"left_in": 0, "top_in": 0, "width_in": 5, "height_in": 1},
            inputs={}, base_url="http://localhost:9999", doc_id="test",
            scope=scope,
        )
        assert not result.ok
        assert "timeout" in (result.error or "").lower()


class TestRunSlideScript:
    def test_minimal_run_function(self):
        # Slide script without a working studio just returns a value
        source = """
def run(slide, inputs, studio):
    return {"x": inputs.get("y", 0) * 2}
"""
        result = run_slide_script(
            source=source, slide_n=1, inputs={"y": 21},
            base_url="http://localhost:9999", doc_id="test",
        )
        assert result.ok, result.error
        assert result.result == {"x": 42}
