"""Percy workspace API — FastAPI backend.

Start with:
    uvicorn app.backend.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
import uuid
import json
import base64
import re
import zipfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image, ImageChops, ImageGrab, ImageStat

# ── logging ───────────────────────────────────────────────────────────────────
_LOG_FILE = Path(__file__).resolve().parent.parent.parent / "percy_server.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(str(_LOG_FILE), encoding="utf-8"),
    ],
)
log = logging.getLogger("percy.api")
log.info("Percy server starting — log file: %s", _LOG_FILE)

# ── path setup ────────────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "src"))

from percy.diagnostics.onboard import onboard_pptx
from percy.diagnostics.pdf_onboard import onboard_pdf
from percy.diagnostics.rebuild import rebuild_pptx as _rebuild_pptx
from percy.diagnostics.render_png import SlideRenderer
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.tableau import onboard_tableau
import fitz  # PyMuPDF

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Percy Workspace API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── request logging middleware ────────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    log.info("%-6s %-45s → %d  (%.0f ms)",
             request.method, request.url.path, response.status_code, ms)
    return response

# ── dirs ──────────────────────────────────────────────────────────────────────
# Scan both dump_pptx (scraper output) and any manual_dump_pptx folder
_WORKSPACE_DIRS = [
    _ROOT / "outreach" / "dump_pptx",
    _ROOT / "outreach" / "manual_dump_pptx",
    _ROOT / "outreach" / "downloads",          # legacy / future
    _ROOT / "outreach" / "tableau",
]
_CACHE_DIR   = _ROOT / "outreach" / ".rendercache"
_REBUILD_DIR = _ROOT / "outreach" / "rebuilt"
_HISTORY_FILE = _ROOT / "outreach" / ".percy_workspace_history.json"
_LARGE_PDF_BYTES = 50 * 1024 * 1024
_LARGE_PDF_PAGES = 40

# ── in-memory state ───────────────────────────────────────────────────────────
_docs: dict[str, dict[str, Any]] = {}
_history_lock = threading.Lock()
_vision_lock = threading.Lock()

# ── models ────────────────────────────────────────────────────────────────────
class OnboardRequest(BaseModel):
    path: str

class GradeRequest(BaseModel):
    slide_n: int
    grade: str  # "good" | "partial" | "bad"

class VisionGradeRequest(BaseModel):
    target: str  # "bridge" | "rebuilt"
    lmstudio_url: str = "http://127.0.0.1:1234/v1/chat/completions"
    model: str = "google/gemma-4-e4b"

class ElementPositionUpdate(BaseModel):
    left_in: float | None = None
    top_in: float | None = None
    width_in: float | None = None
    height_in: float | None = None
    z_index: int | None = None
    rotation: float | None = None
    name: str | None = None

class LoadBundleRequest(BaseModel):
    bundle_uri: str          # s3://bucket/bundles/{doc_id}/bridge.pkl
    name: str | None = None  # optional display name


class ElementStyleUpdate(BaseModel):
    """Style properties that can be patched on a Bridge element."""
    fill_color: str | None = None          # hex "#RRGGBB" or "none" to remove fill
    fill_type: str | None = None           # "solid" | "none"
    line_color: str | None = None          # hex or "none"
    line_width: float | None = None        # pt
    line_dash: str | None = None           # SOLID|DASH|DOT|DASH_DOT|DASH_DOT_DOT|SYS_DASH|SYS_DOT
    opacity: float | None = None           # 0.0–1.0 (element transparency)
    shadow_on: bool | None = None
    shadow_color: str | None = None        # hex
    shadow_blur: float | None = None       # pt
    shadow_offset_x: float | None = None   # pt
    shadow_offset_y: float | None = None   # pt
    # image-specific
    crop_left: float | None = None         # 0.0–1.0
    crop_right: float | None = None
    crop_top: float | None = None
    crop_bottom: float | None = None


# ── Text-editing models ───────────────────────────────────────────────────────

class RunSpec(BaseModel):
    text: str = ""
    font_name: str | None = None
    font_size: float | None = None
    font_bold: bool | None = None
    font_italic: bool | None = None
    font_underline: bool | None = None
    font_color: str | None = None    # "#RRGGBB" or "" to clear
    strikethrough: str | None = None # "sng" | "dbl" | "" to clear
    font_caps: str | None = None     # "all" | "small" | "" to clear
    is_line_break: bool = False

class ParagraphSpec(BaseModel):
    alignment: str | None = None
    space_before: float | None = None
    space_after: float | None = None
    runs: list[RunSpec] = []

class ChartTextUpdate(BaseModel):
    title_text: str | None = None
    title_font_size: float | None = None
    title_font_bold: bool | None = None
    title_font_italic: bool | None = None
    title_font_name: str | None = None
    cat_axis_title: str | None = None
    val_axis_title: str | None = None
    legend_font_size: float | None = None
    legend_font_bold: bool | None = None
    legend_font_name: str | None = None

class TableCellUpdate(BaseModel):
    row: int
    col: int
    text: str | None = None
    font_bold: bool | None = None
    font_italic: bool | None = None
    font_size: float | None = None
    font_name: str | None = None

class TextUpdateRequest(BaseModel):
    kind: str  # "paragraphs" | "chart" | "table_cell"
    paragraphs: list[ParagraphSpec] | None = None
    chart: ChartTextUpdate | None = None
    table_cell: TableCellUpdate | None = None


# ── helpers ───────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _grade_summary(grades: dict[Any, str], total: int) -> dict[str, int]:
    counts = {"good": 0, "partial": 0, "bad": 0}
    for grade in grades.values():
        if grade in counts:
            counts[grade] += 1
    graded = sum(counts.values())
    return {**counts, "graded": graded, "ungraded": max(total - graded, 0)}


def _diagnostic_summary(diagnostics: list[dict[str, Any]]) -> dict[str, Any]:
    by_code: dict[str, int] = {}
    by_slide: dict[str, int] = {}
    for diag in diagnostics:
        code = str(diag.get("code") or "unknown")
        by_code[code] = by_code.get(code, 0) + 1
        slide = diag.get("slide_number")
        if slide is not None:
            key = str(slide)
            by_slide[key] = by_slide.get(key, 0) + 1
    top_codes = [
        {"code": code, "count": count}
        for code, count in sorted(by_code.items(), key=lambda item: (-item[1], item[0]))[:8]
    ]
    top_slides = [
        {"slide": int(slide), "count": count}
        for slide, count in sorted(by_slide.items(), key=lambda item: (-item[1], int(item[0])))[:8]
    ]
    return {"total": len(diagnostics), "top_codes": top_codes, "top_slides": top_slides}


def _load_history_unlocked() -> dict[str, Any]:
    if not _HISTORY_FILE.exists():
        return {"version": 1, "docs": {}}
    try:
        with _HISTORY_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"version": 1, "docs": {}}
        data.setdefault("version", 1)
        data.setdefault("docs", {})
        return data
    except Exception as e:
        log.warning("history: failed to load %s: %s", _HISTORY_FILE, e)
        return {"version": 1, "docs": {}}


def _save_history_unlocked(history: dict[str, Any]) -> None:
    try:
        _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _HISTORY_FILE.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, sort_keys=True)
        tmp.replace(_HISTORY_FILE)
    except Exception as e:
        log.warning("history: failed to save %s: %s", _HISTORY_FILE, e)


def _history_key(source_path: str) -> str:
    return str(Path(source_path).resolve()).lower()


def _ensure_history_doc_unlocked(
    history: dict[str, Any], source_path: str, name: str, source_format: str, slide_count: int
) -> dict[str, Any]:
    key = _history_key(source_path)
    docs = history.setdefault("docs", {})
    entry = docs.setdefault(key, {
        "source_path": source_path,
        "name": name,
        "source_format": source_format,
        "slide_count": slide_count,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "grades": {},
        "grade_summary": _grade_summary({}, slide_count),
        "diagnostic_summary": _diagnostic_summary([]),
        "events": [],
        "run_count": 0,
    })
    entry.update({
        "source_path": source_path,
        "name": name,
        "source_format": source_format,
        "slide_count": slide_count,
        "updated_at": _now_iso(),
    })
    entry.setdefault("events", [])
    entry.setdefault("grades", {})
    return entry


def _record_event(
    source_path: str, name: str, source_format: str, slide_count: int,
    event_type: str, message: str, details: dict[str, Any] | None = None, status: str = "ok",
) -> None:
    with _history_lock:
        history = _load_history_unlocked()
        entry = _ensure_history_doc_unlocked(history, source_path, name, source_format, slide_count)
        event = {
            "id": str(uuid.uuid4())[:8],
            "ts": _now_iso(),
            "type": event_type,
            "status": status,
            "message": message,
            "details": details or {},
        }
        entry["events"].insert(0, event)
        entry["events"] = entry["events"][:120]
        if event_type in {"onboard", "rebuild", "rerender"}:
            entry["run_count"] = int(entry.get("run_count", 0)) + 1
        entry["last_event"] = event
        entry["updated_at"] = event["ts"]
        _save_history_unlocked(history)


def _update_history_snapshot(doc_id: str) -> None:
    if doc_id not in _docs:
        return
    d = _docs[doc_id]
    with _history_lock:
        history = _load_history_unlocked()
        entry = _ensure_history_doc_unlocked(
            history, d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"]
        )
        entry["grades"] = {str(k): v for k, v in d["grades"].items()}
        entry["grade_summary"] = _grade_summary(d["grades"], d["slide_count"])
        entry["diagnostic_summary"] = _diagnostic_summary(d["diagnostics"])
        entry["render_status"] = {
            "has_originals": bool(d["orig_paths"]),
            "has_bridge": bool(d["bridge_paths"]),
            "has_rebuild": bool(d["rebuilt_path"]),
            "has_rebuilt_renders": bool(d["rebuilt_paths"]),
        }
        entry["rebuilt_path"] = d["rebuilt_path"]
        entry["updated_at"] = _now_iso()
        _save_history_unlocked(history)


def _doc_summary(doc_id: str) -> dict[str, Any]:
    d = _require(doc_id)
    with _history_lock:
        history = _load_history_unlocked()
        hist = history.get("docs", {}).get(_history_key(d["source_path"]), {})
    return {
        "doc_id": doc_id,
        "name": d["name"],
        "source_path": d["source_path"],
        "source_format": d.get("source_format", "pptx"),
        "slide_count": d["slide_count"],
        "grade_summary": _grade_summary(d["grades"], d["slide_count"]),
        "diagnostic_summary": _diagnostic_summary(d["diagnostics"]),
        "render_status": {
            "has_originals": bool(d["orig_paths"]),
            "has_bridge": bool(d["bridge_paths"]),
            "has_rebuild": bool(d["rebuilt_path"]),
            "has_rebuilt_renders": bool(d["rebuilt_paths"]),
        },
        "rebuilt_path": d["rebuilt_path"],
        "events": hist.get("events", [])[:24],
        "run_count": hist.get("run_count", 0),
        "updated_at": hist.get("updated_at"),
        "tableau": _tableau_overview(d) if d.get("source_format") == "tableau" else None,
    }


def _tableau_overview(d: dict[str, Any]) -> dict[str, Any] | None:
    doc = d.get("doc")
    props = getattr(doc, "custom_properties", {}) or {}
    tableau = props.get("tableau")
    if not isinstance(tableau, dict):
        return None
    return {
        "workbook_name": tableau.get("workbook_name"),
        "version": tableau.get("version"),
        "source_build": tableau.get("source_build"),
        "source_platform": tableau.get("source_platform"),
        "worksheet_count": tableau.get("worksheet_count", 0),
        "dashboard_count": tableau.get("dashboard_count", 0),
        "datasource_count": tableau.get("datasource_count", 0),
        "datasources": tableau.get("datasources", []),
        "packaged_files": tableau.get("packaged_files", []),
        "packaged_extracts": tableau.get("packaged_extracts", []),
        "packaged_images": tableau.get("packaged_images", []),
        "color_palettes": tableau.get("color_palettes", []),
    }


def _obj_dict(obj: Any) -> dict[str, Any]:
    return {
        key: getattr(obj, key)
        for key in getattr(obj, "__slots__", [])
        if hasattr(obj, key)
    }


def _tableau_payload(d: dict[str, Any]) -> dict[str, Any]:
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    doc = d["doc"]
    artifacts = []
    for slide in doc.slides:
        slide_props = slide.custom_properties or {}
        info = slide_props.get("tableau", {})
        kind = slide_props.get("tableau_kind", "artifact")
        element_counts: dict[str, int] = {}
        elements = []
        for element in slide.elements:
            element_counts[element.element_type] = element_counts.get(element.element_type, 0) + 1
            element_props = getattr(element, "custom_properties", {}) or {}
            zone = element_props.get("tableau_zone") or {}
            elements.append({
                "type": element.element_type,
                "tableau_kind": element_props.get("tableau_kind"),
                "position": _obj_dict(getattr(element, "position", None)),
                "name": (
                    element_props.get("tableau_name")
                    or zone.get("name")
                    or getattr(getattr(element, "title", None), "title", None)
                    or getattr(getattr(element, "file_info", None), "original_filename", None)
                ),
                "tableau": element_props.get("tableau"),
                "tableau_zone": zone,
            })
        artifacts.append({
            "number": slide.slide_number,
            "kind": kind,
            "name": info.get("name") or info.get("title") or f"Artifact {slide.slide_number}",
            "title": info.get("title"),
            "mark_types": info.get("mark_types", []),
            "primary_mark_type": info.get("primary_mark_type"),
            "datasources": info.get("datasources", []),
            "columns": info.get("columns", []),
            "column_instances": info.get("column_instances", []),
            "column_instance_model": info.get("column_instance_model", {}),
            "filters": info.get("filters", []),
            "sorts": info.get("sorts", []),
            "rows": info.get("rows", []),
            "cols": info.get("cols", []),
            "shelves": info.get("shelves", {}),
            "used_fields": info.get("used_fields", []),
            "visual_items": info.get("visual_items", []),
            "pythonic_model": info.get("pythonic_model", {}),
            "style_summary": info.get("style_summary", {}),
            "style_model": info.get("style_model", {}),
            "layout": info.get("layout", {}),
            "reconstruction": info.get("reconstruction", {}),
            "size": info.get("size", {}),
            "zones": info.get("zones", []),
            "element_counts": element_counts,
            "elements": elements,
        })
    return {"overview": _tableau_overview(d), "artifacts": artifacts}


def _pad_image(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    padded = Image.new("RGB", size, "white")
    padded.paste(image, (0, 0))
    return padded


def _image_diff(expected: Path, actual: Path, diff_path: Path) -> float:
    expected_image = Image.open(expected).convert("RGB")
    actual_image = Image.open(actual).convert("RGB")
    if expected_image.size != actual_image.size:
        size = (
            max(expected_image.width, actual_image.width),
            max(expected_image.height, actual_image.height),
        )
        expected_image = _pad_image(expected_image, size)
        actual_image = _pad_image(actual_image, size)
    diff = ImageChops.difference(expected_image, actual_image)
    diff_path.parent.mkdir(parents=True, exist_ok=True)
    diff.save(diff_path)
    stat = ImageStat.Stat(diff)
    return sum(value**2 for value in stat.rms) ** 0.5


def _compute_pixel_scores(doc_id: str, orig_paths: list[str], rebuilt_paths: list[str]) -> dict[int, float]:
    """Compute per-pixel RMS diff for each original/rebuilt slide pair. Returns {slide_n: rms}."""
    diff_dir = _CACHE_DIR / doc_id / "diffs"
    scores: dict[int, float] = {}
    for i, (orig, rebuilt) in enumerate(zip(orig_paths, rebuilt_paths)):
        slide_n = i + 1
        diff_path = diff_dir / f"slide-{slide_n:03d}-diff.png"
        try:
            rms = _image_diff(Path(orig), Path(rebuilt), diff_path)
            scores[slide_n] = round(rms, 2)
        except Exception as e:
            log.warning("pixel_scores: slide %d failed: %s", slide_n, e)
    return scores


def _vision_image_part(label: str, path: Path) -> dict[str, Any]:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{encoded}", "detail": "high"},
        "metadata": {"label": label},
    }


def _parse_vision_content(content: str) -> Any:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text.strip())
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


def _lmstudio_models_url(chat_url: str) -> str:
    if chat_url.endswith("/chat/completions"):
        return chat_url[: -len("/chat/completions")] + "/models"
    return chat_url.rstrip("/") + "/models"


def _check_lmstudio_model(lmstudio_url: str, model: str) -> dict[str, Any]:
    models_url = _lmstudio_models_url(lmstudio_url)
    request = urllib.request.Request(models_url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        model_ids = [str(item.get("id")) for item in data.get("data", []) if isinstance(item, dict)]
        return {"status": "ok", "models": model_ids, "available": model in model_ids}
    except Exception as e:
        return {"status": "error", "error": str(e), "models": [], "available": False}


def _http_error_text(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""
    return f"HTTP {exc.code}: {body or exc.reason}"


def _call_lmstudio_slide_grade(
    original: Path, candidate: Path, diff: Path, *,
    slide_n: int, target: str, lmstudio_url: str, model: str, rms: float,
) -> dict[str, Any]:
    prompt = (
        "You are a strict PowerPoint visual round-trip evaluator. Compare the ORIGINAL slide "
        f"against the {target.upper()} render and the visual diff. Think element-by-element, not just "
        "as an overall image. Inspect these categories in order: background, large shapes, text blocks, "
        "logos/images/icons, charts/tables, lines/connectors, alignment/spacing, color/fill, and missing "
        "or extra objects. Return valid JSON only. Required schema: "
        "{"
        "\"grade\":\"good|partial|bad\","
        "\"score_0_to_10\":number,"
        "\"summary\":\"one sentence\","
        "\"element_comparisons\":["
        "{"
        "\"element\":\"short human name, e.g. blue diagonal shape\","
        "\"type\":\"background|shape|text|image|chart|table|line|layout|other\","
        "\"location\":\"top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right or approximate\","
        "\"status\":\"match|minor_mismatch|major_mismatch|missing|extra\","
        "\"severity\":\"low|medium|high\","
        "\"original\":\"what is visible in the original\","
        "\"candidate\":\"what is visible in the candidate\","
        "\"difference\":\"specific visual delta\","
        "\"likely_cause\":\"probable Percy/render/rebuild cause\""
        "}"
        "],"
        "\"top_priority_fixes\":[\"ordered concrete fixes\"],"
        "\"confidence\":number"
        "}. "
        "Name specific elements. Avoid vague wording like 'some areas' unless paired with a location. "
        "If an element matches, include only important matches needed for context; focus on mismatches. "
        "grade must be one of good, partial, bad. Use bad for major layout, background, missing-object, "
        "or content failures."
    )
    payload = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 2200,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "text", "text": f"Slide {slide_n}; target={target}; pixel_rms={rms:.2f}"},
                _vision_image_part("original", original),
                _vision_image_part(target, candidate),
                _vision_image_part("diff", diff),
            ],
        }],
    }
    request = urllib.request.Request(
        lmstudio_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    preflight = _check_lmstudio_model(lmstudio_url, model)
    if preflight["status"] != "ok":
        return {"status": "error", "error": f"LM Studio unavailable: {preflight.get('error')}", "preflight": preflight}
    if not preflight["available"]:
        return {
            "status": "error",
            "error": f"Model {model!r} is not available from LM Studio /v1/models.",
            "preflight": preflight,
        }
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            data = json.loads(response.read().decode("utf-8"))
        raw = data["choices"][0]["message"]["content"].strip()
        return {"status": "ok", "raw": raw, "parsed": _parse_vision_content(raw)}
    except urllib.error.HTTPError as e:
        return {"status": "error", "error": _http_error_text(e), "preflight": preflight}
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        return {"status": "error", "error": str(e)}


def _require(doc_id: str) -> dict[str, Any]:
    if doc_id not in _docs:
        raise HTTPException(404, f"Document not found: {doc_id!r}")
    return _docs[doc_id]


def _render_originals(pptx_path: Path, out_dir: Path) -> list[str]:
    """Render every slide via PowerPoint COM. Returns PNG paths. Slow (~60s/deck)."""
    log.info("  render_originals: %s → %s", pptx_path.name, out_dir)
    try:
        from percy.diagnostics.render import render_pptx
        out_dir.mkdir(parents=True, exist_ok=True)
        result = render_pptx(pptx_path, out_dir)
        status = result.get("status")
        slides = result.get("slides", [])
        log.info("  render_originals: status=%s  slides=%d", status, len(slides))
        if status == "ok":
            return slides
        log.warning("  render_originals failed: %s", result.get("error", "unknown"))
    except Exception as e:
        log.warning("  render_originals exception: %s", e)
    return []


def _render_originals_bg(doc_id: str, pptx_path: Path, out_dir: Path, key: str) -> None:
    """Start a background thread that runs COM render and populates _docs[doc_id][key]."""
    def _worker():
        t0 = time.perf_counter()
        paths = _render_originals(pptx_path, out_dir)
        elapsed = time.perf_counter() - t0
        if doc_id in _docs:
            _docs[doc_id][key] = paths
            log.info("bg_render[%s/%s]: %d slides in %.1fs", doc_id, key, len(paths), elapsed)
            d = _docs[doc_id]
            _record_event(
                d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
                "render",
                f"{key} render completed: {len(paths)} slides",
                {"target": key, "slide_count": len(paths), "elapsed_sec": round(elapsed, 1)},
                "ok" if paths else "warn",
            )
            if key == "rebuilt_paths" and d.get("orig_paths") and paths:
                t_px = time.perf_counter()
                scores = _compute_pixel_scores(doc_id, d["orig_paths"], paths)
                _docs[doc_id]["pixel_scores"] = scores
                avg = round(sum(scores.values()) / len(scores), 2) if scores else 0
                log.info("bg_render[%s]: pixel scores: %d slides, avg RMS=%.2f in %.1fs",
                         doc_id, len(scores), avg, time.perf_counter() - t_px)
            _update_history_snapshot(doc_id)
    threading.Thread(target=_worker, daemon=True).start()


_render_bridge_tls = threading.local()


def _render_bridge(doc: Any, out_dir: Path, dpi: int = 96) -> list[str]:
    """Render every slide via matplotlib in parallel. Returns PNG paths in slide order."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from percy.diagnostics.render_png import _register_embedded_fonts

    log.info("  render_bridge: %d slides -> %s", len(doc.slides), out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    theme = getattr(doc, "theme_colors", None) or None
    embedded_fonts = getattr(doc, "embedded_fonts", None)
    is_tableau = (getattr(doc, "custom_properties", {}) or {}).get("source_format") == "tableau"

    # Register fonts in the main thread before workers start (font manager is shared)
    if embedded_fonts:
        _register_embedded_fonts(embedded_fonts)

    def _worker(slide: Any) -> tuple[int, str] | tuple[int, None]:
        dest = out_dir / f"slide-{slide.slide_number:03d}.png"
        # Thread-local renderer so _default_text_color state is not shared
        if not hasattr(_render_bridge_tls, "renderer") or _render_bridge_tls.renderer is None:
            _render_bridge_tls.renderer = SlideRenderer(dpi=dpi, theme=theme)
        renderer = _render_bridge_tls.renderer
        # Provide full document for Tableau dashboard zone reconstruction
        if is_tableau:
            renderer.set_document(doc)
        try:
            fig = renderer.render_slide(slide)
            fig.savefig(str(dest), dpi=dpi, bbox_inches="tight", pad_inches=0)
            fig.clf()
            return (slide.slide_number, str(dest))
        except Exception as e:
            log.warning("  render_bridge slide %d failed: %s", slide.slide_number, e)
            return (slide.slide_number, None)

    results: dict[int, str] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_worker, slide): slide.slide_number for slide in doc.slides}
        for future in as_completed(futures):
            n, path = future.result()
            if path:
                results[n] = path

    paths = [results[n] for n in sorted(results)]
    log.info("  render_bridge: wrote %d/%d PNGs", len(paths), len(doc.slides))
    return paths


