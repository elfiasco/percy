# Percy — Server migration notes (Sept 2026)

Companion doc to **`docs/AWS_SETUP.md`** (the canonical AWS-deploy guide).
This file covers what's specific to *moving Percy to a new server* on top of
the refactor that just landed.

For first-time-from-scratch deploys, read `AWS_SETUP.md` first.

---

## What changed under the hood

A 10-point architectural audit produced a refactor pass. Anything that touches
URLs, color resolution, or PPTX parsing on the new server should be aware of
these — old call sites have either moved or been merged into a canonical
implementation.

### Single sources of truth (new modules)

| Concern | Where to look | Replaces |
|---|---|---|
| **All URLs / endpoints** | `app/backend/config.py` | Inline `localhost:8000`/`localhost:1234`/`localhost:5173` in `auth.py`, `email_service.py`, `team_envs_api.py`, two spots in `main.py`. |
| **Color resolution** | `percy.bridge.elements.ColorSpec.resolve(skip_alpha=...)` | 4 prior implementations: `bridge/colors.py`, `bridge/elements.py`, `render_png.py:_color`, `main.py:_resolve_color`. |
| **OOXML lxml access** | `percy.oxml.access` (40 named accessors) | 173 raw `qn()` / literal-namespace calls across `onboard.py` + `inheritance.py`. |
| **Slide dimensions** | `percy.bridge.constants.SLIDE_WIDTH_IN/HEIGHT_IN`, `studioTypes.SLIDE_WIDTH_IN/HEIGHT_IN` | Literal `13.333` / `7.5` in 6 hot files. |
| **Onboarding entry** | `percy.onboarding.onboard_document(path)` | Direct `onboard_pptx`/`onboard_pdf` calls in main.py + worker. |
| **Renderer loading/error UI** | `frontend/src/components/studio/renderers/RendererShell.tsx` | Per-renderer placeholder divs (5 migrated; 6 had no payload to migrate). |

### Backend `main.py` split

main.py shrunk from **26,590 → 23,851 lines (-10%)** via four router extractions.
Route count preserved at 664 throughout.

| Router | Routes | File |
|---|---|---|
| Tableau | 8 | `app/backend/tableau_routes.py` |
| Export | 9 | `app/backend/export_routes.py` |
| Rendering | 10 | `app/backend/rendering_routes.py` |
| Docs Core | 24 | `app/backend/docs_core_routes.py` |

All extracted routers follow the same `register_X_router(app)` pattern as
`sharing_api.py` / `template_sets_api.py`. The remaining ~80 agent-modal routes
in `main.py` are extractable with the same pattern in a follow-up.

### Bug fixes shipped alongside the refactor

- **Cyrillic font alias typo** (`arialmт` with Cyrillic 'т') removed from `render_png.py:151`. Was a dead no-op alias — no `_FONT_ALIASES` consumer ever hit it because all real lookups went through the Latin `arialmt` entry below it.
- **Duplicate `_hex_to_rgb`** in `main.py` (lines 2962 + 15133) — second silently shadowed the first within the module dict. Merged into one tolerant version that returns `None` on bad input.

### Two non-obvious gotchas

Saved in `~/.claude/.../memory/feedback_*.md` for the next person, and worth
internalizing on the new server because they will both bite again:

1. **Tailwind preflight clamps cropped images.** The base layer injects
   `img { max-width: 100%; height: auto; }`. Any inline `width: >100%` (used by
   PPTX `srcRect` crop scaling) is silently clamped to the wrapper width, which
   loses the offset. Always set `maxWidth: "none"` on cropped images. See
   `BridgeImageRenderer.tsx`.

2. **`ColorSpec.resolve()` pre-blends alpha with white.** When a color has
   `<a:alpha val="…">`, `resolve()` returns an RGB hex *already* pre-blended
   against white (intentional, for the matplotlib pipeline). If you then also
   apply that same alpha as CSS opacity, you get a *double* fade. Pass
   `skip_alpha=True` (or `_color_to_str(c, ignore_alpha=True)`) when the
   caller routes alpha separately to CSS opacity.

---

## Server migration checklist

Once `AWS_SETUP.md` has gotten you to a running stack on the new server, walk
through this list to verify the refactor's new seams work as intended.

