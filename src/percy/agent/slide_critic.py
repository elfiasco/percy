"""Vision-pass slide critic.

After the per-slide planner applies a slot's templates, we render the
resulting slide as SVG and hand it to Sonnet 4.6 for critique. The
critic looks at the rendered output and flags:

  * Text overflow / cutoff
  * Awkward element overlap
  * Poor color contrast (text against background)
  * Off-canvas elements
  * Empty / placeholder content that leaked through
  * Slide feels empty or cramped overall

The critique is structured (JSON) so we can either:
  (a) just SURFACE issues in the result for inspection, or
  (b) FEED issues back to the planner for a retry pass

By default this runs on every slide. Can be disabled via the
`vision_pass=False` arg on apply_blueprint for cheap runs.

Cost: ~1 extra LLM call per slide. At Sonnet 4.6 + ~3K input tokens
per call (SVG payload), that's roughly $0.01-$0.02 per slide.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── SVG renderer (server-side mirror of frontend/SlideSvg) ──────────────────


def render_slide_to_svg(
    elements: list[dict[str, Any]],
    *,
    width_in: float = 13.333,
    height_in: float = 7.5,
    background: str = "#FFFFFF",
) -> str:
    """Generate an SVG string from a slide's element JSON.

    Same element shape that GET /api/docs/.../svg-data emits — keeps the
    server-side critic visually equivalent to what users see on screen.
    Output is a minimal SVG (one root, viewBox in inches) so Sonnet can
    parse it as XML without choking on rendering noise.
    """
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width_in} {height_in}">',
        f'<rect x="0" y="0" width="{width_in}" height="{height_in}" fill="{background}"/>',
    ]
    for el in elements or []:
        parts.append(_render_element(el))
    parts.append("</svg>")
    return "".join(parts)


def _render_element(el: dict[str, Any]) -> str:
    pos = el.get("position") or {}
    x = float(pos.get("left_in") or 0)
    y = float(pos.get("top_in") or 0)
    w = float(pos.get("width_in") or 0)
    h = float(pos.get("height_in") or 0)
    if w <= 0 or h <= 0:
        return ""

    et = el.get("type") or ""
    fill_color = (el.get("fill") or {}).get("color")
    out: list[str] = []

    if et in ("BridgeShape", "BridgeFreeform"):
        if fill_color:
            out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="{fill_color}"/>')
        out.append(_render_text(el, x, y, w, h))
    elif et == "BridgeText":
        if fill_color:
            out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="{fill_color}" opacity="0.85"/>')
        out.append(_render_text(el, x, y, w, h))
    elif et == "BridgeChart":
        ct = (el.get("chart_type") or "").lower()
        out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="#FAFAFA"/>')
        out.append(f'<text x="{x + w/2:.3f}" y="{y + h - 0.1:.3f}" font-size="0.13" fill="#9C9EA7" text-anchor="middle">'
                   f'chart:{ct or "?"}</text>')
        out.append(_render_text(el, x, y, w, h))
    elif et == "BridgeTable":
        rows, cols = (el.get("table_dim") or [4, 4])
        out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="#FFFFFF" stroke="#D5D5D5" stroke-width="0.02"/>')
        out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h / max(rows,1):.3f}" fill="#7DA1CC"/>')
    elif et == "BridgeImage":
        out.append(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="#F0F0F0" stroke="#D0D0D0" stroke-width="0.015" stroke-dasharray="0.04 0.04"/>')
    elif et == "BridgeConnector":
        line = el.get("line") or {}
        if line.get("color"):
            out.append(f'<line x1="{x:.3f}" y1="{y:.3f}" x2="{x+w:.3f}" y2="{y+h:.3f}" '
                       f'stroke="{line["color"]}" stroke-width="0.02"/>')
    return "".join(out)


def _render_text(el: dict[str, Any], x: float, y: float, w: float, h: float) -> str:
    runs = el.get("text_runs") or []
    if not runs:
        return ""
    first = runs[0]
    text = "".join((r.get("text") or "") for r in runs)
    if not text.strip():
        return ""
    size_pt = float(first.get("font_size") or 14)
    size_in = size_pt / 72.0
    color = first.get("color") or "#2A2F3A"
    bold = "700" if first.get("font_bold") else "400"
    italic = "italic" if first.get("font_italic") else "normal"
    align = el.get("text_align") or "left"
    anchor = "middle" if align == "center" else "end" if align == "right" else "start"
    tx = x + w/2 if anchor == "middle" else (x + w if anchor == "end" else x)
    ty = y + size_in * 1.1
    # XML-escape minimum
    text_safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (f'<text x="{tx:.3f}" y="{ty:.3f}" font-size="{size_in:.3f}" '
            f'fill="{color}" font-family="Inter, system-ui, sans-serif" '
            f'font-weight="{bold}" font-style="{italic}" text-anchor="{anchor}">'
            f'{text_safe[:300]}</text>')


# ── The critic ──────────────────────────────────────────────────────────────


@dataclass(slots=True)
class CritiqueIssue:
    severity: str    # 'low' | 'med' | 'high'
    description: str
    location: str = ""   # which element / area

    def to_dict(self) -> dict[str, Any]:
        return {"severity": self.severity, "description": self.description,
                "location": self.location}


@dataclass(slots=True)
class Critique:
    overall_quality: str = "good"      # 'good' | 'fair' | 'poor'
    issues: list[CritiqueIssue] = field(default_factory=list)
    would_regenerate: bool = False
    raw: str = ""                       # the LLM's full reasoning

    def to_dict(self) -> dict[str, Any]:
        return {
            "overall_quality": self.overall_quality,
            "issues": [i.to_dict() for i in self.issues],
            "would_regenerate": self.would_regenerate,
        }

    @property
    def has_blocking_issues(self) -> bool:
        return self.would_regenerate or any(i.severity == "high" for i in self.issues)


_CRITIC_SYSTEM = """\
You are reviewing one slide that was just generated. You see a
SIMPLIFIED SVG representation — charts may appear as placeholder
labels, tables as a header bar + outline. That simplification is
intentional and is NOT a slide bug — only flag what would matter to a
real viewer of the final rendered slide.

