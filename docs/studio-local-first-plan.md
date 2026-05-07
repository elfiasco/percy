# Studio local-first architecture — plan

## Why

The current studio is server-authoritative-per-edit: every keystroke / drag /
property change is an HTTP RPC. This is the structural cause of every "jank"
the user reports — the laggy moves, the backspace-spaz, the reorder-feels-off.
It also makes real multiplayer impossible to bolt on cleanly.

We already have Yjs wired up (per-slide rooms, WebSocket relay, server-side
save-back). We just aren't using the Y.Doc as the source of truth — we use
it as a sidecar to the API. This plan flips that.

## What stays sacred: the Bridge model

**Bridge JSON is the canonical model. Y.Doc is just an editing surface.**

- The Python-side `BridgeElement` / `BridgeSlide` / `PercyDocument` dataclasses
  are the source of truth for the system. They're what agents reason about,
  what gets persisted, what `.percy` bundles serialize, what the rebuild
  pipeline reads, what every cloud worker consumes.
- The Y.Doc is a *format of convenience* for live collaborative editing.
  It only exists during an editing session. It is never persisted as the
  primary representation.
- `bridgeYjsAdapter.ts` is the only place where the two shapes meet. Every
  field we want to edit live in the studio must have a defined Y.Doc
  location AND a defined Bridge field, with a round-trip test.
- New element types or new fields default to "Bridge-only" — they don't
  enter the Y.Doc shape until we explicitly add them to the adapter and
  to the studio UI.

## Target architecture

```
keystroke ─► Y.Doc (instant, local) ─► UI re-renders from Y.Doc
                  │
                  ├─► WebSocket relay ─► other clients (multiplayer)
                  │
                  └─► (debounced)  Y.Doc snapshot ─► Bridge JSON ─► RDS
                                   (server collab worker)
```

- **Y.Doc** = source of truth during an editing session
- **UI** = subscribes to Y.Doc; never makes RPC for live edits
- **Bridge JSON** = canonical persisted form. Read on doc-open to hydrate Y.Doc;
  written via debounced server-side save-back
- **API mutation endpoints** stay alive for the agent / external integrations,
  but the studio's hot path doesn't use them

## Y.Doc room shape (precise)

```
yDoc.getMap("slide_meta") : Y.Map<unknown>
   "background_color":     string | null
   "transition":           Y.Map<...>      (future)

yDoc.getMap("elements") : Y.Map<Y.Map<unknown>>
   <elementId> : Y.Map
       "type":       string                ("BridgeText", "BridgeShape", …)
       "label":      string | null
       "name":       string | null
       "left_in":    number
       "top_in":     number
       "width_in":   number
       "height_in":  number
       "rotation":   number
       "z_index":    number
       "locked":     boolean
       "hidden":     boolean
       "style":      Y.Map (fill_color, line_color, opacity, …)
       "font":       Y.Map (name, size, color, weight, …)

yDoc.getXmlFragment(`text:${elementId}`) : Y.XmlFragment
   ProseMirror/Tiptap content for text-bearing elements.
   Top-level (always attached) — see TiptapTextRenderer.
```

Single adapter module owns Bridge↔Y.Doc translation:
`frontend/src/lib/collab/bridgeYjsAdapter.ts`

## Phases

### Phase A — BridgeText reads/writes Y.Doc only (no API in hot path)

- Tiptap's Collaboration extension already writes to Y.XmlFragment
- Stop calling `updateElementText` on blur/save
- Save-back happens server-side from Y.Doc snapshot

**Acceptance**: Playwright test types into a text box, blurs, then refreshes
the page; the text is still there. No HTTP `PATCH /api/docs/.../elements/text`
fires during the typing flow.

### Phase B — Position / size / rotation / z-index / flags through Y.Doc

- Drag handler writes to `elementMap.get("left_in")` etc., not `updateElementPosition`
- Properties panel does the same
- Multi-select moves = single Y.Doc transaction
- Slide elements list subscribes to Y.Doc updates

**Acceptance**: Playwright drags a text box. The position updates locally with
no network call. After page refresh the position is preserved.

### Phase C — Style / font / paint properties

- Fill, stroke, opacity, font_name, font_size, etc. live in
  `elementMap.get("style")` and `elementMap.get("font")` Y.Maps
- Style picker writes via Y.Doc
- Renderer reads style from Y.Doc

**Acceptance**: Change fill color in the properties panel. Refresh. Persists.

### Phase D — Slide-level operations + element add/remove

- `yDoc.getArray("slide_order")` for reorder
- Add element: push new Y.Map into `elements` map
- Delete element: remove key from `elements` map
- Slide-level: background color, transitions

**Acceptance**: Add a slide, reorder, delete an element. Refresh. State
persists. With a second tab open, all operations sync in real-time.

### Phase E — Custom cursors + finalize multiplayer UX

- Replace CollaborationCursor (broken in Tiptap v3 + y-prosemirror combo) with
  a tiny custom <RemoteCursor /> component that reads from Y.Awareness directly
- Selection awareness: broadcast which element each user has selected so peers
  see colored selection rings
- Presence avatars already shipped

**Acceptance**: Two browser tabs. Both show each other's caret position in
text and which element each has selected on the canvas.

## Adapter strategy

`bridgeYjsAdapter.ts` owns:
- `hydrateDocFromBridge(yDoc, doc)` — once on open
- `bridgeFromDoc(yDoc)` — server-side save-back

The Bridge ↔ Y.Doc mapping is exhaustive: every field that exists in the Bridge
data class has a defined location in the Y.Doc shape. Anything not yet
mapped throws clearly so we never silently lose data.

## Known infrastructure issue (Phase E follow-up)

**App Runner Envoy returns 403 on every WebSocket upgrade** to the collab
relay. Verified with raw curl:

```
$ curl -i -H "Upgrade: websocket" -H "Connection: Upgrade" \
       -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: …" \
       https://kbgafnvu3n.us-east-1.awsapprunner.com/test
HTTP/1.1 403 Forbidden
server: envoy
```

Health endpoint over HTTPS works, so the service itself is up. Per AWS docs
App Runner is supposed to support WebSockets natively as of late 2024, but
it's being rejected at the Envoy layer — likely an Envoy/AppRunner config
mismatch that needs further investigation.

**Workaround in place**: client falls back to BroadcastChannel after 2
reconnect failures, which keeps multi-tab same-browser collaboration
working for the demo.

**Permanent fix**: move the collab service off App Runner. Two viable paths:
1. ECS Fargate behind an Application Load Balancer (ALB has full WS support).
2. EC2 + nginx, or a managed WS service.

Either choice keeps the existing `server/collab/` code unchanged — only
the deployment target moves.

## Risk + rollback

- Risk: Y.Doc and Bridge diverge in some field we forget. Mitigation:
  the adapter has a "reconcile" mode that re-hydrates Y.Doc from the Bridge
  if needed (recovery from corrupted Y.Doc state).
- Risk: server-side save-back failure leaves edits only in Y.Doc. Mitigation:
  Y.Doc snapshots are also persisted in `yjs_snapshots` Postgres table
  (already exists). On reconnect we recover from the snapshot.
- Rollback: legacy API endpoints remain functional. Toggle off Y.Doc reads
  by setting the renderer's `useYDoc` flag to false; we fall back to the
  current API-driven path.
