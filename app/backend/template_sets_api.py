"""Template Sets — the org-level brand-and-pattern bundles that drive the agent.

A Template Set bundles together everything the AI needs to operate "in the
voice" of a team or organization:

  * **Slide templates** — full-slide layouts the agent can apply when
    generating a new deck or filling a placeholder.
  * **Element templates** — single reusable BridgeElement recipes
    (a styled KPI tile, a branded callout, a standard chart).
  * **Brand** — curated palette, fonts, style rules. Drives both the agent's
    output preferences and the existing ``/brand-check`` validator.
  * **Instructions** — markdown voice/structure guide fed verbatim to the LLM.
  * **Reference docs** — uploaded PPTX/PDF examples the agent mines patterns
    from. Distinct from "source projects" (a separate org-level analytics
    feature in ``workspace_api``).

Sets live at the org level by default. Teams (folders in our model) can pin
their own override; sub-teams inherit unless they pin their own. Projects do
NOT carry their own set — they inherit from the nearest folder ancestor and
ultimately the org default. The resolution walk is implemented in
``auth_db.resolve_active_template_set``.

This module owns the *new* endpoints. Legacy ``/api/orgs/.../templates`` and
``/api/templates/.../extract`` remain in ``workspace_api`` for backwards
compatibility; both surfaces operate on the same underlying ``studio_templates``
rows so a set created either way is interchangeable.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from . import auth, auth_db

log = logging.getLogger("percy.template_sets")
router = APIRouter(tags=["template-sets"])


# ── Storage layout ───────────────────────────────────────────────────────────
# Reference docs land under data/template_set_refs/<set_id>/<ref_id>.<ext>.
# Kept off S3 for now; the storage_key column is opaque so swapping later is
# a one-helper change.

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_REFS_ROOT = _DATA_DIR / "template_set_refs"


def _ref_path(set_id: str, ref_id: str, ext: str) -> Path:
    safe_ext = "".join(c for c in (ext or "") if c.isalnum() or c == ".")
    if not safe_ext.startswith("."):
        safe_ext = f".{safe_ext}" if safe_ext else ""
    return _REFS_ROOT / set_id / f"{ref_id}{safe_ext}"


# ── Authorization helpers ────────────────────────────────────────────────────


def _require_set_member(user: dict[str, Any], set_id: str) -> dict[str, Any]:
    """Caller must be a member of the set's org. Returns the decoded set row."""
    tpl = auth_db.get_template(set_id)
    if not tpl:
        raise HTTPException(404, "Template set not found")
    if not auth_db.get_membership(user["id"], tpl["org_id"]):
        raise HTTPException(403, "Not a member of this template set's org")
    return tpl


def _require_set_editor(user: dict[str, Any], set_id: str) -> dict[str, Any]:
    """Caller must be either the set owner or an org owner/admin."""
    tpl = _require_set_member(user, set_id)
    if tpl["owner_id"] == user["id"]:
        return tpl
    m = auth_db.get_membership(user["id"], tpl["org_id"])
    if m and m.get("role") in ("owner", "admin"):
        return tpl
    raise HTTPException(403, "Insufficient permissions to edit this template set")


# ── Set CRUD (new richer surface; old endpoints in workspace_api keep working) ──


class CreateSetRequest(BaseModel):
    org_id: str
    name: str
    description: str | None = None
    scope: str = "org"                       # 'user' | 'team' | 'org'
    folder_id: str | None = None             # team override; None = org-wide
    is_default: bool = False
    instructions_md: str | None = None
    palette: list[dict[str, Any]] | None = None
    fonts: list[dict[str, Any]] | None = None
    style_rules: dict[str, Any] | None = None


