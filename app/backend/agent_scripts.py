"""Live group + slide-level script endpoints.

Sits on top of:
  * ``percy.bridge.builders.build_live_group`` — produces the empty BridgeGroup
  * ``percy.agent.sandbox.run_live_group_generator`` / ``run_slide_script``
  * ``percy.agent.script_api`` — what scripts see at runtime
  * The existing ``element_creation`` builders for materializing children

Endpoints:
  POST  /api/docs/{doc_id}/slides/{n}/elements/live-group
  POST  /api/docs/{doc_id}/slides/{n}/elements/{element_id}/regenerate
  GET   /api/docs/{doc_id}/slides/{n}/script
  PUT   /api/docs/{doc_id}/slides/{n}/script
  POST  /api/docs/{doc_id}/slides/{n}/script/run
  POST  /api/docs/{doc_id}/slides/{n}/elements/{element_id}/lock-flag
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent import sandbox
from percy.agent.sandbox import ScopeManifest
from percy.bridge import builders
from percy.bridge.builders import BuilderError

log = logging.getLogger(__name__)
router = APIRouter()


# ── lazy main.py helpers ────────────────────────────────────────────────────


def _main():
    fn = _main
    cache = getattr(fn, "_cache", None)
    if cache is None:
        from app.backend import main as _m
        cache = {
            "docs": _m._docs, "require": _m._require,
            "snapshot": _m._snapshot_doc, "find_element": _m._find_element,
            "serialize": _m._serialize_element, "get_slide_dims": _m._get_slide_dims,
        }
        fn._cache = cache  # type: ignore[attr-defined]
    return cache


def _resolve_slide(doc_id: str, n: int):
    helpers = _main()
    d = helpers["require"](doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")
    return doc, slide


# ── Live group create ───────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/slides/{n}/elements/live-group")
async def create_live_group(doc_id: str, n: int, request: Request):
    """Create a live group (BridgeGroup with optional generator script).

    Body:
      {position: {...}, name?, generator_script?, generator_inputs?,
       scope?: {timeout_s?, network?, allow_imports?, secret_keys?},
       run_on_create?: bool}      # default true if generator_script provided
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)

    doc, slide = _resolve_slide(doc_id, n)
    theme = getattr(doc, "theme_colors", None) or None
    warnings: list[str] = []

    try:
        group = builders.build_live_group(body, theme, slide=slide, warnings=warnings)
    except BuilderError as exc:
        raise HTTPException(400, {"code": exc.code, "field": exc.field, "message": str(exc)})

    slide.elements.append(group)
    log.info("live_group: created group %s on slide %d of %s", group.identification.shape_id, n, doc_id)

    response: dict[str, Any] = {
        "element_id": str(group.identification.shape_id),
        "type": "BridgeGroup",
        "slide_n": n,
        "name": group.identification.shape_name,
        "warnings": warnings,
        "child_count": 0,
    }

    # Optionally run the generator immediately.
    run_on_create = body.get("run_on_create")
    if run_on_create is None:
        run_on_create = bool(group.generator_script)

    if run_on_create and group.generator_script:
        scope = ScopeManifest.from_dict(body.get("scope"))
        regen_result = _run_generator(doc_id, n, group, scope,
                                      auth_token=_extract_auth(request),
                                      base_url=_self_base_url(request),
                                      user_id=_user_id(request), org_id=_org_id(request))
        response.update({
            "generator": {
                "ok": regen_result["ok"],
                "child_count": regen_result.get("child_count", 0),
                "logs": regen_result.get("logs"),
                "error": regen_result.get("error"),
                "elapsed_s": regen_result.get("elapsed_s"),
            }
        })

    _invalidate_index(doc_id)
    return response


