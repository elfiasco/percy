"""Doc-lifecycle CRUD routes — extracted from main.py.

Handles:
  * Slides CRUD (add, delete, duplicate, reorder, move, bulk variants)
  * Slide metadata (background, hidden, pin, rating, notes, labels, tag,
    transition, section)
  * Undo / redo and named snapshots

Register with: `register_docs_core_router(app)` from main.py.
"""
from __future__ import annotations

import logging
import time
from typing import Any, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

log = logging.getLogger("percy.api")


# ─── Shared helpers wired at registration time ──────────────────────────────
_require: Any = None
_snapshot_doc: Any = None
_get_slide_dims: Any = None
_schedule_cloud_autosave: Any = None
_docs: Any = None


def _resolve_main_helpers() -> None:
    global _require, _snapshot_doc, _get_slide_dims, _schedule_cloud_autosave, _docs
    if _require is not None:
        return
    from app.backend import main as _main
    _require = _main._require
    _snapshot_doc = _main._snapshot_doc
    _get_slide_dims = _main._get_slide_dims
    _schedule_cloud_autosave = _main._schedule_cloud_autosave
    _docs = _main._docs


VALID_TRANSITIONS = {"none", "fade", "slide", "zoom", "flip", "push", "wipe", "dissolve"}
_MAX_NAMED_SNAPSHOTS = 20


# ─── Request models ──────────────────────────────────────────────────────────

class BulkSlideRequest(BaseModel):
    slide_numbers: List[int]


class ReorderSlidesRequest(BaseModel):
    order: List[int]


class SlideNotesUpdate(BaseModel):
    notes_text: str


class SlideLabelUpdate(BaseModel):
    label: str


class SlideTagUpdate(BaseModel):
    color: str | None = None


class SlideTransitionUpdate(BaseModel):
    transition: str = "none"
    duration_ms: int = 500


class SlideSectionUpdate(BaseModel):
    section_name: str = ""


class NamedSnapshotRequest(BaseModel):
    name: str