- [ ] **URL config.** Confirm `PERCY_API_BASE` and `PERCY_APP_URL` are set
  correctly on the new server. Quick check: `curl ${PERCY_API_BASE}/api/health`
  → `{"ok":true,"service":"percy-studio",...}`. If you see `localhost` in any
  share link, OAuth redirect, or invite email, the env var didn't propagate
  into the running process.

- [ ] **OAuth redirect.** Google OAuth client must have
  `${PERCY_API_BASE}/api/auth/google/callback` registered. `GOOGLE_OAUTH_REDIRECT_URI`
  defaults to that automatically — override only if the path differs.

- [ ] **LLM provider.** `PERCY_LLM_PROVIDER` is auto-detected, but the new
  server should set one of: `bedrock` (with AWS creds + Bedrock model access),
  `anthropic` (with `ANTHROPIC_API_KEY`), `openai` (with `OPENAI_API_KEY`), or
  `lmstudio` (with `PERCY_LMSTUDIO_URL` pointing at an LM Studio host). See
  `app/backend/agent_chat.py` for the detection order.

- [ ] **DB.** Set `PERCY_PG_DSN` if using Postgres in prod, otherwise SQLite
  via `PERCY_AUTH_DB`. Schema auto-creates on first boot.

- [ ] **Backend smoke test.** Hit `/api/health` and verify route count
  matches expectation:
  ```bash
  python -c "from app.backend import main; print(len(main.app.routes))"
  ```
  Should print `664` as of the Sept 2026 refactor.

- [ ] **Fidelity smoke test.** Once a deck is uploaded:
  ```bash
  cd frontend
  node tests/roundtrip/fidelity.mjs --pptx /path/to/sample.pptx --top 0
  ```
  Expect mean RMS around 10 for typical decks. If substantially higher,
  Roboto/Open Sans/Lato/etc. probably aren't loading — check that
  `frontend/index.html`'s Google Fonts `<link>` is reachable from the server.

- [ ] **Color resolution sanity check.** Verify the alpha pre-blend fix is
  live (the double-fade bug discovered Sept 2026):
  ```bash
  python -c "
  from percy.bridge.elements import ColorSpec
  print('with alpha:   ', ColorSpec(value='#10547E', alpha=73725).resolve())
  print('skip alpha:   ', ColorSpec(value='#10547E', alpha=73725).resolve(skip_alpha=True))
  "
  ```
  Expected output:
  ```
  with alpha:    #4F81A0
  skip alpha:    #10547E
  ```

- [ ] **OOXML access.** Verify the new layer is in place:
  ```bash
  python -c "import percy.oxml.access as ox; print(len([a for a in dir(ox) if a.startswith('find_')]))"
  ```
  Should print ≥30 named accessors.

- [ ] **Renderer error surface.** Open Studio, load a deck, and verify a
  failed renderer surfaces a `data-percy-error="..."` placeholder with the
  auto-retry behavior (the placeholder should disappear after ~1s if the
  retry succeeds). This is what `frontend/tests/roundtrip/fidelity.mjs`
  waits for.

---

## Where the bodies are buried

- **main.py is still 23.8k lines.** Four routers were extracted; the remaining
  hotspot is the ~80 agent-modal routes (`/api/docs/{doc_id}/<tool-name>`)
  which all share the same shape: load doc → LLM call → return JSON. These
  should be a single declarative table, not 80 endpoint functions. Same
  `register_X_router(app)` pattern works.
- **Embedded fonts in PPTX are MicroType Express (MTX) compressed EOT**, not
  raw TTF. Chromium can't load them directly without an MTX→TTF decompressor.
  This is why the reside deck has a ~16 RMS floor on Roboto-heavy slides — it
  doesn't fall below that without bundling Roboto separately or implementing
  MTX decompression (multi-day project).
- **Fidelity floor against actual PowerPoint** (PowerPoint COM render as
  ground truth): cross-deck mean ~10.2 RMS, down from 13.6 in mid-September.
  See `~/.claude/.../memory/project_fidelity_baseline.md` for the history.

## Open follow-ups (not blocking migration)

- Split the remaining agent-modal routes out of main.py.
- Migrate the remaining 6 element renderers to `RendererShell` (Group,
  TiptapShape, native Shape, Image, etc. — those without a payload loader).
- The matplotlib reference renderer (`render_png.py`) duplicates chart-shape
  logic that the Recharts-based Studio renderers also implement. A future
  "shared SVG geometry" module could collapse both.
