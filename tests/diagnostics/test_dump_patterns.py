from __future__ import annotations

from pathlib import Path

from percy.diagnostics.onboard import onboard_pptx


DUMP = Path("outreach/dump_pptx/snowflake_20260502_Snowflake_Template_light-2019.pptx")


def test_snowflake_dump_flattens_group_children_when_available() -> None:
    if not DUMP.exists():
        return

    document = onboard_pptx(DUMP)

    grouped_elements = [
        element for slide in document.slides for element in slide.elements if element.identification.group_id
    ]
    assert grouped_elements
    assert all(element.custom_properties["group_path"] for element in grouped_elements)


def test_snowflake_dump_indexes_page_numbers_when_available() -> None:
    if not DUMP.exists():
        return

    document = onboard_pptx(DUMP)

    assert document.metadata.page_number_elements