@router.post("/api/template-sets")
def create_set(request: Request, req: CreateSetRequest):
    user = auth.require_user(request)
    org = auth_db.get_org(req.org_id)
    if not org or not auth_db.get_membership(user["id"], req.org_id):
        raise HTTPException(403, "Not a member of this org")
    if req.scope not in ("user", "team", "org"):
        raise HTTPException(400, "scope must be 'user', 'team', or 'org'")
    if req.folder_id:
        folder = auth_db.get_folder(req.folder_id)
        if not folder or folder["org_id"] != req.org_id:
            raise HTTPException(400, "folder does not belong to this org")
    if req.is_default and org["kind"] == "personal" and req.scope != "user":
        raise HTTPException(400, "Personal workspaces only support user-scope template sets")

    tpl = auth_db.create_template(
        req.org_id,
        scope=req.scope,
        owner_id=user["id"],
        name=req.name,
        description=req.description,
        folder_id=req.folder_id,
        is_default=req.is_default,
    )
    # Apply optional initial brand fields in a single follow-up update so we
    # don't need to thread every kwarg through create_template.
    update_fields: dict[str, Any] = {}
    if req.instructions_md is not None: update_fields["instructions_md"] = req.instructions_md
    if req.palette is not None:         update_fields["palette"] = req.palette
    if req.fonts is not None:           update_fields["fonts"] = req.fonts
    if req.style_rules is not None:     update_fields["style_rules"] = req.style_rules
    if update_fields:
        tpl = auth_db.update_template(tpl["id"], **update_fields)
    return tpl


class UpdateSetRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    instructions_md: str | None = None
    palette: list[dict[str, Any]] | None = None
    fonts: list[dict[str, Any]] | None = None
    style_rules: dict[str, Any] | None = None


@router.patch("/api/template-sets/{set_id}")
def update_set(request: Request, set_id: str, req: UpdateSetRequest):
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    fields: dict[str, Any] = {}
    for k in ("name", "description", "instructions_md", "palette", "fonts", "style_rules"):
        v = getattr(req, k)
        if v is not None:
            fields[k] = v
    if not fields:
        return auth_db.get_template(set_id)
    return auth_db.update_template(set_id, **fields)


@router.get("/api/template-sets/{set_id}")
def get_set(request: Request, set_id: str):
    user = auth.require_user(request)
    tpl = _require_set_member(user, set_id)
    # Include items + refs counts and lite previews so the index page can
    # render cards without a fan-out call per set.
    items = auth_db.list_template_set_items(set_id)
    refs = auth_db.list_template_set_refs(set_id)
    tpl["items_count"] = len(items)
    tpl["slide_items_count"] = sum(1 for i in items if i["kind"] == "slide")
    tpl["element_items_count"] = sum(1 for i in items if i["kind"] == "element")
    tpl["refs_count"] = len(refs)
    return tpl


@router.delete("/api/template-sets/{set_id}")
def delete_set(request: Request, set_id: str):
    user = auth.require_user(request)
    tpl = _require_set_editor(user, set_id)
    # Best-effort cleanup of on-disk ref blobs. DB cascade handled by auth_db.delete_template.
    refs_dir = _REFS_ROOT / set_id
    if refs_dir.exists():
        try:
            shutil.rmtree(refs_dir)
        except Exception as exc:
            log.warning("delete_set: could not remove refs dir %s: %s", refs_dir, exc)
    auth_db.delete_template(set_id)
    return {"ok": True, "id": set_id}


# ── Defaults / inheritance ──────────────────────────────────────────────────


class SetDefaultRequest(BaseModel):
    folder_id: str | None = None   # None = org-wide default


@router.post("/api/template-sets/{set_id}/set-default")
def set_set_as_default(request: Request, set_id: str, req: SetDefaultRequest):
    """Promote this set to the active default for an org or folder.

    No folder_id ⇒ org default. With folder_id ⇒ team override. Demotes any
    previously-default set in the same scope.
    """
    user = auth.require_user(request)
    tpl = _require_set_editor(user, set_id)
    if req.folder_id:
        folder = auth_db.get_folder(req.folder_id)
        if not folder or folder["org_id"] != tpl["org_id"]:
            raise HTTPException(400, "folder does not belong to this set's org")
        # The set itself is org-wide; pinning to a folder is metadata on the
        # folder side, not a move of the set. We still update folder_id on the
        # set when the caller wants the set to be exclusively team-scoped.
        auth_db.update_template(set_id, folder_id=req.folder_id)
    return auth_db.set_default_template_set(set_id, org_id=tpl["org_id"], folder_id=req.folder_id)


@router.post("/api/orgs/{org_id}/clear-default-template-set")
def clear_org_default(request: Request, org_id: str):
    user = auth.require_user(request)
    org = auth_db.get_org(org_id)
    if not org or not auth_db.get_membership(user["id"], org_id):
        raise HTTPException(403, "Not a member of this org")
    m = auth_db.get_membership(user["id"], org_id)
    if not m or m.get("role") not in ("owner", "admin"):
        raise HTTPException(403, "Only org owners or admins can clear the default")
    auth_db.clear_default_template_set(org_id=org_id)
    return {"ok": True}


