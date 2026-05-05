"""End-to-end LM Studio test of templates + materials + chat in one flow.

Boots the FastAPI app, registers a fresh test deck, then exercises:

  1. Templates list / search
  2. Apply Percy Standard "Title" template directly
  3. Materials upload + retrieval (clean file)
  4. Materials upload + rejection (file with secrets)
  5. Chat: "apply the title template with title='Q4 Update' to slide 1"
  6. Chat: "create a 7-bar timeline" — exercises scripted_plan + live group
  7. Activity log read-back + rollback test

Run:
    python scripts/test_agent_lmstudio_full.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
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


def setup_doc(doc_id: str) -> None:
    from app.backend import main as backend_main
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                for i in range(3)],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=3),
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
    p = argparse.ArgumentParser()
    p.add_argument("--skip-chat", action="store_true",
                   help="Skip LLM-driven chat tests (templates+materials only)")
    args = p.parse_args()

    print("Booting Percy app...")
    from app.backend import main as backend_main
    client = TestClient(backend_main.app)

    doc_id = "lmstudio-full-e2e"
    setup_doc(doc_id)

    # ── 1. Templates list ────────────────────────────────────────────────
    section("1. Templates list")
    r = client.get("/api/agent/templates")
    body = r.json()
    print(f"   {len(body['templates'])} templates available")
    for t in body["templates"][:5]:
        print(f"   - {t['name']:<30s}  {len(t['layout'])} elements  builtin={t['is_builtin']}")

    # ── 2. Apply title template directly ─────────────────────────────────
    section("2. Apply 'Title' template to slide 1")
    r = client.post("/api/agent/templates/std.title/apply", json={
        "doc_id": doc_id, "slide_n": 1,
        "inputs": {"title": "Q4 2025 Board Update", "subtitle": "December 2025"},
    })
    body = r.json()
    print(f"   ok={body['ok']}, elements={len(body['elements'])}")
    for e in body["elements"]:
        print(f"     - {e['kind']}/{e['alias']}  → element_id={e['element_id']}")

    # ── 3. Apply KPI tiles ───────────────────────────────────────────────
    section("3. Apply 'KPI Tiles' template to slide 2")
    r = client.post("/api/agent/templates/std.kpi_tiles/apply", json={
        "doc_id": doc_id, "slide_n": 2,
        "inputs": {
            "title": "Q4 Highlights",
            "metric_1_label": "Revenue", "metric_1_value": "$4.2M",
            "metric_2_label": "Net Retention", "metric_2_value": "118%",
            "metric_3_label": "Headcount", "metric_3_value": "68",
        },
    })
    body = r.json()
    print(f"   ok={body['ok']}, elements={len(body['elements'])} (expected 10)")

    # ── 4. Apply live timeline ────────────────────────────────────────────
    section("4. Apply 'Live Timeline' template to slide 3")
    r = client.post("/api/agent/templates/std.live_timeline/apply", json={
        "doc_id": doc_id, "slide_n": 3,
        "inputs": {"title": "Sprint 14", "day_count": 7, "labels": "Mon,Tue,Wed,Thu,Fri,Sat,Sun"},
    })
    body = r.json()
    print(f"   ok={body['ok']}")
    for e in body["elements"]:
        print(f"     - {e['kind']}/{e['alias']}")
    # Verify the live group on slide 3 has 7 children
    slide3 = backend_main._docs[doc_id]["doc"].slides[2]
    groups = [el for el in slide3.elements if el.element_type == "BridgeGroup"]
    if groups:
        print(f"   live group child_count={len(groups[0].children)}")
        for c in groups[0].children[:3]:
            text = ""
            try:
                text = c.text_content.paragraphs[0].runs[0].text
            except Exception:
                pass
            print(f"     child {c.identification.shape_name!r} text={text!r}")

    # ── 5. Materials: upload clean file ──────────────────────────────────
    section("5. Materials: upload clean Python helper")
    src = b"""
