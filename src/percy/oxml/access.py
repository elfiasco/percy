"""Raw OOXML lxml access primitives.

All callers should import namespace constants and accessors from here rather
than hardcoding ``{http://schemas.openxmlformats.org/...}`` strings or calling
``pptx.oxml.ns.qn`` directly. Every accessor is tolerant of ``None`` inputs and
returns ``None`` rather than raising for missing children.

This module is intentionally side-effect free and has no dependency on the rest
of Percy so it can be imported from low-level utilities.
"""

from __future__ import annotations

from typing import Any

# --- Namespaces -------------------------------------------------------------

A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"

NS_MAP = {"a": A_NS, "p": P_NS, "r": R_NS, "c": C_NS}


def q(ns: str, local: str) -> str:
    """Return a Clark-notation qualified name: ``{ns}local``."""
    return f"{{{ns}}}{local}"


def qa(local: str) -> str:
    """Drawingml-namespaced qualified name."""
    return f"{{{A_NS}}}{local}"


def qp(local: str) -> str:
    """Presentationml-namespaced qualified name."""
    return f"{{{P_NS}}}{local}"


def qr(local: str) -> str:
    """Relationships-namespaced qualified name."""
    return f"{{{R_NS}}}{local}"


def qc(local: str) -> str:
    """Chart-namespaced qualified name."""
    return f"{{{C_NS}}}{local}"


# --- Generic find helpers (None-tolerant) -----------------------------------

def _find(element: Any, qname: str) -> Any:
    if element is None:
        return None
    try:
        return element.find(qname)
    except Exception:
        return None


def _findall(element: Any, qname: str) -> list:
    if element is None:
        return []
    try:
        return list(element.findall(qname))
    except Exception:
        return []


def find_a(element: Any, local: str) -> Any:
    """Find a direct child in the drawingml namespace, tolerant of None."""
    return _find(element, qa(local))


def find_p(element: Any, local: str) -> Any:
    """Find a direct child in the presentationml namespace, tolerant of None."""
    return _find(element, qp(local))


def find_c(element: Any, local: str) -> Any:
    """Find a direct child in the chart namespace, tolerant of None."""
    return _find(element, qc(local))


def findall_a(element: Any, local: str) -> list:
    """Findall direct children in the drawingml namespace, tolerant of None."""
    return _findall(element, qa(local))


def find_descendant_a(element: Any, local: str) -> Any:
    """Find descendant ``.//a:local`` tolerant of None."""
    return _find(element, ".//" + qa(local))


# --- Text-frame / paragraph / run accessors ---------------------------------

def find_pPr(p_el: Any) -> Any:
    """Return ``<a:pPr>`` child of a paragraph element, or None."""
    return _find(p_el, qa("pPr"))


def find_rPr(r_el: Any) -> Any:
    """Return ``<a:rPr>`` child of a run element, or None."""
    return _find(r_el, qa("rPr"))


def find_lstStyle(txBody: Any) -> Any:
    """Return ``<a:lstStyle>`` child of a txBody, or None."""
    return _find(txBody, qa("lstStyle"))


def find_lvl_pPr(lstStyle: Any, level: int) -> Any:
    """Return ``<a:lvlNpPr>`` for the given 0-indexed *level*, or None."""
    if lstStyle is None:
        return None
    return _find(lstStyle, qa(f"lvl{level + 1}pPr"))


def find_bodyPr(txBody: Any) -> Any:
    """Return ``<a:bodyPr>`` child of a txBody, or None."""
    return _find(txBody, qa("bodyPr"))


# --- Bullet accessors -------------------------------------------------------

_BU_TYPES = (("buNone", "none"), ("buChar", "char"), ("buAutoNum", "autonumber"), ("buBlip", "image"))


def bullet_type_from_pPr(pPr: Any) -> str | None:
    """Return the bullet kind string for a pPr-like element, or None."""
    if pPr is None:
        return None
    for tag, label in _BU_TYPES:
        if pPr.find(qa(tag)) is not None:
            return label
    return None