# ── Regenerate ──────────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/regenerate")
async def regenerate_live_group(doc_id: str, n: int, element_id: str, request: Request):
    """Re-run a live group's generator script. Honors per-child user_locked flags.

    Body (all optional):
      {generator_inputs?, scope?, replace_unlocked?: bool}
        replace_unlocked: default true; if false, just append new children alongside existing.
    """
    from percy.agent import audit as _audit
    try:
        request.state.audit_handled = True
    except Exception:
        pass
    import time as _time
    t0 = _time.time()

    body = await _parse_json(request, allow_empty=True)
    helpers = _main()
    helpers["snapshot"](doc_id)
    snapshot_index = len((helpers["docs"].get(doc_id) or {}).get("_undo_stack") or []) - 1
    doc, slide = _resolve_slide(doc_id, n)

    group = _find_group(slide, element_id)
    if group is None:
        raise HTTPException(404, f"BridgeGroup {element_id} not found on slide {n}")
    if not group.generator_script:
        raise HTTPException(400, "group has no generator_script")

    if "generator_inputs" in body:
        group.generator_inputs = dict(body["generator_inputs"] or {})

    scope = ScopeManifest.from_dict(body.get("scope"))
    replace_unlocked = bool(body.get("replace_unlocked", True))

    result = _run_generator(
        doc_id, n, group, scope,
        auth_token=_extract_auth(request),
        base_url=_self_base_url(request),
        replace_unlocked=replace_unlocked,
        user_id=_user_id(request), org_id=_org_id(request),
    )
    _invalidate_index(doc_id)

    user = getattr(request.state, "user", None)
    actor = "agent" if request.headers.get("X-Percy-Actor", "").lower() == "agent" else ("human" if user else "system")
    _audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id, slide_n=n, element_id=element_id,
        actor=actor, source="live_group_regen",
        method="POST", path=str(request.url.path),
        kind="regenerate",
        prompt=f"Regenerate live group {element_id} (slide {n})",
        plan={"replace_unlocked": replace_unlocked, "inputs": group.generator_inputs},
        response=result,
        status="executed" if result.get("ok") else "failed",
        error=result.get("error"),
        snapshot_index=snapshot_index,
        affected_count=result.get("child_count", 0),
        elapsed_ms=int((_time.time() - t0) * 1000),
    )

    return result


# ── Slide-level scripts ─────────────────────────────────────────────────────


@router.get("/api/docs/{doc_id}/slides/{n}/script")
async def get_slide_script(doc_id: str, n: int):
    _, slide = _resolve_slide(doc_id, n)
    return {
        "script":     getattr(slide, "script", None) or "",
        "inputs":     dict(getattr(slide, "script_inputs", None) or {}),
        "provenance": dict(getattr(slide, "script_provenance", None) or {}),
    }


@router.put("/api/docs/{doc_id}/slides/{n}/script")
async def set_slide_script(doc_id: str, n: int, request: Request):
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    _, slide = _resolve_slide(doc_id, n)
    if "script" in body:
        slide.script = body["script"] or None
    if "inputs" in body:
        slide.script_inputs = dict(body["inputs"] or {})
    return {"ok": True}


@router.post("/api/docs/{doc_id}/slides/{n}/script/run")
async def run_slide_script(doc_id: str, n: int, request: Request):
    """Execute the slide's script in the sandbox.

    Body (all optional): {script?, inputs?, scope?}
      If `script` is provided in the body it overrides the saved one for this run only.
      If `inputs` is provided, it overrides the saved ones for this run only.
    """
    from percy.agent import audit as _audit
    try:
        request.state.audit_handled = True
    except Exception:
        pass

    body = await _parse_json(request, allow_empty=True)
    helpers = _main()
    helpers["snapshot"](doc_id)
    snapshot_index = len((helpers["docs"].get(doc_id) or {}).get("_undo_stack") or []) - 1
    _, slide = _resolve_slide(doc_id, n)

    source = body.get("script", getattr(slide, "script", None))
    if not source:
        raise HTTPException(400, "no slide script set; PUT one first or pass `script` in the body")

    inputs = body.get("inputs", dict(getattr(slide, "script_inputs", None) or {}))
    scope = ScopeManifest.from_dict(body.get("scope"))

    base_url = _self_base_url(request)
    auth = _extract_auth(request)
    user = getattr(request.state, "user", None)
    actor = "agent" if request.headers.get("X-Percy-Actor", "").lower() == "agent" else ("human" if user else "system")

    result = sandbox.run_slide_script(
        source=source, slide_n=n, inputs=inputs,
        base_url=base_url, doc_id=doc_id, auth_token=auth,
        scope=scope, secrets=_collect_secrets(scope, user_id=_user_id(request), org_id=_org_id(request)),
    )

    if result.ok:
        slide.script_provenance = {
            "last_run_at": time.time(),
            "last_run_inputs_hash": result.inputs_hash,
            "elapsed_s": result.elapsed_s,
            "ops_count": len(result.ops),
        }

    _audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id, slide_n=n,
        actor=actor, source="script_run",
        method="POST", path=str(request.url.path),
        kind="code",
        prompt=f"Run slide script (slide {n}, {len(source)} chars, inputs={list(inputs.keys())})",
        plan={"script_chars": len(source), "inputs": inputs, "scope": scope.to_dict()},
        response={"ok": result.ok, "ops_count": len(result.ops), "elapsed_s": result.elapsed_s},
        status="executed" if result.ok else "failed",
        error=result.error,
        snapshot_index=snapshot_index,
        affected_count=len(result.ops),
        elapsed_ms=int((result.elapsed_s or 0) * 1000),
    )

    _invalidate_index(doc_id)
    return result.to_dict()


