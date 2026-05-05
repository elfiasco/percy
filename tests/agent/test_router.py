"""Tests for the mode router (heuristic + LLM fallback)."""

from __future__ import annotations

import pytest

from percy.agent.router import classify, classify_heuristic, classify_llm


class TestHeuristic:
    @pytest.mark.parametrize("prompt", [
        "Make the title bold and red.",
        "Change the chart's color to accent1.",
        "Delete this element.",
        "Add a callout in the top right.",
    ])
    def test_static(self, prompt):
        d = classify_heuristic(prompt)
        # Static prompts should NOT classify as scripted; either static or default.
        assert d.mode != "scripted_plan"

    @pytest.mark.parametrize("prompt", [
        "Make the chart match the table's color scheme.",
        "Set every chart's font size to 12.",
        "Copy the formatting from the first chart to the others.",
    ])
    def test_iterative(self, prompt):
        d = classify_heuristic(prompt)
        assert d.mode == "iterative_plan"

    @pytest.mark.parametrize("prompt", [
        "Create a timeline with one bar per day in the next sprint.",
        "For each row in our sales CSV, add a tile.",
        "Pull the latest revenue from Snowflake and update the chart.",
        "Generate one shape automatically for every active project.",
        "Build a status board with one card per ticket from the API.",
    ])
    def test_scripted(self, prompt):
        d = classify_heuristic(prompt)
        assert d.mode == "scripted_plan", f"expected scripted_plan for {prompt!r}, got {d.mode}"

    def test_ambiguous_defaults_iterative(self):
        d = classify_heuristic("Update the deck.")
        assert d.method == "default"
        assert d.mode == "iterative_plan"


class TestLLMFallback:
    def test_llm_picks_when_heuristic_unsure(self):
        called = {"args": None}
        def fake_llm(system, user):
            called["args"] = (system, user)
            return '{"mode": "scripted_plan", "confidence": 0.9, "reason": "needs runtime"}'

        d = classify("Update the deck.", llm_call=fake_llm)
        assert d.mode == "scripted_plan"
        assert d.method == "llm"
        assert called["args"] is not None  # LLM was actually invoked

    def test_no_llm_falls_back_to_default(self):
        d = classify("Update the deck.", llm_call=None)
        assert d.method in ("heuristic", "default")