@router.post("/api/folders/{folder_id}/clear-template-set")
def clear_folder_override(request: Request, folder_id: str):
    user = auth.require_user(request)
    folder = auth_db.get_folder(folder_id)
    if not folder:
        raise HTTPException(404, "Folder not found")
    if not auth_db.get_membership(user["id"], folder["org_id"]):
        raise HTTPException(403, "Not a member of this org")
    auth_db.clear_default_template_set(folder_id=folder_id)
    return {"ok": True}


@router.get("/api/projects/{project_id}/active-template-set")
def get_active_set_for_project(request: Request, project_id: str):
    """Resolve the template set active for a project via the folder-chain walk.

    Returns the full decoded set including palette/fonts/instructions, plus
    `inherited_from`: 'project_folder' | 'parent_folder:<id>' | 'org_default' |
    'none' so the UI can show the user where the active set came from.
    """
    user = auth.require_user(request)
    project = auth_db.get_project(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not auth_db.get_membership(user["id"], project["org_id"]):
        raise HTTPException(403, "Not a member of this project's org")

    tpl = auth_db.resolve_active_template_set(project_id=project_id)
    if not tpl:
        return {"set": None, "inherited_from": "none", "org_id": project["org_id"]}

    inherited_from = "org_default"
    if tpl["folder_id"]:
        if tpl["folder_id"] == project.get("folder_id"):
            inherited_from = "project_folder"
        else:
            inherited_from = f"parent_folder:{tpl['folder_id']}"
    return {"set": tpl, "inherited_from": inherited_from, "org_id": project["org_id"]}


# ── Listing (org + folder filters) ──────────────────────────────────────────


@router.get("/api/orgs/{org_id}/template-sets")
def list_org_sets(request: Request, org_id: str):
    user = auth.require_user(request)
    if not auth_db.get_membership(user["id"], org_id):
        raise HTTPException(403, "Not a member of this org")
    sets = auth_db.list_org_templates(org_id, viewer_id=user["id"])
    # Decorate with lightweight item/ref counts so the index page doesn't
    # need to make one extra call per set. SQLite is local; this is cheap.
    for s in sets:
        items = auth_db.list_template_set_items(s["id"])
        s["items_count"] = len(items)
        s["slide_items_count"] = sum(1 for i in items if i["kind"] == "slide")
        s["element_items_count"] = sum(1 for i in items if i["kind"] == "element")
        s["refs_count"] = len(auth_db.list_template_set_refs(s["id"]))
    return {"template_sets": sets}


# ── Items (slide + element templates in the set) ────────────────────────────


class AddItemRequest(BaseModel):
    template_id: str
    kind: str                                # 'slide' | 'element'
    order_index: int = 0
    provenance: dict[str, Any] | None = None


@router.get("/api/template-sets/{set_id}/items")
def list_set_items(request: Request, set_id: str, kind: str | None = None):
    user = auth.require_user(request)
    _require_set_member(user, set_id)
    items = auth_db.list_template_set_items(set_id, kind=kind)
    # Hydrate each item with the underlying agent template so the UI can
    # render thumbnails / names without a second call. The agent template
    # lives in a separate sqlite layer, accessed via percy.agent.templates.
    try:
        from percy.agent import templates as _agent_tpls
        for it in items:
            it["template"] = _agent_tpls.get_template(it["template_id"])
    except Exception as exc:
        log.warning("could not hydrate set items: %s", exc)
    return {"items": items}


@router.post("/api/template-sets/{set_id}/items")
def add_set_item(request: Request, set_id: str, req: AddItemRequest):
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    if req.kind not in ("slide", "element"):
        raise HTTPException(400, "kind must be 'slide' or 'element'")
    # Verify the template exists in the agent layer to avoid dangling rows.
    try:
        from percy.agent import templates as _agent_tpls
        if not _agent_tpls.get_template(req.template_id):
            raise HTTPException(404, f"agent template {req.template_id!r} not found")
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("could not verify agent template: %s", exc)
    return auth_db.add_template_set_item(
        set_id, req.template_id,
        kind=req.kind, order_index=req.order_index,
        provenance=req.provenance, added_by=user["id"],
    )


@router.delete("/api/template-sets/{set_id}/items/{template_id}")
def remove_set_item(request: Request, set_id: str, template_id: str):
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    ok = auth_db.remove_template_set_item(set_id, template_id)
    if not ok:
        raise HTTPException(404, "item not in this set")
    return {"ok": True}


class ReorderItemsRequest(BaseModel):
    template_ids: list[str]


@router.post("/api/template-sets/{set_id}/items/reorder")
def reorder_set_items(request: Request, set_id: str, req: ReorderItemsRequest):
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    auth_db.reorder_template_set_items(set_id, req.template_ids)
    return {"ok": True, "ordered_count": len(req.template_ids)}


# ── Reference documents (mining sources) ────────────────────────────────────


_ALLOWED_REF_EXTS = {".pptx", ".pdf", ".md", ".txt"}
_MAX_REF_SIZE = 50 * 1024 * 1024  # 50 MB per file


@router.post("/api/template-sets/{set_id}/refs")
async def upload_ref(request: Request, set_id: str, bg: BackgroundTasks,
                       file: UploadFile = File(...)):
    """Upload a reference doc (PPTX / PDF / MD / TXT) to a template set.

    Saves to disk, immediately schedules a background Bridge-onboard task.
    Returns with status 'onboarding' (or 'uploaded' if the type doesn't get
    auto-onboarded — markdown / txt). Clients poll `GET .../refs/{id}` until
    they see 'ready' / 'failed'.
    """
    user = auth.require_user(request)
    _require_set_editor(user, set_id)

    filename = file.filename or "unnamed"
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_REF_EXTS:
        raise HTTPException(
            415,
            f"unsupported file type {ext!r}; allowed: {', '.join(sorted(_ALLOWED_REF_EXTS))}",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "uploaded file is empty")
    if len(raw) > _MAX_REF_SIZE:
        raise HTTPException(413, f"file too large (limit {_MAX_REF_SIZE // (1024*1024)} MB)")

    ref = auth_db.create_template_set_ref(
        set_id,
        filename=filename,
        mime_type=file.content_type,
        size_bytes=len(raw),
        storage_key="",                       # filled after we have the ref id
        uploaded_by=user["id"],
        status="uploaded",
    )
    target = _ref_path(set_id, ref["id"], ext)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    storage_key = str(target.relative_to(_DATA_DIR.parent)) if target.is_relative_to(_DATA_DIR.parent) else str(target)
    ref = auth_db.update_template_set_ref(ref["id"], storage_key=storage_key)
    log.info("upload_ref: set=%s ref=%s file=%s (%d bytes)",
             set_id, ref["id"], filename, len(raw))

    # Auto-schedule onboarding for the file types that go through the Bridge
    # pipeline. Markdown / txt refs are read at mine-time directly.
    if ext in {".pptx", ".pdf"}:
        auth_db.update_template_set_ref(ref["id"], status="onboarding")
        bg.add_task(_run_onboard_in_background, set_id, ref["id"], str(target))
        ref = auth_db.get_template_set_ref(ref["id"])
    return ref


@router.get("/api/template-sets/{set_id}/refs")
def list_refs(request: Request, set_id: str):
    user = auth.require_user(request)
    _require_set_member(user, set_id)
    return {"refs": auth_db.list_template_set_refs(set_id)}


@router.get("/api/template-sets/{set_id}/refs/{ref_id}")
def get_ref(request: Request, set_id: str, ref_id: str):
    user = auth.require_user(request)
    _require_set_member(user, set_id)
    ref = auth_db.get_template_set_ref(ref_id)
    if not ref or ref["set_id"] != set_id:
        raise HTTPException(404, "reference not found")
    return ref


@router.delete("/api/template-sets/{set_id}/refs/{ref_id}")
def delete_ref(request: Request, set_id: str, ref_id: str):
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    ref = auth_db.get_template_set_ref(ref_id)
    if not ref or ref["set_id"] != set_id:
        raise HTTPException(404, "reference not found")
    # Best-effort blob removal.
    if ref.get("storage_key"):
        try:
            (_DATA_DIR.parent / ref["storage_key"]).unlink(missing_ok=True)
        except Exception as exc:
            log.warning("delete_ref: could not unlink blob %s: %s", ref["storage_key"], exc)
    auth_db.delete_template_set_ref(ref_id)
    return {"ok": True}


# ── Background onboarding worker ────────────────────────────────────────────


def _run_onboard_in_background(set_id: str, ref_id: str, abs_path: str) -> None:
    """Run the Bridge onboard pipeline + auto-brand-extract in a background
    thread. Updates the ref row's status field as it progresses so polling
    clients can show 'onboarding' → 'ready' / 'failed'.

    Auto-brand-extract: once this ref onboards, if it's not the only ready
    ref in the set, re-run extract-brand-from-refs so the user gets fresh
    proposed_palette / proposed_fonts without an explicit click. Errors in
    the extract step are logged but don't fail the onboard.
    """
    try:
        from . import main as _backend_main
        result = _backend_main.onboard(_backend_main.OnboardRequest(path=abs_path))
        doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
        if not doc_id:
            raise RuntimeError("onboard returned no doc_id")
        doc = _backend_main._docs.get(doc_id, {}).get("doc")
        slide_count = len(doc.slides) if doc else 0
        element_count = sum(len(s.elements or []) for s in (doc.slides if doc else []))

        auth_db.update_template_set_ref(
            ref_id, doc_id=doc_id, status="ready",
            slide_count=slide_count, element_count=element_count, error=None,
        )
        log.info("onboard_ref bg: set=%s ref=%s doc=%s slides=%d elements=%d",
                 set_id, ref_id, doc_id, slide_count, element_count)

        # Auto-extract brand stats. Best-effort — never blocks ref readiness.
        try:
            _run_brand_extract(set_id)
        except Exception as exc:
            log.warning("auto-brand-extract failed for set %s: %s", set_id, exc)
    except Exception as exc:
        log.exception("onboard_ref bg failed: set=%s ref=%s", set_id, ref_id)
        auth_db.update_template_set_ref(ref_id, status="failed", error=str(exc))


def _run_brand_extract(set_id: str) -> dict[str, Any] | None:
    """Shared helper used by both the explicit endpoint and the post-onboard
    auto-trigger. Returns the new brand dict, or None if no refs are ready
    yet (in which case the auto-trigger silently no-ops)."""
    import collections
    refs = auth_db.list_template_set_refs(set_id)
    refs_ready = [r for r in refs if r.get("status") == "ready" and r.get("doc_id")]
    if not refs_ready:
        return None

    from . import main as _backend_main
    color_counter: collections.Counter = collections.Counter()
    font_counter: collections.Counter = collections.Counter()
    title_sizes: list[float] = []
    body_sizes: list[float] = []
    chart_types: collections.Counter = collections.Counter()
    table_total = table_banded = table_header = 0
    docs_scanned = 0

    for ref in refs_ready:
        d = _backend_main._docs.get(ref.get("doc_id"))
        if not d:
            continue
        doc = d["doc"]
        docs_scanned += 1
        theme = getattr(doc, "theme_colors", None) or {}
        for slide in doc.slides:
            for el in slide.elements or []:
                fill = getattr(el, "fill", None)
                if fill and getattr(fill, "fill_type", None) == "solid":
                    fc = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
                    if fc and getattr(fc, "value", None):
                        try:
                            hex_val = fc.resolve(theme)
                            if hex_val and hex_val.startswith("#"):
                                color_counter[hex_val.upper()] += 1
                        except Exception:
                            pass
                paragraphs = (
                    getattr(getattr(el, "text_frame", None), "paragraphs", None)
                    or getattr(el, "paragraphs", None)
                    or (getattr(getattr(el, "text_content", None), "paragraphs", None))
                )
                for para in (paragraphs or []):
                    for run in (getattr(para, "runs", None) or []):
                        fn = getattr(run, "font_name", None)
                        if fn: font_counter[fn] += 1
                        fs = getattr(run, "font_size", None)
                        if isinstance(fs, (int, float)):
                            if fs > 18: title_sizes.append(float(fs))
                            else:       body_sizes.append(float(fs))
                if getattr(el, "element_type", None) == "BridgeChart":
                    ct = getattr(el, "chart_type", None)
                    if ct: chart_types[ct] += 1
                if getattr(el, "element_type", None) == "BridgeTable":
                    table_total += 1
                    tp = getattr(el, "table_properties", None)
                    if tp:
                        if getattr(tp, "banded_rows", False): table_banded += 1
                        if getattr(tp, "first_row_header", False): table_header += 1

    def _avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 1) if xs else None

    proposed_palette = [
        {"hex": c, "count": n, "role": ("primary" if i == 0 else "accent" if i < 4 else "neutral")}
        for i, (c, n) in enumerate(color_counter.most_common(8))
    ]
    proposed_fonts = [
        {"name": f, "count": n,
         "role": ("heading" if i == 0 else "body" if i == 1 else "alt")}
        for i, (f, n) in enumerate(font_counter.most_common(4))
    ]
    brand_summary = {
        "proposed_palette": proposed_palette,
        "proposed_fonts": proposed_fonts,
        "chart_types": [{"type": t, "count": n} for t, n in chart_types.most_common()],
        "table_summary": {
            "count": table_total,
            "banded_rows_pct": round(100 * table_banded / table_total, 1) if table_total else 0,
            "first_row_header_pct": round(100 * table_header / table_total, 1) if table_total else 0,
        },
        "typography": {
            "avg_title_size": _avg(title_sizes),
            "avg_body_size": _avg(body_sizes),
        },
        "docs_scanned": docs_scanned,
        "extracted_at": int(time.time()),
    }
    auth_db.update_template(set_id, brand=brand_summary, last_extracted_at=int(time.time()))
    return brand_summary


