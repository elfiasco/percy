"""Replace the placeholder mark SVG in the original 5 mockups with calls to
mountMark() — which inlines the real hand-drawn percy-mark.svg via _shared.js."""
import re
from pathlib import Path

ROOT = Path(__file__).parent
FILES = [
    "01-landing.html",
    "02-dashboard.html",
    "03-studio.html",
    "04-components.html",
    "05-project-detail.html",
]

# The placeholder geometry (clean circle + slash) we used everywhere.
PLACEHOLDER_RE = re.compile(
    r'<svg viewBox="0 0 100 100" fill="none">'
    r'(?:<circle cx="50" cy="50" r="\d+" stroke="currentColor" stroke-width="\d+"/?>)?'
    r'(?:<line x1="\d+" y1="\d+" x2="\d+" y2="\d+" stroke="currentColor" stroke-width="\d+" stroke-linecap="round"/?>)?'
    r'</svg>',
    re.DOTALL,
)

# Pattern variants that may show up: also handle when stroke-width is 6 or 8, etc.
PLACEHOLDER_LOOSE_RE = re.compile(
    r'<svg viewBox="0 0 100 100"[^>]*>\s*'
    r'<circle[^/]*?/?>\s*'
    r'<line[^/]*?/?>\s*</svg>',
    re.DOTALL,
)

PLACEHOLDER_LARGE_RE = re.compile(
    r'<svg viewBox="0 0 100 100"[^>]*>\s*'
    r'<circle[^/]*?stroke-width="6"[^/]*?/?>\s*'
    r'<line[^/]*?stroke-width="6"[^/]*?/?>\s*</svg>',
    re.DOTALL,
)

# Replacement: an empty span we'll mount into via _shared.js
REPL = '<span class="real-mark"></span>'

# Mockups also have a "hero-mark" or "empty-mark" SVG that's a different size.
# We'll catch them by the loose regex.

SCRIPT_BLOCK = (
    '<script src="_shared.js"></script>\n'
    '<script>document.querySelectorAll(".real-mark, .mark").forEach(function(el){'
    'if(el.querySelector("svg")) return;'  # already filled (shouldn't happen)
    'el.innerHTML = window.PERCY_MARK_SVG;'
    '});</script>\n'
    '</body>'
)

for name in FILES:
    p = ROOT / name
    if not p.exists():
        print(f"  skip (missing): {name}")
        continue
    text = p.read_text(encoding="utf-8")

    # Replace all placeholder SVG instances with the empty span.
    n = 0
    text, k = PLACEHOLDER_LOOSE_RE.subn(REPL, text)
    n += k

    # Inject script before </body>
    if "_shared.js" not in text:
        text = text.replace("</body>", SCRIPT_BLOCK)
        injected = True
    else:
        injected = False

    p.write_text(text, encoding="utf-8")
    print(f"  {name}: {n} mark(s) swapped, script injected={injected}")
