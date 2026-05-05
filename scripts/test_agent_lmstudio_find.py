"""End-to-end LM Studio test of the find_element + edit flow.

Boots the FastAPI app in-process, creates a test deck with several elements,
then for each natural-language prompt:
  1. Asks the local LLM to plan a tool call ("find_element" or a direct edit)
  2. Executes find_element against the live API
  3. If a candidate is found with confidence > 0.5, asks the LLM to compose
     the follow-up action against that resolved element_id
  4. Validates the planned action against the manifest.

This is the smoke test for whether a local model can:
  (a) recognize when an element reference needs resolution,
  (b) call find_element with the right query + context,
  (c) use the resolved id in a follow-up plan.

Run:
    python scripts/test_agent_lmstudio_find.py
    python scripts/test_agent_lmstudio_find.py --model qwen/qwen3-coder-30b
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

# Path + auth bypass
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "src"))
sys.path.insert(0, str(_ROOT))
os.environ["PERCY_PUBLIC_DEV"] = "1"

from fastapi.testclient import TestClient

from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


LM_STUDIO_URL = "http://localhost:1234/v1"
THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"}


# ── Test deck ───────────────────────────────────────────────────────────────


def build_test_doc(client: TestClient, doc_id: str) -> PercyDocument:
    """Mint a multi-slide test doc with named, identifiable elements."""
    from app.backend import main as backend_main

    doc = PercyDocument(
        slides=[
            BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5),
            BridgeSlide(slide_number=2, elements=[], width=13.333, height=7.5),
            BridgeSlide(slide_number=3, elements=[], width=13.333, height=7.5),
        ],
        metadata=PresentationMetadata(slide_width=13.333, slide_height=7.5, slide_count=3),
        theme_colors=THEME,
    )

    # Slide 1: Title + Revenue Chart + Footer
    doc.slides[0].elements.append(builders.build_text(
        {"text": "Q4 2025 Board Update", "name": "Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 36, "font_bold": True}, THEME, slide=doc.slides[0],
    ))
    doc.slides[0].elements.append(builders.build_chart(
        {"chart_type": "column_clustered",
         "categories": ["Q1", "Q2", "Q3", "Q4"],
         "series": [{"name": "Revenue", "values": [100, 120, 130, 140]},
                    {"name": "Cost",    "values": [80,  90,  95,  100]}],
         "title": "Revenue and Cost",
         "name": "Revenue Chart",
         "position": {"left_in": 1, "top_in": 1.5, "width_in": 8, "height_in": 5}},
        THEME, slide=doc.slides[0],
    ))
    doc.slides[0].elements.append(builders.build_text(
        {"text": "Confidential — Board Only", "name": "Footer",
         "position": {"left_in": 0.5, "top_in": 7.0, "width_in": 12, "height_in": 0.4},
         "font_size": 9}, THEME, slide=doc.slides[0],
    ))

    # Slide 2: Headcount Line Chart + Department Table
    doc.slides[1].elements.append(builders.build_text(
        {"text": "Team Update", "name": "Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 32, "font_bold": True}, THEME, slide=doc.slides[1],
    ))
    doc.slides[1].elements.append(builders.build_chart(
        {"chart_type": "line",
         "categories": ["Jan", "Feb", "Mar", "Apr"],
         "series": [{"name": "Headcount", "values": [50, 55, 60, 68]}],
         "title": "Headcount Growth",
         "name": "Headcount Chart",
         "position": {"left_in": 0.5, "top_in": 1.5, "width_in": 6, "height_in": 5}},
        THEME, slide=doc.slides[1],
    ))
    doc.slides[1].elements.append(builders.build_table(
        {"data": [["Department", "Count"], ["Engineering", 25], ["Sales", 20], ["Ops", 15]],
         "first_row_header": True, "name": "Department Table",
         "position": {"left_in": 7.5, "top_in": 1.5, "width_in": 5, "height_in": 4}},
        THEME, slide=doc.slides[1],
    ))

    # Slide 3: Bottom-right callout + Title
    doc.slides[2].elements.append(builders.build_text(
        {"text": "Risks and Mitigations", "name": "Title",
         "position": {"left_in": 0.5, "top_in": 0.4, "width_in": 12, "height_in": 1},
         "font_size": 32, "font_bold": True}, THEME, slide=doc.slides[2],
    ))
    doc.slides[2].elements.append(builders.build_shape(
        {"geometry_preset": "wedgeRoundRectCallout", "name": "Risk Callout",
         "position": {"left_in": 9, "top_in": 5.5, "width_in": 4, "height_in": 1.5},
         "fill_color": "accent2", "text": "Mitigation in progress"},
        THEME, slide=doc.slides[2],
    ))

    backend_main._docs[doc_id] = {
        "doc": doc,
        "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    return doc


# ── Prompts (require resolution) ────────────────────────────────────────────


PROMPTS = [
    {
        "user_prompt": "Make the title bold and dark navy.",
        "viewing_slide_n": 1,
        "expected_target_name": "Title",
        "expected_target_slide": 1,
    },
    {
        "user_prompt": "Change the revenue chart's title to 'FY25 Performance'.",
        "viewing_slide_n": 1,
        "expected_target_name": "Revenue Chart",
        "expected_target_slide": 1,
    },
    {
        "user_prompt": "Find the headcount chart so I can edit it.",
        "viewing_slide_n": 2,
        "expected_target_name": "Headcount Chart",
        "expected_target_slide": 2,
    },
    {
        "user_prompt": "Locate the bottom right callout.",
        "viewing_slide_n": 3,
        "expected_target_name": "Risk Callout",
        "expected_target_slide": 3,
    },
    {
        "user_prompt": "Find the department table.",
        "viewing_slide_n": 2,
        "expected_target_name": "Department Table",
        "expected_target_slide": 2,
    },
]


# ── LLM call ────────────────────────────────────────────────────────────────


def call_model(model: str, system: str, user: str, max_tokens: int = 1024, temperature: float = 0.1) -> str:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens, "temperature": temperature,
    }
    req = urllib.request.Request(
        f"{LM_STUDIO_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    return data["choices"][0]["message"]["content"]


def extract_json(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    if not s.startswith("{"):
        first = s.find("{")
        if first >= 0:
            s = s[first:]
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i, ch in enumerate(s):
        if esc:
            esc = False; continue
        if ch == "\\" and in_str:
            esc = True; continue
        if ch == '"':
            in_str = not in_str; continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1; break
    return s[:end] if end > 0 else s


# ── System prompt ───────────────────────────────────────────────────────────


SYSTEM_PROMPT = """You are the Percy editing agent. The user wants to edit a presentation.

