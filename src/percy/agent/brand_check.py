"""Brand consistency checker.

Scans a PercyDocument against a brand profile (palette + font set + logo
presence rules) and returns a list of violations with auto-fix suggestions.

Connects to the vision-doc claim "Suggest visual improvements against your
brand rules" — this is the deterministic, fast layer that runs before any
LLM. It never invents brand rules; it checks against an explicit profile.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class BrandProfile:
    """An organization's brand rules."""
    name:           str
    palette_hex:    set[str] = field(default_factory=set)   # canonical brand hex colors
    palette_tolerance: float = 0.05                          # 0-1 — perceptual diff threshold
    fonts:          set[str] = field(default_factory=set)
    logo_required_on:    list[str] = field(default_factory=list)   # e.g. ["title_slide", "footer"]
    forbidden_colors:    set[str] = field(default_factory=set)
    forbidden_fonts:     set[str] = field(default_factory=set)

    @classmethod
    def percy_default(cls) -> "BrandProfile":
        """A reasonable baseline used when no org profile is set."""
        return cls(
            name="Percy Default",
            palette_hex={"#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
                         "#1E293B", "#64748B", "#FFFFFF", "#F1F5F9"},
            palette_tolerance=0.10,
            fonts={"Inter", "Calibri", "Arial", "Helvetica"},
            forbidden_fonts={"Comic Sans MS", "Papyrus"},
        )


@dataclass(slots=True)
class BrandViolation:
    slide_n:    int
    element_id: str | None
    element_type: str | None
    kind:       str       # 'off_palette' | 'off_font' | 'forbidden' | 'missing_logo' | 'low_contrast'
    severity:   str       # 'high' | 'medium' | 'low'
    detail:     str
    found:      str | None = None
    expected:   list[str] = field(default_factory=list)
    suggested_fix: dict | None = None    # {endpoint_id, body, ...} ready to apply

    def to_dict(self) -> dict:
        return {
            "slide_n": self.slide_n, "element_id": self.element_id,
            "element_type": self.element_type,
            "kind": self.kind, "severity": self.severity, "detail": self.detail,
            "found": self.found, "expected": self.expected,
            "suggested_fix": self.suggested_fix,
        }


@dataclass(slots=True)
class BrandReport:
    profile:    str
    violations: list[BrandViolation] = field(default_factory=list)
    slide_count: int = 0
    element_count: int = 0
    palette_seen: set[str] = field(default_factory=set)
    fonts_seen:  set[str] = field(default_factory=set)

    def to_dict(self) -> dict:
        return {
            "profile": self.profile,
            "summary": {
                "violation_count": len(self.violations),
                "by_severity": _count_by(self.violations, "severity"),
                "by_kind":     _count_by(self.violations, "kind"),
                "slide_count": self.slide_count,
                "element_count": self.element_count,
                "palette_seen": sorted(self.palette_seen),
                "fonts_seen":   sorted(self.fonts_seen),
            },
            "violations": [v.to_dict() for v in self.violations],
        }


