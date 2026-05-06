# Multiplayer Server Runbook (Phase 5)

The Yjs client wiring is complete in `feat/tiptap-yjs`. To go from cross-tab
demo to cross-machine multiplayer, point the studio at a Yjs-compatible
WebSocket relay.

## Configuration

The studio reads `VITE_YJS_WS_URL` at build time. Set it to your relay URL:

```
# Local dev
VITE_YJS_WS_URL=ws://localhost:1234

# Production
VITE_YJS_WS_URL=wss://collab.percy.app
```

Then change the transport flag in `Studio.tsx`:

```diff
- /* transport */ "broadcast",
+ /* transport */ "websocket",
```

## Three deployment options

### Option 1: y-websocket (simplest, dev-only)

```bash
npx y-websocket --port 1234
```

In-memory only. Doc state lost on server restart. Fine for QA, not
production.

### Option 2: Hocuspocus (production)

Drop-in `y-websocket` replacement with persistence + auth + scaling.

```bash
npm install @hocuspocus/server @hocuspocus/extension-database
```

```ts
// server/collab.ts
import { Server } from "@hocuspocus/server"
import { Database } from "@hocuspocus/extension-database"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const server = new Server({
  port: 1234,
  async onAuthenticate({ token, documentName }) {
    // documentName is "<docId>::slide-<n>"
    // 1. Decode JWT (the same percy_session cookie value)
    // 2. Check user has access to docId via existing org/project ACL
    // 3. Throw if not authorized
  },
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const r = await pool.query(
          "SELECT data FROM yjs_snapshots WHERE document = $1 ORDER BY updated_at DESC LIMIT 1",
          [documentName],
        )
        return r.rows[0]?.data ?? null
      },
      store: async ({ documentName, state }) => {
        await pool.query(
          `INSERT INTO yjs_snapshots (document, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (document) DO UPDATE SET data = $2, updated_at = NOW()`,
          [documentName, Buffer.from(state)],
        )
      },
    }),
  ],
})

server.listen()
```

Schema:

```sql
CREATE TABLE yjs_snapshots (
  document   TEXT PRIMARY KEY,
  data       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Deploy alongside the existing FastAPI service (separate process, both behind
the same load balancer). Docker:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 1234
CMD ["node", "server/collab.js"]
```

### Option 3: Liveblocks (managed)

Zero-ops. Sign up, get an API key, install `@liveblocks/yjs`:

```ts
import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import { createClient } from "@liveblocks/client"

const client = createClient({ publicApiKey: import.meta.env.VITE_LIVEBLOCKS_KEY })
// In yjsRoom.ts, wire a "liveblocks" transport that creates a room here.
```

Pros: no server to operate. ~$0.04 per monthly active user. SLA + support.
Cons: vendor lock-in, but the binding is swappable behind our `Transport`
abstraction so migration cost is low.

For Percy GTM: **Liveblocks first** (ship faster, iterate UX). Self-host
later when economics or compliance demand it.

## Sync flow with the backend

Save round-trip on disconnect (or periodically):

1. Hocuspocus' `onChange` fires every N seconds OR on graceful disconnect.
2. Decode the Y.Doc → walk elements + slide meta.
3. For each element with a `text` Y.XmlFragment, run `yXmlFragmentToProsemirrorJSON`
   then our existing `tiptapToParagraphs` adapter to get Bridge JSON.
4. POST to existing `PATCH /api/docs/:id/slides/:n/elements/:el/text` (or a
   new bulk endpoint).

The studio already saves on blur via the existing path; the Yjs server's
job is just to keep collaborators in sync between saves and provide a
disaster-recovery snapshot.

## Auth

Hocuspocus' `onAuthenticate` runs on every WebSocket connection. We pass
the JWT (same `percy_session` cookie value) as a connection param:

```ts
new WebsocketProvider(wsUrl, roomId, doc, {
  params: { token: getCookieToken() },
})
```

Server decodes the JWT with the same secret and checks org/project ACL
against the document name (`docId` portion).

## Operations

- **Cold-start a deck** when first opener connects: server fetches Bridge
  JSON via internal API, hydrates the Y.Doc, persists snapshot.
- **Snapshot frequency**: every 60s of activity, plus on graceful disconnect.
- **Snapshot retention**: keep last 10 per document for rollback.
- **Idle rooms**: free in-memory state after 5min of zero connections;
  re-load from snapshot on next connect.

## Cost estimate (Hocuspocus self-host)

- One AWS App Runner / Fly.io / Railway service: ~$10/mo for low traffic
- Postgres for snapshots: existing RDS, negligible additional cost
- Outbound WebSocket bytes: ~$5/mo per 1000 active editor-hours

Liveblocks at 200 MAU: ~$8/mo. Tipping point around 500-1000 MAU when
self-hosting starts saving meaningful money — but not worth the engineering
overhead at that scale.

## What's NOT done

- Server doesn't exist yet (this runbook describes how to build it)
- Auth integration (JWT decode in Hocuspocus' onAuthenticate)
- Snapshot persistence schema migration
- Idle-room cleanup
- Yjs → Bridge save batching at the server (currently the studio still
  saves on blur via the regular API; server-driven save is a polish item)
