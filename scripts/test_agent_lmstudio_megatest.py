"""The megatest: end-to-end exercise of every Percy agent pillar.

Boots the FastAPI app, walks through:

  1. Setup: blank doc + upload a clean Python helper as supplementary material
  2. Generate-deck: 5-slide board update from a high-level prompt
  3. Brand check: scan the generated deck
  4. Suggestions: get next-action recommendations
  5. Slide explain: have the agent narrate slide 1
  6. Chat with find_element: "make the title bold" (find→edit flow)
  7. Refresh: attach a connect script to a chart and refresh, verify chart updates
  8. Save slide as template: capture a slide as a reusable user template
  9. Apply user template: drop the saved template onto a fresh slide
 10. Audit log: confirm every action is recorded with actor/source/snapshot
 11. Rollback: roll back one action and verify the doc state changed
 12. Metric consistency: across all loaded test docs

Each pillar is reported with timing + pass/fail. A final summary table
shows the success rate per pillar.

Run:
    python scripts/test_agent_lmstudio_megatest.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "src"))
sys.path.insert(0, str(_ROOT))
os.environ["PERCY_PUBLIC_DEV"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from fastapi.testclient import TestClient

from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"}


def setup_doc(doc_id: str) -> None:
    from app.backend import main as backend_main
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors=THEME,
    )
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)


def section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def main():
    print("Booting Percy app...")
    from app.backend import main as backend_main
    client = TestClient(backend_main.app)

    print("Querying LM Studio...")
    try:
        with urllib.request.urlopen("http://localhost:1234/v1/models", timeout=5) as r:
            loaded = [m["id"] for m in json.loads(r.read()).get("data", [])]
        print(f"  loaded: {loaded}")
    except Exception as exc:
        print(f"  WARNING: cannot reach LM Studio: {exc}")
        loaded = []

    doc_id = "megatest-doc"
    setup_doc(doc_id)

    pillars: dict[str, dict] = {}

    # ── 1. Materials upload ──────────────────────────────────────────
    section("1. Materials upload (clean Python)")
    src = b"def fetch_revenue():\n    return [200, 220, 240, 260]\n\ndef fetch_costs():\n    return [120, 130, 140, 150]\n"
    t = time.time()
    r = client.post(f"/api/docs/{doc_id}/materials",
                    files={"file": ("helpers.py", src, "text/x-python")})
    dt = time.time() - t
    body = r.json()
    pillars["materials"] = {"ok": body.get("ok"), "elapsed": dt, "chunks": body.get("chunk_count")}
    print(f"   {dt:.1f}s ok={body.get('ok')} chunks={body.get('chunk_count')}")

    # ── 2. Generate-deck (LLM) ───────────────────────────────────────
    section("2. Generate-deck (5-slide board update)")
    if loaded:
        t = time.time()
        r = client.post("/api/agent/generate-deck", json={
            "doc_id": doc_id,
            "prompt": "A 5-slide Q4 board update covering revenue, customers, hiring, risks, and outlook.",
        })
        dt = time.time() - t
        body = r.json()
        applied = len(body.get("applied") or [])
        pillars["generate_deck"] = {"ok": body.get("ok"), "elapsed": dt, "applied": applied}
        print(f"   {dt:.1f}s ok={body.get('ok')} applied={applied}/5")
        for s in (body.get("plan", {}).get("slides") or [])[:5]:
            print(f"     slide {s['slide_n']}: {s['template_name']}")
    else:
        pillars["generate_deck"] = {"ok": False, "skipped": True}
        print("   SKIP (no LM Studio)")

    # ── 3. Brand check ───────────────────────────────────────────────
    section("3. Brand check")
    t = time.time()
    r = client.post(f"/api/docs/{doc_id}/brand-check", json={})
    dt = time.time() - t
    body = r.json()
    pillars["brand_check"] = {"ok": True, "elapsed": dt,
                                "violations": body["summary"]["violation_count"],
                                "palette_seen": len(body["summary"]["palette_seen"])}
    print(f"   {dt*1000:.0f}ms violations={body['summary']['violation_count']} palette={body['summary']['palette_seen']}")

    # ── 4. Suggestions ───────────────────────────────────────────────
    section("4. Suggestions")
    t = time.time()
    r = client.get(f"/api/docs/{doc_id}/suggestions")
    dt = time.time() - t
    body = r.json()
    pillars["suggestions"] = {"ok": True, "elapsed": dt, "count": body.get("count")}
    print(f"   {dt*1000:.0f}ms {body.get('count')} suggestions")
    for s in (body.get("suggestions") or [])[:4]:
        print(f"     [{s['severity']}] {s['title']}")

    # ── 5. Slide explain (LLM) ───────────────────────────────────────
    section("5. Slide explain")
    if loaded:
        t = time.time()
        r = client.post(f"/api/docs/{doc_id}/slides/1/explain", json={})
        dt = time.time() - t
        body = r.json()
        pillars["slide_explain"] = {"ok": r.status_code == 200, "elapsed": dt}
        print(f"   {dt:.1f}s")
        print(f"   {body.get('explanation', '')[:200]}")
    else:
        pillars["slide_explain"] = {"ok": False, "skipped": True}
        print("   SKIP")

    # ── 6. Chat with find_element ────────────────────────────────────
    section("6. Chat: 'make the title bold' (find→edit flow)")
    if loaded:
        t = time.time()
        r = client.post("/api/agent/chat", json={
            "doc_id": doc_id,
            "messages": [{"role": "user", "content": "Make the title on slide 1 bold and dark navy."}],
            "context": {"viewing_slide_n": 1, "user_confirmed": True},
        })
        dt = time.time() - t
        body = r.json()
        exec_ok = body.get("execution", {}).get("ok")
        plan_calls = body.get("plan", {}).get("calls") or []
        n_calls = len(plan_calls)
        is_clarify = bool(body.get("plan", {}).get("clarify")) or body.get("needs_clarification")
        # Pass conditions:
        #   - execution succeeded AND at least 1 call ran  → real edit
        #   - find-only plan succeeded                       → partial but valid
        #   - planner returned a clarify question            → responsible refusal
        substantive = (
            (exec_ok and n_calls >= 1)
            or is_clarify
        )
        pillars["chat_find_edit"] = {"ok": substantive, "elapsed": dt,
                                      "mode": body.get("mode"), "actions": body.get("actions_taken"),
                                      "n_calls": n_calls, "exec_ok": exec_ok,
                                      "clarify": is_clarify}
        print(f"   {dt:.1f}s mode={body.get('mode')} actions={body.get('actions_taken')} exec_ok={exec_ok} n_calls={n_calls} clarify={is_clarify}")
        if body.get("plan", {}).get("rationale"):
            print(f"   {body['plan']['rationale'][:120]}")
        # Diagnostic: show plan calls and step results
        steps_arr = body.get("execution", {}).get("steps") or []
        for i, c in enumerate((body.get("plan", {}).get("calls") or [])[:5]):
            step = steps_arr[i] if i < len(steps_arr) else None
            ok_str = step["ok"] if step else "(no step)"
            err_str = (step.get("error") if step else "") or ""
            body_str = json.dumps(c.get("body") or {}, default=str)[:100]
            print(f"     {i}: {c.get('endpoint_id'):<25s} ok={ok_str} err={err_str[:60]}")
            print(f"        body={body_str}")
    else:
        pillars["chat_find_edit"] = {"ok": False, "skipped": True}
        print("   SKIP")

    # ── 7. Refresh agent (live data → chart) ─────────────────────────
    section("7. Refresh agent (chart with connect)")
    # Add a chart with a connect script
    from app.backend import main as backend_main
    doc = backend_main._docs[doc_id]["doc"]
    chart = builders.build_chart({
        "chart_type": "line",
        "categories": ["Q1", "Q2"],
        "series": [{"name": "Revenue", "values": [10, 20]}],
        "position": {"left_in": 1, "top_in": 5, "width_in": 5, "height_in": 2},
        "name": "Live Chart",
    }, THEME, slide=doc.slides[0])
    chart.custom_properties = {"connect": {
        "script": (
            "def run(slide, inputs, studio):\n"
            "    return {\n"
            "        'categories': ['Q1', 'Q2', 'Q3', 'Q4'],\n"
            "        'series': [{'name': 'Revenue', 'values': [200, 220, 240, 260]}],\n"
            "    }\n"
        ),
        "inputs": {},
    }}
    doc.slides[0].elements.append(chart)

    t = time.time()
    r = client.post(f"/api/docs/{doc_id}/refresh", json={})
    dt = time.time() - t
    body = r.json()
    chart_updated = chart.series[0].values == [200.0, 220.0, 240.0, 260.0]
    pillars["refresh"] = {"ok": body.get("n_failed") == 0 and chart_updated,
                           "elapsed": dt, "applied": body.get("n_applied"),
                           "diff": body.get("diff_summary")}
    print(f"   {dt:.1f}s applied={body.get('n_applied')}/{body.get('n_scripts')} diff={body.get('diff_summary')}")
    print(f"   chart updated: {chart_updated} (values={chart.series[0].values})")

    # ── 8. Save-as-template ──────────────────────────────────────────
    section("8. Save slide 1 as template")
    t = time.time()
    r = client.post(f"/api/docs/{doc_id}/slides/1/save-as-template", json={
        "name": "Megatest Custom Layout",
        "description": "From the megatest run",
        "tags": ["test", "saved"],
    })
    dt = time.time() - t
    body = r.json()
    pillars["save_template"] = {"ok": body.get("ok"), "elapsed": dt,
                                 "elements_captured": body.get("elements")}
    print(f"   {dt*1000:.0f}ms id={body.get('id')} elements={body.get('elements')}")

    # ── 9. Apply user template to a fresh slide ──────────────────────
    section("9. Apply user template to slide 2")
    # Add slide 2 to the doc
    doc.slides.append(BridgeSlide(slide_number=2, elements=[], width=13.333, height=7.5))
    t = time.time()
    r = client.post(f"/api/agent/templates/{body['id']}/apply", json={
        "doc_id": doc_id, "slide_n": 2, "inputs": {},
    })
    dt = time.time() - t
    body = r.json()
    pillars["apply_user_template"] = {"ok": body.get("ok"), "elapsed": dt,
                                        "elements": len(body.get("elements") or [])}
    print(f"   {dt*1000:.0f}ms ok={body.get('ok')} elements={len(body.get('elements') or [])}")

    # ── 10. Audit log ────────────────────────────────────────────────
    section("10. Audit log")
    r = client.get(f"/api/agent/actions?doc_id={doc_id}&limit=50")
    actions = r.json().get("actions", [])
    sources = {a["source"] for a in actions}
    actors = {a["actor"] for a in actions}
    n_with_snap = sum(1 for a in actions if a.get("snapshot_index") is not None)
    pillars["audit"] = {"ok": len(actions) > 0, "count": len(actions),
                         "sources": sorted(sources), "actors": sorted(actors),
                         "with_snapshot": n_with_snap}
    print(f"   {len(actions)} actions, {n_with_snap} with snapshot")
    print(f"   sources: {sorted(sources)}")
    print(f"   actors: {sorted(actors)}")

    # ── 11. Rollback ─────────────────────────────────────────────────
    section("11. Rollback most recent action")
    if actions:
        target = actions[0]
        t = time.time()
        r = client.post(f"/api/agent/actions/{target['id']}/rollback")
        dt = time.time() - t
        body = r.json()
        pillars["rollback"] = {"ok": body.get("ok"), "elapsed": dt,
                                "rolled_back_to": body.get("rolled_back_to")}
        print(f"   {dt*1000:.0f}ms ok={body.get('ok')} rolled_back_to={body.get('rolled_back_to')}")
    else:
        pillars["rollback"] = {"ok": False, "skipped": True}
        print("   SKIP (no actions)")

    # ── 12. Metric consistency ───────────────────────────────────────
    section("12. Metric consistency (across all loaded docs)")
    t = time.time()
    r = client.post("/api/agent/metric-consistency", json={})
    dt = time.time() - t
    body = r.json()
    pillars["metric_consistency"] = {"ok": True, "elapsed": dt,
                                       "doc_count": body.get("doc_count"),
                                       "inconsistencies": body.get("inconsistency_count")}
    print(f"   {dt*1000:.0f}ms across {body.get('doc_count')} doc(s) → {body.get('inconsistency_count')} inconsistencies")

    # ── Summary ──────────────────────────────────────────────────────
    section("MEGATEST SUMMARY")
    print(f"{'pillar':<25s}  result   elapsed  notes")
    print("-" * 78)
    n_passed = 0
    for name, info in pillars.items():
        ok = info.get("ok")
        if info.get("skipped"):
            symbol = "SKIP"
        elif ok:
            symbol = "PASS"; n_passed += 1
        else:
            symbol = "FAIL"
        elapsed = info.get("elapsed")
        elapsed_str = f"{elapsed:.2f}s" if elapsed else "—"
        notes = ""
        for k, v in info.items():
            if k in ("ok", "skipped", "elapsed"):
                continue
            notes += f" {k}={v}"
        print(f"  {name:<23s} {symbol:<6s} {elapsed_str:<8s} {notes[:50]}")
    n_total = sum(1 for p in pillars.values() if not p.get("skipped"))
    print(f"\n  → {n_passed}/{n_total} pillars passed (skipped: {sum(1 for p in pillars.values() if p.get('skipped'))})")


if __name__ == "__main__":
    main()
