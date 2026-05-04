"""Structural and rendered artifact comparison."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageStat

from percy.diagnostics.common import ensure_dir, write_json
from percy.diagnostics.inspect import inspect_pptx
from percy.diagnostics.render import render_pptx
from percy.diagnostics.vision import diagnose_with_lmstudio


def compare_artifacts(
    expected_pptx: str | Path,
    actual_pptx: str | Path,
    out_dir: str | Path,
    *,
    use_vision: bool = False,
    render: bool = True,
    lmstudio_url: str = "http://127.0.0.1:1234/v1/chat/completions",
    vision_model: str = "google/gemma-4-e4b",
) -> dict[str, Any]:
    output_dir = ensure_dir(out_dir)
    expected_inspection = inspect_pptx(expected_pptx, output_dir / "expected-inspection")
    actual_inspection = inspect_pptx(actual_pptx, output_dir / "actual-inspection")
    structural = _compare_structure(expected_inspection, actual_inspection)
    slide_contexts = _build_slide_contexts(expected_inspection, actual_inspection)

    if render:
        expected_render = render_pptx(expected_pptx, output_dir / "expected-render")
        actual_render = render_pptx(actual_pptx, output_dir / "actual-render")
        image_report = _compare_images(
            expected_render.get("slides", []),
            actual_render.get("slides", []),
            output_dir / "diffs",
        )
    else:
        expected_render = {"status": "skipped", "slides": []}
        actual_render = {"status": "skipped", "slides": []}
        image_report = {"status": "skipped", "errors": [], "slides": []}

    vision_report = None
    if use_vision:
        vision_report = diagnose_with_lmstudio(
            image_report,
            slide_contexts,
            output_dir,
            lmstudio_url=lmstudio_url,
            model=vision_model,
        )

    report = {
        "expected": str(expected_pptx),
        "actual": str(actual_pptx),
        "structural": structural,
        "expected_render": expected_render,
        "actual_render": actual_render,
        "images": image_report,
        "vision": vision_report,
        "errors": structural["errors"] + image_report["errors"],
    }
    write_json(report, output_dir / "comparison.json")
    return report


def _compare_structure(expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, Any]:
    errors = []
    if expected["slide_count"] != actual["slide_count"]:
        errors.append(
            {
                "code": "slide_count_mismatch",
                "message": f"Expected {expected['slide_count']} slides, got {actual['slide_count']}.",
            }
        )
    for expected_slide, actual_slide in zip(expected["slides"], actual["slides"]):
        if expected_slide["shape_count"] != actual_slide["shape_count"]:
            errors.append(
                {
                    "code": "shape_count_mismatch",
                    "slide_number": expected_slide["slide_number"],
                    "message": (
                        f"Expected {expected_slide['shape_count']} shapes, "
                        f"got {actual_slide['shape_count']}."
                    ),
                }
            )
    return {"errors": errors}


def _build_slide_contexts(expected: dict[str, Any], actual: dict[str, Any]) -> list[dict[str, Any]]:
    actual_by_slide = {slide["slide_number"]: slide for slide in actual["slides"]}
    slide_contexts = []
    for expected_slide in expected["slides"]:
        actual_slide = actual_by_slide.get(expected_slide["slide_number"], {})
        slide_contexts.append(
            {
                "slide_number": expected_slide["slide_number"],
                "expected": _summarize_slide(expected_slide),
                "actual": _summarize_slide(actual_slide) if actual_slide else {},
            }
        )
    return slide_contexts


def _summarize_slide(slide: dict[str, Any]) -> dict[str, Any]:
    if not slide:
        return {}
    return {
        "slide_number": slide.get("slide_number"),
        "shape_count": slide.get("shape_count"),
        "top_level_shape_count": slide.get("top_level_shape_count"),
        "shapes": [_summarize_shape(shape) for shape in slide.get("shapes", [])],
    }


def _summarize_shape(shape: dict[str, Any]) -> dict[str, Any]:
    summary = {
        "shape_id": shape.get("shape_id"),
        "shape_name": shape.get("shape_name"),
        "shape_type": shape.get("shape_type"),
        "position": shape.get("position"),
        "rotation": shape.get("rotation"),
        "fill": shape.get("fill"),
        "line": shape.get("line"),
        "placeholder": shape.get("placeholder"),
        "group": shape.get("group"),
        "semantic_role": shape.get("semantic_role"),
    }
    if shape.get("has_text_frame"):
        text = shape.get("text", {})
        summary["text"] = {
            "excerpt": _truncate_text(text.get("text")),
            "paragraph_count": len(text.get("paragraphs", [])),
            "run_count": sum(len(paragraph.get("runs", [])) for paragraph in text.get("paragraphs", [])),
        }
    if shape.get("has_table"):
        table = shape.get("table", {})
        summary["table"] = {
            "row_count": table.get("row_count"),
            "column_count": table.get("column_count"),
            "sample_rows": [
                [_truncate_text(cell) for cell in row[:4]]
                for row in table.get("data", [])[:3]
            ],
        }
    if shape.get("has_chart"):
        chart = shape.get("chart", {})
        summary["chart"] = {
            "chart_type": chart.get("chart_type"),
            "series_count": chart.get("series_count"),
            "has_title": chart.get("has_title"),
            "chart_style": chart.get("chart_style"),
        }
    if shape.get("has_picture"):
        picture = shape.get("picture", {})
        summary["picture"] = {
            "filename": picture.get("filename"),
            "content_type": picture.get("content_type"),
            "extension": picture.get("extension"),
            "width_px": picture.get("width_px"),
            "height_px": picture.get("height_px"),
        }
    return summary


def _truncate_text(value: Any, limit: int = 160) -> Any:
    if value is None:
        return None
    text = str(value).replace("\r", " ").replace("\n", " ")
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _compare_images(expected_images: list[str], actual_images: list[str], out_dir: Path) -> dict[str, Any]:
    ensure_dir(out_dir)
    errors = []
    slides = []
    if not expected_images or not actual_images:
        return {
            "status": "not_rendered",
            "errors": [
                {
                    "code": "render_unavailable",
                    "message": "Rendered slide images are unavailable; install pywin32/use PowerPoint to enable image diffs.",
                }
            ],
            "slides": [],
        }

    if len(expected_images) != len(actual_images):
        errors.append(
            {
                "code": "rendered_slide_count_mismatch",
                "message": f"Expected {len(expected_images)} rendered slides, got {len(actual_images)}.",
            }
        )

    for slide_number, (expected, actual) in enumerate(zip(expected_images, actual_images), start=1):
        slide_report = _compare_image_pair(Path(expected), Path(actual), out_dir, slide_number)
        slides.append(slide_report)
        if slide_report["rms"] > 0:
            errors.append(
                {
                    "code": "visual_difference",
                    "slide_number": slide_number,
                    "message": f"Slide {slide_number} visual RMS difference is {slide_report['rms']:.4f}.",
                    "diff_image": slide_report["diff_image"],
                }
            )

    return {"status": "ok", "errors": errors, "slides": slides}


def _compare_image_pair(expected: Path, actual: Path, out_dir: Path, slide_number: int) -> dict[str, Any]:
    expected_image = Image.open(expected).convert("RGB")
    actual_image = Image.open(actual).convert("RGB")
    if expected_image.size != actual_image.size:
        target_size = (
            max(expected_image.width, actual_image.width),
            max(expected_image.height, actual_image.height),
        )
        expected_image = _pad(expected_image, target_size)
        actual_image = _pad(actual_image, target_size)

    diff = ImageChops.difference(expected_image, actual_image)
    stat = ImageStat.Stat(diff)
    rms = sum(value**2 for value in stat.rms) ** 0.5
    diff_path = out_dir / f"slide-{slide_number:03d}-diff.png"
    diff.save(diff_path)
    return {
        "slide_number": slide_number,
        "expected_image": str(expected),
        "actual_image": str(actual),
        "diff_image": str(diff_path),
        "rms": rms,
    }


def _pad(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    padded = Image.new("RGB", size, "white")
    padded.paste(image, (0, 0))
    return padded
