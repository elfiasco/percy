"""LM Studio integration test for the create_thin agent path.

Hits the local LM Studio OpenAI-compatible endpoint at http://localhost:1234,
pulls the manifest's create_* family, asks the model to produce JSON bodies
for a series of natural-language prompts, and validates each produced body
through the builder layer.

This is a smoke test for two things at once:
  1. Whether a local model can produce valid create_* request bodies.
  2. Whether the manifest summaries + arg descriptions are good enough to
     ground a small model.

Run:
    python scripts/test_agent_lmstudio.py

    # Test against a specific model:
    python scripts/test_agent_lmstudio.py --model qwen/qwen3-coder-30b

    # Compare across all loaded models:
    python scripts/test_agent_lmstudio.py --all
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Ensure src/ is on the path so we can import percy.bridge.* without install.
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "src"))

from percy.bridge import BridgeSlide
from percy.bridge import builders
from percy.bridge.builders import BuilderError

LM_STUDIO_URL = "http://localhost:1234/v1"

# Trim manifest to only the create endpoints we want the model to use.
CREATE_FAMILY = {
    "shape.create", "text.create", "chart.create", "table.create",
    "connector.create", "freeform.create_preset",
}

THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "ACCENT_3": "#F59E0B", "TX1": "#1E293B"}


# ── Test prompts ────────────────────────────────────────────────────────────


PROMPTS = [
    {
        "prompt": "Create a column chart of quarterly revenue for 2024: Q1 100, Q2 120, Q3 130, Q4 110. Place it in the middle of the slide.",
        "expected_endpoint": "chart.create",
        "verify": lambda intent: (
            intent.get("chart_type", "").startswith("column")
            and len(intent.get("categories", [])) == 4
            and len(intent.get("series", [])) >= 1
        ),
    },
    {
        "prompt": "Add a title 'Q4 Board Update' at the top of the slide in large bold type.",
        "expected_endpoint": "text.create",
        "verify": lambda intent: (
            "Board" in (intent.get("text") or json.dumps(intent.get("paragraphs", [])))
            and intent.get("position", {}).get("top_in", 99) < 1.5
        ),
    },
    {
        "prompt": "Create a 4-row financial-style table: Quarter, Revenue, Cost. Q1 100 80, Q2 120 90, Q3 130 95.",
        "expected_endpoint": "table.create",
        "verify": lambda intent: (
            (intent.get("data") and len(intent["data"]) >= 4)
            or (intent.get("rows") and intent.get("columns"))
        ),
    },
    {
        "prompt": "Draw a thick red arrow pointing right from (1, 2) to (5, 2).",
        "expected_endpoint": "connector.create",
        "verify": lambda intent: (
            intent.get("start", {}).get("x_in") == 1
            and intent.get("end", {}).get("x_in") == 5
            and intent.get("head_end") in ("triangle", "stealth", "arrow")
        ),
    },
    {
        "prompt": "Add a rounded blue rectangle in the top-left containing the text 'Highlights'.",
        "expected_endpoint": "shape.create",
        "verify": lambda intent: (
            intent.get("geometry_preset", "").lower() in ("roundrect", "rect")
            and "highlight" in (intent.get("text") or "").lower()
        ),
    },
]


# ── LM Studio HTTP ──────────────────────────────────────────────────────────


def list_models() -> list[str]:
    req = urllib.request.Request(f"{LM_STUDIO_URL}/models")
    with urllib.request.urlopen(req, timeout=5) as r:
        data = json.loads(r.read())
    return [m["id"] for m in data.get("data", [])]


def call_model(model: str, system: str, user: str, max_tokens: int = 2048, temperature: float = 0.1) -> str:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    req = urllib.request.Request(
        f"{LM_STUDIO_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as exc:
        return f"__HTTP_ERROR__ {exc.code}: {exc.read().decode('utf-8', errors='replace')[:300]}"
    return data["choices"][0]["message"]["content"]


# ── JSON extraction (model output may be wrapped in code fences / prose) ──


def _extract_json(text: str) -> str:
    """Pull the first JSON object out of model output."""
    s = text.strip()
    # Strip ```json ... ``` fences.
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    # Find the first '{' and the matching close '}'.
    if not s.startswith("{"):
        first = s.find("{")
        if first >= 0:
            s = s[first:]
    # Crude balance — drop trailing prose.
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i, ch in enumerate(s):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end > 0:
        s = s[:end]
    return s


# ── Manifest assembly ──────────────────────────────────────────────────────


def load_manifest() -> dict:
    """Load the manifest from the source file (no server required)."""
    sys.path.insert(0, str(_ROOT))
    from app.backend import agent_manifest
    return agent_manifest.get_manifest()


def build_system_prompt(manifest: dict) -> str:
    create_endpoints = [e for e in manifest["endpoints"] if e["id"] in CREATE_FAMILY]
    catalog = json.dumps([
        {
            "id": e["id"],
            "summary": e["summary"],
            "args": {k: v["desc"] for k, v in e["args"].items()},
            "examples": e["examples"][:3],
        }
        for e in create_endpoints
    ], indent=2)

    return (
        "You are the Percy element-creation agent. Given a user instruction, choose ONE endpoint from the catalog and "
        "produce a JSON body for it. Output STRICT JSON of the form:\n\n"
        '  {"endpoint_id": "<id>", "body": { ... }}\n\n'
        "Rules:\n"
        "1. Use only endpoint ids from the catalog.\n"
        "2. Always include a 'position' object with left_in, top_in, width_in, height_in (inches; slide is 13.333 x 7.5).\n"
        "3. Color values are strings like 'red', '#3B82F6', 'accent1', 'accent1 +20%' (lighter), 'accent1 -30%' (darker), 'text', 'muted'.\n"
        "4. For charts: chart_type must be one of column_clustered/column_stacked/bar_clustered/bar_stacked/line/line_markers/area/area_stacked/pie/doughnut/scatter/combo.\n"
        "5. For shapes: geometry_preset is an OOXML preset name (rect, roundRect, ellipse, triangle, rightArrow, chevron, star5, etc.).\n"
        "6. For tables: provide either 'data' (full matrix), or 'columns' + 'rows' (DataFrame-shape), or 'rows' + 'cols' as ints (empty grid).\n"
        "7. For connectors: 'start' and 'end' each take {x_in, y_in} OR {element_id, anchor}.\n"
        "8. For text: use 'text' for single line or 'paragraphs' (a list) for multi-line.\n"
        "\n"
        f"CATALOG:\n{catalog}\n"
    )


# ── Validation ──────────────────────────────────────────────────────────────


def validate_body(endpoint_id: str, body: dict) -> tuple[bool, str]:
    """Run the body through the corresponding builder. Return (ok, message)."""
    slide = BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)
    try:
        if endpoint_id == "shape.create":
            builders.build_shape(body, THEME, slide=slide)
        elif endpoint_id == "text.create":
            builders.build_text(body, THEME, slide=slide)
        elif endpoint_id == "chart.create":
            builders.build_chart(body, THEME, slide=slide)
        elif endpoint_id == "table.create":
            builders.build_table(body, THEME, slide=slide)
        elif endpoint_id == "connector.create":
            builders.build_connector(body, THEME, slide=slide)
        elif endpoint_id == "freeform.create_preset":
            builders.build_freeform(body, THEME, slide=slide)
        else:
            return False, f"unknown endpoint: {endpoint_id}"
        return True, "built OK"
    except BuilderError as exc:
        return False, f"BuilderError({exc.field}): {exc}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ── Test runner ─────────────────────────────────────────────────────────────


def run_against_model(model: str, system: str) -> dict:
    print(f"\n{'='*72}")
    print(f"MODEL: {model}")
    print('='*72)
    results = {"model": model, "prompts": []}

    for tc in PROMPTS:
        print(f"\n>>{tc['prompt']}")
        t0 = time.time()
        raw = call_model(model, system, tc["prompt"])
        elapsed = time.time() - t0

        if raw.startswith("__HTTP_ERROR__"):
            print(f"  FAIL HTTP error: {raw[:150]}")
            results["prompts"].append({"prompt": tc["prompt"], "ok": False, "reason": raw[:150], "elapsed_s": elapsed})
            continue

        # Try to extract JSON from the raw response (strip code fences, prose).
        json_text = _extract_json(raw)
        try:
            parsed = json.loads(json_text)
        except json.JSONDecodeError as exc:
            print(f"  FAIL JSON decode: {exc}")
            print(f"    raw: {raw[:200]}")
            results["prompts"].append({"prompt": tc["prompt"], "ok": False, "reason": f"json: {exc}", "elapsed_s": elapsed, "raw": raw[:300]})
            continue

        endpoint_id = parsed.get("endpoint_id", "")
        body = parsed.get("body", {})

        endpoint_ok = endpoint_id == tc["expected_endpoint"]
        endpoint_acceptable = endpoint_id in CREATE_FAMILY  # not exact but at least valid

        builder_ok, builder_msg = validate_body(endpoint_id, body) if endpoint_acceptable else (False, "wrong family")

        verify_ok = False
        try:
            verify_ok = bool(tc["verify"](body))
        except Exception:
            verify_ok = False

        passed = endpoint_acceptable and builder_ok
        symbol = "PASS" if passed else "WARN" if (builder_ok and not endpoint_ok) else "FAIL"
        print(f"  {symbol} endpoint={endpoint_id} (expected {tc['expected_endpoint']})")
        print(f"    builder: {builder_msg}")
        print(f"    semantic-verify: {verify_ok}")
        print(f"    elapsed: {elapsed:.1f}s")

        results["prompts"].append({
            "prompt": tc["prompt"],
            "ok": passed,
            "endpoint": endpoint_id,
            "expected": tc["expected_endpoint"],
            "endpoint_match": endpoint_ok,
            "builder_ok": builder_ok,
            "builder_msg": builder_msg,
            "verify_ok": verify_ok,
            "elapsed_s": elapsed,
        })

    n_pass = sum(1 for p in results["prompts"] if p["ok"])
    n_endpoint_match = sum(1 for p in results["prompts"] if p.get("endpoint_match"))
    n_verify = sum(1 for p in results["prompts"] if p.get("verify_ok"))
    n_total = len(PROMPTS)
    print(f"\n  {n_pass}/{n_total} pass · {n_endpoint_match}/{n_total} exact endpoint · {n_verify}/{n_total} semantic verify")
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=None, help="Specific model id; default = qwen3-coder-30b if available")
    p.add_argument("--all", action="store_true", help="Run against every loaded model")
    args = p.parse_args()

    print("Loading manifest...")
    manifest = load_manifest()
    print(f"  manifest version: {manifest['version']} · {len(manifest['endpoints'])} endpoints")
    creates = [e for e in manifest['endpoints'] if e['id'] in CREATE_FAMILY]
    print(f"  create_* family: {len(creates)} endpoints")

    print("\nQuerying LM Studio for loaded models...")
    try:
        models = list_models()
    except Exception as exc:
        print(f"  ! could not reach LM Studio at {LM_STUDIO_URL}: {exc}")
        sys.exit(1)
    print(f"  loaded: {models}")

    system = build_system_prompt(manifest)

    if args.all:
        targets = [m for m in models if "embed" not in m.lower()]
    elif args.model:
        targets = [args.model]
    else:
        # Pick the first reasonable coder/instruct model
        prefs = ["qwen/qwen3-coder-30b", "openai/gpt-oss-20b", "meta/llama-3.3-70b", "google/gemma-4-e4b"]
        targets = [next((m for m in prefs if m in models), models[0])]

    all_results = []
    for model in targets:
        all_results.append(run_against_model(model, system))

    # Summary
    print(f"\n{'='*72}\nSUMMARY\n{'='*72}")
    print(f"{'model':<35} {'pass':>4} {'endpoint':>8} {'verify':>6} {'avg s':>6}")
    for r in all_results:
        n_pass = sum(1 for p in r["prompts"] if p["ok"])
        n_endpoint = sum(1 for p in r["prompts"] if p.get("endpoint_match"))
        n_verify = sum(1 for p in r["prompts"] if p.get("verify_ok"))
        avg = sum(p["elapsed_s"] for p in r["prompts"]) / max(1, len(r["prompts"]))
        print(f"{r['model']:<35} {n_pass}/{len(PROMPTS):<3} {n_endpoint}/{len(PROMPTS):<6} {n_verify}/{len(PROMPTS):<4} {avg:>5.1f}")


if __name__ == "__main__":
    main()
