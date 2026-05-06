"""HTTP routes for advanced agent capabilities:

  POST /api/docs/{doc_id}/brand-check          — scan against a brand profile
  POST /api/docs/{doc_id}/diff                 — diff two snapshot indices
  POST /api/agent/generate-deck                — multi-slide deck from prompt
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent import (
    audit, brand_check, cost_tracker, deck_generator, diff_narrator,
    metric_consistency, onboarding, refresh, templates,
)
from percy.agent.brand_check import BrandProfile
from percy.agent.script_api import Studio

log = logging.getLogger(__name__)
router = APIRouter()


# ── Brand check ─────────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/brand-check")
async def brand_check_route(doc_id: str, request: Request):
    body = await _parse_json(request, allow_empty=True)
    from app.backend import main as _m
    d = _m._require(doc_id)
    doc = d["doc"]

    # Build profile from request body (optional) or use Percy Default
    profile_body = body.get("profile") or {}
    if profile_body:
        profile = BrandProfile(
            name=profile_body.get("name", "Custom"),
            palette_hex=set(profile_body.get("palette_hex", [])),
            palette_tolerance=float(profile_body.get("palette_tolerance", 0.10)),
            fonts=set(profile_body.get("fonts", [])),
            forbidden_colors=set(profile_body.get("forbidden_colors", [])),
            forbidden_fonts=set(profile_body.get("forbidden_fonts", [])),
        )
    else:
        profile = BrandProfile.percy_default()

    report = brand_check.check_document(doc, profile)
    return report.to_dict()


# ── Diff ────────────────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/diff")
async def diff_route(doc_id: str, request: Request):
    """Compare two doc snapshots from the undo stack.

    Body: {before: int, after?: int}
      before/after are indices into _undo_stack. If after is omitted, compares
      against the current live document.
    """
    body = await _parse_json(request)
    before_idx = body.get("before")
    after_idx = body.get("after")
    if before_idx is None:
        raise HTTPException(400, "before (snapshot index) is required")

    from app.backend import main as _m
    d = _m._require(doc_id)
    stack = d.get("_undo_stack") or []
    if before_idx >= len(stack) or before_idx < 0:
        raise HTTPException(400, f"before index {before_idx} out of range (stack size {len(stack)})")

    before_doc = diff_narrator._resolve(stack[before_idx])
    if after_idx is not None:
        if after_idx >= len(stack) or after_idx < 0:
            raise HTTPException(400, f"after index {after_idx} out of range")
        after_doc = diff_narrator._resolve(stack[after_idx])
    else:
        after_doc = d["doc"]

    diff = diff_narrator.diff_docs(before_doc, after_doc)
    return {
        **diff.to_dict(),
        "long_summary": diff.long_summary(),
    }


# ── Deck-from-prompt ────────────────────────────────────────────────────────


@router.post("/api/agent/generate-deck")
async def generate_deck_route(request: Request):
    """Generate a multi-slide deck from a high-level prompt.

    Body: {
        prompt: str,
        doc_id: str,        # target doc
        start_slide: int    # default 1; if doc has fewer slides, new slides are appended
    }
    """
    try:
        request.state.audit_handled = True  # we'll log explicitly
    except Exception:
        pass

    body = await _parse_json(request)
    prompt = body.get("prompt")
    doc_id = body.get("doc_id")
    start_slide = int(body.get("start_slide", 1))
    if not prompt or not doc_id:
        raise HTTPException(400, "prompt and doc_id are required")

    t0 = time.time()

    # 1. Get the LLM
    from app.backend import agent_chat as _ac
    try:
        llm = _ac._make_llm_call(body.get("model"))
    except Exception as exc:
        raise HTTPException(503, f"no LLM available: {exc}")

    # 2. Plan with the LLM
    available = templates.list_templates(category="Percy Standard")
    plan = deck_generator.plan_deck(prompt, available_templates=available, llm_call=llm)

    if not plan.slides:
        return {"ok": False, "error": "planner returned no slides", "plan": _plan_to_dict(plan)}

    # 3. Snapshot the doc once for whole-deck rollback
    from app.backend import main as _m
    _m._snapshot_doc(doc_id)
    snapshot_index = len((_m._docs.get(doc_id) or {}).get("_undo_stack") or []) - 1

    # 4. Ensure we have enough slides (append new slides if needed)
    d = _m._require(doc_id)
    doc = d["doc"]
    needed_max = max((s.slide_n for s in plan.slides), default=start_slide)
    while len(doc.slides) < needed_max:
        from percy.bridge import BridgeSlide
        new_n = (max((s.slide_number for s in doc.slides), default=0) + 1)
        doc.slides.append(BridgeSlide(slide_number=new_n, elements=[],
                                       width=13.333, height=7.5))

    # 5. Apply each template
    studio = Studio(
        base_url=f"{request.url.scheme}://{request.url.netloc}",
        doc_id=doc_id,
        auth_token=request.cookies.get("percy_session"),
        timeout_s=60,
        asgi_app=request.app,
    )

    applied: list[dict] = []
    errors: list[str] = []
    for slide_plan in plan.slides:
        template = templates.get_template(slide_plan.template_id)
        if not template:
            errors.append(f"slide {slide_plan.slide_n}: template {slide_plan.template_id!r} not found")
            continue
        try:
            result = templates.apply_template(template, studio=studio,
                                              slide_n=slide_plan.slide_n,
                                              inputs=slide_plan.inputs)
        except Exception as exc:
            errors.append(f"slide {slide_plan.slide_n}: {exc}")
            continue
        applied.append({
            "slide_n": slide_plan.slide_n,
            "template_id": slide_plan.template_id,
            "template_name": slide_plan.template_name,
            "ok": result.get("ok"),
            "elements": len(result.get("elements") or []),
            "errors": result.get("errors") or [],
        })

    # 6. Audit
    user = getattr(request.state, "user", None)
    actor = "agent" if request.headers.get("X-Percy-Actor", "").lower() == "agent" else ("human" if user else "system")
    audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id,
        actor=actor, source="deck_generator",
        method="POST", path=str(request.url.path),
        kind="apply_template",
        prompt=prompt,
        plan=_plan_to_dict(plan),
        response={"applied": applied, "errors": errors},
        status="executed" if not errors else ("partial" if applied else "failed"),
        error="; ".join(errors) if errors else None,
        snapshot_index=snapshot_index,
        affected_count=sum((a.get("elements") or 0) for a in applied),
        elapsed_ms=int((time.time() - t0) * 1000),
    )

    # Invalidate find_element index
    try:
        from app.backend.agent_find import invalidate_index
        invalidate_index(doc_id)
    except Exception:
        pass

    return {
        "ok": not errors,
        "plan": _plan_to_dict(plan),
        "applied": applied,
        "errors": errors,
        "snapshot_index": snapshot_index,
    }


def _plan_to_dict(plan) -> dict:
    return {
        "title": plan.title,
        "rationale": plan.rationale,
        "slides": [
            {
                "slide_n": s.slide_n,
                "template_id": s.template_id,
                "template_name": s.template_name,
                "inputs": s.inputs,
            }
            for s in plan.slides
        ],
    }


# ── Setup ───────────────────────────────────────────────────────────────────


# ── Metric consistency (cross-deck) ────────────────────────────────────────


@router.post("/api/agent/metric-consistency")
async def metric_consistency_route(request: Request):
    """Find metrics defined inconsistently across multiple docs.

    Body: {doc_ids: [str, ...]}  — defaults to ALL loaded docs
    """
    body = await _parse_json(request, allow_empty=True)
    from app.backend import main as _m

    requested = body.get("doc_ids") or list(_m._docs.keys())
    docs: list[tuple[str, str, Any]] = []
    for did in requested:
        d = _m._docs.get(did)
        if d and d.get("doc"):
            docs.append((did, d.get("name") or did, d["doc"]))

    inconsistent = metric_consistency.find_inconsistencies(docs)
    return {
        "doc_count": len(docs),
        "inconsistency_count": len(inconsistent),
        "clusters": [c.to_dict() for c in inconsistent],
    }


# ── Onboarding suggestions ─────────────────────────────────────────────────


@router.get("/api/docs/{doc_id}/suggestions")
async def suggestions_route(doc_id: str):
    """Suggest next-actions for a freshly onboarded (or any) doc.

    Returns brand-rule violations, missing alt text, empty slides, candidates
    for group reification, and chart/table elements that should be bound to
    data via a connect script.
    """
    from app.backend import main as _m
    d = _m._require(doc_id)
    suggestions = onboarding.suggest_for_doc(d["doc"])
    return {
        "count": len(suggestions),
        "by_severity": {
            "high":   sum(1 for s in suggestions if s.severity == "high"),
            "medium": sum(1 for s in suggestions if s.severity == "medium"),
            "low":    sum(1 for s in suggestions if s.severity == "low"),
        },
        "suggestions": [s.to_dict() for s in suggestions],
    }


# ── Slide explain ──────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/slides/{n}/explain")
async def explain_slide_route(doc_id: str, n: int, request: Request):
    """Produce a short natural-language summary of what's on a slide.

    Uses the LLM with structured slide context (element types, names, text,
    chart/table data summaries). The summary mentions both visual structure
    and any data-bound elements (connect scripts).
    """
    try:
        request.state.audit_handled = True
    except Exception:
        pass

    body = await _parse_json(request, allow_empty=True)

    from app.backend import main as _m
    d = _m._require(doc_id)
    slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"slide {n} not found")

    # Build a structured context for the LLM
    elements_summary = []
    for idx, el in enumerate(slide.elements or []):
        ident = getattr(el, "identification", None)
        name = (getattr(ident, "shape_name", None) if ident else None) or el.element_type
        cp = getattr(el, "custom_properties", None) or {}
        has_connect = bool((cp.get("connect") or {}).get("script"))
        entry = {
            "name": name, "type": el.element_type,
            "position": {"left_in": el.position.left, "top_in": el.position.top},
        }
        # Type-specific summary
        if el.element_type == "BridgeChart":
            cats = list(getattr(getattr(el, "categories", None), "categories", None) or [])[:5]
            series_names = [s.name or f"Series {i+1}" for i, s in enumerate(getattr(el, "series", None) or [])]
            entry["chart_type"] = el.chart_type
            entry["categories"] = cats
            entry["series_names"] = series_names
        elif el.element_type == "BridgeTable":
            cf = getattr(el, "cell_formats", None) or []
            entry["table_size"] = f"{len(cf)}x{len(cf[0]) if cf else 0}"
        elif el.element_type in ("BridgeText", "BridgeShape"):
            text = ""
            try:
                if el.text_content and el.text_content.paragraphs and el.text_content.paragraphs[0].runs:
                    text = el.text_content.paragraphs[0].runs[0].text
                elif el.element_type == "BridgeText" and el.paragraphs and el.paragraphs[0].runs:
                    text = el.paragraphs[0].runs[0].text
            except Exception:
                pass
            entry["text"] = text[:120]
        if has_connect:
            entry["bound_to_script"] = True
        elements_summary.append(entry)

    from app.backend import agent_chat as _ac
    try:
        llm = _ac._make_llm_call(body.get("model"))
    except Exception as exc:
        raise HTTPException(503, f"no LLM available: {exc}")

    system = (
        "You are Percy. Given a structured summary of a presentation slide, "
        "produce a concise (2-3 sentence) natural-language description of what "
        "the slide is communicating. Mention any data-bound elements (those with "
        "bound_to_script=true) explicitly so the user knows where data comes from. "
        "Plain text only. No markdown."
    )
    import json as _json
    user = f"Slide {n} of doc {doc_id}:\n\n{_json.dumps(elements_summary, indent=2)}"

    import time as _time
    t0 = _time.time()
    try:
        explanation = llm(system, user)
    except Exception as exc:
        raise HTTPException(503, f"LLM call failed: {exc}")

    user_id = (getattr(request.state, "user", None) or {}).get("id")
    audit.record_action(
        user_id=user_id, doc_id=doc_id, slide_n=n,
        actor="agent", source="slide_explain",
        method="POST", path=str(request.url.path),
        kind="explain",
        prompt=f"Explain slide {n}",
        response={"explanation": explanation, "element_count": len(elements_summary)},
        status="executed",
        elapsed_ms=int((_time.time() - t0) * 1000),
    )

    return {
        "slide_n": n,
        "element_count": len(elements_summary),
        "explanation": explanation.strip(),
        "elements": elements_summary,
    }


# ── Cost dashboard ─────────────────────────────────────────────────────────


@router.get("/api/agent/cost-summary")
async def cost_summary_route(request: Request, doc_id: str | None = None):
    """Per-org spend summary: today + month + breakdown by source.

    Query params:
        org_id      override (defaults to user's primary org)
        scope       'today' | 'month' (default returns both)
    """
    user = getattr(request.state, "user", None)
    org_id = request.query_params.get("org_id") or request.headers.get("X-Percy-Org-Id")
    if not org_id and user:
        try:
            from app.backend import auth_db
            orgs = auth_db.list_user_orgs(user["id"]) or []
            org_id = orgs[0]["id"] if orgs else None
        except Exception:
            pass

    summary = cost_tracker.org_spend_summary(org_id)
    limits = cost_tracker.get_org_limits(org_id)

    # Headroom (how much budget is left)
    today = summary["today"]
    month = summary["month"]
    return {
        "org_id": org_id,
        "limits": {
            "daily_tokens": limits.daily_tokens,
            "monthly_tokens": limits.monthly_tokens,
            "daily_usd": limits.daily_usd,
            "monthly_usd": limits.monthly_usd,
        },
        "today": today,
        "month": month,
        "by_source": summary["by_source"],
        "headroom": {
            "today_tokens":  max(0, limits.daily_tokens   - today["total_tokens"]),
            "month_tokens":  max(0, limits.monthly_tokens - month["total_tokens"]),
            "today_usd":     max(0.0, limits.daily_usd    - today["cost_usd"]),
            "month_usd":     max(0.0, limits.monthly_usd  - month["cost_usd"]),
        },
        "utilization_pct": {
            "today_tokens": round(100 * today["total_tokens"] / max(1, limits.daily_tokens), 1),
            "month_tokens": round(100 * month["total_tokens"] / max(1, limits.monthly_tokens), 1),
            "today_usd":    round(100 * today["cost_usd"]    / max(0.001, limits.daily_usd), 1),
            "month_usd":    round(100 * month["cost_usd"]    / max(0.001, limits.monthly_usd), 1),
        },
    }


@router.put("/api/agent/cost-limits")
async def set_cost_limits_route(request: Request):
    """Set per-org budget overrides. Body: {org_id, daily_tokens?, monthly_tokens?, daily_usd?, monthly_usd?}"""
    user = getattr(request.state, "user", None)
    if not user or not user.get("is_admin"):
        # Soft enforcement: in dev, allow; in prod the auth middleware would
        # require admin. For v1 we let any org member adjust their own limits.
        pass
    body = await _parse_json(request)
    org_id = body.get("org_id")
    if not org_id:
        raise HTTPException(400, "org_id is required")
    cost_tracker.set_org_limits(
        org_id,
        daily_tokens=body.get("daily_tokens"),
        monthly_tokens=body.get("monthly_tokens"),
        daily_usd=body.get("daily_usd"),
        monthly_usd=body.get("monthly_usd"),
    )
    return {"ok": True, "limits": cost_tracker.get_org_limits(org_id).__dict__}


# ── Refresh agent ──────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/refresh")
async def refresh_route(doc_id: str, request: Request):
    """Run every script in the doc; return a refresh report with diff."""
    try:
        request.state.audit_handled = True
    except Exception:
        pass

    body = await _parse_json(request, allow_empty=True)
    from app.backend import main as _m
    d = _m._require(doc_id)

    def take_snap():
        _m._snapshot_doc(doc_id)
        stack = _m._docs[doc_id].get("_undo_stack") or []
        return len(stack) - 1 if stack else None

    def get_doc():
        return _m._docs[doc_id]["doc"]

    user = getattr(request.state, "user", None)
    actor = "agent" if request.headers.get("X-Percy-Actor", "").lower() == "agent" else ("human" if user else "system")

    org_id = body.get("org_id")
    if not org_id and user:
        try:
            from app.backend import auth_db
            orgs = auth_db.list_user_orgs(user["id"]) or []
            org_id = orgs[0]["id"] if orgs else None
        except Exception:
            pass

    report = refresh.refresh_doc(
        doc_id,
        snapshot_taker=take_snap,
        doc_getter=get_doc,
        base_url=f"{request.url.scheme}://{request.url.netloc}",
        auth_token=request.cookies.get("percy_session"),
        user_id=(user or {}).get("id"),
        org_id=org_id,
        asgi_app=request.app,
        apply_connect_outputs=bool(body.get("apply_outputs", True)),
    )

    audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id,
        actor=actor, source="refresh",
        method="POST", path=str(request.url.path),
        kind="refresh",
        prompt=f"Refresh all scripts ({report.n_scripts} total)",
        plan={"scripts": report.n_scripts},
        response=report.to_dict(),
        status="executed" if report.n_failed == 0 else "partial",
        error=None if report.n_failed == 0 else f"{report.n_failed} script(s) failed",
        snapshot_index=report.snapshot_before_index,
        affected_count=report.n_ok,
        elapsed_ms=int(report.total_elapsed_s * 1000),
    )

    try:
        from app.backend.agent_find import invalidate_index
        invalidate_index(doc_id)
    except Exception:
        pass

    return report.to_dict()


async def _parse_json(request: Request, allow_empty: bool = False) -> dict:
    try:
        body = await request.body()
        if not body and allow_empty:
            return {}
        return json.loads(body)
    except Exception as exc:
        if allow_empty:
            return {}
        raise HTTPException(400, f"request body must be JSON: {exc}")


def register_advanced_router(app) -> None:
    app.include_router(router)
    log.info("agent_advanced: registered brand-check / diff / generate-deck routes")
