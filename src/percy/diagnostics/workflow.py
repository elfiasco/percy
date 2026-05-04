"""End-to-end diagnostic workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from percy.bridge.io import save_percy
from percy.diagnostics.common import ensure_dir, write_json
from percy.diagnostics.compare import compare_artifacts
from percy.diagnostics.inspect import inspect_pptx
from percy.diagnostics.onboard import onboard_pptx
from percy.diagnostics.rebuild import rebuild_pptx


def roundtrip_pptx(
    pptx_path: str | Path,
    out_dir: str | Path,
    *,
    use_vision: bool = False,
    render: bool = True,
    lmstudio_url: str = "http://127.0.0.1:1234/v1/chat/completions",
    vision_model: str = "google/gemma-4-e4b",
) -> dict[str, Any]:
    output_dir = ensure_dir(out_dir)
    input_path = Path(pptx_path)
    inspect_report = inspect_pptx(input_path, output_dir / "inspect")
    document = onboard_pptx(input_path)
    percy_path = save_percy(document, output_dir / f"{input_path.stem}.percy")
    rebuilt_path = output_dir / f"{input_path.stem}.rebuilt.pptx"
    rebuild_report = rebuild_pptx(document, rebuilt_path)
    comparison_report = compare_artifacts(
        input_path,
        rebuilt_path,
        output_dir / "compare",
        use_vision=use_vision,
        render=render,
        lmstudio_url=lmstudio_url,
        vision_model=vision_model,
    )
    report = {
        "input_pptx": str(input_path),
        "percy_path": str(percy_path),
        "rebuilt_pptx": str(rebuilt_path),
        "inspection": {
            "slide_count": inspect_report["slide_count"],
            "diagnostics": inspect_report["diagnostics"],
        },
        "rebuild": rebuild_report,
        "comparison": comparison_report,
        "errors": rebuild_report["diagnostics"] + comparison_report["errors"],
    }
    write_json(report, output_dir / "roundtrip.json")
    return report
