"""Shared constants for Percy's bridge model.

Centralizes magic numbers that were previously sprinkled across 20+ files.
Importing from here means a future deck with non-default dimensions (e.g. 4:3
or square) needs to update ONE place, not chase literals across the codebase.
"""

# Default PowerPoint slide dimensions in inches (widescreen 16:9).
# OOXML stores slide size in EMUs (1 inch = 914400 EMU). At the default widescreen
# preset PowerPoint uses 12192000×6858000 EMU = 13.333×7.5 inches. When a deck
# overrides these (via <p:sldSz cx="…" cy="…">), the actual values are surfaced
# through PresentationMetadata.slide_width / slide_height — always prefer those
# at runtime; the constants here are pure fallbacks for synthesized content
# (template previews, agent-generated decks, blank-slide creation).
SLIDE_WIDTH_IN  = 13.333
SLIDE_HEIGHT_IN = 7.5
SLIDE_ASPECT_16_9 = SLIDE_WIDTH_IN / SLIDE_HEIGHT_IN
