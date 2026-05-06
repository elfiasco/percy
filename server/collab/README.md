# Percy collaboration server

Yjs WebSocket relay for Percy Studio multiplayer. Bridge JSON stays canonical;
this server holds a transient Y.Doc per (`docId`, slide) pair while users are
editing, and writes back to Bridge via the existing FastAPI endpoints.

## Architecture

```
   browser (Tiptap + y-prosemirror)
      ↕  wss
   collab server  (this directory)
      ├──→ FastAPI (Bridge hydration + save-back)
      └──→ Postgres (yjs_snapshots — disaster-recovery only)
```

Each room is `<docId>::slide-<n>`. Bridge is the system of record; the
Y.Doc is a cache that lives only as long as someone is editing.

## Run locally

```bash
cd server/collab
npm install
PORT=1234 PERCY_API_BASE=http://localhost:8000 node server.js
```

For full auth (recommended even in dev):

```bash
export PERCY_JWT_SECRET=$(grep PERCY_JWT_SECRET ../../.env | cut -d= -f2)
PORT=1234 node server.js
```

Then point the studio at it:

```bash
echo "VITE_YJS_WS_URL=ws://localhost:1234" >> ../../frontend/.env.local
cd ../../frontend && npm run build
```

Two browsers (or two machines) at the same studio URL now sync edits.

## Deploy to AWS App Runner

```bash
# 1. Build + push to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker build -t percy-collab .
docker tag percy-collab:latest <account>.dkr.ecr.us-east-1.amazonaws.com/percy-collab:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/percy-collab:latest

# 2. Create the App Runner service in the AWS console:
#    - Source: ECR image (the one you just pushed)
#    - Port: 1234
#    - CPU/Memory: 0.25 vCPU / 0.5 GB to start
#    - Environment variables (see below)
#    - Auto-scaling: min 1 / max 1 (or as needed; see "Scaling")
#    - Health check: HTTP /healthz on port 1234
```

### Required environment variables in App Runner

| Var | What |
|---|---|
| `PERCY_API_BASE`      | URL of the existing FastAPI service (e.g. `https://abc.awsapprunner.com`) |
| `PERCY_JWT_SECRET`    | **Same value** as FastAPI's `PERCY_JWT_SECRET`. Without this, all WebSocket connections are rejected. |
| `DATABASE_URL`        | Same Postgres as FastAPI. Server creates `yjs_snapshots` automatically. |
| `PERCY_SERVICE_TOKEN` | Optional — shared secret for service-level calls (forwarded as `X-Percy-Service-Token`). Useful for calls without a user JWT. |
| `PORT`                | `1234` |
| `SAVE_BACK_INTERVAL_MS` | Default `5000`. Lower = more frequent saves; higher = fewer round-trips. |
| `SNAPSHOT_INTERVAL_MS`  | Default `5000`. Postgres snapshot debounce. |

### Wire the studio

The frontend bundle bakes `VITE_YJS_WS_URL` at build time. Set it before
running `npm run build`:

```bash
# In the frontend deploy environment
export VITE_YJS_WS_URL=wss://collab.percy.app
npm run build
```

The bundle is then deployed to App Runner / S3 / wherever as before.

## How "Bridge stays canonical" works

This is the architectural commitment. Three flows ensure Bridge is always
the source of truth:

1. **Cold start (no clients in room)**:
   - Server reads `yjs_snapshots` from Postgres for fast resume
   - If no snapshot exists, server hits `GET /api/docs/<id>/slides/<n>/elements`
     and `GET /api/docs/<id>/slides/<n>/elements/<el>/text` for each text
     element, runs `paragraphsToTiptap` on each, and seeds `Y.XmlFragment`
   - Y.Doc is now populated from Bridge

2. **Live editing (≥1 client in room)**:
   - Yjs sync protocol passes binary updates between clients
   - Snapshot to Postgres every 5s (debounced) for crash recovery only
   - **Save-back to Bridge every 5s of activity** (debounced):
     - For each text element with a non-empty fragment
     - `yXmlFragmentToProsemirrorJSON(frag)` → `tiptapToParagraphs(json)` → Bridge
     - `PATCH /api/docs/<id>/slides/<n>/elements/<el>/text` with the user's JWT
     - Per-element hash dedupe — unchanged elements skip the round-trip
   - Bridge in Postgres always lags ≤5s behind the live Y.Doc

3. **Disconnect (last client leaves room)**:
   - Force-flush save-back (immediate, not debounced)
   - Force-flush snapshot
   - Schedule idle GC after 5min of zero connections
   - When GC fires: free Y.Doc; next connect re-hydrates from Bridge

## Performance characteristics

- Yjs binary updates per keystroke: ~50–200 bytes
- Save-back round-trip: 1× HTTP PATCH per dirty element, every 5s
- Server memory: ~5MB per active room (typical 50-element slide)
- Single instance handles ~1000 concurrent rooms / ~5000 concurrent users
  before CPU bottlenecks (Yjs is fast; the bottleneck is fan-out)

## Scaling

A single App Runner instance is fine until ~5000 concurrent users. Beyond
that, two paths:

- **Horizontal scale** via Redis backplane (rooms sharded by room name; each
  instance owns a subset). Adds operational complexity.
- **Liveblocks managed** — swap out our server entirely for the Liveblocks
  endpoint by changing one env var; pay per MAU.

For Percy's GTM: stay on this single-instance setup until growth demands it.

## Smoke test

```bash
PORT=11237 node server.js  # in one terminal
WS_URL=ws://127.0.0.1:11237/test-room node smoke-test.js
# Expected: ✓ smoke test passed
```

## Files

```
server.js              — entry point: HTTP + WebSocket + per-room state
Dockerfile             — node:20-alpine
apprunner.yaml         — App Runner config
.dockerignore
package.json
smoke-test.js          — tiny end-to-end verification
lib/
  extensions.js        — Tiptap extension set (mirror of frontend)
  tiptapAdapter.js     — Bridge ↔ Tiptap JSON (mirror of frontend)
  bridgeSync.js        — hydration in / save-back out + dirty tracking
  fastapiClient.js     — typed wrappers for the FastAPI endpoints we call
  persistence.js       — PostgresStore + FileStore for Y.Doc snapshots
```
