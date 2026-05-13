"""Bridge element ↔ dict codec + cross-member diff.

Three pieces of leverage for the template-induction pipeline:

  1. ``bridge_to_dict(el)``  — serialize a BridgeElement to a plain dict
     preserving *every* nested field (uses dataclasses.asdict).
  2. ``bridge_from_dict(d)`` — reconstruct the exact BridgeElement back
     from such a dict, walking nested dataclass fields recursively.
  3. ``diff_axes(members)``  — given a list of homogeneous BridgeElements
     (one per cluster member), walk every attribute path and return the
     set of paths whose value varies across members, plus the observed
     value set per path. Downstream code uses this to mint input
     variables programmatically — no LLM transcription.

This keeps the LLM out of the business of copying ~40 nested fields
verbatim; it only decides which axes are worth exposing as user inputs.
"""
from __future__ import annotations

from dataclasses import fields, is_dataclass
from functools import lru_cache
from typing import Any, Iterable, get_type_hints

from percy.bridge import elements as _elt


# ---------------------------------------------------------------------------
# Dataclass registry — names → class. Built lazily by scanning the module.
# ---------------------------------------------------------------------------
def _build_registry() -> dict[str, type]:
    reg: dict[str, type] = {}
    for name in dir(_elt):
        obj = getattr(_elt, name)
        if isinstance(obj, type) and is_dataclass(obj):
            reg[name] = obj
    return reg


_REGISTRY: dict[str, type] = _build_registry()


def _resolve_field_type(annot: Any) -> type | None:
    """Best-effort resolver: turn a field annotation into a concrete dataclass
    type when possible. Handles 'ClassName' string forward-refs and bare types.
    Optional / unions degrade to the first dataclass we recognise. Returns None
    when the annotation is a plain primitive / dict / list / unknown."""
    if isinstance(annot, str):
        return _REGISTRY.get(annot)
    if isinstance(annot, type) and is_dataclass(annot):
        return annot
    # typing constructs (Optional, Union, list[T], dict[K,V])
    import typing
    origin = typing.get_origin(annot)
    if origin is None:
        return None
    args = typing.get_args(annot)
    # Union/Optional — pick the first dataclass arg.
    for a in args:
        t = _resolve_field_type(a)
        if t is not None:
            return t
    return None


def _list_element_type(annot: Any) -> type | None:
    """If the annotation is list[T] for a dataclass T, return T; else None."""
    import typing
    origin = typing.get_origin(annot)
    if origin is list and (args := typing.get_args(annot)):
        return _resolve_field_type(args[0])
    return None


# ---------------------------------------------------------------------------
# Serialize.
# ---------------------------------------------------------------------------
def _scrub_jsonable(v: Any) -> Any:
    """Recursively coerce non-JSON-safe leaves into JSON-safe forms.

    - bytes → base64 string wrapped in {"__bytes__": "..."} so from_dict
      can detect and decode round-trip. (Rare; only OOXML bullet blips.)
    - Other types pass through.
    """
    if isinstance(v, bytes):
        import base64
        return {"__bytes__": base64.b64encode(v).decode("ascii")}
    if isinstance(v, dict):
        return {k: _scrub_jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_scrub_jsonable(x) for x in v]
    return v


def bridge_to_dict(el: _elt.BridgeElement) -> dict[str, Any]:
    """Full-fidelity, JSON-safe dict snapshot, with a `__type__` tag so we can rebuild."""
    d = _scrub_jsonable(el.to_dict())
    d["__type__"] = type(el).__name__
    return d


# ---------------------------------------------------------------------------
# Deserialize.
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def _resolved_hints(cls: type) -> dict[str, Any]:
    """Resolve forward-ref / string annotations to real types via get_type_hints,
    evaluated in the elements module's namespace so all sibling dataclasses are visible."""
    return get_type_hints(cls, globalns=vars(_elt))


def _unscrub_jsonable(v: Any) -> Any:
    """Inverse of _scrub_jsonable: decode {"__bytes__": "..."} back to bytes."""
    if isinstance(v, dict) and "__bytes__" in v and len(v) == 1:
        import base64
        return base64.b64decode(v["__bytes__"])
    if isinstance(v, dict):
        return {k: _unscrub_jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_unscrub_jsonable(x) for x in v]
    return v


