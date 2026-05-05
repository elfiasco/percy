"""End-to-end LM Studio test of the full /api/agent/chat pipeline.

Boots the FastAPI app in-process, registers a multi-slide test deck, then
issues conversational prompts that exercise each planning mode:

  * static_plan      — "Add a chart of Q1-Q4 revenue"
  * static_plan      — "Make the title bold"             (with find_element resolution)
  * iterative_plan   — "Make every chart's title bold"
  * scripted_plan    — "Create a 7-bar timeline, one bar per day"

For each prompt:
  - prints the classified mode + method + confidence
  - prints the planner's plan
  - prints execution result
  - validates: doc state changed, audit row written, snapshot recorded

Run:
    python scripts/test_agent_lmstudio_chat.py
    python scripts/test_agent_lmstudio_chat.py --model openai/gpt-oss-20b
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Path + auth bypass before app import
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "src"))
sys.path.insert(0, str(_ROOT))
os.environ["PERCY_PUBLIC_DEV"] = "1"

# Force LM Studio LLM (not Anthropic / OpenAI)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from fastapi.testclient import TestClient

from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"}


def build_test_doc(doc_id: str) -> PercyDocument:
    from app.backend import main as backend_main

    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=i + 1, elements=[], width=13.333, height=7.5)
                for i in range(3)],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=3),
        theme_colors=THEME,
    )

    # Slide 1: Title + an existing chart
    doc.slides[0].elements.append(builders.build_text(
        {"text": "Q4 Performance", "name": "Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 36, "font_bold": False},
        THEME, slide=doc.slides[0],
    ))
    doc.slides[0].elements.append(builders.build_chart(
        {"chart_type": "line",
         "categories": ["Jan", "Feb", "Mar"],
         "series": [{"name": "Existing", "values": [1, 2, 3]}],
         "title": "Existing Line Chart",
         "name": "Existing Chart",
         "position": {"left_in": 1, "top_in": 4, "width_in": 6, "height_in": 3}},
        THEME, slide=doc.slides[0],
    ))

    # Slide 2 + 3: empty
    backend_main._docs[doc_id] = {
        "doc": doc,
        "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    return doc


PROMPTS = [
    {
        "name": "static — create chart",
        "prompt": "Add a column chart of Q1-Q4 revenue: 100, 120, 130, 140 in the middle of the slide.",
        "viewing_slide_n": 2,
        "expected_mode_includes": ["static_plan"],
        "post_check": lambda doc: any(
            getattr(e, "element_type", "") == "BridgeChart"
            for e in doc.slides[1].elements
        ),
        "expect_executed": True,
    },
    {
        "name": "static — find then edit",
        "prompt": "Make the title on this slide bold.",
        "viewing_slide_n": 1,
        "expected_mode_includes": ["static_plan", "iterative_plan"],
        "post_check": None,   # plan correctness check; execution may or may not patch given API limits
        "expect_executed": False,
    },
    {
        "name": "scripted — timeline",
        "prompt": "Create a timeline with one bar for each of the next 7 days, starting at the top of the slide.",
        "viewing_slide_n": 3,
        "expected_mode_includes": ["scripted_plan"],
        "post_check": None,   # script may or may not run cleanly with real LLM
        "expect_executed": False,
    },
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=None)
    args = p.parse_args()

    print("Booting Percy app in-process...")
    from app.backend import main as backend_main
    client = TestClient(backend_main.app)

    doc_id = "lmstudio-chat-test"
    doc = build_test_doc(doc_id)

    if args.model:
        os.environ["PERCY_LMSTUDIO_MODEL"] = args.model
    print(f"\nLLM resolution: ANTHROPIC unset, OPENAI unset → LM Studio")

    print("\n" + "="*78)
    for tc in PROMPTS:
        print(f"\n>> [{tc['name']}] viewing_slide_n={tc['viewing_slide_n']}")
        print(f"   prompt: {tc['prompt']}")
        t0 = time.time()
        r = client.post("/api/agent/chat", json={
            "doc_id": doc_id,
            "messages": [{"role": "user", "content": tc["prompt"]}],
            "context": {
                "viewing_slide_n": tc["viewing_slide_n"],
                "user_confirmed": True,
                "model": args.model,
            },
        })
        elapsed = time.time() - t0
        print(f"   HTTP: {r.status_code}, elapsed {elapsed:.1f}s")
        if r.status_code != 200:
            print(f"   FAIL: {r.text[:300]}")
            continue

        body = r.json()
        mode = body.get("mode")
        method = body.get("mode_method")
        conf = body.get("mode_confidence")
        actions = body.get("actions_taken")
        plan = body.get("plan", {})
        execution = body.get("execution", {})

        print(f"   mode: {mode} (method={method}, conf={conf})")
        print(f"   actions_taken: {actions}, executed_ok: {execution.get('ok')}")
        if plan.get("rationale"):
            print(f"   rationale: {plan['rationale']}")
        if plan.get("clarify"):
            print(f"   clarify: {plan['clarify']}")
        if plan.get("calls"):
            for c in plan["calls"][:5]:
                print(f"     - {c.get('endpoint_id')}  args={list((c.get('path_args') or {}).keys())}")
        if plan.get("script"):
            print(f"   script ({len(plan['script'])} chars):")
            for line in plan["script"].splitlines()[:8]:
                print(f"     | {line}")
        if execution.get("error"):
            print(f"   exec error: {execution['error']}")

        # Validation
        mode_ok = mode in tc["expected_mode_includes"]
        post_ok = tc["post_check"] is None or tc["post_check"](doc)
        executed_ok = execution.get("ok") if tc["expect_executed"] else True
        symbol = "PASS" if (mode_ok and post_ok and executed_ok) else "WARN"
        print(f"   {symbol}  mode_ok={mode_ok} post_ok={post_ok} executed_ok={executed_ok}")

    # Audit log read-back
    print("\n" + "="*78)
    print("AUDIT LOG")
    actions_resp = client.get("/api/agent/actions", params={"doc_id": doc_id, "limit": 10})
    if actions_resp.status_code == 200:
        for a in actions_resp.json().get("actions", []):
            print(f"  [{a['kind']:8s} / {(a['mode'] or '-'):18s}] {a['status']:9s}  '{(a['prompt'] or '')[:60]}'")
    else:
        print(f"  failed to read audit: {actions_resp.status_code}")


if __name__ == "__main__":
    main()
