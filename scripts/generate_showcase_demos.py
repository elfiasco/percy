"""One-shot script: pre-generate demo decks for showcase brands.

Run this ONCE per environment (locally for dev, against the deployed
RDS for prod) to populate studio_templates.demo_slides_json for every
brand the marketing splash will show.

After this runs, the showcase endpoint serves the persisted slide JSON
straight from the DB. The app NEVER re-generates at runtime.

Usage:
    PERCY_LLM_PROVIDER=bedrock \\
      PERCY_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-6 \\
      AWS_PROFILE=percy-dev \\
      PYTHONPATH=. python scripts/generate_showcase_demos.py

To target a specific brand only:
    python scripts/generate_showcase_demos.py --slug snowflake

Idempotent — re-running overwrites the persisted demo (use --force to
bypass the 5-min throttle).
"""

from __future__ import annotations

import argparse
import os
import sys
import time

os.environ.setdefault("PERCY_PUBLIC_DEV", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--slug", help="Only generate this brand (default: all in SHOWCASE_BRANDS)")
    p.add_argument("--force", action="store_true",
                    help="Bypass the 5-min throttle (default: respect it)")
    p.add_argument("--prompt-id", default=None,
                    help="Which canned prompt (default: DEFAULT_DEMO_ID)")
    args = p.parse_args()

    # Need the FastAPI app loaded so demo_deck_runner can call its in-process
    # endpoints via the Studio HTTP client.
    from app.backend import main as _main_app
    fastapi_app = _main_app.app
    from app.backend import auth_db
    auth_db.init_db()

    from app.backend.showcase_api import SHOWCASE_BRANDS
    targets = []
    for entry in SHOWCASE_BRANDS:
        if args.slug and entry["slug"] != args.slug:
            continue
        set_id = entry.get("set_id") or f"tpl_demo_{entry['slug']}"
        targets.append((entry["slug"], set_id))

    if not targets:
        print(f"No brands matched --slug={args.slug!r}", file=sys.stderr)
        return 2

    print(f"Generating demos for {len(targets)} brands\n")

    from app.backend import demo_deck_runner
    import json as _json
    from pathlib import Path as _P

    demo_dir = _P(__file__).resolve().parents[1] / "demo_brands"
    demo_dir.mkdir(exist_ok=True)

    results: list[dict] = []
    for slug, set_id in targets:
        tpl = auth_db.get_template(set_id)
        if not tpl:
            print(f"  [{slug}] MISSING set {set_id} — skipping")
            continue
        print(f"  [{slug}] Generating against {set_id} ({tpl['name']})...")
        t0 = time.time()
        result = demo_deck_runner.run_demo(
            template_set_id=set_id,
            prompt_id=args.prompt_id,
            force=args.force,
            asgi_app=fastapi_app,
            auth_token=None,
        )
        elapsed = time.time() - t0
        if not result.get("ok"):
            print(f"  [{slug}] FAILED in {elapsed:.1f}s: {result.get('error')}")
            continue
        summary = result.get("summary") or {}
        slides_persisted = result.get("slides_persisted", 0)
        if result.get("throttled"):
            print(f"  [{slug}] [throttled — using existing demo]")
        else:
            print(f"  [{slug}] DONE in {elapsed:.1f}s — "
                  f"{summary.get('slides_applied', 0)} slides applied, "
                  f"{slides_persisted} persisted")

        # ── Dump the persisted slides to demo_brands/<slug>.demo.json so the
        # init_db seeder can re-stamp this onto a fresh DB at deploy time.
        # That's how we get prod parity without ever running generation in
        # the app process.
        refreshed = auth_db.get_template(set_id) or {}
        snapshot = {
            "slug": slug,
            "set_id": set_id,
            "set_name": refreshed.get("name", ""),
            "prompt_id": result.get("prompt_id"),
            "summary": refreshed.get("last_demo_summary") or {},
            "demo_slides_json": refreshed.get("demo_slides_json") or [],
            "snapshot_version": 1,
            "generated_at": int(time.time()),
        }
        out_path = demo_dir / f"{slug}.demo.json"
        out_path.write_text(_json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
        print(f"  [{slug}] wrote {out_path.name} ({out_path.stat().st_size:,} bytes)")
        results.append({"slug": slug, "set_id": set_id, **result})

    print()
    print(f"Generated {len(results)} demos.")
    print(f"Snapshot files in {demo_dir}/<slug>.demo.json — commit them.")
    print("Showcase will now serve persisted slides from studio_templates.demo_slides_json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
