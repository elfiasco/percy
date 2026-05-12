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

    # Drive generate-deck via Studio in-process, forcing Bedrock Sonnet 4.6.
    # We pass `model` in the body so the planner uses our chosen Sonnet
    # rather than whatever PERCY_LLM_PROVIDER is set to.
    from percy.agent.script_api import Studio
    studio = Studio(
        base_url="http://internal",
        doc_id=doc_id,
        auth_token=auth_token,
        timeout_s=300,
        asgi_app=asgi_app,
    )
    payload = {
        "prompt": demo.prompt,
        "doc_id": doc_id,
        "start_slide": 1,
        "template_set_id": template_set_id,
        "model": "us.anthropic.claude-sonnet-4-6",
    }
    t0 = time.time()
    try:
        result = studio._post("/api/agent/generate-deck", payload)
    except Exception as exc:
        log.exception("run_demo: generate-deck call failed")
        # Don't leave a half-baked project lying around.
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
    auth_db.update_template(
        template_set_id,
        last_demo_doc_id=doc_id,
        last_demo_project_id=project["id"],
        last_demo_at=int(time.time()),
        last_demo_summary=summary,
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
    }
