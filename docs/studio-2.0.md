# Studio 2.0

Studio 2.0 is the move from a server-mutated PowerPoint bridge UI to a native Percy slide editor. Percy should keep Bridge JSON as the canonical persisted model, use Yjs as the live collaborative editing surface, and render/edit Percy objects directly in the browser.

## Principles

- [x] Bridge JSON remains the canonical model for agents, persistence, import, export, and backend jobs.
- [x] Yjs is the source of truth during an active Studio editing session (geometry + style + text + chart + table now write Yjs first).
- [x] The browser owns the hot editing path: drag, resize, rotate, text edits, style changes, table edits, chart edits, selection, undo, and redo.
- [ ] REST APIs become boundaries for opening, saving, importing, exporting, AI operations, and compatibility fallbacks.
- [x] Native DOM/SVG/canvas renderers are preferred for editable objects.
- [ ] PNG rendering is reserved for unsupported, locked, or high-fidelity fallback objects.
- [x] Every Studio mutation should be expressible as a typed command.
- [x] Every renderer should be deterministic from the Studio store, with no hidden fetches.

## Target Architecture

```txt
Bridge JSON from backend
        |
        v
Studio 2.0 store
        |
        +--> Yjs live document
        +--> command/history layer
        +--> canvas renderers
        +--> inspectors/ribbon/toolbars
        +--> collaboration awareness
        |
        v
Debounced Bridge JSON save-back
        |
        v
Export/import boundaries: PPTX, PDF, PNG, HTML
```

## 1. Unified Studio Store

- [x] Create a single client-side store for the active document/session.
- [x] Store deck metadata, slide metadata, active slide, element list, selected IDs, render revisions, loading/error state, and dirty slides.
- [ ] Move `Studio.tsx`, `StudioCanvas.tsx`, properties panels, ribbon, layers, and agent tools onto the same store (in progress — StudioCanvas done, Studio.tsx partial).
- [ ] Remove duplicate local state for elements and selection where possible.
- [x] Derive percent bounds from inch bounds and slide size in one place.
- [x] Add typed selectors for active slide, selected elements, element lookup, and render revisions.
- [x] Add a migration-safe bridge so legacy API refreshes hydrate the same store.

## 2. Local-First Yjs Editing

- [x] Extend the Bridge/Yjs adapter beyond scalar geometry.
- [x] Add Yjs fields/maps for style, table data, chart data (`style_data`, `chart_data`, `table_data` JSON blobs in element Y.Map).
- [x] Make geometry commands write to Yjs first.
- [x] Make style commands write to Yjs first (full style data in Yjs, not just rev bump).
- [x] Make text editing write to Yjs first (via Tiptap Collaboration extension).
- [x] Make table edits write to Yjs first (table_data JSON blob + render_rev bump).
- [x] Make chart edits write to Yjs first (chart_data JSON blob + render_rev bump).
- [x] Add debounced save-back from Yjs snapshot to Bridge JSON (`yjsSaveBack.ts`, 800ms debounce, flushes on room close).
- [ ] Keep REST mutation endpoints for agents and compatibility, but remove them from normal editing hot paths.
- [ ] Add reconciliation checks that detect divergence between Yjs and Bridge JSON.

## 3. Native Rendering Instead Of PNG-First

- [x] Render text boxes natively with Tiptap/DOM (`TiptapTextRenderer`).
- [x] Render preset shapes as SVG (`BridgeShapeRenderer` — 15+ OOXML geometry presets; fallback PNG for unsupported).
- [ ] Render freeforms as SVG paths (still PNG — needs BridgeFreeform path data in API).
- [x] Render connectors as SVG (`ConnectorRenderer`).
- [x] Render tables as native DOM tables with a custom selection/resize overlay (`TiptapTableRenderer`).
- [x] Render charts from structured chart data (`ChartRenderer` via Recharts).
- [x] Render images as native image elements with crop/mask controls (`BridgeImageRenderer` — CSS crop + /raw-image endpoint).
- [x] Keep server PNG fallback for unsupported objects and import-fidelity mode.
- [x] Make fallback usage visible in element metadata (`geometry_preset` now in `_serialize_element` API + `StudioElement` type).

## 4. Pure Renderer Contract

- [x] Replace renderer-level fetching with store-fed renderer props.
- [x] Define a `StudioRendererProps` contract that receives element data, selection/editing state, and command dispatch (in `contract.ts`; extended with `docId`/`slideN`).
- [x] Add element renderer capabilities: selectable, transformable, textEditable, tableEditable, chartEditable, styleEditable, fallbackOnly (in `contract.ts`).
- [x] Keep the renderer registry but make it data-driven and capability-aware.
- [ ] Add renderer parity tests for text, shapes, charts, tables, connectors, images, and fallbacks.

## 5. First-Class Table Editor

