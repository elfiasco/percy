"""PDF embedded-font extraction and matplotlib registration.

Extracts TrueType / OpenType fonts embedded in a PDF, writes them to a
per-process temp directory, registers them with matplotlib's font manager,
and returns a mapping from PDF font names to BridgeFont objects that the
renderer can use directly.

All I/O is pure Python (PyMuPDF + fonttools + matplotlib).  No shell-outs.
"""

from __future__ import annotations

import atexit
import logging
import re
import tempfile
import threading
from pathlib import Path

import fitz  # PyMuPDF

from percy.bridge.elements import BridgeFont

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module-level cache: pdf_font_name → BridgeFont
# ---------------------------------------------------------------------------
_lock = threading.Lock()
# Keyed by absolute file path — tracks which font files have been registered
# with matplotlib.  Using file paths (not xref ints) avoids cross-PDF xref
# collisions: different PDF documents reuse xref numbers internally.
_registered_font_files: set[str] = set()
_pdf_name_to_font: dict[str, BridgeFont] = {}  # pdf_font_name → BridgeFont

# Shared temp dir — cleaned up on process exit
_tmp_dir: Path | None = None


def _get_tmp_dir() -> Path:
    global _tmp_dir
    if _tmp_dir is None:
        _tmp_dir = Path(tempfile.mkdtemp(prefix="percy_fonts_"))
        atexit.register(_cleanup_tmp)
    return _tmp_dir


