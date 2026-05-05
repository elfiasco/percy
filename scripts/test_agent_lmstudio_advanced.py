"""LM Studio E2E for the advanced agent capabilities.

Exercises:
  1. Deck-from-prompt generation across multiple loaded models
  2. Brand check on a deck the LLM just authored (round-trip)
  3. Slide diff narrator after a chat-driven edit
  4. Audit log: every action recorded with actor/source/snapshot

Each model gets all four sub-tests; we report success rates.

Run:
    python scripts/test_agent_lmstudio_advanced.py
    python scripts/test_agent_lmstudio_advanced.py --model openai/gpt-oss-20b
"""

from __future__ import annotations

import argparse
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


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"}
LM_STUDIO_URL = "http://localhost:1234/v1"


def setup_doc(doc_id: str, n_slides: int = 1) -> None:
    from app.backend import main as backend_main
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                for i in range(n_slides)],
        metadata=PresentationMetadata(slide_count=n_slides),
        theme_colors=THEME,
    )
    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)


def list_models() -> list[str]:
    req = urllib.request.Request(f"{LM_STUDIO_URL}/models")
    with urllib.request.urlopen(req, timeout=5) as r:
        return [m["id"] for m in json.loads(r.read()).get("data", [])]


def section(t: str) -> None:
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


def run_for_model(client: TestClient, model: str) -> dict:
    section(f"MODEL: {model}")
    doc_id = f"adv-test-{model.replace('/', '_')}"
    setup_doc(doc_id, n_slides=1)
    results: dict[str, dict] = {}

    # ── 1. Generate a deck from prompt ────────────────────────────────
    print("\n>> 1. generate-deck")
    t0 = time.time()
    try:
        r = client.post("/api/agent/generate-deck", json={
            "doc_id": doc_id,
            "prompt": "A 5-slide quarterly board update covering revenue, customers, hiring, risks, and outlook.",
            "model": model,
        })
        elapsed = time.time() - t0
        body = r.json()
        ok = bool(body.get("ok"))
        n_applied = len(body.get("applied") or [])
        n_errors = len(body.get("errors") or [])
        plan_slides = len(body.get("plan", {}).get("slides") or [])
        print(f"   {elapsed:.1f}s  ok={ok}  plan={plan_slides} slides  applied={n_applied}  errors={n_errors}")
        for s in (body.get("plan", {}).get("slides") or [])[:6]:
            print(f"     slide {s['slide_n']}: {s['template_name']}")
        for e in (body.get("errors") or [])[:2]:
            print(f"     error: {e}")
        results["generate_deck"] = {"ok": ok, "elapsed": elapsed,
                                     "plan_slides": plan_slides, "applied": n_applied,
                                     "errors": n_errors}
    except Exception as exc:
        print(f"   FAIL: {exc}")
        results["generate_deck"] = {"ok": False, "error": str(exc)}

    # ── 2. Brand check after generation ───────────────────────────────
    print("\n>> 2. brand-check (after generation)")
    try:
        r = client.post(f"/api/docs/{doc_id}/brand-check", json={})
        if r.status_code == 200:
            body = r.json()
            n_viol = body["summary"]["violation_count"]
            n_palette = len(body["summary"]["palette_seen"])
            print(f"   profile={body['profile']}, violations={n_viol}, palette_seen={n_palette}")
            results["brand_check"] = {"ok": True, "violations": n_viol, "palette_seen": n_palette}
        else:
            print(f"   FAIL: {r.status_code}")
            results["brand_check"] = {"ok": False}
    except Exception as exc:
        print(f"   FAIL: {exc}")
        results["brand_check"] = {"ok": False, "error": str(exc)}

    # ── 3. Diff narrator: snapshot 0 → live ──────────────────────────
    print("\n>> 3. diff narrator")
    try:
        from app.backend import main as backend_main
        # Snapshot 0 was taken by the generator; check we can diff
        stack = backend_main._docs[doc_id].get("_undo_stack") or []
        if stack:
            r = client.post(f"/api/docs/{doc_id}/diff", json={"before": 0})
            body = r.json()
            print(f"   {body.get('summary')}")
            print(f"   {body.get('long_summary', '').split(chr(10))[0]}")
            results["diff"] = {"ok": True, "summary": body.get("summary")}
        else:
            print("   no snapshots — skipping")
            results["diff"] = {"ok": False, "skipped": True}
    except Exception as exc:
        print(f"   FAIL: {exc}")
        results["diff"] = {"ok": False, "error": str(exc)}

    # ── 4. Audit log ─────────────────────────────────────────────────
    print("\n>> 4. audit log")
    try:
        r = client.get(f"/api/agent/actions?doc_id={doc_id}&limit=20")
        actions = r.json().get("actions", [])
        actors = {a.get("actor") for a in actions}
        sources = {a.get("source") for a in actions}
        n_executed = sum(1 for a in actions if a.get("status") == "executed")
        n_with_snapshot = sum(1 for a in actions if a.get("snapshot_index") is not None)
        print(f"   {len(actions)} actions; actors={actors}; sources={sources}")
        print(f"   {n_executed} executed; {n_with_snapshot} have snapshot_index")
        results["audit"] = {"ok": True, "count": len(actions), "actors": list(actors),
                            "sources": list(sources), "with_snapshot": n_with_snapshot}
    except Exception as exc:
        print(f"   FAIL: {exc}")
        results["audit"] = {"ok": False, "error": str(exc)}

    return {"model": model, "doc_id": doc_id, "results": results}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=None)
    p.add_argument("--all", action="store_true")
    args = p.parse_args()

    print("Booting Percy app...")
    from app.backend import main as backend_main
    client = TestClient(backend_main.app)

    print("Querying LM Studio for loaded models...")
    try:
        loaded = list_models()
    except Exception as exc:
        print(f"  cannot reach LM Studio: {exc}")
        sys.exit(1)
    print(f"  loaded: {loaded}")

    if args.model:
        targets = [args.model]
    elif args.all:
        targets = [m for m in loaded if "embed" not in m.lower()
                   and "1b" not in m.lower()]  # skip embeddings + tiny llama
    else:
        prefs = ["qwen/qwen3-coder-30b", "openai/gpt-oss-20b", "google/gemma-4-e4b"]
        targets = [next((m for m in prefs if m in loaded), loaded[0])]

    all_results = []
    for m in targets:
        try:
            r = run_for_model(client, m)
        except Exception as exc:
            r = {"model": m, "results": {}, "error": str(exc)}
        all_results.append(r)

    # ── Final summary ──────────────────────────────────────────────────
    section("OVERALL SUMMARY")
    header = f"{'model':<35s}  deck   brand    diff   audit  notes"
    print(header)
    print("-" * len(header))
    for r in all_results:
        gd = r["results"].get("generate_deck", {})
        bc = r["results"].get("brand_check", {})
        df = r["results"].get("diff", {})
        au = r["results"].get("audit", {})
        deck_str = f"{gd.get('applied', 0):>2}/{gd.get('plan_slides', 0):<2}" if gd.get("ok") else "FAIL"
        brand_str = f"{bc.get('violations', '?')}V" if bc.get("ok") else "FAIL"
        diff_str = "ok" if df.get("ok") else ("skip" if df.get("skipped") else "FAIL")
        audit_str = f"{au.get('count', 0)}" if au.get("ok") else "FAIL"
        print(f"{r['model']:<35s}  {deck_str:<5s}  {brand_str:<6s}  {diff_str:<5s}  {audit_str:<5s}  {r.get('error', '')[:30]}")


if __name__ == "__main__":
    main()
