"""HTTP routes for templates + materials.

Endpoints:
  GET    /api/agent/templates                          — list (filter by category)
  GET    /api/agent/templates/{id}                     — get one
  POST   /api/agent/templates                          — create user template
  DELETE /api/agent/templates/{id}                     — delete (user templates only)
  POST   /api/agent/templates/{id}/apply               — materialize on a slide
  GET    /api/agent/templates/search                   — keyword search

  POST   /api/docs/{doc_id}/materials                  — upload (multipart)
  GET    /api/docs/{doc_id}/materials                  — list
  GET    /api/docs/{doc_id}/materials/{id}             — get
  PATCH  /api/docs/{doc_id}/materials/{id}             — toggle usable_as_starter
  DELETE /api/docs/{doc_id}/materials/{id}             — delete
  POST   /api/agent/retrieve_chunks                    — keyword retrieval
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from percy.agent import materials, templates
from percy.agent.script_api import Studio

log = logging.getLogger(__name__)
router = APIRouter()


# ── Templates ───────────────────────────────────────────────────────────────


@router.get("/api/agent/templates")
async def list_templates_route(category: str | None = None):
    return {"templates": templates.list_templates(category=category)}


@router.get("/api/agent/templates/search")
async def search_templates_route(q: str = "", limit: int = 5):
    return {"templates": templates.search_templates(q, top_k=limit)}


@router.get("/api/agent/templates/{template_id}")
async def get_template_route(template_id: str):
    t = templates.get_template(template_id)
    if not t:
        raise HTTPException(404, f"template {template_id!r} not found")
    return t


@router.post("/api/agent/templates")
async def create_template_route(request: Request):
    body = await _parse_json(request)
    t = templates.Template(
        id=body.get("id", ""),
        name=body["name"], description=body.get("description", ""),
        category=body.get("category", "User"),
        tags=list(body.get("tags") or []),
        inputs_schema=dict(body.get("inputs_schema") or {}),
        sample_inputs=dict(body.get("sample_inputs") or {}),
        layout=list(body.get("layout") or []),
        slide_script=body.get("slide_script"),
        connects=dict(body.get("connects") or {}),
        is_builtin=False,
    )
    tid = templates.save_template(t)
    return {"id": tid, "ok": True}


@router.delete("/api/agent/templates/{template_id}")
async def delete_template_route(template_id: str):
    ok = templates.delete_template(template_id)
    if not ok:
        raise HTTPException(404, "template not found or is builtin (cannot delete)")
    return {"ok": True}


@router.post("/api/docs/{doc_id}/slides/{n}/save-as-template")
async def save_slide_as_template(doc_id: str, n: int, request: Request):
    """Capture the current slide state as a new user template.

    Body:
      {
        name: str,
        description?: str,
        category?: str (default 'User'),
        tags?: list[str],
        include_connects?: bool (default true),
        include_slide_script?: bool (default true),
        inputs_schema?: dict,    # optional — declare parameterizable inputs
      }

    Strategy:
      * Walk slide.elements
      * For each element, serialize its position + display fields into a
        ``{kind, alias, body}`` layout entry mirroring what the create_*
        endpoints accept
      * Connects (if include_connects) → {alias: script}
      * Slide script (if include_slide_script) → top-level
      * Live groups → preserved as 'live-group' entries with their generator
    """
    body = await _parse_json(request)
    name = body.get("name")
    if not name:
        raise HTTPException(400, "name is required")

    from app.backend import main as _m
    d = _m._require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"slide {n} not found")

    layout, connects = _slide_to_layout(slide,
                                         include_connects=bool(body.get("include_connects", True)))

    slide_script = None
    if body.get("include_slide_script", True):
        slide_script = getattr(slide, "script", None)

    user = getattr(request.state, "user", None)
    category = body.get("category") or ("User" if not user else f"User:{user.get('id', '')[:8]}")

    t = templates.Template(
        id="",
        name=name,
        description=body.get("description") or f"Saved from slide {n} of {doc_id}",
        category=category,
        tags=list(body.get("tags") or []),
        inputs_schema=dict(body.get("inputs_schema") or {}),
        sample_inputs=dict(body.get("sample_inputs") or {}),
        layout=layout,
        slide_script=slide_script,
        connects=connects,
        is_builtin=False,
    )
    tid = templates.save_template(t)
    log.info("save_slide_as_template: created %s from slide %d (%d elements, %d connects)",
             tid, n, len(layout), len(connects))
    return {"ok": True, "id": tid, "name": name, "elements": len(layout), "connects": len(connects)}


def _slide_to_layout(slide, *, include_connects: bool) -> tuple[list[dict], dict[str, str]]:
    """Convert a BridgeSlide into a template layout list."""
    from percy.bridge.elements import (
        BridgeChart, BridgeConnector, BridgeFreeform, BridgeGroup,
        BridgeImage, BridgeShape, BridgeTable, BridgeText,
    )
    layout: list[dict] = []
    connects: dict[str, str] = {}

    for idx, el in enumerate(slide.elements or []):
        ident = getattr(el, "identification", None)
        name = (getattr(ident, "shape_name", None) if ident else None) or f"el_{idx}"
        # Slugify name → alias
        import re as _re
        alias = _re.sub(r"[^A-Za-z0-9_]", "_", name).lower().strip("_")[:40] or f"el_{idx}"

        body, kind = _element_to_create_body(el)
        if not body:
            continue
        layout.append({"kind": kind, "alias": alias, "body": body})

        # Capture connect script if present
        if include_connects:
            cp = getattr(el, "custom_properties", None) or {}
            connect = (cp.get("connect") or {}).get("script")
            if connect:
                connects[alias] = connect

    return layout, connects


def _element_to_create_body(el) -> tuple[dict, str]:
    """Best-effort recipe for re-creating an element via a create_* endpoint."""
    from percy.bridge.elements import (
        BridgeChart, BridgeConnector, BridgeFreeform, BridgeGroup,
        BridgeImage, BridgeShape, BridgeTable, BridgeText,
    )
    pos = el.position
    base_pos = {
        "left_in":   round(pos.left, 4), "top_in":    round(pos.top, 4),
        "width_in":  round(pos.width, 4), "height_in": round(pos.height, 4),
    }
    name = (el.identification.shape_name if el.identification else None) or el.element_type

    if isinstance(el, BridgeShape):
        # Reconstruct text + style
        text = ""
        if el.text_content and el.text_content.paragraphs:
            runs = el.text_content.paragraphs[0].runs or []
            text = runs[0].text if runs else ""
        is_text_box = (el.fill.fill_type or "none") == "none" and bool(text)
        body = {
            "geometry_preset": el.shape_identification.geometry_preset or "rect",
            "position": base_pos,
            "name": name,
        }
        if is_text_box:
            body["text_box"] = True
        if el.fill.color is not None:
            body["fill_color"] = el.fill.color.value
        if text:
            body["text"] = text
        return body, "shape"

    if isinstance(el, BridgeText):
        text = ""
        if el.paragraphs and el.paragraphs[0].runs:
            text = el.paragraphs[0].runs[0].text
        return {"text": text, "position": base_pos, "name": name}, "text"

    if isinstance(el, BridgeChart):
        # Preserve the full styling captured on the source slide: per-series
        # colors, legend visibility/position/font, axis visibility + gridline
        # color, title formatting, plot properties (hole_size for donuts,
        # bar_width_ratio for columns, vary_colors for pies). The agent only
        # supplies new categories/series/title at apply time; everything
        # else stays brand-faithful.
        def _hex(spec) -> str | None:
            if spec is None:
                return None
            for k in ("rgb", "value", "hex"):
                v = getattr(spec, k, None)
                if isinstance(v, str) and v.startswith("#"):
                    return v
            return None

        series_out: list[dict[str, Any]] = []
        for i, s in enumerate(el.series):
            entry: dict[str, Any] = {
                "name": s.name or f"Series {i+1}",
                "values": list(s.values or []),
            }
            sc = _hex(s.color)
            if sc:
                entry["color"] = sc
            if s.line and _hex(s.line.color):
                entry["line"] = {"color": _hex(s.line.color)}
            if s.data_labels and s.data_labels.show:
                entry["data_labels"] = {"show": True, "number_format": s.data_labels.number_format}
            series_out.append(entry)

        leg = el.legend or None
        legend_intent = None
        if leg:
            legend_intent = {
                "visible": bool(leg.visible),
                "position": (leg.position or "bottom").lower(),
            }
            if leg.font_size: legend_intent["font_size"] = leg.font_size

        title_color = _hex(getattr(el.title, "title_font_color", None))
        title_intent = None
        if el.title and (el.title.title or title_color or el.title.title_font_size):
            title_intent = {"text": el.title.title or ""}
            if title_color: title_intent["color"] = title_color
            if el.title.title_font_size: title_intent["font_size"] = el.title.title_font_size
            if el.title.title_font_bold is not None: title_intent["bold"] = bool(el.title.title_font_bold)

        cat_grid = _hex(getattr(getattr(el, "category_axis", None), "gridlines", None) and el.category_axis.gridlines.gridline_color)
        val_grid = _hex(getattr(getattr(el, "value_axis", None), "gridlines", None) and el.value_axis.gridlines.gridline_color)
        cat_axis = {"gridlines": bool(getattr(getattr(el, "category_axis", None), "gridlines", None) and el.category_axis.gridlines.has_major_gridlines)}
        if cat_grid: cat_axis["gridline_color"] = cat_grid
        val_axis = {"gridlines": bool(getattr(getattr(el, "value_axis", None), "gridlines", None) and el.value_axis.gridlines.has_major_gridlines)}
        if val_grid: val_axis["gridline_color"] = val_grid

        body: dict[str, Any] = {
            "chart_type": el.chart_type or "column_clustered",
            "categories": list(el.categories.categories or []),
            "series": series_out,
            "position": base_pos,
            "name": name,
        }
        if title_intent: body["title"] = title_intent
        if legend_intent: body["legend"] = legend_intent
        if cat_axis: body["category_axis"] = cat_axis
        if val_axis: body["value_axis"] = val_axis
        pp = el.plot_properties
        if pp:
            if pp.hole_size is not None:        body["hole_size"] = pp.hole_size
            if pp.bar_width_ratio is not None:  body["bar_width_ratio"] = pp.bar_width_ratio
            if pp.vary_colors is not None:      body["vary_colors"] = bool(pp.vary_colors)
        return body, "chart"

    if isinstance(el, BridgeTable):
        # Preserve as much table styling as build_table understands:
        # column widths + row heights (so the prototype's layout proportions
        # survive), first-row/col headers, banded rows, totals row.
        col_widths = []
        row_heights = []
        try:
            col_widths = list(getattr(el, "column_widths", []) or [])
            row_heights = list(getattr(el, "row_heights", []) or [])
        except Exception:
            pass
        body: dict[str, Any] = {
            "data": [list(r) for r in (el.data or [])],
            "first_row_header": bool(el.table_properties.first_row_header),
            "banded_rows":      bool(el.table_properties.banded_rows),
            "first_col_header": bool(getattr(el.table_properties, "first_col_header", False)),
            "last_row_total":   bool(getattr(el.table_properties, "last_row_total", False)),
            "position": base_pos,
            "name": name,
        }
        if col_widths: body["column_widths"] = col_widths
        if row_heights: body["row_heights"] = row_heights
        return body, "table"

    if isinstance(el, BridgeConnector):
        return {
            "connector_type": el.connector_type,
            "start": {"x_in": el.endpoints.start_x, "y_in": el.endpoints.start_y},
            "end":   {"x_in": el.endpoints.end_x,   "y_in": el.endpoints.end_y},
            "name": name,
        }, "connector"

    if isinstance(el, BridgeGroup):
        return {
            "position": base_pos,
            "name": name,
            "generator_script": el.generator_script,
            "generator_inputs": dict(el.generator_inputs or {}),
            "run_on_create": bool(el.generator_script),
        }, "live-group"

    if isinstance(el, BridgeImage):
        # Images can't be recreated from a saved layout (would need the bytes
        # in the template). For v1, skip them.
        return {}, ""

    return {}, ""


@router.post("/api/agent/templates/{template_id}/apply")
async def apply_template_route(template_id: str, request: Request):
    import time as _time
    from percy.agent import audit as _audit

    # Suppress middleware audit; we write a richer row.
    try:
        request.state.audit_handled = True
    except Exception:
        pass

    t0 = _time.time()
    body = await _parse_json(request)
    doc_id = body.get("doc_id")
    slide_n = body.get("slide_n")
    inputs = body.get("inputs") or {}
    if not doc_id or slide_n is None:
        raise HTTPException(400, "doc_id and slide_n are required")

    template = templates.get_template(template_id)
    if not template:
        raise HTTPException(404, f"template {template_id!r} not found")

    # Snapshot before applying.
    from app.backend import main as _m
    _m._snapshot_doc(doc_id)
    snapshot_index = len((_m._docs.get(doc_id) or {}).get("_undo_stack") or []) - 1

    user = getattr(request.state, "user", None)
    actor = "agent" if request.headers.get("X-Percy-Actor", "").lower() == "agent" else ("human" if user else "system")

    studio = Studio(
        base_url=f"{request.url.scheme}://{request.url.netloc}",
        doc_id=doc_id,
        auth_token=request.cookies.get("percy_session"),
        timeout_s=30,
        asgi_app=request.app,
    )

    result = templates.apply_template(template, studio=studio, slide_n=int(slide_n), inputs=inputs)

    # Invalidate the find_element index — we just changed the slide.
    try:
        from app.backend.agent_find import invalidate_index
        invalidate_index(doc_id)
    except Exception:
        pass

    _audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=doc_id, slide_n=int(slide_n),
        actor=actor, source="template_apply",
        method="POST", path=str(request.url.path),
        kind="apply_template",
        prompt=f"Apply template '{template['name']}' (id={template_id}) with inputs={list(inputs.keys())}",
        plan={"template_id": template_id, "inputs": inputs, "layout_count": len(template.get("layout") or [])},
        response={"elements": result.get("elements"), "errors": result.get("errors")},
        status="executed" if result.get("ok") else "failed",
        error=("; ".join(result.get("errors") or []) or result.get("error")) if not result.get("ok") else None,
        snapshot_index=snapshot_index,
        affected_count=len(result.get("elements") or []),
        elapsed_ms=int((_time.time() - t0) * 1000),
    )

    return result


# ── Materials ───────────────────────────────────────────────────────────────


@router.post("/api/docs/{doc_id}/materials")
async def upload_material_route(doc_id: str, file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "uploaded file is empty")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "file too large (limit 10MB)")
    return materials.upload_material(doc_id, file.filename or "unnamed", raw)


@router.get("/api/docs/{doc_id}/materials")
async def list_materials_route(doc_id: str):
    return {"materials": materials.list_materials(doc_id)}


@router.get("/api/docs/{doc_id}/materials/{material_id}")
async def get_material_route(doc_id: str, material_id: str):
    m = materials.get_material(material_id)
    if not m or m["doc_id"] != doc_id:
        raise HTTPException(404, "material not found")
    return m


@router.patch("/api/docs/{doc_id}/materials/{material_id}")
async def patch_material_route(doc_id: str, material_id: str, request: Request):
    body = await _parse_json(request)
    if "usable_as_starter" in body:
        ok = materials.set_starter_flag(material_id, bool(body["usable_as_starter"]))
        if not ok:
            raise HTTPException(404, "material not found")
        return {"ok": True}
    return {"ok": False, "error": "no recognized field to patch"}


@router.delete("/api/docs/{doc_id}/materials/{material_id}")
async def delete_material_route(doc_id: str, material_id: str):
    ok = materials.delete_material(material_id)
    if not ok:
        raise HTTPException(404, "material not found")
    return {"ok": True}


@router.post("/api/agent/retrieve_chunks")
async def retrieve_chunks_route(request: Request):
    body = await _parse_json(request)
    doc_id = body.get("doc_id")
    query = body.get("query", "")
    top_k = int(body.get("top_k", 5))
    only_starter = bool(body.get("only_starter", False))
    if not doc_id:
        raise HTTPException(400, "doc_id is required")
    chunks = materials.retrieve_chunks(doc_id, query, top_k=top_k, only_starter=only_starter)
    return {"chunks": chunks, "considered": len(chunks)}


# ── Setup ───────────────────────────────────────────────────────────────────


async def _parse_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def register_templates_router(app) -> None:
    templates.init_db()
    materials.init_db()
    app.include_router(router)
    log.info("agent_templates: registered template + materials routes")
