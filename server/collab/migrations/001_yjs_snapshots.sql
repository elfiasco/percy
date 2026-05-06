-- Percy collab server — yjs_snapshots
--
-- Stores periodic snapshots of each (docId, slideN) Y.Doc as raw bytes for
-- cold-start recovery. Bridge JSON in the main Postgres remains the system
-- of record; this table is a cache that lets the collab server resume an
-- in-progress session without re-hydrating the whole slide from FastAPI.
--
-- Run once before deploying the collab server to a new environment:
--
--   psql "$DATABASE_URL" -f migrations/001_yjs_snapshots.sql
--
-- Idempotent — safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS yjs_snapshots (
  room_id    TEXT PRIMARY KEY,
  data       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  size_bytes INTEGER NOT NULL
);

-- Index for size-budget cleanup queries (e.g. "show me the 50 oldest snapshots")
CREATE INDEX IF NOT EXISTS yjs_snapshots_updated
  ON yjs_snapshots (updated_at);

-- Optional: a periodic VACUUM target. The bytea column holds Yjs binary
-- updates which are written-and-replaced (not appended); over time the
-- table can accumulate dead tuples. A weekly autovacuum + pg_repack on
-- a busy install keeps it tidy.

COMMENT ON TABLE  yjs_snapshots               IS 'Yjs Y.Doc snapshots per (docId, slideN). Cache only — Bridge JSON is canonical.';
COMMENT ON COLUMN yjs_snapshots.room_id       IS 'Format: <docId>::slide-<n>';
COMMENT ON COLUMN yjs_snapshots.data          IS 'Y.encodeStateAsUpdate() output';
COMMENT ON COLUMN yjs_snapshots.size_bytes    IS 'Length of `data`; cheaper than length(data) for budget queries';

COMMIT;
