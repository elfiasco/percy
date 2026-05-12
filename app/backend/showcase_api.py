"""Showcase API — unauthenticated marketing demo surface.

Powers the scroll-cycling splash section. Returns:

  * The four demo brand Template Sets (Snowflake / BlackRock / Caterpillar
    / Salesforce) — all mined from real investor decks via the seeder.
  * Each set's palette, fonts, and a small representative-template preview
    payload the frontend renders as an SVG thumbnail (matching the editor's
    TemplatePreview).
  * Live weather data fetched fresh from Open-Meteo at request time.

The endpoint is intentionally NOT authenticated — it's the landing page.
The data it returns has no PII, just brand metadata and public weather.

Weather is fetched server-side via plain ``urllib`` (no "weather adapter"
in the agent's manifest — the demo's point is the agent can call public
APIs from Python it writes, NOT that Percy ships a weather skill). The
showcase backend handles the fetch + cache; the marketing splash just
renders the result.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from typing import Any

from fastapi import APIRouter, HTTPException

from . import auth_db

log = logging.getLogger("percy.showcase")
router = APIRouter(tags=["showcase"])


# ── The brand roster (slug → display copy) ──────────────────────────────────
#
# Slugs match `demo_brands/<slug>.json` and the seeded `tpl_demo_<slug>` ids.
# Description lines are marketing copy, not part of the seeded data — they
# explain WHY each brand is in the showcase, which is "they look totally
# different from each other."

# Two-brand showcase for v1 of the marketing splash:
#   - Percy Standard (our own hand-crafted brand) acts as the anchor
#   - Snowflake (mined from their real template PPTX) is the customer demo
# Both share the same underlying agent + the same demo prompt — the visual
# difference is entirely driven by mined brand data. We'll add Caterpillar /
# BlackRock / Salesforce back later once their source documents yield
# richer template extractions.
SHOWCASE_BRANDS: list[dict[str, str]] = [
    {
        "slug": "percy_standard",
        "set_id": "tpl_percy_standard_v1",          # Special — hand-crafted, not from a snapshot
        "tagline": "Percy's own brand · warm cream + powder cobalt · hand-crafted",
        "source_kind": "Crafted",
    },
    {
        "slug": "snowflake",
        "tagline": "Cloud data platform · Snowflake cyan · 57-slide source PPTX",
        "source_kind": "PPTX",
    },
]


# ── Weather cache (lazy, ~5 min TTL) ────────────────────────────────────────


_WEATHER_CACHE: dict[str, Any] = {"data": None, "fetched_at": 0}
_WEATHER_TTL_SECONDS = 300

_WEATHER_CITIES = [
    ("New York", "NYC", 40.7128, -74.0060),
    ("San Francisco", "SFO", 37.7749, -122.4194),
    ("London", "LON", 51.5072, -0.1276),
    ("Tokyo", "TYO", 35.6762, 139.6503),
    ("Singapore", "SIN", 1.3521, 103.8198),
]


def _fetch_weather() -> dict[str, Any]:
    """Hit Open-Meteo for each city. Used by /api/showcase to prove that
    the data slide on each demo deck is honestly live, not baked-in."""
    rows: list[dict[str, Any]] = []
    for name, code, lat, lon in _WEATHER_CITIES:
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            "&current=temperature_2m,wind_speed_10m,weather_code"
            "&temperature_unit=fahrenheit"
        )
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PercyShowcase/1.0"})
            with urllib.request.urlopen(req, timeout=6.0) as r:
                data = json.loads(r.read())
            cur = data.get("current") or {}
            rows.append({
                "city": name, "code": code,
                "temp_f": round(float(cur.get("temperature_2m", 0)), 1),
                "wind_kph": round(float(cur.get("wind_speed_10m", 0)), 1),
                "weather_code": int(cur.get("weather_code", 0)),
            })
        except Exception as exc:
            log.warning("showcase weather: %s failed: %s", name, exc)
            rows.append({"city": name, "code": code, "temp_f": None, "wind_kph": None})

    valid = [r for r in rows if r.get("temp_f") is not None]
    summary: dict[str, Any] = {}
    if valid:
        hot = max(valid, key=lambda r: r["temp_f"])
        cold = min(valid, key=lambda r: r["temp_f"])
        avg = sum(r["temp_f"] for r in valid) / len(valid)
        summary = {
            "hottest_city": hot["city"], "hottest_temp_f": int(round(hot["temp_f"])),
            "coldest_city": cold["city"], "coldest_temp_f": int(round(cold["temp_f"])),
            "avg_temp_f": int(round(avg)),
            "city_count": len(valid),
            "oneliner": " · ".join(f"{r['code']} {int(round(r['temp_f']))}°F" for r in valid),
        }
    return {
        "rows": rows,
        "summary": summary,
        "source": "Open-Meteo · fetched " + time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
        "fetched_at": int(time.time()),
    }


def _get_weather_cached() -> dict[str, Any]:
    now = time.time()
    cached = _WEATHER_CACHE.get("data")
    fetched_at = _WEATHER_CACHE.get("fetched_at", 0)
    if cached and (now - fetched_at) < _WEATHER_TTL_SECONDS:
        return cached
    try:
        fresh = _fetch_weather()
        _WEATHER_CACHE["data"] = fresh
        _WEATHER_CACHE["fetched_at"] = now
        return fresh
    except Exception as exc:
        log.warning("showcase weather fetch failed; returning stale cache: %s", exc)
        return cached or {"rows": [], "summary": {}, "source": "unavailable", "fetched_at": 0}


# ── Endpoint ────────────────────────────────────────────────────────────────


@router.get("/api/showcase")
def get_showcase() -> dict[str, Any]:
    """Public marketing showcase. No auth.

    Returns each demo brand's full Template Set context plus a fresh
    weather payload. The splash page consumes this to render the scroll-
    cycling demo.

    Performance:
      * Brand sets come straight from the seeded studio_templates rows.
      * Weather is cached server-side for 5 minutes (Open-Meteo is fast
        and free but no point hammering it).
      * Total payload ~10-30KB depending on how many templates per set.
    """
    brands: list[dict[str, Any]] = []
    for entry in SHOWCASE_BRANDS:
        slug = entry["slug"]
        # Allow override (Percy Standard uses tpl_percy_standard_v1).
        set_id = entry.get("set_id") or f"tpl_demo_{slug}"
        tpl = auth_db.get_template(set_id)
        if not tpl:
            log.warning("showcase: demo brand %s not seeded yet — skipping", slug)
            continue
        items = auth_db.list_template_set_items(set_id)
        # Hydrate items with their underlying agent template so the
        # frontend can render TemplatePreview SVGs directly.
        try:
            from percy.agent import templates as _agent_tpls
            for it in items:
                it["template"] = _agent_tpls.get_template(it["template_id"])
        except Exception:
            pass
        # Demo deck info — the splash renders the slides directly from
        # this payload, no per-slide HTTP fetches. demo_slides_json
        # survives server restarts (persisted at generation time).
        demo_block = None
        demo_summary = tpl.get("last_demo_summary") or {}
        persisted_slides = tpl.get("demo_slides_json") or []
        if persisted_slides:
            demo_block = {
                "doc_id": tpl.get("last_demo_doc_id"),
                "project_id": tpl.get("last_demo_project_id"),
                "generated_at": tpl.get("last_demo_at"),
                "slides_applied": len(persisted_slides),
                "demo_id": demo_summary.get("demo_id"),
                "demo_name": demo_summary.get("demo_name"),
                "slides": persisted_slides,    # full element JSON per slide
            }

        brands.append({
            "slug": slug,
            "set_id": set_id,
            "name": tpl["name"],
            "tagline": entry["tagline"],
            "source_kind": entry["source_kind"],
            "description": tpl.get("description") or "",
            "palette": tpl.get("palette") or [],
            "fonts": tpl.get("fonts") or [],
            "instructions_md": tpl.get("instructions_md") or "",
            "style_profile": tpl.get("style_profile") or {},
            "items": items,
            "demo": demo_block,
        })

    # Resolve the actual canned prompt text so the splash can display it on
    # the left side of each brand panel — the exact brief both agents got.
    from percy.agent.demo_prompts import get_demo_prompt, DEFAULT_DEMO_ID
    try:
        demo = get_demo_prompt(DEFAULT_DEMO_ID)
        # Blueprint-driven demos store the brief as JSON, not a prose
        # string. Serialize for the splash so the user can read the
        # actual deck_summary + per-slot instructions.
        if getattr(demo, "blueprint", None):
            prompt_text = json.dumps(demo.blueprint, indent=2)
        else:
            prompt_text = demo.prompt
        prompt_name = demo.name
        prompt_slide_count = demo.slide_count
        prompt_kind = "blueprint" if getattr(demo, "blueprint", None) else "prose"
    except Exception:
        prompt_text = ""
        prompt_name = "Showcase brief"
        prompt_slide_count = 7
        prompt_kind = "prose"

    weather = _get_weather_cached()

    return {
        "brands": brands,
        "weather": weather,
        "served_at": int(time.time()),
        "prompt_text": prompt_text,
        "prompt_name": prompt_name,
        "prompt_slide_count": prompt_slide_count,
        "prompt_kind": prompt_kind,
        "prompt_summary": (
            f"Same {prompt_slide_count}-slide brief for every brand. The "
            "agent picks templates from each set; same locked content + "
            "data on both runs."
        ),
    }


def register_showcase_router(app) -> None:
    app.include_router(router)
    log.info("showcase: registered /api/showcase")
