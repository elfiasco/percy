"""PNG renderer for BridgeElements using matplotlib.

Renders individual elements, full slides, or complete PercyDocuments to PNG.
Primary use case: visual debugging of roundtrip fidelity.

Workflow::

    from percy.diagnostics.onboard import onboard_pptx
    from percy.diagnostics.render_png import render_document, compare_with_original

    doc = onboard_pptx("deck.pptx")

    # Option A: render every Bridge slide to PNG
    paths = render_document(doc, "debug/bridge/")

    # Option B: side-by-side comparison against the original PPTX
    compare_with_original(doc, "deck.pptx", "debug/compare/")
    # → debug/compare/slide-001.png  (Bridge | PowerPoint)

    # Option C: render a single element in isolation
    from percy.diagnostics.render_png import render_element
    fig = render_element(my_chart)
    fig.savefig("chart.png", dpi=150, bbox_inches="tight")

Coordinate system
-----------------
All positions are in inches, matching BridgeElement.position fields.
The slide canvas has (0, 0) at the top-left — identical to PowerPoint.
matplotlib's y-axis is inverted (ylim = (slide_height, 0)) so larger y → lower
on screen, exactly as in PowerPoint.
"""

from __future__ import annotations

import functools
import io
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")  # headless — no GUI window needed
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.path import Path as MplPath
from matplotlib.patches import PathPatch, FancyBboxPatch, FancyArrow

from percy.bridge.elements import (
    BridgeChart,
    BridgeConnector,
    BridgeElement,
    BridgeFreeform,
    BridgeGroup,
    BridgeImage,
    BridgeShape,
    BridgeSlide,
    BridgeTable,
    BridgeText,
    PercyDocument,
)

# ---------------------------------------------------------------------------
# Theme colour fallbacks (used when element colour is "scheme:ACCENT_1" etc.)
# ---------------------------------------------------------------------------

# Default Office-2016 theme colours; overridden per-document by SlideRenderer.
_THEME: dict[str, str] = {
    "ACCENT_1":    "#4472C4",
    "ACCENT_2":    "#ED7D31",
    "ACCENT_3":    "#A9D18E",
    "ACCENT_4":    "#FFC000",
    "ACCENT_5":    "#5B9BD5",
    "ACCENT_6":    "#70AD47",
    "DARK_1":      "#000000",
    "DARK_2":      "#44546A",
    "LIGHT_1":     "#FFFFFF",
    "LIGHT_2":     "#E7E6E6",
    "BACKGROUND_1":"#FFFFFF",   # legacy key, prefer LIGHT_1
    "BACKGROUND_2":"#E7E6E6",   # legacy key, prefer LIGHT_2
    "TEXT_1":      "#000000",   # legacy key, prefer DARK_1
    "TEXT_2":      "#44546A",   # legacy key, prefer DARK_2
    "HYPERLINK":   "#0563C1",
    "FOLLOWED_HYPERLINK": "#954F72",
}

# Normalises raw OOXML scheme names (e.g. "accent1", "dk1") to _THEME keys.
_XML_TO_THEME_KEY: dict[str, str] = {
    "dk1": "DARK_1",    "dk2": "DARK_2",
    "lt1": "LIGHT_1",   "lt2": "LIGHT_2",
    # bg1/bg2 = lt1/lt2 aliases; tx1/tx2 = dk1/dk2 aliases in OOXML
    "bg1": "LIGHT_1",   "bg2": "LIGHT_2",
    "tx1": "DARK_1",    "tx2": "DARK_2",
    "accent1": "ACCENT_1", "accent2": "ACCENT_2",
    "accent3": "ACCENT_3", "accent4": "ACCENT_4",
    "accent5": "ACCENT_5", "accent6": "ACCENT_6",
    "hlink": "HYPERLINK", "folHlink": "FOLLOWED_HYPERLINK",
}

_CHART_DEFAULTS = [
    "#4472C4","#ED7D31","#A9D18E","#FFC000",
    "#5B9BD5","#70AD47","#FF0000","#7030A0",
]

# Tableau's default "Tableau 10" color palette
_TABLEAU_COLORS = [
    "#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F",
    "#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC",
]

# ---------------------------------------------------------------------------
# Font substitution — map corporate/PDF font names to matplotlib generic families
# ---------------------------------------------------------------------------

_FONT_FAMILY_MAP: dict[str, str] = {
    # Sans-serif — prefer actual system font names so matplotlib gets accurate metrics.
    # On Windows these are installed; on other platforms matplotlib falls back gracefully.
    "montserrat":          "Century Gothic",   # geometric sans; Century Gothic is the closest Windows match
    "helveticaneue":       "Arial",        # Helvetica Neue not on Windows; Arial has near-identical metrics
    "helvetica":           "Arial",        # same reasoning
    "arialmт":             "Arial",
    "arial":               "Arial",
    "arialmt":             "Arial",
    "calibri":             "Calibri",
    "roboto":              "Roboto",
    "opensans":            "sans-serif",
    "lato":                "sans-serif",
    "nunito":              "sans-serif",
    "sourcesanspro":       "sans-serif",
    "sourcesans3":         "sans-serif",
    "worksans":            "sans-serif",
    "ptsans":              "sans-serif",
    "arialnova":           "Arial",            # Arial Nova not installed; standard Arial is close
    "myriadpro":           "sans-serif",
    "franklingothic":      "Franklin Gothic Medium",   # available on Windows; much closer metrics than sans-serif
    "gillsans":            "Gill Sans MT",     # available on Windows
    "sfpro":               "sans-serif",
    "sfprodisplay":        "sans-serif",
    "sfprotext":           "sans-serif",
    "brandon":             "sans-serif",
    "avenir":              "sans-serif",
    "archivo":             "sans-serif",
    "archivo-bold":        "sans-serif",
    "blkfort":             "Gill Sans MT",     # BlackRock proprietary humanist sans; Gill Sans MT is the closest on Windows
    "blkfortbook":         "Gill Sans MT",
    "blkfortextrabold":    "Gill Sans MT",
    # Corporate / brand fonts — mapped to closest Windows-native equivalent
    "lyftpro":             "Gill Sans MT",     # Lyft brand font: humanist sans, Gill Sans MT is closest on Windows
    "attalecksans":        "Gill Sans MT",     # AT&T brand font: humanist sans
    "attaleck":            "Gill Sans MT",
    "salesforcesans":      "Calibri",          # Salesforce brand sans; Calibri has similar proportions
    "bpsans":              "Calibri",          # BNP Paribas brand sans; Calibri is close
    "bpsanstf":            "Calibri",
    "bans":                "Calibri",          # mangled key: bpSans* after normalizer strips "ps"
    "wellsfargosans":      "Calibri",          # Wells Fargo brand sans
    "teleneo":             "Segoe UI",         # Deutsche Telekom brand sans; Segoe UI is close
    "teleicon":            "Segoe UI",
    "calibre":             "Calibri",          # Klim's Calibre: clean geometric sans, Calibri is very close
    "citisans":            "Calibri",          # Citigroup brand sans
    "emprint":             "Calibri",          # HP brand sans; Calibri has similar proportions
    "itcavantgarde":       "Century Gothic",   # ITC Avant Garde: geometric sans, Century Gothic is closest
    "avantgarde":          "Century Gothic",
    "barlow":              "sans-serif",
    "everydaysans":        "sans-serif",       # IBM brand font variant
    "centra":              "Calibri",          # Centra No. 2: clean geometric, Calibri is close
    "fedexsans":           "Calibri",          # FedEx brand sans
    "ericssonhilda":       "Segoe UI",         # Ericsson brand font
    "gpcommerce":          "sans-serif",       # Goldman Sachs custom font
    "siemenssans":         "Calibri",          # Siemens brand sans; Calibri has similar humanist proportions
    "siemens":             "Calibri",
    "aptos":               "Calibri",          # Microsoft Office 2024 default font (Calibri successor)
    "fraunces":            "Georgia",          # Fraunces: optical serif, Georgia is closest on Windows; matches "fraunces72pt" via substring
    "plusjakartadisplay":  "sans-serif",
    "proximanova":         "Calibri",          # ProximaNova: humanist geometric sans; Calibri has closest metrics on Windows
    "proxima":             "Calibri",
    "bentonsans":          "Gill Sans MT",     # BentonSans: humanist sans (AmexGBT brand font)
    "benton":              "Gill Sans MT",
    "univers":             "Arial",            # Univers: grotesque sans (Frutiger); Arial has very similar metrics
    "dejavusans":          "DejaVu Sans",      # DejaVu Sans embedded in PDFs: use exact same font for perfect metrics
    # Deutsche Telekom subset-embedded fonts with scrambled names (TeleNeo family)
    "hbrfpr":              "Segoe UI",
    "qfrhfc":              "Segoe UI",
    "bfhcpd":              "Segoe UI",
    "brfbdr":              "Segoe UI",
    "cqbqhq":              "Segoe UI",
    # Geometric sans-serifs — Century Gothic is the closest Windows-native match
    # for Futura/Gotham/AllianceNo.2 (all share geometric proportions).
    "allianceno":          "Century Gothic",   # Palantir brand font
    "alliance":            "Century Gothic",
    "futura":              "Century Gothic",   # better than generic sans-serif
    "gotham":              "Century Gothic",   # condensed-ish geometric; CG is closest
    "foundersgrotesk":     "Century Gothic",
    "centurygothic":       "Century Gothic",
    "circularstd":         "Century Gothic",   # CircularSTD is a geometric sans; Century Gothic is closest on Windows
    "circular":            "Century Gothic",   # MCircularTT (3M brand), CircularBook, etc. — all geometric sans
    "dmsans":              "sans-serif",
    "plusjakartasans":     "sans-serif",
    "poppins":             "Century Gothic",   # Poppins: geometric sans; Century Gothic has closest advance widths
    "dsindigo":            "Calibri",          # DocuSign brand sans; humanist, Calibri is closest
    "raleway":             "sans-serif",
    "oswald":              "sans-serif",
    "publicsans":          "sans-serif",
    "manrope":             "sans-serif",
    "outfit":              "sans-serif",
    "sora":                "sans-serif",
    "titilliumweb":        "sans-serif",
    "urbanist":            "sans-serif",
    "segoeui":             "Segoe UI",
    "inter":               "Segoe UI",         # Inter: screen-optimized humanist; Segoe UI has near-identical metrics
    "tahoma":              "Tahoma",
    "verdana":             "Verdana",
    # Condensed/narrow Arial variants — must appear before plain "arial" for specificity
    "arialnarrow":         "Arial Narrow",     # ArialNarrow is condensed; Arial Narrow is installed on Windows
    "arialnovacond":       "Arial Narrow",     # ArialNovaCond is condensed version of ArialNova
    # Serif — actual names for better metric matching on Windows/macOS
    "georgia":             "Georgia",
    "timesnewroman":       "Times New Roman",
    "timesnewromanps":     "Times New Roman",
    "times":               "Times New Roman",
    "garamond":            "serif",
    "palatino":            "Palatino",
    "bookman":             "serif",
    "merriweather":        "serif",
    "sourceserifpro":      "serif",
    "ptserif":             "serif",
    # Monospace
    "couriernew":          "Courier New",
    "courier":             "Courier New",
    "consolas":            "Consolas",
    "inconsolata":         "monospace",
    "jetbrainsmono":       "monospace",
    "sourcecodepo":        "monospace",
    "firacode":            "monospace",
}

# Pre-sorted by key length descending so longer/more-specific entries match first.
_FONT_FAMILY_MAP_BY_LEN = sorted(_FONT_FAMILY_MAP.items(), key=lambda kv: len(kv[0]), reverse=True)

_BOLD_WEIGHT_WORDS = frozenset({"bold", "black", "heavy", "extrabold", "demibold", "semibold"})

# Normalised family names for which the system-installed version should be
# preferred over a CIDFont-derived PDF extract.  Extracted versions can have
# wrong CID→Unicode glyph mappings (e.g. 'S' renders as 'r').
_SYSTEM_FONT_FAMILIES_LOWER: frozenset[str] = frozenset({
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
    "segoeui", "segoe",
})


def _is_system_font_family(family: str) -> bool:
    """Return True if *family* names a standard OS font that ships pre-installed."""
    key = re.sub(r"[^a-z]", "", family.lower())
    return key in _SYSTEM_FONT_FAMILIES_LOWER


def _font_name_implies_bold(font_name: str | None) -> bool:
    """Return True when the font face name encodes a bold weight variant."""
    if not font_name:
        return False
    lower = font_name.lower().replace("-", " ").replace("_", " ")
    # Check both space-split words and substring (handles "GothamBold" with no space)
    parts = set(lower.split())
    if parts & _BOLD_WEIGHT_WORDS:
        return True
    return any(w in lower for w in _BOLD_WEIGHT_WORDS)


def _normalize_font_family(font_name: str | None) -> str:
    """Map a PDF/PPTX font name to a matplotlib-available generic family.

    Two-pass strategy so specific entries (e.g. 'arialnarrow') beat generic
    ones (e.g. 'arial') even when the suffix-stripped key collapses both:
      Pass 1 — raw key (spaces/hyphens stripped, no suffix removal): longest
               matching map key wins, preserving 'narrow'/'cond' distinctions.
      Pass 2 — suffix-stripped key: catches remaining fonts after weight/style
               words are removed (e.g. 'CalibriBold' → 'calibri').
    """
    if not font_name:
        return "sans-serif"
    key_raw = font_name.lower().replace(" ", "").replace("-", "").replace("_", "")
    # Pass 1: raw key, longest map entry wins (most specific match first).
    # Only match family_key as substring of key_raw (not reverse) to avoid
    # "arial" matching "arialnarrow" via the inverse direction.
    for family_key, generic in _FONT_FAMILY_MAP_BY_LEN:
        if len(family_key) >= 4 and family_key in key_raw:
            return generic
    # Pass 2: strip weight/style suffixes then look up again
    key = key_raw
    for suffix in ("bold", "italic", "oblique", "regular", "light", "medium",
                   "semibold", "extrabold", "black", "thin", "book", "mt",
                   "ps", "roman", "narrow", "condensed", "expanded"):
        key = key.replace(suffix, "")
    for family_key, generic in _FONT_FAMILY_MAP_BY_LEN:
        if len(family_key) >= 3 and (family_key in key or (len(key) >= 4 and key in family_key)):
            return generic
    return font_name  # keep original; matplotlib will fall back gracefully


_ICON_FONT_KEYWORDS = frozenset({
    "wingdings", "webdings", "symbol", "marlett", "zapf dingbats",
    "dingbats", "glyph", "picto", "awesome", "material icons",
    "feather", "ionicons", "remixicon", "boxicons", "tabler", "heroicons",
    "iconfont", "iconset", "icon-",
})

