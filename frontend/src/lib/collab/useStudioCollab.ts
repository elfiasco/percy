import { useEffect, useState } from "react"
import { getYjsRoom, type Transport } from "./yjsRoom"
import { setCollabContext } from "./collabContext"
import { setLocalUser, colorForUser, getAwareness, type PercyUserPresence } from "./awareness"

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
  docId:    string,
  slideN:   number,
  user:     StudioCollabUser | null,
  enabled:  boolean = true,
  transport: Transport = "broadcast",
): { remoteUserCount: number } {
  const [remoteUserCount, setRemoteUserCount] = useState(0)

  useEffect(() => {
    if (!user || !enabled) {
      setCollabContext(null)
      setRemoteUserCount(0)
      return
    }

    const room = getYjsRoom(docId, slideN, transport)
    const presence: PercyUserPresence = {
      userId: user.id,
      name:   user.name,
      color:  colorForUser(user.id),
    }
    setLocalUser(room, presence)
    setCollabContext({ room, user: presence, enabled: true })

    // Track other connected users for an "N collaborators here" indicator
    const aw = getAwareness(room)
    const updateCount = () => {
      const n = aw.getStates().size
      setRemoteUserCount(Math.max(0, n - 1))   // exclude self
    }
    aw.on("update", updateCount)
    updateCount()

    return () => {
      aw.off("update", updateCount)
      setCollabContext(null)
    }
  }, [docId, slideN, user?.id, user?.name, enabled, transport])

  return { remoteUserCount }
}
