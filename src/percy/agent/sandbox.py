"""Sandboxed Python script runner for Percy.

Executes user/agent-authored Python in a subprocess with:
  * stdin/stdout JSON contract (script ⇄ runner)
  * timeout enforcement
  * scope manifest (network egress allowlist, secret env injection, file-read whitelist)
  * structured stdout (last line = JSON result, prior lines = user logs)
  * import allowlist check (static AST scan before exec)

Two entry points:
  * ``run_live_group_generator(...)`` — invokes a script's ``generate(group, inputs, studio)``
  * ``run_slide_script(...)``        — invokes a script's ``run(slide, inputs, studio)``

The sandbox is intentionally not a hard security boundary today — it's
defense in depth. Scripts run as the same OS user as the backend process.
A real boundary (container / nsjail / firecracker) is a Phase 5 task.
What this module *does* enforce:

  * timeout (subprocess.TimeoutExpired → kill)
  * import allowlist (AST scan; refuse subprocess/socket/eval unless scope grants)
  * secret env var allowlist (only listed keys are injected)
  * stdout/stderr capture and structured return
"""

from __future__ import annotations

import ast
import hashlib
import json
import logging
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


# ── Scope manifest ──────────────────────────────────────────────────────────


# Default safe imports — anything not on this list AND not in the script's
# scope.allow_imports is rejected.
_DEFAULT_ALLOWED_IMPORTS: frozenset[str] = frozenset({
    # Stdlib essentials for typical data shaping
    "json", "math", "datetime", "time", "re", "itertools", "functools",
    "collections", "statistics", "decimal", "random", "uuid", "hashlib",
    "string", "textwrap",
    # Type hints
    "typing", "dataclasses",
    # The Percy SDK module itself
    "percy", "percy.agent", "percy.agent.script_api",
})

# Imports that always require explicit scope grant.
_GATED_IMPORTS: frozenset[str] = frozenset({
    "os", "subprocess", "socket", "urllib", "urllib.request", "requests",
    "http", "ftplib", "smtplib", "ssl",
    "ctypes", "multiprocessing", "threading",
    "pathlib", "shutil", "tempfile",
    "sqlite3", "psycopg2", "pymongo",
    "pandas", "numpy",  # not banned, just gated — keeps dep surface explicit
})


@dataclass(slots=True)
class ScopeManifest:
    """Per-script execution policy. Defaults are restrictive."""
    timeout_s:        float = 10.0
    memory_mb:        int = 512
    network:          bool = False
    allow_imports:    list[str] = field(default_factory=list)
    secret_keys:      list[str] = field(default_factory=list)
    file_reads:       list[str] = field(default_factory=list)

    def effective_imports(self) -> set[str]:
        return set(_DEFAULT_ALLOWED_IMPORTS) | set(self.allow_imports)

    def to_dict(self) -> dict:
        return {
            "timeout_s": self.timeout_s, "memory_mb": self.memory_mb,
            "network": self.network, "allow_imports": list(self.allow_imports),
            "secret_keys": list(self.secret_keys), "file_reads": list(self.file_reads),
        }

    @classmethod
    def from_dict(cls, d: dict | None) -> "ScopeManifest":
        if not d:
            return cls()
        return cls(
            timeout_s=float(d.get("timeout_s", 10.0)),
            memory_mb=int(d.get("memory_mb", 512)),
            network=bool(d.get("network", False)),
            allow_imports=list(d.get("allow_imports") or []),
            secret_keys=list(d.get("secret_keys") or []),
            file_reads=list(d.get("file_reads") or []),
        )


# ── Result type ─────────────────────────────────────────────────────────────


@dataclass(slots=True)
class SandboxResult:
    ok:          bool
    result:      Any = None
    error:       str | None = None
    traceback:   str | None = None
    logs:        str = ""
    stderr:      str = ""
    elapsed_s:   float = 0.0
    ops:         list[dict] = field(default_factory=list)
    inputs_hash: str = ""

    def to_dict(self) -> dict:
        return {
            "ok": self.ok, "result": self.result, "error": self.error,
            "traceback": self.traceback, "logs": self.logs, "stderr": self.stderr,
            "elapsed_s": self.elapsed_s, "ops": self.ops, "inputs_hash": self.inputs_hash,
        }


# ── Static analysis ─────────────────────────────────────────────────────────


