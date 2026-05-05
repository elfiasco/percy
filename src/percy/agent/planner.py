"""Percy agent planner — three skills sharing one planner core.

Editor (static):     prompt → JSON tool-call list → executor.
Iterative:           prompt → first proposed call → execute → observe → next call.
Coder (scripted):    prompt → Python source → sandbox.run_* → emit child specs / patches.

The three share:
  * an LLM call interface (caller injects ``llm_call(system, user, history)``)
  * a tool catalog filter (only relevant manifest entries)
  * a validation pass (schema check via the manifest args)
  * an executor that walks the tool calls and applies them

This module is IO-free for the LLM (caller injects the function). HTTP
to the studio API uses ``percy.agent.script_api.Studio``. The concrete
endpoint that orchestrates this flow lives in
``app/backend/agent_chat.py`` — that's where the chat() route is replaced.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from percy.agent.script_api import Studio, StudioError

log = logging.getLogger(__name__)


# ── Types ───────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ToolCall:
    endpoint_id: str
    path_args:   dict
    body:        dict
    reason:      str | None = None
    confirm:     bool = False

    def to_dict(self) -> dict:
        return {
            "endpoint_id": self.endpoint_id, "path_args": self.path_args,
            "body": self.body, "reason": self.reason, "confirm": self.confirm,
        }


@dataclass(slots=True)
class Plan:
    mode:        str
    calls:       list[ToolCall] = field(default_factory=list)
    clarify:     str | None = None
    script:      str | None = None             # for scripted_plan
    script_kind: str | None = None             # 'live_group' | 'slide_script'
    script_args: dict = field(default_factory=dict)
    rationale:   str | None = None

    def affected_count(self) -> int:
        return len(self.calls)

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "calls": [c.to_dict() for c in self.calls],
            "clarify": self.clarify,
            "script": self.script,
            "script_kind": self.script_kind,
            "script_args": self.script_args,
            "rationale": self.rationale,
        }


@dataclass(slots=True)
class StepResult:
    call:    ToolCall
    ok:      bool
    response: dict | None = None
    error:   str | None = None
    elapsed_ms: int = 0


@dataclass(slots=True)
class ExecutionResult:
    ok:        bool
    steps:     list[StepResult] = field(default_factory=list)
    error:     str | None = None
    elapsed_ms: int = 0
    snapshot_index: int | None = None


# ── Catalog filtering ──────────────────────────────────────────────────────


def filter_manifest_for_mode(manifest: dict, mode: str) -> list[dict]:
    """Return the subset of endpoints relevant to a given planning mode.

    Phase 1: full surface for static & iterative. Coder mode gets a much
    narrower surface — it doesn't directly call create_*; the script does.
    """
    endpoints = manifest.get("endpoints") or []
    if mode == "scripted_plan":
        # Coder needs only the agent meta-tools + a way to bind scripts.
        keep = {"agent.find_element", "live_group.create", "live_group.regenerate",
                "slide.script.set", "slide.script.run"}
        return [e for e in endpoints if e["id"] in keep]
    return endpoints


def render_catalog(endpoints: list[dict], *, max_endpoints: int = 200) -> str:
    """Compact JSON view of endpoints for inclusion in the planner system prompt."""
    selected = endpoints[:max_endpoints]
    return json.dumps([
        {
            "id": e["id"], "summary": e["summary"], "applies_to": e.get("applies_to", []),
            "destructive": e.get("destructive", False),
            "args": {k: v.get("desc") for k, v in (e.get("args") or {}).items()},
            "examples": (e.get("examples") or [])[:3],
        }
        for e in selected
    ], indent=2)


def retrieve_endpoints(prompt: str, endpoints: list[dict], *, top_k: int = 12) -> list[dict]:
    """Keyword-based retrieval over the manifest.

    Scores each endpoint by token overlap between (id + summary + examples) and
    the prompt. Returns the top_k. Always includes ``agent.find_element`` since
    most prompts will need it.
    """
    import re as _re
    p_tokens = {t.lower() for t in _re.findall(r"[A-Za-z][A-Za-z0-9_]*", prompt or "")
                if len(t) >= 3}

    pinned_ids = {"agent.find_element"}
    scored: list[tuple[float, dict]] = []
    for e in endpoints:
        if e["id"] in pinned_ids:
            continue
        text = " ".join([
            e.get("id", ""),
            e.get("summary", ""),
            " ".join(e.get("examples") or []),
            " ".join(e.get("applies_to") or []),
        ])
        e_tokens = {t.lower() for t in _re.findall(r"[A-Za-z][A-Za-z0-9_]*", text)
                    if len(t) >= 3}
        if not e_tokens or not p_tokens:
            scored.append((0.0, e)); continue
        overlap = len(p_tokens & e_tokens)
        score = overlap / max(1, len(p_tokens))
        # Boost on direct id match
        for tok in p_tokens:
            if tok in e["id"].lower():
                score += 0.5
        scored.append((score, e))

    scored.sort(key=lambda x: -x[0])

    pinned = [e for e in endpoints if e["id"] in pinned_ids]
    rest = [e for s, e in scored if s > 0][:top_k - len(pinned)]
    if len(rest) < top_k - len(pinned):
        # Pad with high-priority generic endpoints when nothing else matched
        # (covers vague prompts).
        priority_fallbacks = {"element.update", "element.style", "shape.create", "text.create",
                              "chart.create", "table.create"}
        already = {e["id"] for e in pinned + rest}
        for e in endpoints:
            if e["id"] in priority_fallbacks and e["id"] not in already:
                rest.append(e)
                if len(pinned) + len(rest) >= top_k:
                    break

    return pinned + rest


# ── System prompts ──────────────────────────────────────────────────────────


_EDITOR_SYSTEM = """You are the Percy Editor. The user wants to edit a presentation.

