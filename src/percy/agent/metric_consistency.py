"""Cross-deck metric consistency.

Walks every doc accessible to a user/org, extracts every numeric value with
its label, and surfaces metrics defined inconsistently across decks.

This is the deterministic backbone for the vision-doc claim:
  "Identify stale or inconsistent metrics"
  "Which decks in the company define ARR differently than our current definition?"

Deterministic = no LLM required. Strong recall, possibly noisy precision —
which is fine for a "review and dismiss" UI affordance.

Detection strategies:

  * **Same label, different value**
    "Revenue: $4.2M" on slide 1 of deck A, "Revenue: $4.5M" on slide 7 of deck B.
    Surfaced as a possible discrepancy.

  * **Same label, very different format**
    "ARR" defined once with a number and once with a percentage.
    Likely a definitional drift.

  * **Numbers without labels**
    Standalone numbers that don't match any other metric in the corpus —
    candidates for "this should be bound to a metric source".
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


_METRIC_PATTERNS = [
    # "Revenue: $4.2M" / "Revenue $4.2M" / "Revenue = $4.2M"
    re.compile(r"(?P<label>[A-Z][\w\s&/]{2,40}?)\s*[:=]?\s*(?P<value>[$€£]?\s*[-+]?[\d,]+(?:\.\d+)?\s*[MmKkBb%]?)"),
    # "$4.2M Revenue"
    re.compile(r"(?P<value>[$€£]?\s*[-+]?[\d,]+(?:\.\d+)?\s*[MmKkBb%]?)\s+(?P<label>[A-Z][\w\s&/]{2,40})"),
]


@dataclass(slots=True)
class MetricInstance:
    doc_id:       str
    doc_name:     str
    slide_n:      int
    element_id:   str | None
    label:        str
    value:        str
    normalized_label: str
    normalized_value: float | None    # numeric part for comparison
    raw_format:   str                 # "$4.2M" → "currency_million"

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass(slots=True)
class MetricCluster:
    label:      str
    instances:  list[MetricInstance] = field(default_factory=list)

    @property
    def is_inconsistent(self) -> bool:
        if len(self.instances) < 2:
            return False
        formats = {m.raw_format for m in self.instances}
        if len(formats) > 1:
            return True
        # Same format, different values
        values = {m.normalized_value for m in self.instances if m.normalized_value is not None}
        return len(values) > 1

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "instance_count": len(self.instances),
            "is_inconsistent": self.is_inconsistent,
            "formats": sorted({m.raw_format for m in self.instances}),
            "values": sorted({m.value for m in self.instances}),
            "instances": [m.to_dict() for m in self.instances],
        }


# ── Extraction ─────────────────────────────────────────────────────────────


def extract_metrics(doc: Any, *, doc_id: str, doc_name: str = "") -> list[MetricInstance]:
    """Pull every (label, value) pair out of every text-bearing element."""
    out: list[MetricInstance] = []
    for slide in (doc.slides or []):
        for idx, el in enumerate(slide.elements or []):
            text = _all_text(el)
            if not text:
                continue
            ident = getattr(el, "identification", None)
            eid = str(getattr(ident, "shape_id", "") or f"idx_{idx}")

            for pattern in _METRIC_PATTERNS:
                for m in pattern.finditer(text):
                    label = m.group("label").strip()
                    value = m.group("value").strip()
                    out.append(MetricInstance(
                        doc_id=doc_id, doc_name=doc_name,
                        slide_n=slide.slide_number, element_id=eid,
                        label=label, value=value,
                        normalized_label=_normalize_label(label),
                        normalized_value=_normalize_value(value),
                        raw_format=_classify_format(value),
                    ))
    return out


def _all_text(el: Any) -> str:
    """Concatenate all visible text in an element."""
    chunks: list[str] = []
    tc = getattr(el, "text_content", None)
    if tc and getattr(tc, "paragraphs", None):
        for p in tc.paragraphs:
            for r in (getattr(p, "runs", None) or []):
                if getattr(r, "text", None):
                    chunks.append(r.text)
    paras = getattr(el, "paragraphs", None)
    if paras:
        for p in paras:
            for r in (getattr(p, "runs", None) or []):
                if getattr(r, "text", None):
                    chunks.append(r.text)
    # Charts: title + series names
    title = getattr(getattr(el, "title", None), "title", None)
    if title:
        chunks.append(title)
    # Tables: cell texts
    if getattr(el, "data", None):
        for row in el.data:
            chunks.extend(str(c) for c in row if c is not None)
    return " ".join(chunks)


def _normalize_label(label: str) -> str:
    """Collapse whitespace, lowercase, strip trailing punctuation. Coalesce
    near-synonyms via a small alias table."""
    s = re.sub(r"\s+", " ", label.lower()).strip(": .;,-")
    aliases = {
        "annual recurring revenue": "arr", "annual recurring rev": "arr",
        "monthly recurring revenue": "mrr",
        "net revenue retention": "nrr", "net retention": "nrr",
        "customer acquisition cost": "cac",
        "lifetime value": "ltv",
        "gross margin": "gm",
    }
    return aliases.get(s, s)


def _normalize_value(value: str) -> float | None:
    """Strip currency / suffix and produce a comparable float."""
    s = value.replace(",", "").replace(" ", "")
    mult = 1.0
    is_pct = False
    if s.endswith("%"):
        is_pct = True
        s = s[:-1]
    if s.startswith(("$", "€", "£")):
        s = s[1:]
    if s.endswith(("M", "m")):
        mult = 1_000_000.0; s = s[:-1]
    elif s.endswith(("K", "k")):
        mult = 1_000.0; s = s[:-1]
    elif s.endswith(("B", "b")):
        mult = 1_000_000_000.0; s = s[:-1]
    try:
        v = float(s) * mult
        return v / 100 if is_pct else v
    except ValueError:
        return None


def _classify_format(value: str) -> str:
    s = value.strip()
    if s.endswith("%"):
        return "percentage"
    if s.startswith(("$", "€", "£")):
        suffix = s[-1].upper() if s and s[-1].isalpha() else ""
        if suffix == "M": return "currency_million"
        if suffix == "K": return "currency_thousand"
        if suffix == "B": return "currency_billion"
        return "currency"
    if s and s[-1].upper() in ("M", "K", "B"):
        return f"number_{s[-1].upper()}"
    return "number"


# ── Clustering ─────────────────────────────────────────────────────────────


def cluster_metrics(instances: list[MetricInstance]) -> list[MetricCluster]:
    """Group by normalized_label."""
    groups: dict[str, list[MetricInstance]] = defaultdict(list)
    for inst in instances:
        groups[inst.normalized_label].append(inst)
    return [MetricCluster(label=label, instances=insts) for label, insts in groups.items()]


def find_inconsistencies(
    docs: list[tuple[str, str, Any]],
) -> list[MetricCluster]:
    """``docs`` is [(doc_id, doc_name, doc), ...]. Returns clusters where
    the same label appears with different values OR different formats."""
    all_instances: list[MetricInstance] = []
    for doc_id, doc_name, doc in docs:
        all_instances.extend(extract_metrics(doc, doc_id=doc_id, doc_name=doc_name))
    clusters = cluster_metrics(all_instances)
    return [c for c in clusters if c.is_inconsistent]
