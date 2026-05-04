# Percy Workspace App Notes

Last updated: 2026-05-02

## Current Role

The workspace app is the human review surface for Percy roundtrip work. It loads PPTX/PDF files from `outreach/dump_pptx`, `outreach/manual_dump_pptx`, and `outreach/downloads`, renders original/bridge/rebuilt slide images, records human grades, shows diagnostics, and now tracks progress over time.

Use the updated backend/frontend together. The canonical local URL is:

```text
http://127.0.0.1:8000
```

The Vite dev server may still be useful during frontend iteration at `http://127.0.0.1:5173`, but its `/api` proxy expects the backend on `8000`.

## Recent Changes

- Added persistent workspace evaluation history in `outreach/.percy_workspace_history.json`.
- Added backend summary/history endpoints:
  - `GET /api/history`
  - `GET /api/docs/{doc_id}/summary`
- Human slide grades are persisted by source file path and restored when that file is loaded again.
- Rebuild diagnostics now include `slide_number`, so the UI can filter diagnostics for the selected slide.
- The right rail is now an evaluation panel with deck summary, review progress, diagnostic grouping, hot slides, run timeline, and recent deck history.
- Slide thumbnails now show diagnostic badges.
- Loaded-doc rows now show reviewed count and diagnostic count.
- Added local LM Studio vision grading for individual slides:
  - `POST /api/docs/{doc_id}/slides/{n}/vision-grade`
  - Body: `{ "target": "bridge" }` or `{ "target": "rebuilt" }`
  - The route compares original render vs bridge/rebuilt render, computes an RMS diff, sends original/candidate/diff images to LM Studio, records a `vision_grade` history event, and returns the model response.
- The LM Studio prompt asks for element-by-element JSON in `element_comparisons`, including element name, type, approximate location, match/mismatch status, severity, original/candidate descriptions, specific difference, and likely cause.
- Percy serializes slide-level LM Studio grading with a process-local lock. A second request returns `429` instead of stacking concurrent image requests against LM Studio.
- Before sending the slide images, Percy checks LM Studio `/v1/models` and returns a clear error if the configured model is not available.

## LM Studio Assumptions

The slide-level vision grader expects an OpenAI-compatible LM Studio server at:

```text
http://127.0.0.1:1234/v1/chat/completions
```

Default model:

```text
google/gemma-4-e4b
```

The app and diagnostics code request larger response budgets for element-level vision results, but the input/context window for image intake is controlled by the loaded model and LM Studio runtime settings. If LM Studio is not running or the model is not loaded, the API returns an error payload and records a warning event instead of crashing the app.

## Operational Notes

- The backend still stores loaded documents in memory. Restarting the server clears loaded docs, but persisted grade/history snapshots remain on disk.
- Rebuilt/original PowerPoint renders are still produced asynchronously through PowerPoint COM.
- PDF files are visual reconstruction targets. They can be compared as original PDF pages vs bridge renders, but they cannot use the PPTX rebuild path.
- Avoid running stale backends on multiple ports while using the app. If the frontend gets 404s for `/api/history` or `/api/docs/{id}/summary`, it is probably pointed at an older backend.

## Verification Commands

```powershell
python -m py_compile app\backend\main.py src\percy\diagnostics\rebuild.py
cd frontend
npm.cmd run build
```
