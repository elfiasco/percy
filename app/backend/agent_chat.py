"""Replacement for the legacy POST /api/docs/{doc_id}/chat endpoint.

Wires together everything we've built:
  * router.classify           → static_plan | iterative_plan | scripted_plan
  * planner.plan_*            → builds a Plan
  * sandbox.run_*             → executes scripted plans
  * planner.execute_plan      → executes static/iterative plans
  * audit.record_action       → one row per agent invocation
  * snapshot rollback         → piggybacks on existing _snapshot_doc

The legacy endpoint at app/backend/main.py:10535 is shimmed to call into
this module. The new endpoint is exposed at:

    POST /api/agent/chat

with body:

    {
      "doc_id":            str,
      "messages":          [{"role": ..., "content": ...}, ...],
      "context": {
        "viewing_slide_n":     int?,
        "selected_element_id": str?,
        "user_confirmed":      bool?
      }
    }

Returns:

    {
      "reply":          str,
      "mode":           str,
      "actions_taken":  int,
      "plan":           {...},          # for preview / activity log
      "execution":      {...},          # step-level detail
      "action_id":      str             # rowid in agent_actions
    }
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent import audit, planner, router as agent_router
from percy.agent.planner import ExecutionResult, Plan, ToolCall
from percy.agent.script_api import Studio
from percy.agent.sandbox import ScopeManifest, run_live_group_generator, run_slide_script

log = logging.getLogger(__name__)
router = APIRouter()


# ── Lazy main.py helpers ────────────────────────────────────────────────────


def _main():
    fn = _main
    cache = getattr(fn, "_cache", None)
    if cache is None:
        from app.backend import main as _m
        cache = {"docs": _m._docs, "require": _m._require, "snapshot": _m._snapshot_doc}
        fn._cache = cache  # type: ignore[attr-defined]
    return cache


# ── LLM connection ──────────────────────────────────────────────────────────


def _make_llm_call(model_hint: str | None = None):
    """Return a callable ``(system, user) -> str`` that invokes the configured LLM.

    Resolution order (PERCY_LLM_PROVIDER env var overrides):
      1. PERCY_LLM_PROVIDER=bedrock  → AWS Bedrock with Anthropic Claude (IAM auth)
      2. PERCY_LLM_PROVIDER=anthropic  → direct Anthropic API
      3. PERCY_LLM_PROVIDER=openai     → direct OpenAI
      4. PERCY_LLM_PROVIDER=lmstudio   → local LM Studio
      5. (auto)  ANTHROPIC_API_KEY → anthropic
                  OPENAI_API_KEY    → openai
                  AWS creds + Bedrock model env → bedrock
                  else              → lmstudio
    """
    provider = os.environ.get("PERCY_LLM_PROVIDER", "").lower().strip()

    if provider == "bedrock" or (not provider and os.environ.get("PERCY_BEDROCK_MODEL")):
        return _bedrock_call(model_hint or os.environ.get("PERCY_BEDROCK_MODEL")
                             or "anthropic.claude-sonnet-4-v1:0")
    if provider == "anthropic" or (not provider and os.environ.get("ANTHROPIC_API_KEY")):
        return _anthropic_call(model_hint or "claude-sonnet-4-6")
    if provider == "openai" or (not provider and os.environ.get("OPENAI_API_KEY")):
        return _openai_call(model_hint or "gpt-4o")
    return _lmstudio_call(model_hint or "qwen/qwen3-coder-30b")


def _bedrock_call(model: str):
    """Bedrock-backed Anthropic Claude. Requires AWS credentials (via the App
    Runner instance role in prod, or PERCY_AWS_PROFILE locally).

    Uses ``AnthropicBedrock`` from the official ``anthropic`` SDK so the rest
    of the planner code (which expects ``messages.create``) works unchanged.
    """
    try:
        from anthropic import AnthropicBedrock
    except ImportError as exc:
        raise RuntimeError(
            "Bedrock requires the anthropic[bedrock] extra: "
            "pip install 'anthropic[bedrock]>=0.40.0'"
        ) from exc

    region = os.environ.get("PERCY_BEDROCK_REGION", "us-east-1")
    client = AnthropicBedrock(aws_region=region)

    def call(system: str, user: str) -> str:
        resp = client.messages.create(
            model=model, max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        # Surface usage to the cost tracker via a thread-local hook
        usage = getattr(resp, "usage", None)
        if usage is not None:
            _stash_usage("bedrock", model,
                         getattr(usage, "input_tokens", 0),
                         getattr(usage, "output_tokens", 0))
        return next((b.text for b in resp.content if hasattr(b, "text")), "")
    return call


def _anthropic_call(model: str):
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    def call(system: str, user: str) -> str:
        resp = client.messages.create(
            model=model, max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        usage = getattr(resp, "usage", None)
        if usage is not None:
            _stash_usage("anthropic", model,
                         getattr(usage, "input_tokens", 0),
                         getattr(usage, "output_tokens", 0))
        return next((b.text for b in resp.content if hasattr(b, "text")), "")
    return call


# ── Per-call usage tracking (thread-local stash, harvested by chat handler) ──

import threading
_USAGE_STASH = threading.local()


def _stash_usage(provider: str, model: str, input_tokens: int, output_tokens: int) -> None:
    """Called by the LLM-call wrappers; harvested by the chat handler when it
    writes the audit + cost telemetry rows."""
    bucket = getattr(_USAGE_STASH, "calls", None)
    if bucket is None:
        bucket = []
        _USAGE_STASH.calls = bucket
    bucket.append({"provider": provider, "model": model,
                   "input_tokens": int(input_tokens or 0),
                   "output_tokens": int(output_tokens or 0)})


def _harvest_usage() -> list[dict]:
    bucket = getattr(_USAGE_STASH, "calls", None) or []
    _USAGE_STASH.calls = []
    return bucket


def _openai_call(model: str):
    import urllib.request, urllib.error
    api_key = os.environ["OPENAI_API_KEY"]

    def call(system: str, user: str) -> str:
        body = {"model": model, "max_tokens": 2048,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}]}
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read())
        return data["choices"][0]["message"]["content"]
    return call


_LMSTUDIO_BASE = os.environ.get("PERCY_LMSTUDIO_URL", "http://localhost:1234").rstrip("/")


def _lmstudio_call(model: str):
    import urllib.request, urllib.error

    # Resolve model — if the requested one isn't loaded, pick the first
    # non-embedding chat model that is.
    resolved_model = _resolve_lmstudio_model(model)

    def call(system: str, user: str) -> str:
        body = {"model": resolved_model, "max_tokens": 2048, "temperature": 0.1,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}]}
        req = urllib.request.Request(
            f"{_LMSTUDIO_BASE}/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"LM Studio HTTP {exc.code}: {err_body}")
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Cannot reach LM Studio at {_LMSTUDIO_BASE}: {exc}. "
                f"Start LM Studio (or set PERCY_LMSTUDIO_URL / ANTHROPIC_API_KEY / OPENAI_API_KEY)."
            )
        return data["choices"][0]["message"]["content"]
    return call


def _resolve_lmstudio_model(preferred: str) -> str:
    import urllib.request
    try:
        with urllib.request.urlopen(f"{_LMSTUDIO_BASE}/v1/models", timeout=5) as r:
            loaded = [m["id"] for m in json.loads(r.read()).get("data", [])]
    except Exception:
        return preferred  # let downstream fail with a real error
    if preferred in loaded:
        return preferred
    # Prefer instruct/chat-class models over embeddings + tiny ones
    chat_candidates = [m for m in loaded
                       if "embed" not in m.lower() and "1b" not in m.lower()
                       and "1.1b" not in m.lower()]
    # Strong preference order based on what tested cleanly
    prefs = ("qwen3-coder", "gpt-oss", "llama-3.3", "qwen", "gpt-4o", "gemma-4")
    for pref in prefs:
        for m in chat_candidates:
            if pref in m.lower():
                return m
    if chat_candidates:
        return chat_candidates[0]
    return loaded[0] if loaded else preferred


# ── Endpoint ────────────────────────────────────────────────────────────────


@router.post("/api/agent/chat")
async def agent_chat(request: Request):
    # Suppress middleware audit-logging for the chat call itself — we write
    # a richer row below with the planner's plan + execution.
    try:
        request.state.audit_handled = True
    except Exception:
        pass
    body = await _parse_json(request)
    doc_id = body.get("doc_id")
    if not doc_id:
        raise HTTPException(400, "doc_id is required")
    messages = body.get("messages") or []
    if not messages:
        raise HTTPException(400, "messages must contain at least one user turn")
    user_prompt = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        None,
    )
    if not user_prompt:
        raise HTTPException(400, "no user message found in messages")

    ctx = body.get("context") or {}
    user_confirmed = bool(ctx.get("user_confirmed", False))
    user_id = _user_id(request)

    helpers = _main()
    helpers["require"](doc_id)

    # --- 0. Budget check ----------------------------------------------------
    # Pre-flight: would this call exceed the org's daily/monthly token or $ budget?
    from percy.agent import cost_tracker as _ct
    org_id = _resolve_org_id(request)
    budget_check = _ct.check_budget(
        org_id, estimated_input_tokens=4500, estimated_output_tokens=800,
    )
    if not budget_check.allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "budget_exceeded",
                "message": budget_check.reason,
                "headroom": {
                    "today_usd": round(budget_check.headroom_today_usd, 4),
                    "today_tokens": budget_check.headroom_today_tokens,
                    "month_usd": round(budget_check.headroom_month_usd, 4),
                    "month_tokens": budget_check.headroom_month_tokens,
                },
            },
        )
    _harvest_usage()  # clear any stale stash

    # --- 1. Classify mode ---------------------------------------------------
    t_start = time.time()
    try:
        llm = _make_llm_call(ctx.get("model"))
    except Exception as exc:
        raise HTTPException(503, f"no LLM available: {exc}")

    def _safe_llm(system: str, user: str) -> str:
        try:
            return llm(system, user)
        except RuntimeError as exc:
            raise HTTPException(503, f"LLM unavailable: {exc}")
        except Exception as exc:
            raise HTTPException(503, f"LLM error: {exc}")

    llm = _safe_llm

    decision = agent_router.classify(user_prompt, llm_call=llm)
    log.info("agent_chat: mode=%s (%.2f, %s) prompt=%r",
             decision.mode, decision.confidence, decision.method, user_prompt[:80])

    # --- 2. Plan ------------------------------------------------------------
    from app.backend import agent_manifest
    manifest = agent_manifest.get_manifest()
    catalog_endpoints = planner.filter_manifest_for_mode(manifest, decision.mode)
    # Top-k retrieval over the manifest — keeps prompts within small-model context.
    top_k = int(os.environ.get("PERCY_MANIFEST_TOPK", "12"))
    if decision.mode != "scripted_plan" and len(catalog_endpoints) > top_k:
        catalog_endpoints = planner.retrieve_endpoints(user_prompt, catalog_endpoints, top_k=top_k)
    catalog_json = planner.render_catalog(catalog_endpoints)

    planner_context = {
        "doc_id": doc_id,
        "viewing_slide_n": ctx.get("viewing_slide_n"),
        "selected_element_id": ctx.get("selected_element_id"),
        "deck_summary": _deck_summary(doc_id),
    }

    # For coder mode, pull in supplementary-material chunks the script may need.
    if decision.mode == "scripted_plan":
        try:
            from percy.agent import materials as _materials
            material_chunks = _materials.retrieve_chunks(doc_id, user_prompt, top_k=4)
            if material_chunks:
                planner_context["materials"] = [
                    {
                        "filename": c["filename"],
                        "kind": c["kind"],
                        "name": c["name"],
                        "text": (c["text"] or "")[:1500],
                        "score": c["score"],
                    }
                    for c in material_chunks
                ]
        except Exception as exc:
            log.warning("agent_chat: materials retrieval failed: %s", exc)

    if decision.mode == "scripted_plan":
        plan = planner.plan_scripted(user_prompt, catalog_json=catalog_json,
                                      context=planner_context, llm_call=llm)
    elif decision.mode == "iterative_plan":
        plan = _run_iterative(user_prompt, catalog_json=catalog_json,
                              context=planner_context, llm_call=llm,
                              studio=_studio_client(request, doc_id))
    else:
        plan = planner.plan_static(user_prompt, catalog_json=catalog_json,
                                    context=planner_context, llm_call=llm)

    # --- 3. Clarify shortcut ------------------------------------------------
    if plan.clarify:
        action_id = audit.record_action(
            user_id=user_id, doc_id=doc_id, prompt=user_prompt,
            kind="find" if decision.mode == "static_plan" else "edit",
            actor="agent", source="chat",
            method="POST", path="/api/agent/chat",
            mode=decision.mode, plan=plan.to_dict(),
            status="planned", elapsed_ms=int((time.time() - t_start) * 1000),
        )
        return {
            "reply": plan.clarify, "mode": decision.mode, "actions_taken": 0,
            "plan": plan.to_dict(), "action_id": action_id,
            "needs_clarification": True,
        }

    # --- 4. Execute ---------------------------------------------------------
    action_id = audit.record_action(
        user_id=user_id, doc_id=doc_id, prompt=user_prompt,
        kind=("code" if decision.mode == "scripted_plan" else "edit"),
        actor="agent", source="chat",
        method="POST", path="/api/agent/chat",
        mode=decision.mode, plan=plan.to_dict(),
        affected_count=plan.affected_count(),
        status="planned",
    )

    # Snapshot before mutating.
    helpers["snapshot"](doc_id)
    snapshot_index = len(helpers["docs"][doc_id].get("_undo_stack") or []) - 1

    if decision.mode == "scripted_plan":
        exec_result = _execute_scripted(plan, doc_id=doc_id, request=request)
    elif decision.mode == "iterative_plan":
        # Iterative was already executed inside _run_iterative; plan.calls is
        # the executed history, not a forward plan.
        exec_result = ExecutionResult(ok=True, steps=[], elapsed_ms=0, snapshot_index=snapshot_index)
    else:
        studio = _studio_client(request, doc_id)
        exec_result = planner.execute_plan(
            plan, studio=studio, user_confirmed=user_confirmed,
            confirm_threshold=int(os.environ.get("PERCY_CONFIRM_THRESHOLD", "5")),
        )

    # --- 5. Update audit ----------------------------------------------------
    audit.update_action(
        action_id, status=("executed" if exec_result.ok else "failed"),
        error=exec_result.error,
        snapshot_index=snapshot_index,
        affected_count=plan.affected_count(),
        response={"steps": [_step_dict(s) for s in exec_result.steps]},
        elapsed_ms=int((time.time() - t_start) * 1000),
    )

    # --- 6. Telemetry + cost tracking --------------------------------------
    audit.record_telemetry(
        user_id=user_id, doc_id=doc_id, prompt=user_prompt,
        mode_classified=decision.mode,
        retrieved_ids=[c.endpoint_id for c in plan.calls],
        plan_summary=plan.rationale,
        validation="ok" if exec_result.ok else "exec_error",
        executed=exec_result.ok, error=exec_result.error,
        latency_ms=int((time.time() - t_start) * 1000),
    )
    # Harvest per-call usage emitted by the LLM wrappers and persist as
    # individual rows so the cost dashboard can break down by source/model.
    for usage in _harvest_usage():
        _ct.record_call(_ct.CallRecord(
            user_id=user_id, org_id=org_id, doc_id=doc_id,
            provider=usage["provider"], model=usage["model"],
            source="chat",
            input_tokens=usage["input_tokens"], output_tokens=usage["output_tokens"],
            action_id=action_id, latency_ms=int((time.time() - t_start) * 1000),
        ))

    # --- 7. Reply -----------------------------------------------------------
    reply = _summarize_reply(decision, plan, exec_result)

    return {
        "reply": reply,
        "mode": decision.mode,
        "mode_method": decision.method,
        "mode_confidence": decision.confidence,
        "actions_taken": sum(1 for s in exec_result.steps if s.ok),
        "plan": plan.to_dict(),
        "execution": {
            "ok": exec_result.ok,
            "error": exec_result.error,
            "steps": [_step_dict(s) for s in exec_result.steps],
            "elapsed_ms": exec_result.elapsed_ms,
        },
        "action_id": action_id,
        "snapshot_index": snapshot_index,
    }


# ── Activity / rollback ─────────────────────────────────────────────────────


@router.get("/api/agent/actions")
async def list_actions(request: Request, doc_id: str | None = None, limit: int = 50):
    user_id = _user_id(request)
    return {"actions": audit.list_actions(doc_id=doc_id, user_id=user_id, limit=limit)}


@router.post("/api/agent/actions/{action_id}/rollback")
async def rollback_action(action_id: str, request: Request):
    """Restore the doc snapshot taken before this agent action."""
    record = audit.get_action(action_id)
    if not record:
        raise HTTPException(404, f"action {action_id} not found")
    doc_id = record["doc_id"]
    snapshot_index = record.get("snapshot_index")
    if snapshot_index is None:
        raise HTTPException(400, "no snapshot recorded for this action")

    helpers = _main()
    d = helpers["require"](doc_id)
    stack = d.get("_undo_stack") or []
    if snapshot_index >= len(stack):
        raise HTTPException(400, f"snapshot_index {snapshot_index} out of range (stack size {len(stack)})")

    import pickle as _pickle
    d["doc"] = _pickle.loads(stack[snapshot_index])
    # Truncate the undo stack so the snapshots after this one are gone.
    d["_undo_stack"] = stack[:snapshot_index]
    d["_redo_stack"] = []

    audit.update_action(action_id, status="cancelled")
    # Also write a fresh "rollback" event so the activity timeline shows the
    # rollback as an action of its own (not just a state change on the original).
    user = getattr(request.state, "user", None)
    audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id,
        actor="human" if user else "system", source="rollback",
        method="POST", path=str(request.url.path),
        kind="edit",
        prompt=f"Rollback action {action_id}",
        plan={"original_action_id": action_id, "rolled_back_to": snapshot_index},
        status="executed",
    )
    try:
        request.state.audit_handled = True
    except Exception:
        pass

    # Invalidate the find_element index since the doc is now different.
    try:
        from app.backend.agent_find import invalidate_index
        invalidate_index(doc_id)
    except Exception:
        pass

    return {"ok": True, "rolled_back_to": snapshot_index}


# ── Iterative loop ──────────────────────────────────────────────────────────


def _run_iterative(
    prompt: str, *, catalog_json: str, context: dict,
    llm_call, studio, max_steps: int = 8,
) -> Plan:
    """Drive the iterative planner one step at a time. Returns a Plan whose
    ``calls`` carries the full executed history for audit purposes."""
    history: list[dict] = []
    executed_calls: list[ToolCall] = []

    for step in range(max_steps):
        out = planner.plan_iterative_step(
            prompt, catalog_json=catalog_json, context=context,
            history=history, llm_call=llm_call,
        )
        if out.get("done"):
            return Plan(mode="iterative_plan", calls=executed_calls,
                        rationale=out.get("summary"))
        if out.get("clarify"):
            return Plan(mode="iterative_plan", calls=executed_calls,
                        clarify=out["clarify"])
        next_call_d = out.get("next_call")
        if not next_call_d:
            return Plan(mode="iterative_plan", calls=executed_calls,
                        clarify="planner stalled — no next call")

        call = planner._to_tool_call(next_call_d)
        executed_calls.append(call)
        sr = planner.execute_one(call, studio=studio)
        history.append({
            "call": call.to_dict(),
            "result": {"ok": sr.ok, "response": sr.response, "error": sr.error},
        })
        if not sr.ok:
            return Plan(mode="iterative_plan", calls=executed_calls,
                        rationale=f"failed at step {step}: {sr.error}")

    return Plan(mode="iterative_plan", calls=executed_calls,
                rationale=f"max steps ({max_steps}) reached")


# ── Scripted execution ──────────────────────────────────────────────────────


def _execute_scripted(plan: Plan, *, doc_id: str, request: Request) -> ExecutionResult:
    t0 = time.time()
    if plan.script_kind == "live_group":
        # Create the group then run the generator via the regenerate endpoint.
        studio = _studio_client(request, doc_id)
        args = plan.script_args
        slide_n = args.get("slide_n")
        if slide_n is None:
            return ExecutionResult(ok=False, error="live_group_args.slide_n required")
        # Step 1: create the group with the script bound but without auto-run
        # (we'll run it explicitly so we can return logs).
        body = {**args, "generator_script": plan.script, "run_on_create": False}
        try:
            create_resp = studio.create_element(slide_n, "live-group", body)
        except Exception as exc:
            return ExecutionResult(ok=False, error=f"live_group create failed: {exc}",
                                   elapsed_ms=int((time.time() - t0) * 1000))
        eid = create_resp.get("element_id") or create_resp.get("id")
        # Step 2: regenerate (runs script).
        regen_path = f"/api/docs/{doc_id}/slides/{slide_n}/elements/{eid}/regenerate"
        try:
            regen_resp = studio._post(regen_path, {})
        except Exception as exc:
            return ExecutionResult(ok=False, error=f"regenerate failed: {exc}",
                                   elapsed_ms=int((time.time() - t0) * 1000))
        return ExecutionResult(
            ok=bool(regen_resp.get("ok")),
            error=None if regen_resp.get("ok") else regen_resp.get("error"),
            steps=[planner.StepResult(
                call=ToolCall(endpoint_id="live_group.create+regenerate",
                              path_args={"slide_n": slide_n, "element_id": eid}, body={}),
                ok=bool(regen_resp.get("ok")),
                response={"create": create_resp, "regenerate": regen_resp},
            )],
            elapsed_ms=int((time.time() - t0) * 1000),
        )

    if plan.script_kind == "slide_script":
        studio = _studio_client(request, doc_id)
        args = plan.script_args
        slide_n = args.get("slide_n")
        if slide_n is None:
            return ExecutionResult(ok=False, error="slide_script_args.slide_n required")
        body = {"script": plan.script, "inputs": args.get("inputs") or {}}
        path = f"/api/docs/{doc_id}/slides/{slide_n}/script/run"
        try:
            run_resp = studio._post(path, body)
        except Exception as exc:
            return ExecutionResult(ok=False, error=f"slide_script run failed: {exc}",
                                   elapsed_ms=int((time.time() - t0) * 1000))
        return ExecutionResult(
            ok=bool(run_resp.get("ok")),
            error=None if run_resp.get("ok") else run_resp.get("error"),
            steps=[planner.StepResult(
                call=ToolCall(endpoint_id="slide_script.run",
                              path_args={"slide_n": slide_n}, body=body),
                ok=bool(run_resp.get("ok")), response=run_resp,
            )],
            elapsed_ms=int((time.time() - t0) * 1000),
        )

    return ExecutionResult(ok=False, error=f"unknown script_kind: {plan.script_kind}")


# ── Helpers ─────────────────────────────────────────────────────────────────


def _studio_client(request: Request, doc_id: str) -> Studio:
    """Build a Studio HTTP client. Uses in-process ASGI to call ourselves —
    avoids a TCP roundtrip per call and works correctly under TestClient."""
    auth = request.cookies.get("percy_session")
    base = f"{request.url.scheme}://{request.url.netloc}"
    return Studio(
        base_url=base, doc_id=doc_id, auth_token=auth, timeout_s=30,
        asgi_app=request.app,
    )


def _user_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    return user.get("id") if user else None


def _resolve_org_id(request: Request) -> str | None:
    """Best-effort: header > user's primary org."""
    hdr = request.headers.get("X-Percy-Org-Id")
    if hdr:
        return hdr
    user = getattr(request.state, "user", None)
    if not user:
        return None
    try:
        from app.backend import auth_db
        orgs = auth_db.list_user_orgs(user["id"]) or []
        return orgs[0]["id"] if orgs else None
    except Exception:
        return None