# Keywords that must appear as whole words (surrounded by non-alpha chars)
_ICON_FONT_WORD_KEYWORDS = frozenset({"icon", "icons"})


def _is_icon_font(font_name: str | None) -> bool:
    if not font_name:
        return False
    lower = font_name.lower()
    if any(kw in lower for kw in _ICON_FONT_KEYWORDS):
        return True
    import re as _re
    return any(_re.search(r"(?<![a-z])" + kw + r"(?![a-z])", lower)
               for kw in _ICON_FONT_WORD_KEYWORDS)


# Characters that many fonts lack but matplotlib would warn/fallback on.
# Map them to visually equivalent ASCII/near-ASCII alternatives.
_CHAR_SUBSTITUTIONS: dict[int, str] = {
    0x2011: "-",   # non-breaking hyphen
    0x2012: "-",   # figure dash
    0x2013: chr(0x2013),  # en-dash pass through
    0x2014: chr(0x2014),  # em-dash pass through
    0x00AD: "",    # soft hyphen
    0x00A0: " ",   # non-breaking space
    0x202F: " ",   # narrow no-break space
    0x2009: " ",   # thin space
    0x200A: " ",   # hair space
    0x0009: " ",   # tab
    0x2018: chr(0x27),  # LEFT SINGLE QUOTATION MARK
    0x2019: chr(0x27),  # RIGHT SINGLE QUOTATION MARK
    0x201A: chr(0x27),  # SINGLE LOW-9 QUOTATION MARK
    0x201B: chr(0x27),  # SINGLE HIGH-REVERSED-9 QUOTATION MARK
    0x201C: chr(0x22),  # LEFT DOUBLE QUOTATION MARK
    0x201D: chr(0x22),  # RIGHT DOUBLE QUOTATION MARK
    0x201E: chr(0x22),  # DOUBLE LOW-9 QUOTATION MARK
    0x201F: chr(0x22),  # DOUBLE HIGH-REVERSED-9 QUOTATION MARK
    0x2032: chr(0x27),  # PRIME
    0x2033: chr(0x22),  # DOUBLE PRIME
    0x2039: "<",   # SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    0x203A: ">",   # SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    0x00AB: "<<",  # LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
    0x00BB: ">>",  # RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
    # Characters below are in DejaVu Sans and should pass through natively.
    # Do NOT add © (0x00A9), ® (0x00AE), ™ (0x2122), € (0x20AC), £ (0x00A3),
    # ¥ (0x00A5), ° (0x00B0), ± (0x00B1), ×/÷, fractions, superscripts, or
    # accented Latin letters — matplotlib renders these correctly.
    0x2026: chr(0x2026),  # HORIZONTAL ELLIPSIS — pass through (in DejaVu Sans)
    0x00B7: chr(0x00B7),  # MIDDLE DOT — pass through
    0x2212: chr(0x2212),  # MINUS SIGN — pass through
    0x2020: "+",   # DAGGER (not in DejaVu Sans)
    0x2021: "+",   # DOUBLE DAGGER (not in DejaVu Sans)
}

def _filter_pua(text: str) -> str:
    """Strip or substitute characters that cause matplotlib glyph-not-found warnings.

    Removes:
    - Unicode Private Use Area (U+E000–U+F8FF): icon-font glyphs
    - Supplementary PUA A/B (U+F0000-U+10FFFF)
    - U+FFFD (replacement char): result of failed PDF ToUnicode CMap lookups
    - C0/C1 control codes except tab/newline (U+0000–U+001F, U+007F–U+009F)
    Substitutes:
    - Non-breaking hyphen (U+2011) → regular hyphen
    - Various space variants → regular space
    """
    result = []
    for c in text:
        cp = ord(c)
        if cp in _CHAR_SUBSTITUTIONS:
            s = _CHAR_SUBSTITUTIONS[cp]
            if s:
                result.append(s)
            continue
        if 0xE000 <= cp <= 0xF8FF:
            continue  # BMP PUA / icon font
        if cp >= 0xF0000:
            continue  # Supplementary PUA-A and PUA-B
        if cp == 0xFFFD:
            continue  # Unicode replacement character
        if cp <= 0x001F and c not in ("\t", "\n"):
            continue  # C0 control codes (except tab/newline)
        if 0x007F <= cp <= 0x009F:
            continue  # DEL + C1 controls
        # Invisible formatting chars that sometimes render as visible glyphs in fallback fonts
        if cp in (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF):
            continue  # zero-width space/joiner/non-joiner, word joiner, BOM
        result.append(c)
    return "".join(result)



_MARK_TYPE_MAP = {
    "COLUMN_CLUSTERED": "bar_v",
    "COLUMN_STACKED": "bar_v_stacked",
    "COLUMN_100_PERCENT_STACKED": "bar_v_pct",
    "BAR_CLUSTERED": "bar_h",
    "BAR_STACKED": "bar_h_stacked",
    "BAR_100_PERCENT_STACKED": "bar_h_pct",
    "LINE": "line",
    "LINE_MARKERS": "line",
    "AREA": "area",
    "AREA_STACKED": "area",
    "PIE": "pie",
    "PIE_EXPLODED": "pie",
    "DOUGHNUT": "doughnut",
    "DOUGHNUT_EXPLODED": "doughnut",
    "XY_SCATTER": "scatter",
    "XY_SCATTER_LINES": "scatter_line",
    "XY_SCATTER_LINES_NO_MARKERS": "scatter_line",
    "XY_SCATTER_SMOOTH": "scatter_line",
    "BUBBLE": "bubble",
}


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------

def _color(value: "Any", default: str = "none", theme: dict[str, str] | None = None) -> str:
    """Convert a BridgeElement colour (ColorSpec or legacy str) to a matplotlib colour string."""
    from percy.bridge.elements import ColorSpec
    if value is None:
        return default
    if isinstance(value, ColorSpec):
        if not value.value:
            return default
        active = theme if theme is not None else _THEME
        return value.resolve(active)
    # Legacy str handling
    if not value:
        return default
    if value.startswith("scheme:"):
        key = value[7:]
        normalized = _XML_TO_THEME_KEY.get(key) or _XML_TO_THEME_KEY.get(key.lower()) or key
        active = theme if theme is not None else _THEME
        return active.get(normalized) or _THEME.get(normalized, "#888888")
    clean = value.lstrip("#")
    if len(clean) == 6:
        return "#" + clean
    if len(clean) == 8:
        return "#" + clean[2:]
    return default


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_spurious_bg_shape(el: "BridgeShape", slide_w: float, slide_h: float) -> bool:
    """Return True if this BridgeShape looks like a spurious PDF-background artifact.

    PDFs often embed a full-slide-size opaque white rectangle as a background
    element.  When extracted via the bridge, it can land at an offset position
    (e.g. 3.78", 2.78") and cover most of the slide area, hiding photos and
    coloured backgrounds behind it.  We skip such shapes to avoid this issue.

    Criteria (all must hold):
      - solid white fill, no visible border, no text content
      - covers > 85% of the slide area
      - simple rect geometry (not a complex custom shape)
    """
    fill = el.fill
    if not fill or (fill.fill_type or "").lower() != "solid":
        return False
    color = _color(fill.color, "none").lstrip("#").upper()
    if color not in ("FFFFFF", "FFFFFFFF"):
        return False
    if el.line.visible:
        return False
    if el.text_content.has_text:
        return False
    preset = (el.shape_identification.geometry_preset or "rect").lower()
    if preset not in ("rect", "roundrect", ""):
        return False
    area = el.position.width * el.position.height
    if area < 0.85 * slide_w * slide_h:
        return False
    # A white rectangle at the exact origin covering the full slide is the
    # intended slide background — keep it.  Only skip off-origin shapes.
    pos = el.position
    if abs(pos.left) < 0.05 and abs(pos.top) < 0.05:
        return False
    return True


# ---------------------------------------------------------------------------
# SlideRenderer
# ---------------------------------------------------------------------------