# ── Onboarding refs into Bridge docs + auto-brand-extract ───────────────────


@router.post("/api/template-sets/{set_id}/refs/{ref_id}/onboard")
def onboard_ref(request: Request, set_id: str, ref_id: str, bg: BackgroundTasks):
    """Kick off Bridge onboarding for a reference doc asynchronously.

    Returns immediately with status='onboarding'. The actual work runs in a
    FastAPI BackgroundTask so large PDFs don't block the request. Clients
    poll `GET .../refs/{id}` (or list refs) to see 'ready' / 'failed'.

    On success, also auto-triggers extract-brand-from-refs so the user gets
    fresh proposed palette/fonts without an extra click.
    """
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    ref = auth_db.get_template_set_ref(ref_id)
    if not ref or ref["set_id"] != set_id:
        raise HTTPException(404, "reference not found")
    if ref.get("status") == "ready" and ref.get("doc_id"):
        return ref

    storage_key = ref.get("storage_key") or ""
    abs_path = _DATA_DIR.parent / storage_key
    if not abs_path.exists():
        auth_db.update_template_set_ref(ref_id, status="failed", error="storage blob missing")
        raise HTTPException(404, "reference blob not found on disk")

    auth_db.update_template_set_ref(ref_id, status="onboarding", error=None)
    bg.add_task(_run_onboard_in_background, set_id, ref_id, str(abs_path))
    return auth_db.get_template_set_ref(ref_id)


