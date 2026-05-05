"""Tests for the planner dispatcher's tolerance of LLM-emitted plan variance."""

from __future__ import annotations

import os

import pytest

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent.planner import (
    Plan, ToolCall, _coerce_text_body, _strip_routing, execute_plan, execute_one,
)
from percy.agent.script_api import Studio


class StubStudio:
    """Records the calls made through it without hitting HTTP."""
    def __init__(self):
        self.calls: list[dict] = []
        self.next_response: dict = {}
        self.doc_id = "test"

    def find_element(self, **kw):
        self.calls.append({"op": "find_element", **kw})
        return self.next_response or {"candidates": []}

    def patch_element(self, n, eid, body):
        self.calls.append({"op": "patch_element", "slide_n": n, "element_id": eid, "body": body})
        return {"ok": True}

    def patch_style(self, n, eid, body):
        self.calls.append({"op": "patch_style", "slide_n": n, "element_id": eid, "body": body})
        return {"ok": True}

    def patch_text(self, n, eid, body):
        self.calls.append({"op": "patch_text", "slide_n": n, "element_id": eid, "body": body})
        return {"ok": True}

    def patch_chart_data(self, n, eid, body):
        self.calls.append({"op": "patch_chart_data", "slide_n": n, "element_id": eid, "body": body})
        return {"ok": True}

    def patch_table_data(self, n, eid, body):
        self.calls.append({"op": "patch_table_data", "slide_n": n, "element_id": eid, "body": body})
        return {"ok": True}

    def delete_element(self, n, eid):
        self.calls.append({"op": "delete_element", "slide_n": n, "element_id": eid})
        return {"ok": True}

    def create_element(self, n, kind, body):
        self.calls.append({"op": "create_element", "slide_n": n, "kind": kind, "body": body})
        return {"id": "new-id-99", "name": "X"}


class TestDispatcherAliases:
    def test_short_find_alias(self):
        s = StubStudio()
        execute_one(ToolCall(endpoint_id="find", path_args={}, body={"query": "the title"}), studio=s)
        assert s.calls[0]["op"] == "find_element"

    def test_text_update_alias(self):
        s = StubStudio()
        execute_one(ToolCall(endpoint_id="text.update",
                              path_args={"slide_n": 1, "element_id": "el-1"},
                              body={"text": "Hi"}), studio=s)
        assert s.calls[0]["op"] == "patch_text"
        # Should be coerced into TextUpdateRequest schema
        assert s.calls[0]["body"]["kind"] == "paragraphs"
        assert s.calls[0]["body"]["paragraphs"][0]["runs"][0]["text"] == "Hi"

    def test_chart_update_alias(self):
        s = StubStudio()
        execute_one(ToolCall(endpoint_id="chart.update",
                              path_args={"slide_n": 1, "element_id": "el-1"},
                              body={"series": [{"name": "X", "values": [1, 2]}]}), studio=s)
        assert s.calls[0]["op"] == "patch_chart_data"


class TestDispatcherCoercion:
    def test_path_args_in_body_pulled_out(self):
        s = StubStudio()
        execute_one(ToolCall(endpoint_id="element.style", path_args={},
                              body={"slide_n": 2, "element_id": "el-7", "fill_color": "red"}),
                     studio=s)
        # slide_n + element_id should be extracted from body
        c = s.calls[0]
        assert c["slide_n"] == 2
        assert c["element_id"] == "el-7"
        # And stripped from the body the studio receives
        assert "slide_n" not in c["body"]
        assert "element_id" not in c["body"]
        assert c["body"]["fill_color"] == "red"

    def test_text_body_coercion_simple(self):
        out = _coerce_text_body({"text": "Hello"})
        assert out["kind"] == "paragraphs"
        assert out["paragraphs"][0]["runs"][0]["text"] == "Hello"

    def test_text_body_coercion_with_styles(self):
        out = _coerce_text_body({"text": "Bold!", "bold": True, "color": "#FF0000"})
        run = out["paragraphs"][0]["runs"][0]
        assert run["text"] == "Bold!"
        assert run["font_bold"] is True
        assert run["font_color"] == "#FF0000"

    def test_text_body_already_strict_passthrough(self):
        already = {"kind": "paragraphs", "paragraphs": [{"runs": [{"text": "X"}]}]}
        assert _coerce_text_body(already) == already


class TestFindElementSubstitution:
    def test_substitution_plumbs_through(self):
        s = StubStudio()
        s.next_response = {"candidates": [{"element_id": "el-42", "slide_n": 3, "score": 0.9}]}
        plan = Plan(mode="static_plan", calls=[
            ToolCall(endpoint_id="agent.find_element", path_args={}, body={"query": "the title"}),
            # Subsequent call has empty path_args — should inherit el-42 / slide 3
            ToolCall(endpoint_id="element.style", path_args={}, body={"fill_color": "red"}),
        ])
        result = execute_plan(plan, studio=s, user_confirmed=True)
        assert result.ok, result.error
        # The second call should have been routed with the resolved element_id
        style_calls = [c for c in s.calls if c["op"] == "patch_style"]
        assert len(style_calls) == 1
        assert style_calls[0]["element_id"] == "el-42"
        assert style_calls[0]["slide_n"] == 3
