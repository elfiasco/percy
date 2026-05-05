"""Slide-level diff narrator.

Compare two PercyDocument snapshots (or pickle blobs from the undo stack)
and produce a structured + natural-language summary of what changed.

Used by:
  * The activity tab to show "what did this action actually change"
  * The refresh agent's post-run summary (Phase 5 — but the diff function
    is shared with this earlier surface)
  * Scheduled report-change detection ("revenue line changed by 12%")

Pure-Python; no LLM required (an LLM can polish the output if available
but the structured diff is deterministic and useful on its own).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ElementChange:
    slide_n:      int
    element_id:   str
    element_type: str | None
    kind:         str   # 'added' | 'removed' | 'modified' | 'moved'
    fields:       dict[str, dict] = field(default_factory=dict)  # {field: {before, after}}

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass(slots=True)
class SlideChange:
    slide_n:      int
    kind:         str   # 'added' | 'removed' | 'modified'
    element_changes: list[ElementChange] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "slide_n": self.slide_n, "kind": self.kind,
            "element_changes": [c.to_dict() for c in self.element_changes],
        }


@dataclass(slots=True)
class DocDiff:
    slides_added:    list[int]
    slides_removed:  list[int]
    slide_changes:   list[SlideChange]

    def to_dict(self) -> dict:
        return {
            "slides_added": self.slides_added,
            "slides_removed": self.slides_removed,
            "slide_changes": [s.to_dict() for s in self.slide_changes],
            "summary": self.short_summary(),
        }

    def short_summary(self) -> str:
        """One-line natural-language summary."""
        parts: list[str] = []
        if self.slides_added:
            parts.append(f"{len(self.slides_added)} slide{'s' if len(self.slides_added) != 1 else ''} added")
        if self.slides_removed:
            parts.append(f"{len(self.slides_removed)} slide{'s' if len(self.slides_removed) != 1 else ''} removed")

        n_added = sum(sum(1 for c in s.element_changes if c.kind == "added") for s in self.slide_changes)
        n_removed = sum(sum(1 for c in s.element_changes if c.kind == "removed") for s in self.slide_changes)
        n_modified = sum(sum(1 for c in s.element_changes if c.kind == "modified") for s in self.slide_changes)

        if n_added: parts.append(f"{n_added} element{'s' if n_added != 1 else ''} added")
        if n_modified: parts.append(f"{n_modified} element{'s' if n_modified != 1 else ''} modified")
        if n_removed: parts.append(f"{n_removed} element{'s' if n_removed != 1 else ''} removed")

        if not parts:
            return "No changes."
        return ", ".join(parts) + "."

    def long_summary(self, *, max_lines: int = 30) -> str:
        """Multi-line human-readable change list."""
        lines: list[str] = [self.short_summary(), ""]
        for s_n in self.slides_added:
            lines.append(f"+ Slide {s_n} added")
        for s_n in self.slides_removed:
            lines.append(f"- Slide {s_n} removed")
        for sc in self.slide_changes:
            for ec in sc.element_changes:
                if ec.kind == "added":
                    lines.append(f"  + slide {ec.slide_n}: added {ec.element_type} '{ec.fields.get('name', {}).get('after', ec.element_id)}'")
                elif ec.kind == "removed":
                    lines.append(f"  - slide {ec.slide_n}: removed {ec.element_type} '{ec.fields.get('name', {}).get('before', ec.element_id)}'")
                elif ec.kind == "modified":
                    field_summary = ", ".join(_summarize_field_change(f, change)
                                               for f, change in list(ec.fields.items())[:3])
                    lines.append(f"  ~ slide {ec.slide_n}: edited {ec.element_type} '{ec.element_id}' ({field_summary})")
                if len(lines) >= max_lines:
                    lines.append(f"  … and more")
                    return "\n".join(lines)
        return "\n".join(lines)


def _summarize_field_change(name: str, change: dict) -> str:
    before = change.get("before"); after = change.get("after")
    if isinstance(before, str) and isinstance(after, str):
        if len(before) > 30 or len(after) > 30:
            return f"{name}: '{before[:25]}…' → '{after[:25]}…'"
        return f"{name}: {before!r} → {after!r}"
    return f"{name}: {before!r} → {after!r}"


# ── Snapshot extraction ────────────────────────────────────────────────────


def _doc_index(doc: Any) -> dict[int, dict[str, dict]]:
    """Index a doc by slide_number → element_id → element-fingerprint dict."""
    out: dict[int, dict[str, dict]] = {}
    for slide in (getattr(doc, "slides", None) or []):
        s_n = slide.slide_number
        out[s_n] = {}
        for idx, el in enumerate(slide.elements or []):
            ident = getattr(el, "identification", None)
            eid = str(getattr(ident, "shape_id", "") or f"idx_{idx}")
            out[s_n][eid] = _fingerprint(el)
    return out


def _fingerprint(el: Any) -> dict:
    """Capture the fields we care about diffing."""
    pos = el.position
    ident = getattr(el, "identification", None)
    fp: dict = {
        "type": el.element_type,
        "name": (getattr(ident, "shape_name", None) if ident else None) or "",
        "left_in":   round(pos.left, 3),
        "top_in":    round(pos.top, 3),
        "width_in":  round(pos.width, 3),
        "height_in": round(pos.height, 3),
        "z_index":   int(getattr(getattr(el, "stacking", None), "z_index", 1) or 1),
    }
    # First text run (representative)
    text = _first_text(el)
    if text:
        fp["text"] = text[:120]
    # Fill color
    fill = getattr(el, "fill", None)
    if fill and getattr(fill, "color", None):
        try:
            fp["fill"] = fill.color.resolve({})
        except Exception:
            pass
    # Chart-specific fields
    if el.element_type == "BridgeChart":
        cats = getattr(getattr(el, "categories", None), "categories", None) or []
        series = getattr(el, "series", None) or []
        fp["chart_type"] = getattr(el, "chart_type", None)
        fp["categories"] = list(cats)
        fp["series"] = [
            {"name": s.name, "values": list(s.values or [])}
            for s in series
        ]
    if el.element_type == "BridgeTable":
        fp["data"] = [list(r) for r in (el.data or [])]
    return fp


def _first_text(el: Any) -> str:
    tc = getattr(el, "text_content", None)
    if tc:
        for p in (getattr(tc, "paragraphs", None) or []):
            for r in (getattr(p, "runs", None) or []):
                if getattr(r, "text", None):
                    return r.text
    paras = getattr(el, "paragraphs", None)
    if paras:
        for p in paras:
            for r in (getattr(p, "runs", None) or []):
                if getattr(r, "text", None):
                    return r.text
    return ""


# ── Main API ───────────────────────────────────────────────────────────────


def diff_docs(before: Any, after: Any) -> DocDiff:
    """Compute the diff between two PercyDocuments. ``before`` and ``after`` may
    each be a PercyDocument instance OR pickle bytes (for undo-stack snapshots)."""
    before_doc = _resolve(before)
    after_doc = _resolve(after)

    before_idx = _doc_index(before_doc)
    after_idx = _doc_index(after_doc)

    slides_added   = sorted(set(after_idx) - set(before_idx))
    slides_removed = sorted(set(before_idx) - set(after_idx))

    slide_changes: list[SlideChange] = []
    for s_n in sorted(set(before_idx) & set(after_idx)):
        before_els = before_idx[s_n]
        after_els = after_idx[s_n]
        added = sorted(set(after_els) - set(before_els))
        removed = sorted(set(before_els) - set(after_els))
        common = sorted(set(before_els) & set(after_els))

        element_changes: list[ElementChange] = []
        for eid in added:
            element_changes.append(ElementChange(
                slide_n=s_n, element_id=eid, element_type=after_els[eid].get("type"),
                kind="added", fields={"name": {"after": after_els[eid].get("name", "")}},
            ))
        for eid in removed:
            element_changes.append(ElementChange(
                slide_n=s_n, element_id=eid, element_type=before_els[eid].get("type"),
                kind="removed", fields={"name": {"before": before_els[eid].get("name", "")}},
            ))
        for eid in common:
            field_diffs = _field_diffs(before_els[eid], after_els[eid])
            if field_diffs:
                element_changes.append(ElementChange(
                    slide_n=s_n, element_id=eid, element_type=after_els[eid].get("type"),
                    kind="modified", fields=field_diffs,
                ))

        if element_changes:
            slide_changes.append(SlideChange(
                slide_n=s_n, kind="modified", element_changes=element_changes,
            ))

    # Add/remove slides: also emit a SlideChange so summary is complete
    for s_n in slides_added:
        added_els = [
            ElementChange(slide_n=s_n, element_id=eid, element_type=fp.get("type"),
                          kind="added", fields={"name": {"after": fp.get("name", "")}})
            for eid, fp in after_idx[s_n].items()
        ]
        slide_changes.append(SlideChange(slide_n=s_n, kind="added", element_changes=added_els))
    for s_n in slides_removed:
        removed_els = [
            ElementChange(slide_n=s_n, element_id=eid, element_type=fp.get("type"),
                          kind="removed", fields={"name": {"before": fp.get("name", "")}})
            for eid, fp in before_idx[s_n].items()
        ]
        slide_changes.append(SlideChange(slide_n=s_n, kind="removed", element_changes=removed_els))

    return DocDiff(slides_added=slides_added, slides_removed=slides_removed,
                   slide_changes=slide_changes)


def _resolve(doc_or_pickle: Any):
    if isinstance(doc_or_pickle, (bytes, bytearray)):
        import pickle as _pickle
        return _pickle.loads(doc_or_pickle)
    return doc_or_pickle


def _field_diffs(before_fp: dict, after_fp: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for key in set(before_fp) | set(after_fp):
        b = before_fp.get(key); a = after_fp.get(key)
        if b != a:
            out[key] = {"before": b, "after": a}
    return out