def _render_pdf_pages(pdf_path: Path, out_dir: Path, dpi: int = 150) -> list[str]:
    """Render every page of a PDF using PyMuPDF. Fast, no COM required."""
    log.info("  render_pdf_pages: %s → %s", pdf_path.name, out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    try:
        pdf = fitz.open(str(pdf_path))
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for i, page in enumerate(pdf):
            dest = out_dir / f"slide-{i + 1:03d}.png"
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pix.save(str(dest))
            paths.append(str(dest))
        pdf.close()
        log.info("  render_pdf_pages: wrote %d PNGs", len(paths))
    except Exception as e:
        log.warning("  render_pdf_pages failed: %s", e)
    return paths


# ── routes ────────────────────────────────────────────────────────────────────

def _pdf_page_count(pdf_path: Path) -> int:
    try:
        with fitz.open(str(pdf_path)) as pdf:
            return len(pdf)
    except Exception:
        return 0


def _use_fast_pdf_preview(pdf_path: Path, page_count: int) -> bool:
    try:
        size = pdf_path.stat().st_size
    except OSError:
        size = 0
    return size >= _LARGE_PDF_BYTES or page_count >= _LARGE_PDF_PAGES


def _empty_pdf_document(pdf_path: Path, page_count: int) -> PercyDocument:
    with fitz.open(str(pdf_path)) as pdf:
        first = pdf[0] if len(pdf) else None
        width = (first.rect.width / 72.0) if first else 16.0
        height = (first.rect.height / 72.0) if first else 9.0
        slides = [
            BridgeSlide(
                slide_number=i + 1,
                width=pdf[i].rect.width / 72.0,
                height=pdf[i].rect.height / 72.0,
                custom_properties={
                    "source_format": "pdf",
                    "pdf_onboard_mode": "visual_preview",
                },
            )
            for i in range(len(pdf))
        ]
    return PercyDocument(
        slides=slides,
        metadata=PresentationMetadata(
            slide_width=width,
            slide_height=height,
            slide_count=page_count,
            source_path=str(pdf_path),
            notes={
                "pdf_onboard_mode": "visual_preview",
                "message": "Large PDF loaded as raster preview; semantic extraction skipped for interactive responsiveness.",
            },
        ),
        source_path=str(pdf_path),
        custom_properties={
            "source_format": "pdf",
            "pdf_onboard_mode": "visual_preview",
            "semantic_extraction": "skipped_large_pdf",
        },
    )


@app.get("/api/workspace")
def list_workspace():
    """Scan workspace directories for PPTX, PDF, and Tableau files."""
    files = []
    for workspace in _WORKSPACE_DIRS:
        if not workspace.exists():
            log.debug("workspace dir not found: %s", workspace)
            continue
        patterns = [
            ("*.pptx", "pptx"),
            ("*.pdf", "pdf"),
            ("*.twbx", "tableau"),
            ("*.twb", "tableau"),
        ]
        for pattern, fmt in patterns:
            iterator = workspace.rglob(pattern)
            for f in sorted(iterator):
                if "rejected" in f.parts:
                    continue
                try:
                    size_kb = f.stat().st_size // 1024
                except OSError:
                    size_kb = 0
                files.append({"name": f.name, "path": str(f), "size_kb": size_kb,
                              "folder": f.parent.name, "format": fmt})
    files.sort(key=lambda x: x["name"].lower())
    log.info("list_workspace: found %d files", len(files))
    return {"files": files}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Accept a PPTX/PDF file upload and save it to the first workspace directory."""
    allowed = {".pptx", ".pdf", ".twbx", ".twb"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    upload_dir = _WORKSPACE_DIRS[0]
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / (file.filename or f"upload{ext}")
    contents = await file.read()
    dest.write_bytes(contents)
    log.info("upload: saved %s (%d bytes) to %s", file.filename, len(contents), dest)
    return {"path": str(dest), "name": dest.name, "size_kb": len(contents) // 1024}


@app.post("/api/load-bundle")
def load_bundle(req: LoadBundleRequest):
    """Download a Bridge PKL from S3 and load it into the in-memory workspace."""
    import pickle as _pickle

    bundle_uri = req.bundle_uri
    if not bundle_uri.startswith("s3://"):
        raise HTTPException(400, "bundle_uri must be an S3 URI (s3://...)")
    parts = bundle_uri.removeprefix("s3://").split("/", 1)
    if len(parts) != 2:
        raise HTTPException(400, "Invalid S3 URI format")
    bucket, key = parts[0], parts[1]

    log.info("load-bundle: downloading %s", bundle_uri)
    try:
        import boto3 as _boto3
        s3 = _boto3.client("s3")
        resp = s3.get_object(Bucket=bucket, Key=key)
        pkl_bytes = resp["Body"].read()
    except Exception as exc:
        log.exception("load-bundle: S3 download failed")
        raise HTTPException(500, f"Failed to download bundle from S3: {exc}")

    log.info("load-bundle: unpickling %d bytes", len(pkl_bytes))
    try:
        doc = _pickle.loads(pkl_bytes)
    except Exception as exc:
        raise HTTPException(500, f"Failed to unpickle bundle: {exc}")

    doc_id = str(uuid.uuid4())[:8]
    display_name = req.name or getattr(doc, "name", None) or doc_id
    bridge_dir = _CACHE_DIR / doc_id / "bridge"

    log.info("load-bundle: rendering bridge slides for doc_id=%s  slides=%d", doc_id, len(doc.slides))
    try:
        bridge_paths = _render_bridge(doc, bridge_dir)
    except Exception as exc:
        log.warning("load-bundle: bridge render partial: %s", exc)
        bridge_paths = []

    _docs[doc_id] = {
        "doc":              doc,
        "source_path":      bundle_uri,
        "source_format":    "pptx",
        "name":             display_name,
        "slide_count":      len(doc.slides),
        "bridge_paths":     bridge_paths,
        "orig_paths":       [],
        "rebuilt_path":     None,
        "rebuilt_paths":    [],
        "diagnostics":      [],
        "grades":           {},
        "pixel_scores":     {},
        "cloud_bundle_uri": bundle_uri,
    }

    log.info("load-bundle: ready  doc_id=%s  bridge_slides=%d", doc_id, len(bridge_paths))
    return {
        "doc_id":        doc_id,
        "name":          display_name,
        "slide_count":   len(doc.slides),
        "has_originals": False,
        "bridge_slides": len(bridge_paths),
        "source_format": "pptx",
    }


@app.post("/api/onboard")
def onboard(req: OnboardRequest):
    """Onboard PPTX or PDF → PercyDocument, render bridge + original slides."""
    path = Path(req.path)
    log.info("onboard: %s", path)
    if not path.exists():
        log.error("onboard: file not found: %s", path)
        raise HTTPException(404, f"File not found: {path}")

    suffix = path.suffix.lower()
    is_pdf = suffix == ".pdf"
    is_tableau = suffix in {".twb", ".twbx"}
    source_format = "tableau" if is_tableau else "pdf" if is_pdf else "pptx"
    pdf_page_count = _pdf_page_count(path) if is_pdf else 0
    fast_pdf_preview = is_pdf and _use_fast_pdf_preview(path, pdf_page_count)
    t0 = time.perf_counter()
    if is_tableau:
        doc = onboard_tableau(path)
    elif fast_pdf_preview:
        doc = _empty_pdf_document(path, pdf_page_count)
        log.info(
            "onboard: large PDF fast preview selected size=%.1fMB pages=%d",
            path.stat().st_size / (1024 * 1024),
            pdf_page_count,
        )
    elif is_pdf:
        doc = onboard_pdf(path)
    else:
        doc = onboard_pptx(path)
    log.info("onboard: loaded %d slides in %.1fs", len(doc.slides), time.perf_counter() - t0)

    doc_id = str(uuid.uuid4())[:8]
    bridge_dir = _CACHE_DIR / doc_id / "bridge"
    orig_dir   = _CACHE_DIR / doc_id / "original"

    if fast_pdf_preview:
        t2 = time.perf_counter()
        orig_paths = _render_pdf_pages(path, orig_dir, dpi=96)
        bridge_paths = list(orig_paths)
        log.info("onboard: large PDF visual preview render done in %.1fs", time.perf_counter() - t2)
    else:
        t1 = time.perf_counter()
        bridge_paths = _render_bridge(doc, bridge_dir)
        log.info("onboard: bridge render done in %.1fs", time.perf_counter() - t1)

    if is_pdf and not fast_pdf_preview:
        # PyMuPDF render is fast and synchronous — do it now
        t2 = time.perf_counter()
        orig_paths = _render_pdf_pages(path, orig_dir)
        log.info("onboard: PDF page render done in %.1fs", time.perf_counter() - t2)
    elif not fast_pdf_preview:
        orig_paths = []

    _docs[doc_id] = {
        "doc":           doc,
        "source_path":   str(path),
        "source_format": source_format,
        "name":          path.stem,
        "slide_count":   len(doc.slides),
        "bridge_paths":  bridge_paths,
        "orig_paths":    orig_paths,
        "rebuilt_path":  None,
        "rebuilt_paths": [],
        "diagnostics":   [],
        "grades":        {},
        "pixel_scores":  {},
        "pdf_onboard_mode": "visual_preview" if fast_pdf_preview else "semantic" if is_pdf else None,
    }

    with _history_lock:
        history = _load_history_unlocked()
        hist = history.get("docs", {}).get(_history_key(str(path)), {})
        saved_grades = hist.get("grades", {})
    if isinstance(saved_grades, dict):
        _docs[doc_id]["grades"] = {
            int(slide): grade for slide, grade in saved_grades.items()
            if str(slide).isdigit() and grade in {"good", "partial", "bad"}
        }

    if source_format == "pptx":
        # COM render is slow (~60s/deck) — fire and forget in background
        _render_originals_bg(doc_id, path, orig_dir, "orig_paths")

    result = {
        "doc_id":        doc_id,
        "name":          path.stem,
        "slide_count":   len(doc.slides),
        "has_originals": bool(orig_paths),
        "bridge_slides": len(bridge_paths),
        "source_format": source_format,
        "pdf_onboard_mode": _docs[doc_id].get("pdf_onboard_mode"),
        "tableau": _tableau_overview(_docs[doc_id]) if is_tableau else None,
    }
    log.info("onboard: complete → doc_id=%s  %s", doc_id, result)
    _record_event(
        str(path), path.stem, source_format, len(doc.slides),
        "onboard",
        f"Onboarded {len(doc.slides)} {'Tableau artifacts' if is_tableau else 'pages' if is_pdf else 'slides'}",
        {
            "doc_id": doc_id,
            "bridge_slides": len(bridge_paths),
            "has_originals": bool(orig_paths),
            "restored_grades": len(_docs[doc_id]["grades"]),
            "pdf_onboard_mode": _docs[doc_id].get("pdf_onboard_mode"),
        },
    )
    _update_history_snapshot(doc_id)
    return result


@app.get("/api/docs")
def list_docs():
    result = [
        {
            "doc_id":           doc_id,
            "name":             d["name"],
            "slide_count":      d["slide_count"],
            "source_path":      d["source_path"],
            "source_format":    d.get("source_format", "pptx"),
            "has_rebuild":      bool(d["rebuilt_path"]),
            "has_originals":    bool(d["orig_paths"]),
            "has_rebuilt_renders": bool(d["rebuilt_paths"]),
            "grade_summary":    _grade_summary(d["grades"], d["slide_count"]),
            "diagnostic_summary": _diagnostic_summary(d["diagnostics"]),
            "tableau":          _tableau_overview(d) if d.get("source_format") == "tableau" else None,
            "cloud_bundle_uri": d.get("cloud_bundle_uri"),
        }
        for doc_id, d in _docs.items()
    ]
    log.info("list_docs: %d loaded docs", len(result))
    return result


@app.get("/api/docs/{doc_id}")
def get_doc(doc_id: str):
    d = _require(doc_id)
    return {
        "doc_id":           doc_id,
        "name":             d["name"],
        "slide_count":      d["slide_count"],
        "source_path":      d["source_path"],
        "source_format":    d.get("source_format", "pptx"),
        "has_rebuild":      bool(d["rebuilt_path"]),
        "has_originals":    bool(d["orig_paths"]),
        "has_rebuilt_renders": bool(d["rebuilt_paths"]),
        "grade_summary":    _grade_summary(d["grades"], d["slide_count"]),
        "diagnostic_summary": _diagnostic_summary(d["diagnostics"]),
        "grades":           d["grades"],
        "tableau":          _tableau_overview(d) if d.get("source_format") == "tableau" else None,
        "cloud_bundle_uri": d.get("cloud_bundle_uri"),
    }


@app.get("/api/history")
def get_history():
    with _history_lock:
        history = _load_history_unlocked()
    docs = list(history.get("docs", {}).values())
    docs.sort(key=lambda d: d.get("updated_at", ""), reverse=True)
    return {"docs": docs}


@app.get("/api/docs/{doc_id}/summary")
def get_summary(doc_id: str):
    return _doc_summary(doc_id)


@app.get("/api/docs/{doc_id}/tableau")
def get_tableau(doc_id: str):
    return _tableau_payload(_require(doc_id))


@app.get("/api/docs/{doc_id}/tableau/images/{image_index}")
def get_tableau_image(doc_id: str, image_index: int):
    d = _require(doc_id)
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    tableau = (d["doc"].custom_properties or {}).get("tableau", {})
    images = tableau.get("packaged_images", [])
    if image_index < 0 or image_index >= len(images):
        raise HTTPException(404, f"Tableau packaged image {image_index} out of range")
    image = images[image_index]
    source_path = Path(d["source_path"])
    if source_path.suffix.lower() != ".twbx":
        raise HTTPException(404, "Packaged Tableau images only exist for .twbx files")
    image_path = str(image.get("path") or "").replace("\\", "/")
    if not image_path:
        raise HTTPException(404, "Packaged image path is missing")
    try:
        with zipfile.ZipFile(source_path) as package:
            payload = package.read(image_path)
    except KeyError:
        raise HTTPException(404, f"Packaged image not found: {image_path}")
    media_type = "image/jpeg" if str(image.get("format", "")).lower() in {"jpg", "jpeg"} else "image/png"
    return Response(content=payload, media_type=media_type, headers={"Cache-Control": "max-age=60"})


@app.post("/api/docs/{doc_id}/tableau/native-screenshot")
def capture_tableau_native_screenshot(doc_id: str, wait_sec: int = 45):
    d = _require(doc_id)
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    if sys.platform != "win32":
        raise HTTPException(400, "Native Tableau screenshot capture currently requires Windows/Tableau Desktop")
    source_path = Path(d["source_path"])
    if not source_path.exists():
        raise HTTPException(404, f"Source workbook missing: {source_path}")

    out_dir = _CACHE_DIR / doc_id / "tableau-native"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "native-window.png"
    result = _capture_tableau_desktop_window(source_path, out_path, wait_sec=max(5, min(wait_sec, 120)))
    d["tableau_native_screenshot"] = str(out_path)
    _record_event(
        d["source_path"], d["name"], "tableau", d["slide_count"],
        "native_tableau_screenshot",
        f"Captured Tableau Desktop window: {result.get('title')}",
        {"doc_id": doc_id, **result},
        "ok",
    )
    _update_history_snapshot(doc_id)
    return result


@app.get("/api/docs/{doc_id}/tableau/native-screenshot.png")
def get_tableau_native_screenshot(doc_id: str):
    d = _require(doc_id)
    path = d.get("tableau_native_screenshot")
    if not path:
        raise HTTPException(404, "Native Tableau screenshot has not been captured yet")
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, f"Native Tableau screenshot missing: {p}")
    return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "max-age=30"})


@app.post("/api/docs/{doc_id}/tableau/artifacts/{artifact_n}/capture")
def capture_tableau_artifact(doc_id: str, artifact_n: int, wait_sec: int = 60):
    """Open Tableau Desktop, navigate to a specific worksheet/artifact, and capture a screenshot."""
    d = _require(doc_id)
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    if sys.platform != "win32":
        raise HTTPException(400, "Native Tableau screenshot capture requires Windows/Tableau Desktop")
    source_path = Path(d["source_path"])
    if not source_path.exists():
        raise HTTPException(404, f"Source workbook missing: {source_path}")

    # Find the artifact name for this slide number
    doc = d["doc"]
    artifact_slide = next((s for s in doc.slides if s.slide_number == artifact_n), None)
    if artifact_slide is None:
        raise HTTPException(404, f"Artifact {artifact_n} not found in document")

    props = artifact_slide.custom_properties or {}
    tab_info = props.get("tableau", {}) or {}
    artifact_name = tab_info.get("name") or tab_info.get("title") or f"Artifact {artifact_n}"
    artifact_kind = props.get("tableau_kind", "artifact")

    out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"artifact-{artifact_n:03d}.png"

    result = _capture_tableau_artifact_window(
        source_path, artifact_name, artifact_kind, out_path,
        wait_sec=max(5, min(wait_sec, 120)),
    )

    # Cache per-artifact path in doc state
    artifact_captures = d.setdefault("tableau_artifact_captures", {})
    artifact_captures[artifact_n] = str(out_path)

    _record_event(
        d["source_path"], d["name"], "tableau", d["slide_count"],
        "tableau_artifact_capture",
        f"Captured Tableau artifact {artifact_n}: {artifact_name}",
        {"doc_id": doc_id, "artifact_n": artifact_n, "artifact_name": artifact_name, **result},
        "ok",
    )
    _update_history_snapshot(doc_id)
    return result


@app.get("/api/docs/{doc_id}/tableau/artifacts/{artifact_n}/capture.png")
def get_tableau_artifact_capture(doc_id: str, artifact_n: int):
    d = _require(doc_id)
    captures = d.get("tableau_artifact_captures", {})
    path = captures.get(artifact_n)
    if not path:
        raise HTTPException(404, f"No capture for artifact {artifact_n} — call POST first")
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, f"Capture image missing: {p}")
    return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "max-age=30"})


@app.post("/api/docs/{doc_id}/tableau/capture-all")
def capture_all_tableau_sheets(doc_id: str, wait_sec: int = 60, render_wait: float = 2.0):
    """Open Tableau Desktop once and screenshot every worksheet and dashboard in order.

    Navigates via Ctrl+PgDn cycling — no per-sheet Tableau instance needed.
    Returns a mapping of slide_number → capture path.
    """
    d = _require(doc_id)
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    if sys.platform != "win32":
        raise HTTPException(400, "Requires Windows + Tableau Desktop")
    source_path = Path(d["source_path"])
    if not source_path.exists():
        raise HTTPException(404, f"Source workbook missing: {source_path}")

    doc = d["doc"]
    # Collect ordered artifacts (worksheets then dashboards, as they appear in the TWB tab strip)
    artifacts = []
    for slide in doc.slides:
        props = slide.custom_properties or {}
        kind = props.get("tableau_kind")
        if kind not in {"worksheet", "dashboard"}:
            continue
        info = props.get("tableau", {}) or {}
        name = info.get("name") or info.get("title") or f"Sheet {slide.slide_number}"
        artifacts.append({"slide_number": slide.slide_number, "name": name, "kind": kind})

    if not artifacts:
        raise HTTPException(400, "No worksheet or dashboard artifacts found in this document")

    out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)

    results = _capture_all_tableau_sheets(
        source_path, artifacts, out_dir,
        wait_sec=max(10, min(wait_sec, 180)),
        render_wait=max(0.5, min(render_wait, 10.0)),
    )

    # Cache results per artifact_n
    artifact_captures = d.setdefault("tableau_artifact_captures", {})
    captured_count = 0
    for r in results:
        sn = r.get("slide_number")
        path = r.get("path")
        if sn and path and Path(path).exists():
            artifact_captures[sn] = path
            captured_count += 1

    _record_event(
        d["source_path"], d["name"], "tableau", d["slide_count"],
        "tableau_capture_all",
        f"Batch-captured {captured_count}/{len(artifacts)} sheets from Tableau Desktop",
        {"doc_id": doc_id, "captured": captured_count, "total": len(artifacts)},
        "ok",
    )
    _update_history_snapshot(doc_id)
    return {"captured": captured_count, "total": len(artifacts), "results": results}


# ─── Smart capture helpers ────────────────────────────────────────────────────

def _pixel_quality_score(img: Image.Image) -> float:
    """0–100 quality score. 0 = black/blank, 100 = rich rendered content.

    Uses mean brightness and standard deviation of the grayscale image.
    A fully-black screenshot has mean≈0; a fully-white blank has std≈0.
    A rendered chart has mean in a middle range and meaningful std.
    """
    import math
    gray = img.convert("L")
    stat = ImageStat.Stat(gray)
    mean = stat.mean[0]
    std  = stat.stddev[0]
    brightness_score = min(50.0, max(0.0, (mean - 10.0) / 4.0))   # mean 10→50 maps to 0→10; 210→50
    texture_score    = min(50.0, std * 50.0 / 70.0)                # std=70 → 50 points
    return brightness_score + texture_score


def _images_rms_diff(img1: Image.Image, img2: Image.Image) -> float:
    """RMS pixel difference between two images (downsampled for speed)."""
    import math
    s1 = img1.convert("L").resize((80, 45), Image.BILINEAR)
    s2 = img2.convert("L").resize((80, 45), Image.BILINEAR)
    diff = ImageChops.difference(s1, s2)
    stat = ImageStat.Stat(diff)
    return stat.rms[0]


def _wait_until_stable(
    grab_fn: "Any",
    *,
    max_wait: float = 8.0,
    stability_hold: float = 0.8,
    rms_threshold: float = 1.2,
    min_quality: float = 12.0,
    poll_interval: float = 0.35,
) -> Image.Image:
    """Poll screenshots until two consecutive frames are nearly identical AND quality is ok.

    Returns the stable (best-quality) frame. Falls back to whatever we have at timeout.
    """
    deadline = time.time() + max_wait
    prev = grab_fn()
    stable_since: float | None = None
    best = prev
    best_q = _pixel_quality_score(prev)

    while time.time() < deadline:
        time.sleep(poll_interval)
        curr = grab_fn()
        q = _pixel_quality_score(curr)
        rms = _images_rms_diff(prev, curr)

        if q > best_q:
            best = curr
            best_q = q

        if rms <= rms_threshold and q >= min_quality:
            if stable_since is None:
                stable_since = time.time()
            elif time.time() - stable_since >= stability_hold:
                return curr  # held stable long enough
        else:
            stable_since = None

        prev = curr

    return best  # return highest-quality frame seen, even if not fully stable


def _lm_studio_vision_check(
    img_path: Path,
    lm_url: str = "http://localhost:1234/v1/chat/completions",
) -> dict[str, Any]:
    """Ask the LM Studio vision model if the screenshot looks fully rendered.

    Returns {ok: bool|None, score: int 1-5, reason: str, description: str}.
    ok=None means the vision call itself failed (network/model error).
    """
    import json as _json
    import urllib.request as _req

    try:
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        prompt = (
            "You are reviewing a screenshot of Tableau Desktop to decide if the visualization "
            "is fully rendered and ready to save.\n\n"
            "Answer ONLY with valid JSON — no extra text:\n"
            '{"ok": true_or_false, "score": 1_to_5, "reason": "one sentence", "description": "what you see"}\n\n'
            "ok=true  → chart/dashboard is fully rendered with real data visible\n"
            "ok=false → screen is black, blank, still loading a spinner, or shows an error\n"
            "score    → 1=completely black/blank, 5=fully rendered with clear data"
        )

        payload = _json.dumps({
            "model": "google/gemma-3-27b",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }],
            "max_tokens": 150,
            "temperature": 0.05,
        }).encode()

        req = _req.Request(lm_url, data=payload, headers={"Content-Type": "application/json"})
        with _req.urlopen(req, timeout=60) as resp:
            body = _json.loads(resp.read())

        text = body["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*?\}", text, re.DOTALL)
        if m:
            result = _json.loads(m.group())
            # normalise keys
            return {
                "ok":          bool(result.get("ok", False)),
                "score":       int(result.get("score", 0)),
                "reason":      str(result.get("reason", "")),
                "description": str(result.get("description", "")),
            }
        ok = ("true" in text.lower()) and ("false" not in text.lower())
        return {"ok": ok, "score": 3 if ok else 1, "reason": text[:200], "description": ""}

    except Exception as exc:
        log.warning("vision_check failed for %s: %s", img_path.name, exc)
        return {"ok": None, "score": None, "reason": str(exc)[:200], "description": "vision unavailable"}


def _smart_capture_one(
    grab_fn: "Any",
    out_path: Path,
    sheet_name: str,
    *,
    max_render_wait: float = 10.0,
    quality_threshold: float = 14.0,
    max_retries: int = 3,
    use_vision: bool = True,
) -> dict[str, Any]:
    """Capture one sheet with stability wait, quality check, and optional vision verification."""
    attempt = 0
    best_img: Image.Image | None = None
    best_q = -1.0

    while attempt < max_retries:
        wait_this_round = max_render_wait * (attempt + 1)
        img = _wait_until_stable(
            grab_fn,
            max_wait=wait_this_round,
            min_quality=quality_threshold,
        )
        q = _pixel_quality_score(img)
        if best_img is None or q > best_q:
            best_img = img
            best_q = q

        if q >= quality_threshold:
            break

        attempt += 1
        log.warning("smart_capture: %s attempt %d quality=%.1f < %.1f, retrying", sheet_name, attempt, q, quality_threshold)
        if attempt < max_retries:
            time.sleep(1.5)  # brief pause before re-checking

    assert best_img is not None
    best_img.save(out_path)

    vision: dict[str, Any] = {}
    if use_vision:
        vision = _lm_studio_vision_check(out_path)
        # If vision says bad and we have retries left, try one last grab
        if vision.get("ok") is False and best_q < 50.0:
            log.warning(
                "smart_capture: vision rejected %s (score=%s, reason=%s) — final grab",
                sheet_name, vision.get("score"), vision.get("reason"),
            )
            time.sleep(max_render_wait)
            final_img = grab_fn()
            final_q = _pixel_quality_score(final_img)
            if final_q > best_q:
                final_img.save(out_path)
                best_q = final_q
                vision = _lm_studio_vision_check(out_path)

    return {
        "quality_score": round(best_q, 1),
        "vision":        vision,
        "ok":            best_q >= quality_threshold,
    }


def _pil_to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    import io
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _force_hwnd_topmost(hwnd: int) -> None:
    """Force window above all other windows so ImageGrab captures it, not what's in front."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    HWND_TOPMOST = ctypes.c_void_p(-1)
    SWP_NOMOVE    = 0x0002
    SWP_NOSIZE    = 0x0001
    SWP_SHOWWINDOW = 0x0040
    user32.SetWindowPos(
        wintypes.HWND(hwnd), HWND_TOPMOST,
        0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
    )
    # Thread-input attachment trick so SetForegroundWindow works from background threads
    current_tid = ctypes.windll.kernel32.GetCurrentThreadId()
    fg_hwnd = user32.GetForegroundWindow()
    fg_tid  = user32.GetWindowThreadProcessId(fg_hwnd, None)
    if fg_tid and fg_tid != current_tid:
        user32.AttachThreadInput(current_tid, fg_tid, True)
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
        user32.AttachThreadInput(current_tid, fg_tid, False)
    else:
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
    user32.BringWindowToTop(wintypes.HWND(hwnd))


def _restore_hwnd_notopmost(hwnd: int) -> None:
    """Remove topmost flag from window after capture is complete."""
    import ctypes
    from ctypes import wintypes
    HWND_NOTOPMOST = ctypes.c_void_p(-2)
    SWP_NOMOVE = 0x0002
    SWP_NOSIZE = 0x0001
    ctypes.windll.user32.SetWindowPos(
        wintypes.HWND(hwnd), HWND_NOTOPMOST,
        0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE,
    )


def _get_window_title(hwnd: int) -> str:
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    length = user32.GetWindowTextLengthW(wintypes.HWND(hwnd))
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(wintypes.HWND(hwnd), buf, length + 1)
    return buf.value


def _sendinput_key_combo(vk_mod: int, vk_key: int) -> None:
    """Send modifier+key via SendInput — goes to the globally-focused window.

    This is the correct way to simulate keystrokes in modern Windows apps
    (SendMessageW WM_KEYDOWN is ignored by apps that use TranslateMessage/DispatchMessage).
    Caller must ensure the target window is the foreground window first.
    """
    import ctypes

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002

    class _KI(ctypes.Structure):
        _fields_ = [
            ("wVk",         ctypes.c_ushort),
            ("wScan",       ctypes.c_ushort),
            ("dwFlags",     ctypes.c_ulong),
            ("time",        ctypes.c_ulong),
            ("dwExtraInfo", ctypes.c_ulong),
        ]

    class _INPUT(ctypes.Structure):
        _fields_ = [
            ("type", ctypes.c_ulong),
            ("ki",   _KI),
            ("_pad", ctypes.c_ubyte * 8),
        ]

    seq = [
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_mod)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_key)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_key, dwFlags=KEYEVENTF_KEYUP)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_mod, dwFlags=KEYEVENTF_KEYUP)),
    ]
    arr = (_INPUT * len(seq))(*seq)
    ctypes.windll.user32.SendInput(len(seq), arr, ctypes.sizeof(_INPUT))


