# Tiptap + Yjs Migration Plan

**Branch:** `feat/tiptap-yjs` (checkpoint at `checkpoint/pre-tiptap-yjs`)
**Started:** 2026-05-05

## Why

Percy currently hand-rolls a contentEditable text editor (`TextRenderer.tsx`,
`textHtml.ts`, `textEditingBus.ts`, `InlineTextEditor.tsx`, the `execCommand`
plumbing in `TextFormatGroup.tsx`). It works, but:

- Selection-aware ribbon was just bolted on; brittle
- Lists, indent, line-height, hyperlinks, mentions are all custom-build-from-scratch
- Tables use a separate panel; cells aren't real rich text
- Multiplayer would require building our own CRDT layer

**Tiptap** (built on ProseMirror) solves the editor side cleanly. **Yjs** layered
on top gives real-time multiplayer without rewriting Bridge.

The Bridge typed JSON model stays the canonical disk + wire format. Tiptap is
a transient editing view; Yjs is a transient sync layer. Everything downstream
of save (Python connects, brand extraction, .pptx export, render pipeline) is
unaffected because the saved shape doesn't change.

## North star architecture

```
   client A                                       client B
   ────────                                       ────────
   Tiptap (per text element)                      Tiptap (per text element)
       ↕                                              ↕
   y-prosemirror binding                          y-prosemirror binding
       ↕                                              ↕
   Y.Doc per slide       ◄── WebSocket ─►        Y.Doc per slide
       ↕                       │                     ↕
   Bridge adapter              │                  Bridge adapter
       ↕                       ▼                     ↕
   React renders         relay server             React renders
                         (Hocuspocus / Liveblocks)
                                │
                                ▼
                        persistence (Postgres)
```

On save / when collaborative session ends, the Y.Doc serializes back to plain
Bridge JSON (the existing wire format) and we POST to the existing endpoints.

## Scope ladder

This plan is organized as five phases. Each phase is independently shippable
and individually valuable. We start at the foundation and only descend further
if time permits.

---

### Phase 1 — Tiptap for `BridgeText`

The foundation. Replaces my custom contentEditable with a Tiptap editor for
plain text-bearing elements. Selection-aware ribbon becomes idiomatic.

**Deliverables**
- `package.json`: install `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`,
  `@tiptap/extension-text-style`, `@tiptap/extension-underline`,
  `@tiptap/extension-color`, `@tiptap/extension-text-align`
- `lib/bridge/tiptapAdapter.ts` — `paragraphsToTiptap()` / `tiptapToParagraphs()`
- `lib/bridge/extensions/BridgeParagraph.ts` — paragraph node with
  `spaceBefore` / `spaceAfter` attrs
- `lib/bridge/extensions/BridgeTextStyle.ts` — textStyle mark with
  `fontName` / `fontSize` / `fontColor` / `caps` attrs
- `components/studio/renderers/TiptapTextRenderer.tsx` — registers for
  `BridgeText`, renders idle as static HTML, switches to live editor on click
- `components/studio/TextFormatGroup.tsx` — dispatches `editor.chain()...run()`
  instead of execCommand; `editor.isActive(...)` drives toggle indicators

**Removed**
- `lib/textHtml.ts`
- `lib/textEditingBus.ts`
- `components/studio/renderers/TextRenderer.tsx` (old)
- `components/studio/InlineTextEditor.tsx` (legacy textarea overlay)

**Quality gate**
- Typecheck clean
- Production build clean
- Round-trip test: load a real deck, edit a text element, save; reload — text
  format preserved (font, size, color, bold/italic/underline, alignment,
  caps, strikethrough)

**Estimated effort:** 3–4 hours of focused work.

---

### Phase 2 — Tiptap table cells for `BridgeTable`

Table cells become real rich text — bold, italic, font, color *inside cells*,
not just whole-cell formatting.

**Deliverables**
- Install `@tiptap/extension-table`, `@tiptap/extension-table-row`,
  `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`
- `lib/bridge/extensions/BridgeTable.ts` — table node with `bandedRows`,
  `firstRowHeader`, `columnWidths` attrs
- `lib/bridge/extensions/BridgeTableCell.ts` — cell node with `backgroundColor`,
  `borderStyle` attrs; cell content is Bridge paragraphs
- `lib/bridge/tiptapAdapter.ts` — extend with `tableToTiptap()` /
  `tiptapToTable()` (reuses paragraph adapter for cells)
- `components/studio/renderers/TiptapTableRenderer.tsx` — registers for
  `BridgeTable`

**Removed**
- Old `TableRenderer.tsx` and `TableEditorPanel.tsx` if Tiptap covers their
  surface; otherwise downgrade them to read-only views

**Quality gate**
- Insert table → type into a cell → save → reload preserves content
- Tab key moves between cells
- Banded rows / header row toggles work via the panel

**Estimated effort:** 2–3 hours.

---

### Phase 3 — Tiptap text inside `BridgeShape` and `BridgeChart` titles

Composite renderers: SVG geometry + Tiptap overlay for text.

**Deliverables**
- `components/studio/renderers/TiptapShapeRenderer.tsx` — SVG shape rendering
  (rect, ellipse, arrow, etc.) underneath a positioned Tiptap text editor
- Chart title / axis title / data labels editing through small inline Tiptap
  instances on the existing ChartEditorPanel

**Quality gate**
- Click into a shape's text → edit with full ribbon control → save preserves
  both shape geometry and text formatting

**Estimated effort:** 2 hours.

---

### Phase 4 — Yjs CRDT layer

