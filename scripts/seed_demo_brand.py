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
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

# Surface v3's per-phase log lines so we can see Phase F outcomes etc.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
# Quiet the noisy HTTP libs — Bedrock SDK + httpx log every call at INFO.
for noisy in ("httpx", "botocore", "boto3", "urllib3"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

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
    p.add_argument("--induction-mode", choices=["cluster", "agent", "v3", "agentic"], default="cluster",
                    help=("cluster  = v1 (deterministic fingerprint + LLM polish). "
                          "agent    = v2 (two-phase agentic per-slide). "
                          "v3       = maximally decomposed pipeline (~270 LLM calls/brand). "
                          "agentic  = v3 + vision-led perception layer (A1-A3) — sees every page via vision, "
                          "extracts chart/table styles from images when no structured chart exists. "
                          "Use this for PDFs (BlackRock-style) or any source where chart fidelity matters."))
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

    # ── 4. Template induction ──
    banner(f"3. Mining template candidates  (mode={args.induction_mode})")
    llm_call = None
    if not args.no_llm:
        try:
            from app.backend.agent_chat import _make_llm_call
            llm_call = _make_llm_call()
            print("   LLM: ENABLED")
        except Exception as exc:
            print(f"   LLM: disabled ({exc})")

    v3_result = None
    onboard_result = None
    if args.induction_mode in ("v3", "agentic"):
        if llm_call is None:
            print(f"   {args.induction_mode} mode requires LLM — falling back to cluster mode")
            from percy.agent import template_induction
            candidates = template_induction.induce_templates(
                {ref["id"]: doc}, llm_call=None,
                max_candidates=args.max_candidates,
            )
        else:
            from percy.agent import template_induction_v3 as _v3
            # Agentic mode runs the vision-led pre-pass first; the
            # downstream v3 induction is unchanged. OnboardResult lives
            # alongside the v3 result in the snapshot for inspection.
            if args.induction_mode == "agentic":
                from percy.agent import agentic_onboard as _ao
                vision_call = _ao.make_bedrock_vision_call()
                def _progress(done: int, total: int):
                    if done % 10 == 0 or done == total:
                        print(f"   [agentic] A1 inventory: {done}/{total} pages")
                print(f"   [agentic] running vision-led pre-pass (A1/A2/A3)...")
                onboard_result = _ao.agentic_onboard(
                    {ref["id"]: doc}, slug=args.slug,
                    vision_call=vision_call, progress_cb=_progress,
                )
                print(f"   [agentic] done: {onboard_result.to_dict()}")
            v3_result = _v3.induce_templates_v3({ref["id"]: doc}, llm_call=llm_call)
            # Convert v3's final_templates into the candidate-shape the
            # downstream accept loop expects (kind/confidence/name/etc.)
            candidates = []
            for i, tpl in enumerate(v3_result.final_templates):
                provenance = tpl.get("provenance") or {}
                conf = provenance.get("validation_confidence", 0.8)
                kind = "slide"   # v3 produces full-slide templates
                # Identify chart/table-only by checking layout content
                layout = tpl.get("layout") or []
                if len(layout) == 1 and layout[0].get("kind") in ("chart", "table"):
                    kind = "element"
                candidates.append({
                    "kind": kind, "name": tpl.get("name", ""),
                    "description":       tpl.get("description", ""),
                    "short_description": tpl.get("short_description") or tpl.get("description", ""),
                    "long_description":  tpl.get("long_description", ""),
                    "use_when":          tpl.get("use_when", ""),
                    "avoid_when":        tpl.get("avoid_when", ""),
                    "tags": tpl.get("tags") or [],
                    "inputs_schema": tpl.get("inputs_schema") or {},
                    "sample_inputs": {
                        k: v.get("default") for k, v in (tpl.get("inputs_schema") or {}).items()
                        if isinstance(v, dict) and "default" in v
                    },
                    "layout": layout,
                    "slide_script": None,
                    "connects": {},
                    "provenance": provenance,
                    "confidence": float(conf),
                })
            print(f"   v3 summary: {v3_result.to_dict()}")
    if args.induction_mode == "agent":
        if llm_call is None:
            print("   agent mode requires LLM — falling back to cluster mode")
            from percy.agent import template_induction
            candidates = template_induction.induce_templates(
                {ref["id"]: doc}, llm_call=None,
                max_candidates=args.max_candidates,
            )
        else:
            from percy.agent import template_induction_v2 as _ind_v2
            candidates = _ind_v2.induce_templates_agentic(
                {ref["id"]: doc}, llm_call=llm_call,
                max_wants_per_doc=args.max_candidates,
            )
    elif args.induction_mode not in ("v3", "agentic"):
        from percy.agent import template_induction
        candidates = template_induction.induce_templates(
            {ref["id"]: doc}, llm_call=llm_call,
            max_candidates=args.max_candidates,
        )
    print(f"   {len(candidates)} candidates returned (sorted by confidence)")
    for i, c in enumerate(candidates[:15]):
        print(f"     #{i+1:2}  [{c['kind']:7}] {c['confidence']:.2f}  {c['name'][:55]}")

    # ── 5. Accept top N ──
    banner(f"4. Accepting top {args.accept_count}")
    if args.induction_mode == "agent":
        from percy.agent import template_induction_v2 as _accept_mod
    elif args.induction_mode in ("v3", "agentic"):
        # v3 + agentic candidates are already full Template-shaped dicts; we save
        # them directly via the agent_templates module. The Template
        # dataclass has no `provenance` field, so we stash the v3
        # provenance dict under sample_inputs['_provenance'] — that
        # roundtrips cleanly through save_template/get_template (it's
        # JSON-serialized as part of sample_inputs) and apply_template
        # ignores keys that aren't referenced by `{{var}}` in the
        # layout, so the carrier is harmless at apply time.
        from percy.agent import templates as _tpls_mod
        class _AcceptShim:
            @staticmethod
            def accept_candidate(c: dict, category: str) -> str:
                sample_inputs = dict(c.get("sample_inputs") or {})
                if c.get("provenance"):
                    sample_inputs["_provenance"] = c["provenance"]
                # Stash rich metadata under sample_inputs too (same
                # roundtrip-safe carrier as provenance). Template
                # dataclass has no first-class fields for these but
                # downstream catalog readers look here.
                meta = {}
                for k in ("short_description", "long_description",
                          "use_when", "avoid_when"):
                    v = c.get(k)
                    if v: meta[k] = v
                if meta: sample_inputs["_metadata"] = meta
                t = _tpls_mod.Template(
                    id="", name=c.get("name", "Unnamed"),
                    description=c.get("description", ""),
                    category=category,
                    tags=list(c.get("tags") or []),
                    inputs_schema=dict(c.get("inputs_schema") or {}),
                    sample_inputs=sample_inputs,
                    layout=list(c.get("layout") or []),
                    slide_script=c.get("slide_script"),
                    connects=dict(c.get("connects") or {}),
                    is_builtin=False,
                )
                return _tpls_mod.save_template(t)
        _accept_mod = _AcceptShim()
    else:
        from percy.agent import template_induction as _accept_mod
    accepted = []
    for c in candidates[:args.accept_count]:
        tid = _accept_mod.accept_candidate(c, category=f"Induced:{args.slug}")
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