@router.post("/api/template-sets/{set_id}/extract-brand-from-refs")
def extract_brand_from_refs(request: Request, set_id: str):
    """Walk every onboarded reference doc and aggregate palette + fonts.

    Deterministic — no LLM. Reads theme_colors, element fills, and font_name
    distributions; writes a *proposed* palette / fonts into the set's `brand`
    JSON column under `proposed_*` keys. The user reviews & confirms via the
    editor (which writes the curated `palette` / `fonts` columns).

    Implementation lives in `_run_brand_extract` and is shared with the
    auto-trigger that fires after each background onboarding completes.
    """
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    brand = _run_brand_extract(set_id)
    if brand is None:
        raise HTTPException(
            400,
            "No onboarded reference docs. Upload PPTX/PDF first (onboarding "
            "runs automatically in the background).",
        )
    return {"ok": True, "brand": brand}


# ── LLM-powered template induction ──────────────────────────────────────────


class MineTemplatesRequest(BaseModel):
    ref_ids: list[str] | None = None       # None = use all ready refs
    include_slides: bool = True
    include_elements: bool = True
    max_candidates: int = 25
    use_llm: bool = True


@router.post("/api/template-sets/{set_id}/mine")
def mine_templates(request: Request, set_id: str, req: MineTemplatesRequest):
    """Mine candidate slide + element templates from this set's onboarded refs.

    Returns *candidates only* — the user must explicitly accept each via
    /accept-candidate before they become real templates and join the set.
    This is intentional: induction is suggestive, not authoritative.
    """
    user = auth.require_user(request)
    tpl = _require_set_editor(user, set_id)

    refs = auth_db.list_template_set_refs(set_id)
    if req.ref_ids:
        wanted = set(req.ref_ids)
        refs = [r for r in refs if r["id"] in wanted]
    refs_ready = [r for r in refs if r.get("status") == "ready" and r.get("doc_id")]
    if not refs_ready:
        raise HTTPException(
            400,
            "No onboarded reference docs ready for mining. Upload PPTX/PDF and "
            "call /onboard on each ref first.",
        )

    # Build the {ref_id: doc} map from in-memory docs.
    from . import main as _backend_main
    docs_by_ref: dict[str, Any] = {}
    missing: list[str] = []
    for r in refs_ready:
        d = _backend_main._docs.get(r["doc_id"])
        if d and d.get("doc"):
            docs_by_ref[r["id"]] = d["doc"]
        else:
            missing.append(r["id"])
    if not docs_by_ref:
        raise HTTPException(
            500,
            f"All ref docs missing from in-memory cache: {missing!r}. Re-onboard.",
        )

    # Wire up the LLM polish step. We share the studio's existing LLM stack so
    # cost telemetry + provider fallback work for free.
    llm_call = None
    if req.use_llm:
        try:
            from app.backend.agent_chat import _make_llm_call
            llm_call = _make_llm_call()
        except Exception as exc:
            log.warning("could not get LLM client for induction: %s — running deterministic-only", exc)
            llm_call = None

    from percy.agent import template_induction
    candidates = template_induction.induce_templates(
        docs_by_ref,
        llm_call=llm_call,
        max_candidates=req.max_candidates,
        include_slides=req.include_slides,
        include_elements=req.include_elements,
    )
    log.info("mine: set=%s refs=%d candidates=%d (llm=%s)",
             set_id, len(docs_by_ref), len(candidates), bool(llm_call))
    return {
        "candidates": candidates,
        "refs_used": list(docs_by_ref.keys()),
        "refs_missing": missing,
        "llm_used": bool(llm_call),
    }


