"""Deck-from-prompt generator.

Takes a high-level prompt ("a 5-slide Q4 board update covering revenue,
customers, hiring, risks, and outlook"), uses an LLM to plan a slide-by-slide
outline, picks Percy Standard templates per slide, and materializes them.

The output is a deck ready to refine — every slide is a real template-applied
layout with the inputs filled in by the LLM.

Architecture:
  prompt → outline planner (LLM) → list[{slide_n, template_id, inputs}]
       → for each: apply_template → assemble deck

If a template the LLM picks doesn't exist, it falls back to ``std.title_content``.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass(slots=True)
class SlidePlan:
    slide_n:      int
    template_id:  str
    template_name: str
    inputs:       dict


@dataclass(slots=True)
class DeckPlan:
    title:    str
    slides:   list[SlidePlan]
    rationale: str | None = None


_OUTLINE_SYSTEM = """You are the Percy Deck Outline Planner. Given a user's high-level prompt,
you produce a slide-by-slide plan for a presentation.

Available templates (each tagged with the kind of slide it makes):
{templates_summary}

Output STRICT JSON of the form:

{{
  "title": "<deck title>",
  "rationale": "<one sentence on the structure>",
  "slides": [
    {{"slide_n": 1, "template_id": "std.title", "inputs": {{"title": "...", "subtitle": "..."}}}},
    {{"slide_n": 2, "template_id": "std.title_content", "inputs": {{"title": "...", "body": "..."}}}},
    ...
  ]
}}

Rules:
1. Use only template_ids from the list above.
2. Slide 1 should usually be 'std.title' or 'std.section_header'.
3. Provide ALL required inputs for each template — don't leave required fields empty.
4. Prefer 5-10 slides for typical board updates / overviews.
5. Use 'std.kpi_tiles' for slides that show 3 headline metrics.
6. Use 'std.two_column' for comparisons.
7. Use 'std.agenda' for the second slide if the deck is long.
8. Output JSON only, no prose.
"""


def _render_templates_summary(templates: list[dict]) -> str:
    lines: list[str] = []
    for t in templates:
        if t.get("category") != "Percy Standard":
            continue
        inputs = ", ".join(
            f"{k}{'*' if spec.get('required') else ''}"
            for k, spec in (t.get("inputs_schema") or {}).items()
        )
        lines.append(f"- {t['id']:<30s}  {t['name']:<25s}  inputs: {inputs}  desc: {t.get('description', '')[:60]}")
    return "\n".join(lines)


def plan_deck(
    prompt: str,
    *,
    available_templates: list[dict],
    llm_call: Callable[[str, str], str],
) -> DeckPlan:
    """Use an LLM to produce a slide-by-slide plan referring to template IDs."""
    summary = _render_templates_summary(available_templates)
    system = _OUTLINE_SYSTEM.format(templates_summary=summary)
    raw = llm_call(system, prompt)
    parsed = _extract_json(raw)

    if not parsed.get("slides"):
        return DeckPlan(title="Untitled", slides=[],
                        rationale=f"LLM returned no slides. Raw: {raw[:200]}")

    valid_ids = {t["id"] for t in available_templates}
    template_by_id = {t["id"]: t for t in available_templates}

    slides: list[SlidePlan] = []
    for i, s in enumerate(parsed["slides"]):
        tid = s.get("template_id", "std.title_content")
        if tid not in valid_ids:
            log.warning("plan_deck: LLM picked unknown template %r — falling back to std.title_content", tid)
            tid = "std.title_content"
        slides.append(SlidePlan(
            slide_n=int(s.get("slide_n", i + 1)),
            template_id=tid,
            template_name=template_by_id.get(tid, {}).get("name", tid),
            inputs=dict(s.get("inputs") or {}),
        ))

    return DeckPlan(
        title=parsed.get("title", "Untitled"),
        slides=slides,
        rationale=parsed.get("rationale"),
    )


def _extract_json(text: str) -> dict:
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    first = s.find("{")
    if first < 0:
        return {}
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i, ch in enumerate(s[first:], start=first):
        if esc:
            esc = False; continue
        if ch == "\\" and in_str:
            esc = True; continue
        if ch == '"':
            in_str = not in_str; continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1; break
    if end <= first:
        return {}
    try:
        return json.loads(s[first:end])
    except Exception as exc:
        log.warning("deck_generator: JSON parse failed: %s; raw=%r", exc, text[:300])
        return {}