def _from_dict_generic(cls: type, value: Any) -> Any:
    """Reconstruct an instance of ``cls`` (a dataclass) from a dict.

    Recursively reconstructs nested dataclass fields and list-of-dataclass
    fields. Unknown extra keys (e.g. our `__type__` tag) are ignored.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        return value
    hints = _resolved_hints(cls)
    kwargs: dict[str, Any] = {}
    for f in fields(cls):
        if f.name not in value:
            continue
        raw = value[f.name]
        if raw is None:
            kwargs[f.name] = None
            continue
        annot = hints.get(f.name, f.type)
        # Nested dataclass?
        nested_cls = _resolve_field_type(annot)
        if nested_cls is not None and isinstance(raw, dict):
            kwargs[f.name] = _from_dict_generic(nested_cls, raw)
            continue
        # List of dataclasses?
        elt_cls = _list_element_type(annot)
        if elt_cls is not None and isinstance(raw, list):
            kwargs[f.name] = [
                _from_dict_generic(elt_cls, x) if isinstance(x, dict) else x
                for x in raw
            ]
            continue
        # Primitive / dict / list-of-primitives — pass through, decoding
        # any {"__bytes__": "..."} wrappers back to bytes leaves.
        kwargs[f.name] = _unscrub_jsonable(raw)
    return cls(**kwargs)


def bridge_from_dict(d: dict[str, Any]) -> _elt.BridgeElement:
    """Inverse of bridge_to_dict — requires the `__type__` tag."""
    type_name = d.get("__type__")
    if not type_name:
        raise ValueError("bridge_from_dict requires a '__type__' key")
    cls = _REGISTRY.get(type_name)
    if cls is None:
        raise ValueError(f"unknown bridge type: {type_name!r}")
    if not issubclass(cls, _elt.BridgeElement):
        raise ValueError(f"{type_name!r} is not a BridgeElement subclass")
    return _from_dict_generic(cls, d)


# ---------------------------------------------------------------------------
# Cross-member axis diff.
# ---------------------------------------------------------------------------
# Attribute paths that are pure provenance / never meaningful as a user input:
_NEVER_AXIS = frozenset({
    "identification.slide_number",
    "identification.shape_id",
    "identification.shape_name",
    "identification.group_id",
})


def _walk_paths(d: Any, prefix: str = "") -> Iterable[tuple[str, Any]]:
    """Yield (path, leaf_value) for every leaf in a nested dict/list.

    Leaves are anything that is not a dict and not a list-of-dicts. Lists of
    primitives are treated as leaves (compared as tuples). Lists of dicts get
    descended into with `[i]` indexing — but in practice paragraphs/runs etc.
    align by index across cluster members.
    """
    if isinstance(d, dict):
        for k, v in d.items():
            if k == "__type__":
                continue
            yield from _walk_paths(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(d, list) and d and all(isinstance(x, dict) for x in d):
        for i, v in enumerate(d):
            yield from _walk_paths(v, f"{prefix}[{i}]")
    else:
        # leaf — primitive or list-of-primitives.
        yield prefix, tuple(d) if isinstance(d, list) else d


def diff_axes(member_dicts: list[dict[str, Any]]) -> dict[str, list[Any]]:
    """For every attribute path, return the set of distinct values observed
    across cluster members. Only paths that ACTUALLY VARY (>1 distinct value)
    are returned. Provenance paths are excluded.

    Returns: ``{path: [val_a, val_b, ...]}`` — values in first-seen order,
    deduplicated.
    """
    if len(member_dicts) < 2:
        return {}
    # Collect per-path value lists.
    by_path: dict[str, list[Any]] = {}
    seen_per_path: dict[str, set[Any]] = {}
    for md in member_dicts:
        for path, val in _walk_paths(md):
            if path in _NEVER_AXIS:
                continue
            # values must be hashable for set dedup; coerce dicts/lists to tuple repr.
            try:
                key = val
                hash(key)
            except TypeError:
                key = repr(val)
            if path not in seen_per_path:
                seen_per_path[path] = set()
                by_path[path] = []
            if key not in seen_per_path[path]:
                seen_per_path[path].add(key)
                by_path[path].append(val)
    return {p: vs for p, vs in by_path.items() if len(vs) >= 2}


def axis_type_hint(values: list[Any]) -> str:
    """Heuristic JSON-schema-ish type from a list of observed values."""
    if all(isinstance(v, bool) for v in values):
        return "bool"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        return "number"
    if all(isinstance(v, str) for v in values):
        # Hex color?
        if all(isinstance(v, str) and v.startswith("#") and len(v) in (4, 7, 9) for v in values):
            return "color"
        return "string" if len(values) > 4 else "enum"
    return "any"