def _send_ctrl_pgup(user32: Any, hwnd: int, canvas_xy: tuple[int, int] | None = None) -> None:
    """Send Ctrl+PgUp to navigate to the previous Tableau tab."""
    import pyautogui
    _force_hwnd_topmost(hwnd)
    time.sleep(0.05)
    pyautogui.hotkey("ctrl", "pageup")


def _mouse_click_screen(x: int, y: int) -> None:
    """Perform a real left-click at absolute screen coordinates."""
    import ctypes
    ctypes.windll.user32.SetCursorPos(x, y)
    time.sleep(0.06)
    ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
    time.sleep(0.06)
    ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP


def _find_tab_via_ocr(sheet_name: str, win_rect: tuple[int, int, int, int]) -> tuple[int, int] | None:
    """Tesseract-OCR the Tableau tab strip to find (screen_x, screen_y) of the named tab.

    Tesseract must be installed at C:\\Program Files\\Tesseract-OCR\\tesseract.exe.
    Returns None if the tab is not found or Tesseract is unavailable.
    """
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

        win_l, win_t, win_r, win_b = win_rect
        tab_h = 38
        tab_bbox = (win_l, win_b - tab_h, win_r, win_b)
        tab_img = ImageGrab.grab(bbox=tab_bbox)

        # 2× upscale for better OCR on small tab text
        w, h = tab_img.size
        tab_big = tab_img.resize((w * 2, h * 2), Image.LANCZOS)

        data = pytesseract.image_to_data(tab_big, output_type=pytesseract.Output.DICT)

        texts = [str(t).strip() for t in data["text"]]
        name_lower = sheet_name.lower().strip()
        target_words = name_lower.split()

        # Helper: screen coords from OCR pixel coords inside the 2× upscaled crop
        def to_screen(px: int, py: int) -> tuple[int, int]:
            return win_l + px // 2, win_b - tab_h + py // 2

        # Exact single-token match
        for i, word in enumerate(texts):
            if word.lower() == name_lower:
                cx = data["left"][i] + data["width"][i] // 2
                cy = data["top"][i]  + data["height"][i] // 2
                return to_screen(cx, cy)

        # Multi-word contiguous match
        n = len(target_words)
        for i in range(len(texts) - n + 1):
            window_words = [texts[j].lower() for j in range(i, i + n)]
            if window_words == target_words:
                left  = data["left"][i]
                right = data["left"][i + n - 1] + data["width"][i + n - 1]
                cx = (left + right) // 2
                cy = data["top"][i] + data["height"][i] // 2
                return to_screen(cx, cy)

        # Substring fallback: join all tokens and look for the name
        joined = " ".join(t.lower() for t in texts if t)
        log.info("smart_capture: OCR tab strip tokens=%r (looking for %r)", joined[:200], sheet_name)
        return None

    except ImportError:
        log.warning("smart_capture: pytesseract not installed; OCR tab navigation unavailable")
        return None
    except Exception as exc:
        log.warning("smart_capture: OCR tab find failed for '%s': %s", sheet_name, exc)
        return None


