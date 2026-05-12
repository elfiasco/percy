"""Blueprint-driven, per-slide deck planner.

The canonical flow for building a deck with the agent:

  1. **Blueprint** (JSON)  — declarative spec of what the deck should be:
       * deck_summary       — one paragraph context
       * brand_constraints  — color/voice hints (optional)
       * slides[]           — exactly N slot specs, each with:
                                slot     (1-indexed slide number)
                                intent   (short purpose — what this slide does)
                                content  (structured payload — the actual data
                                          the agent has to render)

  2. **Per-slide planning** — for each slot, ONE focused LLM call sees:
       * the deck summary (overall context)
       * the brand constraints
       * THIS slide's intent + content
       * the available templates from the active set
       Returns: {template_id, inputs}

  3. **Apply** — each plan calls apply_template against the studio doc.

This replaces the old "give the LLM the whole deck plan in one call" path
which clustered slides and missed inputs. Each LLM call here has narrow
context and one job. Parallelizable — 7 slides take roughly 1 call's
latency, not 7.

We use this both for the marketing demo (where the blueprint is canned)
and for user-facing chat (where the agent FIRST produces the blueprint
from the user's free-form brief, THEN runs this loop).
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── Blueprint dataclasses ───────────────────────────────────────────────────


@dataclass(slots=True)
class SlideSpec:
    """A single slide's blueprint entry.

    The `instruction` is a short human-language paragraph describing what
    this slide should do AND what content it should carry. Specific copy
    + data appears inline in quotes. The agent reads this + the deck
    summary + the active set's templates and decides the rest.

    Examples:
      slot=1, instruction='Cover slide. Title: "Q4 2025 Northwind Update".'
      slot=2, instruction='Headline win — make $2.4M ARR the whole slide.'
    """
    slot: int                                  # 1-indexed slide number
    instruction: str = ""                      # short paragraph

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SlideSpec":
        # Accept legacy intent+content shape too — fold them into a single
        # instruction string for back-compat with anything that hasn't
        # migrated yet.
        instruction = d.get("instruction")
        if not instruction:
            intent = (d.get("intent") or "").strip()
            content = d.get("content") or {}
            parts = [intent] if intent else []
            if content:
                parts.append("Content: " + ", ".join(
                    f"{k}={v!r}" for k, v in content.items()
                ))
            instruction = " ".join(parts)
        return cls(
            slot=int(d.get("slot") or 0),
            instruction=str(instruction),
        )


@dataclass(slots=True)
class Blueprint:
    deck_summary: str
    brand_constraints: dict[str, Any] = field(default_factory=dict)
    slides: list[SlideSpec] = field(default_factory=list)

    @property
    def slide_count(self) -> int:
        return len(self.slides)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Blueprint":
        return cls(
            deck_summary=str(d.get("deck_summary") or ""),
            brand_constraints=dict(d.get("brand_constraints") or {}),
            slides=[SlideSpec.from_dict(s) for s in (d.get("slides") or [])],
        )


@dataclass(slots=True)
class SlidePlan:
    """Result of planning a single slide. Ready to feed apply_template."""
    slot: int
    template_id: str
    template_name: str
    inputs: dict[str, Any]
    rationale: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot": self.slot, "template_id": self.template_id,
            "template_name": self.template_name, "inputs": self.inputs,
            "rationale": self.rationale, "error": self.error,
        }


# ── Per-slide LLM call ──────────────────────────────────────────────────────


_PER_SLIDE_SYSTEM = """\
You are choosing ONE template to render ONE slide of a deck.

You see:
  * The deck's overall summary (context for tone + audience).
  * THIS slide's slot number and a short instruction describing what
    the slide should do, with specific copy / data quoted inline.
  * The full list of templates available in the active Template Set.

Your job:

  1. Pick the SINGLE template_id from the available list that best fits
     this slide's instruction. Bias toward templates whose tags or
     description match the instruction's intent (chart template for
     chart-mentioning instructions, KPI tile for metric-mentioning
     instructions, big-number for single-metric, etc.).

  2. Read the instruction and extract:
       - the literal copy in quotes — use verbatim
       - the numbers / data — use verbatim
       - the implied content for any other input the template needs
     Fill the template's inputs_schema accordingly. If the schema has
     an input the instruction doesn't address, use the schema's
     default (or "" if no default).

  3. If the instruction hints at mood ("the miss", "a win", "honest",
     "celebrate") and the template has an `accent` input, pick a
     color that matches (sage / brick / ochre / cobalt etc.).

Respond with one JSON object, no prose, no fences:

{
  "template_id": "<exact id from the available list>",
  "template_name": "<exact name>",
  "inputs": { <key>: <value>, ... },
  "rationale": "<one short sentence — why this template?>"
}

