"""Resolve a doc's active Template Set and project it into agent context.

The agent planner takes a ``context`` dict and renders it into the LLM system
prompt. This module produces the part of that dict that comes from the active
Template Set for the current deck:

  * `instructions_md`    — voice/structure guide
  * `palette`            — curated brand colors (name, hex, role)
  * `fonts`              — curated brand fonts (role, name)
  * `style_rules`        — capitalization / number formatting / lock-to-palette
  * `available_templates`— [{id, name, kind, description, tags, inputs}]
  * `set_metadata`       — `{id, name, inherited_from}` so the audit log can
                            record which set drove the response

Returns `None` if no set is configured anywhere up the inheritance chain.
"""

from __future__ import annotations

import logging
from typing import Any

from . import auth_db

log = logging.getLogger(__name__)


# Cap the available-templates list shipped in every prompt. The planner uses
# retrieval (top-k from manifest), but template sets are small enough that
# we can usually fit them whole. Above this cap we'd risk prompt bloat.
_MAX_TEMPLATES_IN_CONTEXT = 16


def resolve_active_set_for_doc(doc_id: str) -> dict[str, Any] | None:
    """Walk: doc_id → project → folder → ancestors → org default."""
    project = auth_db.get_project_by_doc_id(doc_id)
    if not project:
        return None
    return auth_db.resolve_active_template_set(project_id=project["id"])


def build_set_context(doc_id: str, *, with_templates: bool = True) -> dict[str, Any] | None:
    """Return the planner-ready dict for the active set, or None if unset."""
    tpl = resolve_active_set_for_doc(doc_id)
    if not tpl:
        return None

    project = auth_db.get_project_by_doc_id(doc_id)
    inherited_from = "org_default"
    if tpl.get("folder_id"):
        if project and tpl["folder_id"] == project.get("folder_id"):
            inherited_from = "project_folder"
        else:
            inherited_from = f"parent_folder:{tpl['folder_id']}"

    ctx: dict[str, Any] = {
        "set_metadata": {
            "id": tpl["id"],
            "name": tpl["name"],
            "org_id": tpl["org_id"],
            "inherited_from": inherited_from,
        },
        "instructions_md": tpl.get("instructions_md") or "",
        "palette": tpl.get("palette") or [],
        "fonts": tpl.get("fonts") or [],
        "style_rules": tpl.get("style_rules") or {},
    }

    if with_templates:
        items = auth_db.list_template_set_items(tpl["id"])
        # Hydrate item -> agent template so the LLM sees names + inputs.
        try:
            from percy.agent import templates as _agent_tpls
            templates_summary: list[dict[str, Any]] = []
            for it in items[:_MAX_TEMPLATES_IN_CONTEXT]:
                t = _agent_tpls.get_template(it["template_id"])
                if not t:
                    continue
                templates_summary.append({
                    "id": t["id"],
                    "name": t["name"],
                    "kind": it["kind"],
                    "description": t.get("description") or "",
                    "tags": t.get("tags") or [],
                    "inputs": [
                        {"name": k, "type": v.get("type") or "string",
                         "required": bool(v.get("required", False)),
                         "description": v.get("description") or ""}
                        for k, v in (t.get("inputs_schema") or {}).items()
                    ],
                })
            ctx["available_templates"] = templates_summary
        except Exception as exc:
            log.warning("could not hydrate set items for context: %s", exc)
            ctx["available_templates"] = []

    return ctx


def format_for_system_prompt(set_ctx: dict[str, Any]) -> str:
    """Render the set context as a markdown block to slot into the LLM
    system prompt. Returns "" if no useful content."""
    if not set_ctx:
        return ""
    parts: list[str] = ["## Active Template Set"]
    meta = set_ctx.get("set_metadata") or {}
    if meta:
        parts.append(f"Name: **{meta.get('name', '?')}** (inherited from: {meta.get('inherited_from', '?')})")
    instr = (set_ctx.get("instructions_md") or "").strip()
    if instr:
        parts.append("")
        parts.append("### Instructions")
        parts.append(instr)

    palette = set_ctx.get("palette") or []
    if palette:
        parts.append("")
        parts.append("### Palette (prefer these colors; cite by name when applying)")
        for c in palette[:12]:
            line = f"- `{c.get('hex', '#?')}` — {c.get('name') or c.get('role') or 'color'}"
            if c.get("role") and c.get("name"):
                line = f"- `{c.get('hex', '#?')}` — {c.get('name')} ({c.get('role')})"
            parts.append(line)

    fonts = set_ctx.get("fonts") or []
    if fonts:
        parts.append("")
        parts.append("### Fonts (use these by role)")
        for f in fonts[:6]:
            role = f.get("role") or "body"
            name = f.get("name") or "?"
            fallbacks = ", ".join(f.get("fallbacks") or [])
            line = f"- {role}: **{name}**"
            if fallbacks:
                line += f" (fallbacks: {fallbacks})"
            parts.append(line)

    style_rules = set_ctx.get("style_rules") or {}
    if style_rules:
        parts.append("")
        parts.append("### Style rules")
        for k, v in style_rules.items():
            parts.append(f"- {k}: {v}")

    templates = set_ctx.get("available_templates") or []
    if templates:
        parts.append("")
        parts.append(f"### Available templates ({len(templates)})")
        for t in templates:
            kind = t.get("kind") or "slide"
            inputs = [i["name"] for i in (t.get("inputs") or [])]
            inp_str = f" — inputs: {', '.join(inputs)}" if inputs else ""
            parts.append(f"- [{kind}] **{t['name']}** ({t['id']}): {t.get('description', '')}{inp_str}")

    return "\n".join(parts)