def _find_tab_via_vision(sheet_name: str, win_rect: tuple[int, int, int, int]) -> tuple[int, int] | None:
    """Ask LM Studio vision model for the screen position of the named tab in the tab strip.

    Returns (screen_x, screen_y) or None if not found / model unavailable.
    """
    try:
        import json as _json, urllib.request as _req
        win_l, win_t, win_r, win_b = win_rect
        tab_bbox = (win_l, win_b - 44, win_r, win_b)
        tab_img = ImageGrab.grab(bbox=tab_bbox)
        b64 = base64.b64encode(_pil_to_bytes(tab_img)).decode()

        prompt = (
            f'This is the tab strip at the bottom of Tableau Desktop. '
            f'Find the tab named exactly "{sheet_name}" (case-insensitive). '
            f'The image is {tab_img.width}×{tab_img.height} px. '
            f'Reply ONLY with JSON: {{"found": true_or_false, "x": pixel_x_of_tab_center}} '
            f'(x is in image pixels, 0=left edge). If not found set found=false and x=0.'
        )
        payload = _json.dumps({
            "model": "google/gemma-3-27b",
            "messages": [{"role": "user", "content": [
                {"type": "text",      "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ]}],
            "max_tokens": 60, "temperature": 0.05,
        }).encode()
        req = _req.Request(
            "http://localhost:1234/v1/chat/completions",
            data=payload, headers={"Content-Type": "application/json"},
        )
        with _req.urlopen(req, timeout=25) as resp:
            body = _json.loads(resp.read())
        text = body["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*?\}", text, re.DOTALL)
        if m:
            jd = _json.loads(m.group())
            if jd.get("found") and jd.get("x"):
                screen_x = win_l + int(jd["x"])
                screen_y = win_b - 22
                log.info("smart_capture: vision tab found '%s' at x=%d", sheet_name, jd["x"])
                return screen_x, screen_y
        return None
    except Exception as exc:
        log.warning("smart_capture: vision tab-find failed for '%s': %s", sheet_name, exc)
        return None


def _prep_capture_twbx(source_path: Path) -> tuple[Path, list[str]]:
    """Create an unhidden copy of the .twbx with all worksheet tabs visible.

    Returns (temp_twbx_path, tab_order) where tab_order lists sheet names
    in the order they will appear in Tableau Desktop's tab strip (from <windows>).
    The temp file is written alongside the source; caller must delete it.
    """
    import zipfile, re, xml.etree.ElementTree as ET

    with zipfile.ZipFile(source_path, "r") as zin:
        twb_name = next(n for n in zin.namelist() if n.endswith(".twb"))
        twb_bytes = zin.read(twb_name)

    xml_str = twb_bytes.decode("utf-8", errors="replace")

    # Extract tab order from <windows> section (this is the order Tableau shows tabs)
    root = ET.fromstring(xml_str)
    windows_el = root.find("windows")
    tab_order: list[str] = []
    if windows_el is not None:
        for w in windows_el:
            cls = w.get("class", "")
            name = w.get("name", "")
            if cls in ("worksheet", "dashboard") and name:
                tab_order.append(name)

    # Remove hidden='true' from <window> elements to make all worksheets visible
    def _strip_hidden(m: re.Match) -> str:
        return m.group(0).replace(" hidden='true'", "")

    xml_str = re.sub(r"<window[^>]+>", _strip_hidden, xml_str)

    # Write temp file in the same directory as source (so Tableau finds any sidecar files)
    temp_path = source_path.with_name("_percy_capture.twbx")
    with zipfile.ZipFile(source_path, "r") as zin:
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = xml_str.encode("utf-8") if item.filename == twb_name else zin.read(item.filename)
                zout.writestr(item, data)

    return temp_path, tab_order


def _dismiss_blocking_dialogs(tableau_hwnd: int) -> None:
    """Close non-Tableau system dialog windows (e.g. OneDrive) that could steal keyboard focus.

    Only targets non-resizable windows (no WS_THICKFRAME) with known blocking titles,
    so browser windows and other main application windows are never closed.
    """
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    WM_CLOSE = 0x0010
    WS_THICKFRAME = 0x00040000  # Resizable windows are main apps, not dialogs

    blockers: list[int] = []

    def _cb(hwnd: int, _: int) -> bool:
        if hwnd == tableau_hwnd or not user32.IsWindowVisible(hwnd):
            return True
        # Skip resizable (main application) windows
        if user32.GetWindowLongW(hwnd, -16) & WS_THICKFRAME:
            return True
        l = user32.GetWindowTextLengthW(hwnd)
        if l <= 0:
            return True
        buf = ctypes.create_unicode_buffer(l + 1)
        user32.GetWindowTextW(hwnd, buf, l + 1)
        title = buf.value.lower()
        if any(k in title for k in ("onedrive", "file recovery")):
            blockers.append(hwnd)
        return True

    user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(_cb), 0)
    for h in blockers:
        log.info("smart_capture: dismissing blocking dialog hwnd=%d", h)
        user32.PostMessageW(wintypes.HWND(h), WM_CLOSE, 0, 0)
        time.sleep(0.3)


def _smart_capture_all_tableau(
    source_path: Path,
    artifacts: list[dict],
    out_dir: Path,
    *,
    wait_sec: int = 60,
    max_render_wait: float = 10.0,
    use_vision: bool = True,
    quality_threshold: float = 14.0,
    max_retries: int = 3,
) -> list[dict]:
    """Open Tableau Desktop once and smart-capture every artifact.

    For each sheet:
      1. Force Tableau window topmost (fixes browser-covers-Tableau capture bug)
      2. Navigate tab by name: OCR → vision-model → keyboard Ctrl+PgDn
      3. Wait for rendering to stabilize (frame-diff analysis)
      4. Pixel quality check — retry with longer wait if too dark/blank
      5. Vision model verify (LM Studio) — final retry if vision rejects
    """
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32

    # Unhide all worksheet tabs so every artifact is keyboard-navigable.
    # This rewrites the <windows> section to remove hidden='true'.
    open_path, tab_order = _prep_capture_twbx(source_path)
    target_stem = open_path.stem.lower()   # "_percy_capture"
    log.info("smart_capture: prep'd unhidden workbook %s (tab_order=%s)", open_path.name, tab_order)

    # Re-order artifacts to match Tableau's tab strip order so keyboard nav is sequential.
    name_to_artifact: dict[str, dict] = {a["name"]: a for a in artifacts}
    sorted_artifacts: list[dict] = []
    for tab_name in tab_order:
        if tab_name in name_to_artifact:
            sorted_artifacts.append(name_to_artifact.pop(tab_name))
    sorted_artifacts.extend(name_to_artifact.values())  # any not in tab_order at the end

    # Kill any existing Tableau processes so we start clean (no file-recovery dialogs).
    import subprocess
    subprocess.run(["taskkill", "/F", "/IM", "tableau.exe"], capture_output=True)
    time.sleep(1.5)

    log.info("smart_capture: opening %s", open_path.name)
    os.startfile(str(open_path))  # type: ignore[attr-defined]

    # Wait for the actual Tableau Desktop workbook window — NOT the "Opening workbook..." loader.
    # The real window title is "Tableau - <WorkbookName>"; loading dialogs start with "Opening".
    hwnd = 0
    win_title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        for w in _visible_windows(user32):
            if not _is_tableau_window(w):
                continue
            t = w["title"].lower()
            if target_stem not in t:
                continue
            if t.startswith("opening") or t.startswith("tableau - opening"):
                continue  # skip "Opening workbook '...'" loader
            # Verify the window has actual non-zero bounds (not a hidden/unrendered window)
            r = wintypes.RECT()
            user32.GetWindowRect(wintypes.HWND(w["hwnd"]), ctypes.byref(r))
            if r.right - r.left < 100:
                continue
            hwnd = int(w["hwnd"])
            win_title = str(w["title"])
            break
        if hwnd:
            break
        time.sleep(1.5)

    if not hwnd:
        err = (
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}' ({wait_sec}s). "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it."
        )
        return [{"error": err, "slide_number": a["slide_number"], "ok": False} for a in artifacts]

    log.info("smart_capture: found Tableau window hwnd=%s title=%r", hwnd, win_title)

    # Maximize, then force topmost so the browser can't cover it during capture
    user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
    time.sleep(2.0)
    _force_hwnd_topmost(hwnd)
    time.sleep(1.0)

    # Dismiss any startup dialogs (File Recovery, license prompts, etc.) with Escape.
    # We press it several times with pauses to handle stacked dialogs.
    import pyautogui
    log.info("smart_capture: dismissing any startup dialogs (Escape ×5)")
    for _ in range(5):
        _force_hwnd_topmost(hwnd)
        time.sleep(0.2)
        pyautogui.press("escape")
        time.sleep(0.4)
    time.sleep(1.0)

    # Read window bounds after maximize
    rect = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
    win_l, win_t = int(rect.left), int(rect.top)
    win_r, win_b = int(rect.right), int(rect.bottom)
    win_rect = (win_l, win_t, win_r, win_b)
    log.info("smart_capture: window bounds L=%d T=%d R=%d B=%d", win_l, win_t, win_r, win_b)

    # Content crop: skip Tableau's left data panel, top toolbar, and bottom tab strip
    sidebar_w   = 330   # Tableau left panel (data pane) is ~330px wide when maximized
    toolbar_h   = 120   # Top toolbar + menu bar
    tab_strip_h = 50    # Bottom tab strip

    # Title bar click: safe focus point that does not trigger dashboard navigation actions.
    # Use win_t+25 to stay well away from the screen top (avoids Windows Snap triggers at y≈0).
    title_click_x = win_l + 600
    title_click_y = win_t + 25
    log.info("smart_capture: title bar focus click target (%d, %d)", title_click_x, title_click_y)

    def _grab() -> Image.Image:
        """Capture Tableau content area. Re-reads window bounds each call so a window
        move/restore after the initial bbox computation doesn't produce desktop screenshots."""
        # Restore window if it got minimized
        if user32.IsIconic(wintypes.HWND(hwnd)):
            user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
            time.sleep(1.0)
        _force_hwnd_topmost(hwnd)
        # Re-read current window position — title-bar click or OS snap may have moved it
        _r = wintypes.RECT()
        user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(_r))
        _l2, _t2, _r2, _b2 = int(_r.left), int(_r.top), int(_r.right), int(_r.bottom)
        _bbox = (_l2 + sidebar_w, _t2 + toolbar_h, _r2, _b2 - tab_strip_h)
        time.sleep(0.25)  # Let DWM composite the window before grabbing
        return ImageGrab.grab(bbox=_bbox)

    # One-time focus: click the window title bar (safe — does not trigger sheet navigation).
    # Tableau opens to the first sheet in the <windows> section (sorted_artifacts[0]).
    # After this single click, we use ONLY keyboard for all navigation (no further clicks).
    import pyautogui
    _force_hwnd_topmost(hwnd)
    _dismiss_blocking_dialogs(hwnd)
    time.sleep(0.2)
    _mouse_click_screen(title_click_x, title_click_y)
    time.sleep(0.8)
    # Verify Tableau is still foreground; if the click moved the window, re-read bounds
    _r_check = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(_r_check))
    win_l2, win_t2, win_r2, win_b2 = int(_r_check.left), int(_r_check.top), int(_r_check.right), int(_r_check.bottom)
    if (win_l2, win_t2, win_r2, win_b2) != (win_l, win_t, win_r, win_b):
        log.warning("smart_capture: window moved after focus click: %d,%d→%d,%d (was %d,%d→%d,%d) — re-maximizing",
                    win_l2, win_t2, win_r2, win_b2, win_l, win_t, win_r, win_b)
        user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
        time.sleep(1.0)
        _force_hwnd_topmost(hwnd)
        time.sleep(0.3)

    results: list[dict] = []
    current_tab_idx = 0  # Tableau opens to sorted_artifacts[0] (first sheet in <windows>)

    for i, artifact in enumerate(sorted_artifacts):
        sn   = artifact["slide_number"]
        name = artifact["name"]
        kind = artifact["kind"]
        out_path = out_dir / f"artifact-{sn:03d}.png"

        log.info("smart_capture: [%d/%d] navigating to '%s' (%s)", i + 1, len(sorted_artifacts), name, kind)
        _force_hwnd_topmost(hwnd)
        _dismiss_blocking_dialogs(hwnd)

        nav_method = "none"

        # ── Strategy 1: Tesseract OCR click on visible tab ───────────────────
        ocr_pos = _find_tab_via_ocr(name, win_rect)
        if ocr_pos:
            _mouse_click_screen(*ocr_pos)
            nav_method = "ocr"
            current_tab_idx = i
            log.info("smart_capture: OCR tab click for '%s' at %s", name, ocr_pos)

        # ── Strategy 2: pure keyboard navigation (no intermediate clicks) ────
        # Ctrl+PgDn/PgUp retains focus from the initial title bar click and
        # works reliably across all 23 tabs without any canvas re-clicking.
        if nav_method == "none":
            steps = i - current_tab_idx
            if steps != 0:
                _force_hwnd_topmost(hwnd)
                time.sleep(0.05)
                if steps > 0:
                    log.info("smart_capture: keyboard nav — Ctrl+PgDn ×%d for '%s'", steps, name)
                    for _ in range(steps):
                        pyautogui.hotkey("ctrl", "pagedown")
                        time.sleep(0.15)
                else:
                    log.info("smart_capture: keyboard nav — Ctrl+PgUp ×%d for '%s'", -steps, name)
                    for _ in range(-steps):
                        pyautogui.hotkey("ctrl", "pageup")
                        time.sleep(0.15)

            current_tab_idx = i
            nav_method = "keyboard"

        # Give Tableau time to load chart data from the extract before grabbing.
        # Without this wait, the blank white canvas (no chart rendered yet) stabilises
        # in <1 s and gets saved as a blank screenshot. 5 s covers typical extract query
        # times for worksheets with 400K-row datasets.
        # Also send Escape to dismiss any tooltip/overlay that might cover the viz.
        _force_hwnd_topmost(hwnd)
        pyautogui.press("escape")
        time.sleep(0.15)
        pyautogui.press("escape")
        time.sleep(5.0)

        # Capture with stability wait + quality check + optional vision verify
        capture_meta = _smart_capture_one(
            _grab, out_path, name,
            max_render_wait=max_render_wait,
            quality_threshold=quality_threshold,
            max_retries=max_retries,
            use_vision=use_vision,
        )

        results.append({
            "slide_number": sn,
            "name":         name,
            "kind":         kind,
            "path":         str(out_path),
            "nav_method":   nav_method,
            **capture_meta,
        })

        q   = capture_meta.get("quality_score", 0)
        vok = capture_meta.get("vision", {}).get("ok", "n/a")
        log.info("smart_capture: '%s' quality=%.1f vision=%s nav=%s", name, q, vok, nav_method)

    _restore_hwnd_notopmost(hwnd)

    # Clean up the temp unhidden workbook
    try:
        open_path.unlink(missing_ok=True)
    except Exception:
        pass

    return results


@app.post("/api/docs/{doc_id}/tableau/smart-capture-all")
def smart_capture_all_tableau_sheets(
    doc_id: str,
    wait_sec: int = 60,
    max_render_wait: float = 10.0,
    use_vision: bool = True,
    quality_threshold: float = 14.0,
    max_retries: int = 3,
):
    """Smart batch Tableau capture with stability detection, quality checks, and vision verification."""
    d = _require(doc_id)
    if d.get("source_format") != "tableau":
        raise HTTPException(400, "Document is not a Tableau workbook")
    if sys.platform != "win32":
        raise HTTPException(400, "Requires Windows + Tableau Desktop")
    source_path = Path(d["source_path"])
    if not source_path.exists():
        raise HTTPException(404, f"Source workbook missing: {source_path}")

    doc = d["doc"]
    artifacts: list[dict] = []
    for slide in doc.slides:
        props = slide.custom_properties or {}
        kind  = props.get("tableau_kind")
        if kind not in {"worksheet", "dashboard"}:
            continue
        info = props.get("tableau", {}) or {}
        name = info.get("name") or info.get("title") or f"Sheet {slide.slide_number}"
        artifacts.append({"slide_number": slide.slide_number, "name": name, "kind": kind})

    if not artifacts:
        raise HTTPException(400, "No worksheet or dashboard artifacts found")

    out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)

    results = _smart_capture_all_tableau(
        source_path, artifacts, out_dir,
        wait_sec=max(10, min(wait_sec, 300)),
        max_render_wait=max(2.0, min(max_render_wait, 60.0)),
        use_vision=use_vision,
        quality_threshold=quality_threshold,
        max_retries=max(1, min(max_retries, 5)),
    )

    artifact_captures = d.setdefault("tableau_artifact_captures", {})
    captured_count = 0
    for r in results:
        sn   = r.get("slide_number")
        path = r.get("path")
        if sn and path and Path(path).exists():
            artifact_captures[sn] = path
            captured_count += 1

    _record_event(
        d["source_path"], d["name"], "tableau", d["slide_count"],
        "tableau_smart_capture_all",
        f"Smart-captured {captured_count}/{len(artifacts)} sheets with quality verification",
        {"doc_id": doc_id, "captured": captured_count, "total": len(artifacts),
         "use_vision": use_vision},
        "ok",
    )
    _update_history_snapshot(doc_id)
    return {"captured": captured_count, "total": len(artifacts), "results": results}


def _capture_all_tableau_sheets(
    source_path: Path,
    artifacts: list[dict],
    out_dir: Path,
    wait_sec: int = 60,
    render_wait: float = 2.0,
) -> list[dict]:
    """Open Tableau Desktop once, cycle through every tab with Ctrl+PgDn, screenshot each."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target_stem = source_path.stem.lower()

    # Open the workbook via shell association
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    # Wait for a Tableau Desktop window (verified by process name, not just title)
    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target_stem in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1.0)

    if not hwnd:
        err = (
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}' ({wait_sec}s). "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it."
        )
        return [{"error": err, "slide_number": a["slide_number"]} for a in artifacts]

    # Maximize for consistent layout
    SW_MAXIMIZE = 3
    user32.ShowWindow(wintypes.HWND(hwnd), SW_MAXIMIZE)
    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(render_wait)

    # Navigate to the first sheet by name
    first_name = artifacts[0]["name"]
    _navigate_to_tableau_sheet(user32, hwnd, first_name)
    time.sleep(render_wait)

    # Compute content crop from maximized window bounds
    rect = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
    win_l, win_t, win_r, win_b = int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)

    # Tableau layout (maximized): left data panel ~240px, top toolbar ~90px, bottom tabs ~34px
    sidebar_w = 240
    toolbar_h = 90
    tab_strip_h = 34
    content_l = win_l + sidebar_w
    content_t = win_t + toolbar_h
    content_r = win_r
    content_b = win_b - tab_strip_h

    results = []
    for i, artifact in enumerate(artifacts):
        sn = artifact["slide_number"]
        name = artifact["name"]
        kind = artifact["kind"]

        if i > 0:
            _send_ctrl_pgdn(user32, hwnd)
            time.sleep(render_wait)

        out_path = out_dir / f"artifact-{sn:03d}.png"
        try:
            img = ImageGrab.grab(bbox=(content_l, content_t, content_r, content_b))
            img.save(out_path)
            results.append({"slide_number": sn, "name": name, "kind": kind, "path": str(out_path), "ok": True})
        except Exception as exc:
            results.append({"slide_number": sn, "name": name, "kind": kind, "error": str(exc), "ok": False})

    return results


def _capture_tableau_artifact_window(
    source_path: Path,
    artifact_name: str,
    artifact_kind: str,
    out_path: Path,
    wait_sec: int = 60,
) -> dict[str, Any]:
    """Open Tableau Desktop, navigate to a specific worksheet/dashboard tab, and screenshot it."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target_stem = source_path.stem.lower()

    # Open the workbook
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    # Wait for a real Tableau Desktop window (verified by process exe name)
    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target_stem in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1)

    if not hwnd:
        raise HTTPException(
            504,
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}'. "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it.",
        )

    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(2.0)  # Allow full render

    # Try to navigate to the specific sheet tab by name
    _navigate_to_tableau_sheet(user32, hwnd, artifact_name)
    time.sleep(1.0)  # Allow tab switch to render

    # Get window bounds
    rect = wintypes.RECT()
    if not user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise HTTPException(500, "Could not read Tableau window bounds")
    width = int(rect.right - rect.left)
    height = int(rect.bottom - rect.top)

    # Estimate Tableau's content area: skip left panel (~240px) and top toolbar (~90px)
    # The sheet tabs are at the bottom (~30px). Adjust based on window size.
    sidebar_w = min(250, width // 6)
    toolbar_h = min(90, height // 10)
    tab_strip_h = 30
    content_bbox = (
        int(rect.left) + sidebar_w,
        int(rect.top) + toolbar_h,
        int(rect.right),
        int(rect.bottom) - tab_strip_h,
    )

    image = ImageGrab.grab(bbox=content_bbox)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)

    return {
        "path": str(out_path),
        "title": title,
        "artifact_name": artifact_name,
        "artifact_kind": artifact_kind,
        "window_width": width,
        "window_height": height,
        "content_bbox": list(content_bbox),
        "source": str(source_path),
        "mode": "tableau_desktop_artifact_capture",
    }


def _navigate_to_tableau_sheet(user32: Any, hwnd: int, sheet_name: str) -> bool:
    """Try to navigate Tableau Desktop to a named sheet tab via child-window enumeration."""
    import ctypes
    from ctypes import wintypes

    found_hwnd = 0
    enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def callback(child_hwnd: Any, _lparam: Any) -> bool:
        nonlocal found_hwnd
        length = user32.GetWindowTextLengthW(child_hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(child_hwnd, buf, length + 1)
        text = buf.value.strip()
        if text.lower() == sheet_name.lower():
            found_hwnd = int(child_hwnd)
            return False  # stop enumeration
        return True

    user32.EnumChildWindows(wintypes.HWND(hwnd), enum_proc_type(callback), 0)

    if found_hwnd:
        WM_LBUTTONDOWN = 0x0201
        WM_LBUTTONUP = 0x0202
        user32.SendMessageW(wintypes.HWND(found_hwnd), WM_LBUTTONDOWN, 0, 0)
        user32.SendMessageW(wintypes.HWND(found_hwnd), WM_LBUTTONUP, 0, 0)
        return True

    # Fallback: Tableau sheet tabs may not appear as standard child windows.
    # Try Ctrl+Tab cycling to find the sheet by looking at window title changes.
    return False


def _capture_tableau_desktop_window(source_path: Path, out_path: Path, wait_sec: int = 45) -> dict[str, Any]:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target = source_path.stem.lower()

    # Shell/file association is the reliable path for Tableau Desktop here;
    # direct tableau.exe <file> launches Book1 on this machine.
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1)

    if not hwnd:
        raise HTTPException(
            504,
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}'. "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it.",
        )

    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(2)

    rect = wintypes.RECT()
    if not user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise HTTPException(500, "Could not read Tableau window bounds")
    width = int(rect.right - rect.left)
    height = int(rect.bottom - rect.top)
    if width <= 0 or height <= 0:
        raise HTTPException(500, f"Invalid Tableau window bounds: {width}x{height}")

    image = ImageGrab.grab(bbox=(int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)))
    image.save(out_path)
    return {
        "path": str(out_path),
        "title": title,
        "width": width,
        "height": height,
        "left": int(rect.left),
        "top": int(rect.top),
        "source": str(source_path),
        "mode": "tableau_desktop_window_capture",
    }


