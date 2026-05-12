"""End-to-end smoke test of Template Sets against the real Snowflake deck.

Runs the full flow in-process — no HTTP, no auth dance:

  1. Create an org, folder, project
  2. Create a Template Set marked as org default
  3. Onboard outreach/dump_pptx/snowflake_*.pptx as a reference doc
  4. Run deterministic brand extraction (proposes palette + fonts)
  5. Mine slide + element templates (LLM if available, else deterministic only)
  6. Accept the top 3 candidates
  7. Resolve the active set via the folder walk and pretty-print what the
     agent would see at chat time

Usage:
    PERCY_PUBLIC_DEV=1 python scripts/test_template_sets_with_snowflake.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Run against a throwaway sqlite so we don't pollute the real studio DB.
_db_path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
os.environ["PERCY_AUTH_DB"] = _db_path
os.environ["PERCY_PUBLIC_DEV"] = "1"
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

PPTX_PATH = Path("outreach/dump_pptx/snowflake_20260502_Snowflake_Template_light-2019.pptx")


def banner(s: str) -> None:
    bar = "-" * max(20, len(s) + 4)
    print(f"\n{bar}\n  {s}\n{bar}")


def main() -> int:
    if not PPTX_PATH.exists():
        print(f"FATAL: {PPTX_PATH} not found", file=sys.stderr)
        return 2

    # ── 1. Bootstrap: org + folder + project ──
    banner("1. Bootstrap workspace")
    from app.backend import auth_db
    auth_db.init_db()

    org = auth_db.create_org("Snowflake Test Org", kind="team", domain=None)
    user = auth_db.create_user("test@snowflake.example", display_name="Tester")
    auth_db.add_membership(user["id"], org["id"], "owner")
    folder = auth_db.create_folder(org["id"], name="Sales Demo", parent_id=None, created_by=user["id"])
    project = auth_db.create_project(
        org["id"], "Q4 customer pitch",
        folder_id=folder["id"], doc_source=None, created_by=user["id"],
    )
    print(f"  org={org['id']}  folder={folder['id']}  project={project['id']}")

    # ── 2. Template Set as org default ──
    banner("2. Create Template Set (org default)")
    tset = auth_db.create_template(
        org["id"], scope="org", owner_id=user["id"],
        name="Snowflake Brand", description="derived from the Snowflake template deck",
        is_default=True,
    )
    print(f"  set={tset['id']}  is_default={tset['is_default']}")

    # ── 3. Create a ref pointing at the PPTX and onboard it ──
    banner("3. Onboard snowflake PPTX as a reference")
    storage_key = str(PPTX_PATH)  # we read it from this absolute path directly
    ref = auth_db.create_template_set_ref(
        tset["id"], filename=PPTX_PATH.name, mime_type="application/vnd.openxmlformats",
        size_bytes=PPTX_PATH.stat().st_size, storage_key=storage_key,
        uploaded_by=user["id"], status="uploading",
    )
    print(f"  ref={ref['id']}  size={PPTX_PATH.stat().st_size:,} bytes  status={ref['status']}")

    from app.backend import main as backend_main
    auth_db.update_template_set_ref(ref["id"], status="onboarding")
    result = backend_main.onboard(backend_main.OnboardRequest(path=str(PPTX_PATH)))
    doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
    doc = backend_main._docs[doc_id]["doc"]
    slide_count = len(doc.slides)
    element_count = sum(len(s.elements or []) for s in doc.slides)
    auth_db.update_template_set_ref(
        ref["id"], doc_id=doc_id, status="ready",
        slide_count=slide_count, element_count=element_count,
    )
    print(f"  onboarded:  doc_id={doc_id}  slides={slide_count}  elements={element_count}")

    # ── 4. Deterministic brand extraction ──
    banner("4. Extract proposed palette + fonts (deterministic)")
    from app.backend.template_sets_api import _run_brand_extract
    brand = _run_brand_extract(tset["id"])
    if not brand:
        print("  no brand extracted (ref not ready?)")
        return 3
    print(f"  proposed_palette ({len(brand['proposed_palette'])} colors):")
    for c in brand["proposed_palette"][:8]:
        print(f"    {c['hex']}  role={c['role']:9}  count={c['count']}")
    print(f"  proposed_fonts ({len(brand['proposed_fonts'])} fonts):")
    for f in brand["proposed_fonts"][:6]:
        print(f"    {f['name']:30}  role={f['role']:8}  count={f['count']}")
    print(f"  typography: avg_title={brand['typography']['avg_title_size']}  "
          f"avg_body={brand['typography']['avg_body_size']}")
    if brand.get("chart_types"):
        print(f"  charts: {brand['chart_types']}")
    print(f"  tables: count={brand['table_summary']['count']}  "
          f"banded={brand['table_summary']['banded_rows_pct']}%  "
          f"header={brand['table_summary']['first_row_header_pct']}%")

    # ── 5. Mine slide + element templates ──
    banner("5. Mine slide + element templates")
    from percy.agent import template_induction
    llm_call = None
    try:
        # Use whatever LLM is configured. Bedrock if AWS creds present;
        # falls back to lmstudio. Both work for the polish step.
        from app.backend.agent_chat import _make_llm_call
        llm_call = _make_llm_call()
        print("  LLM polish: ENABLED")
    except Exception as exc:
        print(f"  LLM polish: disabled ({exc})")

    cands = template_induction.induce_templates(
        {ref["id"]: doc}, llm_call=llm_call,
        max_candidates=15,
    )
    print(f"  found {len(cands)} candidates")
    for i, c in enumerate(cands[:10]):
        inputs = list((c.get("inputs_schema") or {}).keys())
        member_count = (c.get("provenance") or {}).get("member_count", "?")
        print(f"    #{i + 1:2}  [{c['kind']:7}] conf={c['confidence']:.2f}  "
              f"× {member_count:>3}  inputs={inputs[:4] if inputs else 'none':}")
        print(f"             name: {c['name']}")
        print(f"             desc: {c['description'][:90]}")

    # ── 6. Accept top 3 candidates ──
    banner("6. Accept top 3 candidates into the set")
    accepted = []
    for c in cands[:3]:
        tid = template_induction.accept_candidate(c, category="Snowflake-induced")
        auth_db.add_template_set_item(
            tset["id"], tid, kind=c["kind"],
            added_by=user["id"], provenance=c.get("provenance") or {},
        )
        accepted.append((tid, c["name"], c["kind"]))
        print(f"  accepted  {tid}  [{c['kind']}]  {c['name']}")

    # ── 7. Resolve active set for the project ──
    banner("7. Verify agent sees the active set")
    from app.backend import agent_template_set_ctx
    # Set the project's doc_id so resolve_active_set_for_doc can find it.
    auth_db.update_project(project["id"], doc_id=doc_id)
    set_ctx = agent_template_set_ctx.build_set_context(doc_id)
    if not set_ctx:
        print("  ERROR: agent context resolution returned None")
        return 4
    print(f"  set name:        {set_ctx['set_metadata']['name']}")
    print(f"  inherited_from:  {set_ctx['set_metadata']['inherited_from']}")
    print(f"  palette:         {len(set_ctx['palette'])} colors")
    print(f"  fonts:           {len(set_ctx['fonts'])} fonts (curated; empty until /confirm-brand)")
    print(f"  templates:       {len(set_ctx['available_templates'])} in catalog")
    for t in set_ctx["available_templates"][:5]:
        ins = ", ".join(i["name"] for i in t["inputs"])
        print(f"    [{t['kind']}]  {t['name']:40}  inputs: {ins}")
    print()
    print("  Formatted system-prompt block the LLM would see:")
    print("  " + "-" * 60)
    formatted = agent_template_set_ctx.format_for_system_prompt(set_ctx)
    for line in formatted.splitlines()[:40]:
        print(f"  {line}")
    if len(formatted.splitlines()) > 40:
        print(f"  … ({len(formatted.splitlines()) - 40} more lines)")
    print("  " + "-" * 60)

    print()
    print("[OK] All steps succeeded.")
    print(f"   DB:           {_db_path}")
    print(f"   Template Set: {tset['id']}")
    print(f"   Accepted:     {[a[0] for a in accepted]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
