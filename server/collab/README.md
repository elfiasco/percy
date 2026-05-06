# Percy collaboration server

Yjs WebSocket relay for Percy studio multiplayer.

Each (`docId`, slide) pair becomes a "room"; clients connect via:

```
ws://host/<docId>::slide-<n>
```

The server keeps an in-memory `Y.Doc` per room and rebroadcasts updates to
every connected client. Snapshots persist to `./snapshots/<roomId>.bin`
(2-second debounce).

## Run

```bash
cd server/collab
npm install
PORT=1234 node server.js
```

Health check:

```
curl http://localhost:1234/healthz
```

## Wire the studio to it

```
# frontend/.env.local
VITE_YJS_WS_URL=ws://localhost:1234
```

In `frontend/src/components/studio/Studio.tsx`, change:

```diff
-    /* transport */ "broadcast",
+    /* transport */ "websocket",
```

Then `npm run dev`. Two browsers (or two machines) at the same studio URL
will sync edits in real time.

## Production hardening (TODO)

- **Auth**: validate `?token=...` against the existing `PERCY_JWT_SECRET`
  in the WebSocket upgrade handler. Reject if user lacks doc access.
- **Persistence**: swap the file snapshot for Postgres (`yjs_snapshots`
  table). Connect via the existing Percy DATABASE_URL.
- **Save-back**: periodically convert each shared `Y.XmlFragment` back to
  Bridge JSON via the same adapter the studio uses, and POST to the
  existing `/api/docs/.../slides/.../elements/.../text` endpoints. Keeps
  Bridge as the system of record.
- **Idle eviction**: free `Y.Doc` after 5min with zero connections.
- **TLS**: terminate at nginx / Caddy / Cloudflare.
- **Metrics**: count rooms, connections, message rate; export to Prometheus.

## Why this is the simplest possible relay

This is `y-websocket`'s server, but inlined so we own it and can extend it.
It uses the standard Yjs sync protocol — the studio's `WebsocketProvider`
talks to it without any custom client code.

For a "managed" path with these features built in, swap the WebSocket URL
to a Liveblocks or Hocuspocus-cloud endpoint; the client doesn't change.