def _get_hwnd_exe(hwnd: Any) -> str:
    """Return the lowercase exe filename for the process that owns hwnd, or ''."""
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.windll.kernel32
    pid = wintypes.DWORD(0)
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return ""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    hproc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not hproc:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wintypes.DWORD(512)
        kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(size))
        return Path(buf.value).name.lower() if buf.value else ""
    finally:
        kernel32.CloseHandle(hproc)


def _visible_windows(user32: Any) -> list[dict[str, Any]]:
    import ctypes
    from ctypes import wintypes

    windows: list[dict[str, Any]] = []
    enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd: Any, _lparam: Any) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value.strip()
        if title:
            windows.append({"hwnd": int(hwnd), "title": title, "exe": _get_hwnd_exe(hwnd)})
        return True

    user32.EnumWindows(enum_proc_type(callback), 0)
    return windows


_TABLEAU_EXE_NAMES = {"tableau.exe", "tableaupublic.exe", "tableaudesktop.exe"}


def _is_tableau_window(w: dict[str, Any]) -> bool:
    """True only if the window belongs to a real Tableau Desktop process."""
    return w.get("exe", "") in _TABLEAU_EXE_NAMES


def _send_ctrl_pgdn(user32: Any, hwnd: int, canvas_xy: tuple[int, int] | None = None) -> None:
    """Send Ctrl+PgDn to navigate to the next Tableau tab."""
    import pyautogui
    _force_hwnd_topmost(hwnd)
    time.sleep(0.05)
    pyautogui.hotkey("ctrl", "pagedown")


@app.post("/api/docs/{doc_id}/rebuild")
def rebuild(doc_id: str):
    """Rebuild PercyDocument → PPTX, render rebuilt slides."""
    import traceback as _tb
    d = _require(doc_id)
    if d.get("source_format") != "pptx":
        raise HTTPException(400, "Rebuild is only supported for PPTX documents")
    log.info("rebuild: doc_id=%s  name=%s", doc_id, d["name"])
    _REBUILD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _REBUILD_DIR / f"{d['name']}_{doc_id}.pptx"

    t0 = time.perf_counter()
    try:
        result = _rebuild_pptx(d["doc"], out_path)
    except Exception as exc:
        tb = _tb.format_exc()
        log.error("rebuild: EXCEPTION for doc_id=%s\n%s", doc_id, tb)
        raise HTTPException(500, detail=f"{type(exc).__name__}: {exc}\n\n{tb}")
    d["rebuilt_path"] = str(out_path)
    d["diagnostics"]  = result.get("diagnostics", [])
    diagnostic_summary = _diagnostic_summary(d["diagnostics"])
    log.info("rebuild: done in %.1fs  diagnostics=%d  path=%s",
             time.perf_counter() - t0, len(d["diagnostics"]), out_path.name)

    rebuilt_dir = _CACHE_DIR / doc_id / "rebuilt"
    d["rebuilt_paths"] = []  # cleared while new render runs
    # COM render is slow (~60s/deck) — start in background, return immediately
    _render_originals_bg(doc_id, out_path, rebuilt_dir, "rebuilt_paths")
    log.info("rebuild: COM render started in background for doc_id=%s", doc_id)
    _record_event(
        d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
        "rebuild",
        f"Rebuild completed with {len(d['diagnostics'])} diagnostics",
        {
            "doc_id": doc_id,
            "rebuilt_path": str(out_path),
            "elapsed_sec": round(time.perf_counter() - t0, 1),
            "diagnostic_summary": diagnostic_summary,
        },
        "warn" if d["diagnostics"] else "ok",
    )
    _update_history_snapshot(doc_id)

    return {
        "rebuilt_path":         str(out_path),
        "has_rebuilt_renders":  False,   # not ready yet; UI polls
        "diagnostic_count":     len(d["diagnostics"]),
        "diagnostic_summary":   diagnostic_summary,
    }


@app.get("/api/docs/{doc_id}/diagnostics")
def get_diagnostics(doc_id: str):
    diags = _require(doc_id)["diagnostics"]
    log.info("get_diagnostics: doc_id=%s  count=%d", doc_id, len(diags))
    return {"diagnostics": diags}


def _serve_slide(paths: list[str], n: int, label: str) -> FileResponse:
    if not paths:
        raise HTTPException(404, f"{label} renders not available")
    if n < 1 or n > len(paths):
        raise HTTPException(404, f"Slide {n} out of range (1–{len(paths)})")
    p = Path(paths[n - 1])
    if not p.exists():
        raise HTTPException(404, f"{label} PNG missing from disk: {p}")
    return FileResponse(str(p), media_type="image/png",
                        headers={"Cache-Control": "max-age=60"})


@app.get("/api/docs/{doc_id}/slides/{n}/bridge.png")
def bridge_slide(doc_id: str, n: int):
    return _serve_slide(_require(doc_id)["bridge_paths"], n, "Bridge")


@app.get("/api/docs/{doc_id}/slides/{n}/original.png")
def original_slide(doc_id: str, n: int):
    return _serve_slide(_require(doc_id)["orig_paths"], n, "Original")


@app.get("/api/docs/{doc_id}/slides/{n}/rebuilt.png")
def rebuilt_slide(doc_id: str, n: int):
    d = _require(doc_id)
    if not d["rebuilt_path"]:
        raise HTTPException(400, "Not yet rebuilt — call POST /rebuild first")
    return _serve_slide(d["rebuilt_paths"], n, "Rebuilt")


@app.get("/api/docs/{doc_id}/render-status")
def render_status(doc_id: str):
    """Fast poll endpoint: returns current render availability without logging."""
    d = _require(doc_id)
    return {
        "has_originals":        bool(d["orig_paths"]),
        "has_bridge":           bool(d["bridge_paths"]),
        "has_rebuild":          bool(d["rebuilt_path"]),
        "has_rebuilt_renders":  bool(d["rebuilt_paths"]),
        "pixel_scores":         d.get("pixel_scores", {}),
    }


@app.post("/api/docs/{doc_id}/rerender")
def rerender_bridge(doc_id: str):
    """Re-render bridge slides using the in-memory doc (picks up renderer changes)."""
    d = _require(doc_id)
    bridge_dir = _CACHE_DIR / doc_id / "bridge"
    log.info("rerender: doc_id=%s", doc_id)
    t0 = time.perf_counter()
    paths = _render_bridge(d["doc"], bridge_dir)
    d["bridge_paths"] = paths
    elapsed = time.perf_counter() - t0
    log.info("rerender: wrote %d PNGs in %.1fs", len(paths), elapsed)
    _record_event(
        d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
        "rerender",
        f"Bridge re-rendered: {len(paths)} slides",
        {"doc_id": doc_id, "bridge_slides": len(paths), "elapsed_sec": round(elapsed, 1)},
        "ok" if paths else "warn",
    )
    _update_history_snapshot(doc_id)
    return {"bridge_slides": len(paths)}


@app.post("/api/docs/{doc_id}/save-to-cloud")
def save_to_cloud(doc_id: str):
    """Pickle the current in-memory PercyDocument and overwrite its S3 bundle.

    Only available for documents loaded via /api/load-bundle (have cloud_bundle_uri set).
    """
    import pickle as _pickle

    d = _require(doc_id)
    bundle_uri = d.get("cloud_bundle_uri")
    if not bundle_uri:
        raise HTTPException(400, "Document was not loaded from a cloud bundle")
    if not bundle_uri.startswith("s3://"):
        raise HTTPException(400, "Invalid cloud_bundle_uri format")

    parts = bundle_uri.removeprefix("s3://").split("/", 1)
    if len(parts) != 2:
        raise HTTPException(400, "Invalid S3 URI in cloud_bundle_uri")
    bucket, key = parts[0], parts[1]

    log.info("save-to-cloud: pickling doc_id=%s → %s", doc_id, bundle_uri)
    try:
        pkl_bytes = _pickle.dumps(d["doc"])
    except Exception as exc:
        raise HTTPException(500, f"Failed to pickle document: {exc}")

    try:
        import boto3 as _boto3
        import time as _time
        s3 = _boto3.client("s3")
        # Archive the previous version before overwriting
        version_key: str | None = None
        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            if head.get("ContentLength", 0) > 0:
                ts = int(_time.time())
                key_stem = key.rsplit(".", 1)
                version_key = f"{key_stem[0]}_v{ts}.{'pkl' if len(key_stem) < 2 else key_stem[1]}"
                s3.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": key}, Key=version_key)
                log.info("save-to-cloud: archived previous version → %s", version_key)
        except Exception:
            pass  # no previous version or head failed — safe to overwrite
        s3.put_object(Bucket=bucket, Key=key, Body=pkl_bytes, ContentType="application/octet-stream")
    except Exception as exc:
        log.exception("save-to-cloud: S3 upload failed")
        raise HTTPException(500, f"Failed to upload bundle to S3: {exc}")

    log.info("save-to-cloud: saved %d bytes → %s", len(pkl_bytes), bundle_uri)
    return {"ok": True, "bundle_uri": bundle_uri, "bytes": len(pkl_bytes),
            "version_archived": version_key}


@app.post("/api/docs/{doc_id}/slides/{n}/render")
def render_single_slide(doc_id: str, n: int):
    """Re-render one bridge slide PNG from the current in-memory Bridge model.

    Called by Studio after any text/position/fill edit so the canvas
    shows updated content without a full Rebuild.
    """
    from percy.diagnostics.render_png import _register_embedded_fonts  # type: ignore[attr-defined]

    d     = _require(doc_id)
    doc   = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    bridge_dir = _CACHE_DIR / doc_id / "bridge"
    bridge_dir.mkdir(parents=True, exist_ok=True)
    dest = bridge_dir / f"slide-{n:03d}.png"

    theme          = getattr(doc, "theme_colors", None) or None
    embedded_fonts = getattr(doc, "embedded_fonts", None)
    if embedded_fonts:
        _register_embedded_fonts(embedded_fonts)

    renderer = SlideRenderer(theme=theme)
    renderer.set_document(doc)
    try:
        fig = renderer.render_slide(slide)
        fig.savefig(str(dest), dpi=96, bbox_inches="tight", pad_inches=0)
        fig.clf()
    except Exception as exc:
        import traceback
        raise HTTPException(500, detail=f"Render failed: {exc}\n{traceback.format_exc()}")

    # Update bridge_paths so the PNG endpoint serves the fresh file
    if 1 <= n <= len(d.get("bridge_paths", [])):
        d["bridge_paths"][n - 1] = str(dest)

    log.info("render_single_slide: slide %d of %s → %s", n, doc_id, dest.name)
    return {"ok": True, "slide": n, "path": str(dest)}


@app.get("/api/docs/{doc_id}/export")
def export_pptx(doc_id: str):
    """Rebuild current Bridge model → stream rebuilt PPTX as a file download.

    This is the primary 'Save' action from Percy Studio.
    Runs rebuild_pptx() synchronously (may take 5–15s for large decks).
    """
    import traceback as _tb

    d = _require(doc_id)
    if d.get("source_format") != "pptx":
        raise HTTPException(400, "Export is only supported for PPTX documents")

    _REBUILD_DIR.mkdir(parents=True, exist_ok=True)
    stem     = Path(d["name"]).stem
    out_path = _REBUILD_DIR / f"{stem}_{doc_id}_studio.pptx"

    t0 = time.perf_counter()
    try:
        _rebuild_pptx(d["doc"], out_path)
    except Exception as exc:
        raise HTTPException(500, detail=f"Rebuild failed: {exc}\n{_tb.format_exc()}")

    log.info("export_pptx: rebuilt %s in %.1fs", out_path.name, time.perf_counter() - t0)
    return FileResponse(
        str(out_path),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{stem}_percy.pptx",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/docs/{doc_id}/grades")
def set_grade(doc_id: str, req: GradeRequest):
    d = _require(doc_id)
    if req.grade not in {"good", "partial", "bad"}:
        raise HTTPException(400, "Grade must be one of: good, partial, bad")
    if req.slide_n < 1 or req.slide_n > d["slide_count"]:
        raise HTTPException(400, f"Slide {req.slide_n} out of range")
    d["grades"][req.slide_n] = req.grade
    log.info("grade: doc_id=%s  slide=%d  grade=%s", doc_id, req.slide_n, req.grade)
    summary = _grade_summary(d["grades"], d["slide_count"])
    _record_event(
        d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
        "grade",
        f"Slide {req.slide_n} graded {req.grade}",
        {"doc_id": doc_id, "slide_n": req.slide_n, "grade": req.grade, "summary": summary},
    )
    _update_history_snapshot(doc_id)
    return {"ok": True, "slide_n": req.slide_n, "grade": req.grade,
            "summary": summary, "total_graded": summary["graded"]}


@app.get("/api/docs/{doc_id}/grades")
def get_grades(doc_id: str):
    d = _require(doc_id)
    return {"grades": d["grades"], "total_graded": len(d["grades"])}


@app.post("/api/docs/{doc_id}/slides/{n}/vision-grade")
def vision_grade_slide(doc_id: str, n: int, req: VisionGradeRequest):
    if not _vision_lock.acquire(blocking=False):
        raise HTTPException(429, "A local LM Studio vision request is already running")
    try:
        d = _require(doc_id)
        if req.target not in {"bridge", "rebuilt"}:
            raise HTTPException(400, "target must be one of: bridge, rebuilt")
        if n < 1 or n > d["slide_count"]:
            raise HTTPException(400, f"Slide {n} out of range")
        if not d["orig_paths"]:
            raise HTTPException(404, "Original render is not available yet")

        candidate_paths = d["bridge_paths"] if req.target == "bridge" else d["rebuilt_paths"]
        if req.target == "rebuilt" and not d["rebuilt_path"]:
            raise HTTPException(400, "Document has not been rebuilt yet")
        if not candidate_paths:
            raise HTTPException(404, f"{req.target} render is not available yet")
        if n > len(d["orig_paths"]) or n > len(candidate_paths):
            raise HTTPException(404, f"Slide {n} render is not available")

        original = Path(d["orig_paths"][n - 1])
        candidate = Path(candidate_paths[n - 1])
        diff = _CACHE_DIR / doc_id / "vision" / req.target / f"slide-{n:03d}-diff.png"
        rms = _image_diff(original, candidate, diff)
        vision = _call_lmstudio_slide_grade(
            original, candidate, diff,
            slide_n=n, target=req.target, lmstudio_url=req.lmstudio_url, model=req.model, rms=rms,
        )
        result = {
            "doc_id": doc_id,
            "slide_n": n,
            "target": req.target,
            "model": req.model,
            "lmstudio_url": req.lmstudio_url,
            "rms": round(rms, 2),
            "diff_path": str(diff),
            "vision": vision,
        }
        d.setdefault("vision_grades", []).insert(0, result)
        d["vision_grades"] = d["vision_grades"][:80]
        _record_event(
            d["source_path"], d["name"], d.get("source_format", "pptx"), d["slide_count"],
            "vision_grade",
            f"Vision graded slide {n} vs {req.target}: {vision.get('status')}",
            {"doc_id": doc_id, "slide_n": n, "target": req.target, "rms": round(rms, 2), "vision": vision},
            "ok" if vision.get("status") == "ok" else "warn",
        )
        _update_history_snapshot(doc_id)
        return result
    finally:
        _vision_lock.release()


# ── studio: element canvas endpoints ──────────────────────────────────────────

_ELEMENT_TYPE_LABELS: dict[str, str] = {
    "BridgeShape":     "Shape",
    "BridgeText":      "Text",
    "BridgeChart":     "Chart",
    "BridgeTable":     "Table",
    "BridgeImage":     "Image",
    "BridgeFreeform":  "Freeform",
    "BridgeConnector": "Connector",
    "BridgeGroup":     "Group",
}


def _element_id(el: Any, index: int) -> str:
    ident = getattr(el, "identification", None)
    shape_id = getattr(ident, "shape_id", None) if ident else None
    return str(shape_id) if shape_id is not None else f"idx_{index}"


def _serialize_element(el: Any, index: int, slide_w: float, slide_h: float) -> dict[str, Any]:
    pos   = el.position
    ident = getattr(el, "identification", None)
    xf    = getattr(el, "transforms", None)
    st    = getattr(el, "stacking", None)

    el_id    = _element_id(el, index)
    name     = (getattr(ident, "shape_name", None) if ident else None) or el_id
    rotation = float(getattr(xf, "rotation", 0.0) or 0.0)
    z_index  = int(getattr(st, "z_index", 1) or 1)
    el_type  = el.element_type

    left_pct  = (pos.left   / slide_w * 100) if slide_w else 0.0
    top_pct   = (pos.top    / slide_h * 100) if slide_h else 0.0
    width_pct = (pos.width  / slide_w * 100) if slide_w else 0.0
    height_pct= (pos.height / slide_h * 100) if slide_h else 0.0

    custom = getattr(el, "custom_properties", {}) or {}
    return {
        "id":          el_id,
        "index":       index,
        "type":        el_type,
        "label":       _ELEMENT_TYPE_LABELS.get(el_type, el_type),
        "name":        name,
        "left_in":     round(pos.left,   5),
        "top_in":      round(pos.top,    5),
        "width_in":    round(pos.width,  5),
        "height_in":   round(pos.height, 5),
        "left_pct":    round(left_pct,   5),
        "top_pct":     round(top_pct,    5),
        "width_pct":   round(width_pct,  5),
        "height_pct":  round(height_pct, 5),
        "rotation":    rotation,
        "z_index":     z_index,
        "locked":      bool(custom.get("studio_locked", False)),
        "hidden":      bool(custom.get("studio_hidden", False)),
    }