def _cleanup_tmp() -> None:
    global _tmp_dir
    if _tmp_dir and _tmp_dir.exists():
        import shutil
        try:
            shutil.rmtree(_tmp_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Font-name parsing helpers
# ---------------------------------------------------------------------------

# Name tokens that signal bold weight
_BOLD_TOKENS = re.compile(
    r"(?i)(extrabold|semibold|demibold|ultrabold|heavy|black|bold)"
)
_LIGHT_TOKENS = re.compile(
    r"(?i)(extralight|ultralight|thin|hairline|light)"
)
_ITALIC_TOKENS = re.compile(
    r"(?i)(italic|oblique|slant(?:ed)?)"
)

# Strip the common "ABCDEF+" PDF subset prefix (6 uppercase letters + "+")
_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")

# System font families where sparse extracted subsets should NOT be registered.
# For these fonts, if cmap coverage is low, system font fallback is better
# (avoids placeholder boxes for uncovered glyphs).
_SYSTEM_FONT_FAMILIES: frozenset[str] = frozenset({
    "arial", "arialmt", "arialnarrow", "arialrounded",
    "helvetica", "helveticaneue", "helveticacompressed",
    "times", "timesnewroman", "timesnewromanps", "timesnewromanpsmt",
    "calibri", "cambria", "georgia", "verdana", "trebuchetms", "tahoma",
    "palatino", "palatinolinotype", "couriernew", "courier", "courierstd",
    "centurygothic", "franklingothic", "garamond", "garamondpremrpro",
    "myriadpro", "myriad", "lucidabright", "lucidagrande", "lucida",
    "symbol", "wingdings", "webdings", "zapfdingbats",
    "futura", "gill", "gillsans", "optima", "frutiger",
    "impact", "comicsans", "comicsansms",
})


def _parse_pdf_font_name(raw: str) -> tuple[str, str, str]:
    """Return (family, weight, style) parsed from a raw PDF font name.

    Examples::
        "Inter-Bold"               → ("Inter", "bold", "normal")
        "Inter-SemiBoldItalic"     → ("Inter", "semibold", "italic")
        "AllianceNo.2-Regular"     → ("AllianceNo.2", "normal", "normal")
        "ABCDEF+HelveticaNeue-LightOblique" → ("HelveticaNeue", "light", "oblique")
    """
    name = _SUBSET_PREFIX.sub("", raw).strip()

    # Split on "-" or "," to separate family from variant
    parts = re.split(r"[-,]", name, maxsplit=1)
    family = parts[0].strip()
    variant = parts[1].strip() if len(parts) > 1 else ""

    combined = (family + " " + variant).lower()

    # Weight
    if _BOLD_TOKENS.search(combined):
        m = _BOLD_TOKENS.search(combined)
        token = m.group(1).lower() if m else "bold"
        if token in ("extrabold", "ultrabold"):
            weight = "extra bold"
        elif token in ("semibold", "demibold"):
            weight = "semibold"
        elif token in ("heavy", "black"):
            weight = "black"
        else:
            weight = "bold"
    elif _LIGHT_TOKENS.search(combined):
        m = _LIGHT_TOKENS.search(combined)
        token = m.group(1).lower() if m else "light"
        if token in ("extralight", "ultralight"):
            weight = "ultralight"
        elif token in ("thin", "hairline"):
            weight = "thin"
        else:
            weight = "light"
    else:
        weight = "normal"

    # Style
    if "italic" in combined:
        style = "italic"
    elif "oblique" in combined or "slant" in combined:
        style = "oblique"
    else:
        style = "normal"

    return family, weight, style


def _matplotlib_family_from_file(font_path: Path) -> str | None:
    """Return the font-family name matplotlib assigned after registration."""
    try:
        from matplotlib import font_manager as fm
        font_path_str = str(font_path).lower()
        # addfont() appends to ttflist — check most-recently-added entries first
        for entry in reversed(fm.fontManager.ttflist):
            if entry.fname.lower() == font_path_str:
                return entry.name
        # Fallback: match by filename stem in case path normalisation differs
        stem = font_path.stem.lower()
        for entry in reversed(fm.fontManager.ttflist):
            if Path(entry.fname).stem.lower() == stem:
                return entry.name
    except Exception:
        pass
    # Pure-Python TrueType name-table reader (no fonttools needed)
    try:
        family = _read_ttf_family(font_path)
        if family:
            return family
    except Exception:
        pass
    return None


def _read_ttf_family(font_path: Path) -> str | None:
    """Read font family (name ID 1) directly from a TTF/OTF file."""
    import struct
    with open(font_path, "rb") as f:
        data = f.read()
    # Support TrueType collections (.ttc) by reading first font offset
    sig = data[:4]
    if sig in (b"ttcf",):
        if len(data) < 12:
            return None
        offset = struct.unpack_from(">I", data, 8)[0]
        data = data[offset:]
    # Read offset table
    if len(data) < 12:
        return None
    num_tables = struct.unpack_from(">H", data, 4)[0]
    name_offset = None
    for i in range(num_tables):
        rec = data[12 + i * 16: 12 + i * 16 + 16]
        if len(rec) < 16:
            break
        tag = rec[:4]
        offset = struct.unpack_from(">I", rec, 8)[0]
        if tag == b"name":
            name_offset = offset
            break
    if name_offset is None:
        return None
    # Parse name table
    base = name_offset
    if len(data) < base + 6:
        return None
    count, string_offset = struct.unpack_from(">HH", data, base + 2)
    storage = base + string_offset
    for i in range(count):
        rec_off = base + 6 + i * 12
        if len(data) < rec_off + 12:
            break
        platform_id, _, _, name_id, length, offset = struct.unpack_from(">HHHHHH", data, rec_off)
        if name_id != 1:
            continue
        raw = data[storage + offset: storage + offset + length]
        # Platform 3 (Windows) uses UTF-16BE; platform 1 (Mac) uses Latin-1
        try:
            text = raw.decode("utf-16-be") if platform_id == 3 else raw.decode("latin-1")
            return text.strip()
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# CFF → OTF wrapper
# ---------------------------------------------------------------------------

def _wrap_cff_to_otf(cff_data: bytes, family: str, weight: str, style: str) -> bytes | None:
    """Wrap raw CFF font bytes (as extracted from a PDF) into a minimal OTF file.

    PDFs embed CFF (Compact Font Format) data without the surrounding SFNT
    container that matplotlib/FreeType requires.  This builds the required
    tables (head, hhea, maxp, hmtx, OS/2, post, name, cmap) around the CFF
    payload so the result can be registered with ``fontManager.addfont()``.

    Returns the OTF bytes on success, None on failure.
    """
    try:
        from fontTools.ttLib import TTFont, newTable
        from fontTools import cffLib
        from fontTools.ttLib.tables._n_a_m_e import NameRecord
        from fontTools.ttLib.tables.O_S_2f_2 import Panose
        from fontTools.agl import AGL2UV
        import io as _io

        font = TTFont(sfntVersion="OTTO")
        font.setGlyphOrder([])

        cff_table = newTable("CFF ")
        cff_table.cff = cffLib.CFFFontSet()
        cff_table.cff.decompile(_io.BytesIO(cff_data), font)
        font["CFF "] = cff_table

        top_dict = cff_table.cff.topDictIndex[0]
        charstrings = top_dict.CharStrings
        glyph_names = list(charstrings.keys())
        n_glyphs = len(glyph_names)
        font.setGlyphOrder(glyph_names)
        top_dict.FamilyName = family
        top_dict.FullName = f"{family} {weight.title() if weight != 'normal' else 'Regular'}"

        # FreeType crashes at large rendering sizes when the CFF coordinate space
        # is much larger than the standard 1000-UPM range (e.g. display fonts
        # like "Fraunces72pt" where glyph coords reach 2754 units).
        # The render-pixel height = (yMax-yMin)/upm * pt_size * dpi/72; once
        # that exceeds ~100px FreeType returns FT_Err_Cannot_Open_Resource (0x1).
        #
        # Fix: inject a FontMatrix that scales the oversized coordinate space back
        # into the standard [0, 1000] range, so FreeType always sees normal metrics.
        # The default CFF FontMatrix is [0.001, 0, 0, 0.001, 0, 0] (1/1000 scale).
        # If coords go up to N instead of 1000, we scale by 1000/N.
        bbox = getattr(top_dict, 'FontBBox', None)
        if bbox and len(bbox) == 4:
            xmin_b, ymin_b, xmax_b, ymax_b = bbox
            coord_range = max(abs(xmin_b), abs(ymin_b), xmax_b, ymax_b)
            if coord_range > 1200:  # clearly oversized coordinate space
                scale = 1000.0 / coord_range
                top_dict.FontMatrix = [scale * 0.001, 0, 0, scale * 0.001, 0, 0]
                top_dict.FontBBox = [
                    round(xmin_b * scale), round(ymin_b * scale),
                    round(xmax_b * scale), round(ymax_b * scale),
                ]

        ps_name = f"{family.replace(' ', '')}-{weight.title().replace(' ', '')}"
        full_name = top_dict.FullName
        upm = 1000

        head = newTable("head")
        head.tableVersion = 1.0; head.fontRevision = 1.0; head.checkSumAdjustment = 0
        head.magicNumber = 0x5F0F3CF5; head.flags = 0x000B; head.unitsPerEm = upm
        head.created = 0; head.modified = 0
        head.xMin = 0; head.yMin = -200; head.xMax = 1000; head.yMax = 800
        _mac_italic = 2 if style in ("italic", "oblique") else 0  # macStyle bit 1
        _mac_bold   = 1 if weight in ("bold", "semibold", "extra bold", "black") else 0  # macStyle bit 0
        head.macStyle = _mac_italic | _mac_bold
        head.lowestRecPPEM = 8; head.fontDirectionHint = 2
        head.indexToLocFormat = 0; head.glyphDataFormat = 0
        font["head"] = head

        hhea = newTable("hhea")
        hhea.tableVersion = 0x00010000; hhea.ascent = 800; hhea.descent = -200; hhea.lineGap = 0
        hhea.advanceWidthMax = 1000; hhea.minLeftSideBearing = 0; hhea.minRightSideBearing = 0
        hhea.xMaxExtent = 1000; hhea.caretSlopeRise = 1; hhea.caretSlopeRun = 0; hhea.caretOffset = 0
        hhea.reserved0 = hhea.reserved1 = hhea.reserved2 = hhea.reserved3 = 0
        hhea.metricDataFormat = 0; hhea.numberOfHMetrics = n_glyphs
        font["hhea"] = hhea

        maxp = newTable("maxp")
        maxp.tableVersion = 0x00005000; maxp.numGlyphs = n_glyphs
        font["maxp"] = maxp

        hmtx = newTable("hmtx")
        # Extract actual advance widths from the CFF charstrings so letter spacing
        # is correct.  T2CharString widths are stored in the charstring program
        # itself; the charstring_or_index.calcBounds() or drawing to a width-pen
        # is the reliable way to get them.
        default_width = getattr(getattr(top_dict, "Private", None), "defaultWidthX", 600)
        nominal_width = getattr(getattr(top_dict, "Private", None), "nominalWidthX", 0)
        adv_metrics: dict[str, tuple[int, int]] = {}
        for gname in glyph_names:
            try:
                from fontTools.pens.boundsPen import BoundsPen
                cs = charstrings[gname]
                bp = BoundsPen(None)
                cs.draw(bp)
                aw = int(cs.width) if hasattr(cs, "width") and cs.width is not None else int(default_width)
                adv_metrics[gname] = (max(0, aw), 0)
            except Exception:
                adv_metrics[gname] = (int(default_width), 0)
        hmtx.metrics = adv_metrics
        font["hmtx"] = hmtx

        post = newTable("post")
        post.formatType = 2.0; post.italicAngle = (-12 if style in ("italic", "oblique") else 0)
        post.underlinePosition = -75; post.underlineThickness = 50; post.isFixedPitch = 0
        post.minMemType42 = post.maxMemType42 = post.minMemType1 = post.maxMemType1 = 0
        post.mapping = {i: n for i, n in enumerate(glyph_names)}; post.extraNames = []
        font["post"] = post

        os2 = newTable("OS/2"); os2.version = 4
        os2.xAvgCharWidth = 600; os2.usWeightClass = 400; os2.usWidthClass = 5; os2.fsType = 0
        os2.ySubscriptXSize = 650; os2.ySubscriptYSize = 600
        os2.ySubscriptXOffset = 0; os2.ySubscriptYOffset = 75
        os2.ySuperscriptXSize = 650; os2.ySuperscriptYSize = 600
        os2.ySuperscriptXOffset = 0; os2.ySuperscriptYOffset = 350
        os2.yStrikeoutSize = 50; os2.yStrikeoutPosition = 300; os2.sFamilyClass = 0
        panose = Panose()
        panose.bFamilyType = 2; panose.bSerifStyle = 4; panose.bWeight = 5
        panose.bProportion = 2; panose.bContrast = 5; panose.bStrokeVariation = 4
        panose.bArmStyle = 4; panose.bLetterForm = 2; panose.bMidline = 2; panose.bXHeight = 3
        os2.panose = panose
        os2.ulUnicodeRange1 = 0xFF; os2.ulUnicodeRange2 = 0
        os2.ulUnicodeRange3 = 0; os2.ulUnicodeRange4 = 0
        os2.achVendID = "UNKN"
        _is_italic = style in ("italic", "oblique")
        _is_bold   = weight in ("bold", "semibold", "extra bold", "black")
        os2.fsSelection = (0x01 if _is_italic else 0) | (0x20 if _is_bold else 0) or 0x40
        os2.fsFirstCharIndex = 32; os2.fsLastCharIndex = 126
        os2.sTypoAscender = 800; os2.sTypoDescender = -200; os2.sTypoLineGap = 0
        os2.usWinAscent = 800; os2.usWinDescent = 200
        os2.ulCodePageRange1 = 1; os2.ulCodePageRange2 = 0
        os2.sxHeight = 500; os2.sCapHeight = 700
        os2.usDefaultChar = 0; os2.usBreakChar = 32; os2.usMaxContext = 0
        font["OS/2"] = os2

        name_table = newTable("name"); name_table.names = []
        def _add_name(nameID: int, string: str) -> None:
            for platformID, platEncID, langID in ((3, 1, 0x0409), (1, 0, 0)):
                rec = NameRecord(); rec.nameID = nameID
                rec.platformID = platformID; rec.platEncID = platEncID; rec.langID = langID
                rec.string = string.encode("utf-16-be") if platformID == 3 else string.encode("mac_roman", errors="replace")
                name_table.names.append(rec)
        subfamily = "Italic" if style == "italic" else ("Bold Italic" if weight == "bold" and style == "italic" else "Regular")
        _add_name(1, family); _add_name(2, subfamily); _add_name(3, ps_name)
        _add_name(4, full_name); _add_name(6, ps_name)
        font["name"] = name_table

        cmap_table = newTable("cmap")
        from fontTools.ttLib.tables._c_m_a_p import cmap_format_4
        cmap4 = cmap_format_4(4); cmap4.platformID = 3; cmap4.platEncID = 1; cmap4.language = 0
        cmap4.cmap = {uv: g for g in glyph_names if (uv := AGL2UV.get(g)) is not None}
        cmap_table.tableVersion = 0; cmap_table.tables = [cmap4]
        font["cmap"] = cmap_table

        # Normalize the coordinate space to standard 1000 UPM so FreeType can
        # render the font at any size without crashing.  CFF fonts extracted from
        # PDFs often have a non-standard FontMatrix (e.g. display fonts like
        # "Fraunces72pt" use charstring coordinates up to 2754 instead of 1000),
        # which causes FT_Err_Cannot_Open_Resource at render sizes above ~35px.
        # scale_upem reads the CFF FontMatrix to determine the actual effective UPM
        # and rescales all charstring coordinates back to 1000 UPM.
        try:
            from fontTools.ttLib.scaleUpem import scale_upem
            scale_upem(font, upm)
        except Exception:
            pass

        buf = _io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        log.debug("CFF-to-OTF wrap failed for %s: %s", family, e)
        return None


# ---------------------------------------------------------------------------
# Type0/CIDFont cmap rebuild
# ---------------------------------------------------------------------------

def _parse_tounicode_cmap(cmap_bytes: bytes) -> dict[int, str]:
    """Parse a PDF ToUnicode CMap stream and return {char_code: unicode_string}.

    Only processes content inside beginbfchar/endbfchar and
    beginbfrange/endbfrange sections to avoid false matches in
    codespacerange or other CMap directives.
    """
    mapping: dict[int, str] = {}
    try:
        text = cmap_bytes.decode("latin-1", errors="replace")
        import re as _re

        # Extract only bfchar sections and parse <code> <unicode> pairs
        for section in _re.findall(
            r"beginbfchar(.*?)endbfchar", text, flags=_re.DOTALL
        ):
            for m in _re.finditer(
                r"<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>", section
            ):
                try:
                    code = int(m.group(1), 16)
                    ustr = bytes.fromhex(m.group(2)).decode("utf-16-be", errors="replace")
                    mapping[code] = ustr
                except Exception:
                    pass

        # Extract only bfrange sections and parse <start> <end> <unicode_start>
        for section in _re.findall(
            r"beginbfrange(.*?)endbfrange", text, flags=_re.DOTALL
        ):
            for m in _re.finditer(
                r"<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>",
                section,
            ):
                try:
                    start   = int(m.group(1), 16)
                    end     = int(m.group(2), 16)
                    u_start = int(m.group(3), 16)
                    for offset in range(end - start + 1):
                        cp = u_start + offset
                        if 0 < cp < 0x110000:
                            mapping[start + offset] = chr(cp)
                except Exception:
                    pass
    except Exception:
        pass
    return mapping


def _patch_type0_cmap(
    doc: "fitz.Document",
    font_xref: int,
    font_bytes: bytes,
    family: str,
) -> bytes | None:
    """Replace the cmap table in a Type0/CIDFont with one derived from the PDF's
    ToUnicode CMap.

    Type0 fonts embedded in PDFs use CID glyph ordering.  The extracted font
    bytes have a cmap that maps standard Unicode codepoints to glyph IDs, but
    those glyph IDs are NOT the ones used by the PDF — the PDF addresses glyphs
    via CIDs.  Only digits happen to land at the correct positions (ASCII 0x30–0x39).

    The ToUnicode CMap, stored in the PDF font dictionary, maps the character codes
    that appear in the PDF content stream to Unicode strings.  We use this to build
    a correct cmap so matplotlib can find the right glyph for every character.

    Returns patched font bytes, or None on failure.
    """
    try:
        import fitz as _fitz
        from fontTools.ttLib import TTFont
        from fontTools.ttLib.tables import _c_m_a_p
        import io as _io

        # ── 1. Read ToUnicode CMap from the PDF font dict ──────────────────
        try:
            keys = doc.xref_get_keys(font_xref)
        except Exception:
            keys = []

        tounicode_xref: int | None = None
        for key in keys:
            if key == "ToUnicode":
                try:
                    val = doc.xref_get_key(font_xref, "ToUnicode")
                    # val is like ("xref", "123 0 R") or ("stream", ...)
                    if isinstance(val, tuple) and val[0] in ("xref", "indirect"):
                        ref_str = val[1].strip()
                        tu_xref = int(ref_str.split()[0])
                        tounicode_xref = tu_xref
                except Exception:
                    pass
                break

        # Also detect Identity-H encoding: char code == Unicode code point.
        # When this is set, we can build an identity cmap even without ToUnicode.
        is_identity_h = False
        try:
            enc_val = doc.xref_get_key(font_xref, "Encoding")
            if isinstance(enc_val, tuple):
                raw = enc_val[1].strip() if len(enc_val) > 1 else ""
                is_identity_h = "Identity-H" in raw or raw == "/Identity-H"
        except Exception:
            pass

        cmap_mapping: dict[int, str] = {}
        if tounicode_xref is not None:
            try:
                stream = doc.xref_stream(tounicode_xref)
                if stream:
                    cmap_mapping = _parse_tounicode_cmap(stream)
            except Exception:
                pass

        if not cmap_mapping and not is_identity_h:
            # No ToUnicode and not Identity-H — nothing to do
            return None

        # ── 1b. Read CIDToGIDMap from the CIDFont's DescendantFonts dict ──
        # PDFs with non-Identity CIDToGIDMap have a remapping table that maps
        # CID values to TTF glyph indices.  Without this, using char_code as a
        # direct index into glyph_order yields wrong glyphs (e.g. 'Q' → 'I').
        # The map is a binary stream: GID at offset CID*2, uint16 big-endian.
        import struct as _struct
        cid_to_gid: dict[int, int] = {}  # CID → TTF glyph index
        try:
            desc_val = doc.xref_get_key(font_xref, "DescendantFonts")
            if isinstance(desc_val, tuple) and desc_val[1]:
                # parse "[473 0 R]" → xref 473
                import re as _re2
                m = _re2.search(r"(\d+)\s+0\s+R", desc_val[1])
                if m:
                    cid_font_xref = int(m.group(1))
                    ctg_val = doc.xref_get_key(cid_font_xref, "CIDToGIDMap")
                    if isinstance(ctg_val, tuple):
                        ctg_raw = ctg_val[1].strip() if len(ctg_val) > 1 else ""
                        if ctg_raw in ("/Identity", "Identity"):
                            pass  # CID == GID, no remapping needed
                        else:
                            # It's a stream reference — extract the xref
                            m2 = _re2.search(r"(\d+)\s+0\s+R", ctg_raw)
                            ctg_xref = int(m2.group(1)) if m2 else None
                            if ctg_xref is None and ctg_val[0] in ("xref", "indirect"):
                                ctg_xref = int(ctg_raw.split()[0])
                            if ctg_xref is not None:
                                ctg_stream = doc.xref_stream(ctg_xref)
                                if ctg_stream:
                                    n = len(ctg_stream) // 2
                                    for cid in range(n):
                                        gid = _struct.unpack_from(">H", ctg_stream, cid * 2)[0]
                                        if gid != 0:
                                            cid_to_gid[cid] = gid
        except Exception:
            pass

        # ── 2. Load the font and patch its cmap ───────────────────────────
        from fontTools.ttLib import newTable
        font = TTFont(_io.BytesIO(font_bytes))
        glyph_order = font.getGlyphOrder()

        # Read existing platform-3 cmap early so we can decide whether to
        # supplement it with a fallback baseline.
        cmap_table = font.get("cmap")
        if cmap_table is None:
            cmap_table = newTable("cmap")
            cmap_table.tableVersion = 0
            cmap_table.tables = []
            font["cmap"] = cmap_table

        existing_cmap: dict[int, str] = {}
        for t in cmap_table.tables:
            if t.platformID == 3 and t.platEncID == 1:
                existing_cmap.update(t.cmap)

        # CIDFont glyph order IS the CID index: glyph_order[cid] = glyph_name.
        # The extracted font often has no cmap at all (it was addressed by CID,
        # not Unicode).  Map each ToUnicode entry: char_code == CID index.
        new_cmap_dict: dict[int, str] = {}

        # For Identity-H fonts, add entries for any glyph whose name appears in
        # the Adobe Glyph List (AGL) — these map to their canonical Unicode code
        # points.  Do NOT use the GID position as a proxy for Unicode: many PDF
        # fonts place glyphs at non-Unicode CID positions (e.g. 'M' at GID 48).
        # AGL entries are safe for any font and match what the font's existing
        # cmap already contains, so the merge is harmless for well-mapped fonts.
        if is_identity_h:
            from fontTools.agl import AGL2UV
            for gname in glyph_order:
                if gname in AGL2UV:
                    uv = AGL2UV[gname]
                    if 0x20 <= uv <= 0xFFFF:
                        new_cmap_dict[uv] = gname
                elif gname.startswith('uni') and len(gname) == 7:
                    try:
                        uv = int(gname[3:], 16)
                        if 0x20 <= uv <= 0xFFFF:
                            new_cmap_dict[uv] = gname
                    except ValueError:
                        pass

        # Layer ToUnicode entries on top (override identity defaults with
        # explicit PDF-specified corrections, e.g. for ligatures or accents).
        # When a CIDToGIDMap is present, use it to map CID → TTF glyph index.
        # Otherwise assume CID == TTF index (Identity mapping).
        for char_code, ustr in cmap_mapping.items():
            if not ustr:
                continue
            # Resolve char_code (= CID) to TTF glyph index
            glyph_idx = cid_to_gid.get(char_code, char_code)
            if 0 <= glyph_idx < len(glyph_order):
                glyph = glyph_order[glyph_idx]
                for ch in ustr:
                    cp = ord(ch)
                    if 0x20 <= cp < 0x110000:
                        new_cmap_dict[cp] = glyph

        if not new_cmap_dict:
            return None

        # Remove old platform-3 tables (will be replaced with merged version)
        cmap_table.tables = [t for t in cmap_table.tables
                             if not (t.platformID == 3 and t.platEncID == 1)]

        # Merge: existing entries as base, new computed entries override.
        # ToUnicode entries are authoritative for the specific PDF and win over
        # the font's internal (potentially subset-mangled) cmap.
        merged = {**existing_cmap, **new_cmap_dict}

        fmt4 = _c_m_a_p.cmap_format_4(4)
        fmt4.platformID = 3; fmt4.platEncID = 1; fmt4.language = 0
        fmt4.cmap = merged
        cmap_table.tables.append(fmt4)

        buf = _io.BytesIO()
        font.save(buf)
        log.debug("Patched Type0 cmap for %s: %d codepoints", family, len(new_cmap_dict))
        return buf.getvalue()

    except Exception as e:
        log.debug("Type0 cmap patch failed for %s: %s", family, e)
        return None


# ---------------------------------------------------------------------------
# Name-table patching for PDF subset fonts
# ---------------------------------------------------------------------------

def _patch_font_names(font_bytes: bytes, family: str, weight: str, style: str) -> bytes:
    """Rewrite the name table of a TTF/OTF font to use *family* as the family name.

    PDF-embedded fonts carry a 6-letter subset prefix in their name table
    (e.g. "NWDKGX+BLKFort-Bold").  The "+" character is a fontconfig operator
    and makes matplotlib's font lookup throw a ValueError.  This function
    strips the prefix and writes back clean names so ``fontManager.addfont()``
    and subsequent ``findfont()`` calls work correctly.

    Returns the patched bytes.  On any failure returns the original bytes.
    """
    try:
        from fontTools.ttLib import TTFont
        import io as _io

        font = TTFont(_io.BytesIO(font_bytes))
        name_table = font.get("name")
        if name_table is None:
            return font_bytes

        _is_bold   = weight in ("bold", "semibold", "extra bold", "black")
        _is_italic = style in ("italic", "oblique")
        subfamily  = ("Bold Italic" if _is_bold and _is_italic
                      else "Italic" if _is_italic
                      else "Bold" if _is_bold
                      else "Regular")
        ps_name   = f"{family.replace(' ', '')}-{subfamily.replace(' ', '')}"
        full_name = f"{family} {subfamily}" if subfamily != "Regular" else family

        # Ids to rewrite: 1=Family, 2=Subfamily, 4=FullName, 6=PostScript, 16=Preferred family
        rewrites = {1: family, 2: subfamily, 4: full_name, 6: ps_name, 16: family}

        for rec in name_table.names:
            if rec.nameID in rewrites:
                new_str = rewrites[rec.nameID]
                if rec.isUnicode():
                    rec.string = new_str.encode("utf-16-be")
                else:
                    rec.string = new_str.encode("latin-1", errors="replace")

        buf = _io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        log.debug("Font name-table patch failed for %s: %s", family, e)
        return font_bytes


# ---------------------------------------------------------------------------
# Font subset merging
# ---------------------------------------------------------------------------

def _merge_font_subsets(
    result: dict[str, BridgeFont],
    tmp: Path,
    doc_hash: str,
) -> None:
    """Merge multiple subsets of the same font family into one TTF.

    PDF documents often embed several subsets of the same font (e.g. three
    AAAAAX+Inter-SemiBold chunks, each covering a different slice of the
    character set).  Without merging, whichever single subset we pick leaves
    holes for glyphs only present in the others.

    Strategy:
      - Group BridgeFonts by their stripped name (subset prefix removed).
      - For groups with >1 member that have a registered TTF path, load
        each with fontTools and copy SIMPLE non-empty glyphs that the base
        font is missing into the base font.
      - Re-save the merged font, re-register it with matplotlib.
      - Update every BridgeFont in the group to point at the merged path.
    """
    try:
        from fontTools.ttLib import TTFont as _TTFont
        import io as _io
        from matplotlib import font_manager as fm
    except Exception:
        return

    subset_re = re.compile(r"^[A-Z]{6}\+")
    # Group full names by stripped name
    groups: dict[str, list[str]] = {}
    for full_name, bf in result.items():
        if not bf.registered_path:
            continue
        stripped = subset_re.sub("", full_name)
        groups.setdefault(stripped, []).append(full_name)

    for stripped, full_names in groups.items():
        if len(full_names) <= 1:
            continue
        # Sort by nonempty_glyph_count descending; use best as base
        full_names_sorted = sorted(
            full_names,
            key=lambda n: result[n].nonempty_glyph_count,
            reverse=True,
        )
        base_bf = result[full_names_sorted[0]]
        try:
            base_tt = _TTFont(base_bf.registered_path, lazy=False)
        except Exception as exc:
            log.debug("merge: could not load base font %s: %s", base_bf.registered_path, exc)
            continue

        base_glyf = base_tt.get("glyf")
        base_hmtx = base_tt.get("hmtx")
        if not base_glyf or not base_hmtx:
            continue  # not a TTF with glyf table

        # Build current base cmap: unicode → glyph_name
        base_cmap_table = base_tt.get("cmap")
        if not base_cmap_table:
            continue
        base_cmap: dict[int, str] = {}
        for t in base_cmap_table.tables:
            if t.platformID == 3 and t.platEncID == 1:
                base_cmap.update(t.cmap)

        glyph_order: list[str] = list(base_tt.getGlyphOrder())
        added = 0

        for other_name in full_names_sorted[1:]:
            other_bf = result[other_name]
            try:
                other_tt = _TTFont(other_bf.registered_path, lazy=False)
            except Exception:
                continue
            other_glyf = other_tt.get("glyf")
            other_hmtx = other_tt.get("hmtx")
            if not other_glyf or not other_hmtx:
                continue
            other_cmap: dict[int, str] = {}
            for t in (other_tt.get("cmap") or _TTFont.__new__(_TTFont)).tables if other_tt.get("cmap") else []:
                if t.platformID == 3 and t.platEncID == 1:
                    other_cmap.update(t.cmap)
            for uv, gname in other_cmap.items():
                if uv in base_cmap:
                    continue  # already covered
                if uv < 0x20:
                    continue
                try:
                    g = other_glyf[gname]
                    # Only copy simple non-empty glyphs (not composite, not empty)
                    nc = getattr(g, "numberOfContours", 0) or 0
                    if nc <= 0:
                        continue
                    new_gname = f"__mg_{uv:04x}"
                    if new_gname in base_glyf:
                        continue
                    base_glyf[new_gname] = g
                    if gname in other_hmtx.metrics:
                        base_hmtx.metrics[new_gname] = other_hmtx.metrics[gname]
                    base_cmap[uv] = new_gname
                    glyph_order.append(new_gname)
                    added += 1
                except Exception:
                    pass

        if added == 0:
            continue

        base_tt.setGlyphOrder(glyph_order)
        # Rebuild the platform-3 cmap table
        for t in base_cmap_table.tables:
            if t.platformID == 3 and t.platEncID == 1:
                t.cmap = base_cmap
                break

        try:
            buf = _io.BytesIO()
            base_tt.save(buf)
            merged_bytes = buf.getvalue()
        except Exception as exc:
            log.debug("merge: save failed for %s: %s", stripped, exc)
            continue

        safe_stripped = re.sub(r"[^A-Za-z0-9_-]", "_", stripped)
        merged_path = tmp / f"{doc_hash}_merged_{safe_stripped}.ttf"
        merged_path.write_bytes(merged_bytes)
        merged_path_str = str(merged_path)
        if merged_path_str not in _registered_font_files:
            fm.fontManager.addfont(merged_path_str)
            _registered_font_files.add(merged_path_str)

        for fn in full_names:
            result[fn].registered_path = merged_path_str
            result[fn].nonempty_glyph_count = len(base_cmap)

        log.debug(
            "Merged %d glyphs into %s (%d subsets → %d total cmap entries)",
            added, stripped, len(full_names), len(base_cmap),
        )


# ---------------------------------------------------------------------------
# System font supplementation
# ---------------------------------------------------------------------------

def _supplement_system_fonts(
    result: dict[str, BridgeFont],
    tmp: Path,
    doc_hash: str,
) -> None:
    """For registered system fonts with incomplete cmap, supplement from system.

    When a registered TTF subset is missing common printable glyphs, copying
    them from a matching system font avoids placeholder boxes in the render
    output.  Only applied to font families known to have system equivalents.
    Shapes are scaled if the system font has a different units-per-em.
    """
    try:
        from fontTools.ttLib import TTFont as _TTFont
        import io as _io
        from matplotlib import font_manager as fm
    except Exception:
        return

    seen_paths: set[str] = set()
    for bf in result.values():
        if not bf.registered_path:
            continue
        if bf.registered_path in seen_paths:
            continue
        seen_paths.add(bf.registered_path)

        try:
            base_tt = _TTFont(bf.registered_path, lazy=False)
        except Exception:
            continue

        base_glyf = base_tt.get("glyf")
        base_hmtx = base_tt.get("hmtx")
        if not base_glyf or not base_hmtx:
            continue

        base_cmap_table = base_tt.get("cmap")
        if not base_cmap_table:
            continue
        base_cmap: dict[int, str] = {}
        for t in base_cmap_table.tables:
            if t.platformID == 3 and t.platEncID == 1:
                base_cmap.update(t.cmap)

        # Supplement ASCII plus common typographic characters that PDF subsets
        # frequently omit (curly quotes, dashes, ellipsis, currency symbols,
        # Latin-1 supplement).  Missing non-ASCII glyphs cause FreeType
        # segfaults when the font's .notdef handling is non-standard.
        _SUPPLEMENT_CODEPOINTS = (
            list(range(0x20, 0x7F))   # printable ASCII
            + list(range(0xA0, 0x100)) # Latin-1 Supplement
            + [
                0x2013, 0x2014,         # en dash, em dash
                0x2018, 0x2019,         # left/right single quotation marks
                0x201C, 0x201D,         # left/right double quotation marks
                0x2020, 0x2021,         # dagger, double dagger
                0x2022,                 # bullet
                0x2026,                 # horizontal ellipsis
                0x2032, 0x2033,         # prime, double prime
                0x2039, 0x203A,         # single angle quotation marks
                0x20AC,                 # euro sign
                0x2122,                 # trade mark sign
                0x2212,                 # minus sign
                0x2202, 0x2211, 0x221A, # partial, summation, radical
                0x2260, 0x2264, 0x2265, # not-equal, <=, >=
                0x25A0, 0x25CF,         # filled square, filled circle
                0xFB01, 0xFB02,         # fi, fl ligatures
            ]
        )
        missing = [uv for uv in _SUPPLEMENT_CODEPOINTS if uv not in base_cmap]

        # Also replace glyphs that ARE in the cmap but have zero advance width
        # or zero/empty contours — these are placeholder/empty glyphs from
        # CIDFont subsets where the ToUnicode CMap listed all codepoints but
        # the actual font only contains a few glyph shapes.
        _empty_glyphs: set[int] = set()
        for uv in _SUPPLEMENT_CODEPOINTS:
            if uv in base_cmap:
                gname = base_cmap[uv]
                try:
                    g = base_glyf.get(gname)
                    nc = getattr(g, "numberOfContours", None)
                    # nc==0 means zero contours (blank glyph), nc==-1 means composite (has sub-glyphs)
                    # Blank glyphs often have non-zero advance width but no visible shape
                    if g is None or (nc is not None and nc == 0 and uv != 0x20):
                        _empty_glyphs.add(uv)
                except Exception:
                    pass
        to_replace = _empty_glyphs
        to_supplement = [uv for uv in _SUPPLEMENT_CODEPOINTS if uv not in base_cmap]
        all_to_fix = list(set(to_supplement) | to_replace)

        if not all_to_fix:
            continue

        # Find a real system font (not our extracted font) to supplement from.
        # Try a priority list of fallback families; pick the first that isn't in
        # our temp directory (i.e. not one of our extracted fonts).
        import logging as _log_mod
        _fm_log = _log_mod.getLogger("matplotlib.font_manager")
        _prev = _fm_log.level
        _fm_log.setLevel(_log_mod.ERROR)
        tmp_str = str(tmp)
        sys_path = None
        for _try_family in (bf.family, "Arial", "Helvetica", "sans-serif"):
            _prop = fm.FontProperties(family=_try_family, weight="normal", style="normal")
            try:
                _cand = fm.findfont(_prop, fallback_to_default=True)
                if _cand and tmp_str not in _cand:
                    sys_path = _cand
                    break
            except Exception:
                pass
        _fm_log.setLevel(_prev)

        if not sys_path:
            continue
        try:
            sys_tt = _TTFont(sys_path, lazy=False)
        except Exception:
            continue

        sys_cmap = (sys_tt.get("cmap").getBestCmap() or {}) if sys_tt.get("cmap") else {}
        sys_glyf = sys_tt.get("glyf")
        sys_hmtx = sys_tt.get("hmtx")
        if not sys_glyf or not sys_hmtx:
            continue

        # Scale factor if UPM differs
        base_upm = base_tt.get("head").unitsPerEm if base_tt.get("head") else 2048
        sys_upm = sys_tt.get("head").unitsPerEm if sys_tt.get("head") else 2048
        scale = base_upm / sys_upm if sys_upm else 1.0

        glyph_order = list(base_tt.getGlyphOrder())
        added = 0
        for uv in all_to_fix:
            if uv not in sys_cmap:
                continue
            sys_gname = sys_cmap[uv]
            try:
                g = sys_glyf[sys_gname]
                nc = getattr(g, "numberOfContours", 0) or 0
                if nc <= 0:
                    continue
                new_gname = f"__sys_{uv:04x}"
                if new_gname in base_glyf:
                    continue
                if scale != 1.0:
                    import copy
                    g = copy.deepcopy(g)
                    if hasattr(g, "coordinates") and g.coordinates:
                        g.coordinates = type(g.coordinates)(
                            [(int(x * scale), int(y * scale)) for x, y in g.coordinates]
                        )
                base_glyf[new_gname] = g
                adv, lsb = sys_hmtx.metrics.get(sys_gname, (0, 0))
                base_hmtx.metrics[new_gname] = (int(adv * scale), int(lsb * scale))
                base_cmap[uv] = new_gname
                glyph_order.append(new_gname)
                added += 1
            except Exception:
                pass

        if added == 0:
            continue

        base_tt.setGlyphOrder(glyph_order)
        for t in base_cmap_table.tables:
            if t.platformID == 3 and t.platEncID == 1:
                t.cmap = base_cmap
                break

        try:
            buf_io = _io.BytesIO()
            base_tt.save(buf_io)
            supp_bytes = buf_io.getvalue()
        except Exception as exc:
            log.debug("supplement: save failed for %s: %s", bf.family, exc)
            continue

        # Use the original filename stem for uniqueness — each subset gets its own
        # supplemented file so that overwriting doesn't clobber ToUnicode-patched cmaps
        # from other subsets of the same family with different glyph assignments.
        original_rpath = bf.registered_path
        orig_stem = re.sub(r"[^A-Za-z0-9_-]", "_", Path(original_rpath).stem)
        supp_path = tmp / f"{doc_hash}_supp_{orig_stem}.ttf"
        supp_path.write_bytes(supp_bytes)
        supp_path_str = str(supp_path)
        if supp_path_str not in _registered_font_files:
            fm.fontManager.addfont(supp_path_str)
            _registered_font_files.add(supp_path_str)
        for bf2 in result.values():
            if bf2.registered_path == original_rpath:
                bf2.registered_path = supp_path_str
                bf2.nonempty_glyph_count = len(base_cmap)

        log.debug(
            "Supplemented %s with %d system glyphs (%d total cmap)",
            bf.family, added, len(base_cmap),
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_and_register(doc: fitz.Document) -> dict[str, BridgeFont]:
    """Extract embedded fonts from *doc* and register them with matplotlib.

    Returns a dict mapping each PDF font name found in the document to a
    :class:`~percy.bridge.elements.BridgeFont`.  Fonts that could not be
    extracted (e.g. Type1 without embedded data) fall back to a best-effort
    BridgeFont derived purely from the font name string.

    Results are cached by PDF font name — subsequent calls for the same names
    are instant.
    """
    import hashlib
    from matplotlib import font_manager as fm

    result: dict[str, BridgeFont] = {}
    tmp = _get_tmp_dir()

    # A short hash of the doc path makes font filenames unique per PDF.
    # XRef integers are per-document and different PDFs reuse the same numbers,
    # so we must NOT key the file cache on bare xref ints.
    doc_hash = hashlib.md5(str(getattr(doc, "name", "") or "").encode()).hexdigest()[:8]

    with _lock:
        seen_xrefs: set[int] = set()
        # Per-call name cache: tracks pdf_name → BridgeFont within this doc only.
        # We deliberately do NOT use the global _pdf_name_to_font as a short-circuit
        # here: different PDFs can have fonts with the same name but different glyph
        # subsets, and reusing a previous PDF's font causes tofu in the current PDF.
        local_name_cache: dict[str, BridgeFont] = {}

        for page_num in range(len(doc)):
            for font_info in doc.get_page_fonts(page_num, full=True):
                xref = font_info[0]
                pdf_name = font_info[3] or font_info[4] or ""
                if not pdf_name:
                    continue

                if pdf_name in local_name_cache:
                    result[pdf_name] = local_name_cache[pdf_name]
                    continue

                family_guess, weight, style = _parse_pdf_font_name(pdf_name)

                actual_family: str | None = None
                font_format: str = ""
                registered_path: str = ""

                suspect_mapping = False  # True when Type0 cmap patch couldn't be applied
                if xref > 0 and xref not in seen_xrefs:
                    seen_xrefs.add(xref)
                    font_type = font_info[2] if len(font_info) > 2 else ""
                    try:
                        font_data = doc.extract_font(xref)
                        ext = (font_data[1] or "").lower()
                        buf = font_data[3]
                        # Type0 (CIDFont) bytes use CID glyph IDs, not Unicode.
                        # The raw extracted font has a broken cmap: only digits
                        # render because they happen to sit at their ASCII positions.
                        # Rebuild the font's cmap using the PDF's ToUnicode CMap,
                        # which provides the authoritative char-code→Unicode mapping.
                        # Apply to TTF/empty-ext Type0 fonts before any other processing.
                        if buf and font_type == "Type0" and ext in ("ttf", ""):
                            patched = _patch_type0_cmap(doc, xref, buf, family_guess)
                            if patched is None:
                                suspect_mapping = True  # no ToUnicode CMap → glyph order may be wrong
                            else:
                                buf = patched
                        if buf:
                            if ext == "cff":
                                # Raw CFF (Compact Font Format) — not directly usable by
                                # FreeType/matplotlib without an SFNT container.  Wrap it
                                # into a proper OTF so addfont() succeeds.
                                wrapped = _wrap_cff_to_otf(buf, family_guess, weight, style)
                                if wrapped:
                                    buf = wrapped
                                    ext = "otf"
                                    # CFF Type0 fonts also need cmap rebuilt from ToUnicode.
                                    if font_type == "Type0":
                                        buf = _patch_type0_cmap(doc, xref, buf, family_guess) or buf
                                else:
                                    buf = None
                            elif ext not in ("ttf", "otf", "truetype", "opentype", ""):
                                buf = None  # unknown binary format — skip
                            if buf:
                                if not ext or ext not in ("ttf", "otf"):
                                    ext = "ttf"
                                # Patch the font's name table to use the clean
                                # family name (no subset prefix, no "+").
                                # PDF subsets embed names like "NWDKGX+BLKFort-Bold"
                                # which contain "+" — a fontconfig operator that
                                # breaks matplotlib's findfont() lookup.
                                buf = _patch_font_names(buf, family_guess, weight, style)
                                # Strip TrueType hint tables (fpgm, prep, cvt) from all
                                # PDF-extracted fonts. These programs were authored for the
                                # FULL font; when the PDF embeds a subset (1000+ empty CID
                                # glyphs) the hint program references indices that no longer
                                # have valid data, causing FreeType to segfault at render
                                # time — even for ASCII text at large sizes. Unhinted
                                # rendering at 150 DPI is visually indistinguishable.
                                if buf:
                                    try:
                                        from fontTools.ttLib import TTFont as _TT_strip
                                        import io as _io_strip
                                        _strip_tt = _TT_strip(_io_strip.BytesIO(buf), lazy=False)
                                        _stripped = False
                                        for _hint_tbl in ("fpgm", "prep", "cvt "):
                                            if _hint_tbl in _strip_tt:
                                                del _strip_tt[_hint_tbl]
                                                _stripped = True
                                        if _stripped:
                                            _buf_out = _io_strip.BytesIO()
                                            _strip_tt.save(_buf_out)
                                            buf = _buf_out.getvalue()
                                    except Exception:
                                        pass
                                # Subset extracted font to only cmap-referenced glyphs +
                                # .notdef. CIDFont-derived TTFs often carry 1000+ mostly-
                                # empty glyphs from the original CID glyph table. FreeType
                                # can segfault walking loca/glyf for these entries, even if
                                # they are never requested during rendering.
                                if buf:
                                    try:
                                        from fontTools.ttLib import TTFont as _TT_sub
                                        import io as _io_sub
                                        _sub_tt = _TT_sub(_io_sub.BytesIO(buf), lazy=False)
                                        _total = len(_sub_tt.getGlyphOrder())
                                        _sub_cmap_o = _sub_tt.get("cmap")
                                        _sub_uv = list(
                                            (_sub_cmap_o.getBestCmap() or {}).keys()
                                        ) if _sub_cmap_o else []
                                        if _total > len(_sub_uv) + 50 and _sub_uv:
                                            from fontTools.subset import (
                                                Subsetter as _SS, Options as _SubOpts,
                                            )
                                            _sopts = _SubOpts()
                                            _sopts.layout_features = []
                                            _sopts.notdef_outline = True
                                            _sopts.recalc_bounds = False
                                            _sopts.recalc_timestamp = False
                                            _sopts.prune_unicode_ranges = False
                                            _ss = _SS(options=_sopts)
                                            _ss.populate(unicodes=_sub_uv)
                                            _ss.subset(_sub_tt)
                                            _sub_out = _io_sub.BytesIO()
                                            _sub_tt.save(_sub_out)
                                            buf = _sub_out.getvalue()
                                            log.debug(
                                                "Subsetted %s: %d → %d glyphs",
                                                family_guess, _total,
                                                len(_sub_tt.getGlyphOrder()),
                                            )
                                            # Subsetter removes the name table;
                                            # re-apply the family name so matplotlib
                                            # can look the font up by name.
                                            buf = _patch_font_names(
                                                buf, family_guess, weight, style
                                            )
                                    except Exception:
                                        pass
                                # Skip any font whose cmap coverage of printable ASCII
                                # is very sparse (< 20 unique codepoints in 0x20–0x7E).
                                # Sparse PDF subset fonts often have structurally broken
                                # glyph tables (1000+ empty glyphs from a CIDFont) that
                                # cause FreeType segfaults when rendering missing glyphs.
                                # The renderer falls back to a system font by family name,
                                # which is safer and often produces better output anyway.
                                if buf:
                                    try:
                                        from fontTools.ttLib import TTFont as _TT_chk
                                        import io as _io_chk
                                        _chk = _TT_chk(_io_chk.BytesIO(buf), lazy=True)
                                        _bc = (_chk.get("cmap").getBestCmap() or {}) if _chk.get("cmap") else {}
                                        _cov = sum(1 for uv in _bc if 0x20 <= uv <= 0x7E)
                                        if _cov < 20:
                                            log.debug("Skip sparse font %s cov=%d", family_guess, _cov)
                                            buf = None
                                    except Exception:
                                        pass
                                if buf:
                                    # Include doc_hash in filename so fonts from different
                                    # PDFs never overwrite each other in the tmp dir.
                                    font_path = tmp / f"{doc_hash}_xref{xref}_{family_guess}.{ext}"
                                    font_path_str = str(font_path)
                                    font_path.write_bytes(buf)
                                    if font_path_str not in _registered_font_files:
                                        fm.fontManager.addfont(font_path_str)
                                        _registered_font_files.add(font_path_str)
                                    # Use the parsed family name directly — we patched
                                    # the name table, so matplotlib will register it
                                    # under family_guess.
                                    actual_family = family_guess
                                    font_format = ext
                                    registered_path = font_path_str
                                    log.debug("Registered font: %s → %s", pdf_name, actual_family)
                    except Exception as e:
                        log.debug("Could not extract font xref=%d (%s): %s", xref, pdf_name, e)

                # Count non-empty glyphs for subset selection quality metric
                nonempty_count = 0
                if registered_path:
                    try:
                        from fontTools.ttLib import TTFont as _TTFont
                        _ft = _TTFont(registered_path, lazy=True)
                        _glyf = _ft.get("glyf")
                        if _glyf:
                            for _gn in _ft.getGlyphOrder():
                                try:
                                    g = _glyf[_gn]
                                    if hasattr(g, "numberOfContours") and (g.numberOfContours or 0) > 0:
                                        nonempty_count += 1
                                except Exception:
                                    pass
                    except Exception:
                        pass

                bridge_font = BridgeFont(
                    source_name=pdf_name,
                    family=actual_family or family_guess,
                    weight=weight,
                    style=style,
                    font_format=font_format,
                    registered_path=registered_path,
                    nonempty_glyph_count=nonempty_count,
                    suspect_glyph_mapping=suspect_mapping,
                )
                local_name_cache[pdf_name] = bridge_font
                _pdf_name_to_font[pdf_name] = bridge_font
                result[pdf_name] = bridge_font

    # Merge multiple subsets of same font for complete character coverage
    _merge_font_subsets(result, tmp, doc_hash)
    # Supplement registered system fonts with missing glyphs from system fonts
    _supplement_system_fonts(result, tmp, doc_hash)

    return result


def lookup(pdf_font_name: str) -> BridgeFont | None:
    """Look up a previously registered font by its PDF name."""
    return _pdf_name_to_font.get(pdf_font_name)


def name_to_font(pdf_font_name: str) -> BridgeFont:
    """Return a BridgeFont for *pdf_font_name*, using cache or pure name-parse."""
    cached = _pdf_name_to_font.get(pdf_font_name)
    if cached:
        return cached
    family, weight, style = _parse_pdf_font_name(pdf_font_name)
    return BridgeFont(source_name=pdf_font_name, family=family, weight=weight, style=style)
