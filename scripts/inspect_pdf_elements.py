"""Wider-scan diagnostic. Walks every slide + every color attribute."""
import os, sys
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, ".")

from pathlib import Path
from collections import Counter

PDF = "outreach/dump_pptx/salesforce_20260502_CRM-Q4-FY26-Quarterly-Investor-Deck.pdf"

from percy.diagnostics.pdf_onboard import onboard_pdf
print(f"Onboarding {PDF}...")
doc = onboard_pdf(Path(PDF))
print(f"  {len(doc.slides)} slides")

# Element type breakdown
type_counts = Counter()
for slide in doc.slides:
    for el in slide.elements:
        type_counts[type(el).__name__] += 1
print(f"  element types: {dict(type_counts)}")

# Walk every fill path Percy uses
def hex_from(color_obj, theme):
    if color_obj is None: return None
    if not hasattr(color_obj, "value") or not color_obj.value: return None
    try:
        h = color_obj.resolve(theme) if hasattr(color_obj, "resolve") else None
    except Exception:
        h = None
    return h

theme = doc.theme_colors or {}
shape_fill_colors = Counter()
text_fill_colors = Counter()
text_run_colors = Counter()
line_colors = Counter()
border_colors = Counter()
all_color_strings = Counter()

shapes_with_fill = 0
texts_with_fill_and_border = 0
text_runs_total = 0

for slide in doc.slides:
    for el in slide.elements:
        # Shape fill (BridgeShape)
        if hasattr(el, "fill"):
            f = getattr(el, "fill", None)
            if f and getattr(f, "color", None):
                shapes_with_fill += 1
                h = hex_from(f.color, theme)
                if h: shape_fill_colors[h] += 1
                else: all_color_strings[repr(getattr(f.color, "value", None))[:30]] += 1
        # Text fill_and_border (BridgeText)
        if hasattr(el, "fill_and_border"):
            fb = getattr(el, "fill_and_border", None)
            if fb:
                if getattr(fb, "fill_color", None):
                    texts_with_fill_and_border += 1
                    h = hex_from(fb.fill_color, theme)
                    if h: text_fill_colors[h] += 1
                if getattr(fb, "border_color", None):
                    h = hex_from(fb.border_color, theme)
                    if h: border_colors[h] += 1
        # Text runs
        for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
            cur = el
            for a in path.split("."):
                cur = getattr(cur, a, None)
                if cur is None: break
            for para in (cur or []):
                for run in (getattr(para, "runs", None) or []):
                    text_runs_total += 1
                    fc = getattr(run, "font_color", None)
                    if fc:
                        h = hex_from(fc, theme)
                        if h: text_run_colors[h] += 1
        # Line / connector color
        line = getattr(el, "line", None)
        if line:
            h = hex_from(getattr(line, "color", None), theme)
            if h: line_colors[h] += 1

print(f"\n--- Fill scan summary ---")
print(f"  BridgeShape with .fill.color: {shapes_with_fill} elements")
print(f"  BridgeText with .fill_and_border.fill_color: {texts_with_fill_and_border} elements")
print(f"  text runs total: {text_runs_total}")
print(f"  shape_fill_colors:  {dict(shape_fill_colors.most_common(8))}")
print(f"  text_fill_colors:   {dict(text_fill_colors.most_common(8))}")
print(f"  text_run_colors:    {dict(text_run_colors.most_common(8))}")
print(f"  line_colors:        {dict(line_colors.most_common(5))}")
print(f"  border_colors:      {dict(border_colors.most_common(5))}")
print(f"  unresolved color strings: {dict(all_color_strings.most_common(8))}")

# Fonts
fonts = Counter()
for slide in doc.slides:
    for el in slide.elements:
        for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
            cur = el
            for a in path.split("."):
                cur = getattr(cur, a, None)
                if cur is None: break
            for para in (cur or []):
                for run in (getattr(para, "runs", None) or []):
                    if getattr(run, "font_name", None):
                        fonts[run.font_name] += 1
print(f"\n--- Fonts ---")
for n, c in fonts.most_common(10):
    print(f"  {c:5}x  {n}")
