"""Export routes — extracted from main.py.

Handles `/api/docs/{doc_id}/export*` routes that produce downloadable artifacts
(PPTX, PDF, PNG zip, HTML slideshow, single-slide PPTX, slide subset, speaker
script, markdown, pre-export checklist).

Register with: `register_export_router(app)` from main.py.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from PIL import Image

log = logging.getLogger("percy.api")


# ─── Shared helpers wired at registration time ──────────────────────────────
_require: Any = None
_rebuild_pptx: Any = None
_element_plain_text: Any = None
_CACHE_DIR: Path = Path("/tmp/percy/.rendercache")
_REBUILD_DIR: Path = Path("/tmp/percy/rebuilt")


def _resolve_main_helpers() -> None:
    global _require, _rebuild_pptx, _element_plain_text, _CACHE_DIR, _REBUILD_DIR
    if _require is not None:
        return
    from app.backend import main as _main
    _require = _main._require
    _rebuild_pptx = _main._rebuild_pptx
    _element_plain_text = _main._element_plain_text
    _CACHE_DIR = _main._CACHE_DIR
    _REBUILD_DIR = _main._REBUILD_DIR


def _register_routes(app: FastAPI) -> None:
    @app.get("/api/docs/{doc_id}/export")
    def export_pptx(doc_id: str):
        """Rebuild current Bridge model → stream rebuilt PPTX as a file download."""
        import traceback as _tb
        _resolve_main_helpers()

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


    @app.get("/api/docs/{doc_id}/export-pdf")
    def export_pdf(doc_id: str):
        """Stitch all rendered slide PNGs into a PDF and stream as a file download."""
        import io as _io
        _resolve_main_helpers()
        d = _require(doc_id)
        doc = d["doc"]
        bridge_dir = _CACHE_DIR / doc_id / "bridge"

        def _find_png(n: int) -> Path | None:
            for name in [f"slide-{n:03d}.png", f"slide_{n:04d}.png"]:
                p = bridge_dir / name
                if p.exists():
                    return p
            return None

        png_paths: list[Path] = []
        for slide in sorted(doc.slides, key=lambda s: s.slide_number):
            p = _find_png(slide.slide_number)
            if p:
                png_paths.append(p)

        if not png_paths:
            try:
                from percy.diagnostics.render_png import render_bridge_slides as _rbs  # type: ignore[attr-defined]
                bridge_dir.mkdir(parents=True, exist_ok=True)
                _rbs(doc, bridge_dir)
                for slide in sorted(doc.slides, key=lambda s: s.slide_number):
                    p = _find_png(slide.slide_number)
                    if p:
                        png_paths.append(p)
            except Exception as exc:
                raise HTTPException(500, f"Could not render slides: {exc}")

        if not png_paths:
            raise HTTPException(404, "No rendered slides found — open the deck in Studio first to generate thumbnails")

        try:
            images = [Image.open(str(p)).convert("RGB") for p in png_paths]
            pdf_buf = _io.BytesIO()
            images[0].save(
                pdf_buf, format="PDF", save_all=True,
                append_images=images[1:],
                resolution=150,
            )
            pdf_bytes = pdf_buf.getvalue()
        except Exception as exc:
            raise HTTPException(500, f"PDF generation failed: {exc}")

        stem = Path(d["name"]).stem
        from fastapi.responses import Response as _Response
        return _Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{stem}_percy.pdf"',
                "Cache-Control": "no-store",
            },
        )


    @app.get("/api/docs/{doc_id}/export-png-zip")
    def export_png_zip(doc_id: str):
        """Zip all rendered slide PNGs and stream as a .zip download."""
        import io as _io
        import zipfile as _zip
        _resolve_main_helpers()
        d = _require(doc_id)
        doc = d["doc"]
        bridge_dir = _CACHE_DIR / doc_id / "bridge"

        def _find_slide_png(n: int) -> Path | None:
            for name in [f"slide-{n:03d}.png", f"slide_{n:04d}.png"]:
                p = bridge_dir / name
                if p.exists():
                    return p
            return None

        png_paths: list[tuple[int, Path]] = []
        for slide in sorted(doc.slides, key=lambda s: s.slide_number):
            p = _find_slide_png(slide.slide_number)
            if p:
                png_paths.append((slide.slide_number, p))

        if not png_paths:
            try:
                from percy.diagnostics.render_png import render_bridge_slides as _rbs  # type: ignore[attr-defined]
                bridge_dir.mkdir(parents=True, exist_ok=True)
                _rbs(doc, bridge_dir)
                for slide in sorted(doc.slides, key=lambda s: s.slide_number):
                    p = _find_slide_png(slide.slide_number)
                    if p:
                        png_paths.append((slide.slide_number, p))
            except Exception as exc:
                raise HTTPException(500, f"Could not render slides: {exc}")

        if not png_paths:
            raise HTTPException(404, "No rendered slides found — open the deck in Studio first")

        stem = Path(d["name"]).stem
        buf = _io.BytesIO()
        with _zip.ZipFile(buf, "w", compression=_zip.ZIP_DEFLATED) as zf:
            for n, p in png_paths:
                zf.write(p, arcname=f"{stem}_slide{n:02d}.png")

        from fastapi.responses import Response as _Response
        return _Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{stem}_slides.zip"',
                "Cache-Control": "no-store",
            },
        )


    @app.get("/api/docs/{doc_id}/export-html")
    def export_html_slideshow(doc_id: str):
        """Export all slides as a self-contained HTML slideshow (base64-embedded PNGs)."""
        import base64 as _b64
        _resolve_main_helpers()

        d   = _require(doc_id)
        doc = d["doc"]
        bridge_dir = _CACHE_DIR / doc_id / "bridge"

        slides_data: list[tuple[int, str, str]] = []

        def _get_png_path(n: int) -> Path | None:
            for name in [f"slide-{n:03d}.png", f"slide_{n:04d}.png"]:
                p = bridge_dir / name
                if p.exists():
                    return p
            return None

        def _slide_title(slide: Any) -> str:
            for el in slide.elements:
                tf = getattr(el, "text_frame", None) or getattr(el, "body", None)
                if tf:
                    paras = getattr(tf, "paragraphs", []) or []
                    if paras:
                        txt = "".join(r.text for r in (getattr(paras[0], "runs", []) or []))
                        if txt.strip():
                            return txt.strip()[:60]
            return f"Slide {slide.slide_number}"

        for slide in sorted(doc.slides, key=lambda s: s.slide_number):
            n = slide.slide_number
            p = _get_png_path(n)
            if p and p.exists():
                b64 = _b64.b64encode(p.read_bytes()).decode("ascii")
                slides_data.append((n, _slide_title(slide), b64))

        if not slides_data:
            raise HTTPException(404, "No rendered slides found — open the deck in Studio and render first")

        stem = Path(d.get("name", "presentation")).stem

        slide_transitions_map: dict[int, str] = {}
        for slide in doc.slides:
            cp = getattr(slide, "custom_properties", None) or {}
            t = cp.get("transition", "none")
            if t and t != "none":
                slide_transitions_map[slide.slide_number] = t

        notes_map: dict[int, str] = {}
        sections_map: dict[int, str] = {}
        for slide in doc.slides:
            cp = getattr(slide, "custom_properties", None) or {}
            note = cp.get("notes_text", "").strip()
            if note:
                notes_map[slide.slide_number] = note
            sec = cp.get("section_name", "").strip()
            if sec:
                sections_map[slide.slide_number] = sec

        slides_js = ",\n".join(
            f'{{n:{n}, title:{json.dumps(t)}, src:"data:image/png;base64,{b64}", transition:{json.dumps(slide_transitions_map.get(n, "fade"))}, notes:{json.dumps(notes_map.get(n, ""))}, section:{json.dumps(sections_map.get(n, ""))}}}'
            for n, t, b64 in slides_data
        )

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{stem}</title>
<style>
  *{{ box-sizing:border-box; margin:0; padding:0 }}
  body{{ background:#111; color:#eee; font-family:system-ui,sans-serif; height:100vh; overflow:hidden }}
  #stage{{ width:100vw; height:100vh; display:flex; align-items:center; justify-content:center; position:relative }}
  #slide-img{{ max-width:100%; max-height:100%; object-fit:contain; display:block; user-select:none;
               transition: opacity 0.18s ease, transform 0.18s ease }}
  #controls{{ position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
              display:flex; gap:8px; align-items:center; background:rgba(0,0,0,0.6);
              padding:6px 12px; border-radius:999px; backdrop-filter:blur(4px) }}
  button{{ background:rgba(255,255,255,0.1); border:none; color:#eee; padding:4px 12px;
           border-radius:4px; cursor:pointer; font-size:13px }}
  button:hover{{ background:rgba(255,255,255,0.2) }}
  button:disabled{{ opacity:0.3; cursor:default }}
  #counter{{ font-size:12px; font-variant-numeric:tabular-nums; min-width:60px; text-align:center }}
  #title{{ position:fixed; top:12px; left:50%; transform:translateX(-50%);
           font-size:13px; color:rgba(255,255,255,0.5); max-width:60vw; truncate:ellipsis;
           white-space:nowrap; overflow:hidden; text-overflow:ellipsis }}
  #dots{{ display:flex; gap:5px; align-items:center }}
  .dot{{ width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,0.25); cursor:pointer; transition:background .15s }}
  .dot.active{{ background:#fff }}
  #section-badge{{ position:fixed; top:12px; right:16px; font-size:11px; font-weight:600;
    letter-spacing:.06em; text-transform:uppercase; color:rgba(167,139,250,0.85);
    background:rgba(0,0,0,0.5); padding:3px 8px; border-radius:999px;
    backdrop-filter:blur(4px); display:none }}
  #notes-panel{{ position:fixed; bottom:64px; left:50%; transform:translateX(-50%);
    width:min(680px,90vw); max-height:35vh; overflow-y:auto;
    background:rgba(15,15,25,0.92); border:1px solid rgba(255,255,255,0.12);
    border-radius:10px; padding:14px 18px; font-size:14px; line-height:1.6;
    color:#d1d5db; backdrop-filter:blur(8px); display:none; white-space:pre-wrap }}
  #notes-btn{{ font-size:11px; padding:3px 9px; opacity:0.7 }}
  #notes-btn.active{{ opacity:1; background:rgba(139,92,246,0.35) }}
</style>
</head>
<body>
<div id="stage"><img id="slide-img" alt=""></div>
<div id="title"></div>
<div id="section-badge"></div>
<div id="notes-panel"></div>
<div id="controls">
  <button id="prev" onclick="go(cur-1)">&#8249;</button>
  <div id="dots"></div>
  <span id="counter"></span>
  <button id="next" onclick="go(cur+1)">&#8250;</button>
  <button id="notes-btn" onclick="toggleNotes()" title="Toggle notes (N)">&#128203;</button>
</div>
<script>
const slides = [{slides_js}];
let cur = 0;
let notesVisible = false;
const img = document.getElementById('slide-img');
const ctr = document.getElementById('counter');
const ttl = document.getElementById('title');
const dotsEl = document.getElementById('dots');
const notesPanel = document.getElementById('notes-panel');
const notesBtn = document.getElementById('notes-btn');
const sectionBadge = document.getElementById('section-badge');

if (slides.length <= 30) {{
  slides.forEach((s,i) => {{
    const d = document.createElement('div');
    d.className = 'dot'; d.onclick = () => go(i);
    dotsEl.appendChild(d);
  }});
}}

function toggleNotes() {{
  notesVisible = !notesVisible;
  notesPanel.style.display = notesVisible && slides[cur].notes ? 'block' : 'none';
  notesBtn.classList.toggle('active', notesVisible);
}}

function updateSectionBadge(n) {{
  const sec = slides[n].section;
  if (sec) {{
    sectionBadge.textContent = '§ ' + sec;
    sectionBadge.style.display = 'block';
  }} else {{
    sectionBadge.style.display = 'none';
  }}
}}

let transitioning = false;
function go(n) {{
  const target = Math.max(0, Math.min(slides.length-1, n));
  if (target === cur || transitioning) return;
  const dir = target > cur ? 1 : -1;
  const t = slides[target].transition || 'fade';
  transitioning = true;
  if (t === 'fade') {{ img.style.opacity = '0'; }}
  else if (t === 'slide') {{ img.style.transform = `translateX(${{dir * -8}}%)`; img.style.opacity = '0'; }}
  else if (t === 'zoom') {{ img.style.transform = 'scale(0.93)'; img.style.opacity = '0'; }}
  else {{ img.style.opacity = '0'; }}
  setTimeout(() => {{
    cur = target;
    img.src = slides[cur].src;
    ctr.textContent = (cur+1) + ' / ' + slides.length;
    ttl.textContent = slides[cur].title;
    document.getElementById('prev').disabled = cur === 0;
    document.getElementById('next').disabled = cur === slides.length-1;
    document.querySelectorAll('.dot').forEach((d,i) => d.classList.toggle('active', i===cur));
    notesPanel.textContent = slides[cur].notes || '';
    if (notesVisible) {{
      notesPanel.style.display = slides[cur].notes ? 'block' : 'none';
    }}
    updateSectionBadge(cur);
    img.style.transition = 'none';
    if (t === 'slide') {{ img.style.transform = `translateX(${{dir * 8}}%)`; }}
    else {{ img.style.transform = 'none'; }}
    img.style.opacity = '0';
    requestAnimationFrame(() => {{
      requestAnimationFrame(() => {{
        img.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
        img.style.opacity = '1';
        img.style.transform = 'none';
        setTimeout(() => {{ transitioning = false; }}, 200);
      }});
    }});
  }}, 180);
}}

document.addEventListener('keydown', e => {{
  if (e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ') {{ e.preventDefault(); go(cur+1); }}
  if (e.key==='ArrowLeft'||e.key==='PageUp')  {{ e.preventDefault(); go(cur-1); }}
  if (e.key==='Home') go(0);
  if (e.key==='End')  go(slides.length-1);
  if (e.key==='n'||e.key==='N') toggleNotes();
}});

img.src = slides[0].src;
ctr.textContent = '1 / ' + slides.length;
ttl.textContent = slides[0].title;
notesPanel.textContent = slides[0].notes || '';
updateSectionBadge(0);
document.getElementById('prev').disabled = true;
if (slides.length > 1 && slides.length <= 30) {{
  document.querySelectorAll('.dot')[0].classList.add('active');
}}
document.getElementById('next').disabled = slides.length <= 1;
requestAnimationFrame(() => {{ img.style.opacity = '1'; }});
</script>
</body>
</html>"""

        from fastapi.responses import Response as _HtmlResp
        return _HtmlResp(
            content=html,
            media_type="text/html",
            headers={
                "Content-Disposition": f'attachment; filename="{stem}.html"',
                "Cache-Control": "no-store",
            },
        )


    @app.get("/api/docs/{doc_id}/slides/{n}/export-slide")
    def export_single_slide(doc_id: str, n: int):
        """Export a single slide as its own PPTX file by rebuilding only that slide."""
        import traceback as _tb
        import copy as _copy
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "pptx":
            raise HTTPException(400, "Slide export is only supported for PPTX documents")
        if n < 1 or n > len(d["doc"].slides):
            raise HTTPException(404, f"Slide {n} not found")

        _REBUILD_DIR.mkdir(parents=True, exist_ok=True)
        stem     = Path(d["name"]).stem
        out_path = _REBUILD_DIR / f"{stem}_{doc_id}_slide{n}.pptx"

        try:
            single_doc = _copy.deepcopy(d["doc"])
            target_slide = next((s for s in single_doc.slides if s.slide_number == n), None)
            if target_slide is None:
                raise HTTPException(404, f"Slide {n} not found in document")
            single_doc.slides = [target_slide]
            target_slide.slide_number = 1
            _rebuild_pptx(single_doc, out_path)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, detail=f"Slide export failed: {exc}\n{_tb.format_exc()}")

        return FileResponse(
            str(out_path),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{stem}_slide{n}.pptx",
            headers={"Cache-Control": "no-store"},
        )


    @app.get("/api/docs/{doc_id}/export-subset")
    def export_subset_slides(doc_id: str, slides: str):
        """Export a comma-separated list of slide numbers as a PPTX subset."""
        import traceback as _tb
        import copy as _copy
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "pptx":
            raise HTTPException(400, "Subset export is only supported for PPTX documents")
        try:
            slide_numbers = sorted(set(int(s.strip()) for s in slides.split(",")))
        except ValueError:
            raise HTTPException(400, "slides must be a comma-separated list of integers")

        all_ns = {s.slide_number for s in d["doc"].slides}
        missing = [n for n in slide_numbers if n not in all_ns]
        if missing:
            raise HTTPException(404, f"Slides not found: {missing}")

        _REBUILD_DIR.mkdir(parents=True, exist_ok=True)
        stem     = Path(d["name"]).stem
        slide_str = "_".join(str(n) for n in slide_numbers[:5])
        if len(slide_numbers) > 5:
            slide_str += f"_and{len(slide_numbers) - 5}more"
        out_path = _REBUILD_DIR / f"{stem}_{doc_id}_subset_{slide_str}.pptx"

        try:
            subset_doc = _copy.deepcopy(d["doc"])
            subset_doc.slides = [s for s in subset_doc.slides if s.slide_number in set(slide_numbers)]
            subset_doc.slides.sort(key=lambda s: slide_numbers.index(s.slide_number))
            for i, s in enumerate(subset_doc.slides):
                s.slide_number = i + 1
            _rebuild_pptx(subset_doc, out_path)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, detail=f"Subset export failed: {exc}\n{_tb.format_exc()}")

        return FileResponse(
            str(out_path),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{stem}_subset.pptx",
            headers={"Cache-Control": "no-store"},
        )


    @app.get("/api/docs/{doc_id}/export-script")
    def export_speaker_script(doc_id: str, wpm: int = 120):
        """Export a formatted speaker script with slide titles, notes, and reading-time estimates."""
        from fastapi.responses import PlainTextResponse
        _resolve_main_helpers()
        d = _require(doc_id)
        doc = d["doc"]
        stem = Path(d.get("name", "script")).stem
        lines: list[str] = [
            f"SPEAKER SCRIPT — {stem.upper()}",
            "=" * 60,
            f"Generated: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"Words per minute: {wpm}",
            "=" * 60,
            "",
        ]
        total_words = 0
        total_secs = 0
        for slide in sorted(doc.slides, key=lambda s: s.slide_number):
            cp = slide.custom_properties or {}
            section = cp.get("section_name", "").strip()
            notes   = cp.get("notes_text", "").strip()
            hidden  = cp.get("hidden", False)
            title = ""
            for el in slide.elements:
                ident = getattr(el, "identification", None)
                name  = (getattr(ident, "shape_name", "") or "").lower()
                plain = _element_plain_text(el).strip()
                if plain and "title" in name:
                    title = plain
                    break
            words = len(notes.split()) if notes else 0
            secs  = int(words / max(wpm, 1) * 60) if words else 0
            total_words += words
            total_secs  += secs
            header = f"SLIDE {slide.slide_number}"
            if section:
                header += f"  [§ {section}]"
            if hidden:
                header += "  [HIDDEN]"
            lines.append(header)
            if title:
                lines.append(f"  Title: {title}")
            if words:
                m, s = divmod(secs, 60)
                lines.append(f"  Est. time: {m}:{s:02d} ({words} words)")
            lines.append("-" * 40)
            if notes:
                lines.append(notes)
            else:
                lines.append("(no notes)")
            lines.append("")
        m, s = divmod(total_secs, 60)
        h = m // 60; m = m % 60
        summary = f"TOTAL: {h}h {m:02d}m {s:02d}s | {total_words} words" if h else f"TOTAL: {m:02d}m {s:02d}s | {total_words} words"
        lines.insert(4, summary)
        return PlainTextResponse(
            content="\n".join(lines),
            headers={"Content-Disposition": f'attachment; filename="{stem}_script.txt"'},
        )


    @app.get("/api/docs/{doc_id}/export-markdown")
    def export_markdown(doc_id: str):
        """Export the entire presentation as a Markdown document (titles, body text, notes)."""
        from fastapi.responses import PlainTextResponse
        _resolve_main_helpers()
        d = _require(doc_id)
        doc = d["doc"]
        lines: list[str] = [f"# {Path(d.get('name', 'Presentation')).stem}", ""]
        for slide in sorted(doc.slides, key=lambda s: s.slide_number):
            cp = slide.custom_properties or {}
            section = cp.get("section_name", "").strip()
            notes   = cp.get("notes_text", "").strip()
            hidden  = cp.get("hidden", False)
            all_texts: list[str] = []
            title_text: str | None = None
            for el in slide.elements:
                ident = getattr(el, "identification", None)
                name  = (getattr(ident, "shape_name", "") or "").lower()
                plain = _element_plain_text(el).strip()
                if not plain:
                    continue
                if "title" in name and title_text is None:
                    title_text = plain
                else:
                    all_texts.append(plain)
            if section:
                lines.append(f"---")
                lines.append(f"*Section: {section}*")
                lines.append("")
            hidden_tag = " *(hidden)*" if hidden else ""
            heading = title_text or f"Slide {slide.slide_number}"
            lines.append(f"## {slide.slide_number}. {heading}{hidden_tag}")
            lines.append("")
            for text in all_texts:
                lines.append(text)
                lines.append("")
            if notes:
                lines.append("> **Notes:**")
                for line in notes.splitlines():
                    lines.append(f"> {line}" if line.strip() else ">")
                lines.append("")
        stem = Path(d.get("name", "presentation")).stem
        content = "\n".join(lines)
        return PlainTextResponse(
            content=content,
            headers={"Content-Disposition": f'attachment; filename="{stem}.md"'},
        )


    @app.get("/api/docs/{doc_id}/export-checklist")
    async def export_checklist(doc_id: str):
        """Run a pre-export checklist: missing notes, placeholders, overflow risk, empty slides, etc."""
        _resolve_main_helpers()
        d   = _require(doc_id)
        doc = d["doc"]

        items: list[dict] = []

        no_notes = [s.slide_number for s in doc.slides if not any(
            p.text.strip() for sh in s.shapes if sh.text_frame for p in sh.text_frame.paragraphs
            if getattr(sh, "is_notes", False)
        )]
        items.append({
            "check": "Speaker notes present",
            "status": "pass" if not no_notes else "warn",
            "detail": "All slides have notes" if not no_notes else f"{len(no_notes)} slides missing notes",
        })

        placeholder_re = re.compile(r"\[.*?\]|TODO|TBD|FIXME|Lorem ipsum", re.I)
        ph_slides = set()
        for s in doc.slides:
            for sh in s.shapes:
                if sh.text_frame:
                    for para in sh.text_frame.paragraphs:
                        if placeholder_re.search(para.text):
                            ph_slides.add(s.slide_number)
        items.append({
            "check": "No placeholder text",
            "status": "pass" if not ph_slides else "fail",
            "detail": "No placeholders found" if not ph_slides else f"Slides {sorted(ph_slides)} have placeholder text",
        })

        empty = [s.slide_number for s in doc.slides if not any(
            sh.text_frame and any(p.text.strip() for p in sh.text_frame.paragraphs)
            for sh in s.shapes
        )]
        items.append({
            "check": "No empty slides",
            "status": "pass" if not empty else "warn",
            "detail": "No empty slides" if not empty else f"Slides {empty} appear empty",
        })

        titles: dict[str, list[int]] = {}
        for s in doc.slides:
            title = ""
            for sh in s.shapes:
                if sh.text_frame and sh.text_frame.paragraphs:
                    t = sh.text_frame.paragraphs[0].text.strip()
                    if t:
                        title = t
                        break
            if title:
                titles.setdefault(title, []).append(s.slide_number)
        dups = {t: ns for t, ns in titles.items() if len(ns) > 1}
        items.append({
            "check": "No duplicate titles",
            "status": "pass" if not dups else "warn",
            "detail": "All titles unique" if not dups else f"{len(dups)} duplicate title(s) found",
        })

        count = len(doc.slides)
        items.append({
            "check": "Slide count",
            "status": "pass" if 5 <= count <= 80 else "warn",
            "detail": f"{count} slides" + ("" if 5 <= count <= 80 else (" — very few slides" if count < 5 else " — very long deck")),
        })

        fails = sum(1 for i in items if i["status"] == "fail")
        warns = sum(1 for i in items if i["status"] == "warn")
        overall = "ready" if fails == 0 and warns == 0 else ("issues" if fails > 0 else "warnings")

        return {"overall": overall, "fails": fails, "warns": warns, "items": items}


def register_export_router(app: FastAPI) -> None:
    """Register all export routes onto the FastAPI app."""
    _register_routes(app)
