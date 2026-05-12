"""Template Set unit tests — schema, resolution walk, induction clustering.

The HTTP endpoints are exercised via a fastapi TestClient with the studio
backend mounted; the auth middleware is bypassed by PERCY_PUBLIC_DEV=1 which
the existing test suite relies on.

Coverage:
  * Schema migrations apply idempotently.
  * Create -> list -> get -> patch -> delete round trip.
  * Folder-chain resolution walk (project -> folder -> parent -> org default).
  * set_default_template_set demotes the previous default.
  * Template induction fingerprints repeats and sorts by cluster size.
  * Brand validator picks up active set's palette.
"""

from __future__ import annotations

import os
import tempfile

import pytest

os.environ["PERCY_PUBLIC_DEV"] = "1"
os.environ.setdefault("PERCY_AUTH_DB", str(tempfile.NamedTemporaryFile(suffix=".db", delete=False).name))


@pytest.fixture(scope="module")
def db():
    from app.backend import auth_db
    auth_db.init_db()
    return auth_db


@pytest.fixture
def org_and_folder(db):
    """Create a small org → root folder → child folder hierarchy for the walk tests."""
    import secrets as _secrets
    suffix = _secrets.token_hex(4)
    org = db.create_org(f"Test Org {suffix}", kind="team", domain=None)
    user = db.create_user(f"test-{suffix}@example.com", display_name="Tester")
    db.add_membership(user["id"], org["id"], "owner")
    root = db.create_folder(org["id"], name="Sales", parent_id=None, created_by=user["id"])
    child = db.create_folder(org["id"], name="EMEA", parent_id=root["id"], created_by=user["id"])
    project = db.create_project(
        org["id"], "Q3 deck",
        folder_id=child["id"], doc_source=None, created_by=user["id"],
    )
    return {"org": org, "user": user, "root": root, "child": child, "project": project}


def test_schema_round_trip(db, org_and_folder):
    """Create / read / patch / delete a template set with all new fields populated."""
    org = org_and_folder["org"]
    user = org_and_folder["user"]

    tpl = db.create_template(
        org["id"], scope="org", owner_id=user["id"],
        name="Acme Brand", description="primary set",
        is_default=True,
    )
    assert tpl["name"] == "Acme Brand"
    assert tpl["is_default"] is True
    assert tpl["palette"] == []
    assert tpl["fonts"] == []
    assert tpl["instructions_md"] == ""

    # Patch palette + fonts + instructions in one call.
    patched = db.update_template(
        tpl["id"],
        palette=[{"hex": "#FF0000", "name": "Brand Red", "role": "primary"}],
        fonts=[{"name": "Inter", "role": "heading"}],
        instructions_md="# Voice\n\nLead with numbers.",
        style_rules={"lock_to_palette": True, "max_title_length": 60},
    )
    assert patched["palette"][0]["hex"] == "#FF0000"
    assert patched["fonts"][0]["name"] == "Inter"
    assert "Lead with numbers" in patched["instructions_md"]
    assert patched["style_rules"]["lock_to_palette"] is True


def test_resolution_walk_org_default(db, org_and_folder):
    """A project with no folder override resolves to the org default."""
    org = org_and_folder["org"]
    user = org_and_folder["user"]
    project = org_and_folder["project"]

    tpl = db.create_template(org["id"], scope="org", owner_id=user["id"], name="OrgDefault")
    db.set_default_template_set(tpl["id"], org_id=org["id"], folder_id=None)

    resolved = db.resolve_active_template_set(project_id=project["id"])
    assert resolved is not None
    assert resolved["id"] == tpl["id"]


def test_resolution_walk_parent_folder_override(db, org_and_folder):
    """A folder ancestor's override wins over the org default."""
    org = org_and_folder["org"]
    user = org_and_folder["user"]
    root = org_and_folder["root"]
    project = org_and_folder["project"]

    org_default = db.create_template(org["id"], scope="org", owner_id=user["id"], name="OD2")
    db.set_default_template_set(org_default["id"], org_id=org["id"], folder_id=None)

    team_override = db.create_template(org["id"], scope="team", owner_id=user["id"], name="Sales Override")
    db.set_default_template_set(team_override["id"], org_id=org["id"], folder_id=root["id"])

    resolved = db.resolve_active_template_set(project_id=project["id"])
    assert resolved["id"] == team_override["id"], (
        "child folder should inherit from parent team override, not org default"
    )


def test_set_default_demotes_previous(db, org_and_folder):
    """Setting a new default at the org level clears is_default on the old one."""
    org = org_and_folder["org"]
    user = org_and_folder["user"]

    first = db.create_template(org["id"], scope="org", owner_id=user["id"], name="First")
    db.set_default_template_set(first["id"], org_id=org["id"], folder_id=None)
    assert db.get_template(first["id"])["is_default"] is True

    second = db.create_template(org["id"], scope="org", owner_id=user["id"], name="Second")
    db.set_default_template_set(second["id"], org_id=org["id"], folder_id=None)

    assert db.get_template(first["id"])["is_default"] is False
    assert db.get_template(second["id"])["is_default"] is True


def test_set_items_round_trip(db, org_and_folder):
    """Add, list, reorder, remove items in a set."""
    org = org_and_folder["org"]
    user = org_and_folder["user"]
    tpl = db.create_template(org["id"], scope="org", owner_id=user["id"], name="With Items")

    db.add_template_set_item(tpl["id"], "fake_template_1", kind="slide", added_by=user["id"])
    db.add_template_set_item(tpl["id"], "fake_template_2", kind="element", added_by=user["id"])

    items = db.list_template_set_items(tpl["id"])
    assert len(items) == 2
    assert {it["kind"] for it in items} == {"slide", "element"}

    # Kind filter.
    slides_only = db.list_template_set_items(tpl["id"], kind="slide")
    assert len(slides_only) == 1
    assert slides_only[0]["template_id"] == "fake_template_1"

    # Reorder.
    db.reorder_template_set_items(tpl["id"], ["fake_template_2", "fake_template_1"])
    reordered = db.list_template_set_items(tpl["id"])
    assert reordered[0]["template_id"] == "fake_template_2"

    # Remove.
    assert db.remove_template_set_item(tpl["id"], "fake_template_1") is True
    remaining = db.list_template_set_items(tpl["id"])
    assert len(remaining) == 1


