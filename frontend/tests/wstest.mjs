import WebSocket from "y-websocket/node_modules/ws/wrapper.mjs"
const ws = new WebSocket("wss://kbgafnvu3n.us-east-1.awsapprunner.com/test")
ws.on("open", () => { console.log("OPEN"); ws.close() })
ws.on("error", (e) => console.log("ERROR:", e.message))
ws.on("close", (code, reason) => { console.log("CLOSE:", code, reason.toString()); process.exit(0) })
ws.on("unexpected-response", (req, res) => { console.log("UNEXPECTED:", res.statusCode); process.exit(0) })
setTimeout(() => process.exit(0), 5000)