# ── Per-child user_locked flag ──────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/lock-flag")
async def set_lock_flag(doc_id: str, n: int, element_id: str, request: Request):
    """Toggle ``custom_properties['user_locked']`` on an element.

    Used by the studio when the user wants a live-group child to survive
    regeneration (option C). Body: {locked: bool}
    """
    body = await _parse_json(request)
    helpers = _main()
    helpers["snapshot"](doc_id)
    _, slide = _resolve_slide(doc_id, n)

    el = _find_any_element(slide, element_id)
    if el is None:
        raise HTTPException(404, f"element {element_id} not found")
    cp = getattr(el, "custom_properties", None)
    if cp is None:
        el.custom_properties = {}
        cp = el.custom_properties
    cp["user_locked"] = bool(body.get("locked", True))
    return {"ok": True, "user_locked": cp["user_locked"]}


# ── Internal: generator runner ──────────────────────────────────────────────


def _run_generator(
    doc_id: str, slide_n: int, group: Any, scope: ScopeManifest, *,
    base_url: str, auth_token: str | None, replace_unlocked: bool = True,
    user_id: str | None = None, org_id: str | None = None,
) -> dict:
    """Run the generator, materialize children, update group state, return result."""
    from percy.bridge.elements import BridgeElement  # noqa
    helpers = _main()

    pos_dict = {
        "left_in":   group.position.left, "top_in":    group.position.top,
        "width_in":  group.position.width, "height_in": group.position.height,
    }
    existing = _serialize_existing_children(group)

    sb_result = sandbox.run_live_group_generator(
        source=group.generator_script,
        slide_n=slide_n,
        position=pos_dict,
        inputs=group.generator_inputs,
        existing_children=existing,
        base_url=base_url,
        doc_id=doc_id,
        auth_token=auth_token,
        scope=scope,
        secrets=_collect_secrets(scope, user_id=user_id, org_id=org_id),
    )

    if not sb_result.ok:
        group.generator_provenance = {
            **dict(group.generator_provenance or {}),
            "last_run_at": time.time(),
            "last_run_error": sb_result.error,
            "last_run_logs": sb_result.logs,
            "last_run_inputs_hash": sb_result.inputs_hash,
        }
        return {"ok": False, "error": sb_result.error, "logs": sb_result.logs,
                "stderr": sb_result.stderr, "child_count": len(group.children),
                "elapsed_s": sb_result.elapsed_s}

    children_specs = (sb_result.result or {}).get("children_spec") or []

    # Option C: locked children survive; unlocked are replaced.
    if replace_unlocked:
        kept = [c for c in (group.children or [])
                if (getattr(c, "custom_properties", None) or {}).get("user_locked")]
    else:
        kept = list(group.children or [])

    new_children = _materialize_children(group, children_specs, slide_n=slide_n,
                                          theme=getattr(_main()["docs"][doc_id]["doc"], "theme_colors", None))
    group.children = kept + new_children
    group.generator_provenance = {
        **dict(group.generator_provenance or {}),
        "last_run_at": time.time(),
        "last_run_inputs_hash": sb_result.inputs_hash,
        "child_count": len(group.children),
        "kept_locked_count": len(kept),
        "newly_generated_count": len(new_children),
        "elapsed_s": sb_result.elapsed_s,
    }

    # Recompute group bbox from final children (children are in slide-space here
    # since the generator script writes positions in absolute slide coordinates).
    if group.children:
        _recompute_group_bbox(group)

    return {
        "ok": True,
        "child_count": len(group.children),
        "kept_locked_count": len(kept),
        "newly_generated_count": len(new_children),
        "logs": sb_result.logs,
        "elapsed_s": sb_result.elapsed_s,
        "ops_count": len(sb_result.ops),
    }


def _materialize_children(group: Any, specs: list[dict], *, slide_n: int,
                           theme: dict[str, str] | None) -> list[Any]:
    """Turn generator-emitted child specs into Bridge dataclasses via builders.

    The group itself acts as the slide-like container for shape_id assignment.
    Children's positions are absolute slide coordinates; the live-group
    coordinate convention is "describe in slide-space, the group is just a
    bbox over them."
    """
    out: list[Any] = []

    # Use a tiny shim object that satisfies build_*'s slide.elements requirement.
    class _Container:
        def __init__(self, group):
            self.elements = list(group.children or [])

    shim = _Container(group)

    for spec in specs:
        kind = spec.get("kind", "shape")
        body = dict(spec.get("body") or {})
        try:
            if kind == "shape":
                el = builders.build_shape(body, theme, slide=shim)
            elif kind == "text":
                el = builders.build_text(body, theme, slide=shim)
            elif kind == "chart":
                el = builders.build_chart(body, theme, slide=shim)
            elif kind == "table":
                el = builders.build_table(body, theme, slide=shim)
            elif kind == "connector":
                el = builders.build_connector(body, theme, slide=shim, lookup_element=None)
            elif kind == "freeform":
                el = builders.build_freeform(body, theme, slide=shim)
            else:
                log.warning("live_group: unknown child kind %r — skipped", kind)
                continue
        except BuilderError as exc:
            log.warning("live_group: child build failed (%s) — skipped: %s", spec, exc)
            continue
        # Stamp user_locked from the spec.
        if spec.get("locked"):
            cp = getattr(el, "custom_properties", None) or {}
            cp["user_locked"] = True
            el.custom_properties = cp
        shim.elements.append(el)
        out.append(el)
    return out


