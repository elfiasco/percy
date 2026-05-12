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
    """Caller must be a member of the set's org (or the set is a builtin —
    those are visible to every authenticated user)."""
    tpl = auth_db.get_template(set_id)
    if not tpl:
        raise HTTPException(404, "Template set not found")
    if tpl.get("is_builtin"):
        return tpl
    if not auth_db.get_membership(user["id"], tpl["org_id"]):
        raise HTTPException(403, "Not a member of this template set's org")
    return tpl


def _require_set_editor(user: dict[str, Any], set_id: str) -> dict[str, Any]:
    """Caller must be either the set owner or an org owner/admin.

    Builtin sets (Percy Standard) are read-only for everyone — no exceptions.
    The API surfaces a clear 403 with a hint to fork the set rather than
    edit in place.
    """
    tpl = _require_set_member(user, set_id)
    if tpl.get("is_builtin"):
        raise HTTPException(
            403,
            "This is a builtin template set and cannot be edited. "
            "Create a new set from these defaults if you want to customize.",
        )
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


# ── Pixel-sampling palette fallback (for PDF-derived sets) ──────────────────


def _pixel_sample_palette_across_refs(
    set_id: str,
    refs_ready: list[dict[str, Any]],
    *,
    top_k: int = 8,
    max_pngs_per_doc: int = 8,
) -> list[dict[str, Any]]:
    """Pixel-sample bridge-rendered PNGs across this set's ready references.

    PDFs onboard with no structured fill data, so the element-walk produces
    an empty palette. But the rendered pages are real images — we can
    quantize them with Pillow and surface the dominant colors. That's the
    same thing a human would do: "the slides look navy, so that's the
    accent."

    Filters:
      * skip near-white (>240 RGB) — those are backgrounds, not brand
      * skip near-black (<25 RGB) — pure text body
      * skip pixels too close to neutral gray
    These filters keep us from returning "the page is mostly white" as the
    primary brand color.

    Returns: [{"hex": "#1A3D7C", "count": int, "role": "accent"}, ...]
    """
    import collections

    try:
        from PIL import Image
    except Exception as exc:
        log.warning("pixel_sample: Pillow unavailable: %s", exc)
        return []

    from . import main as _backend_main
    from pathlib import Path as _P

    sampled: collections.Counter[tuple[int, int, int]] = collections.Counter()
    pngs_processed = 0
    for ref in refs_ready:
        doc_id = ref.get("doc_id")
        if not doc_id:
            continue
        # Use the document's own bridge_dir if it set one; otherwise fall
        # back to the canonical cache layout.
        doc_record = _backend_main._docs.get(doc_id) or {}
        bridge_dir = doc_record.get("bridge_dir")
        if not bridge_dir:
            # Default cache location from main._CACHE_DIR.
            bridge_dir = _backend_main._CACHE_DIR / doc_id / "bridge"
        bridge_dir = _P(bridge_dir)
        if not bridge_dir.exists():
            continue
        # Iterate slide PNGs in order; cap so we don't churn on 100-page decks.
        png_paths = sorted(bridge_dir.glob("*.png"))[:max_pngs_per_doc]
        for p in png_paths:
            try:
                img = Image.open(p).convert("RGB")
                # Resize for speed — colors are preserved by area, not detail.
                img.thumbnail((400, 400))
                # Quantize: 16 colors per page is plenty.
                quantized = img.quantize(colors=16, method=Image.Quantize.MEDIANCUT)
                palette = quantized.getpalette()
                color_counts = quantized.getcolors(maxcolors=64) or []
                for count, palette_idx in color_counts:
                    r = palette[palette_idx * 3]
                    g = palette[palette_idx * 3 + 1]
                    b = palette[palette_idx * 3 + 2]
                    lightness = (r + g + b) / 3
                    saturation = max(r, g, b) - min(r, g, b)
                    # Skip near-white / off-white backgrounds — PDF page
                    # backgrounds tend to be cream / pale-grey not pure
                    # white, and they vastly outweigh real brand pixels.
                    if lightness > 220:    continue
                    if lightness < 25:     continue   # near-black body text
                    if saturation < 35:    continue   # too gray to be brand
                    # Round to nearest 8 to collapse near-duplicates from
                    # gradients/anti-aliasing.
                    r8 = (r // 8) * 8
                    g8 = (g // 8) * 8
                    b8 = (b // 8) * 8
                    sampled[(r8, g8, b8)] += count
                pngs_processed += 1
            except Exception as exc:
                log.debug("pixel_sample: %s failed: %s", p.name, exc)

    if pngs_processed == 0 or not sampled:
        return []

    log.info("pixel_sample: processed %d PNGs across %d refs, found %d unique colors",
             pngs_processed, len(refs_ready), len(sampled))

    # Reject the single dominant color if it's wildly more common than the
    # next one (likely a tinted-background, not a brand accent). Threshold:
    # > 3x the next-most-frequent color.
    common = sampled.most_common(top_k + 4)
    if len(common) >= 2 and common[0][1] > 3 * common[1][1]:
        log.info("pixel_sample: dropping background-dominant color %s "
                 "(%dx vs next %dx)",
                 common[0][0], common[0][1], common[1][1])
        common = common[1:]

    out: list[dict[str, Any]] = []
    for i, ((r, g, b), count) in enumerate(common[:top_k]):
        hex_val = f"#{r:02X}{g:02X}{b:02X}"
        out.append({
            "hex": hex_val, "count": int(count),
            "role": "primary" if i == 0 else "accent" if i < 4 else "neutral",
            "source": "pixel-sample",
        })
    return out


# ── Background onboarding worker ────────────────────────────────────────────


def _run_onboard_in_background(set_id: str, ref_id: str, abs_path: str) -> None:
    """Run the Bridge onboard pipeline + auto-extract + auto-demo in a
    background thread. Updates the ref row's status field as it progresses
    so polling clients can show 'onboarding' → 'ready' / 'failed'.

    Pipeline (sequential, each step best-effort — failures log but don't
    block the next step):

      1. Onboard PPTX/PDF → Bridge doc
      2. Auto brand-extract  (deterministic palette + fonts)
      3. Auto style-extract  (chained inside _run_brand_extract)
      4. Auto demo-deck      (throttled — once per 5 min per set)

    Step 4 is the self-validation step: after every reference upload the
    user gets a fresh demo deck showing how the agent uses their
    (potentially newly-mined) templates and brand. Generated as a real
    studio_project the user can open from /home or the editor's "Latest
    demo" link.
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

        # Auto-run the canned demo prompt. Throttled — rapid-fire ref
        # uploads share one demo run instead of burning LLM calls per file.
        try:
            _run_auto_demo(set_id)
        except Exception as exc:
            log.warning("auto-demo failed for set %s: %s", set_id, exc)
    except Exception as exc:
        log.exception("onboard_ref bg failed: set=%s ref=%s", set_id, ref_id)
        auth_db.update_template_set_ref(ref_id, status="failed", error=str(exc))


_AUTO_DEMO_THROTTLE_SECONDS = 300   # 5 minutes — guard against multi-upload bursts


def _run_auto_demo(set_id: str, *, force: bool = False) -> dict[str, Any] | None:
    """Run the default canned demo prompt against this set.

    Creates a fresh Bridge doc + a backing studio_project so the user can
    open the demo through /studio/:project_id — no special "open raw doc"
    route needed.

    Throttled to once per _AUTO_DEMO_THROTTLE_SECONDS per set unless
    `force=True`. Skips builtin sets (Percy Standard is stable; we don't
    burn tokens demo-ing it on every boot).

    On success, stashes the new doc_id + project_id + summary onto the
    set's row. On failure logs and returns None (the calling pipeline
    continues — auto-demo is non-blocking).
    """
    import json as _json
    import time as _time
    import uuid as _uuid

    tpl = auth_db.get_template(set_id)
    if not tpl:
        return None
    if tpl.get("is_builtin"):
        log.info("auto-demo: skipping builtin set %s", set_id)
        return None
    last_at = int(tpl.get("last_demo_at") or 0)
    if not force and last_at and (_time.time() - last_at) < _AUTO_DEMO_THROTTLE_SECONDS:
        log.info("auto-demo: throttled (set=%s, %ds since last run)",
                 set_id, int(_time.time() - last_at))
        return None

    # Drop the previous auto-demo project so we don't accumulate clutter.
    # The doc itself lives in process memory and will get GC'd when the
    # service recycles.
    old_project_id = tpl.get("last_demo_project_id")
    if old_project_id:
        try:
            auth_db.delete_project(old_project_id)
            log.info("auto-demo: removed prior demo project %s", old_project_id)
        except Exception as exc:
            log.warning("auto-demo: could not remove prior project: %s", exc)

    # Build a fresh blank Bridge doc.
    from . import main as _backend_main
    from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata

    new_doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors={},
    )
    doc_id = str(_uuid.uuid4())[:8]
    _backend_main._docs[doc_id] = {
        "doc": new_doc, "name": f"Demo · {tpl['name']}",
        "_undo_stack": [], "bridge_dir": None,
    }

    # Create the backing project so /studio/:project_id works.
    from datetime import datetime as _dt
    project_name = f"Demo · {tpl['name']} · {_dt.utcnow().strftime('%b %d')}"
    project = auth_db.create_project(
        tpl["org_id"], project_name,
        folder_id=None, doc_source=None,
        created_by=tpl.get("owner_id") or "__system__",
    )
    auth_db.update_project(project["id"], doc_id=doc_id)
    log.info("auto-demo: starting set=%s demo_doc=%s project=%s",
             set_id, doc_id, project["id"])

    # Pick the default canned prompt.
    from percy.agent.demo_prompts import get_demo_prompt
    demo = get_demo_prompt()

    # Drive generate-deck via Studio in-process. The asgi_app handle keeps
    # us inside the same FastAPI app so audit + cost telemetry record
    # correctly.
    from percy.agent.script_api import Studio
    from app.backend.main import app as _fastapi_app
    studio = Studio(
        base_url="http://internal",
        doc_id=doc_id,
        auth_token=None,
        timeout_s=180,
        asgi_app=_fastapi_app,
    )
    payload = {
        "prompt": demo.prompt,
        "doc_id": doc_id,
        "start_slide": 1,
        "template_set_id": set_id,
    }
    try:
        result = studio._post("/api/agent/generate-deck", payload)
    except Exception as exc:
        log.exception("auto-demo: generate-deck call failed for set %s", set_id)
        # Don't store a partial — leave last_demo_* untouched so the user
        # doesn't see a misleading "last demo" pointer to a broken doc.
        try:
            auth_db.delete_project(project["id"])
        except Exception:
            pass
        return None

    summary = {
        "demo_id": demo.id,
        "demo_name": demo.name,
        "slides_applied": len(result.get("applied") or []),
        "errors": (result.get("errors") or [])[:3],
        "ok": bool(result.get("ok", True)),
    }
    auth_db.update_template(
        set_id,
        last_demo_doc_id=doc_id,
        last_demo_project_id=project["id"],
        last_demo_at=int(_time.time()),
        last_demo_summary=summary,
    )
    log.info("auto-demo: done set=%s slides_applied=%d errors=%d",
             set_id, summary["slides_applied"], len(summary["errors"]))
    return {
        "doc_id": doc_id, "project_id": project["id"], **summary,
    }


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

    # Snowflake-deck reality: 1149 fills are tagged `solidFill` (OOXML), not
    # `solid`. Older extract code (still alive in workspace_api.extract_template_brand)
    # had a typo'd `"solid"` filter that yielded 0 colors. Match by "has a
    # resolvable color value" instead of by type label so we work across deck
    # styles. PATTERNED + theme-resolved fills also contribute brand colors.
    def _try_resolve(fc, theme_map) -> str | None:
        if not fc or not getattr(fc, "value", None):
            return None
        try:
            hex_val = fc.resolve(theme_map)
            if hex_val and hex_val.startswith("#"):
                return hex_val.upper()
        except Exception:
            return None
        return None

    for ref in refs_ready:
        d = _backend_main._docs.get(ref.get("doc_id"))
        if not d:
            continue
        doc = d["doc"]
        docs_scanned += 1
        theme = getattr(doc, "theme_colors", None) or {}
        for slide in doc.slides:
            for el in slide.elements or []:
                # Fills — any type that carries a color value (solidFill,
                # PATTERNED, gradFill background, etc.) counts.
                fill = getattr(el, "fill", None)
                if fill is not None:
                    fc = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
                    hex_val = _try_resolve(fc, theme)
                    if hex_val:
                        color_counter[hex_val] += 1

                # Borders / line strokes also carry brand colors (chart axes,
                # connector lines, shape outlines).
                line = getattr(el, "line", None)
                if line is not None:
                    lc = getattr(line, "color", None)
                    hex_val = _try_resolve(lc, theme)
                    if hex_val:
                        color_counter[hex_val] += 1

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
                        # Text colors are huge brand signal — Snowflake's
                        # cyan #29B5E8 appears 25x as font color but only
                        # 229x as fill. Counting both gives us a complete
                        # picture without double-attributing in any role.
                        fc = getattr(run, "font_color", None)
                        hex_val = _try_resolve(fc, theme)
                        if hex_val:
                            color_counter[hex_val] += 1
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
    # ── PDF / sparse-element fallback: pixel-sample the rendered bridge
    # PNGs and adopt their dominant colors. PDFs onboard with zero
    # structured fills (the content is raster-y), so without this BlackRock
    # / Caterpillar / etc. would extract no palette at all.
    if len(proposed_palette) < 4:
        pixel_palette = _pixel_sample_palette_across_refs(set_id, refs_ready, top_k=8)
        if pixel_palette:
            log.info("brand_extract: pixel-sampled %d palette colors for set %s",
                     len(pixel_palette), set_id)
            # Merge: keep any element-derived colors first (they're more
            # trustworthy when present), then top up with pixel-sampled.
            seen = {p["hex"] for p in proposed_palette}
            for c in pixel_palette:
                if c["hex"] not in seen:
                    proposed_palette.append(c)
                    seen.add(c["hex"])
            brand_summary["proposed_palette"] = proposed_palette[:8]
            brand_summary["pixel_sampled"] = True

    auth_db.update_template(set_id, brand=brand_summary, last_extracted_at=int(time.time()))

    # Chain into deterministic style-profile extraction so charts + tables +
    # text styles update on every onboard. Lives in its own helper because
    # the dataclasses module produces a typed StyleProfile rather than the
    # ad-hoc brand-summary dict above.
    try:
        _run_style_extract(set_id)
    except Exception as exc:
        log.warning("auto-style-extract failed for set %s: %s", set_id, exc)

    return brand_summary


def _run_style_extract(set_id: str) -> dict[str, Any] | None:
    """Deterministic style-profile extraction across all ready refs in a set.

    Writes the result to studio_templates.style_profile. The polish step
    (LLM-written when_to_use / when_to_avoid strings) is *not* run here —
    that's lazily applied at codegen time so we don't burn LLM tokens on
    every onboard.
    """
    refs = auth_db.list_template_set_refs(set_id)
    refs_ready = [r for r in refs if r.get("status") == "ready" and r.get("doc_id")]
    if not refs_ready:
        return None
    from . import main as _backend_main
    from percy.agent import style_extraction

    docs: list[Any] = []
    theme: dict[str, str] = {}
    for r in refs_ready:
        d = _backend_main._docs.get(r.get("doc_id"))
        if d and d.get("doc"):
            docs.append(d["doc"])
            theme.update(getattr(d["doc"], "theme_colors", None) or {})
    if not docs:
        return None
    profile = style_extraction.extract_profile(docs, theme_colors=theme)
    profile_dict = profile.to_dict()
    auth_db.update_template(set_id, style_profile=profile_dict)
    log.info("style profile: set=%s docs=%d charts=%d tables=%d palette=%d",
             set_id, len(docs), len(profile.chart_styles),
             1 if profile.table_style else 0, len(profile.palette_ordered))
    return profile_dict


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


# ── Demo deck generation ────────────────────────────────────────────────────


class DemoDeckRequest(BaseModel):
    demo_id: str | None = None             # which canned prompt; None = default 10-slide
    prompt_override: str | None = None     # custom prompt instead of canned
    target_doc_id: str | None = None       # write to existing doc; None = create new


@router.post("/api/template-sets/{set_id}/demo-deck")
async def demo_deck(request: Request, set_id: str, req: DemoDeckRequest):
    """Run a canned 'make me a deck from this set' demo.

    Picks a prompt (default = quarterly business update, 10 slides), creates
    a fresh blank Bridge document, then calls the existing generate-deck
    machinery scoped to this Template Set's items. The agent has to choose
    layouts from the set without being told which ones.

    Returns the new doc_id so the caller can navigate to /studio.

    This is the same flow we'd use for a public unauthenticated marketing
    demo — minus the auth check.
    """
    user = auth.require_user(request)
    _require_set_member(user, set_id)

    from percy.agent.demo_prompts import get_demo_prompt
    try:
        demo = get_demo_prompt(req.demo_id)
    except KeyError as exc:
        raise HTTPException(400, str(exc))

    prompt = req.prompt_override or demo.prompt

    # 1. Get / create the target doc
    from . import main as _backend_main
    if req.target_doc_id:
        doc_id = req.target_doc_id
        if doc_id not in _backend_main._docs:
            raise HTTPException(404, "target_doc_id not in memory")
    else:
        # Create a blank doc.
        from percy.bridge import (
            BridgeSlide, PercyDocument, PresentationMetadata,
        )
        import uuid as _uuid
        new_doc = PercyDocument(
            slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
            metadata=PresentationMetadata(slide_count=1),
            theme_colors={},
        )
        doc_id = str(_uuid.uuid4())[:8]
        _backend_main._docs[doc_id] = {
            "doc": new_doc, "name": f"Demo: {demo.name}",
            "_undo_stack": [], "bridge_dir": None,
        }
        log.info("demo_deck: created blank doc %s for set %s", doc_id, set_id)

    # 2. Delegate to generate-deck with template_set_id forced to this set.
    #    We post in-process (httpx ASGITransport) so audit + cost telemetry
    #    flow correctly.
    from percy.agent.script_api import Studio
    studio = Studio(
        base_url=f"{request.url.scheme}://{request.url.netloc}",
        doc_id=doc_id,
        auth_token=request.cookies.get("percy_session"),
        timeout_s=180,
        asgi_app=request.app,
    )
    payload = {
        "prompt": prompt,
        "doc_id": doc_id,
        "start_slide": 1,
        "template_set_id": set_id,
    }
    try:
        result = studio._post("/api/agent/generate-deck", payload)
    except Exception as exc:
        log.exception("demo_deck: generate-deck call failed")
        raise HTTPException(500, f"demo deck generation failed: {exc}")

    return {
        "ok": result.get("ok", True),
        "doc_id": doc_id,
        "demo_id": demo.id,
        "demo_name": demo.name,
        "set_id": set_id,
        "slides_applied": len(result.get("applied") or []),
        "errors": result.get("errors") or [],
        "plan": result.get("plan"),
    }


@router.post("/api/template-sets/{set_id}/rerun-auto-demo")
def rerun_auto_demo(request: Request, set_id: str):
    """Force-run the canned auto-demo for this set right now.

    Bypasses the throttle that protects the background pipeline from
    burning LLM tokens on rapid ref uploads. Used by the editor's
    "Re-run demo" button so users can refresh on demand after editing
    palette/instructions.
    """
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    result = _run_auto_demo(set_id, force=True)
    if result is None:
        raise HTTPException(500, "Demo run failed — see server logs.")
    return result


# ── Standalone demo-deck API ────────────────────────────────────────────────


class CreateDemoDeckRequest(BaseModel):
    """Body for POST /api/demo-decks — see app.backend.demo_deck_runner."""
    template_set_id: str
    prompt_id: str | None = None
    force: bool = False


@router.post("/api/demo-decks")
def create_demo_deck(request: Request, req: CreateDemoDeckRequest):
    """Generate a demo deck for a template set.

    This is a STANDALONE operation — the demo deck is a regular
    studio_project artifact, NOT part of the template set itself. The set
    is the *input*; the project is the *output*. A set can have many
    demos over time.

    Forces Bedrock Sonnet 4.6 for the underlying generate-deck call —
    the demo is meant to showcase the best possible output, so we don't
    let it fall back to local LM Studio or smaller models.

    Returns:
      {
        ok, throttled, project_id, doc_id, set_id, prompt_id, summary
      }

    Errors:
      400 if the template set doesn't exist
      500 if generation fails (logs detail server-side)
    """
    auth.require_user(request)
    from app.backend import demo_deck_runner
    result = demo_deck_runner.run_demo(
        template_set_id=req.template_set_id,
        prompt_id=req.prompt_id,
        force=req.force,
        asgi_app=request.app,
        auth_token=request.cookies.get("percy_session"),
    )
    if not result.get("ok"):
        raise HTTPException(500, result.get("error", "demo generation failed"))
    return result


@router.get("/api/docs/{doc_id}/slides/{n}/svg-data")
def get_slide_svg_data(request: Request, doc_id: str, n: int):
    """Return a compact JSON payload of a slide's elements suitable for
    client-side SVG rendering.

    The endpoint is unauthenticated (already in the showcase allowlist
    pattern via random doc_ids) so the marketing splash can render
    real generated decks without forcing the visitor to sign in.
    """
    from . import main as _backend_main
    doc_record = _backend_main._docs.get(doc_id)
    if not doc_record:
        raise HTTPException(404, "doc not in memory")
    doc = doc_record["doc"]
    if n < 1 or n > len(doc.slides):
        raise HTTPException(404, f"slide {n} out of range (doc has {len(doc.slides)})")
    slide = doc.slides[n - 1]
    theme = getattr(doc, "theme_colors", None) or {}

    elements_out: list[dict[str, Any]] = []
    for el in (slide.elements or []):
        elements_out.append(_serialize_element_for_svg(el, theme))

    return {
        "doc_id": doc_id,
        "slide_n": n,
        "width_in": getattr(slide, "width", 13.333),
        "height_in": getattr(slide, "height", 7.5),
        "elements": elements_out,
    }


def _serialize_element_for_svg(el: Any, theme: dict[str, str]) -> dict[str, Any]:
    """Compact element representation for the SlideSvg frontend renderer.

    Returns the minimum fields needed to faithfully reproduce the element
    visually: type, position, fill, text content + formatting, line, etc.
    Trims giant blobs (image bytes, chart_xml_blob, workbook bytes) that
    we don't need for SVG render.
    """
    def _resolve(c: Any) -> str | None:
        if c is None or not getattr(c, "value", None): return None
        try:
            h = c.resolve(theme)
            return h if h and h.startswith("#") else None
        except Exception:
            return None

    et = getattr(el, "element_type", el.__class__.__name__)
    pos = getattr(el, "position", None)
    out: dict[str, Any] = {
        "type": et,
        "position": {
            "left_in": getattr(pos, "left", 0) if pos else 0,
            "top_in": getattr(pos, "top", 0) if pos else 0,
            "width_in": getattr(pos, "width", 0) if pos else 0,
            "height_in": getattr(pos, "height", 0) if pos else 0,
        } if pos else None,
    }

    # Fill (shape)
    fill = getattr(el, "fill", None)
    if fill is not None:
        fc = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
        out["fill"] = {
            "type": getattr(fill, "fill_type", None),
            "color": _resolve(fc),
        }
    # Text content
    texts: list[dict[str, Any]] = []
    for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
        cursor: Any = el
        for attr in path.split("."):
            cursor = getattr(cursor, attr, None)
            if cursor is None: break
        for para in (cursor or []):
            for run in (getattr(para, "runs", None) or []):
                t = getattr(run, "text", None)
                if not t: continue
                texts.append({
                    "text": t,
                    "font_name": getattr(run, "font_name", None),
                    "font_size": getattr(run, "font_size", None),
                    "font_bold": getattr(run, "font_bold", None),
                    "font_italic": getattr(run, "font_italic", None),
                    "color": _resolve(getattr(run, "font_color", None)),
                })
    if texts:
        out["text_runs"] = texts
        # Also surface alignment if at the paragraph level.
        for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
            cursor = el
            for attr in path.split("."):
                cursor = getattr(cursor, attr, None)
                if cursor is None: break
            if cursor:
                first_para = cursor[0] if isinstance(cursor, list) else None
                if first_para:
                    out["text_align"] = getattr(first_para, "alignment", None)
                break

    # Line (connectors, borders)
    line = getattr(el, "line", None)
    if line is not None:
        lc = getattr(line, "color", None)
        out["line"] = {
            "visible": getattr(line, "visible", True),
            "color": _resolve(lc),
            "width": getattr(line, "width", None),
        }

    # Chart placeholder marker
    if et == "BridgeChart":
        out["chart_type"] = getattr(el, "chart_type", None)
        cats = getattr(el, "categories", None)
        if cats and getattr(cats, "categories", None):
            out["chart_categories"] = list(cats.categories)[:8]
        series = getattr(el, "series", None) or []
        if series:
            out["chart_series_count"] = len(series)

    # Table placeholder marker
    if et == "BridgeTable":
        data = getattr(el, "data", None) or []
        out["table_dim"] = [len(data), len(data[0]) if data else 0]

    return out


@router.get("/api/demo-prompts")
def list_demo_prompts(request: Request):
    """Catalog of available canned demo prompts. Used by the editor's
    'Run demo' dropdown so users can pick between the 5-slide product
    launch and the 10-slide quarterly update."""
    auth.require_user(request)
    from percy.agent.demo_prompts import DEMO_PROMPTS, DEFAULT_DEMO_ID
    return {
        "demos": [
            {"id": p.id, "version": p.version, "name": p.name,
             "description": p.description, "slide_count": p.slide_count}
            for p in DEMO_PROMPTS.values()
        ],
        "default_id": DEFAULT_DEMO_ID,
    }


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


# ── Style profile extraction + Python codegen ───────────────────────────────


@router.post("/api/template-sets/{set_id}/extract-styles")
def extract_styles_route(request: Request, set_id: str):
    """Run deterministic chart/table/text style extraction across this set's
    onboarded references. Stored in studio_templates.style_profile as JSON;
    surfaces via GET /api/template-sets/{id}/style-profile."""
    user = auth.require_user(request)
    _require_set_editor(user, set_id)
    profile = _run_style_extract(set_id)
    if profile is None:
        raise HTTPException(
            400,
            "No onboarded reference docs ready for style extraction. Upload "
            "PPTX/PDF and let onboarding finish first.",
        )
    return {"ok": True, "style_profile": profile}


@router.get("/api/template-sets/{set_id}/style-profile")
def get_style_profile_route(request: Request, set_id: str):
    """Read the structured StyleProfile for a set. The shape is defined by
    src/percy/agent/style_profiles.py and is the canonical machine-readable
    "warm start" for downstream agents."""
    user = auth.require_user(request)
    tpl = _require_set_member(user, set_id)
    return {"style_profile": tpl.get("style_profile") or {}}


@router.get("/api/template-sets/{set_id}/python-module")
def get_python_module_route(request: Request, set_id: str, polish: bool = False):
    """Generate the typed Python builder module for this Template Set.

    Returns the full module source as a JSON string. Pass `?polish=true` to
    additionally invoke the LLM for when_to_use / when_to_avoid / example
    docstring fields (one call per template — adds latency + cost).

    The returned module can be downloaded via /python-module/download or
    imported by a notebook user after writing it to disk.
    """
    user = auth.require_user(request)
    tpl = _require_set_member(user, set_id)
    items = auth_db.list_template_set_items(set_id)
    if not items:
        raise HTTPException(
            400, "Template set has no items. Mine or add templates before generating code.",
        )
    # Hydrate items with the underlying agent template.
    from percy.agent import templates as _agent_tpls, template_codegen
    from percy.agent.style_profiles import StyleProfile
    for it in items:
        it["template"] = _agent_tpls.get_template(it["template_id"])

    style_profile_dict = tpl.get("style_profile") or {}
    style_profile = StyleProfile.from_dict(style_profile_dict)

    polish_map: dict[str, dict[str, str]] = {}
    if polish:
        try:
            from app.backend.agent_chat import _make_llm_call
            llm_call = _make_llm_call()
            for it in items:
                t = it.get("template")
                if not t:
                    continue
                polish_map[t["id"]] = template_codegen.polish_template(t, llm_call)
        except Exception as exc:
            log.warning("polish step failed; returning module without LLM polish: %s", exc)

    module_text = template_codegen.generate_module(
        set_name=tpl["name"],
        description=tpl.get("description") or "",
        palette=tpl.get("palette") or [],
        fonts=tpl.get("fonts") or [],
        style_profile=style_profile,
        items=items,
        polish_by_template_id=polish_map,
    )
    return {"module_text": module_text, "polished": bool(polish), "item_count": len(items)}


@router.get("/api/template-sets/{set_id}/python-module/download")
def download_python_module_route(request: Request, set_id: str, polish: bool = False):
    """Same as /python-module but returns the source as a downloadable .py
    file with Content-Disposition: attachment so browsers save it directly."""
    from fastapi.responses import Response
    user = auth.require_user(request)
    tpl = _require_set_member(user, set_id)
    res = get_python_module_route(request, set_id, polish=polish)
    module_text = res["module_text"]
    # Snake-case slug for the filename.
    import re as _re
    slug = _re.sub(r"[^A-Za-z0-9]+", "_", tpl["name"].lower()).strip("_") or "brand"
    return Response(
        content=module_text,
        media_type="text/x-python",
        headers={"Content-Disposition": f'attachment; filename="{slug}_brand.py"'},
    )


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
