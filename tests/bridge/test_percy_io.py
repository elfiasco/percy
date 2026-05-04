from __future__ import annotations

from percy.bridge import BridgeSlide, PercyDocument, load_percy, save_percy


def test_percy_round_trip(tmp_path) -> None:
    document = PercyDocument(slides=[BridgeSlide(slide_number=1)])

    output_path = save_percy(document, tmp_path / "deck")
    loaded = load_percy(output_path, PercyDocument)

    assert output_path.suffix == ".percy"
    assert loaded.slides[0].slide_number == 1
