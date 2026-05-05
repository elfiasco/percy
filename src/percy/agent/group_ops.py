"""Group-aware operation expansion.

When the agent's plan targets a group (real BridgeGroup or synthetic via
``group_id`` cluster), uniform ops like move/translate/restyle need to fan
out to per-child operations. This module is the planner-side helper that
turns "move group X by (dx, dy)" into N concrete element patches.

For real ``BridgeGroup`` instances, uniform ops can sometimes be issued as
a single update on the group itself (when the studio API supports it). For
synthetic groups, every op must be expanded to per-child updates.
"""

from __future__ import annotations

from typing import Any

from percy.agent.element_index import ElementDigest


def is_synthetic(digest: ElementDigest) -> bool:
    return digest.synthetic


def expand_translate(
    digest: ElementDigest, dx_in: float, dy_in: float,
    *, doc: Any,
) -> list[dict]:
    """Translate a group by (dx, dy). Returns a list of patch operations.

    Each operation has the shape::

        {
          "endpoint_id": "element.update",
          "path_args":   {"slide_n": int, "element_id": str},
          "body":        {"left_in": float, "top_in": float},
        }

    For real BridgeGroup: emit a single op on the group itself (children move
    with it because the studio API recomputes positions relative to the group).
    For synthetic: emit one op per child with the same delta.
    """
    if not digest.synthetic:
        # Real element: a BridgeGroup or any other; the renderer translates
        # children automatically.
        return [{
            "endpoint_id": "element.update",
            "path_args": {"slide_n": digest.slide_n, "element_id": digest.element_id},
            "body": {"left_in": digest.left + dx_in, "top_in": digest.top + dy_in},
        }]

    # Synthetic group — find each member's current position from the doc.
    ops: list[dict] = []
    slide = next((s for s in (doc.slides or []) if s.slide_number == digest.slide_n), None)
    if slide is None:
        return ops
    members_by_id: dict[str, Any] = {}
    for el in slide.elements:
        ident = getattr(el, "identification", None)
        sid = str(getattr(ident, "shape_id", "") or "")
        if sid in digest.synthetic_members:
            members_by_id[sid] = el
    for member_id in digest.synthetic_members:
        el = members_by_id.get(member_id)
        if el is None:
            continue
        ops.append({
            "endpoint_id": "element.update",
            "path_args": {"slide_n": digest.slide_n, "element_id": member_id},
            "body": {"left_in": el.position.left + dx_in, "top_in": el.position.top + dy_in},
        })
    return ops


def expand_uniform_style(digest: ElementDigest, style: dict) -> list[dict]:
    """Apply a style patch uniformly to every member of a group.

    For real BridgeGroup: synthesize a per-child style op for each child since
    the studio's element.style PATCH targets a single element.
    For synthetic: same — per-child ops.
    """
    if digest.synthetic:
        return [
            {"endpoint_id": "element.style",
             "path_args": {"slide_n": digest.slide_n, "element_id": mid},
             "body": dict(style)}
            for mid in digest.synthetic_members
        ]
    # Real BridgeGroup — for now, plan per-child ops too. (BridgeGroup.children
    # is a list of dataclasses, not addressable via the element-level style PATCH
    # without first identifying each child's shape_id.) We delegate to the
    # caller via a special "expand_in_executor" hint they pick up.
    return [{
        "endpoint_id": "_internal.expand_real_group_style",
        "path_args": {"slide_n": digest.slide_n, "element_id": digest.element_id},
        "body": dict(style),
    }]


def expand_show_hide(digest: ElementDigest, *, hidden: bool) -> list[dict]:
    """Hide/show every member of a (real or synthetic) group."""
    if digest.synthetic:
        return [
            {"endpoint_id": "element.update",
             "path_args": {"slide_n": digest.slide_n, "element_id": mid},
             "body": {"hidden": hidden}}
            for mid in digest.synthetic_members
        ]
    return [{
        "endpoint_id": "element.update",
        "path_args": {"slide_n": digest.slide_n, "element_id": digest.element_id},
        "body": {"hidden": hidden},
    }]