def fetch_revenue(quarter):
    \"\"\"Returns quarterly revenue figures from the warehouse.\"\"\"
    return {"Q1": 100, "Q2": 120, "Q3": 130, "Q4": 140}.get(quarter)

def fetch_costs(quarter):
    return {"Q1": 80, "Q2": 90, "Q3": 95, "Q4": 100}.get(quarter)
"""
    r = client.post(
        f"/api/docs/{doc_id}/materials",
        files={"file": ("helpers.py", src, "text/x-python")},
    )
    body = r.json()
    print(f"   ok={body['ok']} chunks={body.get('chunk_count')} kind={body.get('kind')}")
    print(f"   security: findings={len(body['security']['findings'])}, dangerous_imports={body['security']['dangerous_imports']}")

    # ── 6. Materials: upload file with secrets (rejected) ───────────────
    section("6. Materials: upload file with plaintext secret (should reject)")
    bad_src = b"""
import os
PASSWORD = 'super-secret-password-1234'
KEY = 'AKIA1234567890ABCDEF'

def f():
    return PASSWORD
"""
    r = client.post(
        f"/api/docs/{doc_id}/materials",
        files={"file": ("creds.py", bad_src, "text/x-python")},
    )
    body = r.json()
    print(f"   ok={body['ok']}, hard_rejected={body.get('hard_rejected')}")
    if body.get("security"):
        for f in body["security"]["findings"][:3]:
            print(f"     finding: {f['kind']} on line {f['line']}")
    print(f"   message: {body.get('message')}")

    # ── 7. Materials retrieval ───────────────────────────────────────────
    section("7. Materials: retrieve chunks for 'revenue'")
    r = client.post("/api/agent/retrieve_chunks", json={
        "doc_id": doc_id, "query": "revenue", "top_k": 3,
    })
    body = r.json()
    print(f"   {len(body['chunks'])} matches")
    for c in body["chunks"]:
        print(f"     {c['filename']} :: {c['name']:<20s}  score={c['score']}")

    # ── 8. List materials ────────────────────────────────────────────────
    section("8. Materials list")
    r = client.get(f"/api/docs/{doc_id}/materials")
    for m in r.json()["materials"]:
        print(f"   {m['filename']:<20s}  {m['file_kind']:<8s}  starter={m['usable_as_starter']}")

    # ── 9. Audit log ─────────────────────────────────────────────────────
    section("9. Audit log")
    r = client.get(f"/api/agent/actions?doc_id={doc_id}&limit=10")
    actions = r.json()["actions"]
    print(f"   {len(actions)} actions recorded")
    for a in actions[:5]:
        print(f"   [{a['kind']}/{a['mode'] or '-':<15s}] {a['status']:<9s} '{(a['prompt'] or '')[:50]}'")

    # ── 10. Chat-driven flow (LLM) ───────────────────────────────────────
    if not args.skip_chat:
        section("10. Chat: 'add a column chart of Q1-Q4 revenue'")
        t0 = time.time()
        r = client.post("/api/agent/chat", json={
            "doc_id": doc_id,
            "messages": [{"role": "user",
                          "content": "Add a column chart of Q1-Q4 revenue: 100, 120, 130, 140 in the middle of slide 1."}],
            "context": {"viewing_slide_n": 1, "user_confirmed": True},
        })
        elapsed = time.time() - t0
        body = r.json()
        print(f"   {elapsed:.1f}s · mode={body.get('mode')} actions={body.get('actions_taken')} ok={body.get('execution',{}).get('ok')}")
        if body.get("plan", {}).get("rationale"):
            print(f"   rationale: {body['plan']['rationale']}")

    # Done.
    section("DONE")
    print(f"   doc has {sum(len(s.elements) for s in backend_main._docs[doc_id]['doc'].slides)} elements across 3 slides")


if __name__ == "__main__":
    main()
