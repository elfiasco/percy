"""
Send a Percy design prompt to every chat-capable model on the local LM Studio
instance, at high temperature, and write all responses to _perspectives.md.

Run:  C:\\Users\\benst\\anaconda3\\python.exe _query_models.py
"""

import json
import time
from pathlib import Path
from urllib import request
from urllib.error import URLError, HTTPError

LM_STUDIO = "http://localhost:1234/v1"
TEMPERATURE = 1.05
MAX_TOKENS = 1500
TIMEOUT_SECONDS = 600  # local models can be slow on big context

PROMPT = """You are a senior brand designer / art director with strong opinions, working privately for the founder of a startup. Give me your honest take, not a balanced one. No hedging.

# Percy

Percy is a B2B tool for finance / asset-management teams. The core idea: presentations should be the *output* of structured data, not the source of truth. You upload existing PowerPoint decks; Percy decomposes them into a structured "Bridge model" of typed elements (charts, tables, stats); you bind those elements to live data (Snowflake, Python pipelines); the deck refreshes itself when the data changes. Visual QA catches drift. Audit trail tracks every change. The goal is to replace the manual quarterly grind of rebuilding the same decks with infrastructure that just works.

The brand mark is a hand-drawn ∅ (empty set / null) — a slightly imperfect, hand-traced circle with a diagonal slash through it. The mark has real character. The challenge: the rest of the design language doesn't match the mark yet.

## The audience

- Asset managers — investor letters, attribution decks, IC memos
- Finance teams — board decks, QBRs, monthly reporting
- Quant researchers — Python-fluent, care about precision and audit trails
- Strategy teams — recurring corporate reporting

These users care about: precision, accuracy, audit, time-to-update. They are NOT fooled by stuffy Wall Street formality, generic SaaS friendliness, or cute illustrations.

## What we just ruled out

Our previous aesthetic was "Bloomberg-terminal monochrome + champagne gold accent + verdigris teal data accent" with heavy uppercase tracking, hairline borders, 10–12px text everywhere. It read as too formal, dense, and Gilded-Age-newspaper-y rather than modern tool. We just abandoned the champagne+verdigris palette entirely.

## Four directions we're now testing (all light + dark, all without champagne)

1. **Inkwell** — single cobalt fountain pen ink (#1F3FAA) on cream paper. Editorial, refined, mid-century-publishing feel.
2. **Press** — Penguin-Classic red (#C82B1F) on newsprint cream. Old-world editorial conviction; offset shadow on featured cards like a paperback dust jacket.
3. **Notebook** — graphite blue-gray (#3A5070) on off-white with a *faint graph-paper grid* behind everything. Honest about being a working tool, not a brochure.
4. **Sodium** — warm charcoal + sand cream + a single sodium-vapor yellow (#F5C842) used only on active states. Infrastructural, like well-made machinery.

# Your job

Two parts.

PART 1 — Pick the direction that feels right for Percy specifically (not for "fintech" generally — for THIS product, THIS mark, THIS audience). Defend your pick in 2–4 sentences. If you think all four are wrong, say that.

PART 2 — Propose ONE fifth direction we have NOT considered. Something that breaks from these four. It might be a different color story, a typographic angle, a layout/interaction philosophy, a material/texture metaphor, or a wildcard. Keep it tight: name it · the source/concept · why it fits Percy in particular · what's the risk.

Be opinionated. Strong takes welcome.
"""


def list_models():
    req = request.Request(f"{LM_STUDIO}/models", method="GET")
    try:
        with request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
    except (URLError, HTTPError) as e:
        raise SystemExit(f"could not reach LM Studio at {LM_STUDIO}: {e}")
    return [m["id"] for m in data["data"]]


def is_chat_model(model_id: str) -> bool:
    if "embed" in model_id.lower():
        return False
    return True


def query(model_id: str, prompt: str) -> tuple[str, float]:
    payload = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    }).encode("utf-8")
    req = request.Request(
        f"{LM_STUDIO}/chat/completions",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    t0 = time.monotonic()
    with request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
        result = json.loads(r.read())
    elapsed = time.monotonic() - t0
    return result["choices"][0]["message"]["content"], elapsed


def main():
    print(f"== querying LM Studio at {LM_STUDIO} ==")
    print(f"== temperature {TEMPERATURE} · max tokens {MAX_TOKENS} ==\n")

    models = [m for m in list_models() if is_chat_model(m)]
    print(f"chat-capable models: {models}\n")

    out = Path(__file__).parent / "_perspectives.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write("# Perspectives from local LLMs\n\n")
        f.write(f"_Sent the same Percy design prompt to {len(models)} models on LM Studio at temperature {TEMPERATURE}._\n\n")
        f.write("Each section below is one model's unedited response. They were given identical context. Read them quickly — the value isn't in any one model being right, it's in the *shape of disagreement* across them.\n\n")
        f.write("## The prompt\n\n")
        f.write("```\n" + PROMPT.strip() + "\n```\n\n")
        f.write("---\n\n")
        f.flush()

        for i, model_id in enumerate(models, 1):
            print(f"[{i}/{len(models)}] {model_id} ...", flush=True)
            try:
                response, elapsed = query(model_id, PROMPT)
                print(f"  ok in {elapsed:.1f}s ({len(response)} chars)\n")
                f.write(f"## {model_id}\n\n")
                f.write(f"_responded in {elapsed:.1f}s_\n\n")
                f.write(response.strip() + "\n\n")
                f.write("---\n\n")
                f.flush()
            except Exception as e:
                print(f"  FAILED: {e}\n")
                f.write(f"## {model_id}\n\n")
                f.write(f"_FAILED: {e}_\n\n")
                f.write("---\n\n")
                f.flush()

    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