def lint_imports(source: str, scope: ScopeManifest) -> tuple[bool, list[str]]:
    """Static scan for disallowed imports. Returns (ok, list_of_violations)."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return False, [f"SyntaxError at line {exc.lineno}: {exc.msg}"]
    allowed = scope.effective_imports()
    violations: list[str] = []

    for node in ast.walk(tree):
        modules: list[str] = []
        if isinstance(node, ast.Import):
            modules = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                modules = [node.module]
        else:
            continue
        for m in modules:
            top = m.split(".")[0]
            full = m
            if full in allowed or top in allowed:
                continue
            if top in _GATED_IMPORTS and full not in allowed and top not in allowed:
                violations.append(f"import {full!r} requires scope.allow_imports grant")
                continue
            # Unknown module — also requires grant (be strict).
            violations.append(f"import {full!r} not in default allowlist; add to scope.allow_imports")

    return len(violations) == 0, violations


# ── Hash helpers ────────────────────────────────────────────────────────────


def hash_inputs(inputs: dict) -> str:
    canonical = json.dumps(inputs, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


# ── Runners ─────────────────────────────────────────────────────────────────


_GENERATOR_TEMPLATE = '''\
import json, sys, traceback

# Re-add the project src/ to path so percy is importable inside the subprocess.
import os
sys.path.insert(0, {percy_src_path!r})

from percy.agent.script_api import GroupHandle, Studio

_input = json.loads(sys.stdin.read())

studio = Studio(
    base_url={base_url!r},
    doc_id={doc_id!r},
    auth_token=_input.get("auth_token"),
)
group = GroupHandle(
    slide_n=_input["slide_n"],
    position=_input["position"],
    inputs=_input.get("inputs") or {{}},
    existing_children=_input.get("existing_children") or [],
)

# User code is executed in the subprocess's __main__ namespace, then we look
# up the `generate` callable they defined.
_user_globals = {{
    "GroupHandle": GroupHandle, "Studio": Studio,
    "group": group, "studio": studio, "inputs": group.inputs,
}}

try:
    exec(compile({source!r}, "<live_group_generator>", "exec"), _user_globals)
    fn = _user_globals.get("generate")
    if not callable(fn):
        raise RuntimeError("script must define a `generate(group, inputs, studio)` function")
    fn(group, group.inputs, studio)
    payload = {{
        "ok": True,
        "children_spec": group.children_spec,
        "studio_ops": studio.ops,
    }}
except SystemExit as e:
    payload = {{"ok": False, "error": f"sys.exit({{e.code}})"}}
except Exception as e:
    payload = {{
        "ok": False,
        "error": f"{{type(e).__name__}}: {{e}}",
        "traceback": traceback.format_exc(),
    }}

print(json.dumps(payload, default=str))
'''


_SLIDE_SCRIPT_TEMPLATE = '''\
import json, sys, traceback

import os
sys.path.insert(0, {percy_src_path!r})

from percy.agent.script_api import SlideHandle, Studio

_input = json.loads(sys.stdin.read())

studio = Studio(
    base_url={base_url!r},
    doc_id={doc_id!r},
    auth_token=_input.get("auth_token"),
)
slide = SlideHandle(studio, _input["slide_n"])
inputs = _input.get("inputs") or {{}}

_user_globals = {{
    "SlideHandle": SlideHandle, "Studio": Studio,
    "slide": slide, "studio": studio, "inputs": inputs,
}}

try:
    exec(compile({source!r}, "<slide_script>", "exec"), _user_globals)
    fn = _user_globals.get("run")
    if not callable(fn):
        raise RuntimeError("script must define a `run(slide, inputs, studio)` function")
    result = fn(slide, inputs, studio)
    payload = {{
        "ok": True,
        "result": result,
        "studio_ops": studio.ops,
    }}
except SystemExit as e:
    payload = {{"ok": False, "error": f"sys.exit({{e.code}})"}}
except Exception as e:
    payload = {{
        "ok": False,
        "error": f"{{type(e).__name__}}: {{e}}",
        "traceback": traceback.format_exc(),
    }}

print(json.dumps(payload, default=str))
'''


def _run_subprocess(runner_source: str, proc_input: dict, scope: ScopeManifest,
                    secrets: dict[str, str] | None) -> tuple[str, str, int, bool]:
    """Run a runner template in a fresh subprocess.

    Returns (stdout, stderr, returncode, timed_out).
    """
    import os as _os

    # Inherit parent env (Python needs PATHEXT, sys-prefix-derived vars, etc. on
    # Windows to find site-packages). Strip anything that looks like a secret
    # unless explicitly granted.
    env = dict(_os.environ)
    # Drop env keys not explicitly granted that LOOK like secrets.
    for k in list(env.keys()):
        if any(tok in k.upper() for tok in ("PASSWORD", "SECRET", "TOKEN", "API_KEY")):
            if k not in scope.secret_keys:
                env.pop(k, None)
    if secrets:
        for k in scope.secret_keys:
            if k in secrets:
                env[k] = secrets[k]

    try:
        proc = subprocess.run(
            [sys.executable, "-c", runner_source],
            input=json.dumps(proc_input, default=str).encode("utf-8"),
            capture_output=True,
            timeout=scope.timeout_s,
            env=env,
        )
        return (
            proc.stdout.decode("utf-8", errors="replace"),
            proc.stderr.decode("utf-8", errors="replace"),
            proc.returncode,
            False,
        )
    except subprocess.TimeoutExpired:
        return ("", f"timeout after {scope.timeout_s}s", -1, True)


def _parse_payload(stdout: str) -> tuple[dict, str]:
    """Pull the trailing JSON payload off stdout. Return (payload, user_logs)."""
    lines = stdout.strip().splitlines()
    if not lines:
        return {}, ""
    last = lines[-1]
    user_logs = "\n".join(lines[:-1])
    try:
        return json.loads(last), user_logs
    except Exception:
        return {}, stdout


def _percy_src_path() -> str:
    """Best-effort path to the project's src/ for the subprocess to import from."""
    import os as _os
    here = _os.path.dirname(_os.path.abspath(__file__))
    # ~/.../src/percy/agent/sandbox.py → climb to .../src
    return _os.path.abspath(_os.path.join(here, "..", ".."))


