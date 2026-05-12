"""Build a brand-faithful Template Set from a real PPTX/PDF document.

This is the "real world" path: feed in an actual investor deck, let the
agent's brand extraction + style profile + LLM-powered template induction
do their job, accept the strongest candidates, and save the resulting
Template Set as a JSON snapshot.

The snapshots in `demo_brands/*.json` are seeded into the database on
boot (see `auth_db.seed_demo_brand_sets()`), so every deploy ships the
showcase decks without re-running mining.

Usage:
    PERCY_PUBLIC_DEV=1 PYTHONPATH=. python scripts/seed_demo_brand.py \
        --doc outreach/dump_pptx/blackrock_..._BLK-Investor-Day-2025-Agenda.pdf \
        --slug blackrock \
        --display-name "BlackRock"

The script does NOT prescribe colors, fonts, or templates — everything
comes from the document via the same pipeline a real user would trigger.
That's the demo we want to show.

Failures (mining returns 0 candidates, brand extraction yields nothing,
etc.) are logged loudly so we can iterate. The script is idempotent on
slug — re-running overwrites the snapshot.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Run against a throwaway sqlite by default so this doesn't pollute the
# real studio DB. Caller can override with PERCY_AUTH_DB. Each invocation
# gets its own DB file so re-running the seeder for the same brand
# doesn't trip the email-unique constraint from the bootstrapping user.
if "PERCY_AUTH_DB" not in os.environ:
    _fd, _db_path = tempfile.mkstemp(suffix="_percy_seed.db")
    os.close(_fd)
    os.environ["PERCY_AUTH_DB"] = _db_path
os.environ.setdefault("PERCY_PUBLIC_DEV", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


SNAPSHOTS_DIR = Path(__file__).resolve().parents[1] / "demo_brands"


def banner(s: str) -> None:
    bar = "-" * max(20, len(s) + 4)
    print(f"\n{bar}\n  {s}\n{bar}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--doc", required=True, help="Path to PPTX or PDF")
    p.add_argument("--slug", required=True, help="URL-safe identifier (e.g. 'blackrock')")
    p.add_argument("--display-name", required=True, help="Friendly name (e.g. 'BlackRock')")
    p.add_argument("--description", default="", help="One-line description for the set card")
    p.add_argument("--accept-count", type=int, default=8,
                    help="Number of mined template candidates to auto-accept (top-N by confidence)")
    p.add_argument("--max-candidates", type=int, default=20,
                    help="Cap on candidates the inducer asks the LLM about")
    p.add_argument("--no-llm", action="store_true",
                    help="Skip LLM polish during induction (faster + free, lower quality names)")
    args = p.parse_args()

    doc_path = Path(args.doc)
    if not doc_path.exists():
        print(f"FATAL: doc not found: {doc_path}", file=sys.stderr)
        return 2

    from app.backend import auth_db
    auth_db.init_db()

    # Bootstrap a system org for the seed run — we don't actually use this
    # org in production (snapshots get re-seeded into __percy_system__ at
    # boot). It's just so the row passes existing FK / membership checks.
    org = auth_db.create_org(f"Seed: {args.display_name}", kind="team")
    user = auth_db.create_user(f"seed-{args.slug}@percy.so", display_name="Seed")
    auth_db.add_membership(user["id"], org["id"], "owner")

    # ── 1. Create the Template Set shell ──
    banner(f"1. Onboarding {doc_path.name}")
    tset = auth_db.create_template(
        org["id"], scope="org", owner_id=user["id"],
        name=args.display_name,
        description=args.description or f"Template set extracted from {doc_path.name}",
    )
    print(f"   set_id={tset['id']}")

    # ── 2. Create a ref pointing at the doc and onboard it ──
    ref = auth_db.create_template_set_ref(
        tset["id"], filename=doc_path.name, mime_type="application/octet-stream",
        size_bytes=doc_path.stat().st_size, storage_key=str(doc_path),
        uploaded_by=user["id"], status="uploading",
    )
    from app.backend import main as backend_main
    t0 = time.time()
    result = backend_main.onboard(backend_main.OnboardRequest(path=str(doc_path)))
    doc_id = result["doc_id"] if isinstance(result, dict) else getattr(result, "doc_id", None)
    if not doc_id:
        print("FATAL: onboard returned no doc_id"); return 3
    doc = backend_main._docs[doc_id]["doc"]
    slide_count = len(doc.slides)
    element_count = sum(len(s.elements or []) for s in doc.slides)
    auth_db.update_template_set_ref(
        ref["id"], doc_id=doc_id, status="ready",
        slide_count=slide_count, element_count=element_count,
    )
    print(f"   onboarded: {slide_count} slides, {element_count:,} elements in {time.time()-t0:.1f}s")

    if element_count < 50:
        print(f"   WARN: only {element_count} elements parsed — PDF likely missing text/shapes")

    # ── 3. Run brand + style extraction (deterministic) ──
    banner("2. Brand + style extraction")
    from app.backend.template_sets_api import _run_brand_extract, _run_style_extract
    brand = _run_brand_extract(tset["id"])
    profile_dict = _run_style_extract(tset["id"])
    refreshed = auth_db.get_template(tset["id"])

    proposed_palette = (refreshed.get("brand") or {}).get("proposed_palette") or []
    proposed_fonts   = (refreshed.get("brand") or {}).get("proposed_fonts") or []
    print(f"   palette: {len(proposed_palette)} colors")
    for c in proposed_palette[:6]:
        print(f"     {c.get('hex','?')}  count={c.get('count','?')}  role={c.get('role','?')}")
    print(f"   fonts: {len(proposed_fonts)}")
    for f in proposed_fonts[:4]:
        print(f"     {f.get('name','?')}  count={f.get('count','?')}  role={f.get('role','?')}")

    # Auto-confirm proposed palette + fonts into curated columns.
    auth_db.update_template(
        tset["id"], palette=proposed_palette, fonts=proposed_fonts,
    )
    print(f"   palette/fonts curated (auto-accept of proposed)")

    chart_styles = (profile_dict or {}).get("chart_styles") or []
    print(f"   chart styles fingerprinted: {len(chart_styles)} types")

    # ── 4. LLM-powered template induction ──
    banner("3. Mining template candidates")
    from percy.agent import template_induction
    llm_call = None
    if not args.no_llm:
        try:
            from app.backend.agent_chat import _make_llm_call
            llm_call = _make_llm_call()
            print("   LLM polish: ENABLED")
        except Exception as exc:
            print(f"   LLM polish: disabled ({exc})")

    candidates = template_induction.induce_templates(
        {ref["id"]: doc}, llm_call=llm_call,
        max_candidates=args.max_candidates,
    )
    print(f"   {len(candidates)} candidates returned (sorted by confidence)")
    for i, c in enumerate(candidates[:12]):
        print(f"     #{i+1:2}  [{c['kind']:7}] {c['confidence']:.2f}  {c['name'][:55]}")

    # ── 5. Accept top N ──
    banner(f"4. Accepting top {args.accept_count}")
    accepted = []
    for c in candidates[:args.accept_count]:
        tid = template_induction.accept_candidate(c, category=f"Induced:{args.slug}")
        auth_db.add_template_set_item(
            tset["id"], tid, kind=c["kind"],
            added_by=user["id"], provenance=c.get("provenance") or {},
        )
        accepted.append({"template_id": tid, "kind": c["kind"], "name": c["name"]})
        print(f"   + {c['kind']:7}  {c['name']}")

    # ── 6. Save snapshot ──
    banner("5. Writing JSON snapshot")
    final_set = auth_db.get_template(tset["id"])
    final_items = auth_db.list_template_set_items(tset["id"])

    # Hydrate items with their full Template payload so the seeder at boot
    # time can recreate them in the agent.templates SQLite.
    from percy.agent import templates as _agent_tpls
    item_payloads: list[dict] = []
    for it in final_items:
        agent_tpl = _agent_tpls.get_template(it["template_id"])
        if not agent_tpl:
            continue
        item_payloads.append({
            "kind": it["kind"],
            "order_index": it["order_index"],
            "provenance": it.get("provenance") or {},
            "template": agent_tpl,        # full layout/inputs_schema/etc.
        })

    snapshot = {
        "slug": args.slug,
        "display_name": args.display_name,
        "description": args.description or f"Brand mined from {doc_path.name}",
        "source_doc": doc_path.name,
        "source_doc_slides": slide_count,
        "source_doc_elements": element_count,
        "brand": final_set.get("brand") or {},
        "palette": final_set.get("palette") or [],
        "fonts": final_set.get("fonts") or [],
        "style_rules": final_set.get("style_rules") or {},
        "style_profile": final_set.get("style_profile") or {},
        "instructions_md": final_set.get("instructions_md") or "",
        "items": item_payloads,
        "snapshot_version": 1,
        "snapshot_created_at": int(time.time()),
    }

    SNAPSHOTS_DIR.mkdir(exist_ok=True)
    out_path = SNAPSHOTS_DIR / f"{args.slug}.json"
    out_path.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"   wrote {out_path}  ({out_path.stat().st_size:,} bytes)")
    print(f"   items in snapshot: {len(item_payloads)}")

    print()
    print(f"[OK] Snapshot ready: demo_brands/{args.slug}.json")
    print(f"     Commit it to the repo so init_db can seed on boot.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
