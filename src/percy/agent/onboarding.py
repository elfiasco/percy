"""Onboarding suggestions — what to do with a freshly onboarded deck.

After a user uploads a PPTX and Percy onboards it, this module produces a
prioritized list of "next actions" the agent or user can take:

  * Brand-rule violations (auto-fix one-clicks)
  * Missing alt text for images (accessibility)
  * Slides with low text contrast
  * Stale-looking metrics (numbers without a connect → suggest binding)
  * Duplicate text across slides (potential template extraction candidate)
  * Empty slides (likely scaffolding to fill in)
  * Synthetic groups (large clusters of grouped shapes the user might want
    to convert to a real BridgeGroup)

Each suggestion is structured + carries a one-click fix where possible.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from percy.agent.brand_check import BrandProfile, check_document
from percy.agent.element_index import ElementIndex


@dataclass(slots=True)
class Suggestion:
    kind:        str        # 'brand_fix' | 'alt_text' | 'low_contrast' | 'bind_metric' | 'extract_template' | 'empty_slide' | 'reify_group'
    severity:    str        # 'high' | 'medium' | 'low'
    title:       str        # one-line headline
    detail:      str        # human-readable description
    slide_n:     int | None = None
    element_id:  str | None = None
    auto_fix:    dict | None = None   # ready-to-apply patch op

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


def suggest_for_doc(
    doc: Any,
    *,
    brand_profile: BrandProfile | None = None,
    max_suggestions: int = 30,
) -> list[Suggestion]:
    """Run all suggestion sources and return them ranked by severity."""
    out: list[Suggestion] = []

    # 1. Brand violations (already structured + carry suggested_fix)
    profile = brand_profile or BrandProfile.percy_default()
    brand_report = check_document(doc, profile)
    for v in brand_report.violations[:20]:
        out.append(Suggestion(
            kind="brand_fix",
            severity=v.severity,
            title=f"Brand: {v.kind}",
            detail=v.detail,
            slide_n=v.slide_n,
            element_id=v.element_id,
            auto_fix=v.suggested_fix,
        ))

    # 2. Missing alt text on images
    for slide in (doc.slides or []):
        for el in (slide.elements or []):
            if el.element_type != "BridgeImage":
                continue
            ident = getattr(el, "identification", None)
            eid = str(getattr(ident, "shape_id", "") or "")
            alt = getattr(getattr(el, "accessibility", None), "alt_text", None) or ""
            if not alt or alt.strip() in ("", "image"):
                out.append(Suggestion(
                    kind="alt_text", severity="medium",
                    title="Image missing alt text",
                    detail=f"Slide {slide.slide_number} image '{ident.shape_name}' has no alt_text",
                    slide_n=slide.slide_number, element_id=eid,
                    auto_fix={
                        "endpoint_id": "agent.find_element",  # placeholder; UI can route to "ask AI to fill"
                        "path_args": {},
                        "body": {"query": "describe this image", "context": {
                            "viewing_slide_n": slide.slide_number, "selected_element_id": eid,
                        }},
                    },
                ))

    # 3. Empty slides
    for slide in (doc.slides or []):
        if not slide.elements:
            out.append(Suggestion(
                kind="empty_slide", severity="low",
                title=f"Slide {slide.slide_number} is empty",
                detail="Apply a template or generate content with the agent.",
                slide_n=slide.slide_number,
            ))

    # 4. Synthetic groups → reification suggestion
    idx = ElementIndex.build(doc)
    synthetic_groups = [d for d in idx.digests if d.synthetic]
    for sg in synthetic_groups[:10]:
        if len(sg.synthetic_members) >= 3:
            out.append(Suggestion(
                kind="reify_group", severity="low",
                title=f"Convert '{sg.name}' to a real group",
                detail=f"{len(sg.synthetic_members)} elements share an onboarded group_id; "
                       f"reifying lets you move them as one unit.",
                slide_n=sg.slide_n,
                auto_fix={
                    "endpoint_id": "group.create",
                    "path_args": {"slide_n": sg.slide_n},
                    "body": {"element_ids": sg.synthetic_members, "name": sg.name},
                },
            ))

    # 5. Slides with charts/tables but no connects → suggest binding
    for slide in (doc.slides or []):
        for el in (slide.elements or []):
            if el.element_type not in ("BridgeChart", "BridgeTable"):
                continue
            cp = getattr(el, "custom_properties", None) or {}
            if (cp.get("connect") or {}).get("script"):
                continue
            ident = getattr(el, "identification", None)
            eid = str(getattr(ident, "shape_id", "") or "")
            kind_label = "Chart" if el.element_type == "BridgeChart" else "Table"
            out.append(Suggestion(
                kind="bind_metric", severity="low",
                title=f"Bind {kind_label.lower()} to live data",
                detail=f"{kind_label} '{ident.shape_name}' on slide {slide.slide_number} has no connect script. "
                       f"Attach Python to refresh from your data source.",
                slide_n=slide.slide_number, element_id=eid,
            ))

    # Rank by severity, then by slide number
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda s: (sev_rank.get(s.severity, 3), s.slide_n or 0))
    return out[:max_suggestions]