def _deck_summary(doc_id: str) -> dict:
    """Compact deck-wide context for the planner."""
    helpers = _main()
    d = helpers["docs"].get(doc_id) or {}
    doc = d.get("doc")
    if not doc:
        return {}
    slides = []
    for s in (doc.slides or [])[:30]:
        types = [getattr(e, "element_type", "?") for e in (s.elements or [])]
        type_counts: dict[str, int] = {}
        for t in types:
            type_counts[t] = type_counts.get(t, 0) + 1
        slides.append({
            "n": s.slide_number,
            "element_count": len(s.elements or []),
            "types": type_counts,
        })
    return {
        "slide_count": len(doc.slides or []),
        "slides_preview": slides,
        "theme_colors": dict(getattr(doc, "theme_colors", {}) or {}),
    }


def _summarize_reply(decision, plan: Plan, exec_result: ExecutionResult) -> str:
    if plan.clarify:
        return plan.clarify
    if exec_result.error:
        return f"I tried but ran into an error: {exec_result.error}"
    n = sum(1 for s in exec_result.steps if s.ok)
    if decision.mode == "scripted_plan":
        if exec_result.ok:
            kind = "live group" if plan.script_kind == "live_group" else "slide script"
            return f"Done. Generated a {kind}."
        return f"Script ran into a problem: {exec_result.error}"
    if decision.mode == "iterative_plan":
        return plan.rationale or f"Done — {n} step{'s' if n != 1 else ''} taken."
    if n == 0:
        return "Nothing to change."
    return plan.rationale or f"Done — {n} change{'s' if n != 1 else ''} applied."


def _step_dict(s) -> dict:
    return {
        "endpoint_id": s.call.endpoint_id,
        "path_args": s.call.path_args,
        "ok": s.ok, "error": s.error,
        "elapsed_ms": s.elapsed_ms,
    }


async def _parse_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def register_chat_router(app) -> None:
    audit.init_db()
    from percy.agent import cost_tracker
    cost_tracker.init_db()
    app.include_router(router)
    log.info("agent_chat: registered /api/agent/chat + /api/agent/actions routes")