You produce a JSON plan: a list of tool calls against the studio API. Each
call has an endpoint_id from the catalog, path_args (slide_n, element_id),
and a body matching the endpoint's args schema.

Rules:
1. Use only endpoints from the catalog. Never invent paths.
2. If an element reference is ambiguous ("the title", "this", "the chart"),
   put a `find_element` call FIRST in the plan. Use the user's viewing slide
   and selected element id as context.
3. Plan the smallest patch. Don't restyle siblings unless asked.
4. Prefer `scheme:` colors / theme aliases (accent1, text, muted) when the deck has a theme.
5. Honor `locked` elements: don't edit them.
6. If destructive (delete) or affecting many elements, set `confirm: true`.
7. If genuinely ambiguous, output {"clarify": "..."} instead of a plan.

Output strict JSON:
{
  "rationale": "<one sentence>",
  "calls": [
    {"endpoint_id": "...", "path_args": {...}, "body": {...}, "reason": "...", "confirm": false}
  ]
}

Or:
{"clarify": "<one specific question>"}
"""


_ITERATIVE_SYSTEM = """You are the Percy Editor in iterative mode. The user's request involves reading current state mid-plan.

You output ONE next tool call. After it executes, you'll see the result and can plan the next step. Continue until done; output {"done": true, "summary": "..."} when you're finished.

Each step output:
{
  "next_call": {"endpoint_id": "...", "path_args": {...}, "body": {...}, "reason": "..."},
  "thinking": "<one sentence>"
}

Or to read state first:
{
  "next_call": {"endpoint_id": "agent.find_element", ...} | another GET-like endpoint
}

Or finish:
{"done": true, "summary": "<what you did>"}

Or ask:
{"clarify": "<question>"}

Rules: same as Editor. Don't loop more than 8 steps; if you can't finish, output {"clarify": "..."}.
"""


_CODER_SYSTEM = """You are the Percy Coder. The user's request needs a Python script (data-driven cardinality, custom logic, or supplementary materials).

Choose ONE of these outputs:

A. Live group with generator script (when the user wants N elements where N depends on data):
{
  "kind": "live_group",
  "live_group_args": {
    "slide_n": <int>,
    "position": {"left_in":..,"top_in":..,"width_in":..,"height_in":..},
    "name": "<short>",
    "generator_inputs": {...}
  },
  "script": "<python source>"
}