- [x] Treat tables as structured grid objects, not only ProseMirror documents.
- [x] Add cell and rectangular range selection state.
- [x] Add row/column resize handles directly on the table (via Tiptap's built-in `resizable: true`).
- [x] Add merge/split commands (Ctrl+M merge, Ctrl+Shift+M split; toolbar hint when cells selected).
- [ ] Add per-side border painting.
- [ ] Add fill/text formatting over selected ranges.
- [x] Add keyboard navigation and clipboard paste from TSV/CSV (TSV paste intercepts clipboard; Tab/Arrow keys via Tiptap).
- [x] Use Tiptap only for rich text inside the active cell.
- [x] Persist table state through Yjs and Bridge JSON.

## 6. Structured Chart Editor

- [x] Keep chart data as a typed Percy object.
- [x] Store chart type, categories, series, axes, legend, labels, plot properties, title, and style in the Studio store.
- [x] Make chart data grid edits local-first (writes to Yjs `chart_data` before REST API; undo history entry).
- [ ] Make chart formatting local-first (currently via REST; Yjs write added but rendering not yet wired to Yjs data).
- [ ] Add chart renderer parity tests against exported PNG/PDF/PPTX targets.
- [ ] Decide where Recharts remains acceptable and where a custom SVG renderer is needed.
- [ ] Preserve export semantics separately from editor rendering.

## 7. Split The Studio Shell

- [ ] Split `Studio.tsx` into shell, command registry, modal host, canvas area, side panels, and data-loading hooks.
- [x] Replace hundreds of modal booleans with a modal/tool registry (`modalRegistry.ts` — `openModal(id)`, `closeModal(id)`, `useModalOpen(id)`).
- [x] Make the ribbon, command palette, context menu, and keyboard shortcuts dispatch shared commands (command registry + undo/redo commands added).
- [ ] Keep AI/audit tools as plugins around the core editor, not inside the core canvas/editor state.
- [x] Add typed command metadata: id, label, icon, keywords, scope, enabled predicate, run handler (`StudioCommand` in `commands.ts`).
- [ ] Lazy-load large modal/tool components.

## Initial Implementation Slices

- [x] Slice A: add the Studio 2.0 store and hydrate it from `fetchSlideElements`.
- [x] Slice B: make `StudioCanvas` read/write elements and selection through the store.
- [x] Slice C: route geometry mutations through store commands, then Yjs, then compatibility REST persistence.
- [x] Slice D: move renderer data fetches into store-owned load paths.
- [x] Slice E: add the renderer capabilities registry.
- [x] Slice F: add the command/tool registry and start moving command palette actions into it.
- [x] Slice G: table TSV paste, merge/split commands, keyboard navigation; table data writes to Yjs.

## Current Implementation Notes

- [x] Added `frontend/src/lib/studio/store.ts` as the shared Studio session store.
- [x] Added `frontend/src/lib/studio/commands.ts` as the command boundary for geometry, flags, style, chart data, and table data.
- [x] Added `frontend/src/lib/studio/undoHistory.ts` — client-side undo/redo with Ctrl+Z/Y wiring.
- [x] Added `frontend/src/lib/studio/modalRegistry.ts` — replaces 320+ boolean modal states with `openModal(id)` / `useModalOpen(id)`.
- [x] Added `frontend/src/lib/collab/yjsSaveBack.ts` — debounced 800ms Yjs → Bridge JSON save-back.
- [x] Extended `bridgeYjsAdapter.ts` with `setElementStyleData`, `patchElementStyleData`, `setElementChartData`, `setElementTableData`.
- [x] Added `BridgeShapeRenderer.tsx` — native SVG renderer for 15+ OOXML geometry presets (rect, roundRect, ellipse, diamond, triangle, pentagon, hexagon, octagon, parallelogram, trapezoid, stars, heart). Falls back to PNG for unsupported presets.
- [x] Added `BridgeImageRenderer.tsx` — native image renderer with CSS crop/mask controls and /raw-image endpoint fallback.
- [x] Added `/api/docs/{doc_id}/slides/{n}/elements/{element_id}/raw-image` endpoint in backend.
- [x] Added `geometry_preset` to `_serialize_element` API and `StudioElement` TypeScript type.
- [x] Added typed selectors: `useSlideElements`, `useSelectedElements`, `useSelectedElement`, `useElementRenderKey`, `useSlideLoading`, `useActiveSlideN`, `useSlideDims`, `useDirtySlides`, `useElementPayload`.
- [x] Wired `StudioCanvas` to read elements, selection, background, loading/error state, and render revisions from the Studio store.
- [x] Wired geometry, z-order, rotation, image insertion, text rewrite refreshes, and context-menu selection into the Studio store.
- [x] Wired `Studio.tsx` to hydrate and mirror the Studio store while legacy panels migrate.
- [x] Routed properties-panel geometry/style/flag mutations through Studio 2.0 commands.
- [x] Routed chart/table editor persistence through Studio 2.0 commands.
- [x] Added store-owned payload loaders for text, style, chart data, and table data.
- [x] Moved text, shape, table, and chart renderers off direct element-data fetching.
- [x] Moved chart/table editor initial loads onto the Studio payload store.
- [x] Added a renderer capabilities contract and extended the existing renderer registry to accept capabilities.
- [x] Added an initial tool/command registry seed for Studio shell decomposition.
- [x] Added debounced cloud autosave from in-memory Bridge JSON back to S3 bundles for cloud-loaded documents.
- [x] Updated the collab snapshot store to use `DATABASE_URL` or AWS-style `DB_*` env vars with safe filesystem fallback.
- [x] Added shift-click rectangular range selection to the table editor and made cell/border formatting apply across selected ranges.

## Acceptance Gates

- [x] Dragging, resizing, rotating, and z-order updates feel instant with no visible server round trip.
- [x] Text edits persist after refresh and sync across two tabs.
- [ ] Table cell edits, range formatting, and row/column resize persist after refresh.
- [x] Chart data edits update the chart immediately and persist after refresh (now also writes to Yjs).
- [x] Undo/redo works through commands (`undoHistory` for geometry/style/chart/table; server-side fallback for slide ops).
- [x] Renderers do not fetch their own element data.
- [ ] PNG fallback is limited to explicitly unsupported objects (shape + image + connector done; freeform/group still PNG).
- [ ] Existing export flows still work.
- [x] Existing agent tools can still mutate Bridge JSON and trigger store reconciliation.
