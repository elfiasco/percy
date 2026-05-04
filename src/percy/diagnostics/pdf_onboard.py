"""PDF → PercyDocument onboarding — Type 1 (text-based) PDFs, programmatic extraction only.

Coordinate convention:
  PyMuPDF uses points (pt) with a top-left origin, y increasing downward.
  All BridgeElement positions are stored in inches: pt / 72.0.
  Colors are stored as "#RRGGBB" hex strings.

What is extracted:
  BridgeText       — text blocks; whitespace-only blocks are dropped
  BridgeShape      — simple rectangles (single "re" path item)
  BridgeFreeform   — multi-segment / curved vector paths with full path commands
  BridgeConnector  — single line segments
  BridgeImage      — embedded raster images
  BridgeTable      — grids detected two ways:
                       1. rect-grid: cells are filled/stroked rectangles
                       2. line-grid: cells implied by crossing h/v rule lines
                     Text is assigned per INDIVIDUAL LINE (not per block) so a
                     paragraph spanning two cells distributes correctly.

Font bold/italic: determined first by font name (most reliable), then by the
span flag bit as a fallback.

Charts are NOT detected — PDF charts are arbitrary vector art without semantic
markup.  Their paths fall through as BridgeShape / BridgeFreeform elements.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import fitz  # PyMuPDF

from percy.bridge import (
    BridgeConnector,
    BridgeFont,
    BridgeFreeform,
    BridgeImage,
    BridgeShape,
    BridgeSlide,
    BridgeTable,
    BridgeText,
    CellAlignment,
    CellFormat,
    CellMerge,
    ConnectorEndpoints,
    FillAndBorder,
    FreeformFill,
    FreeformLine,
    FreeformPath,
    Identification,
    ImageData,
    ImageDimensions,
    ImageFileInfo,
    Margins,
    PathCommand,
    PercyDocument,
    Position,
    PresentationMetadata,
    ShapeFill,
    ShapeIdentification,
    ShapeInfo,
    ShapeLine,
    ShapeTextContent,
    ShapeTextFrame,
    Stacking,
    TableDefaults,
    TableDimensions,
    TableProperties,
    TextFrame,
    TextParagraph,
    TextRun,
    TransformEmus,
)

# ── constants ─────────────────────────────────────────────────────────────────

_PT_PER_INCH = 72.0

# coordinate snap tolerance (pt): two coords within this are treated as equal
_SNAP_TOL = 2.0
# rect shorter dimension below which the shape is a hairline rule
_LINE_DIM = 3.0
# spatial proximity (pt) for grouping cell candidates before grid test
_GROUP_PROX = 12.0
# minimum fraction of (rows × cols) positions that must be occupied
_MIN_GRID_FILL = 0.65
_MIN_TABLE_ROWS = 2
_MIN_TABLE_COLS = 2
# cell candidates with area below this (pt²) are excluded from table detection
_MIN_CELL_AREA = 9.0
# minimum h-lines AND v-lines required to trigger line-grid detection
_MIN_TABLE_LINES = 2
# fraction of a block's non-empty lines that must land in cells to consume it
_BLOCK_CONSUME_THRESHOLD = 0.8
# path coordinate scale: pt × _PATH_SCALE → stored integer path unit
_PATH_SCALE = 100
# minimum area (pt²) for a drawing to be treated as a background/gradient region
_MIN_GRADIENT_AREA = 1000.0
# z-index base offsets so drawings sit behind text
_Z_DRAWING_BASE = 2
_Z_TEXT_BASE    = 10000
# horizontal gap (pt) between spans that signals a multi-column text line
_COLUMN_GAP_PT = 24.0

# Font name substrings that definitively indicate bold or not-bold.
# Checked before falling back to the span flag bit.
_BOLD_NAME_TOKENS = [
    "-bold", ",bold", "boldmt", "bolditalic", "boldoblique",
    "extrabold", "semibold", "demibold", "demi-", "-black",
    ",black", "heavymt", "-heavy", "black-",
]
_NON_BOLD_NAME_TOKENS = [
    "-regular", ",regular", "regularmt",
    "-light", ",light", "light-", "lightmt",
    "-thin", ",thin", "thin-",
    "-book", ",book",
    "-roman", "roman-",
    "-normal", "normal-",
]
_ITALIC_NAME_TOKENS = ["italic", "oblique", "slanted"]


# ── ToUnicode CMap injection for Type1 ligature fonts ─────────────────────────

def _inject_tounicode_cmaps(doc: "fitz.Document") -> None:
    """Patch Type1 fonts that have compound glyph names in /Differences but no /ToUnicode.

    PyMuPDF decodes unknown compound glyph names (e.g. 't_i') by taking only the
    first component, so ligatures like 'ti', 'ft', 'tt' lose their second character.
    Injecting a proper ToUnicode CMap makes PyMuPDF use the correct multi-char mapping.
    """
    import re as _re
    try:
        from fontTools.agl import toUnicode as _agl_to_unicode
    except ImportError:
        return

    for xref in range(1, doc.xref_length()):
        try:
            obj = doc.xref_object(xref, compressed=False)
        except Exception:
            continue
        if "/Subtype /Type1" not in obj or "/ToUnicode" in obj:
            continue
        enc_m = _re.search(r"/Encoding\s+(\d+)\s+\d+\s+R", obj)
        if not enc_m:
            continue
        enc_xref = int(enc_m.group(1))
        try:
            enc_obj = doc.xref_object(enc_xref, compressed=False)
        except Exception:
            continue
        if "/Differences" not in enc_obj:
            continue
        diff_m = _re.search(r"/Differences\s*\[([^\]]+)\]", enc_obj, _re.DOTALL)
        if not diff_m:
            continue
        items = diff_m.group(1).split()
        code: int | None = None
        mappings: list[tuple[int, str]] = []
        for item in items:
            if _re.match(r"^-?\d+$", item):
                code = int(item)
            elif item.startswith("/") and code is not None:
                gname = item[1:]
                try:
                    ustr = _agl_to_unicode(gname)
                    if ustr:
                        mappings.append((code, ustr))
                except Exception:
                    pass
                code += 1
        if not mappings:
            continue
        lines = [
            "/CIDInit /ProcSet findresource begin",
            "12 dict begin",
            "begincmap",
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
            "/CMapName /Custom-UCS def",
            "/CMapType 2 def",
            f"{len(mappings)} beginbfchar",
        ]
        for char_code, ustr in mappings:
            hex_in = f"<{char_code:02X}>"
            hex_out = "".join(f"{ord(c):04X}" for c in ustr)
            lines.append(f"{hex_in} <{hex_out}>")
        lines += [
            "endbfchar",
            "endcmap",
            "CMapName currentdict /CMap defineresource pop",
            "end",
            "end",
        ]
        cmap_bytes = "\n".join(lines).encode("ascii")
        try:
            new_xref = doc.get_new_xref()
            doc.update_object(new_xref, "<< >>")
            doc.update_stream(new_xref, cmap_bytes)
            doc.xref_set_key(xref, "ToUnicode", f"{new_xref} 0 R")
        except Exception:
            pass


# ── public entry point ────────────────────────────────────────────────────────

def onboard_pdf(pdf_path: str | Path) -> PercyDocument:
    """Convert a text-based PDF to a PercyDocument of BridgeSlides."""
    from percy.diagnostics.pdf_fonts import extract_and_register

    path = Path(pdf_path)
    doc = fitz.open(str(path))
    _inject_tounicode_cmaps(doc)

    first = doc[0]
    page_w_in = _pt_to_in(first.rect.width)
    page_h_in = _pt_to_in(first.rect.height)

    # Extract embedded fonts and register with matplotlib.
    # Returns BridgeFont objects keyed by PDF font name; stored in document.fonts
    # so the renderer can apply correct family/weight/style without guessing.
    try:
        bridge_fonts = extract_and_register(doc)
    except Exception:
        bridge_fonts = {}

    document = PercyDocument(
        source_path=str(path),
        metadata=PresentationMetadata(
            slide_width=page_w_in,
            slide_height=page_h_in,
            slide_count=len(doc),
            source_path=str(path),
        ),
        fonts=bridge_fonts,
        custom_properties={"source_format": "pdf"},
    )

    for page_number, page in enumerate(doc, start=1):
        document.slides.append(_onboard_page(doc, page, page_number, bridge_fonts))

    doc.close()
    return document


# ── ExtGState opacity extraction ──────────────────────────────────────────────

def _get_drawing_opacities(doc: fitz.Document, page: fitz.Page) -> dict[int, float]:
    """Return a dict mapping drawing index → effective fill opacity (0.0–1.0).

    PyMuPDF's get_drawings() does not propagate opacity set via the PDF `gs`
    operator referencing an ExtGState dictionary, especially when the path
    is inside a Form XObject invoked at low opacity.  This function parses
    the page content stream (following Form XObject `Do` invocations one
    level deep) to assign each drawing the effective fill opacity of the
    graphics state that was active when it was painted.
    Defaults to 1.0 for any drawing without an explicit override.
    """
    import re as _re
    try:
        # ── 1. Build page-level ExtGState name → fill_opacity map ────────────
        page_xref_str = doc.xref_object(page.xref, compressed=False)
        ext_state_opacities: dict[str, float] = {}
        extgs_match = _re.search(r"/ExtGState\s*<<([^>]*)>>", page_xref_str, _re.DOTALL)
        if extgs_match:
            for m in _re.finditer(r"(/\w+)\s+(\d+)\s+0\s+R", extgs_match.group(1)):
                gs_name, gs_xref = m.group(1), int(m.group(2))
                try:
                    gs_dict = doc.xref_object(gs_xref, compressed=False)
                    ca = _re.search(r"/ca\s+([\d.]+)", gs_dict)
                    if ca:
                        ext_state_opacities[gs_name] = float(ca.group(1))
                except Exception:
                    pass

        if not ext_state_opacities:
            return {}

        # ── 2. Map Form XObject name → path-op count (one level deep) ────────
        xobj_path_counts: dict[str, int] = {}
        xobj_match = _re.search(r"/XObject\s*<<([^>]*)>>", page_xref_str, _re.DOTALL)
        if xobj_match:
            _PATH_OPS2 = {"f", "F", "f*", "s", "S", "b", "B", "b*", "B*"}
            for m in _re.finditer(r"(/\w+)\s+(\d+)\s+0\s+R", xobj_match.group(1)):
                fm_name, fm_xref = m.group(1), int(m.group(2))
                try:
                    fm_stream = doc.xref_stream(fm_xref)
                    if fm_stream:
                        fm_tokens = fm_stream.decode("latin-1", errors="replace").split()
                        xobj_path_counts[fm_name] = sum(
                            1 for t in fm_tokens if t in _PATH_OPS2
                        )
                except Exception:
                    pass

        # ── 3. Walk page content stream, track opacity, follow Do ─────────────
        # Exclude "n" (end-path-without-painting, used for clip paths): PyMuPDF's
        # get_drawings() does not emit a drawing entry for clip-only paths, so
        # counting "n" would misalign our draw_idx with the drawings[] list.
        _PATH_OPS = {"f", "F", "f*", "s", "S", "b", "B", "b*", "B*"}
        raw = page.read_contents()
        tokens = raw.decode("latin-1", errors="replace").split()

        gs_stack: list[float] = [1.0]
        draw_idx = 0
        result: dict[int, float] = {}
        for i, tok in enumerate(tokens):
            if tok == "q":
                gs_stack.append(gs_stack[-1])
            elif tok == "Q":
                if len(gs_stack) > 1:
                    gs_stack.pop()
            elif tok == "gs" and i > 0:
                gs_name = tokens[i - 1]
                if gs_name in ext_state_opacities:
                    gs_stack[-1] = ext_state_opacities[gs_name]
            elif tok == "Do" and i > 0:
                # Form XObject invocation — count its path ops at current opacity.
                # The XObject name (a PDF Name starting with '/') may be fused with
                # the preceding operator token if there was no whitespace in the stream
                # (e.g. "TL/Fm0 Do" tokenises as ["TL/Fm0", "Do"]).  Extract the
                # trailing slash-prefixed fragment as the real name.
                raw_tok = tokens[i - 1]
                slash_pos = raw_tok.rfind("/")
                fm_name = raw_tok[slash_pos:] if slash_pos >= 0 else raw_tok
                n_paths = xobj_path_counts.get(fm_name, 0)
                opacity = gs_stack[-1]
                if opacity < 0.999:
                    for j in range(n_paths):
                        result[draw_idx + j] = opacity
                draw_idx += n_paths
            elif tok in _PATH_OPS:
                opacity = gs_stack[-1]
                if opacity < 0.999:
                    result[draw_idx] = opacity
                draw_idx += 1

        return result
    except Exception:
        return {}


# ── per-page processing ───────────────────────────────────────────────────────

def _onboard_page(
    doc: "fitz.Document",
    page: "fitz.Page",
    page_number: int,
    font_map: "dict | None" = None,
) -> "BridgeSlide":
    page_w_in = _pt_to_in(page.rect.width)
    page_h_in = _pt_to_in(page.rect.height)

    drawings = page.get_drawings()
    # Opacity overrides for drawings whose fill/stroke opacity is set via an
    # ExtGState /gs reference — PyMuPDF's get_drawings() doesn't propagate these.
    draw_opacities = _get_drawing_opacities(doc, page)
    text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    all_blocks: list[dict] = text_dict.get("blocks", [])
    text_blocks = [b for b in all_blocks if b.get("type") == 0]

    # Image blocks: re-query without flags to avoid PyMuPDF suppressing inline images.
    # Any explicit flag value reduces the set of returned image blocks vs the default.
    # Deduplicate by (xref, width, height, bbox) — PyMuPDF can return the same
    # Form XObject block multiple times when it's referenced more than once on a page.
    _seen_block_keys: set[tuple] = set()
    img_blocks: list[dict] = []
    for b in page.get_text("dict").get("blocks", []):
        if b.get("type") != 1:
            continue
        _bkey = (
            b.get("xref"),
            b.get("width"),
            b.get("height"),
            tuple(round(x, 1) for x in b.get("bbox", (0, 0, 0, 0))),
        )
        if _bkey not in _seen_block_keys:
            _seen_block_keys.add(_bkey)
            img_blocks.append(b)

    # Detect transparency-compositing pages: ≥2 full-page (area_frac ≥ 0.80) xref=0
    # image blocks indicate multiple SMask-composited layers we can't replicate as
    # individual rasters.  In this mode we rasterize the full page once (z=0) and
    # skip all vector drawings (they're already in the composite).  Text stays.
    _page_area_early = page.rect.width * page.rect.height
    _fullpage_xref0_count = sum(
        1 for _b in img_blocks
        if not _b.get("xref")
        and _page_area_early > 0
        and ((_b["bbox"][2] - _b["bbox"][0]) * (_b["bbox"][3] - _b["bbox"][1])) / _page_area_early >= 0.80
    )
    _use_page_raster = _fullpage_xref0_count >= 2

    elements: list[Any] = []
    _ctr = [0]

    def next_id() -> int:
        _ctr[0] += 1
        return _ctr[0]

    # Identify full-page background first so it is excluded from table cell
    # candidates — otherwise the page-covering rect gets included as a "cell",
    # pulling the table's min draw index to 0 and breaking z-order.
    bg_color, bg_draw_idx = _page_background_info(drawings, page.rect)
    bg_exclude: set[int] = {bg_draw_idx} if bg_draw_idx is not None else set()

    tables, used_draw, used_text, table_draw_positions = _detect_tables(
        drawings, text_blocks, page_number, next_id, exclude_draw=bg_exclude
    )
    if bg_draw_idx is not None:
        used_draw = used_draw | {bg_draw_idx}

    # Detect "off-page origin" stripe/texture drawings: paths whose bounding rect
    # starts far outside the page bounds.  PyMuPDF's get_drawings() loses the
    # PDF ExtGState blend mode that makes these elements subtle (typically
    # Multiply over a white background = invisible).  Rendering them as freeforms
    # produces bold full-opacity stripes that obscure content.  Skip them — the
    # slide background color already provides the correct appearance for white pages.
    _page_w = page.rect.width
    _page_h = page.rect.height
    _offpage_count = 0
    _offpage_candidates: list[int] = []
    for _i, _d in enumerate(drawings):
        if _i in used_draw:
            continue
        _r = _d.get("rect") or fitz.Rect()
        _off_left = max(0.0, -_r.x0)
        _off_top  = max(0.0, -_r.y0)
        _off_right  = max(0.0, _r.x1 - _page_w)
        _off_bottom = max(0.0, _r.y1 - _page_h)
        if (_off_left > _page_w * 0.25 or _off_top > _page_h * 0.25
                or _off_right > _page_w * 0.25 or _off_bottom > _page_h * 0.25):
            if not (_r & page.rect).is_empty:
                _offpage_candidates.append(_i)
    if len(_offpage_candidates) > 5:
        # High count → decorative texture drawn via Multiply blend mode.
        # Skip to avoid full-opacity rendering artifacts.
        used_draw = used_draw | set(_offpage_candidates)
    else:
        # Low count but individual rects that extend far beyond the page bounds
        # (>40% excess in any dimension) are text-clip fill shapes: a large colored
        # rect is clipped to glyph outlines via PDF text-clip mode.  Without the
        # clip path we'd render them as solid full-page overlays.  Skip them — the
        # text color is already captured in BridgeText elements.
        for _ci in _offpage_candidates:
            _cr = drawings[_ci].get("rect") or fitz.Rect()
            if _cr.width > 1.4 * _page_w or _cr.height > 1.4 * _page_h:
                used_draw = used_draw | {_ci}

    # Also skip drawings that extend off the right or bottom of the page and are
    # covered by a Form XObject image block.  Such drawings come from inside Form
    # XObjects (PyMuPDF flattens them to page coordinates) and are already captured
    # by the Form XObject rasterization in the primary image pass.  Rendering them
    # separately causes double-drawing artifacts where the XObject is clipped by its
    # viewport but the standalone drawing is not.
    _xobj_img_rects: list[fitz.Rect] = []
    for _ib in img_blocks:
        if not _ib.get("xref"):
            _ibb = _ib.get("bbox", (0, 0, 0, 0))
            _xr = fitz.Rect(float(_ibb[0]), float(_ibb[1]), float(_ibb[2]), float(_ibb[3]))
            if not _xr.is_empty:
                _xobj_img_rects.append(_xr)
    if _xobj_img_rects:
        for _i, _d in enumerate(drawings):
            if _i in used_draw:
                continue
            _r = _d.get("rect") or fitz.Rect()
            _off_right  = max(0.0, _r.x1 - _page_w)
            _off_bottom = max(0.0, _r.y1 - _page_h)
            if _off_right <= _page_w * 0.10 and _off_bottom <= _page_h * 0.10:
                continue  # not significantly off-page on right/bottom
            # Drawing extends off the right or bottom edge — check if its
            # page-visible area is mostly covered by a Form XObject image block.
            _r_visible = _r & page.rect
            _r_vis_area = _r_visible.get_area()
            if _r_vis_area <= 0:
                continue
            _covered = sum((_r_visible & _xr).get_area() for _xr in _xobj_img_rects)
            if _covered / _r_vis_area >= 0.70:
                used_draw = used_draw | {_i}

    # Build an ordered work list that interleaves tables and individual drawings
    # by their position in the PDF drawing stream.  A table's position is the
    # minimum index of the drawings consumed to build it — this preserves the
    # original PDF z-order even when we break groups apart.
    # Format: (stream_pos, kind, payload)  kind ∈ {"table", "drawing"}
    _ordered: list[tuple[int, str, Any]] = []
    for draw_pos, tbl in zip(table_draw_positions, tables):
        _ordered.append((draw_pos, "table", tbl))

    _seen_draw_keys: set[tuple] = set()
    for i, drawing in enumerate(drawings):
        if i in used_draw:
            continue
        _dr = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
        _draw_key = (
            drawing.get("type"),
            round(_dr.x0), round(_dr.y0), round(_dr.x1), round(_dr.y1),
            tuple(round(v, 3) for v in (drawing.get("fill") or ())) if drawing.get("fill") else (),
            tuple(round(v, 3) for v in (drawing.get("color") or ())) if drawing.get("color") else (),
        )
        if _draw_key in _seen_draw_keys:
            continue
        _seen_draw_keys.add(_draw_key)
        _ordered.append((i, "drawing", drawing))

    _ordered.sort(key=lambda x: x[0])

    draw_z = _Z_DRAWING_BASE
    for stream_pos, kind, payload in _ordered:
        if kind == "table":
            payload.stacking.z_index = draw_z
            draw_z += 1
            elements.append(payload)
        else:
            # In page-raster mode, skip all vector drawings (they're in the composite)
            if _use_page_raster:
                continue
            drawing = payload
            # Gradient/pattern fills: rasterize and always place behind everything
            if _is_gradient_fill(drawing):
                el = _rasterize_region(page, drawing, page_number, next_id())
                if el is not None:
                    el.stacking.z_index = 0
                    elements.append(el)
                continue
            # Apply ExtGState fill opacity if the content stream set one via `gs`
            draw_opacity = draw_opacities.get(stream_pos, 1.0)
            el = _drawing_to_element(drawing, page_number, next_id(), fill_opacity=draw_opacity)
            if el is not None:
                el.stacking.z_index = draw_z
                draw_z += 1
                elements.append(el)

    # Build stripped→full font name map for this page so _line_to_runs can
    # resolve PyMuPDF's stripped span['font'] names back to the full prefixed
    # names (e.g. 'WellsFargoSans-Regular' → 'BIDVWV+WellsFargoSans-Regular').
    # This ensures the renderer's font_map lookup finds the exact registered
    # subset rather than falling back to a generic family-based lookup.
    import re as _re
    _SUBSET_RE = _re.compile(r"^[A-Z]{6}\+")
    # For each stripped name, collect all candidate full names and pick the one
    # whose registered font file is largest (most glyph data).  Multiple subsets
    # of the same font family can coexist on a page; the largest has most chars.
    _stripped_candidates: dict[str, list[str]] = {}
    for _fi in doc.get_page_fonts(page_number - 1, full=True):
        _full = _fi[3] or _fi[4] or ""
        if _full:
            _stripped = _SUBSET_RE.sub("", _full)
            _stripped_candidates.setdefault(_stripped, []).append(_full)

    stripped_to_full: dict[str, str] = {}
    for _stripped, _candidates in _stripped_candidates.items():
        if len(_candidates) == 1 or font_map is None:
            stripped_to_full[_stripped] = _candidates[0]
        else:
            # Pick candidate with most non-empty glyphs (best subset coverage)
            best, best_score = _candidates[0], -1
            for _cand in _candidates:
                bf = font_map.get(_cand)
                score = bf.nonempty_glyph_count if bf else 0
                if score > best_score:
                    best, best_score = _cand, score
            stripped_to_full[_stripped] = best

    # Mark text blocks that fall inside Form XObject image blocks (xref=None) as
    # "used" so they are not rendered as BridgeText elements.  Form XObjects get
    # rasterized in the primary image pass, so their text content is already captured
    # visually — adding BridgeText for the same spans would double-render the text.
    _xobj_rects: list[fitz.Rect] = []
    for _ib in img_blocks:
        if not _ib.get("xref"):
            _ibb = _ib.get("bbox", (0, 0, 0, 0))
            _xobj_rects.append(fitz.Rect(float(_ibb[0]), float(_ibb[1]), float(_ibb[2]), float(_ibb[3])))
    if _xobj_rects:
        for _ti, _tb in enumerate(text_blocks):
            if _ti in used_text:
                continue
            _tbb = _tb.get("bbox")
            if not _tbb:
                continue
            _tr = fitz.Rect(float(_tbb[0]), float(_tbb[1]), float(_tbb[2]), float(_tbb[3]))
            _tr_area = _tr.get_area()
            if _tr_area <= 0:
                continue
            # If this text block overlaps ≥20% with any Form XObject bbox, skip it.
            # Threshold is intentionally low: multi-line text blocks can span two
            # adjacent XObjects, so neither single XObject covers the full block.
            for _xr in _xobj_rects:
                _inter = (_tr & _xr).get_area()
                if _inter / _tr_area >= 0.20:
                    used_text = used_text | {_ti}
                    break

    text_z = _Z_TEXT_BASE
    for i, block in enumerate(text_blocks):
        if i in used_text:
            continue
        for el in _text_block_to_elements(block, page_number, next_id, stripped_to_full):
            el.stacking.z_index = text_z
            text_z += 1
            elements.append(el)

    page_area = page.rect.width * page.rect.height

    # Build smask_map and secondary_sizes from page.get_images(full=True).
    # smask_map: xref → smask_xref (for applying transparency).
    # secondary_sizes: (w, h) pixel dimensions of all real images the secondary pass
    #   will extract — blocks whose dimensions match these will be skipped in the
    #   primary pass to avoid rasterizing page content (which bakes in text) when a
    #   proper transparent copy is available from the secondary pass.
    smask_map: dict[int, int] = {}
    secondary_sizes: set[tuple[int, int]] = set()
    try:
        for _ii in page.get_images(full=True):
            _xref_ii, _smask_ii, _w_ii, _h_ii = _ii[0], _ii[1], _ii[2], _ii[3]
            if _smask_ii > 0:
                smask_map[_xref_ii] = _smask_ii
            secondary_sizes.add((_w_ii, _h_ii))
    except Exception:
        pass

    # Build a size → [block_bboxes] map for secondary-pass render_rect clamping.
    # When get_text("dict") returns image blocks with xref=None (Form XObjects),
    # their bbox is the CLIPPED (visible) area.  get_image_rects() returns the full
    # unclipped transform rect, which is often much larger.  We use this map to
    # detect and correct oversized secondary-pass rects.
    _size_to_block_bboxes: dict[tuple[int, int], list[fitz.Rect]] = {}
    # Sizes whose blocks are inverted (y0>y1) or entirely off-page — structural PDF
    # evidence that the image was placed with a y-flip transform and has zero visible
    # area within the page MediaBox.  Used to skip matching secondary-pass images
    # without relying on arbitrary area-fraction thresholds.
    _offpage_block_sizes: set[tuple[int, int]] = set()
    for _b in img_blocks:
        _bw, _bh = _b.get("width"), _b.get("height")
        if _bw and _bh:
            _bkey = (int(_bw), int(_bh))
            _bbox = _b.get("bbox", (0.0, 0.0, 0.0, 0.0))
            _br = fitz.Rect(float(_bbox[0]), float(_bbox[1]), float(_bbox[2]), float(_bbox[3]))
            # Only include blocks that are valid and intersect the page
            if not _br.is_empty and not (_br & page.rect).is_empty:
                _size_to_block_bboxes.setdefault(_bkey, []).append(_br)
            else:
                # Inverted bbox (y0>y1) or off-page placement — the PDF told us this
                # image's visible area within the MediaBox is empty.
                _offpage_block_sizes.add(_bkey)

    if _use_page_raster:
        # Rasterize full page once — covers all transparency-composited image layers
        try:
            _full_pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
            _full_bytes = _full_pix.tobytes("png")
            _page_img_el = BridgeImage(
                position=_bbox_to_pos((0.0, 0.0, page.rect.width, page.rect.height)),
                identification=Identification(
                    slide_number=page_number,
                    shape_name=f"PageRaster_{next_id()}",
                    shape_id=next_id(),
                ),
                stacking=Stacking(z_index=0),
                image_data=ImageData(image_bytes=_full_bytes, image_format="PNG"),
                file_info=ImageFileInfo(),
                dimensions=ImageDimensions(width_px=_full_pix.width, height_px=_full_pix.height),
                custom_properties={"source_format": "pdf", "onboard_status": "page-raster"},
            )
            elements.append(_page_img_el)
        except Exception:
            pass
        # Clear img_blocks so the primary/secondary image passes are also skipped
        img_blocks = []

    extracted_xrefs: set[int] = set()  # xrefs extracted in primary pass
    primary_rects: list[fitz.Rect] = []  # bboxes of primary-pass images (pt)
    primary_rects_with_z: list[tuple[fitz.Rect, int]] = []  # (rect, z_index)
    for block in img_blocks:
        el = _image_block_to_element(doc, block, page_number, next_id(), page=page, smask_map=smask_map, secondary_sizes=secondary_sizes)
        if el is not None:
            # Full-bleed background: image covers ≥80% of page area → z=0
            bbox = block.get("bbox", (0, 0, 0, 0))
            img_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            if page_area > 0 and img_area / page_area >= 0.8:
                el.stacking.z_index = 0
            else:
                el.stacking.z_index = draw_z
                draw_z += 1
            elements.append(el)
            xref_b = block.get("xref")
            if xref_b:
                extracted_xrefs.add(xref_b)
            _pr = fitz.Rect(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
            primary_rects.append(_pr)
            primary_rects_with_z.append((_pr, el.stacking.z_index))

    # Secondary image pass: page.get_images() catches Form XObject images
    # whose blocks in get_text("dict") have xref=None.
    # Use page.get_image_rects(xref) for the accurate on-page render rect instead of
    # block-bbox matching, which is unreliable when transforms are non-trivial.
    # Skip entirely in page-raster mode — the full page composite covers all images.
    if _use_page_raster:
        page_imgs = []
    else:
        try:
            page_imgs = page.get_images(full=True)
        except Exception:
            page_imgs = []
    extracted_render_rects: set[tuple] = set()  # (x0,y0,x1,y1) rounded to 2pt grid
    for img_info in page_imgs:
        xref = img_info[0]
        smask_xref = img_info[1]  # 0 means no soft mask
        img_w, img_h = img_info[2], img_info[3]
        if xref in extracted_xrefs:
            continue  # already extracted via primary pass
        # Skip tiny soft-mask / color-swatch images (≤4×4 px) — not renderable content
        if img_w <= 4 or img_h <= 4:
            continue

        # Accurate on-page render rects — one per instance (same xref can appear
        # at multiple positions, e.g. a photo used in three card slots).
        try:
            render_rects = page.get_image_rects(xref, transform=False)
        except Exception:
            render_rects = []

        if not render_rects:
            # Fallback: match by pixel size in img_blocks
            matching_block = next(
                (b for b in img_blocks
                 if b.get("width") == img_w and b.get("height") == img_h),
                None,
            )
            if matching_block is None:
                continue
            bbox = matching_block.get("bbox", (0.0, 0.0, 0.0, 0.0))
            rx0, ry0, rx1, ry1 = (float(bbox[0]), float(bbox[1]),
                                   float(bbox[2]), float(bbox[3]))
            if rx1 < rx0:
                rx1 = page.rect.width
            if ry1 < ry0:
                ry1 = page.rect.height
            render_rects = [fitz.Rect(rx0, ry0, rx1, ry1)]

        try:
            info = doc.extract_image(xref)
            img_bytes = info.get("image")
            raw_ext = (info.get("ext") or "").upper()
        except Exception:
            continue
        if not img_bytes:
            continue

        # Apply soft mask if present — extract_image() returns raw RGB without it
        if smask_xref > 0:
            try:
                smask_info = doc.extract_image(smask_xref)
                smask_bytes = smask_info.get("image")
                if smask_bytes:
                    applied = _apply_smask(img_bytes, smask_bytes)
                    if applied:
                        img_bytes = applied
                        raw_ext = "PNG"
            except Exception:
                pass

        # Emit one BridgeImage per render instance so repeated-xref images
        # (e.g. a photo placed in 3 card slots) each land at the correct position.
        _block_clips = _size_to_block_bboxes.get((img_w, img_h), [])

        for render_rect in render_rects:
            # Visible on-page area for z-index classification
            visible = render_rect & page.rect
            if visible.is_empty or visible.width < 5 or visible.height < 5:
                continue

            # Skip images whose block bbox in get_text("dict") was inverted or off-page —
            # this is structural PDF evidence (a y-flip transform placing the image outside
            # the MediaBox) that the image has no visible area on this page.
            if not _block_clips and (img_w, img_h) in _offpage_block_sizes:
                continue

            # Skip images where the render_rect is mostly outside the page and we have
            # no block_bbox to guide correct placement.  get_image_rects() returns the
            # full unclipped transform rect; when >75% of that rect falls outside the
            # page MediaBox it almost always means the image belongs to another page or
            # is clipped away by the PDF's clip path — placing it would corrupt the render.
            _render_area = render_rect.width * render_rect.height
            if (not _block_clips and _render_area > 0
                    and (visible.width * visible.height) / _render_area < 0.25):
                continue

            # When get_image_rects() returns an oversized (unclipped) rect,
            # clamp to the best-matching block_bbox from get_text("dict").
            # The block bbox reflects the actual clip path; the render_rect does not.
            # Threshold ≥1.4×: conservative enough to avoid false positives while
            # catching the common Form XObject clip-path placement pattern.
            if _block_clips:
                _vis_area = visible.width * visible.height
                _best_clip: fitz.Rect | None = None
                _best_ovlp = 0.0
                for _bc in _block_clips:
                    _ov = (_bc & visible)
                    _ov_a = _ov.width * _ov.height if not _ov.is_empty else 0.0
                    if _ov_a > _best_ovlp:
                        _best_ovlp = _ov_a
                        _best_clip = _bc
                if _best_clip is not None:
                    _clip_a = _best_clip.width * _best_clip.height
                    # Only clamp when the render_rect extends outside the page.
                    # When a PDF image is placed via a transform that partially
                    # falls off-page, get_image_rects() returns the full
                    # unclipped transform rect; the block_bbox from get_text()
                    # captures the PDF clip-path extent and IS the correct
                    # placement.  When the render_rect is fully within the page,
                    # the block_bbox merely reflects where PyMuPDF rasterized
                    # the image in the primary pass — the full render_rect is
                    # the correct placement and clamping would crop it wrongly.
                    _extends_outside = (
                        render_rect.x0 < -0.5 or render_rect.y0 < -0.5 or
                        render_rect.x1 > page.rect.x1 + 0.5 or
                        render_rect.y1 > page.rect.y1 + 0.5
                    )
                    if (_clip_a > 0 and _vis_area / _clip_a >= 1.4
                            and _extends_outside):
                        render_rect = _best_clip
                        visible = render_rect & page.rect
                        if visible.is_empty or visible.width < 5 or visible.height < 5:
                            continue

            # Skip when a primary-pass image already substantially covers this
            # rect — the PDF places this image at a full-slide dimension but
            # clips it to smaller card areas; primary pass already rasterized
            # those clips correctly.
            visible_area = visible.width * visible.height
            if visible_area > 0:
                for pr in primary_rects:
                    overlap = (pr & visible)
                    if (not overlap.is_empty and
                            overlap.width * overlap.height / visible_area >= 0.50):
                        break
                else:
                    pr = None  # no primary rect covers this
                if pr is not None:
                    continue

            # Deduplicate by (xref, render position): skip only when the exact same
            # xref is placed at the same position twice (e.g. a Form XObject referenced
            # multiple times at the same coords).  Different xrefs at the same position
            # are distinct layers (e.g. background template + content overlay) and must
            # both be rendered; the second renders on top, which matches PDF content-
            # stream order for foreground-over-background compositing.
            rect_key = (xref, round(render_rect.x0 / 2) * 2, round(render_rect.y0 / 2) * 2,
                        round(render_rect.x1 / 2) * 2, round(render_rect.y1 / 2) * 2)
            if rect_key in extracted_render_rects:
                continue
            extracted_render_rects.add(rect_key)

            # Determine z-index for this secondary image.
            # Full-page coverage (≥90%) → z=0 (behind all shapes).
            # Large image that contains smaller primary images (≥3× area) → place
            # just below those primaries (acts as a background for them).
            visible_area = visible.width * visible.height
            is_full_bg = page_area > 0 and visible_area / page_area >= 0.90
            if is_full_bg:
                z_idx = 0
            else:
                contained_z_vals = []
                if visible_area > 0:
                    for _pr_rect, _pr_z in primary_rects_with_z:
                        _pr_area = _pr_rect.width * _pr_rect.height
                        if _pr_area <= 0:
                            continue
                        _ov = _pr_rect & visible
                        _ov_a = _ov.width * _ov.height if not _ov.is_empty else 0.0
                        if _ov_a / _pr_area >= 0.5 and visible_area / _pr_area >= 3.0:
                            contained_z_vals.append(_pr_z)
                if contained_z_vals:
                    z_idx = max(1, min(contained_z_vals) - 1)
                else:
                    z_idx = draw_z
                    draw_z += 1

            sid = next_id()
            img_el = BridgeImage(
                identification=Identification(
                    slide_number=page_number,
                    shape_name=f"Image_xref{xref}_{sid}",
                ),
                stacking=Stacking(z_index=z_idx),
                position=Position(
                    left=_pt_to_in(render_rect.x0),
                    top=_pt_to_in(render_rect.y0),
                    width=_pt_to_in(render_rect.width),
                    height=_pt_to_in(render_rect.height),
                ),
                image_data=ImageData(image_bytes=img_bytes, image_format=raw_ext or None),
                dimensions=ImageDimensions(width_px=img_w, height_px=img_h),
                file_info=ImageFileInfo(),
                fill_mode="stretch",
            )
            elements.append(img_el)

    # Post-processing: remove large solid-fill background shapes that are already
    # composited into a rasterized z=0 BridgeImage.  These shapes appear BEFORE
    # the image in the PDF content stream (correct layering) but our drawing pass
    # assigns them z > 0, causing them to cover the raster and hide its content.
    _raster_rects: list[tuple[float, float, float, float]] = [
        (e.position.left, e.position.top,
         e.position.left + e.position.width, e.position.top + e.position.height)
        for e in elements
        if isinstance(e, BridgeImage) and e.stacking and e.stacking.z_index == 0
    ]
    if _raster_rects:
        _filtered: list = []
        for e in elements:
            if (isinstance(e, BridgeShape)
                    and e.stacking and e.stacking.z_index > 0
                    and e.fill and e.fill.fill_type == "solid"
                    and e.fill.transparency == 0.0):
                pos = e.position
                el_area = pos.width * pos.height
                page_area_in = page_w_in * page_h_in
                if page_area_in > 0 and el_area / page_area_in >= 0.40:
                    covered = False
                    for rx0, ry0, rx1, ry1 in _raster_rects:
                        ex0, ey0 = pos.left, pos.top
                        ex1, ey1 = pos.left + pos.width, pos.top + pos.height
                        ox = max(0.0, min(rx1, ex1) - max(rx0, ex0))
                        oy = max(0.0, min(ry1, ey1) - max(ry0, ey0))
                        if el_area > 0 and ox * oy / el_area >= 0.50:
                            covered = True
                            break
                    if covered:
                        continue
            _filtered.append(e)
        elements = _filtered

    return BridgeSlide(
        slide_number=page_number,
        elements=elements,
        width=page_w_in,
        height=page_h_in,
        background_color=bg_color,
    )


# ── table detection ───────────────────────────────────────────────────────────

def _detect_tables(
    drawings: list[dict],
    text_blocks: list[dict],
    page_number: int,
    next_id: Callable[[], int],
    exclude_draw: set[int] | None = None,
) -> tuple[list[BridgeTable], set[int], set[int], list[int]]:
    """Return (tables, consumed_drawing_indices, consumed_text_block_indices, table_draw_positions).

    table_draw_positions[i] is the minimum drawing index consumed by tables[i].
    Callers use this to interleave tables with other drawings in PDF stream order,
    preserving the z-ordering that was intended in the original document.
    """
    tables: list[BridgeTable] = []
    table_draw_positions: list[int] = []
    used_draw: set[int] = set()
    used_text: set[int] = set()
    _excluded = exclude_draw or set()

    # ── rect-grid: cells are filled/stroked rectangles ────────────────────
    cell_candidates: list[tuple[int, fitz.Rect]] = [
        (i, d["rect"])
        for i, d in enumerate(drawings)
        if i not in _excluded
        and _is_simple_rect(d)
        and not _is_hairline_rect(d)
        and d["rect"].width * d["rect"].height >= _MIN_CELL_AREA
        # Exclude fully transparent rects — they are invisible click-targets,
        # not real cells, and their black/dark fill_color would paint over content.
        and (d.get("fill_opacity") is None or d.get("fill_opacity", 1.0) >= 0.05)
    ]

    for group in _spatial_groups(cell_candidates, _GROUP_PROX):
        result = _try_rect_grid(group)
        if result is None:
            continue
        cell_groups, table_rect = result
        cell_map = {(ri, ci): rect for _, rect, ri, ci in cell_groups}
        cell_paras, cell_text_map, consumed_t = _assign_lines_to_cells(
            text_blocks, cell_map
        )
        # A grid with no text in any cell is a visual element (chart, icon grid,
        # infographic card layout) — not a data table.  Leave the shapes alone so
        # they render individually with their correct fill colors.
        if not any(cell_text_map.values()):
            continue
        table = _build_table_from_rect_cells(
            cell_paras, cell_text_map, cell_groups, table_rect,
            drawings, page_number, next_id(),
        )
        cell_draw_indices = {di for di, _, _, _ in cell_groups}
        tables.append(table)
        table_draw_positions.append(min(cell_draw_indices))
        used_draw.update(cell_draw_indices)
        used_text.update(consumed_t)

    # ── line-grid: cells implied by crossing horizontal/vertical rules ────
    h_lines = [
        (i, d["rect"])
        for i, d in enumerate(drawings)
        if i not in used_draw
        and d.get("rect") is not None
        and d["rect"].height <= _LINE_DIM
        and d["rect"].width > _SNAP_TOL
    ]
    v_lines = [
        (i, d["rect"])
        for i, d in enumerate(drawings)
        if i not in used_draw
        and d.get("rect") is not None
        and d["rect"].width <= _LINE_DIM
        and d["rect"].height > _SNAP_TOL
    ]

    if len(h_lines) >= _MIN_TABLE_LINES and len(v_lines) >= _MIN_TABLE_LINES:
        for cell_defs, table_rect, h_idx, v_idx in _try_line_grids(h_lines, v_lines):
            cell_map = {(ri, ci): rect for rect, ri, ci in cell_defs}
            cell_paras, cell_text_map, consumed_t = _assign_lines_to_cells(
                text_blocks, cell_map
            )
            if not any(cell_text_map.values()):
                continue
            table = _build_table_from_line_cells(
                cell_paras, cell_text_map, cell_defs, table_rect,
                page_number, next_id(),
            )
            line_draw_indices = h_idx | v_idx
            tables.append(table)
            table_draw_positions.append(min(line_draw_indices) if line_draw_indices else 0)
            used_draw.update(line_draw_indices)
            used_text.update(consumed_t)

    return tables, used_draw, used_text, table_draw_positions


# ── text-to-cell assignment (line-level) ─────────────────────────────────────

def _assign_lines_to_cells(
    text_blocks: list[dict],
    cell_rects: dict[tuple[int, int], fitz.Rect],
) -> tuple[
    dict[tuple[int, int], list[TextParagraph]],
    dict[tuple[int, int], str],
    set[int],
]:
    """Assign individual text lines to table cells.

    A line goes to the first cell whose rect contains the line's center.
    A block is marked consumed when >= _BLOCK_CONSUME_THRESHOLD of its
    non-empty lines have been placed into cells.

    Returns:
        cell_paras    — (row, col) → list[TextParagraph]
        cell_text_map — (row, col) → plain-text string
        consumed      — block indices to suppress as standalone BridgeText
    """
    cell_paras: dict[tuple[int, int], list[TextParagraph]] = {k: [] for k in cell_rects}
    cell_text_map: dict[tuple[int, int], str] = {k: "" for k in cell_rects}

    block_nonempty: dict[int, int] = {}
    block_placed: dict[int, int] = {}

    for bi, block in enumerate(text_blocks):
        nonempty = 0
        placed = 0
        for line in block.get("lines", []):
            has_content = any(
                s.get("text", "").strip() for s in line.get("spans", [])
            )
            if not has_content:
                continue
            nonempty += 1
            line_bbox = line.get("bbox")
            if line_bbox is None:
                continue
            for key, cell_rect in cell_rects.items():
                if _bbox_center_in_rect(line_bbox, cell_rect):
                    runs = _line_to_runs(line)
                    if runs:
                        cell_paras[key].append(TextParagraph(runs=runs))
                        txt = _line_plain_text(line)
                        if txt:
                            cell_text_map[key] = (
                                cell_text_map[key] + " " + txt
                            ).strip()
                    placed += 1
                    break  # each line → at most one cell
        block_nonempty[bi] = nonempty
        block_placed[bi] = placed

    consumed: set[int] = set()
    for bi in range(len(text_blocks)):
        total = block_nonempty.get(bi, 0)
        placed = block_placed.get(bi, 0)
        if total > 0 and placed / total >= _BLOCK_CONSUME_THRESHOLD:
            consumed.add(bi)

    return cell_paras, cell_text_map, consumed


# ── rect-grid helpers ─────────────────────────────────────────────────────────

def _spatial_groups(
    indexed_rects: list[tuple[int, fitz.Rect]],
    proximity: float,
) -> list[list[tuple[int, fitz.Rect]]]:
    """Partition rects into spatially connected groups."""
    groups: list[list[tuple[int, fitz.Rect]]] = []
    used: set[int] = set()

    for i, (di, rect) in enumerate(indexed_rects):
        if i in used:
            continue
        group: list[tuple[int, fitz.Rect]] = [(di, rect)]
        used.add(i)
        changed = True
        while changed:
            changed = False
            for j, (dj, rect2) in enumerate(indexed_rects):
                if j in used:
                    continue
                if any(_rects_close(r, rect2, proximity) for _, r in group):
                    group.append((dj, rect2))
                    used.add(j)
                    changed = True
        groups.append(group)

    return groups


def _try_rect_grid(
    group: list[tuple[int, fitz.Rect]],
) -> tuple[list[tuple[int, fitz.Rect, int, int]], fitz.Rect] | None:
    """Detect a regular row/col grid from a spatially connected set of rects.

    Returns (cell_groups, bounding_rect) or None.
    cell_groups entries: (drawing_idx, rect, row_idx, col_idx)
    """
    if len(group) < _MIN_TABLE_ROWS * _MIN_TABLE_COLS:
        return None

    y0s = [float(r.y0) for _, r in group]
    x0s = [float(r.x0) for _, r in group]
    y0_map = _snap_coords(y0s, _SNAP_TOL)
    x0_map = _snap_coords(x0s, _SNAP_TOL)

    unique_rows = sorted(set(y0_map.values()))
    unique_cols = sorted(set(x0_map.values()))

    if len(unique_rows) < _MIN_TABLE_ROWS or len(unique_cols) < _MIN_TABLE_COLS:
        return None

    row_idx_map = {v: i for i, v in enumerate(unique_rows)}
    col_idx_map = {v: i for i, v in enumerate(unique_cols)}

    cell_groups: list[tuple[int, fitz.Rect, int, int]] = []
    for di, rect in group:
        rk = y0_map.get(float(rect.y0))
        ck = x0_map.get(float(rect.x0))
        if rk is None or ck is None:
            continue
        cell_groups.append((di, rect, row_idx_map[rk], col_idx_map[ck]))

    n_grid = len(unique_rows) * len(unique_cols)
    if len(cell_groups) / n_grid < _MIN_GRID_FILL:
        return None

    if not _column_widths_consistent(cell_groups):
        return None

    all_rects = [r for _, r, _, _ in cell_groups]
    bounding = fitz.Rect(
        min(r.x0 for r in all_rects),
        min(r.y0 for r in all_rects),
        max(r.x1 for r in all_rects),
        max(r.y1 for r in all_rects),
    )
    return cell_groups, bounding


def _column_widths_consistent(
    cell_groups: list[tuple[int, fitz.Rect, int, int]],
    tol: float = 5.0,
) -> bool:
    """Return False if any column contains cells with inconsistent widths."""
    n_cols = max(ci for _, _, _, ci in cell_groups) + 1
    col_widths: dict[int, list[float]] = {ci: [] for ci in range(n_cols)}
    for _, rect, _, ci in cell_groups:
        col_widths[ci].append(rect.width)
    for widths in col_widths.values():
        if len(widths) > 1 and (max(widths) - min(widths)) > tol * 2:
            return False
    return True


def _build_table_from_rect_cells(
    cell_paras: dict[tuple[int, int], list[TextParagraph]],
    cell_text_map: dict[tuple[int, int], str],
    cell_groups: list[tuple[int, fitz.Rect, int, int]],
    table_rect: fitz.Rect,
    drawings: list[dict],
    page_number: int,
    shape_id: int,
) -> BridgeTable:
    n_rows = max(r for _, _, r, _ in cell_groups) + 1
    n_cols = max(c for _, _, _, c in cell_groups) + 1

    drawing_map: dict[tuple[int, int], dict] = {
        (ri, ci): drawings[di] for di, _, ri, ci in cell_groups
    }
    col_w_acc: dict[int, list[float]] = {c: [] for c in range(n_cols)}
    row_h_acc: dict[int, list[float]] = {r: [] for r in range(n_rows)}
    for _, rect, ri, ci in cell_groups:
        col_w_acc[ci].append(rect.width)
        row_h_acc[ri].append(rect.height)
    col_widths = [_pt_to_in(_mean(col_w_acc[c])) for c in range(n_cols)]
    row_heights = [_pt_to_in(_mean(row_h_acc[r])) for r in range(n_rows)]

    data: list[list[Any]] = []
    formats: list[list[CellFormat]] = []
    for ri in range(n_rows):
        data_row: list[Any] = []
        fmt_row: list[CellFormat] = []
        for ci in range(n_cols):
            key = (ri, ci)
            plain = cell_text_map.get(key, "")
            cell_drawing = drawing_map.get(key, {})
            cell_opacity = cell_drawing.get("fill_opacity")
            if cell_opacity is None:
                cell_opacity = 1.0
            fill_hex = _rgb_to_hex(cell_drawing.get("fill")) if cell_opacity >= 0.05 else None
            data_row.append(plain or None)
            fmt_row.append(CellFormat(
                text=plain or None,
                paragraphs=cell_paras.get(key, []),
                fill_color=fill_hex,
                alignment=CellAlignment(text_alignment="left", vertical_alignment="top"),
                merge=CellMerge(),
                grid_row=ri,
                grid_col=ci,
            ))
        data.append(data_row)
        formats.append(fmt_row)

    return BridgeTable(
        position=_rect_to_pos(table_rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Table_{shape_id}",
            shape_id=shape_id,
        ),
        data=data,
        cell_formats=formats,
        dimensions=TableDimensions(column_widths=col_widths, row_heights=row_heights),
        table_properties=TableProperties(),
        defaults=TableDefaults(),
        custom_properties={
            "source_format": "pdf",
            "pdf_table_method": "rect_grid",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


# ── line-grid helpers ─────────────────────────────────────────────────────────

def _try_line_grids(
    h_lines: list[tuple[int, fitz.Rect]],
    v_lines: list[tuple[int, fitz.Rect]],
) -> list[tuple[list[tuple[fitz.Rect, int, int]], fitz.Rect, set[int], set[int]]]:
    """Find table grids implied by sets of crossing horizontal/vertical lines.

    Returns list of (cell_defs, bounding_rect, h_indices, v_indices).
    cell_defs entries: (cell_rect, row_idx, col_idx)

    Only lines that actually span the intersection range are included.
    Short decorative lines (hyperlink underlines, dividers) that don't cross
    the column or row boundaries are excluded before building the grid.
    """
    # First pass: compute the candidate x and y ranges
    h_ys = [float(r.y0) for _, r in h_lines]
    v_xs = [float(r.x0) for _, r in v_lines]
    h_map = _snap_coords(h_ys, _SNAP_TOL)
    v_map = _snap_coords(v_xs, _SNAP_TOL)

    unique_ys_all = sorted(set(h_map.values()))
    unique_xs_all = sorted(set(v_map.values()))

    if len(unique_ys_all) < _MIN_TABLE_LINES or len(unique_xs_all) < _MIN_TABLE_LINES:
        return []

    # Keep only h-lines that span at least 2 of the unique x positions.
    # A line from x=89 to x=224 does NOT cross v-lines at x=360, 444 etc.;
    # including it would extend the grid far beyond the actual table.
    if unique_xs_all:
        x_min_grid = unique_xs_all[0]
        x_max_grid = unique_xs_all[-1]
        grid_x_span = max(x_max_grid - x_min_grid, 1.0)

    valid_h: list[tuple[int, fitz.Rect]] = []
    for idx, r in h_lines:
        # Count how many unique x positions fall within this h-line's x span
        xs_crossed = sum(1 for x in unique_xs_all if r.x0 - _SNAP_TOL <= x <= r.x1 + _SNAP_TOL)
        if xs_crossed >= 2:
            valid_h.append((idx, r))

    # Keep only v-lines that span at least 2 of the unique y positions.
    if unique_ys_all:
        y_min_grid = unique_ys_all[0]
        y_max_grid = unique_ys_all[-1]

    valid_v: list[tuple[int, fitz.Rect]] = []
    for idx, r in v_lines:
        ys_crossed = sum(1 for y in unique_ys_all if r.y0 - _SNAP_TOL <= y <= r.y1 + _SNAP_TOL)
        if ys_crossed >= 2:
            valid_v.append((idx, r))

    if len(valid_h) < _MIN_TABLE_LINES or len(valid_v) < _MIN_TABLE_LINES:
        return []

    # Rebuild unique positions from the validated lines only
    h_ys2 = [float(r.y0) for _, r in valid_h]
    v_xs2 = [float(r.x0) for _, r in valid_v]
    h_map2 = _snap_coords(h_ys2, _SNAP_TOL)
    v_map2 = _snap_coords(v_xs2, _SNAP_TOL)

    unique_ys = sorted(set(h_map2.values()))
    unique_xs = sorted(set(v_map2.values()))

    if len(unique_ys) < _MIN_TABLE_LINES or len(unique_xs) < _MIN_TABLE_LINES:
        return []

    cell_defs: list[tuple[fitz.Rect, int, int]] = [
        (fitz.Rect(x0, y0, x1, y1), ri, ci)
        for ri, (y0, y1) in enumerate(zip(unique_ys, unique_ys[1:]))
        for ci, (x0, x1) in enumerate(zip(unique_xs, unique_xs[1:]))
    ]
    bounding = fitz.Rect(
        unique_xs[0], unique_ys[0], unique_xs[-1], unique_ys[-1]
    )
    return [(cell_defs, bounding, {i for i, _ in valid_h}, {i for i, _ in valid_v})]


def _build_table_from_line_cells(
    cell_paras: dict[tuple[int, int], list[TextParagraph]],
    cell_text_map: dict[tuple[int, int], str],
    cell_defs: list[tuple[fitz.Rect, int, int]],
    table_rect: fitz.Rect,
    page_number: int,
    shape_id: int,
) -> BridgeTable:
    if not cell_defs:
        return BridgeTable(
            identification=Identification(slide_number=page_number, shape_id=shape_id),
        )

    n_rows = max(ri for _, ri, _ in cell_defs) + 1
    n_cols = max(ci for _, _, ci in cell_defs) + 1

    col_w_acc: dict[int, list[float]] = {c: [] for c in range(n_cols)}
    row_h_acc: dict[int, list[float]] = {r: [] for r in range(n_rows)}
    for cell_rect, ri, ci in cell_defs:
        col_w_acc[ci].append(cell_rect.width)
        row_h_acc[ri].append(cell_rect.height)
    col_widths = [_pt_to_in(_mean(col_w_acc[c])) for c in range(n_cols)]
    row_heights = [_pt_to_in(_mean(row_h_acc[r])) for r in range(n_rows)]

    data: list[list[Any]] = []
    formats: list[list[CellFormat]] = []
    for ri in range(n_rows):
        data_row: list[Any] = []
        fmt_row: list[CellFormat] = []
        for ci in range(n_cols):
            key = (ri, ci)
            plain = cell_text_map.get(key, "")
            data_row.append(plain or None)
            fmt_row.append(CellFormat(
                text=plain or None,
                paragraphs=cell_paras.get(key, []),
                alignment=CellAlignment(text_alignment="left", vertical_alignment="top"),
                merge=CellMerge(),
                grid_row=ri,
                grid_col=ci,
            ))
        data.append(data_row)
        formats.append(fmt_row)

    return BridgeTable(
        position=_rect_to_pos(table_rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Table_{shape_id}",
            shape_id=shape_id,
        ),
        data=data,
        cell_formats=formats,
        dimensions=TableDimensions(column_widths=col_widths, row_heights=row_heights),
        table_properties=TableProperties(),
        defaults=TableDefaults(),
        custom_properties={
            "source_format": "pdf",
            "pdf_table_method": "line_grid",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


# ── gradient / rasterized-region helpers ─────────────────────────────────────

def _is_gradient_fill(drawing: dict) -> bool:
    """True when the drawing has a fill-type operation but no explicit fill color.

    PyMuPDF reports fill=None for gradient-filled and pattern-filled areas;
    fill_opacity may be set. The 'type' string contains 'f' for fill operations.
    """
    draw_type = drawing.get("type") or ""
    fill = drawing.get("fill")
    rect = drawing.get("rect")
    if "f" not in draw_type or fill is not None:
        return False
    if rect is None:
        return False
    return (rect.width * rect.height) >= _MIN_GRADIENT_AREA


def _rasterize_region(
    page: fitz.Page,
    drawing: dict,
    page_number: int,
    shape_id: int,
) -> "BridgeImage | None":
    """Rasterize a gradient/pattern region via PyMuPDF and return as BridgeImage."""
    rect: fitz.Rect = drawing.get("rect")
    if rect is None:
        return None
    try:
        clip = fitz.Rect(rect)
        mat = fitz.Matrix(1, 1)
        pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
        img_bytes = pix.tobytes("png")
    except Exception:
        return None

    return BridgeImage(
        position=_rect_to_pos(rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Gradient_{shape_id}",
            shape_id=shape_id,
        ),
        stacking=Stacking(z_index=0),
        image_data=ImageData(image_bytes=img_bytes, image_format="PNG"),
        file_info=ImageFileInfo(),
        dimensions=ImageDimensions(width_px=pix.width, height_px=pix.height),
        custom_properties={
            "source_format": "pdf",
            "pdf_rasterized": True,
            "onboard_status": "rasterized-gradient",
            "semantic_debt": [],
        },
    )


# ── rounded rectangle detection ──────────────────────────────────────────────

def _is_rounded_rect(drawing: dict) -> bool:
    """True when the path looks like a rounded rectangle (4 lines + 4 cubic beziers)."""
    items = drawing.get("items", [])
    if len(items) < 4:
        return False
    kinds = [item[0] for item in items]
    lines = kinds.count("l")
    curves = kinds.count("c")
    return lines == 4 and curves == 4


def _rounded_rect_corner_radius(drawing: dict) -> float:
    """Estimate corner radius (in inches) from the first cubic bezier in the path."""
    items = drawing.get("items", [])
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
    for item in items:
        if item[0] == "c":
            # Bezier control points; approximate radius as distance from endpoint to control
            start = item[1]
            ctrl1 = item[2]
            # Radius ≈ distance from corner to first control point projected onto edge
            dr = abs(ctrl1.x - start.x) + abs(ctrl1.y - start.y)
            # Use the smaller dimension of bounding box to clamp radius
            max_r = min(rect.width, rect.height) / 2.0
            return _pt_to_in(min(dr * 0.55, max_r))
    return _pt_to_in(min(rect.width, rect.height) * 0.1)


def _rounded_rect_adj(drawing: dict) -> dict:
    """Return geometry_adjustments dict with 'adj' key encoding the corner radius.

    The adj value is in OOXML units: radius / min_dimension * 100_000.
    _make_shape_patch in render_png.py reads this to size FancyBboxPatch correctly.
    """
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
    min_dim = min(rect.width, rect.height)
    if min_dim <= 0:
        return {}
    radius_in = _rounded_rect_corner_radius(drawing)
    radius_pt = radius_in * _PT_PER_INCH
    adj_val = int(radius_pt / min_dim * 100_000)
    return {"adj": str(adj_val)}


def _rounded_rect_to_shape(
    drawing: dict,
    page_number: int,
    shape_id: int,
    fill_opacity: float = 1.0,
) -> "BridgeShape | None":
    """Convert a rounded-rectangle path to a BridgeShape with roundRect preset."""
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
    fill_hex = _rgb_to_hex(drawing.get("fill"))
    stroke_hex = _rgb_to_hex(drawing.get("color"))
    stroke_w: float = drawing.get("width") or 0.0
    has_fill = fill_hex is not None
    has_stroke = stroke_hex is not None and stroke_w > 0.0

    pdf_fill_op: float = drawing.get("fill_opacity") if drawing.get("fill_opacity") is not None else 1.0
    eff_fill_op = fill_opacity if fill_opacity < pdf_fill_op else pdf_fill_op
    transparency = max(0.0, 1.0 - eff_fill_op)

    if transparency >= 1.0 and not has_stroke:
        return None

    return BridgeShape(
        position=_rect_to_pos(rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"RoundRect_{shape_id}",
            shape_id=shape_id,
        ),
        shape_identification=ShapeIdentification(
            shape_type="rect",
            geometry_preset="roundRect",
            geometry_adjustments=_rounded_rect_adj(drawing),
        ),
        fill=ShapeFill(
            fill_type="solid" if has_fill else None,
            color=fill_hex,
            transparency=transparency,
        ),
        line=ShapeLine(
            visible=has_stroke,
            color=stroke_hex,
            width=stroke_w if has_stroke else None,
            dash_style=_pdf_dashes_to_style(drawing.get("dashes")),
        ),
        text_content=ShapeTextContent(has_text=False),
        text_frame=ShapeTextFrame(),
        custom_properties={
            "source_format": "pdf",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


# ── drawing → bridge element ──────────────────────────────────────────────────

def _drawing_to_element(
    drawing: dict,
    page_number: int,
    shape_id: int,
    fill_opacity: float = 1.0,
) -> BridgeShape | BridgeFreeform | BridgeConnector | None:
    items = drawing.get("items", [])
    if not items:
        return None

    if _is_single_line(drawing):
        return _line_to_connector(drawing, page_number, shape_id)

    if _is_simple_rect(drawing):
        return _rect_to_shape(drawing, page_number, shape_id, fill_opacity=fill_opacity)

    if _is_rounded_rect(drawing):
        return _rounded_rect_to_shape(drawing, page_number, shape_id, fill_opacity=fill_opacity)

    # Multi-segment or curved path → BridgeFreeform with full path commands
    return _complex_path_to_freeform(drawing, page_number, shape_id, fill_opacity=fill_opacity)


def _line_to_connector(drawing: dict, page_number: int, shape_id: int) -> BridgeConnector:
    items = drawing.get("items", [])
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)

    if items and items[0][0] == "l":
        p1, p2 = items[0][1], items[0][2]
        sx, sy = _pt_to_in(p1.x), _pt_to_in(p1.y)
        ex, ey = _pt_to_in(p2.x), _pt_to_in(p2.y)
    else:
        sx, sy = _pt_to_in(rect.x0), _pt_to_in(rect.y0)
        ex, ey = _pt_to_in(rect.x1), _pt_to_in(rect.y1)

    return BridgeConnector(
        position=_rect_to_pos(rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Line_{shape_id}",
            shape_id=shape_id,
        ),
        connector_type="straight",
        endpoints=ConnectorEndpoints(start_x=sx, start_y=sy, end_x=ex, end_y=ey),
        line=ShapeLine(
            visible=True,
            color=_rgb_to_hex(drawing.get("color")),
            width=drawing.get("width"),
            dash_style=_pdf_dashes_to_style(drawing.get("dashes")),
        ),
        custom_properties={
            "source_format": "pdf",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


def _rect_to_shape(
    drawing: dict,
    page_number: int,
    shape_id: int,
    fill_opacity: float = 1.0,
) -> BridgeShape | None:
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
    fill_hex = _rgb_to_hex(drawing.get("fill"))
    stroke_hex = _rgb_to_hex(drawing.get("color"))
    stroke_w: float = drawing.get("width") or 0.0
    has_fill = fill_hex is not None
    has_stroke = stroke_hex is not None and stroke_w > 0.0

    # fill_opacity: prefer ExtGState override (passed in), then drawing dict value
    pdf_fill_op: float = drawing.get("fill_opacity") if drawing.get("fill_opacity") is not None else 1.0
    eff_fill_op = fill_opacity if fill_opacity < pdf_fill_op else pdf_fill_op
    transparency = max(0.0, 1.0 - eff_fill_op)

    # Skip completely invisible shapes (zero opacity, no stroke)
    if transparency >= 1.0 and not has_stroke:
        return None

    return BridgeShape(
        position=_rect_to_pos(rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Shape_{shape_id}",
            shape_id=shape_id,
        ),
        shape_identification=ShapeIdentification(
            shape_type="rect",
            geometry_preset="rect",
        ),
        fill=ShapeFill(
            fill_type="solid" if has_fill else None,
            color=fill_hex,
            transparency=transparency,
        ),
        line=ShapeLine(
            visible=has_stroke,
            color=stroke_hex,
            width=stroke_w if has_stroke else None,
        ),
        text_content=ShapeTextContent(has_text=False),
        text_frame=ShapeTextFrame(),
        custom_properties={
            "source_format": "pdf",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


def _complex_path_to_freeform(
    drawing: dict,
    page_number: int,
    shape_id: int,
    fill_opacity: float = 1.0,
) -> BridgeFreeform:
    """Convert a multi-segment / curved PDF path to BridgeFreeform.

    Path coordinates are stored in local space (origin = shape top-left),
    scaled by _PATH_SCALE (default 100) so 1 stored unit = 0.01 pt.
    The custom_properties["pdf_path_scale"] key documents this unit for
    any future PDF-aware rebuild step.
    """
    rect: fitz.Rect = drawing.get("rect") or fitz.Rect(0, 0, 0, 0)
    items: list[tuple] = drawing.get("items", [])

    commands = _items_to_path_commands(items, rect.x0, rect.y0)

    fill_hex = _rgb_to_hex(drawing.get("fill"))
    stroke_hex = _rgb_to_hex(drawing.get("color"))
    stroke_w: float = drawing.get("width") or 0.0
    has_fill = fill_hex is not None
    has_stroke = stroke_hex is not None and stroke_w > 0.0

    pdf_fill_op: float = drawing.get("fill_opacity") if drawing.get("fill_opacity") is not None else 1.0
    eff_fill_op = fill_opacity if fill_opacity < pdf_fill_op else pdf_fill_op
    freeform_transparency = max(0.0, 1.0 - eff_fill_op)

    path_w = max(1, _scale(rect.width))
    path_h = max(1, _scale(rect.height))

    return BridgeFreeform(
        position=_rect_to_pos(rect),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Freeform_{shape_id}",
            shape_id=shape_id,
        ),
        paths=[FreeformPath(
            width=path_w,
            height=path_h,
            commands=commands,
            fill_mode="norm" if has_fill else "none",
            stroke=has_stroke,
        )],
        fill=FreeformFill(
            fill_type="solid" if has_fill else None,
            fill_color=fill_hex,
            transparency=freeform_transparency,
        ),
        line=FreeformLine(
            line_color=stroke_hex,
            line_width=stroke_w if has_stroke else None,
        ),
        transform_emus=TransformEmus(
            offset_x=_scale(rect.x0),
            offset_y=_scale(rect.y0),
            extent_cx=path_w,
            extent_cy=path_h,
        ),
        custom_properties={
            "source_format": "pdf",
            "pdf_path_scale": _PATH_SCALE,
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


def _items_to_path_commands(
    items: list[tuple],
    ox: float,
    oy: float,
) -> list[PathCommand]:
    """Translate fitz path items to PathCommand list.

    Coordinates are offset to the shape's local origin (ox, oy) and scaled
    by _PATH_SCALE, producing integer path units.  Connectivity between
    adjacent line segments is preserved via moveTo insertion.
    """
    commands: list[PathCommand] = []
    current: tuple[int, int] | None = None  # last drawn point in path units

    for item in items:
        kind = item[0]

        if kind == "re":
            r = item[1]
            pts = [
                (_scale(r.x0 - ox), _scale(r.y0 - oy)),
                (_scale(r.x1 - ox), _scale(r.y0 - oy)),
                (_scale(r.x1 - ox), _scale(r.y1 - oy)),
                (_scale(r.x0 - ox), _scale(r.y1 - oy)),
            ]
            commands.append(PathCommand(command="moveTo", points=[pts[0]]))
            for pt in pts[1:]:
                commands.append(PathCommand(command="lnTo", points=[pt]))
            commands.append(PathCommand(command="close"))
            current = None

        elif kind == "l":
            p1, p2 = item[1], item[2]
            sp = (_scale(p1.x - ox), _scale(p1.y - oy))
            ep = (_scale(p2.x - ox), _scale(p2.y - oy))
            if current != sp:
                commands.append(PathCommand(command="moveTo", points=[sp]))
            commands.append(PathCommand(command="lnTo", points=[ep]))
            current = ep

        elif kind == "c":
            # Cubic Bezier: item[1]=start, item[2]=ctrl1, item[3]=ctrl2, item[4]=end
            pts_c = [
                (_scale(item[i].x - ox), _scale(item[i].y - oy))
                for i in range(1, 5)
            ]
            if current != pts_c[0]:
                commands.append(PathCommand(command="moveTo", points=[pts_c[0]]))
            commands.append(PathCommand(command="cubicBezTo", points=pts_c[1:]))
            current = pts_c[3]

        elif kind == "qu":
            quad = item[1]
            pts_q = [
                (_scale(quad.ul.x - ox), _scale(quad.ul.y - oy)),
                (_scale(quad.ur.x - ox), _scale(quad.ur.y - oy)),
                (_scale(quad.lr.x - ox), _scale(quad.lr.y - oy)),
                (_scale(quad.ll.x - ox), _scale(quad.ll.y - oy)),
            ]
            if current != pts_q[0]:
                commands.append(PathCommand(command="moveTo", points=[pts_q[0]]))
            for pt in pts_q[1:]:
                commands.append(PathCommand(command="lnTo", points=[pt]))
            commands.append(PathCommand(command="close"))
            current = None

    return commands


# ── text block → BridgeText ───────────────────────────────────────────────────

def _text_block_to_element(
    block: dict,
    page_number: int,
    shape_id: int,
    stripped_to_full: dict[str, str] | None = None,
) -> BridgeText | None:
    # Drop whitespace-only blocks (PDF cursor-positioning artifacts)
    if not _block_plain_text(block).strip():
        return None

    paras = _block_to_paragraphs(block, stripped_to_full)
    if not paras:
        return None

    return BridgeText(
        position=_bbox_to_pos(block["bbox"]),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Text_{shape_id}",
            shape_id=shape_id,
        ),
        paragraphs=paras,
        text_frame=TextFrame(word_wrap=False, autofit_type="none"),
        margins=Margins(margin_left=0.0, margin_right=0.0, margin_top=0.0, margin_bottom=0.0),
        fill_and_border=FillAndBorder(has_fill=False, has_border=False),
        shape_info=ShapeInfo(shape_type="textbox"),
        custom_properties={
            "source_format": "pdf",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


def _text_block_to_elements(
    block: dict,
    page_number: int,
    next_id: "Callable[[], int]",
    stripped_to_full: dict[str, str] | None = None,
) -> list[BridgeText]:
    """Convert a text block to one or more BridgeText elements.

    PyMuPDF represents multi-column table rows as a block containing multiple
    "lines" at the SAME Y position but different X positions.  We detect this
    pattern and split into separate BridgeText elements — one per column — so
    each piece of text renders at its correct horizontal position.
    """
    if not _block_plain_text(block).strip():
        return []

    lines = block.get("lines", [])

    # Detect multi-column: two or more lines whose Y centres are within 2pt of
    # each other but whose X centres are more than _COLUMN_GAP_PT apart.
    is_multicolumn = False
    for i in range(len(lines)):
        yi = (lines[i]["bbox"][1] + lines[i]["bbox"][3]) / 2
        for j in range(i + 1, len(lines)):
            yj = (lines[j]["bbox"][1] + lines[j]["bbox"][3]) / 2
            if abs(yi - yj) > 2.0:
                continue  # different rows
            xi = (lines[i]["bbox"][0] + lines[i]["bbox"][2]) / 2
            xj = (lines[j]["bbox"][0] + lines[j]["bbox"][2]) / 2
            if abs(xi - xj) > _COLUMN_GAP_PT:
                is_multicolumn = True
                break
        if is_multicolumn:
            break

    if not is_multicolumn:
        el = _text_block_to_element(block, page_number, next_id(), stripped_to_full)
        return [el] if el is not None else []

    # Group lines into columns by snapping their x0 to the nearest cluster
    col_lines: dict[float, list[dict]] = {}  # col_x0_snapped → list of lines
    for line in lines:
        if not any(s.get("text", "").strip() for s in line.get("spans", [])):
            continue
        lx0 = line["bbox"][0]
        snapped: float | None = None
        for existing in col_lines:
            if abs(existing - lx0) <= _COLUMN_GAP_PT / 2:
                snapped = existing
                break
        if snapped is None:
            snapped = lx0
            col_lines[snapped] = []
        col_lines[snapped].append(line)

    elements: list[BridgeText] = []
    for col_x0, col_line_list in sorted(col_lines.items()):
        if not col_line_list:
            continue
        # Compute bounding box for this column group
        all_bboxes = [line["bbox"] for line in col_line_list]
        col_bbox = (
            min(b[0] for b in all_bboxes),
            min(b[1] for b in all_bboxes),
            max(b[2] for b in all_bboxes),
            max(b[3] for b in all_bboxes),
        )
        # Build a synthetic block for the standard paragraph builder
        synthetic = {"bbox": col_bbox, "lines": col_line_list}
        paras = _block_to_paragraphs(synthetic, stripped_to_full)
        if not paras:
            continue
        elements.append(BridgeText(
            position=_bbox_to_pos(col_bbox),
            identification=Identification(
                slide_number=page_number,
                shape_name=f"Text_{next_id()}",
                shape_id=next_id(),
            ),
            paragraphs=paras,
            text_frame=TextFrame(word_wrap=False, autofit_type="none"),
            margins=Margins(margin_left=0.0, margin_right=0.0, margin_top=0.0, margin_bottom=0.0),
            fill_and_border=FillAndBorder(has_fill=False, has_border=False),
            shape_info=ShapeInfo(shape_type="textbox"),
            custom_properties={
                "source_format": "pdf",
                "onboard_status": "semantic-best-effort",
                "semantic_debt": [],
            },
        ))
    return elements


_BULLET_CHARS = frozenset("•·–—▪▸○◦◉●▶►▻◆◇▷▾▿※‣⁃∙◘◙◈⊙")


def _block_to_paragraphs(
    block: dict,
    stripped_to_full: dict[str, str] | None = None,
) -> list[TextParagraph]:
    """Convert a fitz text block (type 0) to TextParagraph list.

    Line spacing is estimated from the vertical distance between successive
    line bboxes divided by font size, expressed as a multiplier (1.0 = single).
    Each paragraph stores pdf_y_offset (inches from block top) so the renderer
    can use exact PDF positions instead of accumulated line heights.
    Left indent is computed from the line x0 minus block x0 so indented bullet
    text is rendered at the correct horizontal position.
    """
    lines = block.get("lines", [])
    paragraphs: list[TextParagraph] = []
    block_bbox = block.get("bbox") or (0.0, 0.0, 0.0, 0.0)
    block_x0 = float(block_bbox[0])
    block_y0 = float(block_bbox[1])

    # Build list of (bbox_y0, dominant_font_size) for spacing estimation
    line_y0s: list[float] = []
    line_sizes: list[float] = []
    for line in lines:
        bbox = line.get("bbox")
        spans = line.get("spans", [])
        if bbox and spans:
            sizes = [s.get("size", 12.0) for s in spans if s.get("text", "").strip()]
            dominant = max(sizes) if sizes else 12.0
            line_y0s.append(float(bbox[1]))
            line_sizes.append(dominant)

    for idx, line in enumerate(lines):
        runs = _line_to_runs(line, stripped_to_full)
        if not runs:
            continue
        # Estimate line_spacing multiplier from delta to next line
        line_spacing: float | None = None
        if idx < len(line_y0s) - 1 and idx + 1 < len(line_y0s):
            delta = line_y0s[idx + 1] - line_y0s[idx]
            fs = line_sizes[idx] if idx < len(line_sizes) else 12.0
            if fs > 0:
                mult = delta / fs
                if 0.8 <= mult <= 4.0:  # sanity-clamp; ignore outliers
                    line_spacing = round(mult, 3)
        # X indent: line x0 relative to block x0 (accounts for bullet indentation)
        line_bbox = line.get("bbox")
        left_indent: float | None = None
        if line_bbox:
            dx = float(line_bbox[0]) - block_x0
            if dx > 1.0:  # ignore sub-pt noise; only record meaningful indents
                left_indent = _pt_to_in(dx)
        # Bullet detection: first non-whitespace char is a bullet symbol
        bullet_type = "none"
        bullet_char: str | None = None
        first_text = next((r.text for r in runs if r.text.strip()), "")
        if first_text and first_text[0] in _BULLET_CHARS:
            bullet_type = "char"
            bullet_char = first_text[0]
        # Store PDF Y offset using the BASELINE of the first non-empty span.
        # The baseline is more stable across font substitutions than the line
        # bbox top (which encodes the ascender height of the specific font).
        spans = line.get("spans", [])
        baseline_y: float | None = None
        for sp in spans:
            if sp.get("text", "").strip():
                origin = sp.get("origin")
                if origin and len(origin) >= 2:
                    baseline_y = float(origin[1])
                    break
        if baseline_y is None and line_bbox:
            # Fallback: estimate baseline as bbox bottom minus ~20% of line height
            lh = float(line_bbox[3]) - float(line_bbox[1])
            baseline_y = float(line_bbox[3]) - lh * 0.20
        pdf_y_offset = _pt_to_in(baseline_y - block_y0) if baseline_y is not None else None
        paragraphs.append(TextParagraph(
            runs=runs,
            line_spacing=line_spacing,
            left_indent=left_indent,
            bullet_type=bullet_type,
            bullet_char=bullet_char,
            pdf_y_offset=pdf_y_offset,
        ))
    return paragraphs


def _line_to_runs(
    line: dict,
    stripped_to_full: dict[str, str] | None = None,
) -> list[TextRun]:
    """Extract TextRun list from a single fitz text line."""
    runs: list[TextRun] = []
    for span in line.get("spans", []):
        text = span.get("text", "")
        if not text:
            continue
        flags = span.get("flags", 0)
        font = span.get("font") or None
        # PyMuPDF span['font'] returns the stripped name without the 6-char
        # subset prefix (e.g. 'WellsFargoSans-Regular' instead of
        # 'BIDVWV+WellsFargoSans-Regular').  Resolve back to the full name so
        # the renderer's font_map lookup finds the exact registered subset.
        if font and stripped_to_full:
            font = stripped_to_full.get(font, font)
        # PyMuPDF flag bits: bit 0 = superscript, bit 5 = subscript (older API uses different bits)
        # In modern PyMuPDF, superscript is detected via span origin vs line baseline
        is_super = bool(flags & (1 << 0))  # bit 0: superscript
        is_sub   = bool(flags & (1 << 5))  # bit 5: subscript
        base_size = round(float(span.get("size", 12.0)), 2)
        run = TextRun(
            text=text,
            font_name=font,
            font_size=round(base_size * 0.65, 2) if (is_super or is_sub) else base_size,
            font_bold=_is_bold(flags, font),
            font_italic=_is_italic(flags, font),
            font_color=_packed_int_to_hex(span.get("color", 0)),
            baseline_shift=-0.40 if is_super else (0.15 if is_sub else None),
        )
        runs.append(run)
    return runs


# ── image block → BridgeImage ─────────────────────────────────────────────────

def _apply_smask(img_bytes: bytes, smask_bytes: bytes) -> bytes | None:
    """Merge a PDF soft-mask (grayscale) as the alpha channel of an RGBA image.

    doc.extract_image() returns raw RGB without applying the soft mask, so images
    with smask appear fully opaque.  This function fixes that by compositing the
    mask as transparency: higher grayscale value → more opaque.
    """
    from PIL import Image
    import io as _io
    try:
        img = Image.open(_io.BytesIO(img_bytes)).convert("RGB")
        mask = Image.open(_io.BytesIO(smask_bytes)).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.LANCZOS)
        rgba = img.convert("RGBA")
        rgba.putalpha(mask)
        buf = _io.BytesIO()
        rgba.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return None


def _image_block_to_element(
    doc: fitz.Document,
    block: dict,
    page_number: int,
    shape_id: int,
    page: fitz.Page | None = None,
    smask_map: dict[int, int] | None = None,
    secondary_sizes: set[tuple[int, int]] | None = None,
) -> "BridgeImage | None":
    xref: int | None = block.get("xref")
    bbox = block.get("bbox", (0.0, 0.0, 0.0, 0.0))

    img_bytes: bytes | None = None
    img_ext: str | None = None
    img_w: int | None = block.get("width")
    img_h: int | None = block.get("height")

    if xref:
        try:
            info = doc.extract_image(xref)
            img_bytes = info.get("image")
            raw_ext = info.get("ext") or ""
            img_ext = raw_ext.upper() or None
            img_w = info.get("width", img_w)
            img_h = info.get("height", img_h)
        except Exception:
            pass
        # Apply soft mask if present — extract_image() returns raw RGB without it
        if img_bytes and smask_map and xref in smask_map:
            smask_xref = smask_map[xref]
            if smask_xref > 0:
                try:
                    smask_info = doc.extract_image(smask_xref)
                    smask_bytes = smask_info.get("image")
                    if smask_bytes:
                        applied = _apply_smask(img_bytes, smask_bytes)
                        if applied:
                            img_bytes = applied
                            img_ext = "PNG"
                except Exception:
                    pass

    # Fallback: rasterize the bbox region when xref is missing or extraction failed.
    # Primary-pass images run after the drawings loop and receive higher z-indices,
    # so they naturally appear on top of vector shapes — the rasterized content is
    # the accurate PDF rendering.  Include all area fracs (including the previous
    # "middle range" 0.30-0.80 that was skipped to avoid double-draws; since the
    # raster lands on top of any vectors, visually there is no double-draw — the
    # raster simply replaces them at higher z, improving accuracy for chart slides
    # where the chart content is only present as a raster image block).
    # The secondary_sizes skip only applies when there is a real xref: the secondary
    # pass extracts by xref with correct smask/transparency.  For xref=None blocks,
    # get_image_rects() returns oversized unclipped positions, so we must rasterize
    # the clipped block region here to get the correct position and visual content.
    if img_bytes is None and page is not None:
        if xref and secondary_sizes and img_w and img_h and (img_w, img_h) in secondary_sizes:
            return None  # secondary pass handles this by xref correctly
        # Clip block bbox to page bounds before rasterizing.  Blocks that extend
        # far beyond the page (e.g. oversized Form XObjects in Palantir-style PDFs)
        # produce partial rasters at the wrong position; skip them when the visible
        # (page-clipped) fraction of the block is below 50% of the block area.
        _bbox_r = fitz.Rect(bbox[0], bbox[1], bbox[2], bbox[3])
        _bbox_clipped = _bbox_r & page.rect
        if _bbox_clipped.is_empty:
            return None
        _block_area = _bbox_r.width * _bbox_r.height
        _vis_area   = _bbox_clipped.width * _bbox_clipped.height
        if _block_area > 0 and _vis_area / _block_area < 0.50:
            return None  # mostly outside the page — off-page compositing artifact
        try:
            clip = _bbox_clipped
            pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=clip, alpha=False)
            img_bytes = pix.tobytes("png")
            img_ext = "PNG"
            img_w, img_h = pix.width, pix.height
            # Use the clipped rect as the position so the image lands correctly.
            bbox = (clip.x0, clip.y0, clip.x1, clip.y1)
        except Exception:
            pass

    if img_bytes is None:
        return None  # Skip images we can't capture at all

    return BridgeImage(
        position=_bbox_to_pos(bbox),
        identification=Identification(
            slide_number=page_number,
            shape_name=f"Image_{shape_id}",
            shape_id=shape_id,
        ),
        image_data=ImageData(image_bytes=img_bytes, image_format=img_ext),
        file_info=ImageFileInfo(),
        dimensions=ImageDimensions(width_px=img_w, height_px=img_h),
        custom_properties={
            "source_format": "pdf",
            "onboard_status": "semantic-best-effort",
            "semantic_debt": [],
        },
    )


# ── background color ──────────────────────────────────────────────────────────

def _page_background_info(
    drawings: list[dict], page_rect: fitz.Rect
) -> tuple[str | None, int | None]:
    """Return (bg_hex_color, drawing_index) for the first full-page rectangle.

    The drawing at the returned index should be excluded from the element list
    since it is already represented by BridgeSlide.background_color.
    Returns (None, None) if no full-page background is found.
    """
    page_area = page_rect.width * page_rect.height
    for i, d in enumerate(drawings):
        if not _is_simple_rect(d) or d.get("fill") is None:
            continue
        r = d["rect"]
        # Use intersection with page rect for area check — a rect that extends far
        # beyond the page is clipped by the PDF viewer and should not be treated
        # as a full-page background solely because its raw area is large.
        clipped_r = r & page_rect
        if clipped_r.width * clipped_r.height < 0.9 * page_area:
            continue
        # Skip nearly-transparent rects — they don't define background color but
        # may exist as invisible click-targets or selection helpers in the PDF.
        fill_opacity = d.get("fill_opacity")
        if fill_opacity is None:
            fill_opacity = 1.0
        if fill_opacity < 0.05:
            continue
        return _rgb_to_hex(d["fill"]), i
    return None, None


def _page_background_color(drawings: list[dict], page_rect: fitz.Rect) -> str | None:
    """Return the fill color of a full-page covering rectangle, or None (white)."""
    color, _ = _page_background_info(drawings, page_rect)
    return color


# ── coordinate helpers ────────────────────────────────────────────────────────

def _pt_to_in(pt: float) -> float:
    return round(pt / _PT_PER_INCH, 4)


def _rect_to_pos(rect: fitz.Rect) -> Position:
    return Position(
        left=_pt_to_in(rect.x0),
        top=_pt_to_in(rect.y0),
        width=_pt_to_in(rect.width),
        height=_pt_to_in(rect.height),
    )


def _bbox_to_pos(bbox: tuple) -> Position:
    x0, y0, x1, y1 = bbox
    return Position(
        left=_pt_to_in(x0),
        top=_pt_to_in(y0),
        width=_pt_to_in(x1 - x0),
        height=_pt_to_in(y1 - y0),
    )


# ── color helpers ─────────────────────────────────────────────────────────────

def _rgb_to_hex(rgb: tuple | None) -> str | None:
    """Convert a PyMuPDF (r, g, b) float tuple to '#RRGGBB'."""
    if rgb is None:
        return None
    try:
        r, g, b = float(rgb[0]), float(rgb[1]), float(rgb[2])
        return f"#{int(r * 255):02X}{int(g * 255):02X}{int(b * 255):02X}"
    except Exception:
        return None


def _packed_int_to_hex(color: int) -> str:
    """Convert PyMuPDF span color (sRGB integer 0xRRGGBB) to '#RRGGBB'."""
    return f"#{color:06X}"


# ── font style helpers ────────────────────────────────────────────────────────

def _is_bold(flags: int, font_name: str | None) -> bool:
    """Determine bold from font name first (most reliable), then span flag.

    PyMuPDF bit 4 of flags reports whether the font file is a bold variant,
    but corporate documents often use a bold-weight font as the "regular" face.
    Inspecting the font name avoids false positives in that common case.
    """
    name = (font_name or "").lower()
    for token in _BOLD_NAME_TOKENS:
        if token in name:
            return True
    for token in _NON_BOLD_NAME_TOKENS:
        if token in name:
            return False
    return bool(flags & (1 << 4))


def _is_italic(flags: int, font_name: str | None) -> bool:
    """Determine italic from font name first, then span flag (bit 1)."""
    name = (font_name or "").lower()
    for token in _ITALIC_NAME_TOKENS:
        if token in name:
            return True
    return bool(flags & (1 << 1))


# ── dash style helper ────────────────────────────────────────────────────────

def _pdf_dashes_to_style(dashes: str | None) -> str:
    """Convert a PyMuPDF dashes string like '[3 3] 0' to a ShapeLine dash_style.

    PDF dashes format: '[on off ...] phase'
    Empty array '[] 0' means solid.  Any non-empty array means dashed/dotted.
    """
    if not dashes:
        return "solid"
    # strip brackets and whitespace to get the array content
    inner = dashes.strip()
    bracket_end = inner.find("]")
    if bracket_end < 0:
        return "solid"
    array_str = inner[1:bracket_end].strip()
    if not array_str:
        return "solid"
    try:
        parts = [float(x) for x in array_str.split()]
    except ValueError:
        return "dashed"
    if not parts:
        return "solid"
    on = parts[0]
    off = parts[1] if len(parts) > 1 else on
    # Classify: short on+off = dotted, longer = dashed
    if on <= 2.0 and off >= 2.0:
        return "dotted"
    return "dashed"


# ── drawing classification helpers ───────────────────────────────────────────

def _is_simple_rect(drawing: dict) -> bool:
    """True when the path is a single rectangle item."""
    items = drawing.get("items", [])
    return len(items) == 1 and items[0][0] == "re"


def _is_hairline_rect(drawing: dict) -> bool:
    """True when the shorter dimension of the rect is below _LINE_DIM."""
    rect: fitz.Rect | None = drawing.get("rect")
    return rect is not None and min(rect.width, rect.height) < _LINE_DIM


def _is_single_line(drawing: dict) -> bool:
    """True for a single explicit line segment or a hairline rectangle."""
    items = drawing.get("items", [])
    if len(items) == 1 and items[0][0] == "l":
        return True
    return _is_simple_rect(drawing) and _is_hairline_rect(drawing)


# ── geometry helpers ──────────────────────────────────────────────────────────

def _rects_close(a: fitz.Rect, b: fitz.Rect, proximity: float) -> bool:
    expanded = fitz.Rect(
        a.x0 - proximity, a.y0 - proximity,
        a.x1 + proximity, a.y1 + proximity,
    )
    return bool(expanded.intersects(b))


def _bbox_center_in_rect(bbox: tuple, rect: fitz.Rect, tol: float = 2.0) -> bool:
    """True if the center of bbox lies within rect (with tolerance)."""
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    return (
        rect.x0 - tol <= cx <= rect.x1 + tol
        and rect.y0 - tol <= cy <= rect.y1 + tol
    )


def _snap_coords(values: list[float], tol: float) -> dict[float, float]:
    """Map each value to the lowest value in its tolerance cluster."""
    clusters: list[list[float]] = []
    for v in sorted(values):
        placed = False
        for cluster in clusters:
            if abs(v - cluster[0]) <= tol:
                cluster.append(v)
                placed = True
                break
        if not placed:
            clusters.append([v])
    result: dict[float, float] = {}
    for cluster in clusters:
        rep = cluster[0]
        for v in cluster:
            result[v] = rep
    return result


# ── path coordinate helper ────────────────────────────────────────────────────

def _scale(pt: float) -> int:
    """Convert a PDF point value to an integer path unit."""
    return int(round(pt * _PATH_SCALE))


# ── misc helpers ──────────────────────────────────────────────────────────────

def _block_plain_text(block: dict) -> str:
    """Concatenate all span text in a block."""
    parts: list[str] = []
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            t = span.get("text", "").strip()
            if t:
                parts.append(t)
    return " ".join(parts)


def _line_plain_text(line: dict) -> str:
    """Concatenate all span text in a single line."""
    return " ".join(
        s.get("text", "").strip()
        for s in line.get("spans", [])
        if s.get("text", "").strip()
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0