def _get_slide_dims(doc: Any, slide: Any) -> tuple[float, float]:
    w = slide.width  or getattr(doc.metadata, "slide_width",  None) or 10.0
    h = slide.height or getattr(doc.metadata, "slide_height", None) or 5.625
    return float(w), float(h)


# ── Slide management endpoints ────────────────────────────────────────────────

@app.post("/api/docs/{doc_id}/slides")
def add_slide(doc_id: str, after_n: int = 0):
    """Insert a blank slide after slide *after_n* (0 = append at end)."""
    from percy.bridge.elements import BridgeSlide
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    w, h = _get_slide_dims(doc, doc.slides[0]) if doc.slides else (13.333, 7.5)
    new_slide = BridgeSlide(slide_number=0, elements=[], width=w, height=h)
    if after_n <= 0 or after_n >= len(doc.slides):
        doc.slides.append(new_slide)
        pos = len(doc.slides)
    else:
        doc.slides.insert(after_n, new_slide)
        pos = after_n + 1
    # renumber
    for i, s in enumerate(doc.slides):
        s.slide_number = i + 1
    log.info("studio: added blank slide at position %d in %s", pos, doc_id)
    return {"slide_count": len(doc.slides), "new_slide_n": pos}


@app.delete("/api/docs/{doc_id}/slides/{n}")
def delete_slide(doc_id: str, n: int):
    """Delete slide *n*. Cannot delete the last slide."""
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    if len(doc.slides) <= 1:
        raise HTTPException(400, "Cannot delete the only slide")
    idx = next((i for i, s in enumerate(doc.slides) if s.slide_number == n), None)
    if idx is None:
        raise HTTPException(404, f"Slide {n} not found")
    doc.slides.pop(idx)
    for i, s in enumerate(doc.slides):
        s.slide_number = i + 1
    log.info("studio: deleted slide %d from %s", n, doc_id)
    return {"slide_count": len(doc.slides)}


@app.post("/api/docs/{doc_id}/slides/{n}/duplicate")
def duplicate_slide(doc_id: str, n: int):
    """Deep-copy slide *n* and insert the copy directly after it."""
    import copy as _copy
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    src = next((s for s in doc.slides if s.slide_number == n), None)
    if src is None:
        raise HTTPException(404, f"Slide {n} not found")
    dup = _copy.deepcopy(src)
    idx = doc.slides.index(src)
    doc.slides.insert(idx + 1, dup)
    for i, s in enumerate(doc.slides):
        s.slide_number = i + 1
    new_n = dup.slide_number
    log.info("studio: duplicated slide %d → %d in %s", n, new_n, doc_id)
    return {"slide_count": len(doc.slides), "new_slide_n": new_n}


@app.patch("/api/docs/{doc_id}/slides/{n}/move")
def move_slide(doc_id: str, n: int, to_n: int):
    """Move slide *n* to position *to_n* (1-based)."""
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    if not (1 <= to_n <= len(doc.slides)):
        raise HTTPException(400, f"to_n={to_n} out of range 1..{len(doc.slides)}")
    idx = next((i for i, s in enumerate(doc.slides) if s.slide_number == n), None)
    if idx is None:
        raise HTTPException(404, f"Slide {n} not found")
    slide = doc.slides.pop(idx)
    doc.slides.insert(to_n - 1, slide)
    for i, s in enumerate(doc.slides):
        s.slide_number = i + 1
    log.info("studio: moved slide %d → position %d in %s", n, to_n, doc_id)
    return {"slide_count": len(doc.slides)}


@app.patch("/api/docs/{doc_id}/slides/{n}/background")
def set_slide_background(doc_id: str, n: int, color: str | None = None):
    """Set slide background color (hex '#RRGGBB') or clear it (color=null)."""
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")
    slide.background_color = color
    slide.background_gradient_stops = []
    log.info("studio: set slide %d background to %s in %s", n, color, doc_id)
    return {"background_color": slide.background_color}


@app.get("/api/docs/{doc_id}/slides/{n}/notes")
def get_slide_notes(doc_id: str, n: int):
    """Return speaker notes text for a slide."""
    d = _require(doc_id)
    slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")
    cp = getattr(slide, "custom_properties", None) or {}
    return {"notes_text": cp.get("notes_text", "")}


class SlideNotesUpdate(BaseModel):
    notes_text: str


@app.patch("/api/docs/{doc_id}/slides/{n}/notes")
def update_slide_notes(doc_id: str, n: int, req: SlideNotesUpdate):
    """Set (or clear) speaker notes text for a slide."""
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")
    cp = getattr(slide, "custom_properties", None)
    if cp is None:
        slide.custom_properties = {}
        cp = slide.custom_properties
    cp["notes_text"] = req.notes_text
    log.info("studio: updated notes for slide %d of %s", n, doc_id)
    return {"notes_text": req.notes_text}


@app.get("/api/docs/{doc_id}/slides/{n}/elements")
def get_slide_elements(doc_id: str, n: int):
    """Return all Bridge elements on slide *n* with position in inches and percent."""
    d    = _require(doc_id)
    doc  = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")
    w, h = _get_slide_dims(doc, slide)
    elements = [_serialize_element(el, i, w, h) for i, el in enumerate(slide.elements)]
    return {
        "slide_number":      n,
        "slide_width_in":    round(w, 5),
        "slide_height_in":   round(h, 5),
        "element_count":     len(elements),
        "elements":          elements,
        "background_color":  getattr(slide, "background_color", None),
    }


@app.patch("/api/docs/{doc_id}/slides/{n}/elements/{element_id}")
def update_element_position(doc_id: str, n: int, element_id: str, req: ElementPositionUpdate):
    """Move or resize a Bridge element; updates the in-memory PercyDocument."""
    _snapshot_doc(doc_id)
    d    = _require(doc_id)
    doc  = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    el = el_index = None
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            el, el_index = e, i
            break
    if el is None:
        raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")

    pos = el.position
    if req.left_in   is not None: pos.left          = max(0.0,  req.left_in)
    if req.top_in    is not None: pos.top           = max(0.0,  req.top_in)
    if req.width_in  is not None: pos.width         = max(0.05, req.width_in)
    if req.height_in is not None: pos.height        = max(0.05, req.height_in)
    if req.z_index   is not None: el.stacking.z_index = max(1,  req.z_index)
    if req.rotation  is not None:
        xf = getattr(el, "transforms", None)
        if xf is not None: xf.rotation = req.rotation % 360
    if req.name is not None:
        ident = getattr(el, "identification", None)
        if ident is not None: ident.shape_name = req.name.strip() or ident.shape_name

    w, h = _get_slide_dims(doc, slide)
    log.info("studio: moved element %s on slide %d of %s → (%.3f, %.3f) %.3fx%.3f in",
             element_id, n, doc_id, pos.left, pos.top, pos.width, pos.height)
    return _serialize_element(el, el_index, w, h)


class AlignElementsRequest(BaseModel):
    element_ids: list[str]
    alignment: str   # left|center|right|top|middle|bottom|distribute_h|distribute_v


@app.post("/api/docs/{doc_id}/slides/{n}/align-elements")
def align_elements(doc_id: str, n: int, req: AlignElementsRequest):
    """Align or distribute a set of elements on a slide."""
    if len(req.element_ids) < 2:
        raise HTTPException(400, "Need at least 2 element IDs to align")
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")

    id_set = set(req.element_ids)
    els: list[tuple[Any, int]] = []
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) in id_set:
            els.append((e, i))

    if not els:
        raise HTTPException(404, "No matching elements found")

    # Collect geometry
    def geo(el: Any):
        p = el.position
        return p.left, p.top, p.width, p.height

    lefts  = [geo(e)[0]                for e, _ in els]
    tops   = [geo(e)[1]                for e, _ in els]
    rights = [geo(e)[0] + geo(e)[2]    for e, _ in els]
    bottoms= [geo(e)[1] + geo(e)[3]    for e, _ in els]
    widths = [geo(e)[2]                for e, _ in els]
    heights= [geo(e)[3]                for e, _ in els]
    centers_h = [(l + r) / 2 for l, r in zip(lefts, rights)]
    middles_v = [(t + b) / 2 for t, b in zip(tops, bottoms)]

    a = req.alignment
    if a == "left":
        anchor = min(lefts)
        for (e, _), _ in zip(els, lefts):
            e.position.left = anchor
    elif a == "center":
        anchor = (min(lefts) + max(rights)) / 2
        for (e, _), w in zip(els, widths):
            e.position.left = anchor - w / 2
    elif a == "right":
        anchor = max(rights)
        for (e, _), w in zip(els, widths):
            e.position.left = anchor - w
    elif a == "top":
        anchor = min(tops)
        for (e, _), _ in zip(els, tops):
            e.position.top = anchor
    elif a == "middle":
        anchor = (min(tops) + max(bottoms)) / 2
        for (e, _), h in zip(els, heights):
            e.position.top = anchor - h / 2
    elif a == "bottom":
        anchor = max(bottoms)
        for (e, _), h in zip(els, heights):
            e.position.top = anchor - h
    elif a == "distribute_h":
        if len(els) >= 2:
            sorted_pairs = sorted(zip(lefts, els), key=lambda x: x[0])
            total_span = sorted_pairs[-1][0] + widths[els.index(sorted_pairs[-1][1])] - sorted_pairs[0][0]
            total_widths = sum(widths)
            gap = (total_span - total_widths) / (len(els) - 1)
            cursor = sorted_pairs[0][0]
            for left_val, (e, _) in sorted_pairs:
                e.position.left = cursor
                cursor += e.position.width + gap
    elif a == "distribute_v":
        if len(els) >= 2:
            sorted_pairs = sorted(zip(tops, els), key=lambda x: x[0])
            total_span = sorted_pairs[-1][0] + heights[els.index(sorted_pairs[-1][1])] - sorted_pairs[0][0]
            total_heights = sum(heights)
            gap = (total_span - total_heights) / (len(els) - 1)
            cursor = sorted_pairs[0][0]
            for top_val, (e, _) in sorted_pairs:
                e.position.top = cursor
                cursor += e.position.height + gap
    else:
        raise HTTPException(400, f"Unknown alignment: {req.alignment!r}")

    w, h = _get_slide_dims(doc, slide)
    return [_serialize_element(e, i, w, h) for e, i in els]


class ElementFlagsUpdate(BaseModel):
    locked: bool | None = None
    hidden: bool | None = None


@app.patch("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/flags")
def update_element_flags(doc_id: str, n: int, element_id: str, req: ElementFlagsUpdate):
    """Set studio_locked / studio_hidden flags in element's custom_properties."""
    _snapshot_doc(doc_id)
    d    = _require(doc_id)
    doc  = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    el = el_index = None
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            el, el_index = e, i
            break
    if el is None:
        raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")

    custom = getattr(el, "custom_properties", None)
    if custom is None:
        raise HTTPException(400, "Element does not support custom_properties")

    if req.locked is not None: custom["studio_locked"] = req.locked
    if req.hidden is not None: custom["studio_hidden"] = req.hidden

    w, h = _get_slide_dims(doc, slide)
    return _serialize_element(el, el_index, w, h)


@app.delete("/api/docs/{doc_id}/slides/{n}/elements/{element_id}")
def delete_element(doc_id: str, n: int, element_id: str):
    """Remove an element from a slide."""
    _snapshot_doc(doc_id)
    d    = _require(doc_id)
    doc  = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            slide.elements.pop(i)
            log.info("studio: deleted element %s from slide %d of %s", element_id, n, doc_id)
            return {"ok": True, "deleted": element_id}
    raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")


@app.post("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/duplicate")
def duplicate_element(doc_id: str, n: int, element_id: str):
    """Deep-copy an element, offset by 0.25 inches, append to slide."""
    import copy
    _snapshot_doc(doc_id)
    d    = _require(doc_id)
    doc  = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    src = src_index = None
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            src, src_index = e, i
            break
    if src is None:
        raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")

    dup = copy.deepcopy(src)
    dup.position.left += 0.25
    dup.position.top  += 0.25

    # Assign a fresh shape_id so it gets a unique _element_id
    ident = getattr(dup, "identification", None)
    if ident is not None:
        existing_ids = {getattr(getattr(e, "identification", None), "shape_id", None) for e in slide.elements}
        new_id = max((x for x in existing_ids if x is not None), default=0) + 1
        ident.shape_id = new_id

    slide.elements.append(dup)
    new_index = len(slide.elements) - 1
    w, h = _get_slide_dims(doc, slide)
    log.info("studio: duplicated element %s → %s on slide %d", element_id, _element_id(dup, new_index), n)
    return _serialize_element(dup, new_index, w, h)


@app.post("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/copy-to-slide")
def copy_element_to_slide(doc_id: str, n: int, element_id: str, target_n: int, offset_x: float = 0.25, offset_y: float = 0.25):
    """Deep-copy an element from slide n to slide target_n at a small offset.

    Used for cross-slide paste. When n == target_n behaves like duplicate but on
    a different target slide; when n != target_n it copies across slides.
    """
    import copy
    _snapshot_doc(doc_id)
    d    = _require(doc_id)
    doc  = d["doc"]
    src_slide = next((s for s in doc.slides if s.slide_number == n), None)
    if src_slide is None:
        raise HTTPException(404, f"Slide {n} not found")
    tgt_slide = next((s for s in doc.slides if s.slide_number == target_n), None)
    if tgt_slide is None:
        raise HTTPException(404, f"Target slide {target_n} not found")

    src = None
    for i, e in enumerate(src_slide.elements):
        if _element_id(e, i) == element_id:
            src = e
            break
    if src is None:
        raise HTTPException(404, f"Element {element_id!r} not found")

    dup = copy.deepcopy(src)
    dup.position.left += offset_x
    dup.position.top  += offset_y

    ident = getattr(dup, "identification", None)
    if ident is not None:
        existing_ids = {getattr(getattr(e, "identification", None), "shape_id", None) for e in tgt_slide.elements}
        new_id = max((x for x in existing_ids if x is not None), default=0) + 1
        ident.shape_id = new_id

    tgt_slide.elements.append(dup)
    new_index = len(tgt_slide.elements) - 1
    w, h = _get_slide_dims(doc, tgt_slide)
    log.info("studio: copied element %s from slide %d → slide %d", element_id, n, target_n)
    return _serialize_element(dup, new_index, w, h)


class NewElementRequest(BaseModel):
    shape_type: str = "rect"   # geometry preset: "rect" | "roundRect" | "ellipse" | "triangle" etc.
    left_in: float = 1.0
    top_in: float = 1.0
    width_in: float = 2.0
    height_in: float = 1.0
    fill_color: str = "#4472C4"
    label: str = "New Shape"


@app.post("/api/docs/{doc_id}/slides/{n}/elements/image")
async def create_image_element(doc_id: str, n: int, file: UploadFile = File(...)):
    """Upload an image file and insert a new BridgeImage element at the center of the slide."""
    from percy.bridge.elements import (  # type: ignore[attr-defined]
        BridgeImage, ImageData, ImageFileInfo, ImageDimensions, ImageCropping,
        ImageBorder, ShapeShadow, Position, Transform, Stacking, Identification, Accessibility,
    )
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Uploaded file is empty")

    try:
        from PIL import Image as _PIL
        import io as _io
        with _PIL.open(_io.BytesIO(raw)) as img:
            fmt = (img.format or "png").lower()
            img_w, img_h = img.size
    except Exception:
        fmt = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
        img_w, img_h = None, None

    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found")

    sw, sh = _get_slide_dims(doc, slide)
    # Default to 4×3 inches at center, preserving aspect ratio if known
    default_w = 4.0
    default_h = 3.0
    if img_w and img_h and img_w > 0:
        default_h = default_w * img_h / img_w
    left = max(0.0, (sw - default_w) / 2)
    top  = max(0.0, (sh - default_h) / 2)

    existing_ids = {getattr(getattr(e, "identification", None), "shape_id", None) for e in slide.elements}
    new_id = max((x for x in existing_ids if x is not None), default=0) + 1
    max_z  = max((getattr(e.stacking, "z_index", 1) for e in slide.elements), default=0)

    el = BridgeImage(
        position=Position(left=left, top=top, width=default_w, height=default_h),
        transforms=Transform(),
        stacking=Stacking(z_index=max_z + 1),
        identification=Identification(shape_id=new_id, shape_name=file.filename or "image"),
        accessibility=Accessibility(alt_text=file.filename or "image"),
        image_data=ImageData(image_bytes=raw, image_format=fmt),
        file_info=ImageFileInfo(original_filename=file.filename),
        dimensions=ImageDimensions(width_px=img_w, height_px=img_h),
        cropping=ImageCropping(),
        border=ImageBorder(),
        shadow=ShapeShadow(),
    )
    slide.elements.append(el)
    new_index = len(slide.elements) - 1

    # Re-render the slide PNG so the new image shows up
    bridge_dir = _CACHE_DIR / doc_id / "bridge"
    try:
        from percy.diagnostics.render_png import render_bridge_slides as _rbs  # type: ignore[attr-defined]
        _rbs(doc, bridge_dir, slide_numbers=[n])
    except Exception as exc:
        log.warning("create_image_element: re-render failed: %s", exc)

    log.info("create_image_element: added %s (%d bytes) to slide %d of %s", fmt, len(raw), n, doc_id)
    return _serialize_element(el, new_index, sw, sh)


@app.post("/api/docs/{doc_id}/slides/{n}/elements")
def create_element(doc_id: str, n: int, req: NewElementRequest):
    """Insert a new BridgeShape element on a slide."""
    from percy.bridge.elements import (
        BridgeShape, Position, Transform, Stacking, Identification,
        Accessibility, ShapeIdentification, ShapeFill, ShapeLine,
        ShapeShadow, ShapeTextContent, ShapeTextFrame, ShapeBorders, ColorSpec,
    )
    _snapshot_doc(doc_id)
    d = _require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    existing_ids = {getattr(getattr(e, "identification", None), "shape_id", None) for e in slide.elements}
    new_id = max((x for x in existing_ids if x is not None), default=0) + 1
    max_z  = max((getattr(e.stacking, "z_index", 1) for e in slide.elements), default=0)

    is_text_box = req.shape_type == "text_box"
    el = BridgeShape(
        position=Position(left=req.left_in, top=req.top_in, width=req.width_in, height=req.height_in),
        transforms=Transform(),
        stacking=Stacking(z_index=max_z + 1),
        identification=Identification(shape_id=new_id, shape_name=req.label),
        accessibility=Accessibility(alt_text=req.label),
        shape_identification=ShapeIdentification(
            shape_type="auto_shape",
            geometry_preset="rect" if is_text_box else req.shape_type,
        ),
        fill=ShapeFill(fill_type="none" if is_text_box else "solid",
                       color=None if is_text_box else ColorSpec(value=req.fill_color)),
        line=ShapeLine(visible=False),
        shadow=ShapeShadow(),
        text_content=ShapeTextContent(),
        text_frame=ShapeTextFrame(),
        borders=ShapeBorders(),
    )
    slide.elements.append(el)
    new_index = len(slide.elements) - 1
    w, h = _get_slide_dims(doc, slide)
    log.info("studio: created new %s element on slide %d of %s", req.shape_type, n, doc_id)
    return _serialize_element(el, new_index, w, h)


# ── Undo/redo snapshot stack ──────────────────────────────────────────────────
_MAX_UNDO = 50