If no template in the set is a good fit, pick the closest text-based
template and put the instruction's content into its primary text input.
"""


def plan_single_slide(
    *,
    spec: SlideSpec,
    deck_summary: str,
    brand_constraints: dict[str, Any],
    available_templates: list[dict[str, Any]],
    llm_call: Callable[[str, str], str],
) -> SlidePlan | None:
    """One LLM call: pick + fill a template for one slot."""
    # Slim each template entry to keep prompt size manageable.
    catalog: list[dict[str, Any]] = []
    for t in available_templates:
        catalog.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "description": (t.get("description") or "")[:200],
            "tags": (t.get("tags") or [])[:6],
            "inputs_schema": t.get("inputs_schema") or {},
            "sample_inputs": t.get("sample_inputs") or {},
        })

    user_payload = {
        "deck_summary": deck_summary,
        "brand_constraints": brand_constraints,
        "slide_slot": spec.slot,
        "slide_instruction": spec.instruction,
        "available_templates": catalog,
    }

    try:
        raw = llm_call(_PER_SLIDE_SYSTEM, json.dumps(user_payload, ensure_ascii=False, default=str)[:18000])
    except Exception as exc:
        log.warning("plan_single_slide[slot=%d]: LLM call failed: %s", spec.slot, exc)
        return SlidePlan(slot=spec.slot, template_id="", template_name="",
                         inputs={}, error=str(exc))

    parsed = _parse_json(raw)
    if not parsed or not parsed.get("template_id"):
        log.warning("plan_single_slide[slot=%d]: unparseable response: %r",
                    spec.slot, raw[:300])
        return SlidePlan(slot=spec.slot, template_id="", template_name="",
                         inputs={}, error="unparseable LLM response")

    return SlidePlan(
        slot=spec.slot,
        template_id=str(parsed.get("template_id") or ""),
        template_name=str(parsed.get("template_name") or ""),
        inputs=dict(parsed.get("inputs") or {}),
        rationale=str(parsed.get("rationale") or ""),
    )


# ── Top-level: blueprint → applied deck ────────────────────────────────────


@dataclass(slots=True)
class BlueprintResult:
    plans: list[SlidePlan]
    applied: list[dict[str, Any]]
    errors: list[str]
    ok: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "plans": [p.to_dict() for p in self.plans],
            "applied": self.applied,
            "errors": self.errors,
            "ok": self.ok,
        }


def apply_blueprint(
    *,
    blueprint: Blueprint,
    available_templates: list[dict[str, Any]],
    studio: Any,
    llm_call: Callable[[str, str], str],
    parallel: bool = True,
    max_workers: int = 7,
) -> BlueprintResult:
    """Plan every slide in parallel, then apply them sequentially.

    Parallelism is over the LLM calls (the network-bound step). The
    apply step runs serially against the studio doc — each apply_template
    mutates the in-memory document and we don't want races on the slides
    list.
    """
    from percy.agent import templates as _tpls

    # 1) Plan every slide. Parallel by default (each call is independent).
    plans_by_slot: dict[int, SlidePlan] = {}
    if parallel and len(blueprint.slides) > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_to_spec = {
                pool.submit(
                    plan_single_slide,
                    spec=spec,
                    deck_summary=blueprint.deck_summary,
                    brand_constraints=blueprint.brand_constraints,
                    available_templates=available_templates,
                    llm_call=llm_call,
                ): spec
                for spec in blueprint.slides
            }
            for fut in concurrent.futures.as_completed(future_to_spec):
                spec = future_to_spec[fut]
                try:
                    plan = fut.result()
                except Exception as exc:
                    log.exception("apply_blueprint: planning failed for slot %d", spec.slot)
                    plan = SlidePlan(slot=spec.slot, template_id="", template_name="",
                                     inputs={}, error=str(exc))
                if plan:
                    plans_by_slot[spec.slot] = plan
    else:
        for spec in blueprint.slides:
            plan = plan_single_slide(
                spec=spec,
                deck_summary=blueprint.deck_summary,
                brand_constraints=blueprint.brand_constraints,
                available_templates=available_templates,
                llm_call=llm_call,
            )
            if plan:
                plans_by_slot[spec.slot] = plan

    # 2) Apply in slot order. Each apply targets a distinct slide_n so
    # parallel application would be safe, but the studio doc's slides
    # list isn't thread-friendly to mutate concurrently. Sequential apply
    # finishes in well under a second per slide once the LLM work is done.
    applied: list[dict[str, Any]] = []
    errors: list[str] = []
    for spec in blueprint.slides:
        plan = plans_by_slot.get(spec.slot)
        if not plan:
            errors.append(f"slot {spec.slot}: no plan produced")
            continue
        if plan.error:
            errors.append(f"slot {spec.slot}: {plan.error}")
            continue

        # Look up the template by id from the available list.
        tpl = next((t for t in available_templates if t.get("id") == plan.template_id), None)
        if not tpl:
            errors.append(f"slot {spec.slot}: template {plan.template_id!r} not in set")
            continue

        try:
            result = _tpls.apply_template(tpl, studio=studio, slide_n=spec.slot,
                                            inputs=plan.inputs)
        except Exception as exc:
            errors.append(f"slot {spec.slot}: apply failed: {exc}")
            continue

        applied.append({
            "slot": spec.slot,
            "template_id": plan.template_id,
            "template_name": plan.template_name,
            "ok": result.get("ok"),
            "rationale": plan.rationale,
            "elements_created": len(result.get("elements") or []),
            "apply_errors": result.get("errors") or [],
        })

    plans_list = [plans_by_slot[s.slot] for s in blueprint.slides if s.slot in plans_by_slot]
    return BlueprintResult(
        plans=plans_list,
        applied=applied,
        errors=errors,
        ok=(len(applied) == len(blueprint.slides)),
    )


# ── Helpers ────────────────────────────────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except Exception:
        pass
    m = _JSON_BLOCK_RE.search(s)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None