Flag a slide ONLY if it has at least one of these problems that a
person would actually notice:

  * TEXT OVERFLOW — content visibly extends past its box
    (font_size × character_count significantly > width × 72)
  * COMPLETELY EMPTY TEXT — a text element with no characters at all
    (whitespace + zero alphanumerics)
  * LEAKED PLACEHOLDER — text contains a literal "{{...}}" pattern
  * HARD OVERLAP — two text elements with the same y-range crossing
    horizontally (would render text-on-text)
  * OFF-CANVAS — element position extends past 13.333 × 7.5 inches
  * NO CONTENT AT ALL — slide has zero non-decorative elements

DO NOT flag:
  * Simplified chart placeholders (we know — they're sketches)
  * Slides with only 1-3 elements (often correct for hero / cover slides)
  * Slight visual whitespace
  * Minor stylistic preferences

The slide's intended purpose: {instruction}

Respond with one JSON object, no prose, no fences:

{
  "overall_quality": "good" | "fair" | "poor",
  "issues": [
    {"severity": "low" | "med" | "high",
     "description": "<one short sentence>",
     "location": "<element type / area>"}
  ],
  "would_regenerate": true | false
}

Default to `overall_quality: "good"` and `issues: []` for any slide
that doesn't trip one of the bullets above. `would_regenerate` is for
HIGH-severity issues only.
"""


def critique_slide(
    *,
    slide_elements: list[dict[str, Any]],
    instruction: str,
    llm_call: Callable[[str, str], str],
    width_in: float = 13.333,
    height_in: float = 7.5,
    background: str = "#FFFFFF",
) -> Critique:
    """Render the slide as SVG, send to the LLM, parse the critique."""
    if not slide_elements:
        return Critique(overall_quality="poor",
                        issues=[CritiqueIssue(severity="high",
                                              description="Slide has no elements at all.")],
                        would_regenerate=True)

    svg = render_slide_to_svg(
        slide_elements, width_in=width_in, height_in=height_in, background=background,
    )

    user = json.dumps({
        "slide_instruction": instruction,
        "slide_svg": svg[:14000],
    }, ensure_ascii=False)

    try:
        raw = llm_call(_CRITIC_SYSTEM.replace("{instruction}", instruction or ""), user)
    except Exception as exc:
        log.warning("critique_slide: LLM call failed: %s", exc)
        return Critique(overall_quality="good", raw=str(exc))

    parsed = _parse_json(raw)
    if not parsed:
        return Critique(overall_quality="good", raw=raw[:500])

    return Critique(
        overall_quality=str(parsed.get("overall_quality") or "good"),
        issues=[
            CritiqueIssue(
                severity=str(i.get("severity") or "low"),
                description=str(i.get("description") or ""),
                location=str(i.get("location") or ""),
            )
            for i in (parsed.get("issues") or [])
            if isinstance(i, dict)
        ],
        would_regenerate=bool(parsed.get("would_regenerate") or False),
        raw=raw[:500],
    )


# ── Helpers ────────────────────────────────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except Exception:
        pass
    m = _JSON_BLOCK_RE.search(s)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None