def _recompute_group_bbox(group: Any) -> None:
    """Compute the group bounding box as the union of children's positions."""
    if not group.children:
        return
    positions = [c.position for c in group.children if getattr(c, "position", None)]
    if not positions:
        return
    lefts = [p.left for p in positions]
    tops = [p.top for p in positions]
    rights = [p.left + p.width for p in positions]
    bottoms = [p.top + p.height for p in positions]
    group.position.left = min(lefts)
    group.position.top = min(tops)
    group.position.width = max(rights) - group.position.left
    group.position.height = max(bottoms) - group.position.top


# ── Lookups ─────────────────────────────────────────────────────────────────


def _find_group(slide: Any, element_id: str) -> Any:
    for el in slide.elements:
        ident = getattr(el, "identification", None)
        sid = str(getattr(ident, "shape_id", "") or "")
        if sid == element_id and el.element_type == "BridgeGroup":
            return el
    return None


def _find_any_element(slide: Any, element_id: str) -> Any:
    for el in slide.elements:
        ident = getattr(el, "identification", None)
        sid = str(getattr(ident, "shape_id", "") or "")
        if sid == element_id:
            return el
        # Also search inside groups.
        if el.element_type == "BridgeGroup":
            for c in (el.children or []):
                cid = str(getattr(getattr(c, "identification", None), "shape_id", "") or "")
                if cid == element_id:
                    return c
    return None


def _serialize_existing_children(group: Any) -> list[dict]:
    """Compact dumps of existing children for the script to inspect (locked etc)."""
    out: list[dict] = []
    for c in (group.children or []):
        cp = getattr(c, "custom_properties", None) or {}
        ident = getattr(c, "identification", None)
        out.append({
            "element_id":  str(getattr(ident, "shape_id", "") or ""),
            "type":        c.element_type,
            "name":        getattr(ident, "shape_name", None),
            "user_locked": bool(cp.get("user_locked", False)),
            "position": {
                "left_in": c.position.left, "top_in": c.position.top,
                "width_in": c.position.width, "height_in": c.position.height,
            },
        })
    return out


def _user_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    return user.get("id") if user else None


def _org_id(request: Request) -> str | None:
    """Best-effort: pick the user's primary org. Frontend may also pass X-Percy-Org-Id."""
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


def _collect_secrets(scope: ScopeManifest, *, user_id: str | None = None,
                     org_id: str | None = None) -> dict[str, str]:
    """Resolve scope.secret_keys against user + org secret stores.

    User-scope secrets override org-scope. ``ENV_*`` keys fall through to the
    process environment for dev convenience.
    """
    if not scope.secret_keys:
        return {}
    try:
        from percy.agent import secrets_store
        return secrets_store.resolve_for_user(user_id, org_id, scope.secret_keys)
    except Exception as exc:
        log.warning("agent_scripts: secret resolution failed: %s", exc)
        # Best-effort env-only fallback
        import os as _os
        return {k: _os.environ[k] for k in scope.secret_keys if k in _os.environ}


def _self_base_url(request: Request) -> str:
    """The URL the script should call back to. Same host as this request."""
    return f"{request.url.scheme}://{request.url.netloc}"


def _extract_auth(request: Request) -> str | None:
    return request.cookies.get("percy_session")


def _invalidate_index(doc_id: str) -> None:
    """Tell the find_element index this doc has changed."""
    try:
        from app.backend.agent_find import invalidate_index
        invalidate_index(doc_id)
    except Exception:
        pass


async def _parse_json(request: Request, allow_empty: bool = False) -> dict:
    try:
        body = await request.body()
        if not body and allow_empty:
            return {}
        import json as _json
        parsed = _json.loads(body)
    except Exception as exc:
        if allow_empty:
            return {}
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(parsed, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return parsed


def register_scripts_router(app) -> None:
    app.include_router(router)
    log.info("agent_scripts: registered live-group + slide-script routes")