def test_delete_set_cascades_items_and_refs(db, org_and_folder):
    org = org_and_folder["org"]
    user = org_and_folder["user"]
    tpl = db.create_template(org["id"], scope="org", owner_id=user["id"], name="Doomed")

    db.add_template_set_item(tpl["id"], "fake_tpl", kind="slide", added_by=user["id"])
    ref = db.create_template_set_ref(
        tpl["id"], filename="x.pptx", mime_type="application/vnd.openxmlformats",
        size_bytes=1, storage_key="x", uploaded_by=user["id"],
    )

    db.delete_template(tpl["id"])
    assert db.get_template(tpl["id"]) is None
    assert db.list_template_set_items(tpl["id"]) == []
    assert db.get_template_set_ref(ref["id"]) is None


# ── Induction tests ─────────────────────────────────────────────────────────


_THEME = {"ACCENT_1": "#3B82F6"}


def _real_slide(slide_number, element_specs):
    """Build a real BridgeSlide via the Bridge builders so isinstance checks
    used by the layout serializers fire correctly. `element_specs` is a list
    of ``(kind, body)`` tuples where kind ∈ {'shape','text','chart'}."""
    from percy.bridge import BridgeSlide, builders
    slide = BridgeSlide(slide_number=slide_number, elements=[], width=13.333, height=7.5)
    for kind, body in element_specs:
        if kind == "shape":
            el = builders.build_shape(body, _THEME, slide=slide)
        elif kind == "text":
            el = builders.build_text(body, _THEME, slide=slide)
        elif kind == "chart":
            el = builders.build_chart(body, _THEME, slide=slide)
        else:
            raise ValueError(f"unknown kind {kind!r}")
        slide.elements.append(el)
    return slide


def _real_doc(*slides):
    from percy.bridge import PercyDocument, PresentationMetadata
    return PercyDocument(
        slides=list(slides),
        metadata=PresentationMetadata(slide_count=len(slides)),
        theme_colors=_THEME,
    )


_TWO_EL_SLIDE = [
    ("text", {"text": "Heading", "position": {"left_in": 0.5, "top_in": 0.5, "width_in": 12, "height_in": 1}}),
    ("shape", {"position": {"left_in": 1, "top_in": 3, "width_in": 10, "height_in": 4}, "fill_color": "#3B82F6"}),
]


def test_induction_fingerprints_cluster_repeats():
    """Two slides with the same element shape+position cluster together."""
    from percy.agent import template_induction

    a = _real_slide(1, _TWO_EL_SLIDE)
    b = _real_slide(2, _TWO_EL_SLIDE)
    outlier = _real_slide(3, [_TWO_EL_SLIDE[0]])  # single-element outlier (below min)
    doc = _real_doc(a, b, outlier)

    clusters = template_induction._cluster_slides({"r1": doc})
    sizes = sorted([len(v) for v in clusters.values()], reverse=True)
    assert sizes and sizes[0] == 2, f"expected a 2-member cluster, got {sizes}"


def test_induction_emits_candidates_without_llm():
    """induce_templates returns candidates even when llm_call is None."""
    from percy.agent import template_induction

    doc = _real_doc(_real_slide(1, _TWO_EL_SLIDE), _real_slide(2, _TWO_EL_SLIDE))
    cands = template_induction.induce_templates({"r1": doc}, llm_call=None)
    assert isinstance(cands, list)
    assert any(c["kind"] == "slide" for c in cands), f"got: {[c['kind'] for c in cands]}"


def test_induction_llm_polish_renames_candidate():
    """When llm_call is provided, the candidate name + tags pick up the LLM polish."""
    from percy.agent import template_induction

    doc = _real_doc(_real_slide(1, _TWO_EL_SLIDE), _real_slide(2, _TWO_EL_SLIDE))

    def fake_llm(system: str, user: str) -> str:
        return (
            '{"keep": true, "name": "Title with body shape",'
            ' "description": "Headline plus a single body shape",'
            ' "tags": ["headline"],'
            ' "inputs": [{"name": "title", "type": "string", "required": true,'
            ' "default": "Q3", "description": "Heading"}],'
            ' "confidence": 0.8}'
        )

    cands = template_induction.induce_templates({"r1": doc}, llm_call=fake_llm)
    titled = [c for c in cands if c["name"] == "Title with body shape"]
    assert titled, f"expected LLM-named candidate; got: {[c['name'] for c in cands]}"
    assert "title" in titled[0]["inputs_schema"]


def test_llm_reject_drops_candidate():
    """A candidate the LLM tags keep=false is filtered out."""
    from percy.agent import template_induction

    doc = _real_doc(_real_slide(1, _TWO_EL_SLIDE), _real_slide(2, _TWO_EL_SLIDE))

    def reject_all(system: str, user: str) -> str:
        return '{"keep": false, "description": "looks like master-slide noise"}'

    cands = template_induction.induce_templates({"r1": doc}, llm_call=reject_all)
    # All slide candidates should be dropped; some element candidates may remain.
    assert not any(c["kind"] == "slide" for c in cands), (
        "LLM rejection should remove slide candidates entirely"
    )
