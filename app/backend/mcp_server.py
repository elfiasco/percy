"""MCP (Model Context Protocol) adapter — exposes Percy's typed agent
manifest as MCP tools so any MCP-speaking agent (Claude Desktop, AgentCore
Gateway, Cursor, custom LangGraph agents) can drive Percy directly.

Implements just the JSON-RPC subset of MCP needed for tool discovery and
invocation:
  - initialize
  - tools/list
  - tools/call
  - notifications/initialized   (acknowledged)
  - ping

Endpoint: ``POST /api/mcp``  (single request/response — not streaming)
         (For SSE/streaming you'd use a separate endpoint; AgentCore
          Gateway handles that natively if/when we move there.)

Auth: same session cookie + X-Percy-Actor flow as the rest of the agent
API. The gateway in front (AgentCore Gateway, MCP Inspector, etc.) is
expected to set the Authorization header or cookie.

Each manifest entry is exposed as one MCP tool:
  - name           = entry id (e.g. 'chart.create')
  - description    = entry summary + first example
  - inputSchema    = derived from entry args (one-line desc each)

When a client calls ``tools/call`` we dispatch through the same
``planner.execute_one`` path the chat endpoint uses, so all the dispatcher
hardening (id aliases, body coercion, find_element substitution) applies.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from percy.agent import audit
from percy.agent.planner import ToolCall, execute_one
from percy.agent.script_api import Studio

log = logging.getLogger(__name__)
router = APIRouter()


PROTOCOL_VERSION = "2025-03-26"  # MCP spec version Percy targets
SERVER_NAME    = "percy-studio"
SERVER_VERSION = "0.1.0"


# ── JSON-RPC plumbing ──────────────────────────────────────────────────────


def _ok(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id: Any, code: int, message: str, data: Any = None) -> dict:
    err = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


# ── Manifest → MCP tool definitions ────────────────────────────────────────


_MANIFEST_TYPE_TO_JSONSCHEMA: dict[str, str] = {
    "string":   "string",
    "number":   "number",
    "bool":     "boolean",
    "object":   "object",
    "list":     "array",
    "any":      "string",
}


def _arg_to_schema(arg_def: dict) -> dict:
    """Translate a manifest arg def to a JSON Schema property."""
    raw_type = (arg_def.get("type") or "string").lower()
    optional = raw_type.endswith("?")
    base = raw_type.rstrip("?")
    base = base.rstrip("[]")  # crude: we don't fully model arrays

    schema: dict[str, Any] = {
        "description": arg_def.get("desc") or "",
    }
    if "[]" in raw_type:
        schema["type"] = "array"
        schema["items"] = {"type": _MANIFEST_TYPE_TO_JSONSCHEMA.get(base, "string")}
    else:
        schema["type"] = _MANIFEST_TYPE_TO_JSONSCHEMA.get(base, "string")
    return schema


def _entry_to_mcp_tool(entry: dict) -> dict:
    """Turn a manifest entry into an MCP tool descriptor."""
    args = entry.get("args") or {}
    properties = {name: _arg_to_schema(spec) for name, spec in args.items()}
    required = [name for name, spec in args.items()
                if not (spec.get("type") or "").endswith("?")]

    summary = entry.get("summary", "")
    examples = entry.get("examples") or []
    description = summary
    if examples:
        description += "\n\nExamples:\n" + "\n".join(f"  - {e}" for e in examples[:3])

    return {
        "name": entry["id"],
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }


# ── Handlers ───────────────────────────────────────────────────────────────


def _handle_initialize(req_id: Any, params: dict) -> dict:
    return _ok(req_id, {
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        "capabilities": {
            "tools": {"listChanged": True},
            # Percy could also advertise resources (decks, slides) and prompts
            # (saved templates) here later.
        },
    })


def _handle_tools_list(req_id: Any) -> dict:
    from app.backend import agent_manifest
    manifest = agent_manifest.get_manifest()
    tools = [_entry_to_mcp_tool(e) for e in (manifest.get("endpoints") or [])]
    return _ok(req_id, {"tools": tools})


async def _handle_tools_call(req_id: Any, params: dict, request: Request) -> dict:
    name = params.get("name")
    arguments = params.get("arguments") or {}
    if not name:
        return _err(req_id, -32602, "missing tool name")

    # Path arg vs body arg routing — manifest entries use {doc_id}, {n},
    # {element_id} placeholders in the path. Pull those into path_args.
    path_args = {}
    body = dict(arguments)
    for routing_key in ("doc_id", "slide_n", "n", "element_id"):
        if routing_key in body:
            v = body.pop(routing_key)
            path_args[routing_key.replace("n", "slide_n") if routing_key == "n" else routing_key] = v

    # Build a Studio client tied to this request (in-process ASGI).
    studio = Studio(
        base_url=f"{request.url.scheme}://{request.url.netloc}",
        doc_id=path_args.get("doc_id", ""),
        auth_token=request.cookies.get("percy_session"),
        timeout_s=60,
        asgi_app=request.app,
    )

    call = ToolCall(endpoint_id=name, path_args=path_args, body=body)
    t0 = time.time()
    sr = execute_one(call, studio=studio)
    elapsed_ms = int((time.time() - t0) * 1000)

    # Audit row
    user = getattr(request.state, "user", None)
    audit.record_action(
        user_id=(user or {}).get("id"),
        doc_id=path_args.get("doc_id") or "(mcp)",
        slide_n=path_args.get("slide_n"),
        element_id=path_args.get("element_id"),
        actor="agent", source="mcp",
        method="POST", path="/api/mcp",
        kind="edit",
        prompt=f"MCP tool call: {name}",
        plan={"tool": name, "arguments": arguments},
        response={"ok": sr.ok, "result": sr.response, "error": sr.error},
        status="executed" if sr.ok else "failed",
        error=sr.error,
        elapsed_ms=elapsed_ms,
    )

    if sr.ok:
        # MCP convention: result is content blocks
        return _ok(req_id, {
            "content": [{"type": "text", "text": json.dumps(sr.response, default=str)}],
            "isError": False,
        })
    return _ok(req_id, {
        "content": [{"type": "text", "text": sr.error or "tool failed"}],
        "isError": True,
    })


# ── HTTP endpoint ──────────────────────────────────────────────────────────


@router.post("/api/mcp")
async def mcp_route(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"request body must be JSON: {exc}")

    # Support batch (array) per JSON-RPC spec
    if isinstance(body, list):
        out = []
        for msg in body:
            res = await _dispatch(msg, request)
            if res is not None:
                out.append(res)
        return out

    res = await _dispatch(body, request)
    return res or {}


async def _dispatch(msg: dict, request: Request):
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _err(msg.get("id") if isinstance(msg, dict) else None,
                    -32600, "invalid jsonrpc envelope")
    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method == "initialize":
        return _handle_initialize(req_id, params)
    if method == "notifications/initialized":
        # Notification — no response per spec
        return None
    if method == "ping":
        return _ok(req_id, {})
    if method == "tools/list":
        return _handle_tools_list(req_id)
    if method == "tools/call":
        return await _handle_tools_call(req_id, params, request)
    return _err(req_id, -32601, f"method not found: {method}")


def register_mcp_router(app) -> None:
    app.include_router(router)
    log.info("mcp_server: registered MCP JSON-RPC adapter at POST /api/mcp")
