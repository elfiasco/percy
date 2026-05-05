"""Mode router — classifies a user prompt into a planning mode.

Three modes:
  * ``static_plan``    — flat list of independent or pre-enumerable edits
  * ``iterative_plan`` — read-act-observe loop; references depend on state
  * ``scripted_plan``  — cardinality unknown until runtime; generate a script

The router prefers cheap heuristics first, then falls back to an LLM
classifier on ambiguous cases. Heuristics cover ~70% of typical prompts;
the LLM tiebreaker handles the rest. Both are deterministic in isolation.

The LLM classifier is optional — if no LLM is configured, the router falls
back to ``iterative_plan`` (the loop subsumes the static case, so it's the
safe default).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── Heuristic patterns ──────────────────────────────────────────────────────


# Phrases that signal cardinality depends on data (script_plan).
_SCRIPTED_SIGNALS: list[str] = [
    r"\bfor each\b",
    r"\bfor every\b",
    r"\bone (?:per|for each|for every|for|bar|column|shape|row)\b",
    r"\bone\s+\w+\s+per\b",
    r"\bbased on (?:the\s+)?data\b",
    r"\bdepending on\b",
    r"\bdepends on\b",
    r"\bvarying\b",
    r"\bhowever many\b",
    r"\bautomatically generate(?:s|d)?\b",
    r"\bdata[- ]driven\b",
    r"\bdynamic(?:ally)?\b",
    r"\bquery\b.*\b(?:warehouse|database|api|snowflake|bigquery|redshift|postgres|sql)\b",
    r"\b(?:pull|fetch|load)\b.*\b(?:from|via)\b.*\b(?:warehouse|database|api|csv|sheet|spreadsheet|sql|snowflake|bigquery)\b",
    r"\b(?:script|python|pandas|sql)\b.*\b(?:that|to|which)\b",
    r"\bevery (?:day|week|month|quarter|year|hour)\b.*\b(?:bar|shape|element|tile|card)\b",
]

# Phrases that signal mid-plan state reads (iterative_plan).
_ITERATIVE_SIGNALS: list[str] = [
    r"\bmatch\b",
    r"\bsame as\b",
    r"\bsame (?:color|style|font|size) as\b",
    r"\bbased on (?:the\s+)?(?:other|first|second|previous)\b",
    r"\b(?:make|set)\s+\w+\s+(?:to\s+)?match\b",
    r"\bfollow the (?:same|other)\b",
    r"\bcopy (?:the\s+)?(?:style|color|font|formatting) (?:from|of)\b",
    r"\bif (?:it|the|.*?)\b",  # conditional logic
    r"\bonly if\b",
    r"\bunless\b",
    r"\bwherever\b",
    r"\bevery (?:slide|chart|table|element) (?:that|where|with)\b",
]

# Phrases that strongly signal static_plan (simple, enumerable edits).
_STATIC_SIGNALS: list[str] = [
    r"\bmake\s+(?:the|this)\s+\w+\s+(?:bold|italic|red|blue|green|larger|smaller|bigger)\b",
    r"\bchange\s+(?:the|this)\s+\w+\s+(?:to|color|font)\b",
    r"\bdelete (?:this|that|the)\b",
    r"\bremove (?:this|that|the)\b",
    r"\bduplicate (?:this|that|the)\b",
    r"\binsert (?:a|an|one)\b",
    r"\badd (?:a|an|one) \w+\b",
]


# ── Result ──────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ModeDecision:
    mode:        str           # "static_plan" | "iterative_plan" | "scripted_plan"
    confidence:  float         # 0-1
    method:      str           # "heuristic" | "llm" | "default"
    reasons:     list[str]


# ── Heuristic classifier ────────────────────────────────────────────────────


def classify_heuristic(prompt: str) -> ModeDecision:
    p = (prompt or "").lower()

    scripted_hits = [pat for pat in _SCRIPTED_SIGNALS if re.search(pat, p)]
    iterative_hits = [pat for pat in _ITERATIVE_SIGNALS if re.search(pat, p)]
    static_hits = [pat for pat in _STATIC_SIGNALS if re.search(pat, p)]

    # Scripted always wins if present — it's the strongest signal, and missing
    # this case is the worst failure mode (the agent would try to enumerate).
    if scripted_hits:
        return ModeDecision(
            mode="scripted_plan",
            confidence=min(0.9, 0.6 + 0.1 * len(scripted_hits)),
            method="heuristic",
            reasons=[f"matched {p!r} scripted pattern: {pat}" for pat in scripted_hits[:2]],
        )

    if iterative_hits and not static_hits:
        return ModeDecision(
            mode="iterative_plan",
            confidence=min(0.85, 0.5 + 0.1 * len(iterative_hits)),
            method="heuristic",
            reasons=[f"matched iterative pattern: {pat}" for pat in iterative_hits[:2]],
        )

    if static_hits and not iterative_hits:
        return ModeDecision(
            mode="static_plan",
            confidence=min(0.8, 0.5 + 0.1 * len(static_hits)),
            method="heuristic",
            reasons=[f"matched static pattern: {pat}" for pat in static_hits[:2]],
        )

    # Ambiguous — punt to caller to optionally invoke an LLM.
    return ModeDecision(mode="iterative_plan", confidence=0.4,
                        method="default", reasons=["no strong heuristic signal; defaulting to iterative"])


# ── LLM tiebreaker (optional) ──────────────────────────────────────────────


_LLM_SYSTEM = """You classify a user instruction for a presentation editor into one of three planning modes.