The script must define `generate(group, inputs, studio)`. Use group.add_child("shape" | "text" | ..., {body}).
Coordinates in the body are slide-space (NOT group-relative for v1). The studio object exposes find_element and patch_* methods.

B. Slide-level script (when slide-wide logic doesn't fit a single element):
{
  "kind": "slide_script",
  "slide_script_args": {"slide_n": <int>, "inputs": {...}},
  "script": "<python source>"
}

The script must define `run(slide, inputs, studio)`. slide.elements gives ElementHandles; el.set_position(...), el.set_text(...), el.hide(), etc.

Or:
{"clarify": "<question>"}

Rules:
- Default to safe imports only: json, math, datetime, time, re, itertools, dataclasses, typing.
- No `os`, `subprocess`, `requests`, network calls — those need explicit scope grants the user must provide.
- Keep the script under 50 lines if possible.
- Use the script_api SDK methods only — do NOT instantiate Bridge dataclasses directly.
"""


# ── Editor (static) ────────────────────────────────────────────────────────


def plan_static(
    prompt: str,
    *,
    catalog_json: str,
    context: dict,
    llm_call: Callable[[str, str], str],
) -> Plan:
    """One-shot static plan."""
    user = _user_block(prompt, context, catalog_json)
    raw = llm_call(_EDITOR_SYSTEM, user)
    parsed = _extract_json(raw)
    if "clarify" in parsed:
        return Plan(mode="static_plan", clarify=parsed["clarify"])
    calls = [_to_tool_call(c) for c in (parsed.get("calls") or [])]
    return Plan(mode="static_plan", calls=calls, rationale=parsed.get("rationale"))


# ── Iterative ──────────────────────────────────────────────────────────────


def plan_iterative_step(
    prompt: str,
    *,
    catalog_json: str,
    context: dict,
    history: list[dict],
    llm_call: Callable[[str, str], str],
) -> dict:
    """One iterative step. Returns the parsed planner output dict.

    `history` is a list of {"call": {...}, "result": {...}} from prior steps.
    The caller drives the loop and validates termination conditions.
    """
    user = _user_block(prompt, context, catalog_json) + "\n\nHistory so far:\n" + json.dumps(history, indent=2, default=str)
    raw = llm_call(_ITERATIVE_SYSTEM, user)
    return _extract_json(raw)


# ── Coder ──────────────────────────────────────────────────────────────────


def plan_scripted(
    prompt: str,
    *,
    catalog_json: str,
    context: dict,
    llm_call: Callable[[str, str], str],
) -> Plan:
    user = _user_block(prompt, context, catalog_json)
    raw = llm_call(_CODER_SYSTEM, user)
    parsed = _extract_json(raw)
    if "clarify" in parsed:
        return Plan(mode="scripted_plan", clarify=parsed["clarify"])

    kind = parsed.get("kind")
    script = parsed.get("script") or ""
    if kind == "live_group":
        return Plan(mode="scripted_plan", script=script, script_kind="live_group",
                    script_args=parsed.get("live_group_args") or {})
    if kind == "slide_script":
        return Plan(mode="scripted_plan", script=script, script_kind="slide_script",
                    script_args=parsed.get("slide_script_args") or {})
    return Plan(mode="scripted_plan", clarify="The coder did not produce a recognizable script kind. Try rephrasing.")


# ── Executor ───────────────────────────────────────────────────────────────


def execute_plan(
    plan: Plan,
    *,
    studio: Studio,
    confirm_threshold: int = 5,
    user_confirmed: bool = False,
    snapshot_taker: Callable[[], int] | None = None,
) -> ExecutionResult:
    """Walk the plan, calling each tool. Stop on first error.

    Smart find_element propagation: when a call to ``agent.find_element``
    returns a candidate, subsequent calls in the plan inherit the resolved
    ``element_id`` and ``slide_n`` if they don't already have them. This makes
    the planner's "find first then edit" pattern work in static plans without
    requiring iterative loops.

    For static plans only — iterative plans drive the loop themselves and call
    ``execute_one`` per step.
    """
    t0 = time.time()
    snapshot_index = snapshot_taker() if snapshot_taker else None

    if plan.affected_count() > confirm_threshold and not user_confirmed:
        return ExecutionResult(
            ok=False,
            error=f"plan affects {plan.affected_count()} elements; user confirmation required",
            elapsed_ms=int((time.time() - t0) * 1000),
            snapshot_index=snapshot_index,
        )

    steps: list[StepResult] = []
    last_resolved_eid: str | None = None
    last_resolved_slide: int | None = None

    for call in plan.calls:
        # Substitute resolved find_element results into subsequent calls.
        if last_resolved_eid is not None:
            pa = call.path_args or {}
            if not pa.get("element_id"):
                pa["element_id"] = last_resolved_eid
                call.path_args = pa
            if last_resolved_slide is not None and not pa.get("slide_n"):
                pa["slide_n"] = last_resolved_slide
                call.path_args = pa

        sr = execute_one(call, studio=studio)
        steps.append(sr)

        # If this was a find_element, capture its top candidate for downstream calls.
        if call.endpoint_id == "agent.find_element" and sr.ok and sr.response:
            cands = sr.response.get("candidates") if isinstance(sr.response, dict) else None
            if cands:
                top = cands[0]
                last_resolved_eid = top.get("element_id")
                last_resolved_slide = top.get("slide_n")

        if not sr.ok:
            return ExecutionResult(ok=False, steps=steps, error=sr.error,
                                   elapsed_ms=int((time.time() - t0) * 1000),
                                   snapshot_index=snapshot_index)
    return ExecutionResult(ok=True, steps=steps,
                           elapsed_ms=int((time.time() - t0) * 1000),
                           snapshot_index=snapshot_index)


def execute_one(call: ToolCall, *, studio: Studio) -> StepResult:
    """Translate a ToolCall into a Studio HTTP call. Returns a StepResult."""
    t0 = time.time()
    try:
        resp = _dispatch(call, studio)
        return StepResult(call=call, ok=True, response=resp,
                          elapsed_ms=int((time.time() - t0) * 1000))
    except StudioError as exc:
        return StepResult(call=call, ok=False, error=str(exc),
                          elapsed_ms=int((time.time() - t0) * 1000))
    except Exception as exc:
        return StepResult(call=call, ok=False, error=f"{type(exc).__name__}: {exc}",
                          elapsed_ms=int((time.time() - t0) * 1000))


def _dispatch(call: ToolCall, studio: Studio) -> dict:
    """Route a tool call to the right Studio method.

    Mapping is by endpoint_id. Common LLM mistakes (alternate id casing,
    missing fields, embedded path_args inside body) are gently coerced so
    the executor is forgiving of small planner variance.
    """
    eid = (call.endpoint_id or "").strip()
    pa = call.path_args or {}
    body = call.body or {}

    # Some planners emit slide_n / element_id INSIDE the body — pull them out.
    if "slide_n" in body and "slide_n" not in pa:
        pa = {**pa, "slide_n": body["slide_n"]}
    if "element_id" in body and "element_id" not in pa:
        pa = {**pa, "element_id": body["element_id"]}

    # Normalize common id aliases the LLM produces.
    eid_aliases = {
        "find_element": "agent.find_element",
        "agent.find":   "agent.find_element",
        "find":         "agent.find_element",
        "element.move":   "element.update",
        "element.resize": "element.update",
        "element.bold":   "element.style",
        "shape.update":   "element.update",
        "text.update":    "text.patch",
        "patch_text":     "text.patch",
        "patch_chart":    "chart_data.patch",
        "chart.update":   "chart_data.patch",
        "patch_table":    "table_data.patch",
        "table.update":   "table_data.patch",
        "delete":         "element.delete",
    }
    eid = eid_aliases.get(eid, eid)

    # find_element
    if eid == "agent.find_element":
        ctx = body.get("context") or {}
        return studio.find_element(
            query=body.get("query", "") or pa.get("query", ""),
            viewing_slide_n=ctx.get("viewing_slide_n") or pa.get("slide_n"),
            selected_element_id=ctx.get("selected_element_id"),
            scope=ctx.get("scope"),
            element_types=ctx.get("element_types"),
            limit=int(body.get("limit") or 5),
        )

    n = pa.get("slide_n")
    eid_short = pa.get("element_id")

    if eid == "element.update":
        return studio.patch_element(n, eid_short, _strip_routing(body))
    if eid == "element.style":
        return studio.patch_style(n, eid_short, _strip_routing(body))
    if eid == "element.text" or eid == "text.patch":
        return studio.patch_text(n, eid_short, _coerce_text_body(_strip_routing(body)))
    if eid == "chart_data.patch":
        return studio.patch_chart_data(n, eid_short, _strip_routing(body))
    if eid == "table_data.patch":
        return studio.patch_table_data(n, eid_short, _strip_routing(body))
    if eid == "element.delete":
        return studio.delete_element(n, eid_short)

    # create_* family — POST on /elements/<kind>
    create_map = {
        "shape.create": "shape", "text.create": "text", "chart.create": "chart",
        "table.create": "table", "connector.create": "connector",
        "freeform.create_preset": "freeform", "image.create_typed": "image-typed",
        "live_group.create": "live-group",
    }
    if eid in create_map:
        return studio.create_element(n, create_map[eid], _strip_routing(body))

    raise StudioError(f"unhandled endpoint_id {eid!r} in dispatcher")


def _strip_routing(body: dict) -> dict:
    """Drop slide_n/element_id keys that some planners pile into the body."""
    if not isinstance(body, dict):
        return body
    return {k: v for k, v in body.items() if k not in ("slide_n", "element_id", "doc_id")}


# ── Helpers ─────────────────────────────────────────────────────────────────


def _coerce_text_body(body: dict) -> dict:
    """Make the planner-emitted text body fit TextUpdateRequest schema.

    Acceptable shapes from planners:
      {"text": "..."}                   → wrap into a paragraph + run
      {"paragraphs": [...]}             → assume already strict
      {"runs": [...]}                   → wrap into a single paragraph
      {"font_bold": True, "text": ...}  → mix of text + run-level styles
    """
    if not isinstance(body, dict):
        return body
    if body.get("kind") == "paragraphs":
        return body  # already correct
    if "paragraphs" in body and isinstance(body["paragraphs"], list):
        return {"kind": "paragraphs", "paragraphs": body["paragraphs"]}
    # Compose run-level kwargs
    run: dict[str, object] = {}
    if "text" in body:
        run["text"] = str(body["text"])
    for key in ("font_name", "font_size", "font_bold", "font_italic",
                "font_underline", "font_color"):
        if key in body:
            run[key] = body[key]
    if "color" in body and "font_color" not in run:
        run["font_color"] = body["color"]
    if "bold" in body and "font_bold" not in run:
        run["font_bold"] = body["bold"]
    if "italic" in body and "font_italic" not in run:
        run["font_italic"] = body["italic"]
    if not run:
        # Nothing recognizable — pass body straight through, the API will reject.
        return body
    return {"kind": "paragraphs", "paragraphs": [{"runs": [run]}]}


def _user_block(prompt: str, context: dict, catalog_json: str) -> str:
    return (
        f"USER PROMPT:\n{prompt}\n\n"
        f"CONTEXT:\n{json.dumps(context, default=str, indent=2)}\n\n"
        f"CATALOG:\n{catalog_json}\n"
    )


def _to_tool_call(d: dict) -> ToolCall:
    return ToolCall(
        endpoint_id=d.get("endpoint_id", ""),
        path_args=dict(d.get("path_args") or {}),
        body=dict(d.get("body") or {}),
        reason=d.get("reason"),
        confirm=bool(d.get("confirm", False)),
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
        log.warning("planner: failed to parse JSON from LLM: %s — raw: %r", exc, text[:300])
        return {}
