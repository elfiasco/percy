"""Why did palette extraction find 0 colors for the Snowflake deck?

Inspect the onboarded doc directly: count fills by type, by color shape,
and check whether theme resolution returns valid hex strings.
"""
import os, sys
from collections import Counter
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, ".")

from percy.diagnostics.onboard import onboard_pptx

doc = onboard_pptx(Path("outreach/dump_pptx/snowflake_20260502_Snowflake_Template_light-2019.pptx"))
theme = doc.theme_colors or {}
print(f"theme_colors keys: {list(theme.keys())[:10]} (total {len(theme)})")

fill_type_counter = Counter()
fill_with_value = Counter()
resolved_hex = Counter()
resolved_failed = Counter()

for slide in doc.slides:
    for el in slide.elements or []:
        fill = getattr(el, "fill", None)
        if not fill:
            continue
        ft = getattr(fill, "fill_type", None) or "(none)"
        fill_type_counter[ft] += 1
        fc = getattr(fill, "color", None) or getattr(fill, "fill_color", None)
        if fc and getattr(fc, "value", None):
            fill_with_value[ft] += 1
            try:
                hex_val = fc.resolve(theme)
                if hex_val and hex_val.startswith("#"):
                    resolved_hex[hex_val.upper()] += 1
                else:
                    resolved_failed[f"{ft}:{fc.value[:30]}"] += 1
            except Exception as exc:
                resolved_failed[f"{ft}:exception:{exc}"] += 1

print("\nfill_type distribution:")
for ft, n in fill_type_counter.most_common():
    has_val = fill_with_value.get(ft, 0)
    print(f"  {ft:15}  {n:>5} fills  ({has_val} have a color value)")

print(f"\nresolved to hex ({len(resolved_hex)} unique colors):")
for hex_val, n in resolved_hex.most_common(20):
    print(f"  {hex_val}  x{n}")

if resolved_failed:
    print(f"\nresolution failed ({sum(resolved_failed.values())} total):")
    for reason, n in resolved_failed.most_common(15):
        print(f"  {reason:80}  x{n}")

# Text-color extraction as a sanity check.
text_colors = Counter()
for slide in doc.slides:
    for el in slide.elements or []:
        for path in ("text_frame.paragraphs", "paragraphs", "text_content.paragraphs"):
            cursor = el
            for attr in path.split("."):
                cursor = getattr(cursor, attr, None)
                if cursor is None:
                    break
            for para in (cursor or []):
                for run in (getattr(para, "runs", None) or []):
                    fc = getattr(run, "font_color", None)
                    if fc and getattr(fc, "value", None):
                        try:
                            hex_val = fc.resolve(theme)
                            if hex_val and hex_val.startswith("#"):
                                text_colors[hex_val.upper()] += 1
                        except Exception:
                            pass

print(f"\ntext font_color hex distribution ({len(text_colors)} unique):")
for hex_val, n in text_colors.most_common(10):
    print(f"  {hex_val}  x{n}")