def _count_by(violations: list[BrandViolation], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in violations:
        k = getattr(v, key)
        out[k] = out.get(k, 0) + 1
    return out


# ── Color helpers ──────────────────────────────────────────────────────────


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int] | None:
    s = hex_str.lstrip("#")
    if len(s) == 8:
        s = s[:6]
    if len(s) != 6:
        return None
    try:
        return int(s[:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except ValueError:
        return None


def _color_distance(a: str, b: str) -> float:
    """Perceptual distance in [0, 1] between two hex colors."""
    ra = _hex_to_rgb(a); rb = _hex_to_rgb(b)
    if ra is None or rb is None:
        return 1.0
    # Weighted RGB distance (cheap perceptual approx)
    dr = (ra[0] - rb[0]) / 255
    dg = (ra[1] - rb[1]) / 255
    db = (ra[2] - rb[2]) / 255
    # Simple Euclidean — fine for "close enough" checks
    return (dr * dr + dg * dg + db * db) ** 0.5 / (3 ** 0.5)


def _closest_palette_color(hex_color: str, palette: set[str]) -> tuple[str, float]:
    if not palette:
        return hex_color, 1.0
    best = min(palette, key=lambda c: _color_distance(hex_color, c))
    return best, _color_distance(hex_color, best)


# ── Element walker ──────────────────────────────────────────────────────────


def _walk_colors(el: Any) -> list[tuple[str, str]]:
    """Yield (location_label, hex) for every resolvable color on the element."""
    out: list[tuple[str, str]] = []
    fill = getattr(el, "fill", None)
    if fill and getattr(fill, "color", None):
        try:
            out.append(("fill", fill.color.resolve({})))
        except Exception:
            pass
    line = getattr(el, "line", None)
    if line and getattr(line, "color", None):
        try:
            out.append(("line", line.color.resolve({})))
        except Exception:
            pass
    # Text colors
    for path_label, runs in _iter_text_runs(el):
        for r in runs:
            c = getattr(r, "font_color", None)
            if c:
                try:
                    out.append((f"text:{path_label}", c.resolve({})))
                except Exception:
                    pass
    return out


def _walk_fonts(el: Any) -> list[str]:
    fonts: list[str] = []
    for _, runs in _iter_text_runs(el):
        for r in runs:
            f = getattr(r, "font_name", None)
            if f:
                fonts.append(f)
    return fonts


def _iter_text_runs(el: Any):
    """Yield (label, list[TextRun]) for every text paragraph in the element."""
    paras = []
    tc = getattr(el, "text_content", None)
    if tc and getattr(tc, "paragraphs", None):
        paras = tc.paragraphs
        label = "shape"
    else:
        paras = getattr(el, "paragraphs", None) or []
        label = "text"
    for i, p in enumerate(paras):
        yield (f"{label}/p{i}", getattr(p, "runs", None) or [])


# ── Main check ─────────────────────────────────────────────────────────────


def check_document(doc: Any, profile: BrandProfile | None = None) -> BrandReport:
    """Scan a PercyDocument against a brand profile."""
    profile = profile or BrandProfile.percy_default()
    report = BrandReport(profile=profile.name)

    for slide in (doc.slides or []):
        report.slide_count += 1
        for idx, el in enumerate(slide.elements or []):
            report.element_count += 1
            ident = getattr(el, "identification", None)
            eid = str(getattr(ident, "shape_id", "") or f"idx_{idx}")
            etype = el.element_type

            for label, color_hex in _walk_colors(el):
                color_hex = color_hex.upper()
                report.palette_seen.add(color_hex)

                if color_hex in profile.forbidden_colors:
                    report.violations.append(BrandViolation(
                        slide_n=slide.slide_number, element_id=eid, element_type=etype,
                        kind="forbidden", severity="high",
                        detail=f"{label} uses forbidden color {color_hex}",
                        found=color_hex, expected=sorted(profile.palette_hex)[:6],
                        suggested_fix=_suggest_color_fix(slide.slide_number, eid, label, color_hex, profile),
                    ))
                    continue

                if profile.palette_hex:
                    closest, dist = _closest_palette_color(color_hex, profile.palette_hex)
                    if dist > profile.palette_tolerance and closest != color_hex:
                        report.violations.append(BrandViolation(
                            slide_n=slide.slide_number, element_id=eid, element_type=etype,
                            kind="off_palette",
                            severity="medium" if dist < 0.3 else "high",
                            detail=f"{label} {color_hex} is off-palette (closest brand color: {closest}, distance {dist:.2f})",
                            found=color_hex, expected=[closest],
                            suggested_fix=_suggest_color_fix(slide.slide_number, eid, label, closest, profile),
                        ))

            for font_name in _walk_fonts(el):
                report.fonts_seen.add(font_name)
                if font_name in profile.forbidden_fonts:
                    report.violations.append(BrandViolation(
                        slide_n=slide.slide_number, element_id=eid, element_type=etype,
                        kind="forbidden", severity="high",
                        detail=f"forbidden font {font_name!r}",
                        found=font_name, expected=sorted(profile.fonts),
                    ))
                elif profile.fonts and font_name not in profile.fonts:
                    report.violations.append(BrandViolation(
                        slide_n=slide.slide_number, element_id=eid, element_type=etype,
                        kind="off_font", severity="low",
                        detail=f"font {font_name!r} not in approved set",
                        found=font_name, expected=sorted(profile.fonts),
                    ))

    return report


def _suggest_color_fix(slide_n: int, element_id: str, label: str,
                        suggested_hex: str, profile: BrandProfile) -> dict | None:
    """Build a ready-to-apply patch op for the agent's executor."""
    if label == "fill":
        return {
            "endpoint_id": "element.style",
            "path_args": {"slide_n": slide_n, "element_id": element_id},
            "body": {"fill_color": suggested_hex},
        }
    if label == "line":
        return {
            "endpoint_id": "element.style",
            "path_args": {"slide_n": slide_n, "element_id": element_id},
            "body": {"border_color": suggested_hex},
        }
    if label.startswith("text"):
        # Text color is per-run; element-level patch isn't reliable. Just hint.
        return {
            "endpoint_id": "element.style",
            "path_args": {"slide_n": slide_n, "element_id": element_id},
            "body": {"text_color": suggested_hex},
        }
    return None