def _snapshot_doc(doc_id: str) -> None:
    """Push a pickle snapshot of the current doc to the undo stack."""
    import pickle as _pickle
    d = _docs.get(doc_id)
    if d is None or d.get("doc") is None:
        return
    stack: list = d.setdefault("_undo_stack", [])
    try:
        stack.append(_pickle.dumps(d["doc"]))
    except Exception as exc:
        log.warning("_snapshot_doc: could not pickle doc: %s", exc)
        return
    if len(stack) > _MAX_UNDO:
        stack.pop(0)
    d["_redo_stack"] = []


@app.get("/api/docs/{doc_id}/undo-state")
def get_undo_state(doc_id: str):
    """Return current undo and redo stack depths."""
    d = _require(doc_id)
    return {
        "undo_depth": len(d.get("_undo_stack", [])),
        "redo_depth": len(d.get("_redo_stack", [])),
    }


@app.post("/api/docs/{doc_id}/undo")
def undo(doc_id: str):
    """Restore previous Bridge model snapshot."""
    import pickle as _pickle
    d = _require(doc_id)
    stack = d.get("_undo_stack", [])
    if not stack:
        raise HTTPException(400, "Nothing to undo")
    redo_stack: list = d.setdefault("_redo_stack", [])
    try:
        redo_stack.append(_pickle.dumps(d["doc"]))
    except Exception:
        pass
    d["doc"] = _pickle.loads(stack.pop())
    log.info("undo: %s — %d undo / %d redo remain", doc_id, len(stack), len(redo_stack))
    return {"ok": True, "undo_depth": len(stack), "redo_depth": len(redo_stack)}


@app.post("/api/docs/{doc_id}/redo")
def redo_action(doc_id: str):
    """Re-apply the last undone operation."""
    import pickle as _pickle
    d = _require(doc_id)
    redo_stack = d.get("_redo_stack", [])
    if not redo_stack:
        raise HTTPException(400, "Nothing to redo")
    stack: list = d.setdefault("_undo_stack", [])
    try:
        stack.append(_pickle.dumps(d["doc"]))
    except Exception:
        pass
    d["doc"] = _pickle.loads(redo_stack.pop())
    log.info("redo: %s — %d undo / %d redo remain", doc_id, len(stack), len(redo_stack))
    return {"ok": True, "undo_depth": len(stack), "redo_depth": len(redo_stack)}


# ── Text content helpers ──────────────────────────────────────────────────────

def _color_to_str(c: Any) -> str | None:
    if c is None:
        return None
    v = getattr(c, "value", None)
    return v if v else None


def _str_to_color(s: str | None) -> Any:
    if not s:
        return None
    from percy.bridge.elements import ColorSpec
    return ColorSpec(value=s)


def _ser_run(run: Any, idx: int) -> dict:
    return {
        "idx":            idx,
        "text":           run.text or "",
        "is_line_break":  bool(getattr(run, "is_line_break", False)),
        "font_name":      run.font_name,
        "font_size":      run.font_size,
        "font_bold":      run.font_bold,
        "font_italic":    run.font_italic,
        "font_underline": run.font_underline,
        "font_color":     _color_to_str(run.font_color),
        "strikethrough":  run.strikethrough,
        "font_caps":      run.font_caps,
    }


def _ser_para(para: Any, idx: int) -> dict:
    return {
        "idx":          idx,
        "alignment":    para.alignment,
        "space_before": para.space_before,
        "space_after":  para.space_after,
        "runs":         [_ser_run(r, i) for i, r in enumerate(para.runs)],
    }


def _get_paras(el: Any, el_type: str) -> list:
    if el_type in ("BridgeText", "BridgeFreeform"):
        return getattr(el, "paragraphs", []) or []
    if el_type == "BridgeShape":
        tc = getattr(el, "text_content", None)
        return getattr(tc, "paragraphs", []) or [] if tc else []
    return []


def _serialize_element_text_content(el: Any, el_type: str) -> dict:
    if el_type in ("BridgeText", "BridgeShape", "BridgeFreeform"):
        paras = _get_paras(el, el_type)
        return {
            "kind":       "paragraphs",
            "paragraphs": [_ser_para(p, i) for i, p in enumerate(paras)],
        }

    if el_type == "BridgeChart":
        t   = el.title
        cat = el.category_axis
        val = el.value_axis
        leg = el.legend
        return {
            "kind":  "chart",
            "title": {
                "text":       t.title,
                "font_size":  t.title_font_size,
                "font_bold":  t.title_font_bold,
                "font_italic":t.title_font_italic,
                "font_name":  t.title_font_name,
                "font_color": _color_to_str(t.title_font_color),
            },
            "cat_axis_title": {
                "text":      cat.title.title_text,
                "font_size": cat.title.title_font_size,
                "font_bold": cat.title.title_font_bold,
                "font_name": cat.title.title_font_name,
            } if cat else None,
            "val_axis_title": {
                "text":      val.title.title_text,
                "font_size": val.title.title_font_size,
                "font_bold": val.title.title_font_bold,
                "font_name": val.title.title_font_name,
            } if val else None,
            "legend": {
                "font_size":  leg.font_size,
                "font_bold":  leg.font_bold,
                "font_name":  leg.font_name,
                "font_color": _color_to_str(leg.font_color),
            } if leg else None,
            "series": [
                {
                    "idx":  i,
                    "name": s.name,
                    "data_labels": {
                        "show":      s.data_labels.show,
                        "font_size": s.data_labels.font_size,
                        "font_bold": s.data_labels.font_bold,
                        "font_name": s.data_labels.font_name,
                        "font_color":_color_to_str(s.data_labels.font_color),
                    },
                }
                for i, s in enumerate(el.series)
            ],
        }

    if el_type == "BridgeTable":
        cfs = getattr(el, "cell_formats", []) or []
        return {
            "kind": "table",
            "rows": len(cfs),
            "cols": len(cfs[0]) if cfs else 0,
            "cells": [
                [
                    {
                        "row":        r,
                        "col":        c,
                        "text":       cf.text or "",
                        "paragraphs": [_ser_para(p, i) for i, p in enumerate(cf.paragraphs or [])],
                        "font_name":  cf.font.font_name,
                        "font_size":  cf.font.font_size,
                        "font_bold":  cf.font.font_bold,
                        "font_italic":cf.font.font_italic,
                    }
                    for c, cf in enumerate(row)
                ]
                for r, row in enumerate(cfs)
            ],
        }

    return {"kind": "none"}


def _apply_run_spec_to(run: Any, spec: RunSpec) -> None:
    run.text        = spec.text
    run.is_line_break = spec.is_line_break
    if spec.font_name      is not None: run.font_name      = spec.font_name or None
    if spec.font_size      is not None: run.font_size      = spec.font_size
    if spec.font_bold      is not None: run.font_bold      = spec.font_bold
    if spec.font_italic    is not None: run.font_italic    = spec.font_italic
    if spec.font_underline is not None: run.font_underline = spec.font_underline
    if spec.font_color     is not None: run.font_color     = _str_to_color(spec.font_color)
    if spec.strikethrough  is not None: run.strikethrough  = spec.strikethrough or None
    if spec.font_caps      is not None: run.font_caps      = spec.font_caps or None


def _apply_text_update(el: Any, el_type: str, req: TextUpdateRequest) -> None:
    from percy.bridge.elements import TextParagraph, TextRun  # type: ignore[attr-defined]

    if req.kind == "paragraphs" and req.paragraphs is not None:
        old_paras = _get_paras(el, el_type)
        new_paras: list[Any] = []
        for i, pspec in enumerate(req.paragraphs):
            para = old_paras[i] if i < len(old_paras) else TextParagraph()
            if pspec.alignment    is not None: para.alignment    = pspec.alignment or None
            if pspec.space_before is not None: para.space_before = pspec.space_before
            if pspec.space_after  is not None: para.space_after  = pspec.space_after
            if pspec.runs:
                new_runs: list[Any] = []
                for j, rspec in enumerate(pspec.runs):
                    run = para.runs[j] if j < len(para.runs) else TextRun()
                    _apply_run_spec_to(run, rspec)
                    new_runs.append(run)
                para.runs = new_runs
            new_paras.append(para)
        if el_type in ("BridgeText", "BridgeFreeform"):
            el.paragraphs = new_paras
        elif el_type == "BridgeShape":
            tc = getattr(el, "text_content", None)
            if tc:
                tc.paragraphs = new_paras
                tc.has_text   = bool(any(
                    not getattr(r, "is_line_break", False) and r.text
                    for p in new_paras for r in p.runs
                ))

    elif req.kind == "chart" and req.chart is not None and el_type == "BridgeChart":
        cu = req.chart
        t  = el.title
        if cu.title_text       is not None: t.title             = cu.title_text
        if cu.title_font_size  is not None: t.title_font_size   = cu.title_font_size
        if cu.title_font_bold  is not None: t.title_font_bold   = cu.title_font_bold
        if cu.title_font_italic is not None: t.title_font_italic = cu.title_font_italic
        if cu.title_font_name  is not None: t.title_font_name   = cu.title_font_name
        if cu.cat_axis_title is not None and el.category_axis:
            el.category_axis.title.title_text = cu.cat_axis_title
        if cu.val_axis_title is not None and el.value_axis:
            el.value_axis.title.title_text = cu.val_axis_title
        if el.legend:
            if cu.legend_font_size is not None: el.legend.font_size = cu.legend_font_size
            if cu.legend_font_bold is not None: el.legend.font_bold = cu.legend_font_bold
            if cu.legend_font_name is not None: el.legend.font_name = cu.legend_font_name

    elif req.kind == "table_cell" and req.table_cell is not None and el_type == "BridgeTable":
        tc = req.table_cell
        cfs = getattr(el, "cell_formats", [])
        if 0 <= tc.row < len(cfs) and 0 <= tc.col < len(cfs[tc.row]):
            cf = cfs[tc.row][tc.col]
            if tc.text is not None:
                cf.text = tc.text
                if cf.paragraphs and cf.paragraphs[0].runs:
                    cf.paragraphs[0].runs[0].text = tc.text
            if tc.font_bold   is not None: cf.font.font_bold   = tc.font_bold
            if tc.font_italic is not None: cf.font.font_italic = tc.font_italic
            if tc.font_size   is not None: cf.font.font_size   = tc.font_size
            if tc.font_name   is not None: cf.font.font_name   = tc.font_name


# ── Text content endpoints ─────────────────────────────────────────────────────