def _register_routes(app: FastAPI) -> None:

    # ─── Slides CRUD ─────────────────────────────────────────────────────────

    @app.post("/api/docs/{doc_id}/slides")
    def add_slide(doc_id: str, after_n: int = 0):
        """Insert a blank slide after slide *after_n* (0 = append at end)."""
        from percy.bridge.elements import BridgeSlide
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        w, h = _get_slide_dims(doc, doc.slides[0]) if doc.slides else (13.333, 7.5)
        new_slide = BridgeSlide(slide_number=0, elements=[], width=w, height=h)
        if after_n <= 0 or after_n >= len(doc.slides):
            doc.slides.append(new_slide)
            pos = len(doc.slides)
        else:
            doc.slides.insert(after_n, new_slide)
            pos = after_n + 1
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        d["slide_count"] = len(doc.slides)
        log.info("studio: added blank slide at position %d in %s", pos, doc_id)
        return {"slide_count": len(doc.slides), "new_slide_n": pos}


    @app.delete("/api/docs/{doc_id}/slides/{n}")
    def delete_slide(doc_id: str, n: int):
        """Delete slide *n*. Cannot delete the last slide."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        if len(doc.slides) <= 1:
            raise HTTPException(400, "Cannot delete the only slide")
        idx = next((i for i, s in enumerate(doc.slides) if s.slide_number == n), None)
        if idx is None:
            raise HTTPException(404, f"Slide {n} not found")
        doc.slides.pop(idx)
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        d["slide_count"] = len(doc.slides)
        log.info("studio: deleted slide %d from %s", n, doc_id)
        return {"slide_count": len(doc.slides)}


    @app.post("/api/docs/{doc_id}/slides/{n}/duplicate")
    def duplicate_slide(doc_id: str, n: int):
        """Deep-copy slide *n* and insert the copy directly after it."""
        import copy as _copy
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        src = next((s for s in doc.slides if s.slide_number == n), None)
        if src is None:
            raise HTTPException(404, f"Slide {n} not found")
        dup = _copy.deepcopy(src)
        idx = doc.slides.index(src)
        doc.slides.insert(idx + 1, dup)
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        new_n = dup.slide_number
        log.info("studio: duplicated slide %d → %d in %s", n, new_n, doc_id)
        return {"slide_count": len(doc.slides), "new_slide_n": new_n}


    @app.post("/api/docs/{doc_id}/slides/bulk-delete")
    def bulk_delete_slides(doc_id: str, req: BulkSlideRequest):
        """Delete multiple slides at once by their slide numbers (sorted descending)."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        to_delete = sorted(set(req.slide_numbers), reverse=True)
        for n in to_delete:
            slide = next((s for s in doc.slides if s.slide_number == n), None)
            if slide:
                doc.slides.remove(slide)
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        if not doc.slides:
            raise HTTPException(400, "Cannot delete all slides")
        return {"slide_count": len(doc.slides)}


    @app.post("/api/docs/{doc_id}/slides/bulk-duplicate")
    def bulk_duplicate_slides(doc_id: str, req: BulkSlideRequest):
        """Duplicate multiple slides, inserting copies after each original (in order)."""
        import copy as _copy
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        new_slides = []
        offset = 0
        for n in sorted(set(req.slide_numbers)):
            actual_n = n + offset
            src = next((s for s in doc.slides if s.slide_number == actual_n), None)
            if src is None:
                continue
            dup = _copy.deepcopy(src)
            idx = doc.slides.index(src)
            doc.slides.insert(idx + 1, dup)
            offset += 1
            for i, s in enumerate(doc.slides):
                s.slide_number = i + 1
            new_slides.append(dup.slide_number)
        return {"slide_count": len(doc.slides), "new_slide_numbers": new_slides}


    @app.post("/api/docs/{doc_id}/slides/reorder")
    def reorder_slides(doc_id: str, req: ReorderSlidesRequest):
        """Reorder slides to the given order."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        by_n = {s.slide_number: s for s in doc.slides}
        if set(req.order) != set(by_n.keys()):
            raise HTTPException(400, "order must contain exactly all current slide numbers")
        doc.slides = [by_n[n] for n in req.order]
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        return {"slide_count": len(doc.slides)}


    @app.patch("/api/docs/{doc_id}/slides/{n}/move")
    def move_slide(doc_id: str, n: int, to_n: int):
        """Move slide *n* to position *to_n* (1-based)."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        if not (1 <= to_n <= len(doc.slides)):
            raise HTTPException(400, f"to_n={to_n} out of range 1..{len(doc.slides)}")
        idx = next((i for i, s in enumerate(doc.slides) if s.slide_number == n), None)
        if idx is None:
            raise HTTPException(404, f"Slide {n} not found")
        slide = doc.slides.pop(idx)
        doc.slides.insert(to_n - 1, slide)
        for i, s in enumerate(doc.slides):
            s.slide_number = i + 1
        log.info("studio: moved slide %d → position %d in %s", n, to_n, doc_id)
        return {"slide_count": len(doc.slides)}


    # ─── Slide metadata ──────────────────────────────────────────────────────

    @app.patch("/api/docs/{doc_id}/slides/{n}/background")
    def set_slide_background(doc_id: str, n: int, color: str | None = None):
        """Set slide background color (hex '#RRGGBB') or clear it (color=null)."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        doc = d["doc"]
        slide = next((s for s in doc.slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        slide.background_color = color
        slide.background_gradient_stops = []
        log.info("studio: set slide %d background to %s in %s", n, color, doc_id)
        return {"background_color": slide.background_color}


    @app.get("/api/docs/{doc_id}/slide-hidden")
    def get_hidden_slides(doc_id: str):
        """Return all slides that are currently hidden."""
        _resolve_main_helpers()
        d = _require(doc_id)
        hidden = [s.slide_number for s in d["doc"].slides if (s.custom_properties or {}).get("hidden")]
        return {"hidden": hidden}


    @app.patch("/api/docs/{doc_id}/slides/{n}/hidden")
    def set_slide_hidden(doc_id: str, n: int, hidden: bool = True):
        """Hide or show a slide in presentation mode."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if slide.custom_properties is None:
            slide.custom_properties = {}
        if hidden:
            slide.custom_properties["hidden"] = True
        else:
            slide.custom_properties.pop("hidden", None)
        return {"slide_n": n, "hidden": hidden}


    @app.get("/api/docs/{doc_id}/slide-pins")
    def get_slide_pins(doc_id: str):
        """Return all slides that are currently pinned."""
        _resolve_main_helpers()
        d = _require(doc_id)
        pinned = [s.slide_number for s in d["doc"].slides if (s.custom_properties or {}).get("pinned")]
        return {"pinned": pinned}


    @app.patch("/api/docs/{doc_id}/slides/{n}/pin")
    def pin_slide(doc_id: str, n: int, pinned: bool = True):
        """Pin or unpin a slide to protect it from accidental deletion or reorder."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if slide.custom_properties is None:
            slide.custom_properties = {}
        if pinned:
            slide.custom_properties["pinned"] = True
        else:
            slide.custom_properties.pop("pinned", None)
        return {"slide_n": n, "pinned": pinned}


    @app.get("/api/docs/{doc_id}/slide-ratings")
    def get_slide_ratings(doc_id: str):
        """Return star ratings (1-5) for all slides that have one set."""
        _resolve_main_helpers()
        d = _require(doc_id)
        ratings: dict[int, int] = {}
        for slide in d["doc"].slides:
            cp = slide.custom_properties or {}
            r = cp.get("slide_rating")
            if r is not None:
                ratings[slide.slide_number] = int(r)
        return {"ratings": ratings}


    @app.patch("/api/docs/{doc_id}/slides/{n}/rating")
    def set_slide_rating(doc_id: str, n: int, rating: int | None = None):
        """Set or clear a 1-5 star rating for a slide."""
        if rating is not None and not (1 <= rating <= 5):
            raise HTTPException(400, "rating must be 1-5 or null")
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if slide.custom_properties is None:
            slide.custom_properties = {}
        if rating is None:
            slide.custom_properties.pop("slide_rating", None)
        else:
            slide.custom_properties["slide_rating"] = rating
        return {"slide_n": n, "rating": rating}


    @app.get("/api/docs/{doc_id}/slides/{n}/notes")
    def get_slide_notes(doc_id: str, n: int):
        """Return speaker notes text for a slide."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        cp = getattr(slide, "custom_properties", None) or {}
        return {"notes_text": cp.get("notes_text", "")}


    @app.patch("/api/docs/{doc_id}/slides/{n}/notes")
    def update_slide_notes(doc_id: str, n: int, req: SlideNotesUpdate):
        """Set (or clear) speaker notes text for a slide."""
        _resolve_main_helpers()
        _snapshot_doc(doc_id)
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        cp = getattr(slide, "custom_properties", None)
        if cp is None:
            slide.custom_properties = {}
            cp = slide.custom_properties
        cp["notes_text"] = req.notes_text
        log.info("studio: updated notes for slide %d of %s", n, doc_id)
        return {"notes_text": req.notes_text}


    @app.get("/api/docs/{doc_id}/slide-labels")
    def get_slide_labels(doc_id: str):
        """Return all slide labels and tag colors keyed by slide number."""
        _resolve_main_helpers()
        d = _require(doc_id)
        labels: dict[str, str] = {}
        tags: dict[str, str]   = {}
        for slide in d["doc"].slides:
            cp = getattr(slide, "custom_properties", None) or {}
            lbl = cp.get("label", "").strip()
            tag = cp.get("tag_color", "").strip()
            if lbl: labels[str(slide.slide_number)] = lbl
            if tag: tags[str(slide.slide_number)]   = tag
        return {"labels": labels, "tags": tags}


    @app.patch("/api/docs/{doc_id}/slides/{n}/label")
    def set_slide_label(doc_id: str, n: int, req: SlideLabelUpdate):
        """Set a display label for slide *n*."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if not hasattr(slide, "custom_properties") or slide.custom_properties is None:
            slide.custom_properties = {}
        slide.custom_properties["label"] = req.label
        log.info("studio: set label for slide %d of %s: %r", n, doc_id, req.label)
        return {"slide_n": n, "label": req.label}


    @app.patch("/api/docs/{doc_id}/slides/{n}/tag")
    def set_slide_tag(doc_id: str, n: int, req: SlideTagUpdate):
        """Set or clear a tag color for slide *n*."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if not hasattr(slide, "custom_properties") or slide.custom_properties is None:
            slide.custom_properties = {}
        if req.color:
            slide.custom_properties["tag_color"] = req.color
        else:
            slide.custom_properties.pop("tag_color", None)
        return {"slide_n": n, "tag_color": req.color}


    @app.patch("/api/docs/{doc_id}/slides/{n}/transition")
    def set_slide_transition(doc_id: str, n: int, req: SlideTransitionUpdate):
        """Set the transition animation for slide n."""
        if req.transition not in VALID_TRANSITIONS:
            raise HTTPException(400, f"Unknown transition {req.transition!r}. Valid: {sorted(VALID_TRANSITIONS)}")
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if not hasattr(slide, "custom_properties") or slide.custom_properties is None:
            slide.custom_properties = {}
        slide.custom_properties["transition"] = req.transition
        slide.custom_properties["transition_duration_ms"] = req.duration_ms
        return {"slide_n": n, "transition": req.transition, "duration_ms": req.duration_ms}


    @app.patch("/api/docs/{doc_id}/slides/{n}/section")
    def set_slide_section(doc_id: str, n: int, req: SlideSectionUpdate):
        """Set or clear a section name on a slide."""
        _resolve_main_helpers()
        d = _require(doc_id)
        slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
        if slide is None:
            raise HTTPException(404, f"Slide {n} not found")
        if not hasattr(slide, "custom_properties") or slide.custom_properties is None:
            slide.custom_properties = {}
        if req.section_name.strip():
            slide.custom_properties["section_name"] = req.section_name.strip()
        else:
            slide.custom_properties.pop("section_name", None)
        return {"slide_n": n, "section_name": req.section_name.strip()}


    # ─── Undo / redo ─────────────────────────────────────────────────────────

    @app.get("/api/docs/{doc_id}/undo-state")
    def get_undo_state(doc_id: str):
        """Return current undo and redo stack depths."""
        _resolve_main_helpers()
        d = _require(doc_id)
        return {
            "undo_depth": len(d.get("_undo_stack", [])),
            "redo_depth": len(d.get("_redo_stack", [])),
        }


    @app.post("/api/docs/{doc_id}/undo")
    def undo(doc_id: str):
        """Restore previous Bridge model snapshot."""
        import pickle as _pickle
        _resolve_main_helpers()
        d = _require(doc_id)
        stack = d.get("_undo_stack", [])
        if not stack:
            raise HTTPException(400, "Nothing to undo")
        redo_stack: list = d.setdefault("_redo_stack", [])
        try:
            redo_stack.append(_pickle.dumps(d["doc"]))
        except Exception:
            pass
        d["doc"] = _pickle.loads(stack.pop())
        d["modified_at"] = time.time()
        _schedule_cloud_autosave(doc_id)
        log.info("undo: %s — %d undo / %d redo remain", doc_id, len(stack), len(redo_stack))
        return {"ok": True, "undo_depth": len(stack), "redo_depth": len(redo_stack)}


    @app.post("/api/docs/{doc_id}/redo")
    def redo_action(doc_id: str):
        """Re-apply the last undone operation."""
        import pickle as _pickle
        _resolve_main_helpers()
        d = _require(doc_id)
        redo_stack = d.get("_redo_stack", [])
        if not redo_stack:
            raise HTTPException(400, "Nothing to redo")
        stack: list = d.setdefault("_undo_stack", [])
        try:
            stack.append(_pickle.dumps(d["doc"]))
        except Exception:
            pass
        d["doc"] = _pickle.loads(redo_stack.pop())
        d["modified_at"] = time.time()
        _schedule_cloud_autosave(doc_id)
        log.info("redo: %s — %d undo / %d redo remain", doc_id, len(stack), len(redo_stack))
        return {"ok": True, "undo_depth": len(stack), "redo_depth": len(redo_stack)}


    # ─── Named snapshots ─────────────────────────────────────────────────────

    @app.post("/api/docs/{doc_id}/snapshots")
    def create_snapshot(doc_id: str, req: NamedSnapshotRequest):
        """Save a named checkpoint of the current document state."""
        import pickle as _pickle
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("doc") is None:
            raise HTTPException(400, "No document loaded")
        name = req.name.strip()
        if not name:
            raise HTTPException(400, "Snapshot name required")
        snap_list: list = d.setdefault("_named_snapshots", [])
        try:
            blob = _pickle.dumps(d["doc"])
        except Exception as exc:
            raise HTTPException(500, f"Could not serialize document: {exc}")
        snap_list.append({
            "id": f"snap_{int(time.time() * 1000)}",
            "name": name,
            "created_at": time.time(),
            "slide_count": len(d["doc"].slides),
            "blob": blob,
        })
        if len(snap_list) > _MAX_NAMED_SNAPSHOTS:
            snap_list.pop(0)
        log.info("snapshot created: %s '%s'", doc_id, name)
        return {"ok": True, "id": snap_list[-1]["id"], "total": len(snap_list)}


    @app.get("/api/docs/{doc_id}/snapshots")
    def list_snapshots(doc_id: str):
        """List all named snapshots for this document."""
        _resolve_main_helpers()
        d = _require(doc_id)
        snap_list: list = d.get("_named_snapshots", [])
        return {
            "snapshots": [
                {"id": s["id"], "name": s["name"], "created_at": s["created_at"], "slide_count": s["slide_count"]}
                for s in snap_list
            ]
        }


    @app.post("/api/docs/{doc_id}/snapshots/{snap_id}/restore")
    def restore_snapshot(doc_id: str, snap_id: str):
        """Restore the document to a named snapshot."""
        import pickle as _pickle
        _resolve_main_helpers()
        d = _require(doc_id)
        snap_list: list = d.get("_named_snapshots", [])
        snap = next((s for s in snap_list if s["id"] == snap_id), None)
        if snap is None:
            raise HTTPException(404, "Snapshot not found")
        _snapshot_doc(doc_id)
        try:
            d["doc"] = _pickle.loads(snap["blob"])
        except Exception as exc:
            raise HTTPException(500, f"Could not restore snapshot: {exc}")
        d["modified_at"] = time.time()
        log.info("snapshot restored: %s '%s'", doc_id, snap["name"])
        return {"ok": True, "name": snap["name"], "slide_count": len(d["doc"].slides)}


    @app.delete("/api/docs/{doc_id}/snapshots/{snap_id}")
    def delete_snapshot(doc_id: str, snap_id: str):
        """Delete a named snapshot."""
        _resolve_main_helpers()
        d = _require(doc_id)
        snap_list: list = d.get("_named_snapshots", [])
        before = len(snap_list)
        d["_named_snapshots"] = [s for s in snap_list if s["id"] != snap_id]
        if len(d["_named_snapshots"]) == before:
            raise HTTPException(404, "Snapshot not found")
        return {"ok": True}


def register_docs_core_router(app: FastAPI) -> None:
    """Register all doc-lifecycle CRUD routes onto the FastAPI app."""
    _register_routes(app)
