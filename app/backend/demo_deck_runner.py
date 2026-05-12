"""Standalone demo-deck generator.

Takes a Template Set + (optional) canned prompt id and produces a real
``studio_project`` that demonstrates "what the agent makes with this set."

This is a SEPARATE artifact from the template set itself. A set has zero,
one, or many demo decks — they're regular projects with a back-pointer
to the set they came from (``studio_projects.generated_from_set_id``).

Architecture:

  - Pure, side-effect-light module. No router code — just a function.
  - Forces Bedrock Sonnet 4.6 for the generation (the model that
    produces the best layout decisions; quality > cost for demos).
  - Creates a fresh Bridge doc + backing project, then delegates to
    the existing /api/agent/generate-deck flow via the Studio HTTP
    client. The agent picks templates from the set the same way a
    real user's agent invocation would.
  - Returns the project_id + doc_id + a summary suitable for showing
    in the UI.

The standalone callable lives here so:
  - the onboard pipeline can fire-and-forget it after a ref onboard
  - the splash can request a demo on-demand
  - admins can trigger it from a CLI for the marketing demo
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from . import auth_db

log = logging.getLogger("percy.demo_runner")


def _run_blueprint(
    *, demo: Any, doc_id: str, template_set_id: str, studio: Any,
) -> dict[str, Any]:
    """Per-slide, blueprint-driven deck generation.

    Pre-creates exactly N empty slides (one per blueprint entry) on the
    target doc so each per-slide LLM call has a stable slide_n to apply
    against. Then delegates to deck_planner.apply_blueprint which runs
    the planning LLM calls in parallel and applies sequentially.
    """
    from . import main as _backend_main
    from percy.bridge import BridgeSlide
    from percy.agent import deck_planner
    from percy.agent.deck_planner import Blueprint
    from percy.agent import templates as _agent_tpls
    from app.backend.agent_chat import _make_llm_call

    # ── 1. Hydrate available templates from the set ──
    items = auth_db.list_template_set_items(template_set_id)
    available_templates: list[dict[str, Any]] = []
    for it in items:
        t = _agent_tpls.get_template(it["template_id"])
        if t:
            available_templates.append(t)
    if not available_templates:
        return {"ok": False, "error": "template set has no items"}

    # ── 2. Ensure the doc has enough slides ──
    doc = _backend_main._docs.get(doc_id, {}).get("doc")
    blueprint = Blueprint.from_dict(demo.blueprint)
    needed = max((s.slot for s in blueprint.slides), default=1)
    while len(doc.slides) < needed:
        n = (max((s.slide_number for s in doc.slides), default=0) + 1)
        doc.slides.append(BridgeSlide(slide_number=n, elements=[],
                                       width=13.333, height=7.5))

    # ── 3. Make the LLM call helper. Force Opus 4.5 for the demo —
    # the per-slide planner does layout reasoning + content extraction
    # in one shot, and Opus's longer context + sharper structural
    # decisions land more on-spec template picks than Sonnet 4.6 in
    # side-by-side runs. Cost is meaningfully higher but the demo is
    # generated offline + cached, so it's a one-time spend per release.
    # (Opus 4.7 isn't enabled on the percy-dev Bedrock account yet —
    # 4.5 is the latest accessible Opus tier.)
    raw_llm = _make_llm_call("us.anthropic.claude-opus-4-5-20251101-v1:0")

    def safe_llm(system: str, user: str) -> str:
        # Opus tier has tight RPM; the two-phase agent issues ~14 calls
        # for a 7-slide deck in tight bursts and we land on Bedrock's
        # 429 boundary often. Exponential-backoff retry with jitter
        # smooths it without changing the demo flow.
        import time, random
        backoff = 1.5
        last_exc: Exception | None = None
        for attempt in range(5):
            try:
                return raw_llm(system, user)
            except Exception as exc:
                last_exc = exc
                msg = str(exc).lower()
                if "429" not in msg and "too many" not in msg and "throttl" not in msg:
                    raise
                sleep_s = backoff * (1 + random.random())
                log.info("safe_llm: 429 from Bedrock, retrying in %.1fs (attempt %d/5)",
                         sleep_s, attempt + 1)
                time.sleep(sleep_s)
                backoff *= 2
        raise last_exc or RuntimeError("safe_llm exhausted retries")

    # ── 4. Run the blueprint flow ──
    bp_result = deck_planner.apply_blueprint(
        blueprint=blueprint,
        available_templates=available_templates,
        studio=studio,
        llm_call=safe_llm,
        parallel=True,
    )
    return {
        "ok": bp_result.ok,
        "applied": bp_result.applied,
        "errors": bp_result.errors,
        "plans": [p.to_dict() for p in bp_result.plans],
    }


def run_demo(
    *,
    template_set_id: str,
    prompt_id: str | None = None,
    force: bool = False,
    throttle_seconds: int = 300,
    asgi_app: Any = None,
    auth_token: str | None = None,
) -> dict[str, Any]:
    """Generate a demo deck against a template set.

    Args:
      template_set_id: which set the agent should use as its template
                        catalog + brand context.
      prompt_id:        which canned prompt from `demo_prompts.DEMO_PROMPTS`.
                        None ⇒ default (10-slide quarterly update).
      force:            bypass the throttle (default 5 min between demos
                        for the same set).
      throttle_seconds: cool-down between demos per set.
      asgi_app:         FastAPI app handle for in-process Studio calls.
                        Required.
      auth_token:       session cookie if the caller has one; otherwise
                        the in-process call relies on the public-dev
                        bypass or the app's own auth handling.

    Returns:
      {
        "ok": bool,
        "project_id": str,        # the new studio_project — open via /studio/:id
        "doc_id": str,
        "set_id": str,
        "prompt_id": str,
        "slides_applied": int,
        "errors": list[str],
        "throttled": bool,        # true if we returned a previous result
      }
    """
    tpl = auth_db.get_template(template_set_id)
    if not tpl:
        return {"ok": False, "error": f"template set {template_set_id!r} not found"}

    # Throttle — if a demo was generated for this set very recently and the
    # caller didn't pass force=True, return the cached result.
    if not force:
        last_at = int(tpl.get("last_demo_at") or 0)
        if last_at and (time.time() - last_at) < throttle_seconds:
            log.info("run_demo: throttled (%ds since last)",
                     int(time.time() - last_at))
            return {
                "ok": True, "throttled": True,
                "project_id": tpl.get("last_demo_project_id"),
                "doc_id": tpl.get("last_demo_doc_id"),
                "set_id": template_set_id,
                "summary": tpl.get("last_demo_summary") or {},
            }

    # Resolve prompt
    from percy.agent.demo_prompts import get_demo_prompt
    try:
        demo = get_demo_prompt(prompt_id)
    except KeyError as exc:
        return {"ok": False, "error": str(exc)}

    # Clean up any previous demo project for this set so the user doesn't
    # accumulate ghost projects every time we re-run.
    old_project_id = tpl.get("last_demo_project_id")
    if old_project_id:
        try:
            auth_db.delete_project(old_project_id)
            log.info("run_demo: removed prior demo project %s", old_project_id)
        except Exception as exc:
            log.warning("run_demo: could not delete prior project %s: %s",
                        old_project_id, exc)

    # Create a fresh Bridge document
    from . import main as _backend_main
    from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
    new_doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors={},
    )
    doc_id = str(uuid.uuid4())[:8]
    _backend_main._docs[doc_id] = {
        "doc": new_doc,
        "name": f"Demo · {tpl['name']}",
        "_undo_stack": [],
        "bridge_dir": None,
    }

    # Create the backing project so /studio/:project_id works for any user
    # who lands on the page.
    from datetime import datetime as _dt
    project_name = f"Demo · {tpl['name']} · {_dt.utcnow().strftime('%b %d')}"
    project = auth_db.create_project(
        tpl["org_id"], project_name,
        folder_id=None, doc_source=None,
        created_by=tpl.get("owner_id") or "__system__",
    )
    auth_db.update_project(project["id"], doc_id=doc_id)
    log.info("run_demo: starting set=%s prompt=%s doc=%s project=%s",
             template_set_id, demo.id, doc_id, project["id"])

    # Drive deck generation in-process. Two paths:
    #   * BLUEPRINT path (preferred — used when the canned demo has a
    #     `blueprint` dict): per-slide LLM calls via deck_planner. Each
    #     call sees only that slide's instruction + the set's templates,
    #     so layout selection is focused and there's no clustering bug.
    #   * Legacy free-form prompt path: generate-deck endpoint plans the
    #     whole deck in one LLM call (older, more error-prone).
    from percy.agent.script_api import Studio
    studio = Studio(
        base_url="http://internal",
        doc_id=doc_id,
        auth_token=auth_token,
        timeout_s=300,
        asgi_app=asgi_app,
    )
    t0 = time.time()

    if getattr(demo, "blueprint", None):
        # ── Blueprint flow ──
        result = _run_blueprint(
            demo=demo, doc_id=doc_id,
            template_set_id=template_set_id, studio=studio,
        )
    else:
        # ── Legacy free-form prompt flow ──
        payload = {
            "prompt": demo.prompt,
            "doc_id": doc_id,
            "start_slide": 1,
            "template_set_id": template_set_id,
            "model": "us.anthropic.claude-sonnet-4-6",
        }
        try:
            result = studio._post("/api/agent/generate-deck", payload)
        except Exception as exc:
            log.exception("run_demo: generate-deck call failed")
            try: auth_db.delete_project(project["id"])
            except Exception: pass
            return {"ok": False, "error": f"generate-deck failed: {exc}",
                    "set_id": template_set_id, "prompt_id": demo.id}
    elapsed = time.time() - t0

    summary = {
        "demo_id": demo.id,
        "demo_name": demo.name,
        "slides_applied": len(result.get("applied") or []),
        "errors": (result.get("errors") or [])[:5],
        "ok": bool(result.get("ok", True)),
        "elapsed_seconds": round(elapsed, 1),
    }

    # ── Persist the slide JSON so the showcase survives restarts ──
    # The in-memory _docs cache is lost when the server recycles, but the
    # demo deck needs to keep working. Walk the doc's slides + serialize
    # each one's elements to the same shape the svg-data endpoint emits.
    # Stored in studio_templates.demo_slides_json.
    persisted_slides: list[dict[str, Any]] = []
    try:
        from .template_sets_api import _serialize_element_for_svg
        doc = _backend_main._docs.get(doc_id, {}).get("doc")
        if doc:
            theme = getattr(doc, "theme_colors", None) or {}
            for slide in (doc.slides or []):
                if not (slide.elements or []):
                    continue
                persisted_slides.append({
                    "slide_n": getattr(slide, "slide_number", None),
                    "width_in": getattr(slide, "width", 13.333),
                    "height_in": getattr(slide, "height", 7.5),
                    "elements": [
                        _serialize_element_for_svg(el, theme)
                        for el in (slide.elements or [])
                    ],
                })
        log.info("run_demo: persisted %d slides to demo_slides_json",
                 len(persisted_slides))
    except Exception as exc:
        log.warning("run_demo: could not persist slides: %s", exc)

    auth_db.update_template(
        template_set_id,
        last_demo_doc_id=doc_id,
        last_demo_project_id=project["id"],
        last_demo_at=int(time.time()),
        last_demo_summary=summary,
        demo_slides_json=persisted_slides,
    )
    log.info("run_demo: done set=%s slides_applied=%d in %.1fs",
             template_set_id, summary["slides_applied"], elapsed)
    return {
        "ok": True,
        "throttled": False,
        "project_id": project["id"],
        "doc_id": doc_id,
        "set_id": template_set_id,
        "prompt_id": demo.id,
        "summary": summary,
        "slides_persisted": len(persisted_slides),
    }