Modes:
- static_plan: an enumerable list of edits. Examples: "make the title red", "delete this shape", "add a chart of Q1-Q4 revenue".
- iterative_plan: edits that depend on reading current state mid-plan. Examples: "make the chart match the table's color", "for every chart, increase the font size", "if the chart is bar, switch it to column".
- scripted_plan: edits whose cardinality depends on data and require a runtime Python script. Examples: "create a timeline with one bar per day in this dataset", "for each row in our sales CSV, add a tile", "pull the latest revenue and update".

Output strict JSON: {"mode": "<one of the three>", "confidence": <float 0-1>, "reason": "<short>"}
"""


def classify_llm(prompt: str, *, llm_call: Callable[[str, str], str]) -> ModeDecision:
    """LLM-backed classifier. ``llm_call(system, user) -> str`` is the IO function.

    Caller injects the LLM call so this module stays IO-free. Returns a
    decision with ``method='llm'``.
    """
    import json as _json
    raw = llm_call(_LLM_SYSTEM, prompt)
    try:
        # Tolerate code fences and trailing prose.
        s = raw.strip()
        if s.startswith("```"):
            s = s.split("\n", 1)[1] if "\n" in s else s
            if s.endswith("```"):
                s = s[:-3]
        first = s.find("{")
        if first >= 0:
            s = s[first:]
        last = s.rfind("}")
        if last >= 0:
            s = s[:last + 1]
        parsed = _json.loads(s)
    except Exception as exc:
        log.warning("classify_llm: failed to parse LLM output: %s — raw: %r", exc, raw[:200])
        return ModeDecision(mode="iterative_plan", confidence=0.4,
                            method="default", reasons=[f"llm parse error: {exc}"])

    mode = parsed.get("mode")
    if mode not in ("static_plan", "iterative_plan", "scripted_plan"):
        return ModeDecision(mode="iterative_plan", confidence=0.4,
                            method="default", reasons=[f"llm returned invalid mode: {mode}"])

    return ModeDecision(
        mode=mode,
        confidence=float(parsed.get("confidence", 0.6)),
        method="llm",
        reasons=[parsed.get("reason") or "llm classification"],
    )


# ── Combined router ────────────────────────────────────────────────────────


def classify(
    prompt: str,
    *,
    llm_call: Callable[[str, str], str] | None = None,
    heuristic_threshold: float = 0.65,
) -> ModeDecision:
    """Classify a prompt. Try heuristics first; fall back to LLM if confidence is low."""
    heuristic = classify_heuristic(prompt)
    if heuristic.confidence >= heuristic_threshold:
        return heuristic
    if llm_call is None:
        return heuristic
    return classify_llm(prompt, llm_call=llm_call)