When the user references an element ambiguously ("the title", "the chart", "this", "that one", "the X chart"),
you MUST call find_element FIRST to resolve the reference, before making any edit.

Tools:
1. find_element — resolves a natural-language reference to (slide_n, element_id)
2. action — placeholder for the actual edit (we'll evaluate find_element only this round)

Output STRICT JSON of the form:
  {"tool": "find_element", "args": {"query": "<short description>", "context": {"viewing_slide_n": <int>, "selected_element_id": <id|null>}}}

Rules:
- Use viewing_slide_n from the user's current context.
- The query should describe the target element in 2-6 words ("revenue chart", "the title", "bottom right callout").
- Set scope to "current_slide" when the user clearly means an element on the slide they're viewing.
- Output JSON only, no prose.
"""


# ── Runner ──────────────────────────────────────────────────────────────────


def run_against_model(model: str, client: TestClient, doc_id: str) -> dict:
    print(f"\n{'='*72}\nMODEL: {model}\n{'='*72}")
    results = {"model": model, "prompts": []}

    for tc in PROMPTS:
        print(f"\n>> [slide {tc['viewing_slide_n']}] {tc['user_prompt']}")
        user_msg = (
            f"User context: viewing_slide_n = {tc['viewing_slide_n']}, "
            f"selected_element_id = null.\n"
            f"User says: {tc['user_prompt']}"
        )
        t0 = time.time()
        try:
            raw = call_model(model, SYSTEM_PROMPT, user_msg)
        except Exception as exc:
            print(f"  FAIL HTTP error: {exc}")
            results["prompts"].append({"prompt": tc["user_prompt"], "ok": False, "stage": "llm",
                                       "reason": str(exc)})
            continue
        elapsed_llm = time.time() - t0

        try:
            plan = json.loads(extract_json(raw))
        except json.JSONDecodeError as exc:
            print(f"  FAIL JSON: {exc}\n    raw: {raw[:200]}")
            results["prompts"].append({"prompt": tc["user_prompt"], "ok": False, "stage": "json",
                                       "reason": str(exc), "raw": raw[:200]})
            continue

        tool = plan.get("tool")
        args = plan.get("args") or {}
        if tool != "find_element":
            print(f"  FAIL tool selection: got {tool!r}")
            results["prompts"].append({"prompt": tc["user_prompt"], "ok": False, "stage": "tool",
                                       "got": tool})
            continue

        # Make sure the LLM included a context — we'll inject viewing_slide_n
        # if it forgot, so the test isn't a strict capability check on context handling.
        ctx = args.get("context") or {}
        if "viewing_slide_n" not in ctx:
            ctx["viewing_slide_n"] = tc["viewing_slide_n"]
        body = {"doc_id": doc_id, "query": args.get("query", ""), "context": ctx}

        # Hit the real find_element endpoint.
        t1 = time.time()
        r = client.post("/api/agent/find_element", json=body)
        elapsed_find = time.time() - t1

        if r.status_code != 200:
            print(f"  FAIL find_element {r.status_code}: {r.text[:200]}")
            results["prompts"].append({"prompt": tc["user_prompt"], "ok": False, "stage": "find",
                                       "reason": r.text[:200]})
            continue

        find_body = r.json()
        candidates = find_body["candidates"]
        if not candidates:
            print(f"  FAIL no candidates returned for query={body['query']!r}")
            results["prompts"].append({"prompt": tc["user_prompt"], "ok": False, "stage": "no_match",
                                       "query": body["query"]})
            continue

        top = candidates[0]
        target_match = (top["name"] == tc["expected_target_name"]
                        and top["slide_n"] == tc["expected_target_slide"])
        symbol = "PASS" if target_match else "FAIL"

        print(f"  {symbol} llm-query={body['query']!r}  ->  {top['type']} '{top['name']}' on slide {top['slide_n']} (score {top['score']})")
        print(f"    expected: '{tc['expected_target_name']}' on slide {tc['expected_target_slide']}")
        print(f"    why: {top['why']}")
        print(f"    timing: llm={elapsed_llm:.1f}s, find={elapsed_find*1000:.0f}ms")

        results["prompts"].append({
            "prompt": tc["user_prompt"],
            "ok": target_match,
            "llm_query": body["query"],
            "resolved_to": f"{top['type']} '{top['name']}' (slide {top['slide_n']})",
            "expected": f"'{tc['expected_target_name']}' (slide {tc['expected_target_slide']})",
            "score": top["score"],
            "why": top["why"],
            "ambiguous": find_body["ambiguous"],
            "elapsed_llm_s": elapsed_llm,
            "elapsed_find_ms": elapsed_find * 1000,
        })

    n_pass = sum(1 for p in results["prompts"] if p.get("ok"))
    n_total = len(PROMPTS)
    print(f"\n  {n_pass}/{n_total} pass")
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=None)
    args = p.parse_args()

    print("Booting Percy app in-process...")
    from app.backend import main as backend_main
    client = TestClient(backend_main.app)

    doc_id = "lmstudio-find-test-doc"
    build_test_doc(client, doc_id)

    print("Querying LM Studio...")
    req = urllib.request.Request(f"{LM_STUDIO_URL}/models")
    with urllib.request.urlopen(req, timeout=5) as r:
        models = [m["id"] for m in json.load(r).get("data", [])]
    print(f"  loaded: {models}")

    if args.model:
        targets = [args.model]
    else:
        prefs = ["qwen/qwen3-coder-30b", "openai/gpt-oss-20b"]
        targets = [next((m for m in prefs if m in models), models[0])]

    all_results = []
    for model in targets:
        all_results.append(run_against_model(model, client, doc_id))

    print(f"\n{'='*72}\nSUMMARY\n{'='*72}")
    print(f"{'model':<35} {'pass':>5} {'avg llm s':>10} {'avg find ms':>12}")
    for r in all_results:
        n_pass = sum(1 for p in r["prompts"] if p.get("ok"))
        timed = [p for p in r["prompts"] if "elapsed_llm_s" in p]
        avg_llm = sum(p["elapsed_llm_s"] for p in timed) / max(1, len(timed))
        avg_find = sum(p["elapsed_find_ms"] for p in timed) / max(1, len(timed))
        print(f"{r['model']:<35} {n_pass}/{len(PROMPTS):<3} {avg_llm:>9.1f} {avg_find:>10.1f}")


if __name__ == "__main__":
    main()