def _find_element(doc_id: str, n: int, element_id: str):
    d     = _require(doc_id)
    slide = next((s for s in d["doc"].slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            return e
    raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")


@app.get("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/text")
def get_element_text(doc_id: str, n: int, element_id: str):
    el = _find_element(doc_id, n, element_id)
    return _serialize_element_text_content(el, el.element_type)


@app.patch("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/text")
def update_element_text(doc_id: str, n: int, element_id: str, req: TextUpdateRequest):
    _snapshot_doc(doc_id)
    el = _find_element(doc_id, n, element_id)
    _apply_text_update(el, el.element_type, req)
    log.info("studio: updated text on %s slide %d of %s", element_id, n, doc_id)
    return _serialize_element_text_content(el, el.element_type)


# ── Image replacement ─────────────────────────────────────────────────────────

@app.post("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/replace-image")
async def replace_image(doc_id: str, n: int, element_id: str, file: UploadFile = File(...)):
    """Replace the image bytes in a BridgeImage element with a newly uploaded file.

    Accepts any image format that PIL can decode (jpg, png, gif, webp, etc.).
    After updating the model the slide is re-rendered automatically.
    """
    el = _find_element(doc_id, n, element_id)
    if getattr(el, "element_type", "") != "BridgeImage":
        raise HTTPException(400, f"Element {element_id!r} is not a BridgeImage")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Uploaded file is empty")

    # Detect format from PIL rather than trusting the MIME type
    try:
        from PIL import Image as _PIL
        import io as _io
        with _PIL.open(_io.BytesIO(raw)) as img:
            fmt = img.format.lower() if img.format else "png"
    except Exception:
        fmt = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"

    _snapshot_doc(doc_id)
    from percy.bridge.elements import ImageData as _ImageData  # type: ignore[attr-defined]
    el.image_data = _ImageData(image_bytes=raw, image_format=fmt)

    # Re-render just this slide
    d = _require(doc_id)
    bridge_dir = _CACHE_DIR / doc_id / "bridge"
    try:
        from percy.diagnostics.render_png import render_bridge_slides as _rbs  # type: ignore[attr-defined]
        _rbs(d["doc"], bridge_dir, slide_numbers=[n])
    except Exception as exc:
        log.warning("replace-image: re-render failed (non-fatal): %s", exc)

    log.info("replace-image: replaced image on slide %d element %s (%d bytes, fmt=%s)", n, element_id, len(raw), fmt)
    return {"ok": True, "bytes": len(raw), "format": fmt}


# ── Find & Replace ────────────────────────────────────────────────────────────

def _element_plain_text(el: Any) -> str:
    """Return all plain text from a Bridge element (for search preview)."""
    et = getattr(el, "element_type", "")
    if et in ("BridgeText", "BridgeShape", "BridgeFreeform"):
        parts: list[str] = []
        for p in _get_paras(el, et):
            parts.extend(r.text for r in getattr(p, "runs", []) if getattr(r, "text", None))
        return " ".join(parts)
    if et == "BridgeChart":
        return getattr(el.title, "title", None) or ""
    if et == "BridgeTable":
        parts = []
        for row in getattr(el, "cell_formats", []):
            for cell in row:
                t = getattr(cell, "text", None)
                if t:
                    parts.append(t)
        return " ".join(parts)
    return ""


def _replace_in_element(el: Any, find: str, replace: str, case_sensitive: bool) -> int:
    """Replace text in-place. Returns number of replacements made."""
    count = 0
    et = getattr(el, "element_type", "")
    cmp_find = find if case_sensitive else find.lower()

    def _sub(text: str) -> tuple[str, int]:
        if case_sensitive:
            if find in text:
                return text.replace(find, replace), text.count(find)
        else:
            if cmp_find in text.lower():
                import re as _re
                new_text, n = _re.subn(_re.escape(find), replace, text, flags=_re.IGNORECASE)
                return new_text, n
        return text, 0

    if et in ("BridgeText", "BridgeShape", "BridgeFreeform"):
        for p in _get_paras(el, et):
            for run in getattr(p, "runs", []):
                if getattr(run, "text", None):
                    new_text, n = _sub(run.text)
                    if n:
                        run.text = new_text
                        count += n
    elif et == "BridgeChart":
        t = el.title
        if getattr(t, "title", None):
            new_text, n = _sub(t.title)
            if n:
                t.title = new_text
                count += n
    elif et == "BridgeTable":
        for row in getattr(el, "cell_formats", []):
            for cell in row:
                ct = getattr(cell, "text", None)
                if ct:
                    new_text, n = _sub(ct)
                    if n:
                        cell.text = new_text
                        if cell.paragraphs and cell.paragraphs[0].runs:
                            cell.paragraphs[0].runs[0].text = new_text
                        count += n
    return count


class ReplaceTextRequest(BaseModel):
    find: str
    replace: str
    case_sensitive: bool = False


@app.get("/api/docs/{doc_id}/theme-colors")
def get_theme_colors(doc_id: str):
    """Return the presentation's theme color palette."""
    d = _require(doc_id)
    doc = d["doc"]
    colors = getattr(doc, "theme_colors", None) or {}
    return {"theme_colors": colors}


@app.get("/api/docs/{doc_id}/search-text")
def search_text(doc_id: str, q: str):
    """Search all slides for text matching q. Returns list of matches with slide/element context."""
    d = _require(doc_id)
    if not q.strip():
        return []
    matches = []
    cmp = q.lower()
    for slide in d["doc"].slides:
        for i, el in enumerate(slide.elements):
            plain = _element_plain_text(el)
            if cmp in plain.lower():
                matches.append({
                    "slide_n":    slide.slide_number,
                    "element_id": _element_id(el, i),
                    "element_type": getattr(el, "element_type", ""),
                    "preview":    plain[:120],
                })
    return matches


@app.get("/api/docs/{doc_id}/stats")
def get_doc_stats(doc_id: str):
    """Return presentation-level statistics: slide count, element counts, word count."""
    d = _require(doc_id)
    doc = d["doc"]
    type_counts: dict[str, int] = {}
    word_count = 0
    for slide in doc.slides:
        for el in slide.elements:
            et = getattr(el, "element_type", "Unknown")
            type_counts[et] = type_counts.get(et, 0) + 1
            plain = _element_plain_text(el)
            if plain.strip():
                word_count += len(plain.split())
    return {
        "slide_count":  len(doc.slides),
        "total_elements": sum(type_counts.values()),
        "type_counts":  type_counts,
        "word_count":   word_count,
    }


@app.get("/api/docs/{doc_id}/search-elements")
def search_elements(doc_id: str, q: str = ""):
    """Search all elements by name or text content. Returns up to 60 matches."""
    d = _require(doc_id)
    cmp = q.strip().lower()
    results = []
    for slide in d["doc"].slides:
        for i, el in enumerate(slide.elements):
            name = getattr(getattr(el, "identification", None), "shape_name", None) or ""
            label = getattr(getattr(el, "accessibility", None), "alt_text", None) or name
            plain = _element_plain_text(el)
            if not cmp or cmp in name.lower() or cmp in plain.lower():
                results.append({
                    "slide_n":      slide.slide_number,
                    "element_id":   _element_id(el, i),
                    "element_type": getattr(el, "element_type", ""),
                    "name":         name,
                    "label":        label,
                    "preview":      plain[:80],
                })
            if len(results) >= 60:
                break
        if len(results) >= 60:
            break
    return results


@app.post("/api/docs/{doc_id}/replace-text")
def replace_text(doc_id: str, req: ReplaceTextRequest):
    """Replace all occurrences of req.find with req.replace across all slides."""
    if not req.find:
        raise HTTPException(400, "find text cannot be empty")
    d = _require(doc_id)
    _snapshot_doc(doc_id)
    total = 0
    affected_slides: list[int] = []
    for slide in d["doc"].slides:
        slide_count = 0
        for el in slide.elements:
            slide_count += _replace_in_element(el, req.find, req.replace, req.case_sensitive)
        if slide_count:
            affected_slides.append(slide.slide_number)
            total += slide_count
    log.info("replace-text: '%s'→'%s' in doc %s: %d replacements on slides %s",
             req.find, req.replace, doc_id, total, affected_slides)
    return {"replaced": total, "affected_slides": affected_slides}


# ── Element style helpers ─────────────────────────────────────────────────────

def _ser_style(el: Any) -> dict:
    """Serialize current style properties of a Bridge element."""
    fill_color = None
    fill_type  = "none"
    line_color = None
    line_width = None
    line_dash  = None
    opacity    = None
    shadow     = {}

    el_type = getattr(el, "element_type", "")

    # fill
    fill = getattr(el, "fill", None)
    if fill:
        fill_type = getattr(fill, "fill_type", "none") or "none"
        if fill_type == "solid":
            fg = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
            fill_color = _color_to_str(fg)

    # line — ShapeLine uses .color/.width/.dash_style; FreeformLine uses .line_color/.line_width/.line_dash
    line = getattr(el, "line", None)
    if line:
        lc = getattr(line, "color", None) or getattr(line, "line_color", None)
        line_color = _color_to_str(lc)
        line_width = getattr(line, "width", None) or getattr(line, "line_width", None)
        line_dash  = getattr(line, "dash_style", None) or getattr(line, "line_dash", None)

    # opacity — stored as fill.transparency (0.0 = fully opaque, 1.0 = fully transparent)
    # We expose it as 0.0–1.0 opacity (inverse of transparency)
    fill_transp = getattr(fill, "transparency", None) if fill else None
    opacity = (1.0 - float(fill_transp)) if fill_transp is not None else 1.0

    # shadow (common for shapes, images) — ShapeShadow has has_shadow, blur, distance, direction
    sf = getattr(el, "shadow", None)
    if sf:
        shadow = {
            "on":       getattr(sf, "has_shadow", False),
            "color":    _color_to_str(getattr(sf, "color", None)),
            "blur":     getattr(sf, "blur", None),
            "offset_x": getattr(sf, "distance", None),   # distance as proxy for offset
            "offset_y": getattr(sf, "direction", None),  # direction (degrees)
        }

    # image crop — BridgeImage.cropping is ImageCropping with crop_left etc.
    crop_left = crop_right = crop_top = crop_bottom = None
    if el_type == "BridgeImage":
        crop_obj = getattr(el, "cropping", None)
        if crop_obj:
            crop_left   = getattr(crop_obj, "crop_left",   0.0)
            crop_right  = getattr(crop_obj, "crop_right",  0.0)
            crop_top    = getattr(crop_obj, "crop_top",    0.0)
            crop_bottom = getattr(crop_obj, "crop_bottom", 0.0)

    shadow_on = shadow_color = shadow_blur = shadow_offset_x = shadow_offset_y = None
    if shadow:
        shadow_on       = shadow.get("on", False)
        shadow_color    = shadow.get("color")
        shadow_blur     = shadow.get("blur")
        shadow_offset_x = shadow.get("offset_x")
        shadow_offset_y = shadow.get("offset_y")

    return {
        "fill_type":        fill_type,
        "fill_color":       fill_color,
        "line_color":       line_color,
        "line_width":       line_width,
        "line_dash":        line_dash,
        "opacity":          opacity,
        "shadow_on":        shadow_on,
        "shadow_color":     shadow_color,
        "shadow_blur":      shadow_blur,
        "shadow_offset_x":  shadow_offset_x,
        "shadow_offset_y":  shadow_offset_y,
        "crop_left":        crop_left,
        "crop_right":       crop_right,
        "crop_top":         crop_top,
        "crop_bottom":      crop_bottom,
    }


def _apply_style(el: Any, req: ElementStyleUpdate) -> None:
    """Apply an ElementStyleUpdate to a Bridge element in-place."""
    from percy.bridge.elements import ColorSpec

    # fill — ShapeFill uses .color; FreeformFill uses .fill_color
    if req.fill_color is not None or req.fill_type is not None:
        fill = getattr(el, "fill", None)
        if fill is not None:
            if req.fill_type == "none":
                fill.fill_type = "none"
            elif req.fill_color is not None:
                fill.fill_type = "solid"
                cs = ColorSpec(value=req.fill_color) if req.fill_color != "none" else None
                if hasattr(fill, "color"):      fill.color      = cs
                if hasattr(fill, "fill_color"): fill.fill_color = cs

    # line — handle both ShapeLine (.color/.width/.dash_style) and FreeformLine (.line_color/.line_width/.line_dash)
    if req.line_color is not None or req.line_width is not None or req.line_dash is not None:
        line = getattr(el, "line", None)
        if line is not None:
            cs = ColorSpec(value=req.line_color) if (req.line_color and req.line_color != "none") else None
            if req.line_color is not None:
                if hasattr(line, "color"):      line.color      = cs
                if hasattr(line, "line_color"): line.line_color = cs
            if req.line_width is not None:
                if hasattr(line, "width"):      line.width      = req.line_width
                if hasattr(line, "line_width"): line.line_width = req.line_width
            if req.line_dash is not None:
                if hasattr(line, "dash_style"): line.dash_style = req.line_dash
                if hasattr(line, "line_dash"):  line.line_dash  = req.line_dash

    # opacity → fill.transparency (inverted: opacity 1.0 = transparency 0.0)
    if req.opacity is not None:
        fill_obj = getattr(el, "fill", None)
        if fill_obj is not None and hasattr(fill_obj, "transparency"):
            fill_obj.transparency = max(0.0, min(1.0, 1.0 - req.opacity))

    # shadow — ShapeShadow fields: has_shadow, blur, distance, direction, color
    sf = getattr(el, "shadow", None)
    if sf is not None:
        if req.shadow_on    is not None: sf.has_shadow = req.shadow_on
        if req.shadow_color is not None: sf.color      = ColorSpec(value=req.shadow_color)
        if req.shadow_blur  is not None: sf.blur       = req.shadow_blur
        if req.shadow_offset_x is not None: sf.distance  = req.shadow_offset_x
        if req.shadow_offset_y is not None: sf.direction = req.shadow_offset_y

    # image crop — BridgeImage.cropping is ImageCropping
    if getattr(el, "element_type", "") == "BridgeImage":
        crop = getattr(el, "cropping", None)
        if crop is not None:
            if req.crop_left   is not None: crop.crop_left   = max(0.0, min(0.99, req.crop_left))
            if req.crop_right  is not None: crop.crop_right  = max(0.0, min(0.99, req.crop_right))
            if req.crop_top    is not None: crop.crop_top    = max(0.0, min(0.99, req.crop_top))
            if req.crop_bottom is not None: crop.crop_bottom = max(0.0, min(0.99, req.crop_bottom))


@app.get("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/style")
def get_element_style(doc_id: str, n: int, element_id: str):
    """Return current style properties of a Bridge element."""
    el = _find_element(doc_id, n, element_id)
    return _ser_style(el)


@app.patch("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/style")
def update_element_style(doc_id: str, n: int, element_id: str, req: ElementStyleUpdate):
    """Patch fill, line, opacity, shadow, or crop on a Bridge element."""
    _snapshot_doc(doc_id)
    el = _find_element(doc_id, n, element_id)
    _apply_style(el, req)
    log.info("studio: updated style on %s slide %d of %s", element_id, n, doc_id)
    return _ser_style(el)


@app.get("/api/docs/{doc_id}/slides/{n}/elements/{element_id}/element-png")
def render_element_png(doc_id: str, n: int, element_id: str, v: int = 0):
    """Render a single Bridge element to a transparent PNG for the Studio canvas."""
    from percy.diagnostics.render_png import _register_embedded_fonts  # type: ignore[attr-defined]
    import io as _io

    d   = _require(doc_id)
    doc = d["doc"]
    slide = next((s for s in doc.slides if s.slide_number == n), None)
    if slide is None:
        raise HTTPException(404, f"Slide {n} not found in doc {doc_id!r}")

    el_index = None
    el       = None
    for i, e in enumerate(slide.elements):
        if _element_id(e, i) == element_id:
            el, el_index = e, i
            break
    if el is None:
        raise HTTPException(404, f"Element {element_id!r} not found on slide {n}")

    theme          = getattr(doc, "theme_colors", None) or None
    embedded_fonts = getattr(doc, "embedded_fonts", None)
    if embedded_fonts:
        _register_embedded_fonts(embedded_fonts)

    renderer = SlideRenderer(theme=theme)
    renderer.set_document(doc)
    # propagate slide default text color so text-heavy shapes render correctly
    renderer._default_text_color = getattr(slide, "default_text_color", None)

    try:
        fig = renderer.render_element(el, padding=0)
        buf = _io.BytesIO()
        # save at exact figsize (no tight-crop) so the PNG proportions match
        # the element's bounding box; transparent so it composites over white canvas
        fig.savefig(buf, format="png", dpi=96, transparent=True)
        fig.clf()
        buf.seek(0)
    except Exception as exc:
        import traceback
        raise HTTPException(500, detail=f"Element render failed: {exc}\n{traceback.format_exc()}")

    return Response(
        content=buf.read(),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    slide_n: int
    element_id: str | None = None
    messages: list[ChatMessage]

def _build_slide_context(doc_id: str, slide_n: int, element_id: str | None) -> str:
    """Build a text summary of the current slide + element to inject into the system prompt."""
    try:
        d = _require(doc_id)
        doc = d["doc"]
        slide = doc.slides[slide_n - 1]
        sw, sh = _get_slide_dims(doc, slide)
        lines: list[str] = [
            f"Presentation: {doc.name}",
            f"Slide {slide_n} of {len(doc.slides)} ({sw:.2f}\" × {sh:.2f}\")",
            f"Elements on this slide ({len(slide.elements)}):",
        ]
        for el in slide.elements:
            p = el.position
            tag = f"  [{el.__class__.__name__}] '{el.name}' id={el.shape_id}"
            tag += f" pos=({p.left_in:.2f}\",{p.top_in:.2f}\") size={p.width_in:.2f}\"×{p.height_in:.2f}\""
            if element_id and str(el.shape_id) == element_id:
                tag += "  ← SELECTED"
            lines.append(tag)
        if element_id:
            try:
                el = _find_element(doc_id, slide_n, element_id)
                st = _ser_style(el)
                lines.append(f"\nSelected element style: {st}")
            except Exception:
                pass
        return "\n".join(lines)
    except Exception as exc:
        return f"(context unavailable: {exc})"


_STUDIO_TOOLS = [
    {
        "name": "move_element",
        "description": "Move or resize the selected element by updating its position and/or size.",
        "input_schema": {
            "type": "object",
            "properties": {
                "left_in":   {"type": "number", "description": "New left position in inches"},
                "top_in":    {"type": "number", "description": "New top position in inches"},
                "width_in":  {"type": "number", "description": "New width in inches"},
                "height_in": {"type": "number", "description": "New height in inches"},
                "rotation":  {"type": "number", "description": "Rotation angle in degrees"},
            },
        },
    },
    {
        "name": "style_element",
        "description": "Change visual style of the selected element: fill color, opacity, border, shadow.",
        "input_schema": {
            "type": "object",
            "properties": {
                "fill_color":  {"type": "string", "description": "Fill color as '#RRGGBB' hex"},
                "fill_type":   {"type": "string", "description": "Fill type: 'solid' or 'none'"},
                "opacity":     {"type": "number", "description": "Opacity 0.0 (transparent) to 1.0 (opaque)"},
                "line_color":  {"type": "string", "description": "Border color as '#RRGGBB' hex"},
                "line_width":  {"type": "number", "description": "Border width in points"},
                "shadow_on":   {"type": "boolean", "description": "Enable or disable drop shadow"},
            },
        },
    },
    {
        "name": "update_text",
        "description": (
            "Replace the plain text content of the selected text/shape element. "
            "Provide plain text; existing paragraph structure is replaced. "
            "Use for title, body, label, or any text element."
        ),
        "input_schema": {
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": {"type": "string", "description": "New text content (use \\n to separate paragraphs)"},
                "font_size":  {"type": "number", "description": "Font size in points for all runs (optional)"},
                "font_bold":  {"type": "boolean", "description": "Bold all runs (optional)"},
                "font_color": {"type": "string", "description": "Font color as '#RRGGBB' (optional)"},
            },
        },
    },
    {
        "name": "insert_shape",
        "description": "Insert a new shape element on the current slide.",
        "input_schema": {
            "type": "object",
            "properties": {
                "shape_type": {"type": "string", "description": "Geometry preset: 'rect', 'roundRect', 'ellipse', 'triangle', 'text_box'"},
                "label":      {"type": "string", "description": "Text label / name for the shape"},
                "left_in":    {"type": "number", "description": "Left position in inches (default 1.0)"},
                "top_in":     {"type": "number", "description": "Top position in inches (default 1.0)"},
                "width_in":   {"type": "number", "description": "Width in inches (default 3.0)"},
                "height_in":  {"type": "number", "description": "Height in inches (default 2.0)"},
                "fill_color": {"type": "string", "description": "Fill color '#RRGGBB' (default '#4472C4')"},
            },
        },
    },
    {
        "name": "delete_element",
        "description": "Delete the currently selected element from the slide.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "duplicate_element",
        "description": "Duplicate the currently selected element (creates an offset copy).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "set_slide_background",
        "description": "Set the background color of the current slide.",
        "input_schema": {
            "type": "object",
            "required": ["color"],
            "properties": {
                "color": {"type": "string", "description": "Background color as '#RRGGBB' hex, or 'none' to clear"},
            },
        },
    },
]


def _execute_tool_call(doc_id: str, slide_n: int, element_id: str | None,
                       tool_name: str, tool_input: dict) -> str:
    """Execute a Claude tool call and return a result string."""
    try:
        if tool_name == "move_element":
            if not element_id:
                return "Error: no element selected"
            req = ElementPositionUpdate(
                left_in=tool_input.get("left_in"),
                top_in=tool_input.get("top_in"),
                width_in=tool_input.get("width_in"),
                height_in=tool_input.get("height_in"),
                rotation=tool_input.get("rotation"),
            )
            update_element_position(doc_id, slide_n, element_id, req)
            return "Element moved/resized successfully"

        if tool_name == "style_element":
            if not element_id:
                return "Error: no element selected"
            req = ElementStyleUpdate(
                fill_color=tool_input.get("fill_color"),
                fill_type=tool_input.get("fill_type"),
                opacity=tool_input.get("opacity"),
                line_color=tool_input.get("line_color"),
                line_width=tool_input.get("line_width"),
                shadow_on=tool_input.get("shadow_on"),
            )
            el = _find_element(doc_id, slide_n, element_id)
            _snapshot_doc(doc_id)
            _apply_style(el, req)
            return "Element style updated successfully"

        if tool_name == "update_text":
            if not element_id:
                return "Error: no element selected"
            from percy.bridge.elements import TextParagraph, TextRun  # type: ignore[attr-defined]
            el = _find_element(doc_id, slide_n, element_id)
            el_type = getattr(el, "element_type", "")
            raw_text: str = tool_input.get("text", "")
            font_size  = tool_input.get("font_size")
            font_bold  = tool_input.get("font_bold")
            font_color = tool_input.get("font_color")
            # Build new paragraphs from newline-split text
            new_paras: list[Any] = []
            for line in raw_text.split("\n"):
                run = TextRun(text=line)
                if font_size  is not None: run.font_size  = font_size
                if font_bold  is not None: run.bold       = font_bold
                if font_color is not None: run.font_color = font_color
                para = TextParagraph(runs=[run])
                new_paras.append(para)
            _snapshot_doc(doc_id)
            if el_type in ("BridgeText", "BridgeFreeform"):
                el.paragraphs = new_paras
            elif el_type == "BridgeShape":
                tc = getattr(el, "text_content", None)
                if tc:
                    tc.paragraphs = new_paras
                    tc.has_text   = bool(raw_text.strip())
            else:
                return f"Element type {el_type!r} does not support text update"
            return f"Text updated to: {raw_text[:80]}"

        if tool_name == "insert_shape":
            req = NewElementRequest(
                shape_type=tool_input.get("shape_type", "rect"),
                label=tool_input.get("label", "New Shape"),
                left_in=float(tool_input.get("left_in", 1.0)),
                top_in=float(tool_input.get("top_in", 1.0)),
                width_in=float(tool_input.get("width_in", 3.0)),
                height_in=float(tool_input.get("height_in", 2.0)),
                fill_color=tool_input.get("fill_color", "#4472C4"),
            )
            result = create_element(doc_id, slide_n, req)
            return f"Shape inserted: id={result.get('id', '?')}"

        if tool_name == "delete_element":
            if not element_id:
                return "Error: no element selected"
            delete_element(doc_id, slide_n, element_id)
            return "Element deleted"

        if tool_name == "duplicate_element":
            if not element_id:
                return "Error: no element selected"
            result = duplicate_element(doc_id, slide_n, element_id)
            return f"Element duplicated: new id={result.get('id', '?')}"

        if tool_name == "set_slide_background":
            color_val = tool_input.get("color", "")
            color_arg = None if (not color_val or color_val.lower() == "none") else color_val
            set_slide_background(doc_id, slide_n, color_arg)
            return f"Slide background set to {color_arg or 'none'}"

        return f"Unknown tool: {tool_name}"
    except Exception as exc:
        return f"Tool execution error: {exc}"


@app.post("/api/docs/{doc_id}/chat")
def chat(doc_id: str, req: ChatRequest):
    """AI chat powered by Claude — context-aware about the current slide and element."""
    _require(doc_id)
    import anthropic as _anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"reply": (
            "No ANTHROPIC_API_KEY found in environment.\n\n"
            "Set ANTHROPIC_API_KEY in your shell or .env file, then restart the backend."
        ), "actions_taken": 0}

    slide_ctx = _build_slide_context(doc_id, req.slide_n, req.element_id)

    system_prompt = (
        "You are Percy, an AI assistant specialized in PowerPoint presentation design. "
        "You help users understand and edit their presentations through the Percy Studio interface.\n\n"
        "You have access to the following context about the current state of the document:\n\n"
        f"```\n{slide_ctx}\n```\n\n"
        "Available tools and when to use them:\n"
        "- move_element: reposition or resize the selected element\n"
        "- style_element: change fill color, opacity, border, shadow\n"
        "- update_text: replace text content of a text or shape element\n"
        "- insert_shape: add a new shape/text box to the current slide\n"
        "- delete_element: remove the selected element\n"
        "- duplicate_element: copy the selected element with offset\n"
        "- set_slide_background: change the slide background color\n\n"
        "Use tools proactively whenever the user requests a visual change. "
        "After using a tool, briefly confirm what you did in one sentence. "
        "Keep all responses concise — plain text only, no markdown."
    )

    client = _anthropic.Anthropic(api_key=api_key)
    claude_messages = [{"role": m.role, "content": m.content} for m in req.messages]

    actions_taken = 0
    reply = ""

    try:
        # First call — may trigger tool use
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system_prompt,
            tools=_STUDIO_TOOLS,
            messages=claude_messages,
        )

        # Process tool calls if any
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result_str = _execute_tool_call(
                    doc_id, req.slide_n, req.element_id,
                    block.name, block.input,
                )
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })
                actions_taken += 1

        if tool_results:
            # Second call after tool results
            claude_messages = claude_messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": tool_results},
            ]
            response2 = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=system_prompt,
                tools=_STUDIO_TOOLS,
                messages=claude_messages,
            )
            reply = next((b.text for b in response2.content if hasattr(b, "text")), "Done.")
        else:
            reply = next((b.text for b in response.content if hasattr(b, "text")), "")

    except Exception as exc:
        reply = f"Claude API error: {exc}"

    return {"reply": reply, "actions_taken": actions_taken}


# ── reverse proxy /api/cloud/* → Percy Cloud control-plane API ───────────────
_CLOUD_API_URL = os.environ.get("PERCY_CLOUD_API_URL", "").rstrip("/")
_CLOUD_API_KEY = os.environ.get("PERCY_API_KEY", "")

if _CLOUD_API_URL:
    import urllib.request as _urlreq

    @app.api_route("/api/cloud/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
    async def proxy_cloud(path: str, request: Request):
        target = f"{_CLOUD_API_URL}/api/cloud/{path}"
        if request.query_params:
            target += "?" + str(request.query_params)
        body = await request.body()
        headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in ("host", "content-length")}
        # inject server-side API key so the browser doesn't need to manage it
        if _CLOUD_API_KEY:
            headers["x-percy-api-key"] = _CLOUD_API_KEY
        req = _urlreq.Request(target, data=body or None, headers=headers, method=request.method)
        try:
            with _urlreq.urlopen(req, timeout=30) as resp:
                content = resp.read()
                return Response(
                    content=content,
                    status_code=resp.status,
                    media_type=resp.headers.get("Content-Type", "application/json"),
                )
        except _urlreq.HTTPError as exc:
            return Response(content=exc.read(), status_code=exc.code,
                            media_type="application/json")


# ── serve built frontend in production ────────────────────────────────────────
_FRONTEND_DIST = _ROOT / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