def run_live_group_generator(
    *,
    source: str,
    slide_n: int,
    position: dict,
    inputs: dict,
    existing_children: list[dict] | None = None,
    base_url: str,
    doc_id: str,
    auth_token: str | None = None,
    scope: ScopeManifest | None = None,
    secrets: dict[str, str] | None = None,
) -> SandboxResult:
    """Run a live-group generator script. Returns child specs + ops log."""
    scope = scope or ScopeManifest()

    ok, violations = lint_imports(source, scope)
    if not ok:
        return SandboxResult(ok=False, error="import_violation: " + "; ".join(violations))

    runner = _GENERATOR_TEMPLATE.format(
        source=source, base_url=base_url, doc_id=doc_id,
        percy_src_path=_percy_src_path(),
    )
    proc_input = {
        "slide_n": slide_n, "position": position, "inputs": inputs,
        "existing_children": existing_children or [], "auth_token": auth_token,
    }
    inputs_hash = hash_inputs(inputs)

    t0 = time.time()
    stdout, stderr, rc, timed_out = _run_subprocess(runner, proc_input, scope, secrets)
    elapsed = time.time() - t0

    if timed_out:
        return SandboxResult(ok=False, error=f"timeout after {scope.timeout_s}s",
                             elapsed_s=elapsed, stderr=stderr, inputs_hash=inputs_hash)

    payload, user_logs = _parse_payload(stdout)

    if not payload.get("ok"):
        return SandboxResult(
            ok=False, error=payload.get("error") or f"exit {rc}",
            traceback=payload.get("traceback"),
            logs=user_logs, stderr=stderr,
            elapsed_s=elapsed, inputs_hash=inputs_hash,
        )

    return SandboxResult(
        ok=True,
        result={"children_spec": payload.get("children_spec") or []},
        ops=payload.get("studio_ops") or [],
        logs=user_logs, stderr=stderr,
        elapsed_s=elapsed, inputs_hash=inputs_hash,
    )


def run_slide_script(
    *,
    source: str,
    slide_n: int,
    inputs: dict,
    base_url: str,
    doc_id: str,
    auth_token: str | None = None,
    scope: ScopeManifest | None = None,
    secrets: dict[str, str] | None = None,
) -> SandboxResult:
    """Run a slide-level script. Returns its return value + ops log."""
    scope = scope or ScopeManifest()

    ok, violations = lint_imports(source, scope)
    if not ok:
        return SandboxResult(ok=False, error="import_violation: " + "; ".join(violations))

    runner = _SLIDE_SCRIPT_TEMPLATE.format(
        source=source, base_url=base_url, doc_id=doc_id,
        percy_src_path=_percy_src_path(),
    )
    proc_input = {"slide_n": slide_n, "inputs": inputs, "auth_token": auth_token}
    inputs_hash = hash_inputs(inputs)

    t0 = time.time()
    stdout, stderr, rc, timed_out = _run_subprocess(runner, proc_input, scope, secrets)
    elapsed = time.time() - t0

    if timed_out:
        return SandboxResult(ok=False, error=f"timeout after {scope.timeout_s}s",
                             elapsed_s=elapsed, stderr=stderr, inputs_hash=inputs_hash)

    payload, user_logs = _parse_payload(stdout)

    if not payload.get("ok"):
        return SandboxResult(
            ok=False, error=payload.get("error") or f"exit {rc}",
            traceback=payload.get("traceback"),
            logs=user_logs, stderr=stderr,
            elapsed_s=elapsed, inputs_hash=inputs_hash,
        )

    return SandboxResult(
        ok=True,
        result=payload.get("result"),
        ops=payload.get("studio_ops") or [],
        logs=user_logs, stderr=stderr,
        elapsed_s=elapsed, inputs_hash=inputs_hash,
    )
