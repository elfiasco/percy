import { useEffect, useState } from "react"
import { getYjsRoom, type Transport } from "./yjsRoom"
import { setCollabContext } from "./collabContext"
import { setLocalUser, colorForUser, getAwareness, getRemoteUsers, type PercyUserPresence } from "./awareness"
import { setPresence } from "./presenceStore"
import { startYjsSaveBack } from "./yjsSaveBack"

/**
 * Studio-level hook that owns the per-slide Yjs room, sets local awareness
 * (name + color), and publishes a CollabContext that the text renderer
 * consults when mounting an editor.
 *
 * Called once near the top of <Studio>. When `slideN` changes, the previous
 * room's awareness is cleared and a new room is bound — but the previous
 * Y.Doc stays alive in memory (other tabs may still be looking at it).
 *
 * Defaults to the BroadcastChannel transport so a single browser with two
 * studio tabs at the same slide URL converges automatically — no server
 * required to demonstrate the round-trip.
 */

export interface StudioCollabUser {
  id:    string
  name:  string
}

export function useStudioCollab(
  docId:       string,
  slideN:      number,
  user:        StudioCollabUser | null,
  enabled:     boolean = true,
  transport:   Transport = "broadcast",
): { remoteUserCount: number; remoteUsers: PercyUserPresence[]; localUser: PercyUserPresence | null } {
  const [remoteUsers, setRemoteUsers] = useState<PercyUserPresence[]>([])
  const [localUser, setLocalUserState] = useState<PercyUserPresence | null>(null)

  useEffect(() => {
    if (!user || !enabled) {
      setCollabContext(null)
      setRemoteUsers([])
      setLocalUserState(null)
      setPresence({ localUser: null, remoteUsers: [] })
      return
    }

    let cleanup: (() => void) | null = null
    let cancelled = false

    // Fetch a short-lived collab token if we're using the websocket transport.
    // The studio's percy_session cookie is HttpOnly and scoped to the studio
    // domain, so it can't authenticate cross-origin WebSocket handshakes —
    // we mint a JWT and pass it in the URL query string instead.
    const setupRoom = (token: string) => {
      if (cancelled) return
      const room = getYjsRoom(docId, slideN, transport, token)
      const presence: PercyUserPresence = {
        userId: user.id,
        name:   user.name,
        color:  colorForUser(user.id),
      }
      setLocalUser(room, presence)
      setLocalUserState(presence)
      setCollabContext({ room, user: presence, enabled: true })

      const aw = getAwareness(room)
      const refresh = () => {
        try {
          const r = getRemoteUsers(room)
          setRemoteUsers(r)
          setPresence({ localUser: presence, remoteUsers: r })
        } catch {
          setRemoteUsers([])
          setPresence({ localUser: presence, remoteUsers: [] })
        }
      }
      aw.on("update", refresh)
      refresh()
      const stopSaveBack = startYjsSaveBack(room, docId, slideN)
      cleanup = () => {
        stopSaveBack()
        aw.off("update", refresh)
        setCollabContext(null)
        setPresence({ localUser: null, remoteUsers: [] })
      }
    }

    if (transport === "websocket") {
      fetch("/api/auth/collab-token", { credentials: "include" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`)))
        .then((d) => setupRoom(d.token || ""))
        .catch((e) => {
          console.warn("[Percy] collab-token fetch failed; falling back to broadcast:", e)
          setupRoom("")
        })
    } else {
      setupRoom("")
    }

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [docId, slideN, user?.id, user?.name, enabled, transport])

  return { remoteUserCount: remoteUsers.length, remoteUsers, localUser }
}
