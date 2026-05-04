"""Optional local vision-model diagnostics through LM Studio."""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from percy.diagnostics.common import write_json


def diagnose_with_lmstudio(
    image_report: dict[str, Any],
    slide_contexts: list[dict[str, Any]],
    out_dir: str | Path,
    *,
    lmstudio_url: str,
    model: str,
) -> dict[str, Any]:
    output_dir = Path(out_dir)
    if image_report.get("status") != "ok":
        return {"status": "skipped", "reason": "No rendered images available."}

    slide_reports = []
    slide_context_by_number = {slide["slide_number"]: slide for slide in slide_contexts}
    for slide in image_report.get("slides", []):
        slide_context = slide_context_by_number.get(slide["slide_number"], {})
        response = _diagnose_slide(slide, slide_context, lmstudio_url=lmstudio_url, model=model)
        slide_reports.append({"slide_number": slide["slide_number"], **response})

    report = {"status": "ok", "model": model, "slides": slide_reports}
    write_json(report, output_dir / "vision.json")
    return report


def _diagnose_slide(
    slide: dict[str, Any],
    slide_context: dict[str, Any],
    *,
    lmstudio_url: str,
    model: str,
) -> dict[str, Any]:
    prompt = (
        "You are doing a strict PowerPoint round-trip comparison. Compare the original slide, "
        "rebuilt slide, visual diff, and the structured slide context. Be exhaustive and itemize "
        "every visible difference you can detect. Return valid JSON with keys: "
        "summary, exact_differences, missing_objects, extra_objects, formatting_mismatches, "
        "text_mismatches, geometry_mismatches, likely_causes, priority_fixes, confidence. "
        "Use short arrays of concrete findings. If there are no differences, say so explicitly."
    )
    payload = {
        "model": model,
        "max_tokens": 2200,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "text", "text": f"STRUCTURED_SLIDE_CONTEXT:\n{json.dumps(slide_context, indent=2, default=str)}"},
                    _image_part("original", slide["expected_image"]),
                    _image_part("rebuilt", slide["actual_image"]),
                    _image_part("diff", slide["diff_image"]),
                ],
            }
        ],
        "temperature": 0.1,
    }
    request = urllib.request.Request(
        lmstudio_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        content = _post_json(lmstudio_url, payload)
        parsed = _parse_json_content(content)
        return {"status": "ok", "diagnosis": content, "parsed": parsed}
    except urllib.error.HTTPError as exc:
        if getattr(exc, "code", None) == 400:
            fallback_payload = {
                "model": model,
                "max_tokens": 1600,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt + " Keep the answer short and JSON-only."},
                            _image_part("original", slide["expected_image"]),
                            _image_part("rebuilt", slide["actual_image"]),
                            _image_part("diff", slide["diff_image"]),
                        ],
                    }
                ],
                "temperature": 0.1,
            }
            try:
                content = _post_json(lmstudio_url, fallback_payload)
                parsed = _parse_json_content(content)
                return {"status": "ok", "diagnosis": content, "parsed": parsed, "fallback": True}
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as fallback_exc:
                return {"status": "failed", "error": str(fallback_exc), "fallback": True}
        return {"status": "failed", "error": str(exc)}
    except (urllib.error.URLError, KeyError, TimeoutError, json.JSONDecodeError) as exc:
        return {"status": "failed", "error": str(exc)}


def _image_part(label: str, path: str) -> dict[str, Any]:
    image_bytes = Path(path).read_bytes()
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:image/png;base64,{encoded}",
            "detail": "high",
        },
        "metadata": {"label": label},
    }


def _post_json(url: str, payload: dict[str, Any]) -> str:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def _parse_json_content(content: str) -> Any:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match is not None:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return text
    return text