class SlideRenderer:
    """
    Renders BridgeSlide elements onto a matplotlib Figure.

    Parameters
    ----------
    dpi : int
        Output resolution. 96 = screen, 150 = good quality, 300 = print.
    bg_color : str
        Fallback slide background colour when slide.background_color is None.
    theme : dict[str, str] | None
        Optional colour palette override (e.g. from PercyDocument.theme_colors).
        When provided, overrides the module-level _THEME defaults.
    """

    def __init__(self, dpi: int = 150, bg_color: str = "white",
                 theme: dict[str, str] | None = None,
                 font_map: dict | None = None) -> None:
        self.dpi = dpi
        self.bg_color = bg_color
        self._theme: dict[str, str] = {**_THEME, **(theme or {})}
        self._default_text_color: str | None = None  # set per-slide in render_slide
        self._font_map: dict = font_map or {}
        # Document-aware state for dashboard reconstruction
        self._worksheet_lookup: dict[str, Any] = {}  # worksheet_name → BridgeSlide

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------

    def set_font_map(self, font_map: dict) -> None:
        """Replace the active font map (pdf_name → BridgeFont)."""
        self._font_map = font_map or {}

    def set_document(self, doc: Any) -> None:
        """Provide the full PercyDocument so dashboard slides can look up worksheet content."""
        self._worksheet_lookup = {}
        for slide in getattr(doc, "slides", []):
            props = getattr(slide, "custom_properties", {}) or {}
            if props.get("tableau_kind") == "worksheet":
                tab_info = props.get("tableau", {}) or {}
                name = tab_info.get("name") or tab_info.get("title") or ""
                if name:
                    self._worksheet_lookup[name] = slide

    def _resolve_font(self, pdf_font_name: str | None) -> tuple[str, str, str, str]:
        """Return (family, weight, style, registered_path) for a PDF font name.

        Checks self._font_map first (populated from embedded font extraction),
        then falls back to name-parsing heuristics, then _normalize_font_family.
        registered_path is the exact font file path (or "" when not available).
        """
        if not pdf_font_name:
            return "sans-serif", "normal", "normal", ""
        spec = self._font_map.get(pdf_font_name)
        # Try expanding abbreviated weight/style suffixes to match canonical names
        # e.g. "FooFont-Li" → "FooFont-Light", "FooFont-Me" → "FooFont-Medium"
        if spec is None:
            _ABBREV_EXPAND = {
                "-Li": "-Light", "-Th": "-Thin", "-Lt": "-Light",
                "-Me": "-Medium", "-Md": "-Medium",
                "-Re": "-Regular",
                "-Bd": "-Bold", "-Sb": "-SemiBold",
                "-Bk": "-Black", "-Bl": "-Black",
                "-It": "-Italic", "-Obl": "-Oblique",
            }
            for abbrev, full in _ABBREV_EXPAND.items():
                if pdf_font_name.endswith(abbrev):
                    candidate = pdf_font_name[:-len(abbrev)] + full
                    spec = self._font_map.get(candidate)
                    if spec is not None:
                        break
        if spec is not None:
            # When we have an exact registered font file, use the raw family name
            # (it was registered under that name).  When there's no file path,
            # normalize to an installed fallback so matplotlib can find something.
            rpath = spec.registered_path or ""
            # For standard system fonts (Arial, Times, Helvetica, etc.) extracted
            # from PDFs: CIDFont-derived subsets can have wrong CID→Unicode glyph
            # mappings even after ToUnicode patching, making 'S' render as 'r', etc.
            # Prefer the system font (rpath="") which always has correct glyph shapes.
            if rpath and _is_system_font_family(spec.family):
                rpath = ""
            # If the subset is missing >3 of the 26 lowercase letters, it's too
            # sparse to render arbitrary text safely (_safe_text_for_font would turn
            # the absent chars into spaces).  Fall back to a system font instead.
            if rpath and _has_sparse_ascii_cmap(rpath):
                rpath = ""
            family = spec.family if rpath else _normalize_font_family(spec.family)
            return family, spec.weight, spec.style, rpath
        # Fallback: parse the PDF font name, then normalize the family so
        # matplotlib can find it (e.g. "ArialMT" → "Arial" not a raw unknown name).
        try:
            from percy.diagnostics.pdf_fonts import name_to_font
            font = name_to_font(pdf_font_name)
            family = _normalize_font_family(font.family)
            return family, font.weight, font.style, (font.registered_path or "")
        except Exception:
            pass
        return _normalize_font_family(pdf_font_name), "normal", "normal", ""

    def render_slide(self, slide: BridgeSlide) -> Figure:
        """Render a complete slide to a Figure. Thread-safe (no pyplot global state)."""
        import numpy as np
        W = slide.width or 10.0
        H = slide.height or 7.5
        bg = slide.background_color or self.bg_color
        grad_stops = getattr(slide, "background_gradient_stops", None) or []
        grad_angle = getattr(slide, "background_gradient_angle", 0.0) or 0.0

        fig = Figure(figsize=(W, H), dpi=self.dpi)
        FigureCanvasAgg(fig)
        fig.patch.set_facecolor(bg)

        # Main canvas — covers entire slide, y=0 at top (matches PowerPoint)
        # figsize=(W,H) already makes 1 data unit = 1 inch on both axes,
        # so set_aspect("equal") is redundant and causes matplotlib to shrink
        # the axes to enforce equal physical units, distorting non-square pages.
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_facecolor(bg)
        ax.set_xlim(0, W)
        ax.set_ylim(H, 0)
        ax.axis("off")

        if grad_stops and len(grad_stops) >= 2:
            # Render gradient background as an image
            try:
                sorted_stops = sorted(grad_stops, key=lambda s: s.position)
                positions = [s.position for s in sorted_stops]
                colors_hex = [self._c(s.color, bg) for s in sorted_stops]

                def hex_to_rgb(h: str) -> tuple:
                    h = h.lstrip("#")
                    if len(h) == 6:
                        return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))
                    return (0.5, 0.5, 0.5)

                rgb_stops = [hex_to_rgb(c) for c in colors_hex]
                N = 256
                t = np.linspace(0, 1, N)
                r = np.interp(t, positions, [c[0] for c in rgb_stops])
                g_ch = np.interp(t, positions, [c[1] for c in rgb_stops])
                b_ch = np.interp(t, positions, [c[2] for c in rgb_stops])

                # Build 2D gradient image based on angle
                angle_rad = np.deg2rad(grad_angle)
                cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
                px = np.linspace(0, 1, 200)
                py = np.linspace(0, 1, 200)
                xx, yy = np.meshgrid(px, py)
                # Project onto gradient direction
                proj = (xx * cos_a + yy * sin_a)
                proj = (proj - proj.min()) / max(proj.max() - proj.min(), 1e-9)
                ir = np.interp(proj.ravel(), t, r).reshape(proj.shape)
                ig = np.interp(proj.ravel(), t, g_ch).reshape(proj.shape)
                ib_ch = np.interp(proj.ravel(), t, b_ch).reshape(proj.shape)
                img = np.dstack([ir, ig, ib_ch])
                ax.imshow(img, extent=[0, W, H, 0], aspect="auto", zorder=-10)
                ax.set_facecolor("none")
            except Exception:
                ax.set_facecolor(bg)
        else:
            ax.set_facecolor(bg)

        # Per-slide default text color (e.g. white on Quote/dark slides)
        self._default_text_color: str | None = slide.default_text_color

        # Draw elements sorted by z-index (lowest first = furthest back)
        for element in sorted(slide.elements, key=lambda e: e.stacking.z_index):
            self._dispatch(fig, ax, element, W, H)

        # Reset the shared measure renderer so FreeType's per-face state does not
        # accumulate across slides.  CIDFont-derived subsets leave FreeType's
        # internal glyph cache in an inconsistent state after rasterization; a
        # fresh RendererAgg on the next slide avoids cross-slide segfaults.
        _measure_tls.renderer = None

        return fig

    def render_element(
        self,
        element: BridgeElement,
        slide_width: float = 10.0,
        slide_height: float = 7.5,
        padding: float = 0.2,
    ) -> plt.Figure:
        """
        Render a single element in isolation with a thin padding border.
        Useful for per-element unit debugging.
        """
        p = element.position
        W = p.width + 2 * padding
        H = p.height + 2 * padding

        fig = Figure(figsize=(W, H), dpi=self.dpi)
        FigureCanvasAgg(fig)
        fig.patch.set_facecolor("#F8F8F8")
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_xlim(-padding, p.width + padding)
        ax.set_ylim(p.height + padding, -padding)
        ax.axis("off")

        self._default_text_color = None  # no slide context; use element's own colors
        # Temporarily shift element to origin for isolated render
        from dataclasses import replace
        shifted = replace(element, position=replace(p, left=0.0, top=0.0))
        self._dispatch(fig, ax, shifted, p.width, p.height)
        return fig

    def _c(self, value: str | None, default: str = "none") -> str:
        """Colour helper that uses this renderer's theme palette."""
        return _color(value, default, self._theme)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def _dispatch(
        self, fig: plt.Figure, ax: plt.Axes,
        element: BridgeElement, W: float, H: float,
    ) -> None:
        # Skip elements that are studio-hidden or entirely outside the slide canvas
        custom = getattr(element, "custom_properties", None) or {}
        if custom.get("studio_hidden"):
            return
        p = element.position
        if (p.left + p.width < 0 or p.top + p.height < 0
                or p.left > W or p.top > H):
            return
        try:
            if isinstance(element, BridgeText):
                self._render_text(ax, element)
            elif isinstance(element, BridgeImage):
                self._render_image(ax, element)
            elif isinstance(element, BridgeTable):
                self._render_table(ax, element)
            elif isinstance(element, BridgeChart):
                self._render_chart(fig, element, W, H)
            elif isinstance(element, BridgeShape):
                props = element.custom_properties or {}
                if props.get("tableau_kind") == "dashboard_worksheet_zone" and self._worksheet_lookup:
                    self._render_tableau_zone(fig, ax, element, W, H)
                elif props.get("tableau_kind") == "kpi_card":
                    self._render_kpi_card(ax, element, W, H)
                elif _is_spurious_bg_shape(element, W, H):
                    pass  # skip large white PDF-background artifacts
                else:
                    self._render_shape(ax, element)
            elif isinstance(element, BridgeConnector):
                self._render_connector(ax, element)
            elif isinstance(element, BridgeFreeform):
                self._render_freeform(ax, element)
            elif isinstance(element, BridgeGroup):
                for child in element.children:
                    self._dispatch(fig, ax, child, W, H)
        except Exception:
            # Never crash the whole slide render over one bad element
            self._render_error_box(ax, element)

    # ------------------------------------------------------------------
    # Tableau dashboard zone reconstruction
    # ------------------------------------------------------------------

    def _render_tableau_zone(
        self, fig: Any, ax: Any,
        el: "BridgeShape", W: float, H: float,
    ) -> None:
        """Render a Tableau dashboard worksheet zone by looking up the real content."""
        from dataclasses import replace as _replace
        props = el.custom_properties or {}
        zone = props.get("tableau_zone", {}) or {}
        ws_name = zone.get("name") or props.get("tableau_name") or ""
        slide = self._worksheet_lookup.get(ws_name)

        # Draw zone background / border regardless of content
        p = el.position
        z = el.stacking.z_index
        ax.add_patch(mpatches.Rectangle(
            (p.left, p.top), p.width, p.height,
            facecolor="#FFFFFF", edgecolor="#CCCCCC", linewidth=0.5, zorder=z,
        ))

        if slide is not None:
            # Find the primary chart or table in the worksheet slide
            for ws_el in slide.elements:
                if isinstance(ws_el, (BridgeChart, BridgeTable)):
                    try:
                        # Remap the element's position to match the dashboard zone
                        patched = _replace(ws_el, position=_replace(ws_el.position,
                            left=p.left, top=p.top, width=p.width, height=p.height,
                        ))
                        if isinstance(patched, BridgeChart):
                            self._render_chart(fig, patched, W, H)
                        else:
                            self._render_table(ax, patched)
                    except Exception:
                        pass
                    return

        # Fallback: show worksheet name as a label
        label = ws_name or "Worksheet"
        ax.text(
            p.left + p.width / 2, p.top + p.height / 2, label,
            ha="center", va="center", fontsize=8, color="#666666",
            fontweight="bold", zorder=z + 0.1,
        )

    def _render_kpi_card(self, ax: Any, el: "BridgeShape", W: float, H: float) -> None:
        """Render a Tableau KPI number-card with white background, accent top bar, value, and label."""
        import matplotlib.patches as _patches
        props = el.custom_properties or {}
        label = props.get("kpi_label", "KPI")
        accent = props.get("kpi_accent", "#4E79A7")
        p = el.position
        z = el.stacking.z_index

        # White card background
        ax.add_patch(_patches.Rectangle(
            (p.left, p.top), p.width, p.height,
            facecolor="#FFFFFF", edgecolor="#DDDDDD", linewidth=0.5, zorder=z,
        ))

        # Accent top stripe — capped at 0.4 in so it's visually proportional on large cards
        stripe_h = min(p.height * 0.08, 0.4)
        ax.add_patch(_patches.Rectangle(
            (p.left, p.top), p.width, stripe_h,
            facecolor=accent, edgecolor="none", zorder=z + 0.05,
        ))

        # Large value placeholder centered in the upper portion of the card
        ax.text(
            p.left + p.width / 2, p.top + p.height * 0.50,
            "—", ha="center", va="center",
            fontsize=max(8, min(20, p.height * 0.28 * 72)),
            color=accent, fontweight="bold", zorder=z + 0.1,
        )

        # Label text in lower portion
        ax.text(
            p.left + p.width / 2, p.top + p.height * 0.78,
            label, ha="center", va="center",
            fontsize=max(6, min(10, p.height * 0.14 * 72)),
            color="#555555", zorder=z + 0.1,
        )

    # ------------------------------------------------------------------
    # BridgeText
    # ------------------------------------------------------------------

    def _render_text(self, ax: plt.Axes, el: BridgeText) -> None:
        p = el.position
        z = el.stacking.z_index

        # Background fill
        if el.fill_and_border.has_fill and el.fill_and_border.fill_color:
            ax.add_patch(mpatches.Rectangle(
                (p.left, p.top), p.width, p.height,
                facecolor=self._c(el.fill_and_border.fill_color),
                edgecolor="none", zorder=z,
            ))

        # Border
        if el.fill_and_border.has_border and el.fill_and_border.border_color:
            lw = (el.fill_and_border.border_width or 1.0) / 72 * self.dpi * 0.5
            ax.add_patch(mpatches.Rectangle(
                (p.left, p.top), p.width, p.height,
                facecolor="none",
                edgecolor=self._c(el.fill_and_border.border_color),
                linewidth=lw, zorder=z,
            ))

        # Margins: prefer text_frame.body_insets (PPTX explicit values), fall back
        # to el.margins (PDF source explicit values), then PPTX defaults (L/R=0.1", T/B=0.05").
        _bi = getattr(el.text_frame, "body_insets", {}) or {}
        ml = (_bi.get("left") if _bi.get("left") is not None
              else el.margins.margin_left if el.margins.margin_left is not None
              else 0.1)
        mt = (_bi.get("top") if _bi.get("top") is not None
              else el.margins.margin_top if el.margins.margin_top is not None
              else 0.05)
        mr = (_bi.get("right") if _bi.get("right") is not None
              else el.margins.margin_right if el.margins.margin_right is not None
              else 0.1)
        mb = (_bi.get("bottom") if _bi.get("bottom") is not None
              else el.margins.margin_bottom if el.margins.margin_bottom is not None
              else 0.05)
        text_x = p.left + ml
        max_w = p.width - ml - mr

        _tf_scale = el.text_frame.font_scale
        _fs_factor = _tf_scale / 100000.0 if _tf_scale and _tf_scale != 100000 else 1.0

        # Vertical anchor: default top, support middle/center and bottom
        vanchor = (el.text_frame.vertical_anchor or "top").lower()
        text_y = p.top + mt
        if vanchor in ("middle", "center", "ctr"):
            _text_h = self._measure_paragraphs(el.paragraphs, _fs_factor, max_w=max_w)
            _avail_h = p.height - mt - mb
            text_y = p.top + mt + max(0.0, (_avail_h - _text_h) / 2)
        elif vanchor in ("bottom", "b"):
            _text_h = self._measure_paragraphs(el.paragraphs, _fs_factor, max_w=max_w)
            text_y = max(p.top + mt, p.top + p.height - mb - _text_h)

        self._draw_paragraphs(ax, el.paragraphs, text_x, text_y, max_w, z,
                              pdf_mode=el.text_frame.word_wrap is False,
                              font_scale=_fs_factor)

    # ------------------------------------------------------------------
    # BridgeShape
    # ------------------------------------------------------------------

    def _make_shape_patch(
        self, preset: str, p: Any, adj: dict,
        fc: str, ec: str, lw: float, z: int, alpha: float,
    ) -> Any:
        """Create a matplotlib patch for a given OOXML preset shape."""
        import numpy as np
        L, T, W, H = p.left, p.top, p.width, p.height
        cx, cy = L + W / 2, T + H / 2

        kw = dict(facecolor=fc, edgecolor=ec, linewidth=lw, zorder=z, alpha=alpha)

        if preset == "ellipse":
            return mpatches.Ellipse((cx, cy), W, H, **kw)

        if preset in {"roundrect", "roundedcornerrectangle"}:
            # adj1 value (0–50000 as % of half-min-dimension in OOXML fmla)
            adj_val = adj.get("adj") or adj.get("adj1") or "16667"
            try:
                frac = int(str(adj_val).split("*")[0].replace("val ", "")) / 100000.0
            except Exception:
                frac = 0.167
            radius = min(W, H) * min(frac, 0.5)
            return FancyBboxPatch(
                (L, T), W, H,
                boxstyle=f"round,pad=0,rounding_size={radius}",
                mutation_scale=1.0, **kw,
            )

        if preset in {"triangle", "isostriangle"}:
            verts = [(cx, T), (L + W, T + H), (L, T + H)]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "rtriangle":
            verts = [(L, T), (L + W, T + H), (L, T + H)]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "diamond":
            verts = [(cx, T), (L + W, cy), (cx, T + H), (L, cy)]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "parallelogram":
            adj_val = adj.get("adj") or "25000"
            try:
                d = int(str(adj_val).replace("val ", "")) / 100000.0 * W
            except Exception:
                d = W * 0.25
            verts = [(L + d, T), (L + W, T), (L + W - d, T + H), (L, T + H)]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "trapezoid":
            adj_val = adj.get("adj") or "25000"
            try:
                d = int(str(adj_val).replace("val ", "")) / 100000.0 * W
            except Exception:
                d = W * 0.25
            verts = [(L, T), (L + W, T), (L + W - d, T + H), (L + d, T + H)]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset in {"hexagon", "heptagon", "octagon", "decagon", "dodecagon",
                      "pentagon", "nonagon"}:
            n_sides = {"pentagon": 5, "hexagon": 6, "heptagon": 7, "octagon": 8,
                       "nonagon": 9, "decagon": 10, "dodecagon": 12}.get(preset, 6)
            angles = [np.pi / 2 + 2 * np.pi * i / n_sides for i in range(n_sides)]
            rx, ry = W / 2, H / 2
            verts = [(cx + rx * np.cos(a), cy - ry * np.sin(a)) for a in angles]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "rightarrow":
            # Arrow pointing right: body + head
            neck = H * 0.4
            head_w = W * 0.35
            verts = [
                (L, cy - neck / 2), (L + W - head_w, cy - neck / 2),
                (L + W - head_w, T), (L + W, cy),
                (L + W - head_w, T + H), (L + W - head_w, cy + neck / 2),
                (L, cy + neck / 2),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "leftarrow":
            neck = H * 0.4
            head_w = W * 0.35
            verts = [
                (L + W, cy - neck / 2), (L + head_w, cy - neck / 2),
                (L + head_w, T), (L, cy),
                (L + head_w, T + H), (L + head_w, cy + neck / 2),
                (L + W, cy + neck / 2),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "uparrow":
            neck = W * 0.4
            head_h = H * 0.35
            verts = [
                (cx - neck / 2, T + H), (cx - neck / 2, T + head_h),
                (L, T + head_h), (cx, T),
                (L + W, T + head_h), (cx + neck / 2, T + head_h),
                (cx + neck / 2, T + H),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "downarrow":
            neck = W * 0.4
            head_h = H * 0.35
            verts = [
                (cx - neck / 2, T), (cx - neck / 2, T + H - head_h),
                (L, T + H - head_h), (cx, T + H),
                (L + W, T + H - head_h), (cx + neck / 2, T + H - head_h),
                (cx + neck / 2, T),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "chevron":
            notch = W * 0.2
            verts = [
                (L, T), (L + W - notch, T), (L + W, cy),
                (L + W - notch, T + H), (L, T + H), (L + notch, cy),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "leftrightarrow":
            neck = H * 0.4
            head_w = W * 0.25
            verts = [
                (L, cy), (L + head_w, T), (L + head_w, cy - neck / 2),
                (L + W - head_w, cy - neck / 2), (L + W - head_w, T),
                (L + W, cy), (L + W - head_w, T + H),
                (L + W - head_w, cy + neck / 2), (L + head_w, cy + neck / 2),
                (L + head_w, T + H),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset in {"donut", "ring"}:
            import matplotlib.path as mpath
            outer_rx, outer_ry = W / 2, H / 2
            inner_rx, inner_ry = W * 0.35, H * 0.35
            N = 64
            angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
            outer_verts = [(cx + outer_rx * np.cos(a), cy + outer_ry * np.sin(a)) for a in angles]
            inner_verts = [(cx + inner_rx * np.cos(a), cy + inner_ry * np.sin(a)) for a in reversed(angles)]
            verts = outer_verts + [outer_verts[0]] + inner_verts + [inner_verts[0]]
            codes = ([mpath.Path.MOVETO] + [mpath.Path.LINETO] * (N - 1) + [mpath.Path.CLOSEPOLY] +
                     [mpath.Path.MOVETO] + [mpath.Path.LINETO] * (N - 1) + [mpath.Path.CLOSEPOLY])
            from matplotlib.patches import PathPatch as _PP
            return _PP(mpath.Path(verts, codes), **kw)

        if preset in {"star4", "star5", "star6", "star7", "star8", "star10", "star12", "star16", "star24", "star32"}:
            n_pts = int(preset.replace("star", ""))
            outer_angles = [np.pi / 2 + 2 * np.pi * i / n_pts for i in range(n_pts)]
            inner_angles = [a + np.pi / n_pts for a in outer_angles]
            rx, ry = W / 2, H / 2
            irx, iry = rx * 0.45, ry * 0.45
            verts = []
            for oa, ia in zip(outer_angles, inner_angles):
                verts.append((cx + rx * np.cos(oa), cy - ry * np.sin(oa)))
                verts.append((cx + irx * np.cos(ia), cy - iry * np.sin(ia)))
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "plus":
            t3 = W / 3
            t3h = H / 3
            verts = [
                (cx - t3 / 2, T), (cx + t3 / 2, T),
                (cx + t3 / 2, cy - t3h / 2), (L + W, cy - t3h / 2),
                (L + W, cy + t3h / 2), (cx + t3 / 2, cy + t3h / 2),
                (cx + t3 / 2, T + H), (cx - t3 / 2, T + H),
                (cx - t3 / 2, cy + t3h / 2), (L, cy + t3h / 2),
                (L, cy - t3h / 2), (cx - t3 / 2, cy - t3h / 2),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset == "updownarrow":
            neck = W * 0.4
            head_h = H * 0.3
            verts = [
                (cx, T), (L + W, T + head_h), (cx + neck / 2, T + head_h),
                (cx + neck / 2, T + H - head_h), (L + W, T + H - head_h),
                (cx, T + H), (L, T + H - head_h), (cx - neck / 2, T + H - head_h),
                (cx - neck / 2, T + head_h), (L, T + head_h),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset in {"bentupwarrow", "bentupward", "bentarrow"}:
            # Approximate bent arrow as a right-angle arrow pointing up-right
            shaft_w = W * 0.35
            head_h = H * 0.4
            verts = [
                (L, T + H), (L, cy), (cx - shaft_w / 2, cy),
                (cx - shaft_w / 2, T + head_h), (L, T + head_h),
                (cx, T), (L + W, T + head_h), (cx + shaft_w / 2, T + head_h),
                (cx + shaft_w / 2, cy), (L + W, cy), (L + W, T + H),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset in {"arc", "pie"}:
            # Render as a wedge/arc — use matplotlib Wedge
            import matplotlib.patches as mp
            theta1, theta2 = 0, 270  # default: 3/4 circle
            adj1 = adj.get("adj1") or adj.get("stAng")
            adj2 = adj.get("adj2") or adj.get("swAng")
            try:
                theta1 = int(str(adj1).replace("val ", "")) / 60000.0
            except Exception:
                pass
            try:
                span = int(str(adj2).replace("val ", "")) / 60000.0
                theta2 = theta1 + span
            except Exception:
                pass
            return mp.Wedge((cx, cy), min(W, H) / 2, theta1, theta2, **kw)

        if preset == "can":
            # Cylinder: draw as rectangle with ellipse caps via compound path
            import matplotlib.path as mpath
            cap_h = H * 0.15
            N = 32
            top_angles = np.linspace(0, np.pi, N)
            bot_angles = np.linspace(np.pi, 2 * np.pi, N)
            rx = W / 2
            top_arc = [(cx + rx * np.cos(a), T + cap_h / 2 + cap_h / 2 * np.sin(a)) for a in top_angles]
            bot_arc = [(cx + rx * np.cos(a), T + H - cap_h / 2 + cap_h / 2 * np.sin(a)) for a in bot_angles]
            verts = (
                [(L, T + cap_h / 2)] + top_arc + [(L + W, T + cap_h / 2)] +
                [(L + W, T + H - cap_h / 2)] + bot_arc + [(L, T + H - cap_h / 2)] +
                [(L, T + cap_h / 2)]
            )
            codes = (
                [mpath.Path.MOVETO] + [mpath.Path.LINETO] * N +
                [mpath.Path.LINETO] * 2 + [mpath.Path.LINETO] * N +
                [mpath.Path.LINETO] + [mpath.Path.CLOSEPOLY]
            )
            return PathPatch(mpath.Path(verts, codes), **kw)

        if preset in {"callout1", "wedgerectcallout", "callout2", "callout3",
                      "accentcallout1", "accentcallout2", "accentcallout3"}:
            # Rectangle with a small tail at bottom-left
            tail_w = W * 0.12
            tail_h = H * 0.2
            verts = [
                (L, T), (L + W, T), (L + W, T + H),
                (L + tail_w * 2, T + H), (L, T + H + tail_h),
                (L + tail_w, T + H), (L, T + H), (L, T),
            ]
            return mpatches.Polygon(verts, closed=True, **kw)

        if preset in {"rightbracket", "leftbracket", "rightbrace", "leftbrace"}:
            # Render as a thin rectangle approximation
            bracket_w = min(W * 0.4, W)
            if "right" in preset:
                return mpatches.Rectangle((L + W - bracket_w, T), bracket_w, H, **kw)
            return mpatches.Rectangle((L, T), bracket_w, H, **kw)

        if preset in {"straightconnector1", "bentconnector2", "bentconnector3",
                      "bentconnector4", "bentconnector5", "curvedconnector2",
                      "curvedconnector3", "curvedconnector4", "curvedconnector5"}:
            # Connector shapes: render as a line from center-left to center-right
            import matplotlib.lines as mlines
            return mlines.Line2D(
                [L, L + W], [cy, cy],
                color=ec if ec != "none" else fc,
                linewidth=max(lw, 1.0), zorder=z,
            )

        if preset in {"cloud", "cloudcallout"}:
            # Approximate cloud as rounded rectangle
            radius = min(W, H) * 0.25
            return FancyBboxPatch(
                (L, T), W, H,
                boxstyle=f"round,pad=0,rounding_size={radius}",
                mutation_scale=1.0, **kw,
            )

        # Default: rectangle
        return mpatches.Rectangle((L, T), W, H, **kw)

    def _render_gradient(
        self, ax: plt.Axes,
        left: float, top: float, width: float, height: float,
        stops: list, angle_deg: float, z: int,
        clip_patch: Any = None,
    ) -> None:
        """Render a linear gradient as an imshow image, optionally clipped to a patch."""
        import numpy as np
        import matplotlib.colors as mcolors

        if len(stops) < 2:
            return
        sorted_stops = sorted(stops, key=lambda s: s.position)
        positions = [s.position for s in sorted_stops]
        colors_hex = [self._c(s.color, "#888888") for s in sorted_stops]
        # LinearSegmentedColormap requires positions in [0, 1] starting at 0 and ending at 1.
        if positions[0] > 0:
            positions = [0.0] + positions
            colors_hex = [colors_hex[0]] + colors_hex
        if positions[-1] < 1:
            positions = positions + [1.0]
            colors_hex = colors_hex + [colors_hex[-1]]
        N = 256
        cmap = mcolors.LinearSegmentedColormap.from_list(
            "grad", list(zip(positions, colors_hex)), N=N
        )
        t = np.linspace(0, 1, N)

        ang = angle_deg % 360
        rad = np.radians(ang)
        cos_a = np.cos(rad)
        sin_a = np.sin(rad)

        if abs(sin_a) >= abs(cos_a):
            # More vertical — gradient top→bottom
            img = cmap(t)[:, np.newaxis, :3]          # (N, 1, 3)
            img = np.tile(img, (1, 2, 1))              # (N, 2, 3)
            if sin_a < 0:
                img = img[::-1]
        else:
            # More horizontal — gradient left→right
            img = cmap(t)[np.newaxis, :, :3]           # (1, N, 3)
            img = np.tile(img, (2, 1, 1))              # (2, N, 3)
            if cos_a < 0:
                img = img[:, ::-1]

        im = ax.imshow(
            img,
            extent=[left, left + width, top + height, top],
            origin="upper", aspect="auto", zorder=z, interpolation="bilinear",
        )
        if clip_patch is not None:
            im.set_clip_path(clip_patch)

    def _render_shape(self, ax: plt.Axes, el: "BridgeShape") -> None:
        p = el.position
        z = el.stacking.z_index
        ftype = (el.fill.fill_type or "").lower()
        is_gradient = ftype == "gradient" and el.fill.gradient_stops
        fc = self._c(el.fill.color) if ftype == "solid" else ("none" if not is_gradient else "none")
        ec = self._c(el.line.color) if el.line.visible and el.line.color else "none"
        lw = max((el.line.width or 1.0) / 72 * self.dpi * 0.5, 0.5) if el.line.visible else 0
        alpha = max(0.0, 1.0 - (el.fill.transparency or 0.0))

        preset = (el.shape_identification.geometry_preset or "rect").lower()
        adj = el.shape_identification.geometry_adjustments or {}

        patch = self._make_shape_patch(preset, p, adj, fc, ec, lw, z, alpha)

        import matplotlib.lines as _mlines
        if isinstance(patch, _mlines.Line2D):
            ax.add_line(patch)
        else:
            ax.add_patch(patch)

        if is_gradient:
            self._render_gradient(
                ax, p.left, p.top, p.width, p.height,
                el.fill.gradient_stops, el.fill.gradient_angle, z,
                clip_patch=patch,
            )

        # Text inside shape — honour explicit body insets, fall back to PPTX defaults
        if el.text_content.has_text and el.text_content.paragraphs:
            _si = el.text_frame.text_insets or {}
            _sml = _si.get("left", 0.1)
            _smt = _si.get("top", 0.05)
            _smr = _si.get("right", 0.1)
            _smb = _si.get("bottom", 0.05)
            _stf_scale = el.text_frame.font_scale
            _sfs = _stf_scale / 100000.0 if _stf_scale and _stf_scale != 100000 else 1.0
            _svanchor = (el.text_frame.vertical_anchor or "top").lower()
            _stext_y = p.top + _smt
            _smaxw = p.width - _sml - _smr
            if _svanchor in ("middle", "center", "ctr"):
                _sth = self._measure_paragraphs(el.text_content.paragraphs, _sfs, max_w=_smaxw)
                _savail = p.height - _smt - _smb
                _stext_y = p.top + _smt + max(0.0, (_savail - _sth) / 2)
            elif _svanchor in ("bottom", "b"):
                _sth = self._measure_paragraphs(el.text_content.paragraphs, _sfs, max_w=_smaxw)
                _stext_y = max(p.top + _smt, p.top + p.height - _smb - _sth)
            self._draw_paragraphs(
                ax, el.text_content.paragraphs,
                p.left + _sml, _stext_y,
                p.width - _sml - _smr, z,
                font_scale=_sfs,
            )

    # ------------------------------------------------------------------
    # BridgeImage
    # ------------------------------------------------------------------

    def _render_image(self, ax: plt.Axes, el: BridgeImage) -> None:
        import numpy as np
        from PIL import Image

        if not el.image_data.image_bytes:
            self._render_error_box(ax, el, label="[image: no bytes]")
            return

        try:
            img = Image.open(io.BytesIO(el.image_data.image_bytes)).convert("RGBA")
        except Exception:
            self._render_error_box(ax, el, label="[image: decode error]")
            return

        p = el.position
        c = el.cropping
        W_px, H_px = img.size
        box = (
            int(W_px * c.crop_left),
            int(H_px * c.crop_top),
            int(W_px * (1 - c.crop_right)),
            int(H_px * (1 - c.crop_bottom)),
        )
        if box[2] > box[0] and box[3] > box[1]:
            img = img.crop(box)

        fill_mode = el.fill_mode or "letterbox"

        if fill_mode == "stretch":
            # PDF-positioned image: fill the exact bbox (no aspect correction needed)
            extent = [p.left, p.left + p.width, p.top + p.height, p.top]
        else:
            # Preserve aspect ratio: letterbox within the target bbox
            img_w, img_h = img.size
            if img_w > 0 and img_h > 0:
                scale = min(p.width / img_w, p.height / img_h)
                draw_w = img_w * scale
                draw_h = img_h * scale
            else:
                draw_w, draw_h = p.width, p.height
            cx = p.left + p.width / 2
            cy = p.top + p.height / 2
            extent = [cx - draw_w / 2, cx + draw_w / 2, cy + draw_h / 2, cy - draw_h / 2]

        ax.imshow(
            np.asarray(img),
            extent=extent,
            origin="upper",
            aspect="auto",
            zorder=el.stacking.z_index,
        )

    # ------------------------------------------------------------------
    # BridgeTable
    # ------------------------------------------------------------------

    def _render_table(self, ax: plt.Axes, el: BridgeTable) -> None:
        if not el.data:
            return

        # Skip phantom tables: large tables with no text content are false-positive
        # detections from logo grids or other non-table vector arrangements.
        p = el.position
        # el.data rows may contain raw strings or CellFormat objects — handle both.
        def _cell_has_text(cf: object) -> bool:
            if cf is None:
                return False
            if isinstance(cf, str):
                return bool(cf.strip())
            text = getattr(cf, "text", None)
            return bool(text and str(text).strip())

        has_any_text = any(
            _cell_has_text(cf)
            for row in (el.cell_formats or el.data or [])
            for cf in (row or [])
        )
        slide_area = (ax.get_xlim()[1] * ax.get_ylim()[0])  # W * H (ylim is (H, 0) so [0]=H)
        table_area = p.width * p.height
        if not has_any_text and table_area > 0 and slide_area > 0:
            if table_area / slide_area > 0.15:
                return  # phantom table — skip

        z = el.stacking.z_index
        col_widths = el.dimensions.column_widths or []
        row_heights = el.dimensions.row_heights or []

        n_rows = len(el.data)
        n_cols = max(len(r) for r in el.data) if el.data else 0

        # Fill missing dimension info with uniform distribution
        if not col_widths or len(col_widths) < n_cols:
            col_widths = [p.width / n_cols] * n_cols
        if not row_heights or len(row_heights) < n_rows:
            row_heights = [p.height / n_rows] * n_rows

        col_lefts = [p.left + sum(col_widths[:i]) for i in range(n_cols)]
        row_tops  = [p.top  + sum(row_heights[:i]) for i in range(n_rows)]

        for r_idx in range(n_rows):
            for c_idx in range(n_cols):
                cx = col_lefts[c_idx]
                cy = row_tops[r_idx]
                cw = col_widths[c_idx] if c_idx < len(col_widths) else 0
                ch = row_heights[r_idx] if r_idx < len(row_heights) else 0

                cf = None
                if el.cell_formats and r_idx < len(el.cell_formats) and c_idx < len(el.cell_formats[r_idx]):
                    cf = el.cell_formats[r_idx][c_idx]

                # Skip spanned cells
                if cf and cf.merge.is_spanned:
                    continue

                # Handle merged cell extents
                span_cols = cf.merge.merge_span_cols if cf and cf.merge.is_merge_origin else 1
                span_rows = cf.merge.merge_span_rows if cf and cf.merge.is_merge_origin else 1
                actual_w = sum(col_widths[c_idx:c_idx + span_cols]) if span_cols > 1 else cw
                actual_h = sum(row_heights[r_idx:r_idx + span_rows]) if span_rows > 1 else ch

                # Cell background (draw without border; grid lines drawn separately below)
                # fill_color=None means no fill (transparent), not white.
                fc = self._c(cf.fill_color) if cf and cf.fill_color else "none"
                if fc != "none":
                    ax.add_patch(mpatches.Rectangle(
                        (cx, cy), actual_w, actual_h,
                        facecolor=fc, edgecolor="none", linewidth=0, zorder=z,
                    ))

                # Cell borders (if captured)
                if cf and cf.borders:
                    self._draw_cell_borders(ax, cx, cy, actual_w, actual_h, cf.borders, z)

                # Cell text — prefer paragraph/run data (captures per-run ColorSpec colors)
                margin = 0.04
                if cf and cf.paragraphs:
                    valign = ((cf.alignment.vertical_alignment if cf and cf.alignment else None) or "top").upper()
                    if valign in ("BOTTOM", "B"):
                        text_y = cy + actual_h - margin
                    elif valign in ("MIDDLE", "CENTER", "M", "C"):
                        text_y = cy + actual_h / 2
                    else:  # TOP is default
                        text_y = cy + margin
                    self._draw_paragraphs(
                        ax, cf.paragraphs,
                        cx + margin, text_y,
                        actual_w - 2 * margin, z + 0.1,
                        clip_height=actual_h - 2 * margin,
                    )
                else:
                    text = _filter_pua(str(cf.text if cf and cf.text is not None else
                            (el.data[r_idx][c_idx] if c_idx < len(el.data[r_idx]) else "") or ""))
                    if text and text.strip():
                        fs = (cf.font.font_size if cf and cf.font.font_size else 10) or 10
                        fc_text = self._c(cf.font.text_color if cf else None, "#000000")
                        bold = cf.font.font_bold if cf else False
                        italic = cf.font.font_italic if cf else False
                        halign_str = (cf.alignment.text_alignment if cf else "left") or "left"
                        halign = {"center": "center", "right": "right"}.get(halign_str.lower(), "left")
                        tx = cx + actual_w / 2 if halign == "center" else cx + actual_w - 0.04 if halign == "right" else cx + 0.04
                        ax.text(
                            tx, cy + actual_h / 2, text,
                            fontsize=fs,
                            color=fc_text,
                            fontweight="bold" if bold else "normal",
                            fontstyle="italic" if italic else "normal",
                            ha=halign, va="center",
                            clip_on=True, zorder=z + 0.1,
                            parse_math=False,
                        )

        # Draw grid lines only when cells carry explicit border specifications.
        # If no cell has borders the table relies on fill-color contrast and
        # connector lines for visual separation — adding a generic gray grid
        # introduces artifacts not present in the original.
        has_cell_borders = any(
            (cf and cf.borders)
            for row in (el.cell_formats or [])
            for cf in (row or [])
        )
        if has_cell_borders:
            table_right  = p.left + sum(col_widths[:n_cols])
            table_bottom = p.top  + sum(row_heights[:n_rows])
            grid_color = "#AAAAAA"
            grid_lw    = 0.5
            for ry in row_tops:
                ax.plot([p.left, table_right], [ry, ry],
                        color=grid_color, linewidth=grid_lw, zorder=z + 0.05)
            ax.plot([p.left, table_right], [table_bottom, table_bottom],
                    color=grid_color, linewidth=grid_lw, zorder=z + 0.05)
            for cx_g in col_lefts:
                ax.plot([cx_g, cx_g], [p.top, table_bottom],
                        color=grid_color, linewidth=grid_lw, zorder=z + 0.05)
            ax.plot([table_right, table_right], [p.top, table_bottom],
                    color=grid_color, linewidth=grid_lw, zorder=z + 0.05)

    def _draw_cell_borders(
        self, ax: plt.Axes,
        x: float, y: float, w: float, h: float,
        borders: Any, z: int,
    ) -> None:
        sides = {
            "top":    ([(x, y),    (x + w, y)],    getattr(borders, "border_top", None)),
            "bottom": ([(x, y+h),  (x+w, y+h)],    getattr(borders, "border_bottom", None)),
            "left":   ([(x, y),    (x, y+h)],       getattr(borders, "border_left", None)),
            "right":  ([(x+w, y),  (x+w, y+h)],     getattr(borders, "border_right", None)),
        }
        for _side, (pts, border) in sides.items():
            if not border or not border.visible:
                continue
            c = self._c(border.color, "#000000")
            lw = max((border.width or 1.0) / 72 * self.dpi * 0.4, 0.4)
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            ax.plot(xs, ys, color=c, linewidth=lw, zorder=z + 0.05)

    # ------------------------------------------------------------------
    # BridgeChart  (inset axes — each chart gets its own coordinate space)
    # ------------------------------------------------------------------

    def _render_chart(
        self, fig: plt.Figure, el: BridgeChart, W: float, H: float,
    ) -> None:
        p = el.position
        # Convert element position to figure fractions (0-1, bottom-left origin)
        fig_left   = p.left / W
        fig_bottom = 1.0 - (p.top + p.height) / H
        fig_w      = p.width / W
        fig_h      = p.height / H

        if fig_w <= 0 or fig_h <= 0:
            return

        # Skip entirely if chart has no data — avoids rendering a bare default axes
        if not el.series and not el.categories.categories and not el.categories.categories_raw:
            return

        chart_ax = fig.add_axes([fig_left, fig_bottom, fig_w, fig_h])
        chart_ax.tick_params(labelsize=6)
        for spine in chart_ax.spines.values():
            spine.set_linewidth(0.5)

        # Apply Tableau-specific style hints when available
        is_tableau = (el.custom_properties or {}).get("source_format") == "tableau"
        if is_tableau:
            _apply_tableau_chart_style(chart_ax, el)

        ct = (el.chart_type or "").upper()
        mark = _MARK_TYPE_MAP.get(ct, "bar_v")

        cats  = el.categories.categories or el.categories.categories_raw or []
        series = el.series

        try:
            if mark in ("bar_v", "bar_v_stacked", "bar_v_pct"):
                self._chart_bar(chart_ax, el, cats, series, horizontal=False, mark=mark, is_tableau=is_tableau)
            elif mark in ("bar_h", "bar_h_stacked", "bar_h_pct"):
                self._chart_bar(chart_ax, el, cats, series, horizontal=True, mark=mark, is_tableau=is_tableau)
            elif mark in ("line", "area"):
                self._chart_line(chart_ax, el, cats, series, filled=(mark == "area"), is_tableau=is_tableau)
            elif mark == "pie":
                self._chart_pie(chart_ax, el, series, is_tableau=is_tableau)
            elif mark == "doughnut":
                self._chart_pie(chart_ax, el, series, donut=True, is_tableau=is_tableau)
            elif mark in ("scatter", "scatter_line", "bubble"):
                self._chart_scatter(chart_ax, el, series, lines=(mark != "scatter"), bubble=(mark == "bubble"), is_tableau=is_tableau)
            else:
                self._chart_bar(chart_ax, el, cats, series, horizontal=False, mark=mark, is_tableau=is_tableau)
        except Exception:
            chart_ax.text(0.5, 0.5, f"[Chart: {el.chart_type}]",
                          ha="center", va="center", transform=chart_ax.transAxes,
                          fontsize=8, color="#888888")

        # Pie/donut: always turn off axes frame regardless of what happened inside
        if mark in ("pie", "doughnut"):
            chart_ax.axis("off")
            chart_ax.set_aspect("equal")

        # Chart title
        title = el.title.title
        if title:
            chart_ax.set_title(title, fontsize=8, pad=3)

        # Legend — pie/donut add their own legend inside _chart_pie
        if el.legend.visible and series and mark not in ("pie", "doughnut"):
            chart_ax.legend(fontsize=6, loc=_legend_loc(el.legend.position))

        # Value axis — not applicable for pie/donut
        # For horizontal bars, the value axis is X; for everything else it's Y.
        if mark not in ("pie", "doughnut"):
            h_bar = mark in ("bar_h", "bar_h_stacked", "bar_h_pct")
            if h_bar:
                if el.value_axis.min_value is not None:
                    chart_ax.set_xlim(left=el.value_axis.min_value)
                if el.value_axis.max_value is not None:
                    chart_ax.set_xlim(right=el.value_axis.max_value)
            else:
                if el.value_axis.min_value is not None:
                    chart_ax.set_ylim(bottom=el.value_axis.min_value)
                if el.value_axis.max_value is not None:
                    chart_ax.set_ylim(top=el.value_axis.max_value)
            chart_ax.tick_params(axis="both", which="both", labelsize=6)

    def _chart_bar(
        self, ax: plt.Axes, el: BridgeChart,
        cats: list, series: list,
        horizontal: bool, mark: str, is_tableau: bool = False,
    ) -> None:
        import numpy as np
        n = len(cats)
        k = len(series)
        if n == 0 or k == 0:
            return

        x = np.arange(n)
        width = 0.8 / k if "stacked" not in mark else 0.7
        stacked = "stacked" in mark or "pct" in mark

        bottoms = np.zeros(n)
        for i, s in enumerate(series):
            vals = [v if v is not None else 0.0 for v in s.values[:n]]
            if len(vals) < n:
                vals += [0.0] * (n - len(vals))
            color = self._series_color(s, i, is_tableau=is_tableau)
            label = s.name or f"Series {i+1}"
            xpos = x if stacked else x + (i - k / 2 + 0.5) * width
            show_labels = getattr(s.data_labels, "show", False)

            if horizontal:
                bars = ax.barh(xpos, vals, height=width, left=bottoms if stacked else None,
                               color=color, label=label, linewidth=0)
                if show_labels:
                    for bar, v in zip(bars, vals):
                        if v != 0:
                            ax.text(bar.get_width() + bar.get_width() * 0.02,
                                    bar.get_y() + bar.get_height() / 2,
                                    f"{v:g}", va="center", ha="left", fontsize=5, clip_on=True)
            else:
                bars = ax.bar(xpos, vals, width=width, bottom=bottoms if stacked else None,
                              color=color, label=label, linewidth=0)
                if show_labels:
                    for bar, v, bot in zip(bars, vals, bottoms):
                        if v != 0:
                            ax.text(bar.get_x() + bar.get_width() / 2,
                                    bot + v + abs(v) * 0.02,
                                    f"{v:g}", ha="center", va="bottom", fontsize=5, clip_on=True)
            if stacked:
                bottoms += np.array(vals)

        if horizontal:
            ax.set_yticks(x)
            ax.set_yticklabels([str(c) for c in cats], fontsize=6)
        else:
            ax.set_xticks(x)
            ax.set_xticklabels([str(c) for c in cats], rotation=30, ha="right", fontsize=6)

    def _chart_line(
        self, ax: plt.Axes, el: BridgeChart,
        cats: list, series: list, filled: bool, is_tableau: bool = False,
    ) -> None:
        x = range(len(cats))
        for i, s in enumerate(series):
            vals = [v if v is not None else 0.0 for v in s.values]
            color = self._series_color(s, i, is_tableau=is_tableau)
            label = s.name or f"Series {i+1}"
            if filled:
                ax.fill_between(list(x)[:len(vals)], vals, alpha=0.5, color=color, label=label)
            else:
                ax.plot(list(x)[:len(vals)], vals, color=color, label=label,
                        linewidth=1.5, marker="o" if len(vals) <= 20 else None, markersize=3)
        if cats:
            ax.set_xticks(range(len(cats)))
            ax.set_xticklabels([str(c) for c in cats], rotation=30, ha="right", fontsize=6)

    def _chart_pie(
        self, ax: plt.Axes, el: BridgeChart,
        series: list, donut: bool = False, is_tableau: bool = False,
    ) -> None:
        if not series:
            return
        s = series[0]
        vals = [v for v in s.values if v is not None and v > 0]
        cats = el.categories.categories or [f"Slice {i+1}" for i in range(len(vals))]
        colors = [self._series_color(type("S", (), {"color": pc})(), i, is_tableau=is_tableau)
                  for i, pc in enumerate(s.point_colors or [])]
        palette = _TABLEAU_COLORS if is_tableau else _CHART_DEFAULTS
        if not colors or len(colors) < len(vals):
            colors = [palette[i % len(palette)] for i in range(len(vals))]

        wedge_props = {"linewidth": 0.5, "edgecolor": "white"}
        if donut:
            wedge_props["width"] = 0.5
        label_strs = [str(c) for c in cats[:len(vals)]]
        _, _, autotexts = ax.pie(
            vals, labels=None, autopct="%1.0f%%",
            colors=colors, wedgeprops=wedge_props,
            textprops={"fontsize": 5}, startangle=90,
            pctdistance=0.75 if donut else 0.6,
        )
        for at in autotexts:
            at.set_fontsize(5)
        # Always show legend for pie/donut charts
        ax.legend(
            handles=[mpatches.Patch(color=colors[i], label=label_strs[i])
                     for i in range(min(len(colors), len(label_strs)))],
            fontsize=5, loc="lower center", bbox_to_anchor=(0.5, -0.15),
            ncol=min(3, len(label_strs)),
        )
        ax.axis("off")
        ax.set_aspect("equal")

    def _chart_scatter(
        self, ax: plt.Axes, el: BridgeChart,
        series: list, lines: bool, bubble: bool, is_tableau: bool = False,
    ) -> None:
        for i, s in enumerate(series):
            x_vals = s.x_values or list(range(len(s.values)))
            y_vals = s.values
            color = self._series_color(s, i, is_tableau=is_tableau)
            label = s.name or f"Series {i+1}"
            n = min(len(x_vals), len(y_vals))
            if n == 0:
                continue
            xs = [v if v is not None else 0.0 for v in x_vals[:n]]
            ys = [v if v is not None else 0.0 for v in y_vals[:n]]
            if lines:
                ax.plot(xs, ys, color=color, label=label, linewidth=1.5, marker="o", markersize=3)
            else:
                sizes = [50] * n
                ax.scatter(xs, ys, c=[color] * n, s=sizes, label=label, alpha=0.7)

    # ------------------------------------------------------------------
    def _series_color(self, series: Any, index: int, is_tableau: bool = False) -> str:
        c = self._c(getattr(series, "color", None))
        if c != "none":
            return c
        if is_tableau:
            return _TABLEAU_COLORS[index % len(_TABLEAU_COLORS)]
        # Fall back to theme accent colors in order (like PowerPoint's color cycle)
        accent_order = ["ACCENT_1", "ACCENT_2", "ACCENT_3", "ACCENT_4", "ACCENT_5", "ACCENT_6"]
        key = accent_order[index % len(accent_order)]
        return self._theme.get(key) or _CHART_DEFAULTS[index % len(_CHART_DEFAULTS)]

    # BridgeConnector
    # ------------------------------------------------------------------

    def _render_connector(self, ax: plt.Axes, el: BridgeConnector) -> None:
        ep = el.endpoints
        lc = self._c(el.line.color, "#000000")
        lw = max((el.line.width or 0.25) / 72 * self.dpi * 0.4, 0.1)
        z  = el.stacking.z_index

        head_end = (el.line.head_end or "none").lower()
        tail_end = (el.line.tail_end or "none").lower()

        dash_style = (el.line.dash_style or "solid").lower()
        ls_map = {"solid": "-", "dashed": "--", "dotted": ":", "dash_dot": "-."}
        linestyle = ls_map.get(dash_style, "-")

        arrow_kw = dict(color=lc, linewidth=lw, zorder=z, linestyle=linestyle)
        if "arrow" in head_end or "triangle" in head_end:
            ax.annotate(
                "", xy=(ep.end_x, ep.end_y), xytext=(ep.start_x, ep.start_y),
                arrowprops=dict(arrowstyle="->", color=lc, lw=lw),
                zorder=z,
            )
        elif "arrow" in tail_end or "triangle" in tail_end:
            ax.annotate(
                "", xy=(ep.start_x, ep.start_y), xytext=(ep.end_x, ep.end_y),
                arrowprops=dict(arrowstyle="->", color=lc, lw=lw),
                zorder=z,
            )
        else:
            ax.plot([ep.start_x, ep.end_x], [ep.start_y, ep.end_y], **arrow_kw)

    # ------------------------------------------------------------------
    # BridgeFreeform
    # ------------------------------------------------------------------

    def _render_freeform(self, ax: plt.Axes, el: BridgeFreeform) -> None:
        if not el.paths:
            return

        p = el.position
        z = el.stacking.z_index
        ftype = (el.fill.fill_type or "").lower()
        is_gradient = ftype == "gradient" and el.fill.gradient_stops
        fc = self._c(el.fill.fill_color) if ftype == "solid" else "none"
        ec = self._c(el.line.line_color, "none")
        lw = max((el.line.line_width or 1.0) / 72 * self.dpi * 0.4, 0.5)
        alpha = max(0.0, 1.0 - (el.fill.transparency or 0.0))

        for path_obj in el.paths:
            if not path_obj.commands:
                continue
            pw = path_obj.width or 1
            ph = path_obj.height or 1

            verts, codes = [], []
            for cmd in path_obj.commands:
                if cmd.command == "moveTo" and cmd.points:
                    pt = cmd.points[0]
                    verts.append(self._freeform_pt(pt, pw, ph, p))
                    codes.append(MplPath.MOVETO)
                elif cmd.command == "lnTo" and cmd.points:
                    pt = cmd.points[0]
                    verts.append(self._freeform_pt(pt, pw, ph, p))
                    codes.append(MplPath.LINETO)
                elif cmd.command == "cubicBezTo" and len(cmd.points) >= 3:
                    for pt in cmd.points[:3]:
                        verts.append(self._freeform_pt(pt, pw, ph, p))
                    codes += [MplPath.CURVE4] * 3
                elif cmd.command == "quadBezTo" and len(cmd.points) >= 2:
                    for pt in cmd.points[:2]:
                        verts.append(self._freeform_pt(pt, pw, ph, p))
                    codes += [MplPath.CURVE3] * 2
                elif cmd.command == "close":
                    if verts:
                        verts.append(verts[0])
                        codes.append(MplPath.CLOSEPOLY)

            if len(verts) >= 2:
                mpl_path = MplPath(verts, codes)
                patch = PathPatch(
                    mpl_path,
                    facecolor=fc, edgecolor=ec, linewidth=lw, zorder=z, alpha=alpha,
                )
                ax.add_patch(patch)
                if is_gradient:
                    self._render_gradient(
                        ax, p.left, p.top, p.width, p.height,
                        el.fill.gradient_stops, el.fill.gradient_angle, z,
                        clip_patch=patch,
                    )

    @staticmethod
    def _freeform_pt(pt: tuple, pw: int, ph: int, pos: Any) -> tuple:
        x = pos.left + (pt[0] / pw) * pos.width  if pw else pos.left
        y = pos.top  + (pt[1] / ph) * pos.height if ph else pos.top
        return (x, y)

    # ------------------------------------------------------------------
    # Text drawing helpers
    # ------------------------------------------------------------------

    def _measure_paragraphs(
        self, paragraphs: list, font_scale: float = 1.0, max_w: float | None = None
    ) -> float:
        """Estimate total height (inches) of a paragraph list without rendering.

        max_w: when provided, estimates wrapped line count via _text_width_in so that
        bottom/middle anchor calculations are correct for multi-line paragraphs.
        """
        import math
        total = 0.0
        for para in (paragraphs or []):
            if not para.runs:
                total += self._line_height(10)
                continue
            base_run = next((r for r in para.runs if not r.is_line_break), None)
            if base_run is None:
                total += self._line_height(10)
                continue
            fs_pt = (base_run.font_size or 10) * font_scale
            ls_mult = para.line_spacing if para.line_spacing else 1.2
            total += (para.space_before or 0) / 72
            line_h = fs_pt * ls_mult / 72
            n_lines = 1
            if max_w and max_w > 0:
                _rfam, _rwt, _rst, _rpath = self._resolve_font(base_run.font_name)
                _bold = (base_run.font_bold if base_run.font_bold is not None
                         else _rwt not in ("normal", "light", "thin", "ultralight"))
                _ital = base_run.font_italic or (_rst in ("italic", "oblique")) or False
                _full = "".join(
                    r.text for r in para.runs if not r.is_line_break and r.text
                )
                if _full.strip():
                    _tw = _text_width_in(_full, fs_pt, _bold, _ital, _rfam, _rpath)
                    n_lines = max(1, math.ceil(_tw / max_w))
            total += line_h * n_lines
        return total

    def _draw_paragraphs(
        self, ax: plt.Axes,
        paragraphs: list, x0: float, y0: float,
        max_w: float, z: int,
        clip_height: float | None = None,
        pdf_mode: bool = False,
        font_scale: float = 1.0,
    ) -> float:
        """Draw paragraphs starting at (x0, y0); return final y position.

        pdf_mode=True: each paragraph is a single rendered PDF line.
        font_scale: multiplier applied to all font sizes (PPTX normAutoFit fontScale).
        Auto-scale font size to fit max_w so font-substitution width creep
        doesn't cause false wraps that get clipped by clip_height.
        """
        y = y0
        for para in (paragraphs or []):
            if clip_height is not None and y > y0 + clip_height:
                break

            if not para.runs:
                y += self._line_height(10)
                continue

            # Use first non-break run's properties for the paragraph baseline
            base_run = next((r for r in para.runs if not r.is_line_break), None)
            if base_run is None:
                y += self._line_height(10)
                continue

            fs_pt = (base_run.font_size or 10) * font_scale
            fc    = self._c(base_run.font_color, self._default_text_color or "#222222")
            _rfam, _rwt, _rst, _rpath = self._resolve_font(base_run.font_name)
            bold  = (base_run.font_bold if base_run.font_bold is not None
                     else (_rwt not in ("normal", "light", "thin", "ultralight"))
                     or _font_name_implies_bold(base_run.font_name))
            ital  = base_run.font_italic or (_rst in ("italic", "oblique")) or False
            fname = _rfam
            fpath = _rpath
            caps  = getattr(base_run, "font_caps", None)

            # Check if any run has a baseline shift (super/subscript) OR if runs
            # differ in bold/italic/color/size — both cases need per-run rendering.
            has_baseline_shift = any(
                getattr(r, "baseline_shift", None) is not None
                for r in para.runs if not r.is_line_break
            )
            content_runs = [r for r in para.runs if not r.is_line_break and not _is_icon_font(r.font_name) and r.text]
            has_mixed_style = (
                len(content_runs) > 1 and (
                    len({r.font_bold for r in content_runs}) > 1 or
                    len({r.font_italic for r in content_runs}) > 1 or
                    len({_color(r.font_color, "") for r in content_runs}) > 1 or
                    len({r.font_underline for r in content_runs}) > 1 or
                    len({getattr(r, "strikethrough", None) for r in content_runs}) > 1 or
                    len({getattr(r, "char_spacing", None) for r in content_runs}) > 1 or
                    len({r.font_name for r in content_runs}) > 1
                )
            )
            needs_per_run = has_baseline_shift or has_mixed_style

            # line_spacing multiplier from PDF metrics (1.2 default = single-spaced)
            ls_mult = para.line_spacing if para.line_spacing else 1.2
            line_h = fs_pt * ls_mult / 72

            align = (para.alignment or "left").lower()
            if align in {"justify", "distribute", "thai_distribute"}:
                align = "left"
            ha = {"center": "center", "right": "right"}.get(align, "left")

            y += (para.space_before or 0) / 72

            # In pdf_mode use the exact PDF Y offset stored at extraction time.
            # This eliminates font-metric drift that accumulates over hundreds of lines.
            pdf_y_off = getattr(para, "pdf_y_offset", None)
            if pdf_mode and pdf_y_off is not None:
                y = y0 + pdf_y_off

            # In pdf_mode also use x offset — handles merged blocks where paragraphs
            # originate from different horizontal columns (e.g. L3Harris title + label).
            # pdf_x_offset and left_indent are both derived from the same dx value, so
            # when pdf_x_offset is applied we skip left_indent to avoid doubling the shift.
            pdf_x_off = getattr(para, "pdf_x_offset", None)
            _using_pdf_x = pdf_mode and pdf_x_off is not None
            base_x0 = (x0 + pdf_x_off) if _using_pdf_x else x0

            # Horizontal indent: shift x0 right for indented lines (e.g. bullets).
            # In pdf_mode, pdf_x_off already captures the full x offset from block left,
            # so left_indent must not be added again.
            li = getattr(para, "left_indent", None) if not _using_pdf_x else None
            para_x0 = base_x0 + li if li else base_x0
            effective_max_w = max_w - li if li else max_w

            if needs_per_run:
                # Render runs individually: handles super/subscript, bold+normal on
                # same line (e.g. transcript speaker names), mixed colours/sizes.
                # Build a flat list of (text_fragment, style_props) tokens, each
                # covering at most one word so we can do proper line-breaking.
                # Tuple: (text, size, color, family, bold, italic, shift, fpath, underline, strike, charsp)
                # charsp: extra spacing per character in hundredths of a point (OOXML spc attribute)
                _tokens: list[tuple] = []
                for run in para.runs:
                    if run.is_line_break:
                        # Explicit line break (Shift+Enter): insert newline sentinel
                        _tokens.append(("\n", fs_pt, fc, fname, bold, ital, 0.0, fpath, False, None, 0.0))
                        continue
                    if not run.text:
                        continue
                    if _is_icon_font(run.font_name):
                        continue
                    text = _filter_pua(run.text)
                    if not text:
                        continue
                    rfs  = (run.font_size or (fs_pt / font_scale)) * font_scale
                    rfc  = self._c(run.font_color, self._default_text_color or "#222222")
                    _rfam2, _rwt2, _rst2, _rpath2 = self._resolve_font(run.font_name)
                    rfn  = _rfam2
                    rfpath2 = _rpath2
                    rbold = (run.font_bold if run.font_bold is not None
                             else _rwt2 not in ("normal", "light", "thin", "ultralight"))
                    rial  = (run.font_italic if run.font_italic is not None
                             else _rst2 in ("italic", "oblique"))
                    shift = getattr(run, "baseline_shift", None) or 0.0
                    runderline = bool(run.font_underline)
                    rstrike = getattr(run, "strikethrough", None)
                    rstrike = rstrike if rstrike and rstrike != "noStrike" else None
                    rcharsp = float(getattr(run, "char_spacing", None) or 0.0)
                    # Split run text at word boundaries, preserving trailing spaces
                    import re as _re
                    parts = _re.split(r'(?<=\s)(?=\S)|(?<=\S)(?=\s)', text)
                    for part in parts:
                        if part:
                            _tokens.append((part, rfs, rfc, rfn, rbold, rial, shift, rfpath2, runderline, rstrike, rcharsp))

                if not any(tok[0].strip() for tok in _tokens):
                    y += line_h + (para.space_after or 0) / 72
                    continue

                _va = "baseline" if pdf_mode else "top"
                eff_wrap = effective_max_w if effective_max_w > 0 else max_w
                # In pdf_mode don't line-wrap mixed runs (PDF already broke lines)
                import matplotlib.font_manager as _fmgr
                if pdf_mode or eff_wrap <= 0:
                    # For center/right alignment, compute total line width first
                    if ha in ("center", "right"):
                        _line_w = sum(
                            _text_width_in(t[0], t[1], t[4], t[5], t[3], t[7])
                            for t in _tokens if t[0] != "\n"
                        )
                        if ha == "center":
                            cx = para_x0 + (eff_wrap - _line_w) / 2
                        else:
                            cx = para_x0 + eff_wrap - _line_w
                    else:
                        cx = para_x0
                    for (tok_text, rfs, rfc, rfn, rbold, rial, shift, rfpath, runderline, rstrike, rcharsp) in _tokens:
                        if tok_text == "\n":
                            y += line_h
                            cx = para_x0
                            continue
                        ry = y + shift * (rfs / 72)
                        kw: dict = dict(
                            color=rfc,
                            ha="left", va=_va, clip_on=True,
                            zorder=z + 0.1, parse_math=False,
                        )
                        if rfpath:
                            kw["fontproperties"] = _fmgr.FontProperties(
                                fname=rfpath, size=rfs,
                                weight="bold" if rbold else "normal",
                                style="italic" if rial else "normal",
                            )
                        else:
                            kw["fontsize"] = rfs
                            kw["fontweight"] = "bold" if rbold else "normal"
                            kw["fontstyle"] = "italic" if rial else "normal"
                            try:
                                kw["fontfamily"] = rfn
                            except Exception:
                                pass
                        _eff_rpath2 = rfpath or _resolve_font_path(rfn, rbold, rial)
                        ax.text(cx, ry, _safe_text_for_font(tok_text, _eff_rpath2), **kw)
                        tok_w = _text_width_in(tok_text, rfs, rbold, rial, rfn, rfpath)
                        # Only apply positive char_spacing (wider tracking).
                        # Negative spc would overlap glyphs since we can't condense within ax.text().
                        if rcharsp and rcharsp > 0:
                            tok_w += len(tok_text) * rcharsp / 100.0 / 72.0
                        if runderline or rstrike:
                            _lw = max(0.4, rfs * 0.04)
                            if runderline:
                                ax.plot([cx, cx + tok_w], [ry + rfs / 72 * 0.95, ry + rfs / 72 * 0.95],
                                        color=rfc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                            if rstrike:
                                ax.plot([cx, cx + tok_w], [ry + rfs / 72 * 0.4, ry + rfs / 72 * 0.4],
                                        color=rfc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                        cx += tok_w
                    y += line_h
                else:
                    # Word-wrap mixed-style runs: greedily fill lines
                    cx = para_x0
                    line_started = False
                    for (tok_text, rfs, rfc, rfn, rbold, rial, shift, rfpath, runderline, rstrike, rcharsp) in _tokens:
                        if tok_text == "\n":
                            y += line_h
                            cx = para_x0
                            line_started = False
                            continue
                        tok_w = _text_width_in(tok_text, rfs, rbold, rial, rfn, rfpath)
                        if rcharsp and rcharsp > 0:
                            tok_w += len(tok_text) * rcharsp / 100.0 / 72.0
                        stripped = tok_text.lstrip()
                        # Wrap: if adding this token exceeds max width and line has content
                        if line_started and cx + tok_w > para_x0 + eff_wrap + 1e-6:
                            # Start new line (drop leading space of wrapped token)
                            y += line_h
                            cx = para_x0
                            tok_text = stripped
                            if stripped != tok_text:
                                tok_w = _text_width_in(tok_text, rfs, rbold, rial, rfn, rfpath)
                                if rcharsp and rcharsp > 0:
                                    tok_w += len(tok_text) * rcharsp / 100.0 / 72.0
                        if not tok_text:
                            continue
                        ry = y + shift * (rfs / 72)
                        kw = dict(
                            color=rfc,
                            ha="left", va=_va, clip_on=True,
                            zorder=z + 0.1, parse_math=False,
                        )
                        if rfpath:
                            kw["fontproperties"] = _fmgr.FontProperties(
                                fname=rfpath, size=rfs,
                                weight="bold" if rbold else "normal",
                                style="italic" if rial else "normal",
                            )
                        else:
                            kw["fontsize"] = rfs
                            kw["fontweight"] = "bold" if rbold else "normal"
                            kw["fontstyle"] = "italic" if rial else "normal"
                            try:
                                kw["fontfamily"] = rfn
                            except Exception:
                                pass
                        _eff_rpath = rfpath or _resolve_font_path(rfn, rbold, rial)
                        draw_tok = _safe_text_for_font(tok_text, _eff_rpath)
                        ax.text(cx, ry, draw_tok, **kw)
                        if runderline or rstrike:
                            _lw = max(0.4, rfs * 0.04)
                            if runderline:
                                ax.plot([cx, cx + tok_w], [ry + rfs / 72 * 0.95, ry + rfs / 72 * 0.95],
                                        color=rfc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                            if rstrike:
                                ax.plot([cx, cx + tok_w], [ry + rfs / 72 * 0.4, ry + rfs / 72 * 0.4],
                                        color=rfc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                        cx += tok_w
                        if tok_text.strip():
                            line_started = True
                    y += line_h
            else:
                full_text = _filter_pua("".join(
                    "\n" if r.is_line_break else (r.text if not _is_icon_font(r.font_name) else "")
                    for r in para.runs
                ))
                if caps in ("all", "small"):
                    full_text = full_text.upper()
                if not full_text.strip():
                    y += line_h + (para.space_after or 0) / 72
                    continue

                import matplotlib.font_manager as _fmgr2

                # In PDF mode each para is one rendered line: auto-scale font
                # size to fit effective_max_w (counters font-substitution width creep).
                render_fs = fs_pt
                eff_w = effective_max_w if effective_max_w > 0 else max_w
                if pdf_mode and eff_w > 0:
                    text_w = _text_width_in(full_text, fs_pt, bold, ital, fname, fpath)
                    # Only scale if overflow exceeds 8%: avoids systematically
                    # shrinking transcript text due to minor font-width differences.
                    if text_w > eff_w * 1.08:
                        render_fs = fs_pt * (eff_w / text_w)
                        line_h = render_fs * ls_mult / 72

                # In pdf_mode: if any run (beyond the first) carries a PDF span
                # x-origin > 0.05", render each run at its PDF x position to
                # correct cumulative advance-width drift across multi-run paragraphs.
                _content_runs = [r for r in para.runs if not r.is_line_break and r.text and not _is_icon_font(r.font_name)]
                _has_span_x = (
                    pdf_mode
                    and len(_content_runs) > 1
                    and any(
                        (getattr(r, "pdf_span_x_in", None) or 0) > 0.05
                        for r in _content_runs[1:]
                    )
                )
                if _has_span_x:
                    if clip_height is None or y <= y0 + clip_height:
                        _fs_scale = render_fs / fs_pt if fs_pt else 1.0
                        for run in _content_runs:
                            rt = _filter_pua(run.text)
                            if caps in ("all", "small"):
                                rt = rt.upper()
                            if not rt.strip():
                                continue
                            sx_in = getattr(run, "pdf_span_x_in", None)
                            sx = (base_x0 + sx_in) if sx_in is not None else para_x0
                            rfs  = (run.font_size or fs_pt) * font_scale * _fs_scale
                            rfc  = self._c(run.font_color, self._default_text_color or "#222222")
                            _rfam2, _rwt2, _rst2, _rpath2 = self._resolve_font(run.font_name)
                            rbold = (run.font_bold if run.font_bold is not None
                                     else _rwt2 not in ("normal", "light", "thin", "ultralight"))
                            rial  = (run.font_italic if run.font_italic is not None
                                     else _rst2 in ("italic", "oblique"))
                            _eff_rpath = _rpath2 or _resolve_font_path(_rfam2, rbold, rial)
                            kw2: dict = dict(ha="left", va="baseline", clip_on=True,
                                             zorder=z + 0.1, parse_math=False, color=rfc)
                            if _rpath2:
                                kw2["fontproperties"] = _fmgr2.FontProperties(
                                    fname=_rpath2, size=rfs,
                                    weight="bold" if rbold else "normal",
                                    style="italic" if rial else "normal",
                                )
                            else:
                                kw2["fontsize"] = rfs
                                kw2["fontweight"] = "bold" if rbold else "normal"
                                kw2["fontstyle"] = "italic" if rial else "normal"
                                try:
                                    kw2["fontfamily"] = _rfam2
                                except Exception:
                                    pass
                            ax.text(sx, y, _safe_text_for_font(rt, _eff_rpath), **kw2)
                    y += line_h
                    y += (para.space_after or 0) / 72
                    continue

                wrapped = [full_text] if pdf_mode else _wrap_text(full_text, fs_pt, eff_w, bold, ital, fname)

                for line in wrapped:
                    if clip_height is not None and y > y0 + clip_height:
                        break
                    if ha == "center":
                        x = para_x0 + eff_w / 2
                    elif ha == "right":
                        x = para_x0 + eff_w
                    else:
                        x = para_x0

                    _va = "baseline" if pdf_mode else "top"
                    kw = dict(
                        color=fc,
                        ha=ha, va=_va, clip_on=True,
                        zorder=z + 0.1, parse_math=False,
                    )
                    if fpath:
                        kw["fontproperties"] = _fmgr2.FontProperties(
                            fname=fpath, size=render_fs,
                            weight="bold" if bold else "normal",
                            style="italic" if ital else "normal",
                        )
                    else:
                        kw["fontsize"] = render_fs
                        kw["fontweight"] = "bold" if bold else "normal"
                        kw["fontstyle"] = "italic" if ital else "normal"
                        try:
                            kw["fontfamily"] = fname
                        except Exception:
                            pass

                    _eff_fpath = fpath or _resolve_font_path(fname, bold, ital)
                    draw_line = _safe_text_for_font(line, _eff_fpath)
                    ax.text(x, y, draw_line, **kw)
                    _base_underline = bool(base_run.font_underline)
                    _base_strike = getattr(base_run, "strikethrough", None)
                    _base_strike = _base_strike if _base_strike and _base_strike != "noStrike" else None
                    if _base_underline or _base_strike:
                        _tw = _text_width_in(draw_line, render_fs, bold, ital, fname, fpath)
                        _lw = max(0.4, render_fs * 0.04)
                        _x1 = x - _tw / 2 if ha == "center" else (x - _tw if ha == "right" else x)
                        if _base_underline:
                            ax.plot([_x1, _x1 + _tw], [y + render_fs / 72 * 0.95, y + render_fs / 72 * 0.95],
                                    color=fc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                        if _base_strike:
                            ax.plot([_x1, _x1 + _tw], [y + render_fs / 72 * 0.4, y + render_fs / 72 * 0.4],
                                    color=fc, linewidth=_lw, zorder=z + 0.2, solid_capstyle="butt", clip_on=True)
                    y += line_h

            y += (para.space_after or 0) / 72

        return y

    @staticmethod
    def _line_height(font_size_pt: float) -> float:
        """Line height in inches for a given font size in points."""
        return font_size_pt * 1.2 / 72

    # ------------------------------------------------------------------
    # Fallback error box
    # ------------------------------------------------------------------

    @staticmethod
    def _render_error_box(ax: plt.Axes, el: BridgeElement, label: str = "") -> None:
        p = el.position
        ax.add_patch(mpatches.Rectangle(
            (p.left, p.top), p.width, p.height,
            facecolor="#FFF0F0", edgecolor="#FF8888", linewidth=1,
            linestyle="--", zorder=el.stacking.z_index,
        ))
        if label:
            ax.text(p.left + p.width / 2, p.top + p.height / 2, label,
                    ha="center", va="center", fontsize=7, color="#CC0000",
                    zorder=el.stacking.z_index + 0.1)


# ---------------------------------------------------------------------------
# Tableau chart style helper
# ---------------------------------------------------------------------------

def _apply_tableau_chart_style(chart_ax: Any, el: "BridgeChart") -> None:
    """Apply Tableau-specific aesthetics to a chart axes using bridge style hints."""
    props = el.custom_properties or {}
    info = props.get("tableau", {}) or {}
    style_model = info.get("style_model", {}) or {}
    hints = style_model.get("bridge_hints", {}) or {}

    # Background
    bg = hints.get("background_color")
    if bg:
        chart_ax.set_facecolor(bg)
    else:
        chart_ax.set_facecolor("#FFFFFF")

    # Gridlines
    gridlines = hints.get("gridline_visible")
    if gridlines is False:
        chart_ax.yaxis.grid(False)
        chart_ax.xaxis.grid(False)
    else:
        chart_ax.yaxis.grid(True, color="#E8E8E8", linewidth=0.5, linestyle="-")
        chart_ax.xaxis.grid(False)

    # Font
    font_family = hints.get("font_family")
    if font_family:
        try:
            for label in chart_ax.get_xticklabels() + chart_ax.get_yticklabels():
                label.set_fontfamily(font_family)
        except Exception:
            pass

    # Tick/axis label color — always neutral; text_color hint can be a mark color, not reliable for labels
    chart_ax.tick_params(colors="#555555", labelsize=6)
    for spine in chart_ax.spines.values():
        spine.set_edgecolor("#E0E0E0")
        spine.set_linewidth(0.5)

    # Spines: Tableau typically hides top/right spines
    chart_ax.spines["top"].set_visible(False)
    chart_ax.spines["right"].set_visible(False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Font-metric text measurement (freetype via matplotlib RendererAgg)
# ---------------------------------------------------------------------------

_MEASURE_DPI = 100.0
_measure_tls = threading.local()


def _get_measure_renderer() -> Any:
    """Return a thread-local RendererAgg used solely for text-width measurement."""
    if not hasattr(_measure_tls, "renderer") or _measure_tls.renderer is None:
        from matplotlib.backends.backend_agg import RendererAgg
        _measure_tls.renderer = RendererAgg(1000, 1000, _MEASURE_DPI)
    return _measure_tls.renderer


@functools.lru_cache(maxsize=512)
def _resolve_font_path(family: str, bold: bool, italic: bool) -> str:
    """
    Resolve a font family name to an absolute .ttf/.otf path using font_manager.

    Caching this separately keeps the per-word _text_width_in cache lean and
    suppresses the noisy "Font family not found" warnings in one place.
    """
    import logging
    import matplotlib.font_manager as fm
    prop = fm.FontProperties(
        family=family,
        weight="bold" if bold else "normal",
        style="italic" if italic else "normal",
    )
    fm_log = logging.getLogger("matplotlib.font_manager")
    prev = fm_log.level
    fm_log.setLevel(logging.ERROR)  # suppress "not found" chatter
    try:
        return fm.findfont(prop)
    finally:
        fm_log.setLevel(prev)


@functools.lru_cache(maxsize=512)
def _has_sparse_ascii_cmap(font_path: str) -> bool:
    """Return True if the font subset is missing more than 3 lowercase letters.

    PDF subsets only embed glyphs used in that document/weight, so a subset for
    a weight that happens not to use 'b' or 'j' will drop those chars to spaces
    via _safe_text_for_font when a different text block uses the same family name.
    Falling back to a system font is safer than rendering with holes.
    """
    supported = _font_codepoints(font_path)
    if not supported:
        return False
    missing_lower = sum(1 for c in range(ord('a'), ord('z') + 1) if c not in supported)
    return missing_lower > 3


@functools.lru_cache(maxsize=512)
def _font_codepoints(font_path: str) -> frozenset:
    """Return frozenset of codepoints supported by the font (cached per path)."""
    if not font_path:
        return frozenset()
    try:
        from fontTools.ttLib import TTFont as _TT_cp
        import io as _io_cp
        _tt = _TT_cp(font_path, lazy=True)
        _cmap = _tt.get("cmap")
        if _cmap:
            best = _cmap.getBestCmap() or {}
            return frozenset(best.keys())
    except Exception:
        pass
    return frozenset()


# Best-effort ASCII / near-ASCII substitutes for common Unicode chars that
# may be absent from extracted PDF font subsets.  Applied before the cmap
# check so the result remains readable rather than turning into spaces.
_UNICODE_FALLBACKS: dict[int, str] = {
    0x0027: chr(0x2019),   # APOSTROPHE → try curly right-single-quote (PDF subsets often encode only the curly form)
    0x0022: chr(0x201D),   # QUOTATION MARK → try curly right-double-quote
    0x02BC: chr(0x27),   # MODIFIER LETTER APOSTROPHE
    0x2018: chr(0x27),   # LEFT SINGLE QUOTATION MARK
    0x2019: chr(0x27),   # RIGHT SINGLE QUOTATION MARK
    0x201A: ",",    # SINGLE LOW-9 QUOTATION MARK
    0x201C: chr(0x22),   # LEFT DOUBLE QUOTATION MARK
    0x201D: chr(0x22),   # RIGHT DOUBLE QUOTATION MARK
    0x201E: chr(0x22),   # DOUBLE LOW-9 QUOTATION MARK
    0x2013: "-",    # EN DASH
    0x2014: "-",    # EM DASH
    0x2015: "-",    # HORIZONTAL BAR
    0x2022: "*",    # BULLET
    0x2026: "...",  # HORIZONTAL ELLIPSIS
    0x00B7: ".",    # MIDDLE DOT
    0x00AD: "",     # SOFT HYPHEN
    0x00A0: " ",    # NON-BREAKING SPACE
    0x2212: "-",    # MINUS SIGN
    0x00D7: "x",    # MULTIPLICATION SIGN
    0x00F7: "/",    # DIVISION SIGN
    0x20AC: "EUR",  # EURO SIGN
    0x00A9: "(c)",  # COPYRIGHT SIGN
    0x00AE: "(R)",  # REGISTERED SIGN
    0x2122: "(TM)", # TRADE MARK SIGN
    0x00B0: "deg",  # DEGREE SIGN
    0x2032: chr(0x27),   # PRIME
    0x2033: chr(0x22),   # DOUBLE PRIME
    0x2039: "<",    # SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    0x203A: ">",    # SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    0x00AB: "<<",   # LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
    0x00BB: ">>",   # RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
    0x2020: "+",    # DAGGER
    0x2021: "+",    # DOUBLE DAGGER
    0x0152: "OE",   # LATIN CAPITAL LIGATURE OE
    0x0153: "oe",   # LATIN SMALL LIGATURE OE
    0x0160: "S",    # LATIN CAPITAL LETTER S WITH CARON
    0x0161: "s",    # LATIN SMALL LETTER S WITH CARON
}


def _safe_text_for_font(text: str, font_path: str) -> str:
    """Replace characters not in font's cmap with ASCII equivalents or space.

    Non-PUA characters not in the primary font are passed through unchanged so
    matplotlib can render them via its font fallback mechanism (e.g., DejaVu Sans
    for arrows/symbols). Only PUA glyphs (icon-font private use areas) are dropped
    to space, since those have no meaningful fallback.
    """
    if not font_path:
        return text
    supported = _font_codepoints(font_path)
    if not supported:
        return text
    result = []
    for c in text:
        cp = ord(c)
        if cp in supported:
            result.append(c)
        else:
            sub = _UNICODE_FALLBACKS.get(cp)
            if sub is not None:
                # Only use the substitute if the substitute chars are supported
                result.append("".join(s for s in sub if ord(s) in supported) or " ")
            elif 0xE000 <= cp <= 0xF8FF or cp >= 0xF0000:
                # PUA glyph not in this font — drop to space (no meaningful fallback)
                result.append(" ")
            else:
                # Non-PUA character: keep as-is and let matplotlib use fallback fonts
                result.append(c)
    return "".join(result)


@functools.lru_cache(maxsize=8192)
def _text_width_in(
    text: str,
    font_size_pt: float,
    bold: bool,
    italic: bool,
    font_family: str,
    font_path: str = "",
) -> float:
    """
    Return the rendered width of *text* in inches.

    Uses matplotlib's FreeType engine (same pipeline as the actual draw call):
    1. Uses font_path directly when provided (exact subset), else resolves via
       findfont for the family/weight/style combination.
    2. Measures glyph advance widths through RendererAgg (freetype2).
    Results are LRU-cached — repeated words/font combos across a deck are free.
    Falls back to a proportional heuristic if FreeType measurement fails.
    """
    import matplotlib.font_manager as fm
    path = font_path or _resolve_font_path(font_family, bold, italic)
    # Filter chars not in the font cmap before calling FreeType — missing glyphs
    # in CIDFont-derived subsets cause access violations rather than graceful fallback.
    safe = _safe_text_for_font(text, path)
    prop = fm.FontProperties(size=font_size_pt, fname=path)
    try:
        w, _, _ = _get_measure_renderer().get_text_width_height_descent(
            safe, prop, ismath=False
        )
        return float(w) / _MEASURE_DPI
    except Exception:
        char_w = font_size_pt * (0.60 if bold else 0.55) / 72
        return len(text) * char_w


def _hard_break(
    word: str,
    font_size_pt: float,
    bold: bool,
    italic: bool,
    family: str,
    max_w: float,
) -> list[str]:
    """Binary-search break a single word that is wider than max_w."""
    lines: list[str] = []
    while word:
        if _text_width_in(word, font_size_pt, bold, italic, family) <= max_w:
            lines.append(word)
            break
        lo, hi = 1, len(word)
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if _text_width_in(word[:mid], font_size_pt, bold, italic, family) <= max_w:
                lo = mid
            else:
                hi = mid
        lines.append(word[:lo])
        word = word[lo:]
    return lines or [word]


def _wrap_text(
    text: str,
    font_size_pt: float,
    max_width_in: float,
    bold: bool = False,
    italic: bool = False,
    font_name: str | None = None,
) -> list[str]:
    """
    Word-wrap *text* so each line fits within *max_width_in* inches.

    Uses real freetype glyph metrics (via _text_width_in) rather than a
    character-count heuristic, so proportional fonts wrap accurately.
    """
    if max_width_in <= 0:
        return [text]
    family = font_name or "sans-serif"
    space_w = _text_width_in(" ", font_size_pt, bold, italic, family)
    result: list[str] = []
    for raw_line in text.split("\n"):
        if not raw_line.strip():
            result.append("")
            continue
        words = raw_line.split()
        word_widths = [_text_width_in(w, font_size_pt, bold, italic, family) for w in words]
        current: list[str] = []
        current_w = 0.0
        for word, ww in zip(words, word_widths):
            gap = space_w if current else 0.0
            if current_w + gap + ww <= max_width_in:
                current.append(word)
                current_w += gap + ww
            else:
                if current:
                    result.append(" ".join(current))
                if ww > max_width_in:
                    result.extend(_hard_break(word, font_size_pt, bold, italic, family, max_width_in))
                    current = []
                    current_w = 0.0
                else:
                    current = [word]
                    current_w = ww
        if current:
            result.append(" ".join(current))
    return result or [""]


def _legend_loc(position: str | None) -> str:
    return {
        "t":  "upper center",
        "b":  "lower center",
        "l":  "center left",
        "r":  "center right",
        "tr": "upper right",
    }.get(position or "b", "best")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _register_embedded_fonts(fonts: list) -> None:
    """Write non-obfuscated embedded fonts to a temp dir and register with matplotlib."""
    import tempfile
    import matplotlib.font_manager as fm
    from pathlib import Path as _Path
    _tmp = _Path(tempfile.gettempdir()) / "percy_fonts"
    _tmp.mkdir(exist_ok=True)
    for ef in fonts:
        if ef.is_obfuscated or not ef.font_bytes:
            continue
        fname = f"{ef.typeface}_{ef.style}.ttf".replace(" ", "_")
        fpath = _tmp / fname
        if not fpath.exists():
            fpath.write_bytes(ef.font_bytes)
        try:
            fm.fontManager.addfont(str(fpath))
        except Exception:
            pass


_DEFAULT_RENDERER = SlideRenderer()


def render_element(
    element: BridgeElement,
    slide_width: float = 10.0,
    slide_height: float = 7.5,
    dpi: int = 150,
    padding: float = 0.2,
) -> plt.Figure:
    """
    Render a single BridgeElement in isolation.

    Returns a matplotlib Figure. Save with ``fig.savefig("out.png", dpi=dpi)``.
    """
    return SlideRenderer(dpi=dpi).render_element(
        element, slide_width, slide_height, padding
    )


def render_slide(slide: BridgeSlide, dpi: int = 150) -> plt.Figure:
    """Render a complete BridgeSlide to a matplotlib Figure."""
    return SlideRenderer(dpi=dpi).render_slide(slide)


def render_bridge_slides(
    doc: PercyDocument,
    out_dir: str | Path,
    slide_numbers: list[int] | None = None,
    dpi: int = 150,
) -> list[Path]:
    """Render specific slides (or all if ``slide_numbers`` is None) to PNGs.

    Used by every studio endpoint that mutates a slide's content and wants to
    refresh just that slide's thumbnail without rebuilding the whole deck.

    Returns a list of paths to the saved PNGs.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    renderer = SlideRenderer(dpi=dpi, theme=doc.theme_colors or None)
    if doc.embedded_fonts:
        _register_embedded_fonts(doc.embedded_fonts)

    target_set = set(slide_numbers) if slide_numbers is not None else None

    import warnings as _warnings
    paths: list[Path] = []
    for slide in doc.slides:
        if target_set is not None and slide.slide_number not in target_set:
            continue
        fig = renderer.render_slide(slide)
        dest = out / f"slide-{slide.slide_number:03d}.png"
        with _warnings.catch_warnings():
            _warnings.filterwarnings(
                "ignore",
                message=r"Glyph \d+.*missing from font",
                category=UserWarning,
            )
            fig.savefig(dest, dpi=dpi, bbox_inches="tight", pad_inches=0)
        fig.clf()
        paths.append(dest)
    return paths


def render_document(
    doc: PercyDocument,
    out_dir: str | Path,
    dpi: int = 150,
) -> list[Path]:
    """
    Render every slide in a PercyDocument to individual PNG files.

    Returns a list of paths to the saved PNGs.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    renderer = SlideRenderer(dpi=dpi, theme=doc.theme_colors or None)
    # Register any embedded fonts with matplotlib
    if doc.embedded_fonts:
        _register_embedded_fonts(doc.embedded_fonts)
    import warnings as _warnings
    paths: list[Path] = []
    for slide in doc.slides:
        fig = renderer.render_slide(slide)
        dest = out / f"slide-{slide.slide_number:03d}.png"
        # Suppress "Glyph X missing from font" for all-caps PDF font subsets —
        # these fire from matplotlib's internal 'lp' line-height probe, not from
        # actual rendered text (which is already filtered by _safe_text_for_font).
        with _warnings.catch_warnings():
            _warnings.filterwarnings(
                "ignore",
                message=r"Glyph \d+.*missing from font",
                category=UserWarning,
            )
            fig.savefig(dest, dpi=dpi, bbox_inches="tight", pad_inches=0)
        fig.clf()
        paths.append(dest)
    return paths


def compare_with_original(
    doc: PercyDocument,
    pptx_path: str | Path,
    out_dir: str | Path,
    dpi: int = 150,
) -> list[Path]:
    """
    Render side-by-side comparison PNGs: Bridge rendering (left) vs
    original PowerPoint rendering (right).

    Requires PowerPoint on the local machine for the right panel.
    If PowerPoint is unavailable, only the Bridge rendering is saved.

    Returns a list of paths to the comparison PNG files.
    """
    import numpy as np
    from PIL import Image as PILImage

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Try to render the original PPTX with PowerPoint
    from percy.diagnostics.render import render_pptx
    orig_tmp = out / "_originals"
    orig_result = render_pptx(pptx_path, orig_tmp)
    orig_slides = orig_result.get("slides", [])
    pptx_available = orig_result.get("status") == "ok"

    renderer = SlideRenderer(dpi=dpi, theme=doc.theme_colors or None)
    comparison_paths: list[Path] = []

    for slide in doc.slides:
        idx = slide.slide_number - 1
        bridge_fig = renderer.render_slide(slide)

        if pptx_available and idx < len(orig_slides):
            # Build side-by-side figure
            bridge_fig.savefig(_tmp_png := str(out / f"_bridge_{idx}.png"),
                               dpi=dpi, bbox_inches="tight", pad_inches=0)
            plt.close(bridge_fig)

            bridge_img = np.asarray(PILImage.open(_tmp_png).convert("RGB"))
            orig_img   = np.asarray(PILImage.open(orig_slides[idx]).convert("RGB"))

            # Pad to same height
            max_h = max(bridge_img.shape[0], orig_img.shape[0])
            def _pad_h(arr: Any, target_h: int) -> Any:
                pad = target_h - arr.shape[0]
                if pad > 0:
                    arr = np.vstack([arr, np.full((pad, arr.shape[1], 3), 255, dtype=np.uint8)])
                return arr
            bridge_img = _pad_h(bridge_img, max_h)
            orig_img   = _pad_h(orig_img,   max_h)

            # Separator column
            sep = np.full((max_h, 6, 3), 80, dtype=np.uint8)
            combined = np.hstack([bridge_img, sep, orig_img])

            fig, ax = plt.subplots(figsize=(combined.shape[1] / dpi, combined.shape[0] / dpi), dpi=dpi)
            ax.imshow(combined)
            ax.axis("off")
            W_half = bridge_img.shape[1] / combined.shape[1]
            fig.text(W_half * 0.5, 0.01, "Bridge (Percy)", ha="center", fontsize=9,
                     color="#333333", fontweight="bold")
            fig.text(W_half + 0.5 * (1 - W_half), 0.01, "Original (PowerPoint)",
                     ha="center", fontsize=9, color="#333333", fontweight="bold")
            Path(str(out / f"_bridge_{idx}.png")).unlink(missing_ok=True)

        else:
            # No PowerPoint — just save the Bridge rendering with a label
            fig = bridge_fig
            fig.suptitle("Bridge (Percy)  |  [PowerPoint unavailable]",
                         fontsize=9, color="#888888")

        dest = out / f"slide-{slide.slide_number:03d}.png"
        fig.savefig(dest, dpi=dpi, bbox_inches="tight", pad_inches=0.05)
        plt.close(fig)
        comparison_paths.append(dest)

    return comparison_paths
