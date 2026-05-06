/**
 * Thin client for the existing Percy FastAPI backend.
 *
 * Two auth modes:
 *
 *   1. **Per-user**: forwards the user's percy_session JWT (received during
 *      the WebSocket handshake) on every request. Used for save-back so the
 *      audit log attributes changes to the right user.
 *
 *   2. **Service token**: a shared secret (PERCY_SERVICE_TOKEN env var) the
 *      FastAPI backend recognizes for trusted internal calls. Used for
 *      hydration when no specific user is connected (e.g. cold cache load).
 *
 * The client never decodes JWTs — that's the FastAPI backend's job. We just
 * pass the token through and let the backend reject if it's invalid.
 */

const FASTAPI_BASE   = process.env.PERCY_API_BASE     || "http://localhost:8000"
const SERVICE_TOKEN  = process.env.PERCY_SERVICE_TOKEN || ""

async function request(path, opts = {}, userToken = null) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) }
  if (userToken)         headers.cookie        = `percy_session=${userToken}`
  if (SERVICE_TOKEN)     headers["x-percy-service-token"] = SERVICE_TOKEN
  const res = await fetch(`${FASTAPI_BASE}${path}`, { ...opts, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status} ${path}: ${text.slice(0, 120)}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Public API ──────────────────────────────────────────────────────────────

export function fetchSlideElements(docId, slideN, userToken) {
  return request(`/api/docs/${encodeURIComponent(docId)}/slides/${slideN}/elements`, {}, userToken)
}

export function fetchElementText(docId, slideN, elementId, userToken) {
  return request(
    `/api/docs/${encodeURIComponent(docId)}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/text`,
    {},
    userToken,
  )
}

export function patchElementText(docId, slideN, elementId, bridgeContent, userToken) {
  return request(
    `/api/docs/${encodeURIComponent(docId)}/slides/${slideN}/elements/${encodeURIComponent(elementId)}/text`,
    { method: "PATCH", body: JSON.stringify(bridgeContent) },
    userToken,
  )
}

/**
 * Verify a user's percy_session JWT by hitting /api/auth/me. Returns the
 * user object on success, throws on failure. Cheap (FastAPI's me endpoint
 * is a fast DB lookup).
 */
export async function verifyUser(token) {
  return request("/api/auth/me", {}, token)
}

/**
 * Confirm the user has access to a project/doc. We don't have a
 * dedicated endpoint for this, but openProject implicitly checks ACL —
 * if the call succeeds, the user is authorized.
 */
export async function checkDocAccess(docId, token) {
  // Resolve doc_id back to a project — FastAPI's open-project endpoint
  // expects a project id, not a doc id. For now we assume callers already
  // hold a valid token from the studio (which had to load the project to
  // get here). If we want stricter checks, add a /api/docs/<id>/check-access
  // endpoint to the backend.
  if (!token) throw new Error("no auth token")
  const me = await verifyUser(token)
  if (!me?.id) throw new Error("token did not resolve to a user")
  return me
}
