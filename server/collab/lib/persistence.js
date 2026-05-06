/**
 * Snapshot persistence.
 *
 * Two backends with the same interface:
 *
 *   - PostgresStore  : production. Snapshots stored as bytea in the
 *                      yjs_snapshots table of Percy's existing DB.
 *   - FileStore      : dev / fallback. Snapshots in ./snapshots/<roomId>.bin.
 *
 * Picked at startup based on DATABASE_URL availability:
 *
 *     export DATABASE_URL=postgres://user:pass@host:5432/percy
 *     # → PostgresStore
 *
 *     # unset
 *     # → FileStore
 *
 * Schema (run once via migrations or psql):
 *
 *     CREATE TABLE IF NOT EXISTS yjs_snapshots (
 *       room_id    TEXT PRIMARY KEY,
 *       data       BYTEA NOT NULL,
 *       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *       size_bytes INTEGER NOT NULL
 *     );
 *     CREATE INDEX IF NOT EXISTS yjs_snapshots_updated ON yjs_snapshots(updated_at);
 */

import { promises as fs } from "fs"
import path from "path"

export class FileStore {
  constructor(dir = "./snapshots") {
    this.dir = dir
  }
  async load(roomId) {
    try {
      const buf = await fs.readFile(this._path(roomId))
      return new Uint8Array(buf)
    } catch (e) {
      if (e.code === "ENOENT") return null
      throw e
    }
  }
  async save(roomId, data) {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this._path(roomId), data)
  }
  async delete(roomId) {
    try { await fs.unlink(this._path(roomId)) }
    catch (e) { if (e.code !== "ENOENT") throw e }
  }
  _path(roomId) {
    return path.join(this.dir, encodeURIComponent(roomId) + ".bin")
  }
  describe() { return `FileStore(${this.dir})` }
}

export class PostgresStore {
  constructor(pool) {
    this.pool = pool
  }
  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS yjs_snapshots (
        room_id    TEXT PRIMARY KEY,
        data       BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        size_bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS yjs_snapshots_updated ON yjs_snapshots(updated_at);
    `)
  }
  async load(roomId) {
    const r = await this.pool.query(
      "SELECT data FROM yjs_snapshots WHERE room_id = $1",
      [roomId],
    )
    if (r.rows.length === 0) return null
    return new Uint8Array(r.rows[0].data)
  }
  async save(roomId, data) {
    const buf = Buffer.from(data)
    await this.pool.query(
      `INSERT INTO yjs_snapshots (room_id, data, updated_at, size_bytes)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (room_id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW(),
         size_bytes = EXCLUDED.size_bytes`,
      [roomId, buf, buf.length],
    )
  }
  async delete(roomId) {
    await this.pool.query("DELETE FROM yjs_snapshots WHERE room_id = $1", [roomId])
  }
  describe() { return "PostgresStore(yjs_snapshots)" }
}

export async function pickStore() {
  const url = process.env.DATABASE_URL
  if (url) {
    const { default: pg } = await import("pg")
    const pool = new pg.Pool({ connectionString: url })
    const store = new PostgresStore(pool)
    await store.ensureSchema()
    console.log("persistence:", store.describe())
    return store
  }
  const dir = process.env.SNAPSHOT_DIR || "./snapshots"
  const store = new FileStore(dir)
  console.log("persistence:", store.describe(), "(set DATABASE_URL for Postgres)")
  return store
}
