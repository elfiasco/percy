from __future__ import annotations

from percy.diagnostics.inspect import inspect_pptx
from percy.diagnostics.onboard import onboard_pptx


def test_inspect_resolves_placeholder_inherited_text_properties() -> None:
    report = inspect_pptx("tests/test_files/test.pptx")

    resolved = report["slides"][0]["shapes"][0]["text"]["paragraphs"][0]["runs"][0]["resolved"]

    assert resolved["font_name"] == "Calibri"
    assert resolved["font_size"] == 44.0
    assert resolved["font_color"] == "000000"
    assert resolved["placeholder"]["is_placeholder"] is True
    assert resolved["sources"]["font_size"] == "master-txStyles:titleStyle:lvl1pPr"
    assert resolved["unresolved"] == []


def test_onboard_synthesizes_inherited_text_into_bridge_text() -> None:
    document = onboard_pptx("tests/test_files/test.pptx")

    title = document.slides[0].elements[0]
    run = title.paragraphs[0].runs[0]

    assert title.shape_info.is_placeholder is True
    assert title.shape_info.placeholder_type == "CENTER_TITLE"
    assert run.font_name == "Calibri"
    assert run.font_size == 44.0
    assert run.font_color == "000000"
