import type { PercyUserPresence } from "./awareness"

/**
 * Tiny pub/sub store for presence so the studio top bar (rendered above
 * the Studio component) can display avatars without having to re-run
 * useStudioCollab. The hook owns the source of truth and pushes to this
 * store; subscribers (e.g. StudioPage) re-render on each update.
 */

interface PresenceState {
  localUser:   PercyUserPresence | null
  remoteUsers: PercyUserPresence[]
}

let _state: PresenceState = { localUser: null, remoteUsers: [] }
const _subs = new Set<() => void>()

export function setPresence(state: PresenceState): void {
  _state = state
  for (const cb of _subs) cb()
}

export function getPresence(): PresenceState {
  return _state
}

export function subscribePresence(cb: () => void): () => void {
  _subs.add(cb)
  return () => _subs.delete(cb)
}
