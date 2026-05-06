"""Folders + projects API for the user-facing workspace.

Authorization model: every endpoint requires a logged-in user. Org-scoped
endpoints check that the user is a member of the org. Project endpoints check
membership of the project's org.

Project "open" flow:
  1. Client calls POST /api/projects/{id}/open
  2. If the project has a doc_id pointing to an in-memory doc, return it.
  3. Otherwise, if doc_source is a workspace path, run onboard_pptx/onboard_pdf
     and store the resulting doc_id on the project.
  4. Return { doc_id, project }
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from . import auth, auth_db

log = logging.getLogger("percy.workspace")
router = APIRouter(tags=["workspace"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _require_org_member(user: dict[str, Any], org_id: str) -> dict[str, Any]:
    org = auth_db.get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Org not found")
    membership = auth_db.get_membership(user["id"], org_id)
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this org")
    return org


def _require_org_admin(user: dict[str, Any], org_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    org = _require_org_member(user, org_id)
    membership = auth_db.get_membership(user["id"], org_id)
    if not membership or membership["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Org admin required")
    return org, membership


def _project_with_org_check(user: dict[str, Any], project_id: str) -> dict[str, Any]:
    project = auth_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _require_org_member(user, project["org_id"])
    return project


# ── Org listing ──────────────────────────────────────────────────────────────

@router.get("/api/orgs")
def list_my_orgs(request: Request):
    user = auth.require_user(request)
    return {"orgs": auth_db.list_user_orgs(user["id"])}


@router.get("/api/orgs/{org_id}")
def get_org(request: Request, org_id: str):
    user = auth.require_user(request)
    org = _require_org_member(user, org_id)
    membership = auth_db.get_membership(user["id"], org_id)
    return {**org, "role": membership["role"] if membership else None}


@router.get("/api/orgs/{org_id}/members")
def list_members(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    return {"members": auth_db.list_org_members(org_id)}


class UpdateMemberRoleRequest(BaseModel):
    role: str  # "owner" | "admin" | "member"


@router.patch("/api/orgs/{org_id}/members/{user_id}")
def update_member_role(request: Request, org_id: str, user_id: str, req: UpdateMemberRoleRequest):
    actor = auth.require_user(request)
    _require_org_admin(actor, org_id)
    if req.role not in ("owner", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if not auth_db.get_membership(user_id, org_id):
        raise HTTPException(status_code=404, detail="Member not found")
    auth_db.update_membership_role(user_id, org_id, req.role)
    return {"ok": True}


@router.delete("/api/orgs/{org_id}/members/{user_id}")
def remove_member(request: Request, org_id: str, user_id: str):
    actor = auth.require_user(request)
    _, actor_membership = _require_org_admin(actor, org_id)
    # Don't let an admin remove the last owner
    if user_id == actor["id"] and actor_membership["role"] == "owner":
        # ensure another owner exists
        members = auth_db.list_org_members(org_id)
        owners = [m for m in members if m["role"] == "owner"]
        if len(owners) <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last owner")
    auth_db.remove_membership(user_id, org_id)
    return {"ok": True}


# ── Invites ──────────────────────────────────────────────────────────────────

class CreateInviteRequest(BaseModel):
    email: str
    role: str = "member"


@router.get("/api/orgs/{org_id}/invites")
def list_invites(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    return {"invites": auth_db.list_org_invites(org_id)}


@router.post("/api/orgs/{org_id}/invites")
def create_invite(request: Request, org_id: str, req: CreateInviteRequest):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    if req.role not in ("owner", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if "@" not in req.email:
        raise HTTPException(status_code=400, detail="Invalid email")
    invite = auth_db.create_invite(org_id, req.email, req.role, invited_by=user["id"])
    # Return with a fully-qualified accept URL — no email integration in dev, copy & share manually
    accept_url = f"/invite/accept?token={invite['token']}"
    return {**invite, "accept_url": accept_url}


@router.delete("/api/invites/{invite_id}")
def revoke_invite(request: Request, invite_id: str):
    user = auth.require_user(request)
    invite = auth_db.get_invite(invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    _require_org_admin(user, invite["org_id"])
    auth_db.delete_invite(invite_id)
    return {"ok": True}


@router.post("/api/invites/accept")
def accept_invite(request: Request, token: str):
    user = auth.require_user(request)
    invite = auth_db.get_invite_by_token(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite invalid or expired")
    # Email match (case-insensitive). Allow override if existing user wants to accept.
    if invite["email"].lower() != user["email"].lower():
        raise HTTPException(status_code=403, detail=f"This invite was sent to {invite['email']}")
    auth_db.add_membership(user["id"], invite["org_id"], invite["role"])
    auth_db.mark_invite_accepted(invite["id"])
    return {"ok": True, "org_id": invite["org_id"]}


# ── Builds ────────────────────────────────────────────────────────────────────

import json as _json
import time as _time
import shutil as _shutil
from fastapi.responses import FileResponse


# Map of supported output formats → (file extension, build function reference name).
# Build functions are looked up by name on the running studio backend at request time.
_BUILD_FORMATS = {
    "pptx":      ".pptx",
    "pdf":       ".pdf",
    "png_zip":   ".zip",
    "html":      ".html",
    "markdown":  ".md",
    "percy":     ".percy",
}


class TriggerBuildRequest(BaseModel):
    formats: list[str] = ["pptx"]
    trigger: str       = "manual"


@router.get("/api/projects/{project_id}/builds")
def list_builds(request: Request, project_id: str):
    """Return all builds for a project, newest first."""
    user = auth.require_user(request)
    _project_with_org_check(user, project_id)
    builds = auth_db.list_project_builds(project_id)
    return {"builds": builds}


@router.get("/api/builds/{build_id}")
def get_build(request: Request, build_id: str):
    user = auth.require_user(request)
    build = auth_db.get_build(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    project = auth_db.get_project(build["project_id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _require_org_member(user, project["org_id"])
    return build


@router.get("/api/builds/{build_id}/files/{fmt}")
def download_build_file(request: Request, build_id: str, fmt: str):
    """Stream a build artifact file."""
    user = auth.require_user(request)
    build = auth_db.get_build(build_id)
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    project = auth_db.get_project(build["project_id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _require_org_member(user, project["org_id"])

    outputs = build.get("outputs") or {}
    path = outputs.get(fmt)
    if not path:
        raise HTTPException(status_code=404, detail=f"No output file for format {fmt!r}")
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=410, detail="Build artifact has been removed")
    ext = _BUILD_FORMATS.get(fmt, "")
    filename = f"{project['name']}-{build_id}{ext}"
    return FileResponse(str(p), filename=filename)


@router.post("/api/projects/{project_id}/builds")
def trigger_build(request: Request, project_id: str, req: TriggerBuildRequest):
    """Kick off a build of the given project to the requested output formats.

    Synchronous in v1 — runs in the request thread. Phase 2 will dispatch to
    a worker via the existing SQS queue.
    """
    user = auth.require_user(request)
    project = _project_with_org_check(user, project_id)

    # Validate formats
    valid_formats = [f for f in req.formats if f in _BUILD_FORMATS]
    if not valid_formats:
        raise HTTPException(status_code=400, detail=f"No supported formats requested. Pick from: {list(_BUILD_FORMATS)}")

    # Lazy import host helpers
    from app.backend import main as _backend_main  # type: ignore

    if not project.get("doc_source") and not project.get("doc_id"):
        raise HTTPException(status_code=400, detail="Project has no source file or doc; upload a .pptx or open the studio first")

    # 1) Create the build row
    build = auth_db.create_build(
        project_id=project_id,
        triggered_by=user["id"],
        trigger=req.trigger,
        formats=valid_formats,
    )

    # 2) Ensure the project's doc is loaded (onboard if needed)
    started = _time.time()
    auth_db.update_build(build["id"], status="running", started_at=int(started))

    try:
        # Onboard / fetch doc_id
        doc_id = project.get("doc_id")
        if not doc_id or doc_id not in _backend_main._docs:
            src = project.get("doc_source")
            if src:
                result = _backend_main.onboard(_backend_main.OnboardRequest(path=str(src)))
                doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
                if not doc_id:
                    raise RuntimeError("Onboarding failed: no doc_id")
            else:
                # Blank project — mint a fresh empty doc using the project's saved canvas.
                from app.backend.main import (  # type: ignore
                    CreateBlankDocRequest as _CreateBlankDocRequest,
                    create_blank_doc as _create_blank_doc,
                )
                meta = project.get("custom_properties") or {}
                canvas = (meta.get("blank_canvas") if isinstance(meta, dict) else None) or {}
                try:
                    width  = float(canvas.get("width_in"))  if canvas.get("width_in")  is not None else 13.333
                    height = float(canvas.get("height_in")) if canvas.get("height_in") is not None else 7.5
                except (TypeError, ValueError):
                    width, height = 13.333, 7.5
                result = _create_blank_doc(_CreateBlankDocRequest(
                    width_in=width, height_in=height, name=project["name"],
                ))
                doc_id = result["doc_id"]
            auth_db.update_project(project_id, doc_id=doc_id)

        outputs_dir = Path("uploads") / "builds" / build["id"]
        outputs_dir.mkdir(parents=True, exist_ok=True)
        outputs: dict[str, str] = {}

        d = _backend_main._require(doc_id)
        doc = d["doc"]

        # Render fresh slide PNGs into the build output dir when the formats
        # that need them are requested (png_zip / html). For freshly-minted
        # blank docs the in-memory bridge_paths is empty, so we always render
        # if there's no existing snapshot.
        bridge_paths: list[str] = list(d.get("bridge_paths") or [])
        if ("png_zip" in valid_formats or "html" in valid_formats) and (
            not bridge_paths or any(not Path(p).exists() for p in bridge_paths)
        ):
            try:
                from percy.diagnostics.render_png import render_bridge_slides as _render
                bridge_paths = [str(p) for p in _render(doc, outputs_dir / "_slides")]
            except Exception as e:
                log.warning("on-demand PNG render failed: %s", e)

        # Always rebuild the .pptx as the canonical artifact (other exports come from it)
        from percy.diagnostics.rebuild import rebuild_pptx as _rebuild_pptx
        pptx_path = outputs_dir / f"{project['name'].replace(' ', '_')}.pptx"
        _rebuild_pptx(doc, str(pptx_path))

        if "pptx" in valid_formats:
            outputs["pptx"] = str(pptx_path.resolve())

        # PDF — uses LibreOffice/soffice via the existing export-pdf flow.
        if "pdf" in valid_formats:
            try:
                from app.backend.main import export_pdf as _export_pdf  # type: ignore
                # Reuse the helper indirectly: write to a temp file by hitting the same
                # converter the endpoint uses. The endpoint itself returns a Response
                # so we replicate its core (LibreOffice headless conversion).
                import subprocess as _subprocess
                pdf_path = outputs_dir / f"{project['name'].replace(' ', '_')}.pdf"
                _subprocess.run([
                    "soffice", "--headless", "--convert-to", "pdf",
                    "--outdir", str(outputs_dir), str(pptx_path),
                ], capture_output=True, timeout=120)
                # soffice writes <stem>.pdf to outdir
                produced = outputs_dir / (pptx_path.stem + ".pdf")
                if produced.exists():
                    if produced != pdf_path:
                        produced.rename(pdf_path)
                    outputs["pdf"] = str(pdf_path.resolve())
            except Exception as e:
                log.warning("PDF export failed: %s", e)

        # PNG zip — render every slide PNG and bundle.
        if "png_zip" in valid_formats:
            try:
                import zipfile as _zipfile
                zip_path = outputs_dir / f"{project['name'].replace(' ', '_')}-png.zip"
                with _zipfile.ZipFile(zip_path, "w", _zipfile.ZIP_DEFLATED) as zf:
                    for i, p in enumerate(bridge_paths, start=1):
                        if Path(p).exists():
                            zf.write(p, arcname=f"slide-{i:03d}.png")
                outputs["png_zip"] = str(zip_path.resolve())
            except Exception as e:
                log.warning("PNG zip export failed: %s", e)

        # HTML — copy a basic slideshow HTML next to the PPTX
        if "html" in valid_formats:
            try:
                html_path = outputs_dir / f"{project['name'].replace(' ', '_')}.html"
                slides_html = "\n".join(
                    f'<div class="slide"><img src="slide-{i:03d}.png" alt="Slide {i}"></div>'
                    for i, _ in enumerate(bridge_paths, start=1)
                )
                html_path.write_text(
                    "<!doctype html><html><head><meta charset='utf-8'><title>" + project["name"] + "</title>"
                    "<style>body{margin:0;background:#0a0a0a;color:#f5f5f0;font-family:Inter,sans-serif} "
                    ".slide{width:100%;max-width:1280px;margin:24px auto;border:1px solid rgba(255,255,255,.1)} "
                    ".slide img{display:block;width:100%;height:auto}</style>"
                    "</head><body>" + slides_html + "</body></html>",
                    encoding="utf-8",
                )
                outputs["html"] = str(html_path.resolve())
            except Exception as e:
                log.warning("HTML export failed: %s", e)

        # Markdown outline
        if "markdown" in valid_formats:
            try:
                md_lines: list[str] = [f"# {project['name']}", ""]
                for sl in doc.slides:
                    md_lines.append(f"## Slide {sl.slide_number}")
                    for el in sl.elements:
                        et = el.element_type
                        if et == "BridgeText":
                            text = (getattr(el, "text_content", None) or "").strip()
                            if text:
                                md_lines.append(text)
                                md_lines.append("")
                        elif et == "BridgeChart":
                            md_lines.append(f"_[Chart: {getattr(el, 'chart_type', '?')}]_")
                            md_lines.append("")
                    md_lines.append("")
                md_path = outputs_dir / f"{project['name'].replace(' ', '_')}.md"
                md_path.write_text("\n".join(md_lines), encoding="utf-8")
                outputs["markdown"] = str(md_path.resolve())
            except Exception as e:
                log.warning("Markdown export failed: %s", e)

        # .percy bundle — pickle the PercyDocument
        if "percy" in valid_formats:
            try:
                import pickle as _pickle
                percy_path = outputs_dir / f"{project['name'].replace(' ', '_')}.percy"
                with percy_path.open("wb") as f:
                    _pickle.dump(doc, f)
                outputs["percy"] = str(percy_path.resolve())
            except Exception as e:
                log.warning("Percy bundle export failed: %s", e)

        finished = _time.time()
        elapsed_ms = int((finished - started) * 1000)
        slide_count = len(doc.slides)
        elem_count = sum(len(s.elements) for s in doc.slides)
        summary = f"{slide_count} slides · {elem_count} elements · {len(outputs)}/{len(valid_formats)} format(s)"
        auth_db.update_build(
            build["id"],
            status="success",
            outputs=outputs,
            summary=summary,
            finished_at=int(finished),
            elapsed_ms=elapsed_ms,
        )
        log.info("studio: build %s ok in %dms (%s)", build["id"], elapsed_ms, summary)
        return auth_db.get_build(build["id"])
    except Exception as e:
        finished = _time.time()
        elapsed_ms = int((finished - started) * 1000)
        log.error("studio: build %s failed: %s", build["id"], e)
        auth_db.update_build(
            build["id"],
            status="failed",
            error=str(e),
            finished_at=int(finished),
            elapsed_ms=elapsed_ms,
        )
        return auth_db.get_build(build["id"])


class UpdateScheduleRequest(BaseModel):
    schedule: str | None = None  # "on_demand" | "daily" | "weekly" | "monthly" | None


@router.patch("/api/projects/{project_id}/schedule")
def update_schedule(request: Request, project_id: str, req: UpdateScheduleRequest):
    """Set the refresh schedule on a project (no actual cron yet — phase 2)."""
    user = auth.require_user(request)
    _project_with_org_check(user, project_id)
    valid = {None, "on_demand", "daily", "weekly", "monthly"}
    if req.schedule not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid schedule. Pick from: {valid}")
    return auth_db.update_project(project_id, schedule=req.schedule)


# ── Templates ────────────────────────────────────────────────────────────────
#
# A template is a reusable brand/style profile. It belongs to an org with a
# scope: "user" (private to its owner), "team" (visible across the team org),
# or "org" (alias of team for now; reserved for future org-wide templates).
#
# A template is "extracted" from one or more attached source projects: we walk
# their Bridge models and pull out colors, fonts, chart styles, table styles —
# producing a JSON brand profile the AI can later use to create or restyle
# decks. This is the foundation of the team-memory vision in the pitch.

class CreateTemplateRequest(BaseModel):
    name: str
    description: str | None = None
    scope: str = "user"   # "user" | "team" | "org"


@router.get("/api/orgs/{org_id}/templates")
def list_templates(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    return {"templates": auth_db.list_org_templates(org_id, viewer_id=user["id"])}


@router.post("/api/orgs/{org_id}/templates")
def create_template(request: Request, org_id: str, req: CreateTemplateRequest):
    user = auth.require_user(request)
    org = _require_org_member(user, org_id)
    if req.scope not in ("user", "team", "org"):
        raise HTTPException(400, "Invalid scope; expected 'user', 'team', or 'org'")
    # team/org scope only allowed in actual team orgs
    if req.scope in ("team", "org") and org["kind"] != "team":
        raise HTTPException(400, "Team-scoped templates require a team workspace")
    return auth_db.create_template(
        org_id, scope=req.scope, owner_id=user["id"],
        name=req.name, description=req.description,
    )


def _can_view_template(user: dict[str, Any], tpl: dict[str, Any]) -> bool:
    if not tpl: return False
    # User-scope: only the owner can view
    if tpl["scope"] == "user" and tpl["owner_id"] != user["id"]:
        return False
    # Team/org scope: any member of the org can view
    return auth_db.get_membership(user["id"], tpl["org_id"]) is not None


def _can_edit_template(user: dict[str, Any], tpl: dict[str, Any]) -> bool:
    if not tpl: return False
    # User-scope: only the owner edits
    if tpl["scope"] == "user":
        return tpl["owner_id"] == user["id"]
    # Team/org scope: org admins/owners + the template owner
    if tpl["owner_id"] == user["id"]:
        return True
    m = auth_db.get_membership(user["id"], tpl["org_id"])
    return bool(m and m["role"] in ("owner", "admin"))


@router.get("/api/templates/{template_id}")
def get_template(request: Request, template_id: str):
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_view_template(user, tpl):
        raise HTTPException(404, "Template not found")
    return tpl


class UpdateTemplateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


@router.patch("/api/templates/{template_id}")
def update_template(request: Request, template_id: str, req: UpdateTemplateRequest):
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_edit_template(user, tpl):
        raise HTTPException(403, "Cannot edit this template")
    fields: dict[str, Any] = {}
    if req.name is not None:        fields["name"] = req.name
    if req.description is not None: fields["description"] = req.description
    if not fields:
        return tpl
    return auth_db.update_template(template_id, **fields)


@router.delete("/api/templates/{template_id}")
def delete_template(request: Request, template_id: str):
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_edit_template(user, tpl):
        raise HTTPException(403, "Cannot delete this template")
    auth_db.delete_template(template_id)
    return {"ok": True}


class AttachProjectRequest(BaseModel):
    project_id: str


@router.post("/api/templates/{template_id}/attach-project")
def attach_project(request: Request, template_id: str, req: AttachProjectRequest):
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_edit_template(user, tpl):
        raise HTTPException(403, "Cannot edit this template")
    project = auth_db.get_project(req.project_id)
    if not project or project["org_id"] != tpl["org_id"]:
        raise HTTPException(404, "Project not in this template's org")
    sources = list(tpl.get("source_project_ids", []))
    if req.project_id not in sources:
        sources.append(req.project_id)
    return auth_db.update_template(template_id, source_project_ids=sources)


@router.post("/api/templates/{template_id}/detach-project")
def detach_project(request: Request, template_id: str, req: AttachProjectRequest):
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_edit_template(user, tpl):
        raise HTTPException(403, "Cannot edit this template")
    sources = [pid for pid in tpl.get("source_project_ids", []) if pid != req.project_id]
    return auth_db.update_template(template_id, source_project_ids=sources)


@router.post("/api/templates/{template_id}/extract")
def extract_template_brand(request: Request, template_id: str):
    """Walk every attached source project's Bridge model and pull out:
       - the most-used solid fill colors (top 8)
       - the most-used font families
       - chart style summary (chart types used, axis tick font sizes)
       - table style summary (banded? header? typical font size)
    Stub for now: enough signal to demonstrate the loop. The real version
    will use the parallel agent + a vector index across the corpus."""
    import collections
    user = auth.require_user(request)
    tpl = auth_db.get_template(template_id)
    if not tpl or not _can_edit_template(user, tpl):
        raise HTTPException(403, "Cannot run extraction on this template")
    source_ids = tpl.get("source_project_ids", [])
    if not source_ids:
        raise HTTPException(400, "Attach at least one project before running extraction")

    from app.backend import main as _backend_main  # type: ignore
    color_counter = collections.Counter()
    font_counter  = collections.Counter()
    chart_types   = collections.Counter()
    table_count   = 0
    table_banded  = 0
    table_header  = 0
    title_sizes   = []
    body_sizes    = []
    docs_scanned  = 0

    for pid in source_ids:
        project = auth_db.get_project(pid)
        if not project: continue
        doc_id = project.get("doc_id")
        # Onboard if not loaded
        if (not doc_id or doc_id not in _backend_main._docs) and project.get("doc_source"):
            try:
                result = _backend_main.onboard(_backend_main.OnboardRequest(path=str(project["doc_source"])))
                doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
                if doc_id: auth_db.update_project(pid, doc_id=doc_id)
            except Exception as e:
                log.warning("template extract: onboard failed for %s: %s", pid, e)
                continue
        if not doc_id or doc_id not in _backend_main._docs:
            continue
        d = _backend_main._docs[doc_id]
        doc = d["doc"]
        docs_scanned += 1
        theme = getattr(doc, "theme_colors", None) or {}

        for slide in doc.slides:
            for el in slide.elements:
                # Solid fills
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
                # Fonts (text-bearing elements)
                tf = getattr(el, "text_frame", None)
                if tf:
                    for para in (getattr(tf, "paragraphs", None) or []):
                        for run in (getattr(para, "runs", None) or []):
                            fn = getattr(run, "font_name", None)
                            if fn: font_counter[fn] += 1
                            fs = getattr(run, "font_size", None)
                            if fs and fs > 18: title_sizes.append(fs)
                            elif fs:           body_sizes.append(fs)
                # Charts
                if el.element_type == "BridgeChart":
                    ct = getattr(el, "chart_type", None)
                    if ct: chart_types[ct] += 1
                # Tables
                if el.element_type == "BridgeTable":
                    table_count += 1
                    tp = getattr(el, "table_properties", None)
                    if tp:
                        if getattr(tp, "banded_rows", False): table_banded += 1
                        if getattr(tp, "first_row_header", False): table_header += 1

    def _avg(xs): return round(sum(xs) / len(xs), 1) if xs else None

    brand = {
        "colors":       [{"hex": c, "count": n} for c, n in color_counter.most_common(8)],
        "fonts":        [{"name": f, "count": n} for f, n in font_counter.most_common(5)],
        "chart_types":  [{"type": t, "count": n} for t, n in chart_types.most_common()],
        "table_summary": {
            "count":              table_count,
            "banded_rows_pct":    round(100 * table_banded / table_count, 1) if table_count else 0,
            "first_row_header_pct": round(100 * table_header / table_count, 1) if table_count else 0,
        },
        "typography": {
            "avg_title_size": _avg(title_sizes),
            "avg_body_size":  _avg(body_sizes),
        },
        "docs_scanned":  docs_scanned,
        "elements_scanned_count_marker": sum(color_counter.values()) + sum(font_counter.values()),
    }
    auth_db.update_template(template_id, brand=brand, last_extracted_at=int(_time.time()))
    return auth_db.get_template(template_id)


class UpdateOrgRequest(BaseModel):
    name: str | None = None


@router.patch("/api/orgs/{org_id}")
def update_org(request: Request, org_id: str, req: UpdateOrgRequest):
    user = auth.require_user(request)
    _require_org_admin(user, org_id)
    fields: dict[str, Any] = {}
    if req.name is not None:
        fields["name"] = req.name
    if not fields:
        return auth_db.get_org(org_id)
    return auth_db.update_org(org_id, **fields)


# ── Folders ──────────────────────────────────────────────────────────────────

@router.get("/api/orgs/{org_id}/folders")
def list_folders(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    return {"folders": auth_db.list_org_folders(org_id)}


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None


@router.post("/api/orgs/{org_id}/folders")
def create_folder(request: Request, org_id: str, req: CreateFolderRequest):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    if req.parent_id:
        parent = auth_db.get_folder(req.parent_id)
        if not parent or parent["org_id"] != org_id:
            raise HTTPException(status_code=400, detail="Parent folder not in this org")
    f = auth_db.create_folder(org_id, req.name, req.parent_id, user["id"])
    return f


class RenameFolderRequest(BaseModel):
    name: str


@router.patch("/api/folders/{folder_id}")
def rename_folder(request: Request, folder_id: str, req: RenameFolderRequest):
    user = auth.require_user(request)
    folder = auth_db.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    _require_org_member(user, folder["org_id"])
    auth_db.rename_folder(folder_id, req.name)
    return auth_db.get_folder(folder_id)


@router.delete("/api/folders/{folder_id}")
def delete_folder(request: Request, folder_id: str):
    user = auth.require_user(request)
    folder = auth_db.get_folder(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    _require_org_member(user, folder["org_id"])
    auth_db.delete_folder(folder_id)
    return {"ok": True}


# ── Projects ─────────────────────────────────────────────────────────────────

@router.get("/api/orgs/{org_id}/projects")
def list_projects(request: Request, org_id: str, folder_id: str | None = None, root: bool = False):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    if root:
        return {"projects": auth_db.list_org_projects(org_id, folder_id=None)}
    if folder_id:
        return {"projects": auth_db.list_org_projects(org_id, folder_id=folder_id)}
    return {"projects": auth_db.list_org_projects(org_id)}


class CreateProjectRequest(BaseModel):
    org_id: str
    name: str
    folder_id: str | None = None
    doc_source: str | None = None  # workspace file path, optional


@router.post("/api/projects")
def create_project(request: Request, req: CreateProjectRequest):
    user = auth.require_user(request)
    _require_org_member(user, req.org_id)
    if req.folder_id:
        folder = auth_db.get_folder(req.folder_id)
        if not folder or folder["org_id"] != req.org_id:
            raise HTTPException(status_code=400, detail="Folder not in this org")
    p = auth_db.create_project(
        req.org_id, req.name,
        folder_id=req.folder_id,
        doc_source=req.doc_source,
        created_by=user["id"],
    )
    return p


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    folder_id: str | None = None  # use empty string "" to move to root
    doc_source: str | None = None
    doc_id: str | None = None     # set when attaching a freshly-minted blank doc


@router.patch("/api/projects/{project_id}")
def update_project(request: Request, project_id: str, req: UpdateProjectRequest):
    user = auth.require_user(request)
    project = _project_with_org_check(user, project_id)
    fields: dict[str, Any] = {}
    if req.name is not None:
        fields["name"] = req.name
    if req.folder_id is not None:
        if req.folder_id == "":
            fields["folder_id"] = None
        else:
            folder = auth_db.get_folder(req.folder_id)
            if not folder or folder["org_id"] != project["org_id"]:
                raise HTTPException(status_code=400, detail="Folder not in this project's org")
            fields["folder_id"] = req.folder_id
    if req.doc_source is not None:
        fields["doc_source"] = req.doc_source
    if req.doc_id is not None:
        fields["doc_id"] = req.doc_id
    return auth_db.update_project(project_id, **fields)


@router.delete("/api/projects/{project_id}")
def delete_project(request: Request, project_id: str):
    user = auth.require_user(request)
    _project_with_org_check(user, project_id)
    auth_db.delete_project(project_id)
    return {"ok": True}


# ── Project upload + open ────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/upload")
async def upload_project_file(request: Request, project_id: str, file: UploadFile = File(...)):
    """Upload a .pptx (or .pdf) and attach it to the project as doc_source."""
    user = auth.require_user(request)
    project = _project_with_org_check(user, project_id)

    # Save to a per-project location under the workspace tree
    target_dir = Path("uploads") / "projects" / project_id
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "uploaded").suffix or ".pptx"
    target = target_dir / f"source{suffix}"
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    auth_db.update_project(project_id, doc_source=str(target.resolve()), doc_id=None)
    return {"ok": True, "doc_source": str(target.resolve())}


@router.post("/api/projects/{project_id}/open")
def open_project(request: Request, project_id: str):
    """Onboard the project's source if not already loaded; return the active doc_id."""
    user = auth.require_user(request)
    project = _project_with_org_check(user, project_id)

    # Lazy-import host helpers to avoid a circular import at module load.
    from app.backend import main as _backend_main  # type: ignore

    doc_id = project.get("doc_id")
    if doc_id and doc_id in _backend_main._docs:
        return {"doc_id": doc_id, "project": project}

    src = project.get("doc_source")
    if not src:
        # Brand-new project with no source — mint a blank PercyDocument so the
        # studio has something to open. Canvas size comes from the project's
        # blank_canvas custom-properties dict (set when the project was
        # created via the "scratch" mode of the new-project modal); falls back
        # to 16:9 default.
        from app.backend.main import (  # type: ignore
            CreateBlankDocRequest as _CreateBlankDocRequest,
            create_blank_doc as _create_blank_doc,
        )
        meta = project.get("custom_properties") or {}
        canvas = (meta.get("blank_canvas") if isinstance(meta, dict) else None) or {}
        try:
            width  = float(canvas.get("width_in"))  if canvas.get("width_in")  is not None else 13.333
            height = float(canvas.get("height_in")) if canvas.get("height_in") is not None else 7.5
        except (TypeError, ValueError):
            width, height = 13.333, 7.5
        result = _create_blank_doc(_CreateBlankDocRequest(
            width_in=width, height_in=height, name=project["name"],
        ))
        doc_id = result["doc_id"]
        auth_db.update_project(project_id, doc_id=doc_id)
        return {"doc_id": doc_id, "project": auth_db.get_project(project_id)}

    src_path = Path(src)
    if not src_path.exists():
        raise HTTPException(status_code=404, detail=f"Source file not found: {src}")

    # Run the onboarding pipeline via the existing endpoint handler
    result = _backend_main.onboard(_backend_main.OnboardRequest(path=str(src_path)))
    doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
    if not doc_id:
        raise HTTPException(status_code=500, detail="Onboarding failed: no doc_id returned")

    auth_db.update_project(project_id, doc_id=doc_id)
    return {"doc_id": doc_id, "project": auth_db.get_project(project_id)}