The big multiplayer move. Each slide becomes a Y.Doc; element fields become
Y.Map entries; text content uses `y-prosemirror` for collaborative editing.

**Deliverables**
- Install `yjs`, `y-prosemirror`, `@tiptap/extension-collaboration`,
  `@tiptap/extension-collaboration-cursor`
- `lib/collab/yjsRoom.ts` — connect to a Y.Doc per slide; expose `getElement(id)`,
  `setField(id, key, value)`, `getTextFragment(id)` for the text editor
- Tiptap renderers: when a `Y.XmlFragment` is available for an element, register
  the Collaboration + CollaborationCursor extensions; without one, fall back to
  local-only editing (Phase 1 behavior)
- Element field reactivity: `Y.Map.observe()` re-renders the React tree when
  remote field changes arrive
- Awareness: render remote cursors + selection halos with name pill

**Local-only proof first.** A Y.Doc kept in module memory (no network) lets
two studio tabs in the same browser sync via BroadcastChannel — proves the
binding is correct before we add the server.

**Quality gate**
- Two browser tabs editing the same slide: edits propagate < 200ms
- Conflict-free: simultaneous edits to different fields don't lose data
- Save: Y.Doc serializes back to Bridge JSON with no loss

**Estimated effort:** 3–4 hours for local-only; another 2 hours to wire up
a real WebSocket transport.

---

### Phase 5 — Persistence + transport

The piece that makes Phase 4 actually multi-user.

**Options (pick one):**
- **Liveblocks** — managed Yjs hosting. Fastest to ship; ~$0.04/MAU.
  - Frontend: `@liveblocks/yjs` + provider, ~30 lines of wiring
  - Backend: nothing (Liveblocks is the backend)
- **Hocuspocus** — open-source Yjs server. Self-host on AWS.
  - Frontend: `@hocuspocus/provider`, ~30 lines
  - Backend: Node.js server with Postgres extension for persistence
- **y-websocket** — minimal. We build the relay.

For GTM ship: **Liveblocks**, with an escape hatch (provider is swappable later).

**Deliverables**
- `lib/collab/provider.ts` — wraps the chosen provider; exposes
  `connect(roomId)` / `disconnect()`
- Server-side: persistence on disconnect (last writer flushes Y.Doc snapshot
  to Postgres `slide_doc_snapshots` table). On connect, server hydrates Y.Doc
  from snapshot.
- Auth: room id = `${doc_id}:${slide_n}`; access checked against existing
  org/project ACL

**Quality gate**
- Two clients on different machines see each other's edits
- Disconnect → reconnect → state preserved
- Closing the deck → reopening: last collaborative state loaded

**Estimated effort:** 1 day if Liveblocks; 2–3 days if self-host.

---

## Order of execution

1. ✅ Checkpoint branch created (`checkpoint/pre-tiptap-yjs`)
2. ✅ Feature branch (`feat/tiptap-yjs`)
3. Plan written (this file)
4. **Phase 1: Tiptap for BridgeText** — execute end-to-end
5. **Phase 2: Tables** — execute if Phase 1 lands cleanly
6. **Phase 3: Shapes/charts** — execute if time
7. **Phase 4: Yjs (local-only proof)** — scaffold even if not full
8. **Phase 5** — document, defer to next session if needed

This session targets **Phases 1–2 fully, Phase 3 partially, Phase 4 scaffolded
without server.** Phase 5 is its own work item; documented but not executed.

## Risk register

- **Bundle size.** Tiptap + extensions adds ~120KB gzipped. Mitigated by code-
  splitting per route (Studio is the only consumer; non-studio pages don't load
  it).
- **ProseMirror's flow model vs absolute slide layout.** Tiptap edits inside
  *one element*. The slide canvas remains our absolute-positioning DOM. No
  conflict. Verified by structure: a `<EditorContent>` is just a div that fits
  inside the existing element overlay.
- **Save round-trip lossiness.** Mitigated by adapter unit tests on real-deck
  fixtures. Any field that doesn't survive becomes a known limitation
  documented inline.
- **Yjs + Bridge mapping.** A Y.Map of scalars for non-text fields is trivial.
  Text uses `Y.XmlFragment` via the Tiptap collaboration extension. The only
  subtle bit is that on first connect, we hydrate Y.Doc from existing Bridge
  JSON — done by running the adapter once and copying values into Y types.
- **Liveblocks / Hocuspocus dependency.** Reversible. The Yjs binding is
  provider-agnostic; swapping providers is a 30-line change.

## What is NOT changing

- Bridge typed JSON model: identical
- Backend endpoints: identical
- Python connect engine: identical
- Brand extraction: identical
- .pptx export: identical
- PNG diagnostic renderer: identical
- Studio shell (ribbon, slide strip, properties panel, canvas): identical
- All non-text element renderers (Chart, Image, Connector, Freeform, Group):
  identical (until Phase 3)

The work is contained to: the text editor inside text-bearing elements, plus
a thin sync layer between editors of the same element across clients.

## Done criteria

For this session to land cleanly:
- ✅ Phase 1 fully complete: Tiptap renders all BridgeText elements, edits
  round-trip lossless, ribbon dispatches Tiptap commands, old code deleted
- ✅ Production build green
- ✅ Typecheck clean
- ✅ A user can open a real deck, edit text, save, reload — all formatting
  preserved
- ✅ Phase 2 at least scaffolded if not landed
- ✅ Yjs scaffolding (Phase 4) at least imported and roughed in, even if
  network transport is deferred

---

End of plan.
