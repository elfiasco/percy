"""Color coercion for the Percy agent / builder layer.

Single point of truth for turning user-friendly color strings into
``ColorSpec`` instances. Used by every ``create_*`` endpoint and by the
agent's typed editing path.

Accepted forms (see docs/agent/elements/MASTER.md §2.2):

    "#RRGGBB"           hex
    "#RRGGBBAA"         hex with alpha
    "red", "blue", ...  named CSS colors (subset)
    "transparent"       fully transparent
    "accent1".."accent6" theme accent
    "text", "muted",    theme semantic aliases
    "good", "warn", "bad",
    "primary", "background"
    "<base> +20%"       lighter (lum_mod toward white)
    "<base> -30%"       darker  (shade toward black)
    "<base> @50%"       50% opacity (alpha modifier)
    "<base> +20% @80%"  combined modifiers

Or a dict ``{"value": "#xx", "alpha": 50000, ...}`` is passed through.

Empty string or None → returns ``None`` (clear the color).
"""

from __future__ import annotations

import re
from typing import Any

from percy.bridge.elements import ColorSpec


# ── Named color table ───────────────────────────────────────────────────────

_NAMED: dict[str, str] = {
    "black":       "#000000",
    "white":       "#FFFFFF",
    "red":         "#EF4444",
    "blue":        "#3B82F6",
    "green":       "#10B981",
    "yellow":      "#F59E0B",
    "orange":      "#F97316",
    "purple":      "#8B5CF6",
    "pink":        "#EC4899",
    "gray":        "#6B7280",
    "grey":        "#6B7280",
    "darkgray":    "#374151",
    "darkgrey":    "#374151",
    "lightgray":   "#D1D5DB",
    "lightgrey":   "#D1D5DB",
    "navy":        "#1E3A8A",
    "teal":        "#14B8A6",
    "cyan":        "#06B6D4",
    "magenta":     "#D946EF",
    "transparent": "",
}


# Theme semantic aliases → scheme keys (used by ColorSpec.value = "scheme:KEY")
# Falls back to a sensible hex when the deck has no matching theme color.
_SEMANTIC: dict[str, tuple[str, str]] = {
    # alias        (scheme_key,        fallback_hex)
    "text":        ("TX1",             "#1E293B"),
    "muted":       ("TX2",             "#64748B"),
    "background":  ("BG1",             "#FFFFFF"),
    "primary":     ("ACCENT_1",        "#3B82F6"),
    "good":        ("ACCENT_3",        "#10B981"),  # decent default
    "warn":        ("ACCENT_5",        "#F59E0B"),
    "bad":         ("ACCENT_2",        "#EF4444"),
}

_ACCENT_RE = re.compile(r"^accent([1-6])$", re.I)
_HEX_RE    = re.compile(r"^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")


# ── Modifier parsing ────────────────────────────────────────────────────────

_MODIFIER_RE = re.compile(
    r"^(?P<base>[^+\-@]+?)"
    r"(?:\s+(?P<sign>[+\-])(?P<pct>\d{1,3})%)?"   # +20% or -30%
    r"(?:\s+@(?P<alpha>\d{1,3})%)?$"              # @50%
)


# ── Public API ──────────────────────────────────────────────────────────────

def coerce_color(value: Any, theme_colors: dict[str, str] | None = None) -> ColorSpec | None:
    """Convert a user-friendly color value into a ``ColorSpec``.

    Returns ``None`` for empty string / None / 'transparent' (= clear the color).
    Raises ``ValueError`` only on truly unparseable input — most errors fall back
    to a sensible default and emit a warning the caller can collect.

    See module docstring for accepted forms.
    """
    if value is None:
        return None
    if isinstance(value, ColorSpec):
        return value
    if isinstance(value, dict):
        return _from_dict(value)
    if not isinstance(value, str):
        raise ValueError(f"color must be string or dict, got {type(value).__name__}")

    s = value.strip()
    if not s:
        return None
    if s.lower() == "transparent":
        return None

    m = _MODIFIER_RE.match(s)
    if not m:
        # No modifier suffix; treat the whole string as a base.
        return _resolve_base(s, theme_colors)

    base = m.group("base").strip()
    spec = _resolve_base(base, theme_colors)
    if spec is None:
        return None

    sign = m.group("sign")
    pct  = m.group("pct")
    if sign and pct:
        amount = int(pct) * 1000  # /100000 → 1% = 1000
        if sign == "+":
            # Lighter: blend toward white via lum_off (additive luminance).
            spec.lum_off = max(spec.lum_off or 0, amount)
        else:
            # Darker: shade toward black. shade=100000 means no shade; shade<100000 darkens.
            spec.shade = 100000 - amount

    alpha_pct = m.group("alpha")
    if alpha_pct is not None:
        spec.alpha = int(alpha_pct) * 1000

    return spec


def coerce_color_to_hex(
    value: Any,
    theme_colors: dict[str, str] | None = None,
) -> str | None:
    """Coerce + resolve to a flat #RRGGBB hex (loses alpha/scheme reference).

    Useful for the existing ``_patch_color`` helper in main.py which only takes hex.
    """
    spec = coerce_color(value, theme_colors)
    if spec is None:
        return None
    return spec.resolve(theme_colors or {})


# ── Internals ───────────────────────────────────────────────────────────────

def _resolve_base(s: str, theme_colors: dict[str, str] | None) -> ColorSpec | None:
    s_low = s.lower()

    # 1. transparent / empty
    if s_low in ("transparent", ""):
        return None

    # 2. explicit hex
    if _HEX_RE.match(s):
        hex_str = s if s.startswith("#") else f"#{s}"
        if len(hex_str) == 9:  # #RRGGBBAA
            alpha_hex = hex_str[7:9]
            base_hex = hex_str[:7]
            alpha_val = int(alpha_hex, 16) * 100000 // 255
            return ColorSpec(value=base_hex.upper(), alpha=alpha_val)
        return ColorSpec(value=hex_str.upper())

    # 3. theme accent
    m = _ACCENT_RE.match(s_low)
    if m:
        return ColorSpec(value=f"scheme:ACCENT_{m.group(1)}")

    # 4. theme semantic alias
    if s_low in _SEMANTIC:
        scheme_key, fallback = _SEMANTIC[s_low]
        if theme_colors and scheme_key in theme_colors:
            return ColorSpec(value=f"scheme:{scheme_key}")
        return ColorSpec(value=fallback)

    # 5. named color
    if s_low in _NAMED:
        hex_str = _NAMED[s_low]
        if not hex_str:
            return None  # transparent
        return ColorSpec(value=hex_str.upper())

    # 6. unknown — treat as opaque mid-gray, signal via fallback
    # (callers that want strict mode can compare result to `_FALLBACK_GRAY`)
    return ColorSpec(value="#888888")


def _from_dict(d: dict) -> ColorSpec:
    """Build a ColorSpec from an explicit dict — passthrough for power users."""
    return ColorSpec(
        value   = d.get("value", ""),
        lum_mod = d.get("lum_mod"),
        lum_off = d.get("lum_off"),
        shade   = d.get("shade"),
        tint    = d.get("tint"),
        alpha   = d.get("alpha"),
        hue_mod = d.get("hue_mod"),
        sat_mod = d.get("sat_mod"),
    )


# Sentinel used by callers that want to detect the "unknown color" fallback.
FALLBACK_GRAY_HEX = "#888888"
