/**
 * Smoke test — connects two Yjs clients to a running server and verifies
 * an edit made on client A appears on client B.
 *
 *   PORT=11234 node server.js   # in another terminal
 *   node smoke-test.js
 */

import * as Y from "yjs"
import * as syncProtocol      from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { WebSocket } from "ws"

const URL = process.env.WS_URL || "ws://127.0.0.1:11234/test-room"
const TIMEOUT_MS = 5000

const MESSAGE_SYNC      = 0
const MESSAGE_AWARENESS = 1

function makeClient(label) {
  const doc = new Y.Doc()
  const aware = new awarenessProtocol.Awareness(doc)
  const ws = new WebSocket(URL)
  ws.binaryType = "arraybuffer"

  ws.on("open", () => {
    // Send sync step 1
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, doc)
    ws.send(encoding.toUint8Array(enc))
    console.log(`[${label}] connected, sent sync step 1`)
  })

  ws.on("message", (data) => {
    const message = new Uint8Array(data)
    const dec = decoding.createDecoder(message)
    const type = decoding.readVarUint(dec)
    if (type === MESSAGE_SYNC) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_SYNC)
      syncProtocol.readSyncMessage(dec, enc, doc, ws)
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(aware, decoding.readVarUint8Array(dec), ws)
    }
  })

  doc.on("update", (update, origin) => {
    if (origin === ws) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeUpdate(enc, update)
    if (ws.readyState === ws.OPEN) ws.send(encoding.toUint8Array(enc))
  })

  return { doc, ws, label }
}

async function main() {
  const a = makeClient("A")
  const b = makeClient("B")

  // Wait for both to connect
  await Promise.all([
    new Promise((res) => a.ws.on("open", res)),
    new Promise((res) => b.ws.on("open", res)),
  ])

  // Allow sync step exchange
  await new Promise((r) => setTimeout(r, 200))

  // A writes "hello" to a shared text type
  const aText = a.doc.getText("greeting")
  aText.insert(0, "hello from A")
  console.log(`[A] wrote "${aText.toString()}"`)

  // Wait for B to receive
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    const bText = b.doc.getText("greeting").toString()
    if (bText === "hello from A") {
      console.log(`[B] received "${bText}" after ${Date.now() - start}ms`)
      console.log("✓ smoke test passed")
      a.ws.close(); b.ws.close()
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  console.error(`✗ smoke test FAILED: B never saw the update (got "${b.doc.getText("greeting").toString()}")`)
  a.ws.close(); b.ws.close()
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
