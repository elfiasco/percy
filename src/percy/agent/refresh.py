"""Refresh agent — run all connect scripts in a doc, capture changes, narrate.

This is the "every Monday morning the deck refreshes itself" loop from
the vision doc.

Walks every BridgeElement that has ``custom_properties["connect"]["script"]``,
plus every BridgeSlide that has a slide-level script, plus every live
BridgeGroup with a generator. Runs them in dependency order:

  1. Slide-level scripts first (they may shape elements)
  2. Live group regenerators (they produce / replace children)
  3. Per-element connects (they shape data on existing elements)

Before-and-after snapshots are taken; the diff_narrator produces a summary
of what changed. Result includes per-script logs + the full structured diff.

This module is a pure orchestrator — the actual sandbox execution goes
through ``percy.agent.sandbox`` and the existing ``connect/test`` endpoint.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from percy.agent import connect_apply, diff_narrator, sandbox
from percy.agent.script_api import Studio
from percy.agent.sandbox import ScopeManifest

log = logging.getLogger(__name__)


@dataclass(slots=True)
class ScriptOutcome:
    kind:        str        # 'connect' | 'slide_script' | 'live_group'
    slide_n:     int
    element_id:  str | None
    name:        str
    ok:          bool
    elapsed_s:   float
    logs:        str = ""
    error:       str | None = None
    output_summary: str | None = None
    applied:     bool = False
    apply_reason: str | None = None    # why apply did/didn't happen


@dataclass(slots=True)
class RefreshReport:
    doc_id:      str
    started_at:  float
    finished_at: float
    outcomes:    list[ScriptOutcome] = field(default_factory=list)
    diff_summary: str = ""
    diff_long:   str = ""
    snapshot_before_index: int | None = None

    @property
    def total_elapsed_s(self) -> float:
        return self.finished_at - self.started_at

    @property
    def n_scripts(self) -> int:
        return len(self.outcomes)

    @property
    def n_ok(self) -> int:
        return sum(1 for o in self.outcomes if o.ok)

    @property
    def n_failed(self) -> int:
        return self.n_scripts - self.n_ok

    @property
    def n_applied(self) -> int:
        return sum(1 for o in self.outcomes if o.applied)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "started_at": self.started_at, "finished_at": self.finished_at,
            "total_elapsed_s": round(self.total_elapsed_s, 2),
            "n_scripts": self.n_scripts, "n_ok": self.n_ok, "n_failed": self.n_failed,
            "n_applied": self.n_applied,
            "diff_summary": self.diff_summary, "diff_long": self.diff_long,
            "snapshot_before_index": self.snapshot_before_index,
            "outcomes": [
                {
                    "kind": o.kind, "slide_n": o.slide_n, "element_id": o.element_id,
                    "name": o.name, "ok": o.ok, "elapsed_s": round(o.elapsed_s, 2),
                    "error": o.error, "logs": (o.logs or "")[:500],
                    "output_summary": o.output_summary,
                    "applied": o.applied,
                    "apply_reason": o.apply_reason,
                }
                for o in self.outcomes
            ],
        }


# ── Discovery ──────────────────────────────────────────────────────────────


def find_runnable_scripts(doc: Any) -> list[dict]:
    """Walk a doc and return a list of script descriptors in run-order.

    Order: slide_script → live_group → connect. Each descriptor:
      {kind, slide_n, element_id?, name, source, inputs, scope?}
    """
    out: list[dict] = []

    # Slide-level scripts
    for slide in (doc.slides or []):
        if getattr(slide, "script", None):
            out.append({
                "kind": "slide_script", "slide_n": slide.slide_number,
                "element_id": None, "name": f"slide{slide.slide_number}.script",
                "source": slide.script,
                "inputs": dict(getattr(slide, "script_inputs", None) or {}),
            })

    # Live-group generators
    for slide in (doc.slides or []):
        for el in (slide.elements or []):
            if el.element_type == "BridgeGroup" and getattr(el, "generator_script", None):
                ident = getattr(el, "identification", None)
                eid = str(getattr(ident, "shape_id", "") or "")
                out.append({
                    "kind": "live_group", "slide_n": slide.slide_number,
                    "element_id": eid, "name": ident.shape_name or f"group-{eid}",
                    "source": el.generator_script,
                    "inputs": dict(el.generator_inputs or {}),
                })

    # Per-element connects
    for slide in (doc.slides or []):
        for el in (slide.elements or []):
            cp = getattr(el, "custom_properties", None) or {}
            connect = (cp.get("connect") or {}).get("script")
            if connect:
                ident = getattr(el, "identification", None)
                eid = str(getattr(ident, "shape_id", "") or "")
                out.append({
                    "kind": "connect", "slide_n": slide.slide_number,
                    "element_id": eid, "name": ident.shape_name or f"element-{eid}",
                    "source": connect,
                    "inputs": dict((cp.get("connect") or {}).get("inputs") or {}),
                })

    return out


# ── Execution ──────────────────────────────────────────────────────────────


def _run_one(
    descriptor: dict, *, doc_id: str, base_url: str, auth_token: str | None,
    user_id: str | None = None, org_id: str | None = None,
) -> ScriptOutcome:
    kind = descriptor["kind"]
    scope = ScopeManifest()  # use defaults; per-script scope can be wired later

    secrets = {}
    try:
        from percy.agent import secrets_store
        secrets = secrets_store.resolve_for_user(user_id, org_id, list(scope.secret_keys))
    except Exception:
        pass

    if kind == "slide_script":
        result = sandbox.run_slide_script(
            source=descriptor["source"],
            slide_n=descriptor["slide_n"],
            inputs=descriptor["inputs"],
            base_url=base_url, doc_id=doc_id, auth_token=auth_token,
            scope=scope, secrets=secrets,
        )
    elif kind == "live_group":
        # Live group regen requires the doc state for existing children — easier
        # to just hit the regenerate endpoint via the studio HTTP path. For the
        # refresh agent we approximate by running the generator directly without
        # the existing-children context (option C still respected).
        # We need group position for the runner — the sandbox runner doesn't
        # need it though when the generator script uses absolute coords. For
        # this initial implementation we skip the position rebase.
        result = sandbox.run_live_group_generator(
            source=descriptor["source"],
            slide_n=descriptor["slide_n"],
            position={"left_in": 0, "top_in": 0, "width_in": 13.333, "height_in": 7.5},
            inputs=descriptor["inputs"],
            existing_children=[],
            base_url=base_url, doc_id=doc_id, auth_token=auth_token,
            scope=scope, secrets=secrets,
        )
    elif kind == "connect":
        # The legacy connect runner doesn't go through our sandbox module —
        # it lives in main.py. For consistency, reuse the slide_script runner
        # since connects ALSO have access to the studio client + inputs. The
        # connect "result" is whatever the script's _user_main returned; we
        # don't try to apply it back to the element here (that's the studio's
        # /connect/test endpoint job). The refresh just records it.
        result = sandbox.run_slide_script(
            source=descriptor["source"],
            slide_n=descriptor["slide_n"],
            inputs=descriptor["inputs"],
            base_url=base_url, doc_id=doc_id, auth_token=auth_token,
            scope=scope, secrets=secrets,
        )
    else:
        return ScriptOutcome(kind=kind, slide_n=descriptor["slide_n"],
                             element_id=descriptor.get("element_id"),
                             name=descriptor["name"], ok=False, elapsed_s=0,
                             error=f"unknown script kind: {kind}")

    output_summary = None
    if result.ok and result.result is not None:
        try:
            import json as _json
            output_summary = _json.dumps(result.result, default=str)[:200]
        except Exception:
            output_summary = repr(result.result)[:200]

    return ScriptOutcome(
        kind=kind,
        slide_n=descriptor["slide_n"],
        element_id=descriptor.get("element_id"),
        name=descriptor["name"],
        ok=result.ok,
        elapsed_s=result.elapsed_s,
        logs=result.logs,
        error=result.error,
        output_summary=output_summary,
    )


def refresh_doc(
    doc_id: str,
    *,
    snapshot_taker,                # callable() that takes a snapshot and returns the index
    doc_getter,                    # callable() that returns the live doc
    base_url: str, auth_token: str | None,
    user_id: str | None = None, org_id: str | None = None,
    asgi_app: Any = None,
    apply_connect_outputs: bool = True,
) -> RefreshReport:
    """Run every script in the doc; apply outputs to bound elements; report diff."""
    started = time.time()

    # Snapshot the doc *before* anything runs (rollback target).
    snapshot_index = snapshot_taker()

    doc_before = doc_getter()
    descriptors = find_runnable_scripts(doc_before)
    log.info("refresh: %d scripts to run for doc %s", len(descriptors), doc_id)

    # Studio client for applying connect outputs back to elements.
    studio = Studio(
        base_url=base_url, doc_id=doc_id, auth_token=auth_token,
        timeout_s=10, asgi_app=asgi_app,
    )

    outcomes: list[ScriptOutcome] = []
    for d in descriptors:
        outcome = _run_one(
            d, doc_id=doc_id, base_url=base_url, auth_token=auth_token,
            user_id=user_id, org_id=org_id,
        )

        # If this is a connect script and it returned an output, apply it.
        if (apply_connect_outputs and outcome.ok and d["kind"] == "connect"
                and outcome.output_summary):
            try:
                # Re-fetch the doc to get the live element_type
                live = doc_getter()
                etype = connect_apply.find_element_type(live, d["slide_n"], d["element_id"])
                if etype:
                    # Re-extract the actual result (output_summary is just a preview)
                    # by re-running with the same inputs would be wasteful; instead,
                    # we trust the previous run and reconstruct the output dict from
                    # the script's stdin/stdout. Since the sandbox already returned
                    # the parsed result on the SandboxResult.result, we'd need to
                    # plumb that through. Quick approach: re-run the script as a
                    # slide_script (which captures result) and apply.
                    rerun = sandbox.run_slide_script(
                        source=d["source"],
                        slide_n=d["slide_n"], inputs=d["inputs"],
                        base_url=base_url, doc_id=doc_id, auth_token=auth_token,
                    )
                    if rerun.ok and rerun.result is not None:
                        ar = connect_apply.apply_connect_output(
                            studio=studio, slide_n=d["slide_n"], element_id=d["element_id"],
                            element_type=etype, output=rerun.result,
                        )
                        outcome.applied = ar.applied
                        outcome.apply_reason = ar.reason
            except Exception as exc:
                outcome.apply_reason = f"apply error: {exc}"

        outcomes.append(outcome)

    finished = time.time()

    # Snapshot the doc *after* everything ran for diffing
    doc_after = doc_getter()
    # Get the before snapshot from the undo stack via doc_getter (caller passes
    # the snapshotted blob if needed). Here we diff the before-and-after live
    # objects since we have direct refs.
    diff = diff_narrator.diff_docs(doc_before, doc_after)

    return RefreshReport(
        doc_id=doc_id,
        started_at=started, finished_at=finished,
        outcomes=outcomes,
        diff_summary=diff.short_summary(),
        diff_long=diff.long_summary(max_lines=20),
        snapshot_before_index=snapshot_index,
    )
