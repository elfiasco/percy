"""End-to-end test of style extraction + Python codegen against Snowflake.

Runs through: onboard -> brand extract -> style extract -> accept candidates
-> generate Python module -> validate the module imports cleanly.
"""
from __future__ import annotations

import os, sys, tempfile
from pathlib import Path

os.environ["PERCY_AUTH_DB"] = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
os.environ["PERCY_PUBLIC_DEV"] = "1"
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, ".")

PPTX = Path("outreach/dump_pptx/snowflake_20260502_Snowflake_Template_light-2019.pptx")


def banner(s: str) -> None:
    bar = "-" * max(20, len(s) + 4)
    print(f"\n{bar}\n  {s}\n{bar}")


def main() -> int:
    if not PPTX.exists():
        print(f"FATAL: {PPTX} not found"); return 2

    from app.backend import auth_db
    auth_db.init_db()
    org = auth_db.create_org("Codegen Test", kind="team")
    user = auth_db.create_user("test-codegen@example.com", display_name="Tester")
    auth_db.add_membership(user["id"], org["id"], "owner")
    tset = auth_db.create_template(
        org["id"], scope="org", owner_id=user["id"],
        name="Snowflake Brand", description="from the Snowflake template deck",
    )

    banner("1. Onboard PPTX")
    from app.backend import main as backend_main
    ref = auth_db.create_template_set_ref(
        tset["id"], filename=PPTX.name, mime_type="ppt", size_bytes=PPTX.stat().st_size,
        storage_key=str(PPTX), uploaded_by=user["id"], status="uploading",
    )
    result = backend_main.onboard(backend_main.OnboardRequest(path=str(PPTX)))
    doc_id = result["doc_id"]
    doc = backend_main._docs[doc_id]["doc"]
    auth_db.update_template_set_ref(
        ref["id"], doc_id=doc_id, status="ready",
        slide_count=len(doc.slides),
        element_count=sum(len(s.elements or []) for s in doc.slides),
    )
    print(f"  onboarded:  {len(doc.slides)} slides")

    banner("2. Brand + style extraction")
    from app.backend.template_sets_api import _run_brand_extract, _run_style_extract
    _run_brand_extract(tset["id"])
    profile_dict = _run_style_extract(tset["id"])
    print(f"  palette_ordered:    {len(profile_dict['palette_ordered'])} colors")
    print(f"  primary_font:       {profile_dict['primary_font']}")
    print(f"  chart_styles:       {len(profile_dict['chart_styles'])} types")
    for cs in profile_dict["chart_styles"][:5]:
        seq = ", ".join(cs.get("color_sequence") or [])
        print(f"    {cs['chart_type']:20}  x{cs['sample_count']}  colors=[{seq[:60]}]")
    if profile_dict.get("table_style"):
        ts = profile_dict["table_style"]
        print(f"  table_style:")
        print(f"    header_fill={ts.get('header_fill')}  "
              f"banded={ts.get('banded_rows')}  cols~{ts.get('typical_columns')}")
    print(f"  text_styles:")
    for slot in ("title", "subtitle", "body", "caption"):
        f = (profile_dict.get("text_styles") or {}).get(slot)
        if f:
            print(f"    {slot:9}  name={f.get('name')}  size={f.get('size')}  "
                  f"bold={f.get('bold')}  color={f.get('color')}")

    banner("3. Mine + accept top 3 templates")
    from percy.agent import template_induction
    try:
        from app.backend.agent_chat import _make_llm_call
        llm_call = _make_llm_call()
    except Exception:
        llm_call = None
    cands = template_induction.induce_templates(
        {ref["id"]: doc}, llm_call=llm_call, max_candidates=10,
    )
    print(f"  mined {len(cands)} candidates")
    for c in cands[:3]:
        tid = template_induction.accept_candidate(c, category="Snowflake-induced")
        auth_db.add_template_set_item(
            tset["id"], tid, kind=c["kind"], added_by=user["id"],
            provenance=c.get("provenance") or {},
        )
        print(f"  + accepted {c['name']:40} [{c['kind']}]")

    banner("4. Generate Python module")
    from percy.agent import templates as _agent_tpls, template_codegen
    from percy.agent.style_profiles import StyleProfile
    items = auth_db.list_template_set_items(tset["id"])
    for it in items:
        it["template"] = _agent_tpls.get_template(it["template_id"])
    refreshed = auth_db.get_template(tset["id"])
    style_profile = StyleProfile.from_dict(refreshed.get("style_profile") or {})

    module_text = template_codegen.generate_module(
        set_name=refreshed["name"],
        description=refreshed.get("description") or "",
        palette=refreshed.get("palette") or [],
        fonts=refreshed.get("fonts") or [],
        style_profile=style_profile,
        items=items,
    )
    print(f"  module text: {len(module_text):,} chars, {module_text.count(chr(10))} lines")

    # Write to a temp file and try to compile it.
    out = Path(tempfile.NamedTemporaryFile(suffix="_snowflake_brand.py", delete=False).name)
    out.write_text(module_text, encoding="utf-8")
    print(f"  wrote module to: {out}")
    import py_compile
    try:
        py_compile.compile(str(out), doraise=True)
        print("  [OK] module compiles cleanly")
    except py_compile.PyCompileError as exc:
        print(f"  [FAIL] module did not compile: {exc}")
        # Show the failing lines.
        lines = module_text.splitlines()
        match = str(exc)
        import re as _re
        m = _re.search(r"line (\d+)", match)
        if m:
            n = int(m.group(1))
            for i in range(max(0, n-3), min(len(lines), n+3)):
                marker = ">> " if i == n - 1 else "   "
                print(f"{marker}{i+1:4}  {lines[i]}")
        return 4

    banner("5. Module preview (first 70 lines)")
    for line in module_text.splitlines()[:70]:
        print(f"  {line}")

    print()
    print("[OK] All steps succeeded.")
    print(f"  Module:  {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