class AcceptCandidateRequest(BaseModel):
    candidate: dict[str, Any]              # raw candidate dict from /mine
    category: str = "Induced"
    order_index: int = 0


@router.post("/api/template-sets/{set_id}/accept-candidate")
def accept_candidate(request: Request, set_id: str, req: AcceptCandidateRequest):
    """Accept a mined candidate. Persists it as a real agent template and
    adds it to this set with kind matching the candidate's kind.
    """
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    if "kind" not in req.candidate or req.candidate["kind"] not in ("slide", "element"):
        raise HTTPException(400, "candidate.kind must be 'slide' or 'element'")

    from percy.agent import template_induction
    template_id = template_induction.accept_candidate(req.candidate, category=req.category)
    auth_db.add_template_set_item(
        set_id, template_id,
        kind=req.candidate["kind"],
        order_index=req.order_index,
        added_by=user["id"],
        provenance=req.candidate.get("provenance") or {},
    )
    return {"ok": True, "template_id": template_id, "set_id": set_id,
            "kind": req.candidate["kind"]}


class ConfirmProposedBrandRequest(BaseModel):
    palette: list[dict[str, Any]] | None = None
    fonts: list[dict[str, Any]] | None = None


@router.post("/api/template-sets/{set_id}/confirm-brand")
def confirm_brand(request: Request, set_id: str, req: ConfirmProposedBrandRequest):
    """Promote `proposed_palette` / `proposed_fonts` (or caller-supplied lists)
    into the curated `palette` / `fonts` columns. This is the moment a user
    "approves" the extracted brand for use by the agent.
    """
    user = auth.require_user(request)
    tpl = _require_set_editor(user, set_id)
    brand = tpl.get("brand") or {}
    palette = req.palette if req.palette is not None else brand.get("proposed_palette") or []
    fonts = req.fonts if req.fonts is not None else brand.get("proposed_fonts") or []
    return auth_db.update_template(set_id, palette=palette, fonts=fonts)


# ── Registration ────────────────────────────────────────────────────────────


def register_template_sets_router(app) -> None:
    # Ensure the data dir exists at boot — first upload may otherwise race
    # the mkdir.
    _REFS_ROOT.mkdir(parents=True, exist_ok=True)
    app.include_router(router)
    log.info("template_sets: registered router (refs root: %s)", _REFS_ROOT)
