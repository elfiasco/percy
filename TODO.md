# Percy — Master TODO

Organized by area, roughly in priority order within each section. Items marked `[BLOCKED]` depend on something else; `[QUICK]` means ≤ 2h; `[DEEP]` means multi-day effort.

---

## 1. Studio — Canvas & Interaction

### 1.1 Element Selection & Manipulation
- [ ] **Multi-select**: Hold Shift and click multiple elements; show combined bounding box with handles that scale/move all selected elements together
- [ ] **Box-select (marquee)**: Drag on canvas background → rubber-band selection box; select all elements whose bounding boxes intersect
- [ ] **Copy / Paste elements**: Ctrl+C / Ctrl+V — serialize selected element(s) to clipboard (JSON), paste creates new element(s) at offset (+10px)
- [ ] **Duplicate**: Ctrl+D — same as copy+paste in one action
- [ ] **Delete element**: Delete/Backspace key when element selected → `DELETE /api/docs/{doc_id}/slides/{n}/elements/{element_id}`
- [ ] **Undo / Redo**: Ctrl+Z / Ctrl+Y — command stack per session; each drag/text-edit/resize pushes a reversible command object
- [ ] **Snap to grid**: Toggle in toolbar; configurable grid size (default 0.1"); snap during drag and resize
- [ ] **Snap to other elements**: Snap to edges/centers of other elements while dragging (alignment guides)
- [ ] **Lock element**: Prevent accidental move/resize; show lock icon in overlay; locked elements still selectable but not draggable
- [ ] **Show/hide element**: Toggle element visibility without deleting; hidden elements shown with dashed outline in studio

### 1.2 Canvas View
- [ ] **Zoom in/out**: Ctrl+scroll or explicit zoom control (25%–400%); canvas scales, overlays scale with it
- [ ] **Pan**: Space+drag or middle-mouse drag; move viewport without deselecting
- [ ] **Fit to window**: Keyboard shortcut (Ctrl+Shift+0); recalculate maxWidth/maxHeight to fill pane
- [ ] **Zoom indicator**: Show "75%" in toolbar; click to type exact zoom level
- [ ] **Rulers**: Horizontal + vertical rulers showing inches, with crosshair tick mark at cursor position
- [ ] **Grid overlay**: Toggle visible grid lines on canvas (does not affect snap state)
- [ ] **Canvas background color**: Show slide background color correctly (not just white); read from Bridge model
- [ ] **Slide boundary shadow**: Subtle border/shadow on slide edges to distinguish slide from canvas background

### 1.3 Slide Management
- [ ] **Add slide**: Button in slide strip → `POST /api/docs/{doc_id}/slides` → inserts blank slide at position N
- [ ] **Delete slide**: Context menu on slide thumbnail → `DELETE /api/docs/{doc_id}/slides/{n}` → reindexes
- [ ] **Reorder slides**: Drag-and-drop in slide strip → `PATCH /api/docs/{doc_id}/slides/order` body: `{order: [3,1,2,4]}`
- [ ] **Duplicate slide**: Context menu → `POST /api/docs/{doc_id}/slides/{n}/duplicate`
- [ ] **Slide notes**: Panel below canvas or in properties; `GET/PATCH /api/docs/{doc_id}/slides/{n}/notes`
- [ ] **Slide background editor**: Click canvas background → background editor in properties panel (solid fill, gradient, image)

### 1.4 Element Addition
- [ ] **Add text box**: Button in toolbar → click/drag on canvas → creates `BridgeText` at position, blank paragraph ready to type
- [ ] **Add shape**: Shape picker dropdown → rectangle, ellipse, rounded rect, triangle, arrow → creates `BridgeShape`
- [ ] **Add image**: File picker → upload → creates `BridgeImage` at center of slide; `POST /api/docs/{doc_id}/slides/{n}/elements/image`
- [ ] **Add connector**: Line tool → click-drag between two anchor points → creates `BridgeConnector`

### 1.5 Thumbnail / Preview
- [ ] **Live thumbnail update**: After any Studio edit that changes Bridge data, trigger a lightweight re-render of the affected slide thumbnail (not full Rebuild); `POST /api/docs/{doc_id}/slides/{n}/render` → re-renders bridge.png via render_png.py
- [ ] **Pending-changes indicator**: When Bridge data has been modified but not rebuilt, show a badge/dot on the slide thumbnail and a "Unsaved changes — Rebuild to export" banner
- [ ] **Canvas live preview mode (future)**: Render element outlines/fills directly in the canvas from Bridge data without a PNG, so edits feel instant (no round-trip PNG needed)

---

## 2. Studio — Properties Panel & Toolbar

### 2.1 Shape Fill Editing
- [ ] **Fill type selector**: None / Solid / Gradient / Pattern — dropdown in properties panel
- [ ] **Solid fill color picker**: Full color picker (hue wheel + hex input + opacity) when solid fill selected
- [ ] **Gradient fill editor**: Add/remove gradient stops; drag stop positions; angle control
- [ ] **No fill (transparent)**: Toggle to make shape background transparent
- [ ] Backend: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/fill` body: `{fill_type, color, gradient_stops, angle}`

### 2.2 Shape Line/Border Editing
- [ ] **Line color picker**: Color picker for `BridgeShape.line.color`
- [ ] **Line width input**: Number input (pt)
- [ ] **Line dash style**: Solid / Dashed / Dotted / DashDot dropdown
- [ ] **Line visibility toggle**: Show/hide border
- [ ] **Connector endpoints**: Head/tail arrow style dropdown (none, arrow, open, diamond) for `BridgeConnector`
- [ ] Backend: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/line`

### 2.3 Text Panel — Phase 2
- [ ] **Font family picker**: Dropdown/typeahead of fonts; `GET /api/docs/{doc_id}/fonts` returns embedded font names + common system fonts
- [ ] **Color picker on runs**: Replace basic swatch with full color picker popover
- [ ] **Add/remove runs**: Split a run at cursor, merge adjacent runs
- [ ] **Add/remove paragraphs**: "+" button to append empty paragraph; delete button on paragraph row
- [ ] **Paragraph spacing inputs**: Space Before / Space After fields per paragraph
- [ ] **Line spacing input**: Multiplier field per paragraph (1.0 = single, 1.5 = 1.5x)
- [ ] **Indent level**: Step buttons (increase/decrease indent) for bullet levels
- [ ] **Bullet type**: None / Char / Image selector; char input for bullet character
- [ ] **Apply to all**: "Apply format to all runs in paragraph" button in format toolbar
- [ ] **Text frame options**: Word wrap toggle, vertical anchor dropdown (top/middle/bottom), autofit type

### 2.4 Image Properties
- [ ] **Image replacement**: "Replace Image" button → file picker → `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/image`
- [ ] **Crop controls**: Drag crop handles to trim image; commit crop percentages to `BridgeImage.cropping`
- [ ] **Image fit mode**: Stretch / Tile / Fit dropdown → updates `BridgeImage.fill_mode`
- [ ] **Aspect ratio lock**: When resizing image, hold Shift to constrain aspect ratio

### 2.5 Rotation & Transform
- [ ] **Rotation input**: Number field in toolbar (degrees); updates `BridgeElement.transforms.rotation`
- [ ] **Flip horizontal/vertical**: Two buttons → update `transforms.flip_h` / `transforms.flip_v`
- [ ] **Rotation handle**: Show a circular handle above selected element; drag to rotate

### 2.6 Shadow & Effects
- [ ] **Shadow toggle**: On/off for outer shadow on shapes/text
- [ ] **Shadow properties**: Blur radius, distance, direction angle, color — all editable
- [ ] Backend: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/effects`

---

## 3. Backend API — Local (`app/backend/main.py`)

### 3.1 Missing Element CRUD
- [ ] **DELETE element**: `DELETE /api/docs/{doc_id}/slides/{n}/elements/{element_id}` → removes from `slide.elements`; returns updated element list
- [ ] **POST element (text box)**: `POST /api/docs/{doc_id}/slides/{n}/elements` body: `{type: "BridgeText", left_in, top_in, width_in, height_in, text?}` → creates new `BridgeText` and appends to slide
- [ ] **POST element (shape)**: Same endpoint, `type: "BridgeShape"`, `geometry_preset: "rect"|"ellipse"` etc.
- [ ] **POST element (image)**: `POST /api/docs/{doc_id}/slides/{n}/elements/image` — multipart upload; creates `BridgeImage` with uploaded bytes
- [ ] **Duplicate element**: `POST /api/docs/{doc_id}/slides/{n}/elements/{element_id}/duplicate` → deep-copy element, offset position by 0.2" on both axes, return new element
- [ ] **Reorder elements (z-index bulk)**: `PATCH /api/docs/{doc_id}/slides/{n}/elements/reorder` body: `{order: ["id1","id3","id2"]}` → reassigns z_index values sequentially

### 3.2 Missing Slide CRUD
- [ ] **POST slide**: `POST /api/docs/{doc_id}/slides` body: `{after_slide_n?: int}` → inserts blank BridgeSlide, returns new slide metadata
- [ ] **DELETE slide**: `DELETE /api/docs/{doc_id}/slides/{n}` → removes slide, reindexes slide_number on remaining slides
- [ ] **Reorder slides**: `PATCH /api/docs/{doc_id}/slides/order` body: `{order: [2,1,3]}` → reorders slides array and renumbers
- [ ] **Duplicate slide**: `POST /api/docs/{doc_id}/slides/{n}/duplicate` → deep-copy, insert after source
- [ ] **Slide notes GET/PATCH**: `GET|PATCH /api/docs/{doc_id}/slides/{n}/notes`

### 3.3 Missing Document Operations
- [ ] **Save/checkpoint Bridge model**: `POST /api/docs/{doc_id}/save` → pickle current in-memory doc to `{workspace}/{stem}.percy`; allows session persistence after server restart
- [ ] **Load from .percy**: `POST /api/docs/load-percy` body: `{path}` → deserialize .percy file, register in `_docs`, return doc metadata
- [ ] **Export rebuilt PPTX**: `GET /api/docs/{doc_id}/export` → run `rebuild_pptx()` on current Bridge model → stream resulting .pptx file as download; this is the primary "save" action from Studio
- [ ] **Re-render single slide PNG**: `POST /api/docs/{doc_id}/slides/{n}/render` → call `render_png.render_slide()` on the Bridge model → overwrite bridge.png for that slide; return `{ok: true, cache_bust: N}`
- [ ] **List document fonts**: `GET /api/docs/{doc_id}/fonts` → return names from `doc.fonts` dict (embedded fonts) + a curated list of common system fonts

### 3.4 Fill/Line/Effects Endpoints
- [ ] **PATCH fill**: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/fill` → update `ShapeFill` on BridgeShape, `FillAndBorder` on BridgeText
- [ ] **PATCH line**: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/line` → update `ShapeLine` on BridgeShape
- [ ] **PATCH effects**: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/effects` → update `ShapeShadow`
- [ ] **PATCH rotation/flip**: Add `rotation`, `flip_h`, `flip_v` to existing `ElementPositionUpdate` model

### 3.5 Chart Data Editing
- [ ] **GET chart data**: `GET /api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data` → serialize `ChartSeries[]`, `ChartCategories`, chart_type, workbook cells
- [ ] **PATCH chart data**: `PATCH /api/docs/{doc_id}/slides/{n}/elements/{element_id}/chart-data` → call `refresh_chart_data()` with new values/categories; accept DataFrame-style JSON `{categories: [...], series: [{name, values: [...]}, ...]}`
- [ ] **PATCH chart appearance**: Separate endpoint for series colors, data label settings, axis min/max, gridlines

### 3.6 Serialization Improvements
- [ ] **`_serialize_element()` — add text preview**: Include `text_preview: str` (first 60 chars of flattened text) for elements that have text; useful for the element list in the slide strip hover
- [ ] **`_serialize_element()` — add fill info**: Include `fill_color: str | null` and `fill_type: str | null` so overlays can be tinted by actual fill color
- [ ] **Slide-level metadata endpoint**: `GET /api/docs/{doc_id}/slides/{n}/metadata` → slide width/height, background fill, notes, slide_number, layout_name

---

## 4. Bridge Model — Mutations & Data Layer

### 4.1 New Mutation Functions (`bridge/data.py`)
- [ ] **`add_text_element(slide, text, position, font_size=18, bold=False) -> BridgeText`**: Factory to create a fully-initialized `BridgeText` with one paragraph and one run; append to slide.elements
- [ ] **`add_shape_element(slide, geometry_preset, position, fill_color=None, text=None) -> BridgeShape`**: Create `BridgeShape` with sensible defaults
- [ ] **`duplicate_element(element) -> BridgeElement`**: Deep-copy any BridgeElement subclass (handle image bytes, paragraph lists, etc.); offset position slightly
- [ ] **`delete_element(slide, element_id) -> None`**: Remove by shape_id or index; renumber z_index values
- [ ] **`reorder_elements(slide, id_order: list[str]) -> None`**: Set z_index on each element based on position in id_order list
- [ ] **`add_slide(document, after_index=-1) -> BridgeSlide`**: Insert blank slide with correct slide_number
- [ ] **`delete_slide(document, slide_number) -> None`**: Remove and renumber remaining slides
- [ ] **`duplicate_slide(document, slide_number) -> BridgeSlide`**: Deep-copy slide and all elements; append after source
- [ ] **`reorder_slides(document, new_order: list[int]) -> None`**: Reorder slide list; renumber slide_number fields
- [ ] **`set_element_fill(element, fill_type, color=None, gradient_stops=None, angle=0.0) -> None`**: Update ShapeFill on BridgeShape; FillAndBorder on BridgeText/BridgeFreeform
- [ ] **`set_element_line(element, visible, color=None, width=None, dash_style="solid") -> None`**: Update ShapeLine
- [ ] **`set_element_shadow(element, has_shadow, blur=None, distance=None, direction=None, color=None) -> None`**: Update ShapeShadow
- [ ] **`set_element_rotation(element, rotation_deg, flip_h=None, flip_v=None) -> None`**: Update transforms

### 4.2 Rich Text Improvements
- [ ] **`split_run(paragraph, run_idx, split_at_char) -> (TextRun, TextRun)`**: Split one run into two at character position; used for partial formatting
- [ ] **`merge_runs(paragraph, run_idx_a, run_idx_b) -> TextRun`**: Merge two adjacent runs (must have same formatting); combine text
- [ ] **`insert_paragraph(element, after_idx, alignment=None) -> TextParagraph`**: Insert blank paragraph
- [ ] **`delete_paragraph(element, para_idx) -> None`**: Remove paragraph and its runs
- [ ] **`apply_format_to_range(element, para_idx, run_start, run_end, **fmt) -> None`**: Apply bold/italic/size/color to a range of runs across a paragraph; handles splitting boundary runs

### 4.3 ColorSpec Improvements
- [ ] **`resolve_color_spec(cs: ColorSpec, theme_colors: dict) -> str`**: Fully resolve theme color + all OOXML modifiers to `#RRGGBB`; the current `resolve()` method doesn't always have theme_colors available
- [ ] **Theme color extraction**: `GET /api/docs/{doc_id}/theme` → return the document's theme color palette (dk1/lt1/accent1-6 etc.) resolved to hex values; use in Studio color pickers
- [ ] **Serialize ColorSpec properly**: When returning font_color from text endpoints, prefer `resolve()` to `value` so frontend always gets a usable hex string

---

## 5. Rebuild / Export

### 5.1 Rebuild-from-Studio Flow
- [ ] **Export button in toolbar**: Triggers `GET /api/docs/{doc_id}/export` → downloads rebuilt .pptx; show progress spinner (rebuild can take 5-10s)
- [ ] **Selective slide rebuild**: `POST /api/docs/{doc_id}/rebuild` body: `{slides?: [1,2,3]}` → only rebuild specified slides (faster iteration)
- [ ] **Rebuild status polling**: Rebuild runs in a background thread; `GET /api/docs/{doc_id}/rebuild-status` returns `{status: "building"|"done"|"error", progress_slide: N, total_slides: N}`
- [ ] **Auto-save before rebuild**: Before running rebuild, automatically pickle the Bridge model to disk so changes aren't lost on server restart

### 5.2 Rebuild Fidelity Improvements (rebuild.py)
- [ ] **SmartArt fallback**: Currently SmartArt is not reconstructed. At minimum, preserve as image (extract from PPTX XML, write back as picture placeholder)
- [ ] **Preserve animation XML**: Store raw animation XML per slide during onboard; write it back verbatim during rebuild
- [ ] **Preserve slide notes**: Extract notes during onboard (`BridgeSlide.notes_text`); write back to notes placeholder in rebuilt PPTX
- [ ] **Preserve hyperlinks on shapes**: `BridgeShape` currently stores hyperlinks in `custom_properties`; `rebuild.py` should check and re-apply click action URLs
- [ ] **Improve freeform path fidelity**: Audit cases where freeform uses XML paste fallback vs. proper path rebuild; aim to eliminate the fallback for standard cubic-bezier paths
- [ ] **Chart: preserve data table visibility**: `dispTable` XML flag currently not written back
- [ ] **Chart: leader lines on pie/donut**: `ldrLns` XML not currently reconstructed in `_add_chart()`
- [ ] **Table: diagonal borders**: `BridgeBorders.tl_to_br` / `bl_to_tr` not currently written back in `_add_table()`
- [ ] **Shadow on text boxes**: `BridgeText.shadow` exists but `_add_text()` in rebuild doesn't apply it; add effectLst/outerShdw XML

### 5.3 New Export Formats (future)
- [ ] **Export to PDF**: After rebuilding PPTX, optionally convert to PDF via LibreOffice headless (`libreoffice --headless --convert-to pdf`)
- [ ] **Export slide as PNG**: `GET /api/docs/{doc_id}/slides/{n}/export.png` → higher-res render via render_png (300dpi) for sharing/embedding

---

## 6. Roundtrip / Diagnostic System

### 6.1 Diagnostic Panel Improvements
- [ ] **Per-element diagnostics**: When clicking a diagnostic in the DiagPanel, highlight the corresponding element on the canvas (pass element_id from diagnostic to StudioCanvas to auto-select it)
- [ ] **Diagnostic severity levels**: Add `severity: "error"|"warning"|"info"` to each diagnostic; color code in panel
- [ ] **Auto-fix suggestions**: For common fixable issues (e.g., "font not embedded"), show a "Fix" button that applies the correction to the Bridge model
- [ ] **Diagnostic filtering**: Filter by slide, severity, type; currently the panel shows everything flat
- [ ] **Export diagnostic report**: Download diagnostics as JSON or markdown report

### 6.2 Comparison View Improvements
- [ ] **Side-by-side diff overlay**: In CompareView, a slider/toggle to overlay original vs rebuilt at different opacities (like a ghost overlay)
- [ ] **Pixel diff heatmap**: Show a third panel with per-pixel diff colored by magnitude (red=big diff, transparent=match)
- [ ] **Per-element comparison**: For each Bridge element, report whether its bounding box, text, and fill color match the original; shown as a mini report per element in properties panel
- [ ] **Structural diff**: Show added/removed/moved elements between original and rebuild as a change log

### 6.3 Vision Grading
- [ ] **Abstract LLM backend**: Currently hard-coded to LMStudio. Make the vision grader pluggable — support Claude claude-sonnet-4-6 via Anthropic API as an alternative (much better quality)
- [ ] **Batch vision grading**: Grade all slides in background; show progress; cache results per slide
- [ ] **Structured issue format**: Standardize the vision output schema: `{slide, element_id?, issue_type, description, severity, suggested_fix}`
- [ ] **Vision diff comparison**: Feed both original and rebuilt slide images; ask the model to list differences specifically

### 6.4 Grading System
- [ ] **Grade persistence across sessions**: Currently grades are in-memory; persist to a sidecar `.percy-grades.json` file in workspace
- [ ] **Grade summary dashboard**: Top-level view showing grade distribution across all slides (pie chart or bar chart) in the DiagPanel summary section
- [ ] **Auto-grade on rebuild**: After each rebuild completes, automatically run pixel-diff grading (not vision) for all slides

---

## 7. Cloud Infrastructure

### 7.1 Auth & Multi-Tenancy
- [ ] **JWT authentication**: Add `Authorization: Bearer <token>` header to all cloud API calls; issue tokens via `POST /api/cloud/auth/token` (simple username+password for now, or API key)
- [ ] **Auth middleware**: FastAPI middleware that validates JWT on all `/api/cloud/*` routes; injects `current_user` into request state
- [ ] **API key management**: `POST /api/cloud/orgs/{org_id}/api-keys` → generate opaque API keys for service-to-service auth
- [ ] **RBAC**: Roles per project: `viewer` (read-only), `editor` (can create jobs), `admin` (can manage membership); enforce in endpoint handlers

### 7.2 Document Lifecycle
- [ ] **Document versioning**: Each upload creates a new document version; `GET /api/cloud/documents/{id}/versions` → list; rebuild is always on latest version
- [ ] **Document download**: Currently requires S3 presigned URL; add local dev fallback that streams the file directly
- [ ] **Bundle download**: `GET /api/cloud/documents/{id}/bundle` → download the `.percy` pickle from S3/local; useful for local Studio to load a cloud-onboarded doc
- [ ] **Bundle upload from Studio**: After editing in local Studio, upload modified `.percy` bundle back to cloud storage so cloud workers see the latest version

### 7.3 Job System
- [ ] **Rebuild jobs**: Currently only onboard jobs exist. Add job_type="rebuild" → worker runs `rebuild_pptx()` on stored bundle → uploads rebuilt PPTX to S3; `GET /api/cloud/jobs/{id}/result-url` for download
- [ ] **Job retry**: `POST /api/cloud/jobs/{id}/retry` → re-queue a failed job
- [ ] **Job cancellation**: `DELETE /api/cloud/jobs/{id}` → remove from queue (SQS delete) if not yet started; mark as cancelled if in-progress
- [ ] **Job webhooks**: `POST /api/cloud/projects/{id}/webhooks` → register URL to notify on job completion/failure

### 7.4 Monitoring
- [ ] **Metrics endpoint**: `GET /api/cloud/metrics` → Prometheus-format counters (jobs enqueued, jobs succeeded, jobs failed, avg duration)
- [ ] **Health check improvements**: Current `/health` returns backend type; add database connection test, S3 connection test, SQS reachability
- [ ] **Structured logging**: Add `correlation_id` to all log lines for a given request; log to JSON for CloudWatch ingestion

### 7.5 Infrastructure (infra/ CDK)
- [ ] **Add ECS task definition for rebuild worker**: Currently infra only has onboard worker; add a second ECS service for rebuild jobs on a different SQS queue
- [ ] **Add CloudFront for presigned URL proxy**: Wrap S3 presigned URLs behind CloudFront for consistent CDN caching of built artifacts
- [ ] **Auto-scaling ECS workers**: ECS service auto-scaling based on SQS queue depth (ApproximateNumberOfMessagesVisible); scale down to 0 when idle to save cost
- [ ] **Secret rotation**: Move secrets (DB password, API keys) to AWS Secrets Manager; reference from ECS task definition rather than hardcoded env vars

---

## 8. PDF Onboarding

### 8.1 Detection Improvements
- [ ] **Chart detection in PDFs**: Current PDF onboarding treats charts as vector art. Add a heuristic classifier: if a region has >50% vector paths + axis-like lines + numbers near axes → classify as `BridgeChart` stub with extracted series data (requires OCR on numeric labels)
- [ ] **Better table detection**: Current rect/line grid detection misses some tables; add text-column-alignment-based table detection (group text blocks by X-coordinate into columns)
- [ ] **Annotation extraction**: PDF annotations (sticky notes, highlights) → store in `BridgeSlide.annotations` list for diagnostic reporting
- [ ] **Form field extraction**: PDF form inputs → report as unsupported in diagnostics
- [ ] **Multi-column text flow**: Current text block extraction treats each block independently; add heuristic to detect multi-column layouts and link flows

### 8.2 Fidelity
- [ ] **PDF rendering via Matplotlib (render_png)**: `render_png.py` currently skips PDF-specific rendering differences; add a PDF-specific render path that uses PyMuPDF to render the original page and compare
- [ ] **Font substitution improvement**: Build a more complete mapping from common PDF embedded font names to matplotlib-compatible families
- [ ] **Coordinate precision**: Audit `pdf_y_offset` usage in rebuild; ensure PDF text baselines survive the round-trip

---

## 9. Onboarding (PPTX)

### 9.1 Coverage Gaps
- [ ] **Video/audio placeholder extraction**: Extract media file info (filename, duration) from `<p:pic>` elements with video relationships; store in `BridgeImage` with `fill_mode="video"`
- [ ] **OLE object placeholder**: SmartArt, embedded Excel charts, embedded Word docs → extract XML blob for passthrough preservation
- [ ] **Hidden slide flag**: Extract `<p:sp show="0">` elements; store on `BridgeSlide.hidden`; show/hide toggle in Studio slide strip
- [ ] **Slide transition**: Extract `<p:transition>` XML per slide; store as `BridgeSlide.transition_xml`; write back verbatim in rebuild
- [ ] **Comments/notes full extraction**: Notes currently partially extracted; ensure all speaker note text is captured in `BridgeSlide.notes_text` with formatting
- [ ] **Theme font extraction**: Extract major/minor font from theme XML → store in `PercyDocument.theme_fonts`; use as default fallback in rebuild font resolution

### 9.2 Inheritance Resolution (`inheritance.py`)
- [ ] **Test coverage for edge cases**: Add test cases for: (a) shape with no explicit font but inherited from layout, (b) run with font_color "scheme:DK1" resolved to hex, (c) bullet at indent_level > 0
- [ ] **`resolve_chart_text()`**: New function to extract chart title/axis text with full inheritance chain (chart space txPr → chart title overlay → presentation defaultTextStyle)

---

## 10. Testing

### 10.1 Backend API Tests
- [ ] **Studio element CRUD tests**: Test all PATCH/GET element endpoints with a known PPTX; verify position, text, z_index updates persist in-memory
- [ ] **Text endpoint tests**: For each element type (BridgeText, BridgeShape, BridgeChart, BridgeTable), verify GET returns correct structure and PATCH correctly mutates
- [ ] **Slide management tests**: Test add/delete/reorder/duplicate slide endpoints
- [ ] **Export endpoint test**: Test `GET /export` returns valid PPTX bytes that python-pptx can open

### 10.2 Bridge Data Tests
- [ ] **`add_text_element()` roundtrip**: Create text element, rebuild PPTX, verify text appears in correct position
- [ ] **`delete_element()` test**: Delete an element, verify slide.elements count decreases, verify rebuild doesn't include it
- [ ] **`refresh_chart_data()` with mismatched series count**: Fewer series than original, more series than original — verify correct behavior

### 10.3 Frontend Tests (Vitest)
- [ ] **Set up Vitest**: Add `vitest` and `@testing-library/react` to frontend devDependencies; add `test` script to package.json
- [ ] **ElementOverlay tests**: Test click-to-select, drag-to-move, resize handle interaction
- [ ] **StudioTextPanel tests**: Mock API responses; test B/I/U toggle updates local state; test Apply calls correct API endpoint
- [ ] **StudioToolbar tests**: Test position inputs commit correct values; test arrow-key nudge math

### 10.4 End-to-End (Playwright)
- [ ] **Set up Playwright**: Add `@playwright/test`; configure to start dev server before tests
- [ ] **Golden test**: Load known PPTX → switch to Studio mode → verify element count badge matches expected → select first element → verify properties panel shows
- [ ] **Text edit e2e**: Select text element → click Text tab → click first run → edit text → Apply → verify PNG reloads

---

## 11. Performance & Reliability

### 11.1 Backend Performance
- [ ] **Element lookup cache**: `_find_element()` currently O(N) scan on every request; for large slides (100+ elements) this matters; add an `{element_id: element}` index per slide that's rebuilt when elements list changes
- [ ] **Lazy slide loading**: When a doc has 50+ slides, don't deserialize all slides at once on onboard; keep slides on-demand
- [ ] **Parallel slide rendering**: `render_document()` in render_png.py renders slides sequentially; use `concurrent.futures.ProcessPoolExecutor` for parallel rendering
- [ ] **PNG cache headers**: Add `Cache-Control: max-age=0` + `ETag` based on a hash of the Bridge slide state; allow the browser to use cached PNG when nothing changed

### 11.2 Frontend Performance
- [ ] **Virtualize slide strip**: For 50+ slide documents, the slide strip renders all thumbnails at once; use a virtual list (only render visible thumbnails)
- [ ] **Debounce arrow-key nudge**: Currently each arrow key press fires an API call; debounce so rapid repeated presses batch into one commit
- [ ] **Optimistic UI on commit**: After a drag commit, don't wait for the re-fetch to update the overlay position; treat the DOM position as truth until the re-fetch confirms

### 11.3 Error Handling
- [ ] **Network error recovery in Studio**: If a PATCH request fails, show an error toast (not just console.error) and offer a retry button
- [ ] **Server restart recovery**: If the backend restarts and loses in-memory docs, the frontend gets 404s; detect this and offer to re-onboard the file
- [ ] **Unsaved changes warning**: Before navigating away from Studio or switching documents, warn if there are pending text/position changes that haven't been Rebuilt

---

## 12. Developer Experience

### 12.1 Local Dev
- [ ] **`dev.sh` / `dev.bat` startup script**: Single command to start both backend (`uvicorn`) and frontend (`npm run dev`) with correct working directories and env vars
- [ ] **`.env.example`**: Document all environment variables in a template file
- [ ] **Hot-reload Bridge model changes**: Currently the backend uses `--reload` for code changes, but `.percy` files loaded at startup are lost on reload; add a `--persist-path` option to auto-reload from last saved `.percy`

### 12.2 Code Organization
- [ ] **Extract Studio API into own router**: The studio endpoints in `app/backend/main.py` (2500+ lines) should move to `app/backend/studio_router.py` and be included via `app.include_router()`
- [ ] **Extract diagnostics API into own router**: Same pattern for the grading/vision endpoints
- [ ] **Type stubs for Bridge model**: Generate `.pyi` stub files for the Bridge dataclasses so IDE auto-complete works without importing the full package

### 12.3 Documentation
- [ ] **CLAUDE.md**: Add project-specific instructions for Claude Code — how to run the dev server, test conventions, key architectural decisions
- [ ] **API docs**: FastAPI auto-generates OpenAPI at `/docs`; verify all models have descriptions and example values
- [ ] **Bridge model diagram**: ASCII or image diagram of the full BridgeElement class hierarchy for new contributors

---

## Priority Queue (Next 10 Things to Actually Build)

1. `POST /api/docs/{doc_id}/slides/{n}/render` → single-slide PNG re-render after Studio edits
2. `GET /api/docs/{doc_id}/export` → download rebuilt PPTX from Studio
3. Delete element endpoint + keyboard Delete in Studio
4. Shape fill color editor in properties panel (solid fill first)
5. Font family picker in text panel (use embedded fonts from doc)
6. `GET /api/docs/{doc_id}/theme` → expose theme color palette to Studio color pickers
7. Zoom + pan on canvas
8. Undo/redo command stack (even a simple linear stack)
9. Live thumbnail re-render after edits (pending-changes badge)
10. Multi-select + Shift+click
