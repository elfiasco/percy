# BridgeGroup — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeGroup`

## What it is

A composite element that contains other elements as children. Used for atomic move/resize/rotate of a logical unit (e.g. a callout = shape + arrow + text grouped together).

## Anatomy

```
BridgeGroup
├── (BridgeElement base — position is the bounding box of children)
└── children: list[BridgeElement]   — any mix of shape/text/chart/image/connector/freeform
```

## Position on agent creation

**Groups are composed from already-created elements, not created from scratch.** The agent flow is:

1. Create children via the standard `create_*` endpoints
2. Call `group_elements` to wrap them in a BridgeGroup

This already exists today: `POST /api/docs/{doc_id}/slides/{n}/group-elements` (main.py:5283).

There is also `POST /api/docs/{doc_id}/slides/{n}/elements/{element_id}/ungroup` (main.py:5341).

## What the agent's manifest should expose

The grouping endpoints get manifest entries; they don't need a new `create_group` shape:

```
group.create
  POST /api/docs/{doc_id}/slides/{n}/group-elements
  body: {element_ids: [...], name?: string}

group.ungroup
  POST /api/docs/{doc_id}/slides/{n}/elements/{element_id}/ungroup
  destructive: false (children become top-level, group dataclass dropped)
```

## Templates use groups

Multi-element templates (Phase 4) materialize as a sequence of `create_*` calls *plus* an optional final `group.create`. This keeps templates as a flat structure of element specs rather than a recursive tree.

## Edit-only

- Direct `children` mutation (use ungroup → edit → regroup, or use the group's bounding-box edit endpoints)
- Nested groups (the dataclass technically allows recursion, but agent flows don't generate them in v1)

## Gotchas

- **Group `position` is derived** as the bounding box of children at group time. Editing the group's position translates all children together.
- **Group bounding box can become stale** if children are edited individually after group creation. The studio's existing group machinery already recomputes on render; agent doesn't need to manage this.
- **Z-index within a group** is preserved relative to children's pre-group order.

## Example payload

```json
// After creating shape-1, shape-2, connector-3
POST /api/docs/{doc_id}/slides/3/group-elements
{
  "element_ids": ["shape-1", "shape-2", "connector-3"],
  "name": "Q4 Callout"
}
```
