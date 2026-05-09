# v4 — grounded redesigns of real screens

The earlier mockups (v1–v3) invented content that doesn't exist. They showed dashboards full of "Q3 Investor Update auto-refreshed cleanly · 187 refreshes today · AUM moved from $4.18B to $4.21B" — which made the design easy to *render* but gave you nothing to evaluate, because the real Percy doesn't show any of that yet.

This folder is a redesign of the **actual screens** in `frontend/src/pages/`, using:

- The **real sections** that exist today (greeting, four-stat row, recent decks, pipelines placeholder, activity placeholder)
- **Real placeholder copy** lifted verbatim from the source (e.g. *"Cron-driven auto-refresh ships in phase 2. Until then, this is a label."*)
- **Real data shapes** — the actual schedule options (None / On demand / Hourly / Daily / Weekly / Monthly), the actual build formats (PPTX / PDF / .PERCY / HTML / MD / PNG.ZIP), the actual project fields
- **Realistic content density** — most users have 0–5 projects, most haven't built anything yet, most schedules are still labels
- The **Notebook / Blueprint** aesthetic (subtle graph-paper grid, working-tool feel) since that's what you said felt right

Two screens:

1. **`dashboard.html`** — the actual home page. Greeting, four-stat row (Projects / With source / Edited last 7 days / Workspace role), Recently touched grid, Pipelines placeholder ("when a project has a refresh schedule…"), Activity placeholder ("once people start editing"). All real.
2. **`project-detail.html`** — the actual project detail page. Header, schedule selector with the real options, RefreshJobPanel (Python script, team env, schedule, run history), BuildTimeline (real format pickers, real status timeline). All real.

The point isn't pretty mockups. It's: *this is what the screen would feel like when redesigned with what's actually there today.*

Both with light + dark modes.