def find_buChar(pPr: Any) -> Any:
    return _find(pPr, qa("buChar"))


def find_buFont(pPr: Any) -> Any:
    return _find(pPr, qa("buFont"))


def find_buBlip(pPr: Any) -> Any:
    return _find(pPr, qa("buBlip"))


def bullet_char_from_pPr(pPr: Any) -> str | None:
    el = find_buChar(pPr)
    return el.get("char") if el is not None else None


def bullet_font_from_pPr(pPr: Any) -> str | None:
    el = find_buFont(pPr)
    return el.get("typeface") if el is not None else None


def find_bu_blip_rid(pPr: Any) -> str | None:
    """Return the r:embed relationship id of a buBlip bullet image, or None."""
    blip_el = find_buBlip(pPr)
    if blip_el is None:
        return None
    inner = _find(blip_el, qa("blip"))
    if inner is None:
        return None
    return inner.get(qr("embed")) or None


# --- Color / fill accessors -------------------------------------------------

def find_solidFill(element: Any) -> Any:
    return _find(element, qa("solidFill"))


def find_srgbClr(element: Any) -> Any:
    return _find(element, qa("srgbClr"))


def find_sysClr(element: Any) -> Any:
    return _find(element, qa("sysClr"))


def find_schemeClr(element: Any) -> Any:
    return _find(element, qa("schemeClr"))


def find_noFill(element: Any) -> Any:
    return _find(element, qa("noFill"))


def find_grpFill(element: Any) -> Any:
    return _find(element, qa("grpFill"))


def find_gradFill(element: Any) -> Any:
    return _find(element, qa("gradFill"))


def find_pattFill(element: Any) -> Any:
    return _find(element, qa("pattFill"))


def find_blipFill(element: Any) -> Any:
    return _find(element, qa("blipFill"))


def find_gsLst(element: Any) -> Any:
    """Return ``<a:gsLst>`` direct child, or None."""
    return _find(element, qa("gsLst"))


def find_gsLst_descendant(element: Any) -> Any:
    """Return descendant ``<a:gsLst>`` (``.//a:gsLst``), or None."""
    return _find(element, ".//" + qa("gsLst"))


def findall_gs(gsLst: Any) -> list:
    return _findall(gsLst, qa("gs"))


def find_lin(element: Any) -> Any:
    return _find(element, qa("lin"))


def find_bgClr(element: Any) -> Any:
    return _find(element, qa("bgClr"))


# --- Geometry / line / effect accessors ------------------------------------

def find_ln(element: Any) -> Any:
    return _find(element, qa("ln"))


def find_prstGeom(element: Any) -> Any:
    return _find(element, qa("prstGeom"))


def find_avLst(element: Any) -> Any:
    return _find(element, qa("avLst"))


def findall_gd(avLst: Any) -> list:
    return _findall(avLst, qa("gd"))


def find_effectLst(element: Any) -> Any:
    return _find(element, qa("effectLst"))


def find_outerShdw(element: Any) -> Any:
    return _find(element, qa("outerShdw"))


# --- Theme accessors --------------------------------------------------------

def find_fontScheme(element: Any) -> Any:
    """Find descendant ``<a:fontScheme>`` (``.//a:fontScheme``), or None."""
    return _find(element, ".//" + qa("fontScheme"))


def find_clrScheme(element: Any) -> Any:
    """Find descendant ``<a:clrScheme>`` (``.//a:clrScheme``), or None."""
    return _find(element, ".//" + qa("clrScheme"))


def find_majorFont(fontScheme: Any) -> Any:
    return _find(fontScheme, qa("majorFont"))


def find_minorFont(fontScheme: Any) -> Any:
    return _find(fontScheme, qa("minorFont"))


def find_latin(fontPart: Any) -> Any:
    return _find(fontPart, qa("latin"))


# --- Presentation-namespace accessors --------------------------------------

def find_p_spPr(element: Any) -> Any:
    """Find ``<p:spPr>`` direct child, or None."""
    return _find(element, qp("spPr"))
