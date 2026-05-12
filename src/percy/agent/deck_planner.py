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
class TemplateApplication:
    """One template-apply call that contributes to a slide."""
    template_id: str
    template_name: str
    inputs: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "template_name": self.template_name,
            "inputs": self.inputs,
        }


@dataclass(slots=True)
class SlidePlan:
    """Result of planning a single slide. May contain MULTIPLE template
    applications when the agent composes a slide from element-kind
    templates (e.g. title + subtitle + presenter line on a cover slot).
    """
    slot: int
    applications: list[TemplateApplication] = field(default_factory=list)
    rationale: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot": self.slot,
            "applications": [a.to_dict() for a in self.applications],
            "rationale": self.rationale,
            "error": self.error,
        }


# ── Per-slide LLM call ──────────────────────────────────────────────────────


_PER_SLIDE_SYSTEM = """\
You are composing ONE slide of a deck.

You see:
  * The deck's overall summary (context for tone + audience).
  * THIS slide's slot number and a short instruction describing what
    the slide should do, with specific copy / data quoted inline.
  * The full list of templates available in the active Template Set.

The set has TWO kinds of templates:
  * SLIDE templates  — a full-slide layout. One template = many elements
                       (e.g. a KPI dashboard with title + 3 tiles + delta
                       indicators baked in).
  * ELEMENT templates — a single reusable piece (e.g. a slide-title
                        block, a footer group, one KPI tile). To build
                        a slide from element templates you STACK
                        SEVERAL on the same slot.

Your job: produce a list of `applications`, in order, that together
render this slide. Each application is one template + its inputs.

  * If a single slide template fits the instruction well, that's ONE
    application — done.
  * If only element templates are available (or no slide template
    matches well), pick MULTIPLE element templates and stack them.
    For example: a cover slide from element templates =
      [slide_title application, subtitle application, presenter line
       application]
  * Use ELEMENT templates' `left_in` / `top_in` / `width_in` /
    `height_in` inputs to place them appropriately when stacking.

Filling each template's inputs:
  * Read the instruction and extract the literal copy in quotes
    (use verbatim), the numbers (verbatim), and the implied content
    for any other input the template needs.
  * If the schema has an input the instruction doesn't address, use
    the schema's default (or "" if no default).
  * If the instruction hints at mood ("a win", "the miss", "honest",
    "celebrate") and a template has an `accent` input, pick a fitting
    color (sage / brick / ochre / cobalt etc.).

Respond with one JSON object, no prose, no fences:

{
  "applications": [
    {
      "template_id": "<exact id from the available list>",
      "template_name": "<exact name>",
      "inputs": { <key>: <value>, ... }
    },
    ... one or more entries ...
  ],
  "rationale": "<one short sentence — why this composition?>"
}

Don't include templates that don't contribute meaningfully. 1-5
applications per slide is the typical range. If you stack element
templates, position them so they don't overlap.
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
        return SlidePlan(slot=spec.slot, error=str(exc))

    parsed = _parse_json(raw)
    if not parsed:
        log.warning("plan_single_slide[slot=%d]: unparseable response: %r",
                    spec.slot, raw[:300])
        return SlidePlan(slot=spec.slot, error="unparseable LLM response")

    # Accept the new shape (`applications: [...]`) and the legacy single-
    # template shape (`template_id` + `inputs`) for back-compat.
    raw_apps = parsed.get("applications") or []
    if not raw_apps and parsed.get("template_id"):
        raw_apps = [{
            "template_id": parsed["template_id"],
            "template_name": parsed.get("template_name", ""),
            "inputs": parsed.get("inputs") or {},
        }]

    applications: list[TemplateApplication] = []
    for app in raw_apps:
        if not isinstance(app, dict): continue
        tid = str(app.get("template_id") or "")
        if not tid: continue
        applications.append(TemplateApplication(
            template_id=tid,
            template_name=str(app.get("template_name") or ""),
            inputs=dict(app.get("inputs") or {}),
        ))

    if not applications:
        return SlidePlan(slot=spec.slot, error="LLM returned no applications")

    return SlidePlan(
        slot=spec.slot,
        applications=applications,
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
    vision_pass: bool = True,
    vision_max_retries: int = 1,
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

    # 2) Apply in slot order. Each slot may have MULTIPLE applications —
    # stacked element templates building one slide. Apply them in the
    # order the agent specified so positions / z-order make sense.
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

        slot_elements_total = 0
        slot_apply_errors: list[str] = []
        applications_run: list[dict[str, Any]] = []

        for app in plan.applications:
            tpl = next((t for t in available_templates if t.get("id") == app.template_id), None)
            if not tpl:
                slot_apply_errors.append(f"template {app.template_id!r} not in set")
                continue
            try:
                result = _tpls.apply_template(
                    tpl, studio=studio, slide_n=spec.slot, inputs=app.inputs,
                )
            except Exception as exc:
                slot_apply_errors.append(f"{app.template_id}: {exc}")
                continue
            n_elements = len(result.get("elements") or [])
            slot_elements_total += n_elements
            applications_run.append({
                "template_id": app.template_id,
                "template_name": app.template_name,
                "ok": result.get("ok"),
                "elements_created": n_elements,
                "apply_errors": result.get("errors") or [],
            })

        # ── Vision-pass critique (on by default) ──
        critique_dict: dict[str, Any] | None = None
        if vision_pass:
            critique_dict = _run_vision_pass(
                spec=spec, studio=studio, available_templates=available_templates,
                plan=plan, llm_call=llm_call,
                max_retries=vision_max_retries,
            )

        applied.append({
            "slot": spec.slot,
            "applications": applications_run,
            "elements_total": slot_elements_total,
            "rationale": plan.rationale,
            "apply_errors": slot_apply_errors,
            "critique": critique_dict,
        })
        if slot_apply_errors:
            errors.extend(f"slot {spec.slot}: {e}" for e in slot_apply_errors)

    plans_list = [plans_by_slot[s.slot] for s in blueprint.slides if s.slot in plans_by_slot]
    return BlueprintResult(
        plans=plans_list,
        applied=applied,
        errors=errors,
        ok=(len(applied) == len(blueprint.slides)),
    )


# ── Vision-pass plumbing ────────────────────────────────────────────────────


def _read_slide_elements(studio: Any, slot: int) -> list[dict[str, Any]]:
    """Pull the current state of a slide's elements via the studio HTTP
    surface. We use the svg-data endpoint which already returns the same
    JSON shape the critic expects."""
    try:
        result = studio._get(f"/api/docs/{studio.doc_id}/slides/{slot}/svg-data")
        return result.get("elements") or []
    except Exception as exc:
        log.warning("_read_slide_elements[slot=%d]: failed: %s", slot, exc)
        return []


def _run_vision_pass(
    *,
    spec: SlideSpec,
    studio: Any,
    available_templates: list[dict[str, Any]],
    plan: SlidePlan,
    llm_call: Callable[[str, str], str],
    max_retries: int = 1,
) -> dict[str, Any]:
    """Render slide → critique → optional one retry. Returns the final
    critique dict for inclusion in the apply result."""
    from percy.agent.slide_critic import critique_slide

    elements = _read_slide_elements(studio, spec.slot)
    critique = critique_slide(
        slide_elements=elements,
        instruction=spec.instruction,
        llm_call=llm_call,
    )

    log.info("vision_pass[slot=%d]: %s — %d issues, would_regenerate=%s",
             spec.slot, critique.overall_quality,
             len(critique.issues), critique.would_regenerate)

    # NOTE: actual retry-with-feedback isn't wired yet — would require
    # clearing the slide's elements + re-planning + re-applying. For v1
    # the critique is purely informational (surfaced on each applied
    # slide so callers can see quality issues at a glance).
    return critique.to_dict()


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
